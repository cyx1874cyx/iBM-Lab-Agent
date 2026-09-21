/**
 * dsh-lab-agent / labTasks — 课题文献条目暂存区（bundle entry 布局与文件落位）。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { validatePdfBuffer } from "../literature-browser.js";
import { entryFileName, literatureEntryLayout } from "../entry-layout.js";
import { paperSourceBundleSchema } from "../../src/task-models.js";
import { atomicWrite, isPathInside } from "./shared.js";

export const stagingMethods = {

	/**
	 * bundleFile：读取已登记原文（PDF）或 SI 补充材料文件，供 /api/lab-artifacts
	 * 二进制流下载（kind=pdf|si）。PDF 直接复用登记时的 pdfSha256；SI 若登记时
	 * 已固化 siSha256 则复用，否则现场计算。
	 */
	async bundleFile(bundleId, which) {
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		const rel = which === "pdf" ? "pdfPath" : which === "si" ? "siPath" : null;
		if (!rel || !bundle[rel]) throw new Error(`source bundle '${bundleId}' has no ${which} file`);
		const filePath = bundle[rel];
		if (!existsSync(filePath)) throw new Error(`${which} file missing: ${filePath}`);
		const buffer = await readFile(filePath);
		const extension = filePath.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] || "";
		if (which === "pdf" || extension === "pdf") validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
		if (which === "si" && !["pdf", "docx", "zip"].includes(extension)) throw new Error(`unsupported SI file type: .${extension || "?"}`);
		if (which === "si" && extension !== "pdf" && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error(`${extension.toUpperCase()} SI file is not a valid ZIP/Office container`);
		const integrity = { sha256: createHash("sha256").update(buffer).digest("hex") };
		const expectedSha256 = which === "pdf" ? bundle.pdfSha256 : bundle.siSha256;
		if (expectedSha256 && integrity.sha256 !== expectedSha256) throw new Error(`${which} file changed after registration`);
		const mime = extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/zip";
		return { fileName: basename(filePath), mime, buffer, byteLength: buffer.length, sha256: integrity.sha256 };
	},


	/**
	 * ensureBundleEntryLayout：固化文献条目标识与条目目录（entryStem/entryDir）。
	 *
	 * 同一 bundle 的 entryStem 必须稳定：正文与 SI 分批存档、精读报告与 PPT 固化
	 * 都必须复用同一目录。占位创建时（registerFromWechat / preparePaper）首次调用，
	 * 之后所有阶段读取 bundle.entryStem/entryDir 不再重新推导。
	 *
	 * 旧数据迁移：bundle 缺少 entryStem/entryDir 时按当前元数据推导；若旧
	 * captured-literature/<bundleId>/ 目录下已登记正文/SI，复制到条目目录并更新
	 * 数据库路径（临时文件 → 校验 → 原子替换 → 更新 DB；失败保留原文件并报错）。
	 */
	async ensureBundleEntryLayout(bundle, report) {
		const workspace = await this.ensureProjectWorkspace(bundle.projectId);
		const layout = literatureEntryLayout(workspace.path, bundle, report);
		const patch = {};
		if (!bundle.entryStem || bundle.entryStem !== layout.entryStem) patch.entryStem = layout.entryStem;
		if (!bundle.entryDir || bundle.entryDir !== layout.entryDir) patch.entryDir = layout.entryDir;
		if (Object.keys(patch).length === 0) return bundle;
		const next = paperSourceBundleSchema.parse({ ...bundle, ...patch, updatedAt: new Date().toISOString() });
		await this.table("bundles").put(bundle.id, next);
		// 旧 captured-literature/<bundleId>/ 数据受控迁移（正文与 SI 都是 PDF）。
		for (const kind of ["pdf", "si"]) {
			const oldPath = next[kind === "pdf" ? "pdfPath" : "siPath"];
			if (!oldPath || !existsSync(oldPath)) continue;
			const legacyDir = join(workspace.path, "captured-literature", bundle.id);
			if (!isPathInside(legacyDir, oldPath)) continue;
			const buffer = await readFile(oldPath);
			validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
			const staged = await this.stageFileIntoEntry({
				projectId: bundle.projectId,
				bundleId: bundle.id,
				kind,
				buffer,
				allowExisting: true
			});
			const migrated = paperSourceBundleSchema.parse({
				...next,
				[kind === "pdf" ? "pdfPath" : "siPath"]: staged.filePath,
				updatedAt: new Date().toISOString()
			});
			await this.table("bundles").put(bundle.id, migrated);
		}
		return this.table("bundles").get(bundle.id);
	},


	/**
	 * stageFileIntoEntry：把任意产物字节固化到文献条目目录。
	 * 目录与文件名全部由服务端决定（entryFileName），不接受外部文件名；
	 * allowExisting=true 时允许覆盖已存在的同名产物（同 bundle 分批存档幂等）。
	 * @returns {{ filePath: string, fileName: string }}
	 */
	async stageFileIntoEntry({ projectId, bundleId, kind, buffer, fileName, allowExisting = false, entry }) {
		const bundle = this.table("bundles").get(bundleId);
		// entry：调用方已算好的条目布局。preparePaper 归档工程外输入时 bundle 尚未落库，
		// 此时按预计算布局写入，随后 bundle 以相同的 entryStem/entryDir 落库，路径一致。
		if (bundle === undefined && !entry) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle && bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		const settled = entry
			? { ...bundle, entryStem: entry.entryStem, entryDir: entry.entryDir }
			: await this.ensureBundleEntryLayout(bundle);
		const targetName = fileName ?? entryFileName(settled.entryStem, kind);
		const filePath = await atomicWrite(join(settled.entryDir, targetName), buffer);
		if (!allowExisting) {
			// 同一 bundle 出现两个不同内容的目标名（理论上不应发生）时拒绝，避免目录漂移。
			const registered = kind === "pdf" ? settled.pdfPath : kind === "si" ? settled.siPath : undefined;
			if (registered && registered !== filePath && existsSync(registered)) {
				throw new Error(`entry '${bundleId}' already registered ${kind} at a different path`);
			}
		}
		return { filePath, fileName: targetName };
	},


	/**
	 * stageArtifactIntoEntry：正文/SI 捕获固化的统一入口。
	 * 先做 PDF 签名/EOF/大小/SHA-256 校验，再原子写入条目目录；扩展名强制 .pdf。
	 */
	async stageArtifactIntoEntry({ projectId, bundleId, kind, buffer }) {
		if (!["pdf", "si"].includes(kind)) throw new Error(`kind must be pdf or si, got '${kind}'`);
		const integrity = validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
		const staged = await this.stageFileIntoEntry({ projectId, bundleId, kind, buffer });
		return { ...staged, ...integrity };
	}
};
