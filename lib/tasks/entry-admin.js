/**
 * dsh-lab-agent / labTasks — 文献条目管理：重命名（搬家）、产物重新提交、删除条目。
 *
 * 命名规范见 lib/entry-layout.js。这里处理的是**已存在条目**的生命周期：
 *
 *   * setEntryNaming(mode="freeze")：补/改命名段；条目尚未固化时按新命名固化。
 *   * setEntryNaming(mode="apply") ：按当前命名重算 stem，把条目目录整体搬到新目录，
 *     并同步改写所有落在该目录下的产物路径（正文/SI/报告/PPT/契约）。
 *   * resubmitBundleFile / resubmitReport / resubmitPresentation：覆盖式重新提交。
 *   * deleteBundle：删除条目及其产物目录与子行。
 *
 * 搬家与删除都是破坏性操作，规则固定为：
 *   1. 先复制到新位置、全部成功后才删旧目录；
 *   2. DB 路径改写完成后才删旧目录；
 *   3. 任何一步失败都保留旧目录，并把已复制的新目录清掉（不留半成品）。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
	buildEntryStem,
	entryFileName,
	literatureEntryLayout,
	mergeEntryNaming,
	missingEntryNamingFields,
	siStemOf
} from "../entry-layout.js";
import { paperSourceBundleSchema, presentationRunSchema, readingReportSchema } from "../../src/task-models.js";
import { atomicWrite, isPathInside } from "./shared.js";
import {officePdf} from './office-pdf.js';

/** 落在条目目录下、需要在搬家时改写的字符串字段。 */
const ENTRY_PATH_FIELDS = {
	bundles: ["pdfPath", "siPath", "paperMdPath", "sourceMapPath", "translationNotesPath", "figuresDir", "entryDir"],
	reports: ["paperCardPath", "docxPath", "previewPdfPath", "auditReportPath"],
	presentations: ["outlinePath", "pptxPath", "previewPdfPath", "speechNotesPath", "figureSourcesPath", "contractPath", "conformancePath"]
};

/** 目录内文件名随 stem 变化：SI 用（可能被缩短的）siStem，其余用 stem 前缀。 */
function renameForNewStem(fileName, oldStem, newStem) {
	const oldSi = siStemOf(oldStem);
	const newSi = siStemOf(newStem);
	if (oldSi !== oldStem && fileName.startsWith(`${oldSi} `)) return `${newSi}${fileName.slice(oldSi.length)}`;
	if (fileName.startsWith(oldStem)) return `${newStem}${fileName.slice(oldStem.length)}`;
	return fileName;
}

/** 把一个绝对路径从旧条目目录改写到新条目目录（含文件名前缀改名）。 */
function rebaseEntryPath(value, oldDir, newDir, oldStem, newStem) {
	if (typeof value !== "string" || value.length === 0) return value;
	if (!isPathInside(oldDir, value)) return value;
	const relative = value.slice(oldDir.length).replace(/^[\\/]+/, "");
	const parts = relative.split(/[\\/]+/);
	const renamed = parts.map((part) => renameForNewStem(part, oldStem, newStem)).join("/");
	return join(newDir, ...renamed.split("/"));
}


/** 某 bundle 下的全部 PPT run（presentations 表按 reportId 关联，没有 bundleId 索引）。 */
function presentationsOfBundle(tasks, reports) {
	const rows = [];
	for (const report of reports) rows.push(...tasks.listPresentationsForReport(report.id));
	return rows;
}

export const entryAdminMethods = {

	/**
	 * setEntryNaming：补/改命名段。
	 *
	 * mode="freeze"（默认）：只写命名；条目尚未固化（无 entryStem/entryDir）时按新命名固化。
	 * mode="apply"：按当前命名重算 stem，把条目目录搬到新目录并改写产物路径。
	 *
	 * apply 是破坏性操作，但先复制后删源、DB 全部改写成功后才删旧目录。
	 */
	async setEntryNaming({ projectId, bundleId, naming, mode = "freeze" }) {
		if (!["freeze", "apply"].includes(mode)) throw new Error(`mode must be freeze or apply, got '${mode}'`);
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		const now = new Date().toISOString();
		const mergedNaming = mergeEntryNaming(bundle.naming, naming);
		const reports = this.listReadingReports(projectId).filter((row) => row.bundleId === bundleId);
		const report = reports.at(-1);
		const workspace = await this.ensureProjectWorkspace(projectId);

		if (mode === "freeze") {
			const next = paperSourceBundleSchema.parse({ ...bundle, naming: mergedNaming, updatedAt: now });
			if (!next.entryStem || !next.entryDir) {
				const layout = literatureEntryLayout(workspace.path, { ...next, entryStem: undefined, entryDir: undefined }, report);
				const persisted = paperSourceBundleSchema.parse({
					...next,
					entryStem: layout.entryStem,
					entryDir: layout.entryDir,
					updatedAt: now
				});
				await this.ctx.ibmCore.commitSourceBundle(persisted);
				return { bundle: persisted, moved: [], missingNaming: missingEntryNamingFields(persisted, report) };
			}
			await this.ctx.ibmCore.commitSourceBundle(next);
			return { bundle: next, moved: [], missingNaming: missingEntryNamingFields(next, report) };
		}

		// apply：重算 stem（忽略已固化值），必要时搬家。
		const layout = literatureEntryLayout(workspace.path, { ...bundle, ...(mergedNaming ? { naming: mergedNaming } : {}), entryStem: undefined, entryDir: undefined }, report);
		const oldStem = bundle.entryStem;
		const oldDir = bundle.entryDir;
		const moved = [];
		if (!oldDir || !oldStem || layout.entryStem === oldStem) {
			// 没有既有目录（或名字没变）：只更新命名与固化值。
			const persisted = paperSourceBundleSchema.parse({
				...bundle,
				naming: mergedNaming,
				entryStem: layout.entryStem,
				entryDir: layout.entryDir,
				updatedAt: now
			});
			await this.ctx.ibmCore.commitSourceBundle(persisted);
			return { bundle: persisted, moved, missingNaming: missingEntryNamingFields(persisted, report) };
		}

		const newDir = layout.entryDir;
		const targetExists = existsSync(newDir);
		if (targetExists) throw new Error(`target entry directory already exists: ${newDir}`);
		if (existsSync(oldDir)) {
			await mkdir(newDir, { recursive: true });
			try {
				for (const entry of await readdir(oldDir, { withFileTypes: true })) {
					if (!entry.isFile()) continue;
					const newName = renameForNewStem(entry.name, oldStem, layout.entryStem);
					await copyFile(join(oldDir, entry.name), join(newDir, newName));
					moved.push({ from: join(oldDir, entry.name), to: join(newDir, newName) });
				}
			} catch (error) {
				await rm(newDir, { recursive: true, force: true });
				throw error;
			}
		} else {
			await mkdir(newDir, { recursive: true });
		}

		// DB 改写：任一行失败就回滚新目录，旧目录保持原样。
		const patched = [];
		try {
			const persisted = paperSourceBundleSchema.parse({
				...bundle,
				naming: mergedNaming,
				entryStem: layout.entryStem,
				entryDir: newDir,
				updatedAt: now
			});
			const nextBundle = {
				...persisted,
				...Object.fromEntries(ENTRY_PATH_FIELDS.bundles
					.filter((field) => field !== "entryDir")
					.map((field) => [field, rebaseEntryPath(persisted[field], oldDir, newDir, oldStem, layout.entryStem)])
					.filter(([, value]) => value !== undefined))
			};
			patched.push(["bundles", bundleId, nextBundle]);
			for (const row of reports) {
				patched.push(["reports", row.id, readingReportSchema.parse({
					...row,
					...Object.fromEntries(ENTRY_PATH_FIELDS.reports
						.map((field) => [field, rebaseEntryPath(row[field], oldDir, newDir, oldStem, layout.entryStem)])
						.filter(([, value]) => value !== undefined))
				})]);
			}
			for (const row of presentationsOfBundle(this, reports)) {
				patched.push(["presentations", row.id, presentationRunSchema.parse({
					...row,
					...Object.fromEntries(ENTRY_PATH_FIELDS.presentations
						.map((field) => [field, rebaseEntryPath(row[field], oldDir, newDir, oldStem, layout.entryStem)])
						.filter(([, value]) => value !== undefined))
				})]);
			}
			for (const [table, id, row] of patched) await this.table(table).put(id, row);
		} catch (error) {
			await rm(newDir, { recursive: true, force: true });
			throw error;
		}
		if (existsSync(oldDir)) await rm(oldDir, { recursive: true, force: true });
		const finalBundle = this.table("bundles").get(bundleId);
		return { bundle: finalBundle, moved, missingNaming: missingEntryNamingFields(finalBundle, report) };
	},


	/**
	 * resubmitBundleFile：重新提交正文或 SI。
	 *
	 * 与首次登记的区别：不新建条目、不换目录，直接在**同一**条目目录里覆盖同名产物，
	 * 并刷新 hashCode；旧文件若在别处（例如上一次落在 captured-literature/）则一并清理。
	 */
	async resubmitBundleFile({ projectId, bundleId, kind, filePath, buffer, siExtension }) {
		if (!["pdf", "si"].includes(kind)) throw new Error(`kind must be pdf or si, got '${kind}'`);
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		const payload = buffer ?? (filePath ? await readFile(filePath) : undefined);
		if (!payload) throw new Error("resubmitBundleFile requires filePath or buffer");
		const workspace = await this.ensureProjectWorkspace(projectId);
		const entry = literatureEntryLayout(workspace.path, bundle);
		const extension = kind === "si"
			? String(siExtension ?? (filePath ? (filePath.match(/\.([A-Za-z0-9]{1,12})$/) ?? [])[1] : "") ?? "pdf").toLowerCase()
			: undefined;
		const staged = await this.stageFileIntoEntry({
			projectId,
			bundleId,
			kind,
			buffer: payload,
			fileName: entryFileName(entry.entryStem, kind, extension),
			allowExisting: true,
			entry
		});
		const sha256 = createHash("sha256").update(payload).digest("hex");
		const previous = kind === "pdf" ? bundle.pdfPath : bundle.siPath;
		const next = paperSourceBundleSchema.parse({
			...bundle,
			entryStem: bundle.entryStem ?? entry.entryStem,
			entryDir: bundle.entryDir ?? entry.entryDir,
			[kind === "pdf" ? "pdfPath" : "siPath"]: staged.filePath,
			[kind === "pdf" ? "pdfSha256" : "siSha256"]: sha256,
			...(kind === "pdf" ? { acquisitionStatus: "ready" } : {}),
			updatedAt: new Date().toISOString()
		});
		await this.ctx.ibmCore.commitSourceBundle(next);
		// 旧位置（若与条目目录不同）清理，避免同一份材料留两份。
		if (previous && previous !== staged.filePath && existsSync(previous) && !isPathInside(staged.filePath, previous)) {
			await rm(previous, { force: true });
		}
		return { bundle: next, filePath: staged.filePath, fileName: staged.fileName, sha256, replaced: previous ?? undefined };
	 },


	/**
	 * resubmitReport / resubmitPresentation：覆盖式重新提交精读报告或文献汇报 PPT。
	 * 保留同一 report/run 行（版本历史由 provenance 记录），只换产物文件与哈希。
	 */
	async resubmitReport({ projectId, reportId, format = "md", markdown, buffer, sourceName }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (report.projectId !== projectId) throw new Error(`reading report '${reportId}' belongs to another project`);
		const bundle = this.table("bundles").get(report.bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${report.bundleId}' not found`);
		const workspace = await this.ensureProjectWorkspace(projectId);
		const entry = literatureEntryLayout(workspace.path, bundle, report);
		const kind = format === "docx" ? "report-docx" : "report-md";
		const payload = buffer ?? Buffer.from(String(markdown ?? sourceName ?? ""), "utf8");
		if (!payload || payload.length === 0) throw new Error("resubmitReport requires markdown or buffer");
		const filePath = await atomicWrite(join(entry.entryDir, entryFileName(entry.entryStem, kind)), payload);
		const next = readingReportSchema.parse({
			...report,
			[kind === "report-docx" ? "docxPath" : "paperCardPath"]: filePath,
			artifactSha256: createHash("sha256").update(payload).digest("hex"),
			updatedAt: new Date().toISOString()
		});
		await this.table("reports").put(reportId, next);
		if(format==='docx')await officePdf(this,'reports',reportId);
		return { report: this.table('reports').get(reportId), filePath, fileName: basename(filePath) };
	},

	async resubmitPresentation({ projectId, presentationId, buffer, filePath: sourcePath }) {
		const run = this.table("presentations").get(presentationId);
		if (run === undefined) throw new Error(`presentation '${presentationId}' not found`);
		if (run.projectId !== projectId) throw new Error(`presentation '${presentationId}' belongs to another project`);
		const report = this.table('reports').get(run.reportId);
		const bundle = this.table("bundles").get(report?.bundleId);
		if (bundle === undefined || bundle.projectId!==projectId) throw new Error(`source bundle for presentation '${presentationId}' not found`);
		const payload = buffer ?? (sourcePath ? await readFile(sourcePath) : undefined);
		if (!payload) throw new Error("resubmitPresentation requires buffer or filePath");
		const workspace = await this.ensureProjectWorkspace(projectId);
		const entry = literatureEntryLayout(workspace.path, bundle);
		const filePath = await atomicWrite(join(entry.entryDir, entryFileName(entry.entryStem, "ppt")), payload);
		const oldPath = run.pptxPath;
		const next = presentationRunSchema.parse({ ...run, pptxPath: filePath, artifactSha256:createHash('sha256').update(payload).digest('hex'), updatedAt: new Date().toISOString() });
		await this.table("presentations").put(presentationId, next);
		await officePdf(this,'presentations',presentationId);
		if (oldPath && oldPath !== filePath && existsSync(oldPath)) await rm(oldPath, { force: true });
		return { presentation: this.table('presentations').get(presentationId), filePath, fileName: basename(filePath) };
	},


	/**
	 * deleteBundle：删除精读条目。
	 *
	 * 删除 bundle 行、其精读报告与 PPT 行，以及条目目录下的全部产物。
	 * provenance 行**保留**（审计链不因删除条目而断裂），返回里给出删除清单。
	 */
	async deleteBundle({ projectId, bundleId, confirm }) {
		if (confirm !== true) throw new Error("deleteBundle requires confirm=true（删除不可恢复）");
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		const reports = this.listReadingReports(projectId).filter((row) => row.bundleId === bundleId);
		const presentations = presentationsOfBundle(this, reports);

		// 与 tasks_report_delete 相同的边界：只允许删课题工作区内的条目目录。
		const project = this.requireProject(projectId);
		const workspacePath = resolve(project.workspacePath ?? join(this.projectsRoot, projectId));
		const entryDir = resolve(bundle.entryDir ?? literatureEntryLayout(workspacePath, bundle).entryDir);
		if (!isPathInside(workspacePath, entryDir) || entryDir === workspacePath) {
			throw new Error(`refusing to delete literature entry outside '${workspacePath}': ${entryDir}`);
		}
		// 先删文件再删行：反过来会留下无法定位的孤儿文件。
		const removed = [];
		if (existsSync(entryDir)) {
			await rm(entryDir, { recursive: true, force: true });
			removed.push(entryDir);
		}
		for (const row of reports) {
			await this.table("reports").delete(row.id);
			removed.push(row.id);
		}
		for (const row of presentations) {
			await this.table("presentations").delete(row.id);
			removed.push(row.id);
		}
		// provenance 与条目同生共死：审计链属于被删产物，留着只会指向不存在的条目。
		const runIds = new Set([bundleId, ...reports.map((row) => row.id), ...presentations.map((row) => row.id)]);
		let provenance = 0;
		for (const key of [...this.table("provenance").keys()]) {
			const row = this.table("provenance").get(key);
			if (row?.projectId === projectId && runIds.has(row.runId) && await this.table("provenance").delete(key)) provenance += 1;
		}
		await this.table("bundles").delete(bundleId);
		removed.push(bundleId);
		return {
			bundleId,
			removed,
			reports: reports.map((row) => row.id),
			presentations: presentations.map((row) => row.id),
			provenance
		};
	},


	/** 当前条目命名与缺口（工具与面板共用的只读视图）。 */
	entryNamingStatus(bundle, report) {
		const stem = bundle?.entryStem ?? buildEntryStem(bundle, report);
		return {
			entryStem: stem,
			entryDir: bundle?.entryDir,
			naming: bundle?.naming ?? {},
			missingNaming: missingEntryNamingFields(bundle, report)
		};
	}
};
