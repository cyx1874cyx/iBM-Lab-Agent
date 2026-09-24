/**
 * dsh-lab-agent / labTasks — 文献综述（检索条目 → 综述文档 + 综述 PPT）。
 *
 * 与单篇精读的区别：输入是**一次检索的全部结果**，产物落在检索条目自己的目录：
 *
 *   <课题工作区>/literature/reviews/<runStem>/
 *     <runStem> 综述生成契约.md
 *     <runStem> 综述报告.md / .docx
 *     <runStem> 综述PPT.pptx
 *     <runStem> PPT生成契约.md / PPT符合性.json
 *
 * runStem 由检索条目标题（一句中文主题）清洗得到；条目没有标题时回退检索式。
 *
 * 综述模板复用阅读笔记模板域（kind="review"），因此「模板管理」里两类模板同源，
 * 版本、快照、导入解析全部沿用同一套机制。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderNoteContract, toNoteRequirements } from "../../src/note-template.js";
import { sanitizeEntryStem } from "../entry-layout.js";
import { literatureSearchRunSchema } from "../../src/task-models.js";
import { atomicWrite, isPathInside } from "./shared.js";

export const REVIEW_DIR_NAME = "reviews";
export const REVIEW_STEM_MAX = 80;

/** 检索条目的归档标识：优先条目标题（一句中文主题），缺省回退检索式。 */
export function reviewStemOf(run) {
	const source = String(run?.title ?? "").trim() || String(run?.query ?? "").trim() || run?.id || "review";
	return sanitizeEntryStem(source).slice(0, REVIEW_STEM_MAX) || String(run?.id ?? "review");
}

/** 综述产物文件名（与文献条目同一套命名约定：stem + 类型后缀）。 */
export function reviewFileName(stem, kind) {
	const label = {
		"review-md": "综述报告",
		"review-docx": "综述报告",
		"review-contract": "综述生成契约",
		"review-ppt": "综述PPT",
		"ppt-contract": "PPT生成契约",
		"ppt-conformance": "PPT符合性"
	}[kind] ?? kind;
	const ext = {
		"review-md": "md",
		"review-docx": "docx",
		"review-contract": "md",
		"review-ppt": "pptx",
		"ppt-contract": "md",
		"ppt-conformance": "json"
	}[kind] ?? "bin";
	return `${stem} ${label}.${ext}`;
}

export const reviewMethods = {

	/** 综述归档目录：<workspace>/literature/reviews/<runStem>/。 */
	async reviewArchiveLayout(projectId, run) {
		const workspace = await this.ensureProjectWorkspace(projectId);
		const stem = run?.review?.archiveDir ? reviewStemOf(run) : reviewStemOf(run);
		return { workspace, stem, dir: run?.review?.archiveDir ?? join(workspace.path, "literature", REVIEW_DIR_NAME, stem) };
	},

	/**
	 * readingReviewInputs：写综述前必须调用的盘点。
	 *
	 * 返回本次检索条目的全部结果（题名/摘要/中文概括/DOI/期刊/年份/作者）、已导出的
	 * RIS 路径，以及综述模板的完整生成要求；契约同时落盘，Agent 用 read 分块读完。
	 */
	async readingReviewInputs({ projectId, runId, templateId, templateVersion }) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		if (run.projectId !== projectId) throw new Error(`search run '${runId}' belongs to another project`);
		const templates = this.ctx.labNoteTemplates;
		if (templates === undefined) throw new Error("labNoteTemplates service is unavailable");
		const reviewTemplates = await templates.listReviewTemplates();
		const chosenId = templateId ?? run.review?.templateId ?? reviewTemplates[0]?.id;
		const { template, requirements } = await this.reviewTemplateRequirements(chosenId, templateVersion ?? run.review?.templateVersion);
		const { stem, dir } = await this.reviewArchiveLayout(projectId, run);
		const papers = (run.results ?? []).map((paper) => ({
			paperId: paper.doi ?? paper.pmid ?? paper.arxivId ?? paper.id ?? paper.title,
			title: paper.title,
			summaryZh: paper.shortDescriptionZh,
			abstract: String(paper.abstract ?? "").slice(0, 1600),
			authors: paper.authors ?? [],
			journal: paper.journal,
			year: paper.year,
			doi: paper.doi,
			isOa: paper.isOa
		}));
		const ris = (run.exports ?? []).find((row) => row.format === "ris");
		return {
			runId: run.id,
			projectId,
			title: run.title,
			query: run.query,
			queries: run.queries ?? [],
			sources: run.sources ?? [],
			resultCount: papers.length,
			papers,
			risPath: ris?.path,
			archiveDir: dir,
			archiveStem: stem,
			template,
			generationRequirements: requirements,
			formatSource: template ? "review-template" : "none",
			instructions: [
				"综述只允许使用本条目检索到的文献（题名/摘要/已导出的 RIS）；不得引入未检索到的文献。",
				"按主题归类组织，不要逐篇罗列摘要；每个论断标注来源文献（作者 年份 或 DOI）。",
				"摘要信息不足以下结论时写明「摘要信息不足」，不得补写不可见内容。",
				template
					? "章节严格采用综述模板的骨架，不得自造章节。"
					: "没有可用综述模板：使用默认综述结构（范围/背景/归类/进展/对比/挑战/展望/与本课题关系/参考文献）。"
			]
		};
	},

	/** 取综述模板快照与生成要求；缺省回退 review-default。 */
	async reviewTemplateRequirements(templateId, templateVersion) {
		const templates = this.ctx.labNoteTemplates;
		if (templates === undefined) return { template: undefined, requirements: undefined };
		const id = templateId ?? "review-default";
		const snapshot = await templates.snapshotForTask(id, templateVersion);
		if (!snapshot) return { template: undefined, requirements: undefined };
		return { template: snapshot, requirements: toNoteRequirements(snapshot) };
	},

	/** 把综述生成契约写入归档目录，返回契约路径与摘要（Agent 用 read 读取）。 */
	async materializeReviewContract(inputs) {
		const content = renderNoteContract({
			template: inputs.template,
			requirements: inputs.generationRequirements,
			resources: [],
			mustReadPaths: inputs.risPath ? [inputs.risPath] : [],
			formatSource: inputs.formatSource,
			title: inputs.title,
			bundleId: inputs.runId,
			reportId: undefined
		});
		const body = [
			`# 文献综述生成契约`,
			"",
			`- 检索条目：${inputs.runId}`,
			`- 主题：${inputs.title || inputs.query || "（未命名）"}`,
			`- 检索式：${(inputs.queries?.length ? inputs.queries : [inputs.query]).filter(Boolean).join(" | ")}`,
			`- 数据源：${(inputs.sources ?? []).join("、")}`,
			`- 纳入文献：${inputs.resultCount} 条`,
			inputs.risPath ? `- RIS 导出：${inputs.risPath}` : "- RIS 导出：尚未导出（可用 lab_tasks_search_ris 生成）",
			"",
			"## 纳入文献清单（只能引用这些）",
			"",
			...(inputs.papers ?? []).map((paper, index) => {
				const meta = [paper.journal, paper.year, paper.doi].filter(Boolean).join(" · ");
				return `${index + 1}. ${paper.title}${meta ? `（${meta}）` : ""}${paper.summaryZh ? ` — ${paper.summaryZh}` : ""}`;
			}),
			"",
			content
		].join("\n");
		const filePath = await atomicWrite(join(inputs.archiveDir, reviewFileName(inputs.archiveStem, "review-contract")), Buffer.from(body, "utf8"));
		return {
			contractPath: filePath,
			contractCharacters: body.length,
			contractSha256: createHash("sha256").update(body).digest("hex"),
			templateSectionCount: (inputs.generationRequirements?.sections ?? []).length
		};
	},

	/**
	 * registerReview：登记（或重新提交）某检索条目的综述文档。
	 * markdown 与 reportPath 二选一；docxPath 可选（已生成的 Word）。
	 */
	async registerReview({ projectId, runId, markdown, reportPath, docxPath, templateId, templateVersion }) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		if (run.projectId !== projectId) throw new Error(`search run '${runId}' belongs to another project`);
		const body = markdown !== undefined
			? String(markdown)
			: reportPath
				? await readFile(reportPath, "utf8")
				: "";
		if (!body.trim()) throw new Error("registerReview requires markdown or a readable reportPath");
		const { stem, dir } = await this.reviewArchiveLayout(projectId, run);
		const markdownPath = await atomicWrite(join(dir, reviewFileName(stem, "review-md")), Buffer.from(body, "utf8"));
		let finalDocx = docxPath;
		if (docxPath && existsSync(docxPath)) {
			const bytes = await readFile(docxPath);
			finalDocx = await atomicWrite(join(dir, reviewFileName(stem, "review-docx")), bytes);
		}
		const { template, requirements } = await this.reviewTemplateRequirements(templateId ?? run.review?.templateId, templateVersion ?? run.review?.templateVersion);
		const contractPath = run.review?.contractPath && existsSync(run.review.contractPath)
			? run.review.contractPath
			: (await this.materializeReviewContract({
				...await this.readingReviewInputs({ projectId, runId, templateId: template?.id, templateVersion: template?.version }),
				template,
				generationRequirements: requirements
			})).contractPath;
		const next = literatureSearchRunSchema.parse({
			...run,
			review: {
				status: "ready",
				markdownPath,
				docxPath: finalDocx,
				contractPath,
				sha256: createHash("sha256").update(body).digest("hex"),
				templateId: template?.id,
				templateVersion: template?.version,
				templateSnapshot: template,
				archiveDir: dir,
				updatedAt: new Date().toISOString()
			},
			updatedAt: new Date().toISOString()
		});
		await this.table("searches").put(run.id, next);
		return { run: next, markdownPath, docxPath: finalDocx, contractPath };
	},

	/** registerReviewPresentation：登记（或重新提交）综述汇报 PPT。 */
	async registerReviewPresentation({ projectId, runId, pptxPath, contractPath, conformancePath, templateId, templateVersion }) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		if (run.projectId !== projectId) throw new Error(`search run '${runId}' belongs to another project`);
		if (!pptxPath || !existsSync(pptxPath)) throw new Error(`pptx not found: ${pptxPath}`);
		const { stem, dir } = await this.reviewArchiveLayout(projectId, run);
		const bytes = await readFile(pptxPath);
		const finalPath = await atomicWrite(join(dir, reviewFileName(stem, "review-ppt")), bytes);
		const copyIfInside = async (source, kind) => {
			if (!source || !existsSync(source)) return undefined;
			if (isPathInside(dir, source)) return source;
			return atomicWrite(join(dir, reviewFileName(stem, kind)), await readFile(source));
		};
		const next = literatureSearchRunSchema.parse({
			...run,
			reviewPresentation: {
				status: "ready",
				pptxPath: finalPath,
				contractPath: await copyIfInside(contractPath, "ppt-contract"),
				conformancePath: await copyIfInside(conformancePath, "ppt-conformance"),
				templateId,
				templateVersion,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				updatedAt: new Date().toISOString()
			},
			updatedAt: new Date().toISOString()
		});
		await this.table("searches").put(run.id, next);
		return { run: next, pptxPath: finalPath };
	},

	/** 综述产物下载（kind=report|ppt）：返回字节与文件名。 */
	async reviewFile(runId, kind = "report") {
		const run = this.table("searches").get(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const filePath = kind === "ppt" ? run.reviewPresentation?.pptxPath : run.review?.markdownPath;
		if (!filePath) throw new Error(`search run '${runId}' has no review ${kind === "ppt" ? "presentation" : "report"}`);
		if (!existsSync(filePath)) throw new Error(`review file missing: ${filePath}`);
		const buffer = await readFile(filePath);
		return { fileName: filePath.split(/[\\/]/).pop(), buffer, byteLength: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
	}
};
