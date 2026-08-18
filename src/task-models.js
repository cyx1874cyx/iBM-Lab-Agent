/**
 * dsh-lab-agent: 文献→PPT 任务编排的数据模型（纯逻辑层）。
 *
 * 计划 §五 任务流程 + §六 核心数据接口的持久化对象：
 *   LabProject / LiteratureSearchRun / PaperSourceBundle / ReadingReport /
 *   PresentationRun / ArtifactProvenance。
 *
 * 状态机：pending → running → succeeded | failed | cancelled。
 * 门禁：ReadingReport 审计失败阻止进入 PPT 阶段；PresentationRun 的 QA 失败
 * 标记 failed（高严重度问题必须修复后重审）。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";

export const RUN_STATUSES = ["pending", "running", "succeeded", "failed", "cancelled"];
export const RUN_STATUS = Object.fromEntries(RUN_STATUSES.map((s) => [s, s]));

export const LOCATOR_MODES = ["page-grounded", "structure-grounded", "source-limited"];

/** 合法状态迁移表。 */
export const TRANSITIONS = {
	pending: ["running", "cancelled", "failed"],
	running: ["succeeded", "failed", "cancelled"],
	succeeded: ["failed"], // 审计重审可回退
	failed: ["running", "cancelled"], // 修复后重跑
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
 * 项目 ↔ Harness 会话绑定：课题创建后自动开一个独立 workspace + 新会话，
 * 对话界面的课题徽章据此反查当前会话属于哪个课题。
 */
export const projectSessionSchema = z.object({
	projectId: z.string().regex(PROFILE_ID_RE),
	sessionId: z.string().min(1),
	workspaceId: z.string().min(1),
	createdAt: z.string()
});

export function projectSessionKey(projectId) {
	return projectId;
}

export const searchResultSchema = z.object({
	title: z.string().min(1),
	doi: z.string().optional(),
	authors: z.array(z.string()).default([]),
	year: z.number().int().optional(),
	citations: z.number().int().nonnegative().optional(),
	source: z.string().default("openalex")
});

/** LiteratureSearchRun（§六）：查询、数据源、结果、排序、导出与失败信息。 */
export const literatureSearchRunSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	query: z.string().min(1),
	sources: z.array(z.string()).default(["openalex", "crossref", "arxiv"]),
	limit: z.number().int().positive().default(10),
	sort: z.string().default("relevance_score"),
	yearFrom: z.number().int().optional(),
	results: z.array(searchResultSchema).default([]),
	exports: z.array(z.object({ format: z.string(), path: z.string() })).default([]),
	status: z.enum(RUN_STATUSES).default("pending"),
	progress: z.string().default(""),
	error: z.string().optional(),
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
	paperCardPath: z.string().optional(),
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
	status: z.enum(RUN_STATUSES).default("pending"),
	error: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** PresentationRun（§六）：PPT 模板、内容计划、PPTX 和 QA 结果。 */
export const presentationRunSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	reportId: z.string().regex(PROFILE_ID_RE),
	templateSnapshot: z.unknown(),
	outlinePath: z.string().optional(),
	pptxPath: z.string().optional(),
	speechNotesPath: z.string().optional(),
	figureSourcesPath: z.string().optional(),
	qa: z
		.object({
			ok: z.boolean().default(false),
			high: z.number().int().nonnegative().default(0),
			medium: z.number().int().nonnegative().default(0),
			low: z.number().int().nonnegative().default(0),
			reportPath: z.string().optional()
		})
		.default({}),
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
