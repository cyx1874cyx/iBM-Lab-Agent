/**
 * dsh-lab-agent: 文献→PPT 任务编排的数据模型（纯逻辑层）。
 *
 * 计划 §五 任务流程 + §六 核心数据接口的持久化对象：
 *   LabProject / LiteratureSearchRun / PaperSourceBundle / ReadingReport /
 *   PresentationRun / ArtifactProvenance。
 *
 * 状态机：pending → running → under-review → succeeded | failed | cancelled。
 * 生成完成后必须进入人工审阅；自动审计/QA 只提供机器检查结果，不代替人工通过。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";

export const RUN_STATUSES = ["pending", "running", "under-review", "succeeded", "failed", "cancelled"];
export const RUN_STATUS = Object.fromEntries(RUN_STATUSES.map((s) => [s, s]));

export const LOCATOR_MODES = ["page-grounded", "structure-grounded", "source-limited"];

/** 人工审阅记录：机器审计结果保存在 audit/qa，本字段只记录研究人员决策。 */
export const humanReviewSchema = z.object({
	status: z.enum(["pending", "approved", "rejected"]).default("pending"),
	note: z.string().optional(),
	reviewedAt: z.string().optional(),
	/** 审核时看到的实际 Office 文件哈希；下载时再次比对，禁止审核后悄悄换件。 */
	artifactSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
	reviewer: z.string().default("human-ui")
}).default({});

/** 合法状态迁移表。 */
export const TRANSITIONS = {
	pending: ["running", "under-review", "cancelled", "failed"],
	running: ["under-review", "succeeded", "failed", "cancelled"],
	"under-review": ["succeeded", "failed", "running", "cancelled"],
	succeeded: ["under-review", "failed"], // 人工复审/机器重审可回退
	failed: ["running", "under-review", "cancelled"], // 修复后重跑/重新送审
	cancelled: ["running"] // 取消后重试
};

export function canTransit(from, to) {
	return (TRANSITIONS[from] ?? []).includes(to);
}

/** 版本快照引用（任务保存目标/模板版本，后续修改不影响旧任务）。 */
export const profileRefSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	version: z.string().regex(/^\d+$/),
	snapshot: z.unknown() // 版本行深拷贝
});

/** LabProject：项目容器（§五 步骤 1）。 */
export const labProjectSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	name: z.string().min(1),
	goalProfile: profileRefSchema,
	template: profileRefSchema,
	memoryVersion: z.string().regex(/^\d+$/).default("1"),
	/** 项目专属工作区目录（workspace.create 采纳的绝对路径）；旧数据可缺省。 */
	workspacePath: z.string().min(1).optional(),
	status: z.enum(["active", "archived"]).default("active"),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 项目核心记忆：Markdown 采用只增不改的版本行，便于随课题进展追溯。 */
export const projectMemoryVersionSchema = z.object({
	id: z.string().min(1),
	projectId: z.string().regex(PROFILE_ID_RE),
	version: z.string().regex(/^\d+$/),
	markdown: z.string().min(1),
	changeNote: z.string().default("更新课题核心记忆"),
	contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
	createdAt: z.string()
});

export function projectMemoryKey(projectId, version) {
	return `${projectId}@${version}`;
}

/**
 * 课题 ↔ Harness 工作区/会话绑定。绑定是**工作区级**的：一个课题一个独立
 * workspace，工作区内的所有会话共享课题标识与核心记忆。`sessionIds` 记录
 * 从课题侧启动过的会话（用于 launch 复用），手动新建的会话通过 cwd 路径
 * 反查（projects_by_cwd）同样归属课题。`.passthrough()` 保留升级前的旧行
 * 字段（旧 `sessionId`），供 init 一次性迁移。
 */
export const projectSessionSchema = z.object({
	projectId: z.string().regex(PROFILE_ID_RE),
	workspaceId: z.string().min(1),
	sessionIds: z.array(z.string()).default([]),
	createdAt: z.string()
}).passthrough();

export function projectSessionKey(projectId) {
	return projectId;
}

export const searchResultSchema = z.object({
	id: z.string().optional(),
	title: z.string().min(1),
	doi: z.string().optional(),
	pmid: z.string().optional(),
	arxivId: z.string().optional(),
	authors: z.array(z.string()).default([]),
	year: z.number().int().optional(),
	publicationDate: z.string().optional(),
	journal: z.string().optional(),
	volume: z.string().optional(),
	issue: z.string().optional(),
	pages: z.string().optional(),
	abstract: z.string().optional(),
	citations: z.number().int().nonnegative().optional(),
	type: z.string().optional(),
	source: z.string().default("openalex"),
	sources: z.array(z.string()).default([]),
	isOa: z.boolean().optional(),
	oaStatus: z.string().optional(),
	pdfUrl: z.string().url().optional(),
	landingUrl: z.string().url().optional(),
	license: z.string().optional(),
	version: z.string().optional(),
	pdfStatus: z.enum(["candidate", "verified", "unavailable", "broken"]).default("unavailable"),
	shortDescriptionZh: z.string().max(9).default("摘要待提炼"),
	score: z.number().optional()
});

/** LiteratureSearchRun（§六）：查询、数据源、结果、排序、导出与失败信息。 */
export const literatureSearchRunSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	title: z.string().default(""),
	query: z.string().min(1),
	queries: z.array(z.string()).default([]),
	sources: z.array(z.string()).default(["openalex", "crossref", "pubmed", "arxiv"]),
	oaOnly: z.boolean().default(true),
	limit: z.number().int().positive().default(10),
	sort: z.string().default("relevance_score"),
	yearFrom: z.number().int().optional(),
	results: z.array(searchResultSchema).default([]),
	sourceFailures: z.array(z.object({ source: z.string(), message: z.string() })).default([]),
	identifier: z.object({ kind: z.enum(["query", "doi", "pmid", "arxiv"]), value: z.string() }).optional(),
	exports: z.array(z.object({ format: z.string(), path: z.string() })).default([]),
	status: z.enum(RUN_STATUSES).default("pending"),
	progress: z.string().default(""),
	error: z.string().optional(),
	/** 执行该检索的 Harness 会话 id——面板点击记录可跳转到检索发生的对话。 */
	sessionId: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** PaperSourceBundle（§六）：原文、来源地图、图表资源及定位状态。 */
export const paperSourceBundleSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	title: z.string().default(""),
	pdfPath: z.string().min(1),
	pdfSha256: z.string().min(1),
	paperMdPath: z.string().optional(),
	sourceMapPath: z.string().optional(),
	translationNotesPath: z.string().optional(),
	figuresDir: z.string().optional(),
	locatorMode: z.enum(LOCATOR_MODES).default("structure-grounded"),
	status: z.enum(RUN_STATUSES).default("pending"),
	error: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** ReadingReport（§六）：Paper Card、目标配置快照和审计结果。 */
export const readingReportSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	bundleId: z.string().regex(PROFILE_ID_RE),
	goalSnapshot: z.unknown(),
	paperCardRequirements: z.unknown(),
	/** 阅读笔记模板快照（版本行深拷贝）+ 使用的模板标识。 */
	noteTemplateSnapshot: z.unknown().optional(),
	noteRequirements: z.unknown().optional(),
	paperCardPath: z.string().optional(),
	/** 暂存并供预览/下载的实际 Word 文件，不再在下载时临时重建。 */
	docxPath: z.string().optional(),
	artifactSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
	locatorMode: z.enum(LOCATOR_MODES).default("structure-grounded"),
	auditReportPath: z.string().optional(),
	audit: z
		.object({
			ok: z.boolean().default(false),
			errors: z.number().int().nonnegative().default(0),
			warnings: z.number().int().nonnegative().default(0),
			summary: z.string().default("")
		})
		.default({}),
	review: humanReviewSchema,
	status: z.enum(RUN_STATUSES).default("pending"),
	error: z.string().optional(),
	/** 精读条目标题：期刊短引用（如 Nature 630, 84–90 (2024).）。 */
	shortCitation: z.string().optional(),
	/** 鼠标悬浮显示的题名（中文标题等）。 */
	titleZh: z.string().optional(),
	/** 200字概览卡片正文；缺省时从 paper card 推导。 */
	summary: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** PresentationRun（§六）：PPT 模板、内容计划、PPTX 和 QA 结果。 */
export const presentationRunSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	reportId: z.string().regex(PROFILE_ID_RE),
	templateSnapshot: z.unknown(),
	auditSkipped: z.boolean().default(false),
	outlinePath: z.string().optional(),
	pptxPath: z.string().optional(),
	artifactSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
	speechNotesPath: z.string().optional(),
	figureSourcesPath: z.string().optional(),
	qa: z
		.object({
			ok: z.boolean().default(false),
			high: z.number().int().nonnegative().default(0),
			medium: z.number().int().nonnegative().default(0),
			low: z.number().int().nonnegative().default(0),
			reportPath: z.string().optional(),
			jsonPath: z.string().optional()
		})
		.default({}),
	review: humanReviewSchema,
	status: z.enum(RUN_STATUSES).default("pending"),
	error: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** ArtifactProvenance（§六）：输入哈希、Skill 版本、模型、来源和生成时间。 */
export const artifactProvenanceSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	kind: z.enum(["search", "source-bundle", "reading-report", "presentation"]),
	runId: z.string().regex(PROFILE_ID_RE),
	inputsSha256: z.string().min(1),
	skillVersions: z.array(
		z.object({
			skillName: z.string().min(1),
			commitSha: z.string().regex(/^[0-9a-f]{40}$/),
			manifestVersion: z.string().min(1)
		})
	).default([]),
	model: z.string().optional(),
	source: z.string().min(1),
	createdAt: z.string()
});

export const labTasksDomainSpecTables = {
	lab_projects: "lab_projects",
	project_memory_versions: "project_memory_versions",
	project_sessions: "project_sessions",
	literature_search_runs: "literature_search_runs",
	paper_source_bundles: "paper_source_bundles",
	reading_reports: "reading_reports",
	presentation_runs: "presentation_runs",
	artifact_provenance: "artifact_provenance"
};
