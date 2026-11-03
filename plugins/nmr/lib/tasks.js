/**
 * 核磁解析子插件：任务服务（自有域 `lab_nmr.tasks`）。
 *
 * 与母插件的关系：只依赖公开导出（task schema / 历史域定义）与宿主服务
 * （storageDomain、ibmCore），不 import 母包 characterization 实现。
 * 旧 `lab_characterization` 里 kind=nmr 的行在启动时一次性迁入本域。
 */
import { Service } from "@deepseek-ai/cordis";
import { readFile, mkdir, stat, writeFile, cp, unlink, rmdir, readdir, lstat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { taskSchema, taskPrompt } from "dsh-lab-agent/characterization-schema";
import { simulationParameters } from "dsh-lab-agent/nmr/simulation";
import { syntheticAssignmentPlan } from "dsh-lab-agent/nmr/synthetic-assignment";
import { nmrStructureSource, nmrOpenPath, nmrFolderPath } from "./intake.js";
import { createNmrSimulation, listNmrSimulations, registerSimulationMnova, simulationStructure } from "./simulation.js";
import { nmrTaskDomain } from "./domain.js";

const hash = buffer => createHash("sha256").update(buffer).digest("hex");
const NMR_STRUCTURE_EXTENSIONS = new Set([".mol", ".sdf", ".cdx", ".cdxml", ".mrv", ".cml", ".smi", ".smiles", ".inchi"]);
const NMR_DATA_EXTENSIONS = new Set([".zip", ".mnova", ".jdx", ".dx", ".jcamp"]);

export class LabNmrTasksService extends Service {
	static inject = ["storageDomain", "ibmCore"];

	constructor(ctx, config = {}) {
		super(ctx, "labNmrTasks");
		this.config = config ?? {};
		this.locks = new Map();
	}

	async [Service.init]() {
		this.domain = await this.ctx.storageDomain.open(nmrTaskDomain);
		this.table = this.domain.table("tasks");
		this.ctx.effect(() => () => this.domain.close(), "lab-nmr-tasks.close");
		// 历史数据由母插件 characterization 持有；它可能比本插件晚启动，故后台重试拉取。
		// 注意：Cordis 的 ctx.get 是隔离的，插件看不到兄弟服务，必须经 ctx.root。
		void this.migrateWhenReady();
	}

	/** 后台拉取历史任务：不阻塞启动，也不与绘图插件争用历史域。 */
	async migrateWhenReady() {
		for (let attempt = 0; attempt < 30; attempt += 1) {
			const legacy = this.ctx.root?.get?.("labCharacterization");
			if (typeof legacy?.allTasks === "function") {
				try {
					await this.importLegacyRows(legacy.allTasks());
				} catch (error) {
					this.ctx.logger?.warn?.(`labNmr: legacy import failed (${error.code ?? error.message})`);
				}
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		this.ctx.logger?.warn?.("labNmr: legacy owner not found; run the one-shot migration script");
	}

	/** 保留给一次性迁移脚本/诊断：从历史所有者取快照并认领 kind=nmr 的行。 */
	async migrateLegacy() {
		const legacyService = this.ctx.root?.get?.("labCharacterization");
		if (typeof legacyService?.allTasks !== "function") return 0;
		return this.importLegacyRows(legacyService.allTasks());
	}

	/** 纯迁移逻辑：接收历史行，只搬 kind=nmr 且本域没有的。 */
	async importLegacyRows(rows = []) {
		let moved = 0;
		for (const row of rows) {
			if (row?.kind !== "nmr") continue;
			if (this.table.get(row.id) !== undefined) continue;
			await this.table.put(row.id, row);
			moved += 1;
		}
		if (moved > 0) this.ctx.logger?.info?.(`labNmr: migrated ${moved} legacy task(s)`);
		return moved;
	}

	serial(id, work) {
		const prior = this.locks.get(id) ?? Promise.resolve();
		const next = prior.catch(() => {}).then(work);
		this.locks.set(id, next);
		return next.finally(() => { if (this.locks.get(id) === next) this.locks.delete(id); });
	}

	/** 该任务是否由本插件持有（远程接口按行归属选服务）。 */
	has(id) {
		return id !== undefined && this.table.get(id) !== undefined;
	}

	list(projectId) {
		return [...this.table.keys()].map(key => this.table.get(key))
			.filter(row => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	get(id, projectId) {
		const row = this.table.get(id);
		if (!row || (projectId && row.projectId !== projectId)) throw new Error("任务不存在或不属于当前课题");
		if (row.kind !== "nmr") throw new Error("该任务不是核磁任务");
		return row;
	}

	async filePath(projectId, path, directory = false) {
		if (!this.ctx.ibmCore.getProject(projectId)) throw new Error("课题不存在");
		const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
		const root = await realpath(workspace.path);
		const target = await realpath(resolve(root, path));
		const rel = relative(root, target);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("文件必须位于当前课题工作目录");
		const info = await stat(target);
		if (!info.isFile() && !(directory && info.isDirectory())) throw new Error("输入不是可读取的文件");
		return target;
	}

	pathInside(root, target) {
		const rel = relative(root, target);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	}

	async findNmrDatasetRoot(root, depth = 0) {
		const names = new Set(await (await import("node:fs/promises")).readdir(root));
		if ((names.has("fid") && (names.has("procpar") || names.has("acqus"))) || (names.has("ser") && names.has("acqus"))) return root;
		if (depth >= 5) return undefined;
		for (const entry of await (await import("node:fs/promises")).readdir(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const found = await this.findNmrDatasetRoot(join(root, entry.name), depth + 1);
			if (found) return found;
		}
		return undefined;
	}

	/** 登记/更新核磁草稿：一次只绑定一份数据与一份结构。 */
	async saveNmrDraft(fields={}) {
		const taskId = String(fields.taskId ?? "").trim();
		const projectId = String(fields.projectId ?? "").trim();
		if (!taskId || !projectId) throw new Error("无效课题或条目编号");
		return this.serial(taskId, async () => {
			if (!this.ctx.ibmCore.getProject(projectId)) throw new Error("课题不存在");
			const old = this.table.get(taskId);
			if (old && (old.projectId !== projectId || old.kind !== "nmr")) throw new Error("条目不属于当前课题");
			if (old && old.status !== "draft") throw new Error("分析已启动，原始输入不可替换");
			let inputPath = old?.inputPath, structurePath = old?.structurePath, inputSha256 = old?.inputSha256;
			if (fields.inputPath) {
				inputPath = await this.filePath(projectId, fields.inputPath, true);
				const info = await stat(inputPath);
				if (info.isFile() && !NMR_DATA_EXTENSIONS.has(extname(inputPath).toLowerCase())) throw new Error("核磁数据支持 FID 目录、ZIP、Mnova 或 JCAMP 文件");
				if (info.isDirectory() && !await this.findNmrDatasetRoot(inputPath)) throw new Error("目录中未找到完整的 FID 数据和采集参数");
				inputSha256 = info.isFile() ? hash(await readFile(inputPath)) : undefined;
			}
			if (fields.structurePath) {
				structurePath = await this.filePath(projectId, fields.structurePath);
				if (!NMR_STRUCTURE_EXTENSIONS.has(extname(structurePath).toLowerCase())) throw new Error("不支持该结构文件格式");
			}
			const compound = { ...(old?.compound ?? {}), ...(fields.compound ?? {}) };
			const now = new Date().toISOString();
			const row = taskSchema.parse({
				...old, id: taskId, projectId, kind: "nmr",
				title: compound.name?.trim() || fields.title?.trim() || old?.title || basename(inputPath || structurePath || "核磁条目").replace(/\.[^.]+$/, ""),
				date: fields.date || old?.date || now.slice(0, 10),
				inputPath, rawInputPath: inputPath, inputSha256,
				structurePath, structureSha256: structurePath ? hash(await readFile(structurePath)) : undefined,
				compound, nucleus: fields.nucleus || old?.nucleus || "1H", deuteratedSolvent: fields.deuteratedSolvent ?? old?.deuteratedSolvent,
				instructions: fields.instructions?.trim() || old?.instructions || "根据输入结构在 Mnova 中完成核磁处理、峰归属与标注，保存标峰后的可编辑核磁文件和分析报告。",
				status: "draft", attempt: old?.attempt ?? 1, createdAt: old?.createdAt ?? now, updatedAt: now
			});
			await this.table.put(row.id, row);
			return { task: row };
		});
	}

	/** 启动分析：只接受已绑定输入与结构的草稿。 */
	async submit(fields = {}, { draftAttempt } = {}) {
		return this.serial(fields.id, async () => {
			if (draftAttempt !== undefined) {
				const current = this.get(fields.id, fields.projectId);
				if (current.status !== "draft" || current.attempt !== draftAttempt) throw new Error("该条目状态已改变，请刷新后重试");
			}
			const now = new Date().toISOString();
			const prepared = { ...fields };
			if (!prepared.inputPath) throw new Error("核磁任务缺少输入数据");
			if (fields.importExternal) {
				prepared.inputPath = await this.importExternalPath(fields.projectId, fields.id, fields.inputPath, "fid");
				if (fields.structurePath) prepared.structurePath = await this.importExternalPath(fields.projectId, fields.id, fields.structurePath, "structure");
			}
			prepared.inputPath = await this.filePath(prepared.projectId, prepared.inputPath, true);
			if (!prepared.structurePath) throw new Error("核磁任务必须同时提供 MOL 或其他机器可读结构文件");
			prepared.structurePath = await this.filePath(prepared.projectId, prepared.structurePath);
			prepared.structureSha256 = hash(await readFile(prepared.structurePath));
			if (!NMR_STRUCTURE_EXTENSIONS.has(extname(prepared.structurePath).toLowerCase())) throw new Error("结构文件格式不支持，请使用 MOL、SDF、CDX、CDXML、MRV、CML、SMI 或 InChI");
			prepared.inputPath = await this.materializeNmrInput(prepared.projectId, prepared.id, prepared.inputPath);
			const inferred = await this.inferNmrMetadata(prepared.inputPath, prepared.structurePath);
			prepared.title ||= inferred.name || basename(prepared.structurePath, extname(prepared.structurePath));
			prepared.nucleus ||= inferred.nucleus || "1H";
			prepared.deuteratedSolvent ||= inferred.deuteratedSolvent;
			prepared.date ||= inferred.date;
			prepared.instructions ||= `根据 ${basename(prepared.structurePath)} 对 ${basename(prepared.inputPath)} 完成 Mnova 自动处理、峰归属和归档。`;
			if (!prepared.compound && inferred.name) prepared.compound = { name: inferred.name };
			const previous = this.table.get(prepared.id);
			const row = taskSchema.parse({
				...prepared, date: prepared.date || new Date().toISOString().slice(0, 10),
				status: "queued", artifacts: {}, artifactHistory: [], attempt: previous?.attempt || 1,
				sessionId: undefined, error: undefined, createdAt: now, updatedAt: now
			});
			const old = this.table.get(row.id);
			if (old) {
				if (old.projectId === row.projectId && old.status === "draft") {
					await this.table.put(row.id, { ...row, createdAt: old.createdAt });
					return { task: this.get(row.id), prompt: taskPrompt(row) };
				}
				if (old.projectId !== row.projectId || old.inputPath !== row.inputPath || old.structurePath !== row.structurePath || old.title !== row.title || old.instructions !== row.instructions || old.date !== row.date || old.nucleus !== row.nucleus || old.deuteratedSolvent !== row.deuteratedSolvent || JSON.stringify(old.compound) !== JSON.stringify(row.compound)) throw new Error("请求 ID 已用于另一任务");
				return { task: old, prompt: taskPrompt(old) };
			}
			await this.table.put(row.id, row);
			return { task: row, prompt: taskPrompt(row) };
		});
	}

	async update(id, projectId, patchOrAttempt, status, error) {
		const patch = patchOrAttempt !== null && typeof patchOrAttempt === "object"
			? patchOrAttempt
			: { attempt: patchOrAttempt, status, error };
		return this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (patch.attempt !== row.attempt) throw new Error("过期的任务尝试");
			if (row.sessionId && patch.sessionId && row.sessionId !== patch.sessionId) throw new Error("任务不属于当前分析会话");
			if (row.status === "completed") return row;
			if (row.status === "draft") throw new Error("请先启动核磁分析");
			if (row.status === "failed" && patch.status !== "failed") throw new Error("失败任务须先重试");
			if (!["running", "failed"].includes(patch.status)) throw new Error("无效任务状态");
			const next = taskSchema.parse({
				...row, status: patch.status,
				sessionId: patch.sessionId || row.sessionId,
				conversationSessionId: patch.sessionId || row.sessionId || row.conversationSessionId,
				error: patch.status === "failed" ? String(patch.error || "任务执行失败") : undefined,
				updatedAt: new Date().toISOString()
			});
			await this.table.put(id, next);
			return next;
		});
	}

	/** 返工重登：把现有产物归档为历史版本，再走一次 complete。 */
	async recomplete(id, projectId, fields = {}) {
		let prior;
		await this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (row.status !== "completed") throw new Error("仅已完成任务可重新登记；未完成任务请调用 complete");
			if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
			prior = row;
			const archivedAt = new Date().toISOString();
			const revision = (row.artifactHistory?.length || 0) + 1;
			const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
			const historyRoot = join(workspace.path, "characterization-history", id, `revision-${revision}`);
			await mkdir(historyRoot, { recursive: true });
			const historicArtifacts = {};
			for (const [slot, artifact] of Object.entries(row.artifacts ?? {})) {
				const source = await this.filePath(projectId, artifact.path);
				const target = join(historyRoot, `${slot}-${artifact.fileName}`);
				await cp(source, target, { force: false, errorOnExist: true });
				historicArtifacts[slot] = { ...artifact, path: target };
			}
			const history = [...(row.artifactHistory ?? []), { revision, archivedAt, artifacts: historicArtifacts, assessment: row.assessment }];
			await this.table.put(id, taskSchema.parse({ ...row, status: "running", artifactHistory: history, updatedAt: archivedAt }));
		});
		try {
			return await this.complete(id, projectId, fields);
		} catch (error) {
			await this.serial(id, async () => this.table.put(id, prior));
			throw error;
		}
	}

	/** 从采集参数推断核磁元数据（Varian procpar / Bruker acqus），只读。 */
	procparValue(text, key) {
		const lines = String(text).split(/\r?\n/);
		const index = lines.findIndex(line => line.startsWith(`${key} `));
		if (index < 0 || index + 1 >= lines.length) return undefined;
		const valueLine = lines[index + 1].trim().replace(/^\d+\s+/, "");
		const quoted = valueLine.match(/^"([\s\S]*?)"/);
		return quoted ? quoted[1] : valueLine.split(/\s+/)[0];
	}

	normalizeRunDate(value) {
		if (!value) return undefined;
		const compact = String(value).match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
		if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
		const timestamp = Number(value);
		if (Number.isFinite(timestamp) && timestamp > 1e8) return new Date(timestamp * 1000).toISOString().slice(0, 10);
		return undefined;
	}

	async inferNmrMetadata(datasetRoot, structurePath) {
		let nucleus, deuteratedSolvent, date;
		try {
			const procpar = await readFile(join(datasetRoot, "procpar"), "utf8");
			nucleus = this.procparValue(procpar, "tn");
			deuteratedSolvent = this.procparValue(procpar, "solvent");
			date = this.normalizeRunDate(this.procparValue(procpar, "time_run"));
		} catch {
			try {
				const acqus = await readFile(join(datasetRoot, "acqus"), "utf8");
				const value = key => acqus.match(new RegExp(`^##\\$${key}=\\s*(?:<([^>]+)>|([^\\r\\n]+))`, "m"))?.slice(1).find(Boolean)?.trim();
				nucleus = value("NUC1");
				deuteratedSolvent = value("SOLVENT");
				date = this.normalizeRunDate(value("DATE"));
			} catch { /* metadata stays optional */ }
		}
		let name;
		try {
			const firstLine = (await readFile(structurePath, "utf8")).split(/\r?\n/, 1)[0]?.trim();
			if (firstLine) name = firstLine;
		} catch { /* binary structure formats need Mnova */ }
		return { name, nucleus, deuteratedSolvent, date };
	}

	async remove(id, projectId, requestedKind, deleteFiles = [], mode = "record") {
		return this.serial(id, async () => {
			if (!["record", "outputs", "all"].includes(mode)) throw new Error("无效的删除操作");
			if (!Array.isArray(deleteFiles) || deleteFiles.some(slot => !["simulation", "spectrum", "report"].includes(slot))) throw new Error("无效的删除选项");
			const task = this.table.get(id);
			if (task && task.projectId !== projectId) throw new Error("任务不存在或不属于当前课题");
			const kind = task?.kind || requestedKind;
			if (kind !== "nmr") throw new Error("核磁插件只能删除核磁条目");
			const datasets = this.ctx.root?.get?.("labNmr");
			const linked = datasets?.listDatasets().find(row => row.id === id);
			if (linked && linked.projectId !== projectId) throw new Error("核磁记录不属于当前课题");
			if (!task && !linked) throw new Error("登记条目不存在或不属于当前课题");
			if (mode !== "record" && kind !== "nmr") throw new Error("该删除操作仅适用于核磁条目");
			if (mode === "outputs" && !deleteFiles.length) throw new Error("请至少选择一种产出文件");
			if (mode === "all") deleteFiles = ["simulation", "spectrum", "report"].filter(slot => slot === "simulation" ? task?.simulationArtifact : task?.artifacts?.[slot] || (task?.artifactHistory ?? []).some(entry => entry.artifacts?.[slot]));
			if (task && (["queued", "running"].includes(task.status) || ["queued", "running"].includes(task.simulationJob?.status))) throw new Error("任务正在运行，请等待结束或先停止分析");

			// 只删除已登记产物，绝不删除输入文件或整棵目录树；先校验再动手。
			const candidates = [];
			if (deleteFiles.includes("simulation") && task?.simulationArtifact) candidates.push({ slot: "simulation", artifact: task.simulationArtifact });
			for (const slot of ["spectrum", "report"]) {
				if (!deleteFiles.includes(slot)) continue;
				if (task?.artifacts?.[slot]) candidates.push({ slot, artifact: task.artifacts[slot] });
				for (const history of task?.artifactHistory ?? []) if (history.artifacts?.[slot]) candidates.push({ slot, artifact: history.artifacts[slot] });
			}
			for (const slot of deleteFiles) if (!candidates.some(candidate => candidate.slot === slot)) throw new Error("所选文件没有可校验的登记记录：" + slot);
			const workspace = deleteFiles.length || mode === "all" ? await this.ctx.ibmCore.ensureProjectWorkspace(projectId) : null;
			const key = value => process.platform === "win32" ? value.toLowerCase() : value;
			const protectedPaths = new Set();
			const isShared = value => [...protectedPaths].some(ref => {
				const target = key(value), sep = process.platform === "win32" ? "\\" : "/";
				return ref === target || ref.startsWith(target + sep) || target.startsWith(ref + sep);
			});
			const protect = async value => {
				if (!value) return;
				try { protectedPaths.add(key(await realpath(resolve(workspace.path, value)))); }
				catch (error) { if (error.code !== "ENOENT") throw error; }
			};
			if (workspace) {
				if (mode !== "all") for (const value of [task?.inputPath, task?.rawInputPath, task?.structurePath, linked?.fidPath, linked?.structurePath]) await protect(value);
				if (!deleteFiles.includes("simulation")) await protect(task?.simulationArtifact?.path);
				for (const slot of ["spectrum", "report"]) {
					if (deleteFiles.includes(slot)) continue;
					await protect(task?.artifacts?.[slot]?.path);
					await protect(linked?.[slot === "spectrum" ? "spectrumPath" : "reportPath"]);
					for (const history of task?.artifactHistory ?? []) await protect(history.artifacts?.[slot]?.path);
				}
				for (const other of this.list(projectId).filter(row => row.id !== id)) {
					for (const value of [other.inputPath, other.rawInputPath, other.structurePath, other.simulationArtifact?.path, ...Object.values(other.artifacts ?? {}).map(artifact => artifact.path), ...(other.artifactHistory ?? []).flatMap(history => Object.values(history.artifacts ?? {}).map(artifact => artifact.path))]) await protect(value);
				}
				for (const other of (datasets?.listDatasets() ?? []).filter(row => row.projectId === projectId && row.id !== id)) {
					for (const value of [other.fidPath, other.structurePath, other.spectrumPath, other.reportPath]) await protect(value);
				}
			}
			const files = [], seen = new Set(), missing = [];
			for (const { slot, artifact } of candidates) {
				let path;
				try { path = await this.filePath(projectId, artifact.path); }
				catch (error) { if (error.code === "ENOENT") { missing.push({ slot, fileName: artifact.fileName }); continue; } throw error; }
				if (isShared(path)) throw new Error(`文件被输入或其他条目使用，不能删除：${artifact.fileName}`);
				if (hash(await readFile(path)) !== artifact.sha256) throw new Error(`文件内容已改变，不能删除：${artifact.fileName}`);
				if (!seen.has(key(path))) { seen.add(key(path)); files.push({ slot, path, fileName: artifact.fileName }); }
			}
			const dirs = [];
			if (mode === "all") {
				const root = await realpath(workspace.path);
				const inside = value => { const rel = relative(root, value); return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel); };
				const collect = async (raw, slot) => {
					if (!raw) return;
					const absolute = resolve(root, raw);
					let info;
					try { info = await lstat(absolute); } catch (error) { if (error.code === "ENOENT") return; throw error; }
					if (info.isSymbolicLink()) throw new Error("原始文件包含符号链接，无法安全删除：" + basename(absolute));
					const value = await realpath(absolute);
					if (!inside(value)) throw new Error("删除路径必须位于当前课题内");
					if (isShared(value)) throw new Error("文件或目录被其他条目引用，不能删除：" + basename(value));
					if (info.isDirectory()) {
						for (const child of await readdir(value)) await collect(join(value, child), slot);
						dirs.push(value);
					} else if (info.isFile() && !seen.has(key(value))) { seen.add(key(value)); files.push({ slot, path: value, fileName: basename(value) }); }
				};
				for (const raw of [task?.inputPath, task?.rawInputPath, task?.structurePath, linked?.fidPath, linked?.structurePath]) await collect(raw, "input");
				if (!task) for (const raw of [linked?.spectrumPath, linked?.reportPath]) await collect(raw, "output");
				const simulationRoot = join(root, "nmr-simulations");
				let entries = [];
				try { entries = await readdir(simulationRoot); } catch (error) { if (error.code !== "ENOENT") throw error; }
				for (const entry of entries.filter(name => /^synthetic-[a-f0-9-]{36}$/.test(name))) {
					const folder = join(simulationRoot, entry);
					let model;
					try { model = JSON.parse(await readFile(await this.filePath(projectId, join(folder, "synthetic-model.json")), "utf8")); }
					catch (error) { if (error.code === "ENOENT") continue; throw error; }
					if (model.projectId === projectId && model.taskId === id && model.synthetic === true) await collect(folder, "simulation");
				}
			}
			const deleted = [];
			try {
				for (const file of files) { await unlink(file.path); deleted.push(file.fileName); }
				for (const dir of [...new Set(dirs)]) await rmdir(dir);
			} catch (error) {
				throw new Error(`删除文件失败，条目仍保留；已删除：${deleted.join("、") || "无"}。${error.message}`);
			}

			if (mode === "outputs") {
				if (task) {
					const artifacts = { ...task.artifacts };
					const history = (task.artifactHistory ?? []).map(item => { const entries = { ...item.artifacts }; for (const slot of deleteFiles) delete entries[slot]; return { ...item, artifacts: entries }; });
					for (const slot of deleteFiles) delete artifacts[slot];
					const next = taskSchema.parse({ ...task, artifacts, artifactHistory: history, ...(deleteFiles.includes("simulation") ? { simulationArtifact: undefined, simulationId: undefined, simulationJob: undefined } : {}), updatedAt: new Date().toISOString() });
					await this.table.put(id, next);
				}
				if (linked) await datasets.persist({ ...linked, ...(deleteFiles.includes("spectrum") ? { spectrumPath: undefined } : {}), ...(deleteFiles.includes("report") ? { reportPath: undefined } : {}) });
				return { id, kind, entryPreserved: true, deletedFiles: files.map(({ slot, fileName }) => ({ slot, fileName })), missingFiles: missing };
			}

			if (task) await this.table.delete(id);
			try {
				if (linked && datasets) await datasets.removeDataset(id, projectId);
			} catch (error) {
				if (task) await this.table.put(id, task);
				throw error;
			}
			return deleteFiles.length || mode === "all"
				? { id, kind, filesPreserved: files.length === 0, deletedFiles: files.map(({ slot, fileName }) => ({ slot, fileName })), missingFiles: missing }
				: { id, kind, filesPreserved: true };
		});
	}

	/** 开始分析：草稿直接排队；失败任务按"重试"处理。 */
	async startNmr(id, projectId) {
		const row = this.get(id, projectId);
		if (row.status === "failed") return this.retry(id, projectId);
		if (row.status !== "draft") throw new Error("仅待补全的核磁条目可启动分析");
		if (!row.inputPath || !row.structurePath) throw new Error("请同时提供核磁数据和目标结构");
		return this.submit({ ...row });
	}

	/** 重试失败任务：保留历史尝试记录，attempt+1，重新排队。 */
	async retry(id, projectId) {
		return this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (!["failed", "draft"].includes(row.status)) throw new Error("仅失败或待补全的任务可重试");
			const next = taskSchema.parse({
				...row, status: "queued", attempt: (row.attempt ?? 1) + 1, error: undefined,
				updatedAt: new Date().toISOString()
			});
			await this.table.put(id, next);
			return { task: next, prompt: taskPrompt(next) };
		});
	}

	/** 绑定分析会话：一个任务只能绑定自己课题的会话。 */
	async bindSession(id, projectId, attempt, sessionId) {
		return this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (row.attempt !== attempt) throw new Error("过期的任务尝试");
			if (!["queued", "running"].includes(row.status)) throw new Error("任务未在分析中");
			const sessions = this.ctx.ibmCore.getProjectSession(projectId)?.sessionIds ?? [];
			if (!sessionId || !sessions.includes(sessionId)) throw new Error("分析会话不属于当前课题");
			if (row.sessionId && row.sessionId !== sessionId) throw new Error("任务已绑定其他分析会话");
			if (this.list(projectId).some(other => other.id !== id && other.sessionId === sessionId)) throw new Error("每个分析任务必须使用独立对话");
			const next = taskSchema.parse({ ...row, sessionId, conversationSessionId: sessionId, updatedAt: new Date().toISOString() });
			await this.table.put(id, next);
			return next;
		});
	}

	/** 取消分析：只取消该任务绑定的会话，回到草稿并递增 attempt 作废迟到回调。 */
	async cancelNmr(id, projectId, attempt) {
		return this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (row.attempt !== attempt) throw new Error("过期的任务尝试");
			if (!["queued", "running"].includes(row.status)) return row;
			const agent = row.sessionId ? this.ctx.root?.get?.("agents")?.get(row.sessionId) : undefined;
			agent?.cancel({ kind: "user" });
			const next = taskSchema.parse({
				...row, status: "draft", attempt: row.attempt + 1,
				conversationSessionId: row.sessionId || row.conversationSessionId,
				sessionId: undefined, error: undefined, updatedAt: new Date().toISOString()
			});
			await this.table.put(id, next);
			return next;
		});
	}

	/**
	 * 完成登记：校验产物（.mnova 谱图 + .docx 报告），写回核磁数据集。
	 * 数据集服务仍属宿主（母包 labNmr）；插件经 root 取用，缺失时明确报不可用。
	 */
	async complete(id, projectId, fields = {}) {
		return this.serial(id, async () => {
			let row = this.get(id, projectId);
			if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
			if (row.status === "completed") return row;
			if (row.status === "draft") throw new Error("请先启动核磁分析");
			if (row.status === "failed") throw new Error("失败任务须先重试");
			if (!fields.assessment && !row.assessment) throw new Error("核磁完成登记必须包含 assessment：verdict、confidence 和 summary");
			row = taskSchema.parse({
				...row,
				compound: fields.compound ? { ...(row.compound ?? {}), ...fields.compound, name: fields.compound.name || row.compound?.name || row.title } : row.compound,
				nucleus: fields.nucleus || row.nucleus,
				deuteratedSolvent: fields.deuteratedSolvent || row.deuteratedSolvent,
				date: fields.date || row.date,
				assessment: fields.assessment || row.assessment
			});
			const artifacts = {};
			for (const [slot, [raw, extensions]] of Object.entries({ spectrum: [fields.spectrumPath, [".mnova"]], report: [fields.reportPath, [".docx"]] })) {
				if (!raw) throw new Error(`缺少 ${slot} 文件`);
				const path = await this.archiveArtifactInput(projectId, id, raw, slot);
				if (!extensions.includes(extname(path).toLowerCase())) throw new Error(`${slot} 文件格式不正确`);
				const info = await stat(path);
				if (!info.size || info.size > 256 * 1024 * 1024) throw new Error("产物为空或超过 256 MB");
				const buffer = await readFile(path);
				if (slot === "report") {
					const JSZip = (await import("jszip")).default;
					const zip = await JSZip.loadAsync(buffer);
					if (!zip.file("word/document.xml")) throw new Error("报告不是有效 Word 文档");
				}
				artifacts[slot] = { path, fileName: basename(path), byteLength: buffer.length, sha256: hash(buffer) };
			}
			const datasets = this.ctx.root?.get?.("labNmr");
			if (datasets === undefined) {
				const error = new Error("核磁数据集服务不可用，无法登记产物");
				error.code = "feature-unavailable";
				throw error;
			}
			let dataset = datasets.listDatasets().find(entry => entry.id === id);
			if (dataset && dataset.projectId !== row.projectId) throw new Error("核磁记录课题不匹配");
			if (!dataset) {
				dataset = await datasets.createDataset({
					id, projectId: row.projectId, name: row.title, fidPath: row.inputPath,
					structurePath: row.structurePath, compound: row.compound,
					nucleus: row.nucleus, deuteratedSolvent: row.deuteratedSolvent, date: row.date
				});
			}
			await datasets.persist({ ...dataset, taskId: id, date: row.date, spectrumPath: artifacts.spectrum.path, reportPath: artifacts.report.path, assessment: row.assessment });
			const next = taskSchema.parse({ ...row, status: "completed", artifacts, error: undefined, updatedAt: new Date().toISOString() });
			await this.table.put(id, next);
			return next;
		});
	}

	async archiveArtifactInput(projectId, taskId, raw, label) {
		try {
			return await this.filePath(projectId, raw);
		} catch (error) {
			if (!String(error?.message).includes("当前课题工作目录")) throw error;
			const imported = await this.importExternalPath(projectId, taskId, raw, `artifact-${label}`);
			return this.filePath(projectId, imported);
		}
	}

	/** 外部输入准入：只接受课题目录、Mnova 工作区或显式配置的目录。 */
	async importExternalPath(projectId, taskId, sourcePath, label) {
		const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
		const workspaceRoot = await realpath(workspace.path);
		const source = await realpath(resolve(sourcePath));
		if (this.pathInside(workspaceRoot, source)) return source;
		const configured = Array.isArray(this.config.allowedImportRoots) ? this.config.allowedImportRoots : [];
		const candidates = [
			process.env.IBM_LAB_MNOVA_WORKSPACE,
			process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "iBM-Lab-Agent") : undefined,
			process.env.USERPROFILE ? join(process.env.USERPROFILE, ".codex", "attachments") : undefined,
			...configured
		].filter(Boolean);
		let allowed = false;
		for (const candidate of candidates) {
			try { if (this.pathInside(await realpath(candidate), source)) { allowed = true; break; } }
			catch { /* optional root is absent */ }
		}
		if (!allowed) throw new Error("外部输入必须来自 iBM Lab/Codex 附件目录；请先作为会话附件上传");
		const info = await stat(source);
		const fingerprint = hash(Buffer.from(`${source}\0${info.size}\0${info.mtimeMs}`)).slice(0, 12);
		const destination = join(workspaceRoot, "imports", taskId, `${label}-${fingerprint}-${basename(source)}`);
		try { await stat(destination); return destination; } catch { /* first import */ }
		await mkdir(dirname(destination), { recursive: true });
		await cp(source, destination, { recursive: info.isDirectory(), errorOnExist: true, force: false });
		return destination;
	}

	/** 读取已登记产物（谱图 / 报告）。 */
	async artifactFile(id, projectId, slot) {
		const row = this.get(id, projectId);
		const artifact = row.artifacts?.[slot];
		if (!artifact) throw new Error("文件尚未就绪");
		const path = await this.filePath(row.projectId, artifact.path);
		const buffer = await readFile(path);
		const extensions = slot === "spectrum" ? [".mnova"] : [".docx"];
		if (!extensions.includes(extname(path).toLowerCase())) throw new Error("文件格式不正确");
		if (!buffer.length || buffer.length > 256 * 1024 * 1024) throw new Error("产物为空或超过 256 MB");
		return { buffer, fileName: basename(path), byteLength: buffer.length, sha256: hash(buffer), mime: slot === "report" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream" };
	}

	// ── 结构来源 / 文件定位（nmr-intake 移入插件后的薄包装） ──────────────
	nmrStructureSource(id, projectId) { return nmrStructureSource(this, id, projectId); }

	nmrOpenPath(id, projectId, slot) { return nmrOpenPath(this, id, projectId, slot); }

	nmrFolderPath(id, projectId) { return nmrFolderPath(this, id, projectId); }

	/** FID 目录 / ZIP 物化：解压到课题 nmr-inputs 并找到真正的数据集根。 */
	async materializeNmrInput(projectId, taskId, inputPath) {
		const info = await stat(inputPath);
		if (info.isDirectory()) {
			const root = await this.findNmrDatasetRoot(inputPath);
			if (!root) throw new Error("FID 目录缺少 fid+procpar（Varian/Agilent）或 fid/ser+acqus（Bruker）");
			return root;
		}
		const extension = extname(inputPath).toLowerCase();
		if (NMR_DATA_EXTENSIONS.has(extension) && extension !== ".zip") {
			if (!info.size) throw new Error("核磁数据文件为空");
			return inputPath;
		}
		if (extension !== ".zip") throw new Error("核磁原始数据必须是 FID 目录或包含 FID 目录的 ZIP 文件");
		const zipBuffer = await readFile(inputPath);
		const JSZip = (await import("jszip")).default;
		const zip = await JSZip.loadAsync(zipBuffer);
		const entries = Object.values(zip.files);
		if (!entries.length || entries.length > 5000) throw new Error("FID ZIP 为空或文件数量过多");
		const digest = hash(zipBuffer).slice(0, 12);
		const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
		const outputRoot = join(workspace.path, "nmr-inputs", `${taskId}-${digest}`);
		await mkdir(outputRoot, { recursive: true });
		let total = 0;
		for (const entry of entries) {
			const normalized = entry.name.replaceAll("\\", "/");
			const parts = normalized.split("/").filter(Boolean);
			if (!parts.length || normalized.startsWith("/") || parts.some(part => part === ".." || part.includes(":"))) throw new Error("FID ZIP 含有不安全路径");
			const target = join(outputRoot, ...parts);
			const rel = relative(outputRoot, target);
			if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("FID ZIP 含有越界路径");
			if (entry.dir) { await mkdir(target, { recursive: true }); continue; }
			const buffer = await entry.async("nodebuffer");
			total += buffer.length;
			if (buffer.length > 256 * 1024 * 1024 || total > 512 * 1024 * 1024) throw new Error("解压后的 FID 数据超过 512 MB");
			await mkdir(resolve(target, ".."), { recursive: true });
			try { await writeFile(target, buffer, { flag: "wx" }); }
			catch (error) { if (error?.code !== "EEXIST") throw error; }
		}
		const root = await this.findNmrDatasetRoot(outputRoot);
		if (!root) throw new Error("ZIP 中未找到可识别的 FID 目录（需要 fid+procpar 或 fid/ser+acqus）");
		return root;
	}

	// ── 模拟谱：峰模型由科研助手构建，脚本只负责渲染与登记 ────────────────
	simulateNmr(fields) { return createNmrSimulation(this, fields); }

	async simulationStructure(projectId, taskId, jobId) {
		const row = this.get(taskId, projectId);
		if (!row.simulationJob || row.simulationJob.id !== jobId || !["queued", "failed"].includes(row.simulationJob.status)) throw new Error("模拟任务不存在或状态不允许读取");
		const { result } = await simulationStructure(this, { projectId, taskId, parameters: row.simulationJob.parameters });
		return result;
	}

	registerSimulationMnova(projectId, taskId, result, path) { return registerSimulationMnova(this, projectId, taskId, result, path); }

	listNmrSimulations(projectId) { return listNmrSimulations(this, projectId); }

	async startSimulation(projectId, taskId, parameters) {
		return this.serial(taskId, async () => {
			const row = this.get(taskId, projectId);
			if (!row.structurePath) throw new Error("请先提供分子结构");
			if (["queued", "running"].includes(row.simulationJob?.status)) throw new Error("该条目的模拟任务正在运行");
			const old = row.simulationJob;
			const history = old?.status === "failed" ? [...(old.history ?? []), { attempt: old.attempt || 1, error: old.error || "任务失败", retriedAt: new Date().toISOString() }] : old?.history;
			const job = { id: randomUUID(), status: "queued", attempt: 1, parameters: simulationParameters(parameters), history };
			await this.table.put(taskId, taskSchema.parse({ ...row, simulationJob: job, updatedAt: new Date().toISOString() }));
			return {
				job,
				prompt: `请执行核磁模拟任务。先调用 lab_nmr_simulation_structure（projectId=${projectId}，taskId=${taskId}，jobId=${job.id}），读取结构和可区分的原子环境。使用 nmr-analyze-simulate 技能，基于分子结构、化学位移规律、可核实的文献或用户明确提供的峰数据建立峰模型；尽可能覆盖所有符合设置的原子环境，对缺少精确数据的位点给出合理近似，并在 evidence 中说明是估计及其不确定性。不要调用旧自动预测器，不要将估计当作实测或伪造来源。每个可建模环境提供 environmentId、ppm、multiplicity（s/d/t/q/dd/quintet/sextet/septet）、jHz 和 evidence；dd 需额外提供 extraJHz，s 的 jHz 为 0。随后调用 lab_nmr_simulation_run，传入同一 projectId、taskId、jobId 和 peakModel（包含 provenance 与 peaks）。工具负责运行技能脚本生成合成 FID、在 Mnova 标峰并登记。若结构与现有实测谱相同，未经用户明确要求不得用实测峰冒充结构预测。结果标明模拟与峰模型依据；失败时如实报告。`
			};
		});
	}

	async updateSimulation(projectId, taskId, jobId, status, error, assignmentSummary) {
		return this.serial(taskId, async () => {
			const row = this.get(taskId, projectId), job = row.simulationJob;
			if (!job || job.id !== jobId) throw new Error("模拟任务已过期");
			if ((status === "running" && !["queued", "failed"].includes(job.status)) || (status !== "running" && job.status !== "running")) throw new Error("模拟任务状态不允许此操作");
			const attempt = (job.attempt || 1) + (status === "running" && job.status === "failed" ? 1 : 0);
			const history = status === "running" && job.status === "failed"
				? [...(job.history ?? []), { attempt: job.attempt || 1, error: job.error || "任务失败", retriedAt: new Date().toISOString() }]
				: job.history;
			const next = taskSchema.parse({
				...row,
				simulationJob: {
					...job, status, attempt, history,
					error: error ? String(error).slice(0, 1000) : undefined,
					...(assignmentSummary ? { assignmentSummary } : status === "running" ? { assignmentSummary: undefined } : {})
				},
				updatedAt: new Date().toISOString()
			});
			await this.table.put(taskId, next);
			return next;
		});
	}

	async simulationDispatchFailed(projectId, taskId, jobId, error) {
		return this.serial(taskId, async () => {
			const row = this.get(taskId, projectId), job = row.simulationJob;
			if (!job || job.id !== jobId || job.status !== "queued") return row;
			const next = taskSchema.parse({ ...row, simulationJob: { ...job, status: "failed", error: String(error || "任务派发失败").slice(0, 1000) }, updatedAt: new Date().toISOString() });
			await this.table.put(taskId, next);
			return next;
		});
	}

	/**
	 * 执行模拟：峰模型 → 合成 FID → Mnova 标峰 → 登记 .mnova。
	 * 运行时（Mnova 桥）来自宿主 `ibmRuntime`，插件不自己实现外部进程管理。
	 */
	async simulateNmr(input = {}) {
		const runtime = this.ctx.root?.get?.("ibmRuntime");
		if (runtime === undefined) {
			const error = new Error("运行环境服务不可用，无法执行核磁模拟");
			error.code = "feature-unavailable";
			throw error;
		}
		const result = await createNmrSimulation(this, input);
		if (!input.taskId) return result;
		const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(input.projectId);
		const directory = join(workspace.path, "nmr-simulations", result.id);
		const parameters = result.parameters;
		const model = {
			experiment: {
				title: "SIMULATED NMR - " + result.formula, nucleus: parameters.nucleus, solvent: parameters.solvent,
				obs_mhz: parameters.frequencyMHz, carrier_ppm: (result.spectrum.high + result.spectrum.low) / 2,
				spectral_width_hz: (result.spectrum.high - result.spectrum.low) * parameters.frequencyMHz,
				complex_points: 16384, scale: 10000, noise_std: 0, seed: 20261102, nt: parameters.scans, d1_s: 1
			},
			peaks: result.peaks.flatMap(peak => peak.multiplicity === "dd"
				? peak.offsetsHz.map((offset, index) => ({ label: peak.label + "-" + (index + 1), ppm: peak.ppm + offset / parameters.frequencyMHz, area: peak.area / peak.offsetsHz.length, linewidth_hz: parameters.linewidthHz, multiplicity: "s", evidence: peak.evidence }))
				: [{ label: peak.label, ppm: peak.ppm, area: peak.area, linewidth_hz: parameters.linewidthHz, multiplicity: peak.multiplicity, j_hz: peak.jHz, evidence: peak.evidence }])
		};
		await writeFile(join(directory, "synthetic-fid-model.json"), JSON.stringify(model, null, 2));
		const fid = await runtime.syntheticNmrFid(join(directory, "synthetic-fid-model.json"), join(directory, "synthetic-fid"));
		const prepared = await runtime.mnova(input.projectId, "mnova_prepare_structure_1d", { input_path: fid.fidPath, structure_path: join(directory, "synthetic-structure.mol"), run_verification: false });
		if (!prepared?.artifacts?.mnova) throw new Error("Mnova 未生成模拟谱和结构文档");
		const plan = syntheticAssignmentPlan(result, prepared);
		const planPath = join(directory, "synthetic-assignment-plan.json");
		plan.source_analysis_path = prepared.artifacts.analysis_json;
		await writeFile(planPath, JSON.stringify(plan, null, 2));
		if (plan.unmatchedEnvironments.length) throw new Error("Mnova 未能唯一对应全部模拟峰与氢位点；已保留合成 FID 和准备文件供检查，未登记标峰文件");
		const output = await runtime.mnova(input.projectId, "mnova_apply_assignments_1d", { prepared_mnova_path: prepared.artifacts.mnova, assignment_plan_path: planPath, run_verification: false });
		if (!output?.artifacts?.mnova || output.applied_assignment_count !== plan.assignments.length || !Array.isArray(output.display_labels?.spectrum) || output.display_labels.spectrum.length !== new Set(plan.assignments.map(a => a.multiplet_uuid)).size || output.display_labels.spectrum.some(label => label.status === "not_drawn")) throw new Error("Mnova 未完成模拟谱标峰，请检查标峰结果");
		if (plan.unresolved.length || plan.unmatchedEnvironments.length) result.warnings.push(`${plan.unresolved.length} 个模拟峰及 ${plan.unmatchedEnvironments.length} 个位点未能唯一匹配，未强行标注。`);
		result.assignmentSummary = { assigned: plan.assignments.length, unresolved: plan.unresolved.length, unmatched: plan.unmatchedEnvironments.length + result.unresolved.length };
		result.syntheticFidArchive = join(directory, "synthetic-fid", "synthetic_1d_varian_fid.zip");
		const syntheticDocument = join(workspace.path, "nmr-simulations", result.id, "synthetic.mnova");
		await cp(output.artifacts.mnova, syntheticDocument);
		result.mnovaArtifact = await this.registerSimulationMnova(input.projectId, input.taskId, result, syntheticDocument);
		return result;
	}

	/** 模拟任务运行：标记 running → 执行 → 回填摘要（失败则记录原因）。 */
	async runSimulation(projectId, taskId, jobId, peakModel) {
		if (!peakModel?.peaks?.length) throw new Error("请先根据结构构建带依据的峰模型，旧自动预测器已停用");
		const task = await this.updateSimulation(projectId, taskId, jobId, "running");
		try {
			const result = await this.simulateNmr({ projectId, taskId, parameters: task.simulationJob.parameters, peakModel });
			await this.updateSimulation(projectId, taskId, jobId, "completed", undefined, result.assignmentSummary);
			return result;
		} catch (error) {
			await this.updateSimulation(projectId, taskId, jobId, "failed", error.message);
			throw error;
		}
	}

	/** 仅供测试/诊断：当前域内任务数。 */
	async count(projectId) {
		return this.list(projectId).length;
	}

	newId() {
		return "nmr-" + randomUUID();
	}
}

export default LabNmrTasksService;
