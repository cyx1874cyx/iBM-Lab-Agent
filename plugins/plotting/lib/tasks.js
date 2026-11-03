/**
 * 科研绘图子插件：任务服务（自有域 `lab_plot.tasks`）。
 *
 * 只依赖公开导出（task schema / 历史域定义）与宿主服务；不 import 母包
 * characterization 或核磁实现。任务与记录分离：任务描述"要画什么"，
 * 记录（lab_plot_records）描述"画成了什么"，后者仍由宿主记录服务持有。
 */
import { Service } from "@deepseek-ai/cordis";
import { readFile, stat, mkdir, cp, unlink, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { taskSchema, taskPrompt } from "dsh-lab-agent/characterization-schema";
import { plotTaskDomain } from "./domain.js";

const hash = buffer => createHash("sha256").update(buffer).digest("hex");

export class LabPlotTasksService extends Service {
	static inject = ["storageDomain", "ibmCore"];

	constructor(ctx, config = {}) {
		super(ctx, "labPlotTasks");
		this.config = config ?? {};
		this.locks = new Map();
	}

	async [Service.init]() {
		this.domain = await this.ctx.storageDomain.open(plotTaskDomain);
		this.table = this.domain.table("tasks");
		this.ctx.effect(() => () => this.domain.close(), "lab-plot-tasks.close");
		// 历史数据由母插件 characterization 持有；后台拉取（Cordis ctx.get 隔离，需 root）。
		void this.migrateWhenReady();
	}

	async migrateWhenReady() {
		for (let attempt = 0; attempt < 30; attempt += 1) {
			const legacy = this.ctx.root?.get?.("labCharacterization");
			if (typeof legacy?.allTasks === "function") {
				try {
					await this.importLegacyRows(legacy.allTasks());
				} catch (error) {
					this.ctx.logger?.warn?.(`labPlot: legacy import failed (${error.code ?? error.message})`);
				}
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		this.ctx.logger?.warn?.("labPlot: legacy owner not found; run the one-shot migration script");
	}

	/** 保留给一次性迁移脚本/诊断。 */
	async migrateLegacy() {
		const legacyService = this.ctx.root?.get?.("labCharacterization");
		if (typeof legacyService?.allTasks !== "function") return 0;
		return this.importLegacyRows(legacyService.allTasks());
	}

	async importLegacyRows(rows = []) {
		let moved = 0;
		for (const row of rows) {
			if (row?.kind !== "plot") continue;
			if (this.table.get(row.id) !== undefined) continue;
			await this.table.put(row.id, row);
			moved += 1;
		}
		if (moved > 0) this.ctx.logger?.info?.(`labPlot: migrated ${moved} legacy task(s)`);
		return moved;
	}

	serial(id, work) {
		const prior = this.locks.get(id) ?? Promise.resolve();
		const next = prior.catch(() => {}).then(work);
		this.locks.set(id, next);
		return next.finally(() => { if (this.locks.get(id) === next) this.locks.delete(id); });
	}

	list(projectId) {
		return [...this.table.keys()].map(key => this.table.get(key))
			.filter(row => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	get(id, projectId) {
		const row = this.table.get(id);
		if (!row || (projectId && row.projectId !== projectId)) throw new Error("任务不存在或不属于当前课题");
		if (row.kind !== "plot") throw new Error("该任务不是绘图任务");
		return row;
	}

	/** 新建绘图任务（绘图必须先有输入数据表，因此没有 draft 状态）。 */
	async create(fields = {}) {
		if (!fields.inputPath) throw new Error("请先提供绘图数据文件");
		const now = new Date().toISOString();
		const id = String(fields.id ?? "").trim() || `plot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return this.serial(id, async () => {
			if (!this.ctx.ibmCore.getProject(fields.projectId)) throw new Error("课题不存在");
			if (this.table.get(id) !== undefined) throw new Error("任务编号已存在");
			const row = taskSchema.parse({
				id, projectId: fields.projectId, kind: "plot",
				title: fields.title?.trim() || "科研绘图",
				date: fields.date || now.slice(0, 10),
				inputPath: fields.inputPath,
				instructions: fields.instructions?.trim() || "根据输入数据绘制科研图，保存可编辑的 Origin 项目并与绘图记录关联。",
				status: "queued", attempt: 1, createdAt: now, updatedAt: now
			});
			await this.table.put(row.id, row);
			return { task: row, prompt: taskPrompt(row) };
		});
	}

	async update(id, projectId, attempt, status, error) {
		return this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (row.attempt !== attempt) throw new Error("过期的任务尝试");
			const next = taskSchema.parse({ ...row, status, error: error ? String(error).slice(0, 1000) : undefined, updatedAt: new Date().toISOString() });
			await this.table.put(id, next);
			return next;
		});
	}

	/** 该任务是否由本插件持有（远程接口按行归属选服务）。 */
	has(id) {
		return id !== undefined && this.table.get(id) !== undefined;
	}

	async start(id, projectId) {
		const row = this.get(id, projectId);
		if (row.status === "failed") return this.retry(id, projectId);
		if (row.status !== "queued") throw new Error("仅排队中的绘图任务可启动");
		return { task: row, prompt: taskPrompt(row) };
	}

	async retry(id, projectId) {
		return this.serial(id, async () => {
			const row = this.get(id, projectId);
			if (!["failed", "queued"].includes(row.status)) throw new Error("仅失败或排队中的绘图任务可重试");
			const next = taskSchema.parse({ ...row, status: "queued", attempt: (row.attempt ?? 1) + 1, error: undefined, updatedAt: new Date().toISOString() });
			await this.table.put(id, next);
			return { task: next, prompt: taskPrompt(next) };
		});
	}

	/**
	 * 完成登记：校验并归档可编辑 Origin 工程（.opju/.opj），写回绘图记录。
	 * 记录服务仍属宿主（母包 labPlotRecords）；缺失时明确报不可用。
	 */
	async complete(id, projectId, fields = {}) {
		return this.serial(id, async () => {
			let row = this.get(id, projectId);
			if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
			if (row.status === "completed") return row;
			if (row.status === "failed") throw new Error("失败任务须先重试");
			if (!fields.originPath) throw new Error("缺少 origin 文件");
			const path = await this.archiveArtifactInput(projectId, id, fields.originPath, "origin");
			if (![".opju", ".opj"].includes(extname(path).toLowerCase())) throw new Error("origin 文件格式不正确");
			const info = await stat(path);
			if (!info.size || info.size > 256 * 1024 * 1024) throw new Error("产物为空或超过 256 MB");
			const buffer = await readFile(path);
			const artifacts = { origin: { path, fileName: basename(path), byteLength: buffer.length, sha256: hash(buffer) } };
			const records = this.ctx.root?.get?.("labPlotRecords");
			if (records === undefined) {
				const error = new Error("绘图记录服务不可用，无法登记产物");
				error.code = "feature-unavailable";
				throw error;
			}
			const existing = await records.get(id);
			if (existing && existing.projectId !== row.projectId) throw new Error("绘图记录课题不匹配");
			const recordFields = { taskId: id, artifactPath: artifacts.origin.path };
			if (existing) await records.update(id, recordFields);
			else await records.create({ id, projectId: row.projectId, topic: row.title, date: row.date, source: "agent", ...recordFields });
			const next = taskSchema.parse({ ...row, status: "completed", artifacts, error: undefined, updatedAt: new Date().toISOString() });
			await this.table.put(id, next);
			return next;
		});
	}

	async archiveArtifactInput(projectId, taskId, raw, label) {
		try {
			return await this.filePath(projectId, raw);
		} catch (error) {
			if (!String(error?.message).includes("当前工作目录")) throw error;
			const imported = await this.importExternalPath(projectId, taskId, raw, `artifact-${label}`);
			return this.filePath(projectId, imported);
		}
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

	/** 外部输入准入：只接受课题目录或显式配置的目录。 */
	async importExternalPath(projectId, taskId, sourcePath, label) {
		const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
		const workspaceRoot = await realpath(workspace.path);
		const source = await realpath(resolve(sourcePath));
		const inside = (root, value) => {
			const rel = relative(root, value);
			return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
		};
		if (inside(workspaceRoot, source)) return source;
		const configured = Array.isArray(this.config.allowedImportRoots) ? this.config.allowedImportRoots : [];
		let allowed = false;
		for (const candidate of configured) {
			try { if (inside(await realpath(candidate), source)) { allowed = true; break; } } catch { /* optional root */ }
		}
		if (!allowed) throw new Error("外部输入必须位于课题目录或已配置的导入根目录");
		const info = await stat(source);
		const fingerprint = hash(Buffer.from(`${source}\0${info.size}\0${info.mtimeMs}`)).slice(0, 12);
		const destination = join(workspaceRoot, "imports", taskId, `${label}-${fingerprint}-${basename(source)}`);
		await mkdir(dirname(destination), { recursive: true });
		await cp(source, destination, { recursive: info.isDirectory(), errorOnExist: true, force: false });
		return destination;
	}

	async artifactFile(id, projectId, slot) {
		const row = this.get(id, projectId);
		const artifact = row.artifacts?.[slot];
		if (!artifact) throw new Error("文件尚未就绪");
		const path = await this.filePath(row.projectId, artifact.path);
		if (extname(path).toLowerCase() !== ".opju" && extname(path).toLowerCase() !== ".opj") throw new Error("文件格式不正确");
		const buffer = await readFile(path);
		if (!buffer.length || buffer.length > 256 * 1024 * 1024) throw new Error("产物为空或超过 256 MB");
		return { buffer, fileName: basename(path), byteLength: buffer.length, sha256: hash(buffer), mime: "application/octet-stream" };
	}

	async remove(id, projectId, requestedKind, deleteFiles = [], mode = "record") {
		return this.serial(id, async () => {
			if (!["record", "outputs", "all"].includes(mode)) throw new Error("无效的删除操作");
			const task = this.table.get(id);
			if (task && task.projectId !== projectId) throw new Error("任务不存在或不属于当前课题");
			const kind = task?.kind || requestedKind;
			if (kind !== "plot") throw new Error("绘图插件只能删除绘图条目");
			const records = this.ctx.root?.get?.("labPlotRecords");
			const linked = await records?.get?.(id);
			if (linked && linked.projectId !== projectId) throw new Error("绘图记录不属于当前课题");
			if (!task && !linked) throw new Error("登记条目不存在或不属于当前课题");
			if (task && ["queued", "running"].includes(task.status)) throw new Error("任务正在运行，请先停止");
			if (mode !== "record") {
				const artifact = task?.artifacts?.origin;
				if (!artifact) throw new Error("所选文件没有可校验的登记记录：origin");
				const path = await this.filePath(projectId, artifact.path);
				if (hash(await readFile(path)) !== artifact.sha256) throw new Error("文件内容已改变，不能删除：" + artifact.fileName);
				await unlink(path);
				if (mode === "outputs") {
					await this.table.put(id, taskSchema.parse({ ...task, artifacts: {}, updatedAt: new Date().toISOString() }));
					if (linked) await records.update(id, { artifactPath: undefined });
					return { id, kind, entryPreserved: true, deletedFiles: [{ slot: "origin", fileName: artifact.fileName }], missingFiles: [] };
				}
			}
			if (task) await this.table.delete(id);
			if (linked) await records.remove(id);
			return { id, kind, filesPreserved: mode === "record" };
		});
	}
}

export default LabPlotTasksService;
