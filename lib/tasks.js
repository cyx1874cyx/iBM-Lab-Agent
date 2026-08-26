/**
 * dsh-lab-agent: 文献→PPT 任务编排服务（Cordis host service, ctx.labTasks）。
 *
 * 计划 §五 流程 + §六 任务接口。机械化步骤直接调用 nature-skills 的 stdlib
 * 脚本（SkillExecutor）；LLM 驱动的步骤（精读报告、PPT 内容）由 agent 在会话
 * 中执行对应 skill 后调用 complete* 登记产物，再走审计门禁。
 *
 * 产物流程：实际 DOCX/PPTX 生成后先进入课题文献条目暂存区；自动自查仅提示，
 * 不阻断人工审核。只有人工审核绑定到当前文件哈希后，原文件下载才开放。
 * 每个产物记录 ArtifactProvenance（输入哈希 / skill 版本 / 模型 / 时间）。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { SkillExecutor } from "../src/skill-executor.js";
import { venvPythonPath } from "../src/python-env.js";
import { resolveDshHome, labAgentRoot } from "../src/paths.js";
import { toPaperCardRequirements } from "../src/goal-profile.js";
import { inspectOfficePackage } from "../src/office-package.js";
import { auditReadingNote } from "../src/reading-note-audit.js";
import { canonicalizePaper, deduplicatePapers, DEFAULT_SOURCES, normalizeDoi } from "../src/literature/search-engine.js";
import { markdownToDocx } from "./md2docx.js";
import {
	labProjectSchema,
	projectMemoryVersionSchema,
	projectMemoryKey,
	projectSessionSchema,
	projectSessionKey,
	literatureSearchRunSchema,
	paperSourceBundleSchema,
	readingReportSchema,
	presentationRunSchema,
	artifactProvenanceSchema,
	canTransit,
	RUN_STATUS
} from "../src/task-models.js";

export const labTasksDomainSpec = defineDomain({
	name: "lab_tasks",
	version: 0,
	tables: {
		lab_projects: domainTable(labProjectSchema),
		project_memory_versions: domainTable(projectMemoryVersionSchema),
		project_sessions: domainTable(projectSessionSchema),
		literature_search_runs: domainTable(literatureSearchRunSchema),
		paper_source_bundles: domainTable(paperSourceBundleSchema),
		reading_reports: domainTable(readingReportSchema),
		presentation_runs: domainTable(presentationRunSchema),
		artifact_provenance: domainTable(artifactProvenanceSchema)
	}
});

/** 产物 kind → 关联 nature skill 名。 */
export const KIND_TO_SKILL = {
	search: "nature-academic-search",
	"source-bundle": "nature-reader",
	"reading-report": "nature-paper-card",
	presentation: "nature-paper2ppt"
};

function cleanSearchPaper(record) {
	const { _providerRank, ...paper } = canonicalizePaper(record, record.sources?.[0] ?? "openalex");
	return paper;
}

function searchEntryTitle(value, query) {
	const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
	return normalized ? [...normalized].slice(0, 80).join("") : `${String(query).trim()}相关文献`;
}

/**
 * 面板短引用统一为“期刊 卷, 页码 (年份).”。兼容登记时夹带作者，或原文
 * 标题末尾使用 “Nature 630:84-90, 2024” 的旧数据。
 */
export function normalizeJournalShortCitation(...values) {
	const pattern = /\*?([A-Z][A-Za-z.&' -]*?)\*?\s+(\d+[A-Za-z]?)\s*[,：:]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)\s*(?:\((\d{4})\)|,\s*(\d{4}))/g;
	for (const value of values) {
		const matches = [...String(value ?? "").matchAll(pattern)];
		const match = matches.at(-1);
		if (!match) continue;
		const journal = match[1].trim();
		const pages = match[3].replace(/\s*[-–—]\s*/g, "–");
		return `${journal} ${match[2]}, ${pages} (${match[4] || match[5]}).`;
	}
	return undefined;
}

const GENERIC_PAPER_SUMMARIES = new Set([
	"相关研究", "相关综述", "传感器件", "成像方法", "制备方法", "治疗方法",
	"递送体系", "稳定性研究", "作用机制", "研究方法", "摘要待提炼"
]);

function normalizePaperLookup(value) {
	let normalized = String(value ?? "").trim().toLowerCase();
	if (!normalized) return "";
	normalized = normalized.replace(/^(?:paperid|paper_id|doi|id|openalex|pmid|arxiv)\s*:\s*/i, "").trim();
	const doi = normalizeDoi(normalized);
	if (doi) return doi;
	const openAlex = normalized.match(/(?:https?:\/\/openalex\.org\/)?(w\d+)(?:[/?#].*)?$/i);
	if (openAlex) return openAlex[1].toLowerCase();
	try {
		const url = new URL(normalized);
		url.hash = "";
		url.search = "";
		return url.href.replace(/\/$/, "").toLowerCase();
	} catch { return normalized.replace(/\s+/g, " "); }
}

export function publicSearchPaperId(paper) {
	return String(paper.doi ?? paper.pmid ?? paper.arxivId ?? paper.id ?? paper.landingUrl ?? paper.title ?? "").trim();
}

export function searchPaperAliases(paper) {
	return new Set([
		paper.doi, paper.pmid, paper.arxivId, paper.id, paper.landingUrl, paper.title,
		paper.doi ? `https://doi.org/${paper.doi}` : undefined
	].filter(Boolean).map(normalizePaperLookup).filter(Boolean));
}

export function searchPaperMatches(paper, value) {
	return searchPaperAliases(paper).has(normalizePaperLookup(value));
}

function normalizeAbstractSummary(value) {
	const normalized = String(value ?? "").replace(/[（）()\s，。；：、,.!?！？]/g, "").trim();
	const length = [...normalized].length;
	if (length < 2 || length > 9) throw new Error(`摘要概括必须为 2–9 个字：${value}`);
	if (!/\p{Script=Han}/u.test(normalized)) throw new Error(`摘要概括必须包含中文：${value}`);
	if (GENERIC_PAPER_SUMMARIES.has(normalized)) throw new Error(`摘要概括不能只是文章类型：${value}`);
	return normalized;
}

/** Merge legacy/multiple rows into one read model without deleting stored results. */
export function mergeSessionSearchRows(rows) {
	if (!rows.length) return undefined;
	const ordered = rows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const base = ordered[0];
	const queries = [...new Set(ordered.flatMap((row) => row.queries?.length ? row.queries : [row.query]).filter(Boolean))];
	const sources = [...new Set(ordered.flatMap((row) => row.sources ?? []))];
	const sourceFailures = [...new Map(ordered.flatMap((row) => row.sourceFailures ?? []).map((failure) => [`${failure.source}\n${failure.message}`, failure])).values()];
	const results = deduplicatePapers(ordered.flatMap((row) => row.results ?? [])).map(cleanSearchPaper);
	const latestTitle = ordered.slice().reverse().find((row) => row.title?.trim())?.title;
	const status = ordered.some((row) => row.status === "running") ? "running"
		: ordered.some((row) => row.status === "succeeded") ? "succeeded"
			: ordered.at(-1).status;
	return {
		...base,
		title: latestTitle ?? searchEntryTitle(undefined, base.query),
		queries,
		sources,
		results,
		sourceFailures,
		status,
		progress: `${results.length} references from ${queries.length} queries`,
		identifier: queries.length === 1 ? ordered.at(-1).identifier : undefined,
		updatedAt: ordered.map((row) => row.updatedAt).sort().at(-1)
	};
}

export class LabTasksService extends Service {
	static inject = ["storageDomain", "labGoals", "labTemplates", "labNoteTemplates", "labVersions"];
	/** 课题工作区里的核心记忆文件（agent 在对话中直接读取，不预填输入框）。 */
	static PROJECT_MEMORY_FILE = "项目记忆.md";
	tables = {};
	executor;

	/** @param config {{ skillsRoot?: string, venvDir?: string, projectsRoot?: string, researchPreset?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labTasks");
		this.config = config;
		// 每个课题一个独立工作区目录：$DSH_HOME/lab-agent/projects/<projectId>。
		this.projectsRoot = config.projectsRoot ?? join(labAgentRoot(resolveDshHome()), "projects");
		// 课题创建后自动启用的科研 Agent 预设（preset id = preset 目录名）。
		this.researchPreset = config.researchPreset ?? "lab-research";
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labTasksDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.tasks.domainClose");
		this.domain = domain;
		this.tables = {
			projects: domain.table("lab_projects"),
			memories: domain.table("project_memory_versions"),
			sessions: domain.table("project_sessions"),
			searches: domain.table("literature_search_runs"),
			bundles: domain.table("paper_source_bundles"),
			reports: domain.table("reading_reports"),
			presentations: domain.table("presentation_runs"),
			provenance: domain.table("artifact_provenance")
		};
		this.executor = new SkillExecutor({
			skillsRoot: this.config.skillsRoot,
			venvPython: this.config.venvDir ? venvPythonPath(this.config.venvDir) : undefined
		});
		await this.migrateLegacySessionBindings();
		await this.migrateLegacyReviewGates();
		await this.resumePendingMachineReviews();
	}

	/**
	 * 升级迁移：只要实际产物已登记，就进入人工审阅暂存区。机器审计/QA 仅作
	 * 提示，不再把旧产物卡在 running/failed，也不替代研究人员决策。
	 */
	async migrateLegacyReviewGates() {
		const now = new Date().toISOString();
		for (const [tableName, pathField] of [
			["reports", "paperCardPath"],
			["presentations", "pptxPath"]
		]) {
			const table = this.table(tableName);
			for (const key of table.keys()) {
				let row = table.get(key);
				if (!row[pathField]) continue;
				if (tableName === "reports" && (!row.docxPath || !existsSync(row.docxPath))) {
					try {
						const staged = await this.materializeReadingDocx(row);
						row = { ...row, docxPath: staged.docxPath, artifactSha256: staged.integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy reading report '${key}' DOCX staging failed: ${error.message}`);
						continue;
					}
				}
				if (tableName === "reports" && row.docxPath && !row.artifactSha256) {
					try {
						const integrity = await inspectOfficePackage(await readFile(row.docxPath), "docx");
						row = { ...row, artifactSha256: integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy reading report '${key}' DOCX integrity migration failed: ${error.message}`);
						continue;
					}
				}
				if (tableName === "presentations" && (!row.artifactSha256 || !row.review?.artifactSha256)) {
					try {
						const integrity = await inspectOfficePackage(await readFile(row.pptxPath), "pptx");
						row = { ...row, artifactSha256: integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy presentation '${key}' PPTX staging failed: ${error.message}`);
						continue;
					}
				}
				const approvedHashMatches = row.review?.status === "approved" && row.review?.artifactSha256 === row.artifactSha256;
				if (approvedHashMatches || row.review?.status === "rejected") continue;
				if (row.status !== "under-review" || row.review?.status !== "pending") await table.put(key, { ...row, status: "under-review", progress: "artifact staged; awaiting human review", review: { status: "pending", reviewer: "human-ui" }, updatedAt: now });
			}
		}
	}

	/** 启动时补跑被旧状态机跳过的机器评审；失败留在 failed，不开放人工按钮。 */
	async resumePendingMachineReviews() {
		for (const key of this.table("reports").keys()) {
			const row = this.table("reports").get(key);
			if (row.status !== "running" || !row.paperCardPath || row.audit?.ok) continue;
			try { await this.validateReadingReport({ reportId: key }); }
			catch (error) { this.ctx.logger.warn(`legacy reading report '${key}' machine review failed: ${error.message}`); }
		}
		for (const key of this.table("presentations").keys()) {
			const row = this.table("presentations").get(key);
			if (row.status !== "running" || !row.pptxPath || row.qa?.ok) continue;
			try { await this.validatePresentation({ runId: key }); }
			catch (error) { this.ctx.logger.warn(`legacy presentation '${key}' machine QA failed: ${error.message}`); }
		}
	}

	/**
	 * 升级迁移：旧版 project_sessions 行是 `{ projectId, sessionId, workspaceId }`
	 * （单会话绑定）；新版为工作区级 `{ projectId, workspaceId, sessionIds[] }`。
	 * 启动时把旧 `sessionId` 收进 `sessionIds`，保证既有会话继续可反查。
	 */
	async migrateLegacySessionBindings() {
		const table = this.table("sessions");
		for (const key of table.keys()) {
			const row = table.get(key);
			if (row.sessionId !== undefined && Array.isArray(row.sessionIds) === false) {
				await table.put(key, {
					projectId: row.projectId,
					workspaceId: row.workspaceId,
					sessionIds: [row.sessionId],
					createdAt: row.createdAt ?? new Date().toISOString()
				});
			}
		}
	}

	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labTasks is not started yet");
		return t;
	}

	requireProject(id) {
		const project = this.table("projects").get(id);
		if (project === undefined) throw new Error(`project '${id}' not found`);
		return project;
	}

	/** 更新一行并校验状态迁移。 */
	async transit(tableName, id, patch, now = new Date().toISOString()) {
		const table = this.table(tableName);
		const row = table.get(id);
		if (row === undefined) throw new Error(`${tableName} '${id}' not found`);
		if (patch.status && patch.status !== row.status) {
			if (!canTransit(row.status, patch.status)) {
				throw new Error(`invalid transition ${row.status} -> ${patch.status} for ${tableName} '${id}'`);
			}
		}
		const next = { ...row, ...patch, updatedAt: now };
		await table.put(id, next);
		return next;
	}

	/** 记录 ArtifactProvenance。 */
	async recordProvenance({ projectId, kind, runId, inputs, model, source }) {
		const skillName = KIND_TO_SKILL[kind];
		const skill = skillName ? await this.ctx.labVersions.resolveNatureSkill(skillName) : undefined;
		const now = new Date().toISOString();
		const id = `${kind}-${runId}`;
		const record = artifactProvenanceSchema.parse({
			id,
			projectId,
			kind,
			runId,
			inputsSha256: createHash("sha256").update(JSON.stringify(inputs ?? {})).digest("hex"),
			skillVersions: skill
				? [{ skillName: skill.skillName, commitSha: skill.commitSha, manifestVersion: skill.manifestVersion }]
				: [],
			model,
			source: source ?? "labTasks",
			createdAt: now
		});
		await this.table("provenance").put(id, record);
		return record;
	}

	// ── 项目 ────────────────────────────────────────────────────────────────

	/** 创建项目：保存所选目标/模板版本快照 + 创建专属工作区目录（§五 步骤 1）。 */
	async createProject({ id, name, coreMarkdown, memoryChangeNote, goalProfileId, goalProfileVersion, templateId, templateVersion }) {
		if (this.table("projects").get(id) !== undefined) throw new Error(`project '${id}' already exists`);
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		const now = new Date().toISOString();
		// 课题专属工作区目录：workspace.create 采纳一个已存在目录。
		const workspacePath = join(this.projectsRoot, id);
		await mkdir(workspacePath, { recursive: true });
		const project = labProjectSchema.parse({
			id,
			name,
			goalProfile: { id: goal.id, version: goal.version, snapshot: goal },
			template: { id: template.id, version: template.version, snapshot: template },
			status: "active",
			memoryVersion: "1",
			workspacePath,
			createdAt: now,
			updatedAt: now
		});
		const markdown = coreMarkdown?.trim() || [
			`# ${name}`,
			"",
			"## 核心课题",
			"请在此描述研究问题、核心假设和预期目标。",
			"",
			"## 当前进展",
			"- 项目已创建"
		].join("\n");
		const memory = projectMemoryVersionSchema.parse({
			id: projectMemoryKey(id, "1"),
			projectId: id,
			version: "1",
			markdown,
			changeNote: memoryChangeNote?.trim() || "创建课题核心记忆",
			contentSha256: createHash("sha256").update(markdown).digest("hex"),
			createdAt: now
		});
		await this.table("projects").put(id, project);
		await this.table("memories").put(memory.id, memory);
		await this.writeProjectMemoryFile(id);
		return project;
	}

	listProjects() {
		return [...this.table("projects").keys()].sort().map((k) => this.table("projects").get(k));
	}

	/**
	 * 彻底删除课题：先校验并删除插件专属 projects/<id> 工作区目录，再级联
	 * 删除任务域中的课题数据。Harness 工作区注册由浏览器侧 WorkspaceRuntime
	 * 删除；这里不接触 `.dsh/sessions` 中由 Harness 自己管理的会话日志。
	 */
	async deleteProject(projectId) {
		const project = this.requireProject(projectId);
		const projectsRoot = resolve(this.projectsRoot);
		const expectedPath = resolve(projectsRoot, projectId);
		const workspacePath = resolve(project.workspacePath ?? expectedPath);
		if (workspacePath !== expectedPath || workspacePath === projectsRoot) {
			throw new Error(`refusing to delete project workspace outside '${projectsRoot}': ${workspacePath}`);
		}

		// 先删文件；若权限等原因失败则保留登记，修正后可安全重试。
		await rm(workspacePath, { recursive: true, force: true });

		const deleted = {};
		for (const tableName of ["provenance", "presentations", "reports", "bundles", "searches", "memories", "sessions"]) {
			const table = this.table(tableName);
			let count = 0;
			for (const key of [...table.keys()]) {
				const row = table.get(key);
				if (row?.projectId !== projectId) continue;
				if (await table.delete(key)) count += 1;
			}
			deleted[tableName] = count;
		}
		deleted.projects = await this.table("projects").delete(projectId) ? 1 : 0;
		return { projectId, workspacePath, deleted };
	}

	/** 确保课题有专属工作区目录（升级前的旧项目可能没有 workspacePath）：
	 *  有则返回原路径；没有则建默认目录并写回项目行。同时确保核心记忆文件
	 *  「项目记忆.md」存在（旧项目缺文件时补写）。返回 { path }。 */
	async ensureProjectWorkspace(projectId) {
		const project = this.requireProject(projectId);
		let workspacePath = project.workspacePath;
		if (!workspacePath) {
			workspacePath = join(this.projectsRoot, projectId);
			await mkdir(workspacePath, { recursive: true });
			const updated = { ...project, workspacePath };
			await this.table("projects").put(projectId, updated);
		}
		const memoryFile = join(workspacePath, LabTasksService.PROJECT_MEMORY_FILE);
		if (!existsSync(memoryFile)) await this.writeProjectMemoryFile(projectId);
		return { path: workspacePath };
	}

	/** 把当前版本核心记忆落盘到课题工作区 `项目记忆.md`（无工作区则跳过）。
	 *  文件头带版本与变更说明，供 agent 读取时识别当前版本。 */
	async writeProjectMemoryFile(projectId) {
		const project = this.requireProject(projectId);
		if (!project.workspacePath) return;
		const memory = this.getProjectMemory(projectId);
		if (memory === undefined) return;
		const header = [
			`# ${project.name} — 课题核心记忆`,
			"",
			`> 版本 v${memory.version} · 更新于 ${memory.createdAt} · ${memory.changeNote ?? ""}`,
			"> 本文件是课题的长期记忆，由「课题核心记忆」面板/`lab_project_memory_update` 维护，",
			"> 每次提交新版本会整体重写。阅读时以文件内容为准，勿参考其他孤立文件。",
			""
		].join("\n");
		await writeFile(join(project.workspacePath, LabTasksService.PROJECT_MEMORY_FILE), header + memory.markdown + "\n", "utf8");
	}

	/** 记录课题 ↔ 工作区绑定（工作区级：该空间内所有会话归属同一课题）。 */
	async bindProjectWorkspace({ projectId, workspaceId }) {
		this.requireProject(projectId);
		const existing = this.getProjectSession(projectId);
		const now = new Date().toISOString();
		const row = projectSessionSchema.parse(existing ?? { projectId, workspaceId, sessionIds: [], createdAt: now });
		row.workspaceId = workspaceId;
		if (existing === undefined) row.createdAt = now;
		await this.table("sessions").put(projectSessionKey(projectId), row);
		return row;
	}

	/** 记录某个会话归属课题（追加进 sessionIds；重复调用幂等）。 */
	async bindProjectSession({ projectId, sessionId, workspaceId }) {
		this.requireProject(projectId);
		const existing = this.getProjectSession(projectId);
		const now = new Date().toISOString();
		const row = projectSessionSchema.parse(existing ?? { projectId, workspaceId, sessionIds: [], createdAt: now });
		if (existing === undefined) row.createdAt = now;
		if (workspaceId !== undefined) row.workspaceId = workspaceId;
		if (!row.sessionIds.includes(sessionId)) row.sessionIds = [...row.sessionIds, sessionId];
		await this.table("sessions").put(projectSessionKey(projectId), row);
		return row;
	}

	/** 查询某课题的工作区/会话绑定（无则返回 undefined）。 */
	getProjectSession(projectId) {
		return this.table("sessions").get(projectSessionKey(projectId));
	}

	/** 反查：某 Harness 会话属于哪个课题（launch 绑定过的会话；无则返回 undefined）。 */
	getProjectBySession(sessionId) {
		for (const key of this.table("sessions").keys()) {
			const row = this.table("sessions").get(key);
			if ((row.sessionIds ?? []).includes(sessionId) || row.sessionId === sessionId) {
				const project = this.table("projects").get(row.projectId);
				if (project !== undefined) return { project, sessionId, workspaceId: row.workspaceId };
			}
		}
		return undefined;
	}

	/** 反查：某工作区属于哪个课题（该空间内所有会话都共享课题标识与记忆）。 */
	getProjectByWorkspace(workspaceId) {
		for (const key of this.table("sessions").keys()) {
			const row = this.table("sessions").get(key);
			if (row.workspaceId === workspaceId) {
				const project = this.table("projects").get(row.projectId);
				if (project !== undefined) return { project, workspaceId, sessionIds: row.sessionIds ?? [] };
			}
		}
		return undefined;
	}

	/** 反查：某工作目录（cwd）属于哪个课题。匹配 project.workspacePath，
	 *  不依赖绑定记录——同一课题空间里手动新建的会话也能识别课题。 */
	getProjectByCwd(path) {
		if (!path) return undefined;
		const normalized = String(path).replace(/[\\/]+$/, "");
		for (const id of this.table("projects").keys()) {
			const project = this.table("projects").get(id);
			if (project.workspacePath && String(project.workspacePath).replace(/[\\/]+$/, "") === normalized) {
				const row = this.getProjectSession(id);
				return { project, workspaceId: row?.workspaceId, sessionIds: row?.sessionIds ?? [] };
			}
		}
		return undefined;
	}

	getProjectMemory(projectId, version) {
		const project = this.requireProject(projectId);
		const resolvedVersion = version ?? project.memoryVersion;
		return this.table("memories").get(projectMemoryKey(projectId, resolvedVersion));
	}

	listProjectMemoryVersions(projectId) {
		this.requireProject(projectId);
		return [...this.table("memories").keys()]
			.map((key) => this.table("memories").get(key))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => Number(b.version) - Number(a.version));
	}

	async updateProjectMemory({ projectId, markdown, changeNote }) {
		const project = this.requireProject(projectId);
		const normalized = markdown?.trim();
		if (!normalized) throw new Error("project core markdown must not be empty");
		const current = this.getProjectMemory(projectId);
		if (current?.markdown === normalized) throw new Error("project core markdown has not changed");
		// 兼容升级前已存在、尚无 memory 行的项目：第一次提交从 v1 开始。
		const version = current === undefined ? "1" : String(Number(project.memoryVersion) + 1);
		const now = new Date().toISOString();
		const memory = projectMemoryVersionSchema.parse({
			id: projectMemoryKey(projectId, version),
			projectId,
			version,
			markdown: normalized,
			changeNote: changeNote?.trim() || "更新课题核心记忆",
			contentSha256: createHash("sha256").update(normalized).digest("hex"),
			createdAt: now
		});
		await this.table("memories").put(memory.id, memory);
		await this.table("projects").put(projectId, { ...project, memoryVersion: version, updatedAt: now });
		await this.writeProjectMemoryFile(projectId);
		return memory;
	}

	// ── §六 接口：文献检索 ───────────────────────────────────────────────────

	/** searchLiterature：多源检索、统一字段、去重排序并严格过滤主题检索的 OA 结果。 */
	async searchLiterature({ projectId, query, title, sources, limit, sort, yearFrom, oaOnly = true, runId, mailto, model, sessionId }) {
		this.requireProject(projectId);
		const selectedSources = sources?.length ? sources : DEFAULT_SOURCES;
		const sessionRows = sessionId ? [...this.table("searches").keys()].map((key) => this.table("searches").get(key)).filter((row) => row.projectId === projectId && row.sessionId === sessionId) : [];
		const explicit = runId ? this.table("searches").get(runId) : undefined;
		const prior = explicit ?? mergeSessionSearchRows(sessionRows);
		const id = runId ?? prior?.id ?? `search-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const queries = [...new Set([...(prior?.queries?.length ? prior.queries : (prior?.query ? [prior.query] : [])), query])];
		const run = literatureSearchRunSchema.parse({
			...prior,
			id,
			projectId,
			title: searchEntryTitle(title ?? prior?.title, query),
			query,
			queries,
			sources: [...new Set([...(prior?.sources ?? []), ...selectedSources])],
			oaOnly,
			limit: limit ?? 10,
			sort: sort ?? "relevance_score",
			yearFrom,
			status: "running",
			progress: `searching ${selectedSources.join(", ")}`,
			sessionId,
			createdAt: prior?.createdAt ?? now,
			updatedAt: now
		});
		await this.table("searches").put(id, run);
		try {
			const results = await this.executor.search(query, { sources: selectedSources, limit: limit ?? 10, sort: sort ?? "relevance_score", yearFrom, mailto, oaOnly });
			const meta = results.meta ?? { failures: [], identifier: undefined };
			if (results.length === 0 && meta.failures?.length === selectedSources.length) {
				throw new Error(`all literature sources failed: ${meta.failures.map((failure) => `${failure.source}: ${failure.message}`).join("; ")}`);
			}
			const normalized = results.map(cleanSearchPaper);
			const combined = deduplicatePapers([...(prior?.results ?? []), ...normalized]).map(cleanSearchPaper);
			const failures = [...new Map([...(prior?.sourceFailures ?? []), ...(meta.failures ?? [])].map((failure) => [`${failure.source}\n${failure.message}`, failure])).values()];
			const next = literatureSearchRunSchema.parse({
				...run,
				status: "succeeded",
				progress: `${combined.length} references from ${queries.length} queries${meta.failures?.length ? `; ${meta.failures.length} source(s) degraded` : ""}`,
				results: combined,
				sourceFailures: failures,
				identifier: queries.length === 1 ? meta.identifier : undefined,
				updatedAt: new Date().toISOString()
			});
			await this.table("searches").put(id, next);
			await this.recordProvenance({ projectId, kind: "search", runId: id, inputs: { queries, sources: next.sources, limit, sort, yearFrom, oaOnly }, model });
			return next;
		} catch (error) {
			await this.table("searches").put(id, literatureSearchRunSchema.parse({
				...run,
				status: prior?.results?.length ? "succeeded" : "failed",
				error: error.message,
				progress: prior?.results?.length ? `${prior.results.length} references; latest query failed` : "failed",
				updatedAt: new Date().toISOString()
			}));
			throw error;
		}
	}

	/** 用 Agent 对摘要/标题的理解，为检索结果写入九字内核心内容概括。 */
	async updateSearchSummaries({ runId, summaries }) {
		const aggregate = this.getSearchRun(runId);
		if (aggregate === undefined) throw new Error(`search run '${runId}' not found`);
		const accepted = [];
		const rejected = [];
		for (const item of summaries ?? []) {
			const paperId = String(item?.paperId ?? "").trim();
			try {
				if (!paperId) throw new Error("paperId 为空");
				accepted.push({ paperId, lookup: normalizePaperLookup(paperId), summaryZh: normalizeAbstractSummary(item?.summaryZh ?? item?.summary) });
			} catch (error) {
				rejected.push({ paperId, reason: error.message });
			}
		}
		if (!accepted.length && !rejected.length) throw new Error("summaries must not be empty");
		const table = this.table("searches");
		const rows = [...table.keys()].map((key) => table.get(key)).filter((row) =>
			row.id === runId || (aggregate.sessionId && row.projectId === aggregate.projectId && row.sessionId === aggregate.sessionId));
		const matched = new Set();
		for (const row of rows) {
			let changed = false;
			const results = (row.results ?? []).map((paper) => {
				const entry = accepted.find((item) => searchPaperMatches(paper, item.lookup));
				if (!entry) return paper;
				changed = true;
				matched.add(entry.paperId);
				return { ...paper, shortDescriptionZh: entry.summaryZh };
			});
			if (changed) await table.put(row.id, literatureSearchRunSchema.parse({ ...row, results, updatedAt: new Date().toISOString() }));
		}
		const unmatched = accepted.filter((item) => !matched.has(item.paperId)).map((item) => item.paperId);
		return {
			run: this.getSearchRun(runId),
			updated: matched.size,
			unmatched,
			rejected,
			availablePaperIds: aggregate.results.map(publicSearchPaperId)
		};
	}

	/** 检索结果导出（format-converter.py；需网络访问 PubMed/CrossRef/arXiv）。 */
	async exportSearchCitations(runId, { format = "ris" } = {}) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const dois = run.results.map((r) => r.doi).filter(Boolean).slice(0, 10);
		if (dois.length === 0) throw new Error("no DOIs to export");
		const result = await this.executor.exportCitations({ doi: dois.join(",") }, { format });
		return { format, text: result.stdout };
	}

	// ── §六·面板 接口：检索 .ris / 精读概览 / 产物下载 ────────────────────────

	/**
	 * 把一条检索 run 的 results 离线重建为 RIS 文本（不依赖网络导出）。
	 * 条目面板的 .ris 按钮据此在浏览器触发下载，RIS 内就是该检索登记到的文献。
	 */
	searchRunRis(runId) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const results = run.results ?? [];
		if (results.length === 0) throw new Error(`search run '${runId}' has no results to export`);
		const lines = [];
		for (const r of results) {
			lines.push("TY  - JOUR");
			for (const author of (r.authors ?? [])) lines.push(`AU  - ${author}`);
			if (r.title) lines.push(`TI  - ${r.title}`);
			if (r.year) lines.push(`PY  - ${r.year}`);
			if (r.doi) lines.push(`DO  - ${r.doi}`);
			if (r.journal || (r.source && r.source !== "openalex")) lines.push(`JO  - ${r.journal ?? r.source}`);
			if (r.volume) lines.push(`VL  - ${r.volume}`);
			if (r.issue) lines.push(`IS  - ${r.issue}`);
			if (r.pages) {
				const [startPage, endPage] = String(r.pages).split(/[-–]/, 2);
				if (startPage) lines.push(`SP  - ${startPage}`);
				if (endPage) lines.push(`EP  - ${endPage}`);
			}
			if (r.abstract) lines.push(`AB  - ${r.abstract}`);
			if (r.pdfUrl) lines.push(`UR  - ${r.pdfUrl}`);
			lines.push("ER  -");
			lines.push("");
		}
		return { format: "ris", fileName: `${run.id}.ris`, text: lines.join("\n"), count: results.length };
	}

	/** 200字概览卡片：优先登记时的 summary，缺省从 paper-card 推导。 */
	async readingReportOverview(reportId) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		const bundle = this.table("bundles").get(report.bundleId);
		const shortCitation = normalizeJournalShortCitation(report.shortCitation, bundle?.title) || report.shortCitation || bundle?.title || report.id;
		const titleZh = report.titleZh || bundle?.title || shortCitation;
		let summary = report.summary;
		if (!summary && report.paperCardPath && existsSync(report.paperCardPath)) {
			summary = await this.deriveCardSummary(report.paperCardPath);
		}
		if (!summary) summary = "暂无概览：完成 paper card 精读登记后自动生成。";
		return { reportId, shortCitation, titleZh, summary };
	}

	/** 从 paper-card markdown 推导一段约 200 字的概览（body 首段，过滤元信息/标题/表格）。 */
	async deriveCardSummary(paperCardPath, budget = 200) {
		const markdown = await readFile(paperCardPath, "utf8");
		const kept = [];
		for (const raw of markdown.split(/\r?\n/)) {
			const line = raw.trim();
			if (line === "") continue;
			if (line.startsWith(">")) continue; // 元信息块
			if (/^#{1,6}\s/.test(line)) continue; // 标题
			if (/^\|.*\|$/.test(line)) continue; // 表格行
			kept.push(line);
		}
		let text = kept.join(" ").replace(/\s+/g, " ").trim();
		if (text.length > budget) text = text.slice(0, budget).replace(/\s+\S*$/, "") + "…";
		return text;
	}

	/** 下载门禁：人工审核必须绑定到当前实际 Office 文件的 SHA-256。 */
	assertApprovedArtifact(row, label, sha256) {
		if (row.review?.status !== "approved") throw new Error(`${label} is awaiting human review; preview it and approve before download`);
		if (!row.review?.artifactSha256 || row.review.artifactSha256 !== sha256) {
			throw new Error(`${label} changed after review; preview and approve the current version again`);
		}
	}

	/** 生成或接收一次性的实际 DOCX 暂存文件；预览和最终下载始终读取同一文件。 */
	async materializeReadingDocx(report, providedPath) {
		if (!report.paperCardPath || !existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath ?? "(empty path)"}`);
		let docxPath = providedPath;
		if (docxPath) {
			if (!existsSync(docxPath)) throw new Error(`docx file missing: ${docxPath}`);
		} else {
			docxPath = join(dirname(report.paperCardPath), `${report.id}.docx`);
			const content = await readFile(report.paperCardPath, "utf8");
			const buffer = await markdownToDocx(content, { title: report.titleZh || report.shortCitation || report.id });
			await writeFile(docxPath, buffer);
		}
		const buffer = await readFile(docxPath);
		const integrity = await inspectOfficePackage(buffer, "docx");
		return { docxPath, buffer, integrity };
	}

	/** 构造精读报告文件；默认只允许下载已人工审核且哈希未变化的版本。 */
	async readingReportFile(reportId, format = "md", { requireApproved = true } = {}) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card yet`);
		if (!existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath}`);
		if (!report.docxPath || !existsSync(report.docxPath)) throw new Error(`reading report '${reportId}' has no staged DOCX yet`);
		const docxBuffer = await readFile(report.docxPath);
		const docxIntegrity = await inspectOfficePackage(docxBuffer, "docx");
		if (requireApproved) this.assertApprovedArtifact(report, `reading report '${reportId}'`, docxIntegrity.sha256);
		const base = `${reportId}`;
		if (format === "docx") {
			return {
				fileName: `${base}.docx`,
				mime: docxIntegrity.mime,
				buffer: docxBuffer,
				format: "docx",
				byteLength: docxIntegrity.byteLength,
				sha256: docxIntegrity.sha256
			};
		}
		const content = await readFile(report.paperCardPath, "utf8");
		const buffer = Buffer.from(content, "utf8");
		return {
			fileName: `${base}.md`,
			mime: "text/markdown;charset=utf-8",
			buffer,
			text: content,
			format: "md",
			byteLength: buffer.length,
			sha256: createHash("sha256").update(buffer).digest("hex")
		};
	}

	/** RPC 兼容接口；Web 面板使用 /api/lab-artifacts 二进制流，不再走这里的 base64。 */
	async readingReportDownload(reportId, format = "md") {
		const file = await this.readingReportFile(reportId, format);
		if (file.format === "docx") {
			return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
		}
		return { ...file, buffer: undefined };
	}

	/** 该 report 的全部 PPT run，按时间倒序（最新在前）。 */
	listPresentationsForReport(reportId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.reportId === reportId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/** 文献汇报 PPT 文件：找到该 report 最新的含 pptx 的 run并验证 OOXML。 */
	async presentationFile(reportId, { requireApproved = true } = {}) {
		const run = this.listPresentationsForReport(reportId).find((r) => r.pptxPath && existsSync(r.pptxPath));
		if (run === undefined) throw new Error(`reading report '${reportId}' has no downloadable PPTX yet`);
		const buffer = await readFile(run.pptxPath);
		const integrity = await inspectOfficePackage(buffer, "pptx");
		if (requireApproved) this.assertApprovedArtifact(run, `presentation '${run.id}'`, integrity.sha256);
		return {
			fileName: `${run.id}.pptx`,
			mime: integrity.mime,
			buffer,
			byteLength: integrity.byteLength,
			sha256: integrity.sha256
		};
	}

	/** RPC 兼容接口；Web 面板改用二进制 HTTP 流。 */
	async presentationDownload(reportId) {
		const file = await this.presentationFile(reportId);
		return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
	}

	// ── §六 接口：论文准备 ───────────────────────────────────────────────────

	/**
	 * preparePaper：登记原文（PDF 或 nature-reader 的 source_map JSON），计算
	 * 哈希，调用 prepare_paper.py 生成规范化 source_bundle.json。
	 * PDF 输入需要 venv 安装 PyMuPDF（prepare_paper.py 依赖）；source_map 输入
	 * 仅 stdlib。PDF 与 sourceMap 至少给一个。
	 */
	async preparePaper({ projectId, pdfPath, sourceMapPath, title, bundleId, renderDir, model }) {
		this.requireProject(projectId);
		if (!pdfPath && !sourceMapPath) throw new Error("preparePaper requires pdfPath or sourceMapPath");
		if (pdfPath && !existsSync(pdfPath)) throw new Error(`pdf not found: ${pdfPath}`);
		if (sourceMapPath && !existsSync(sourceMapPath)) throw new Error(`source map not found: ${sourceMapPath}`);
		const inputPath = sourceMapPath ?? pdfPath;
		const pdfSha256 = createHash("sha256").update(await readFile(inputPath)).digest("hex");
		const id = bundleId ?? `bundle-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const bundle = paperSourceBundleSchema.parse({
			id,
			projectId,
			title: title ?? "",
			pdfPath: pdfPath ?? inputPath,
			pdfSha256,
			locatorMode: sourceMapPath ? "structure-grounded" : "page-grounded",
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("bundles").put(id, bundle);
		try {
			await this.transit("bundles", id, { status: "running", progress: "preparing source bundle" });
			const output = join(dirname(inputPath), `${id}-source_bundle.json`);
			const sourceMap = await this.executor.preparePaper(inputPath, output, { renderDir });
			const next = await this.transit("bundles", id, {
				status: "succeeded",
				progress: "source bundle ready",
				sourceMapPath: output,
				locatorMode: sourceMap.locator_mode ?? (sourceMapPath ? "structure-grounded" : "page-grounded")
			});
			await this.recordProvenance({ projectId, kind: "source-bundle", runId: id, inputs: { input: pdfSha256, title }, model });
			return next;
		} catch (error) {
			await this.transit("bundles", id, { status: "failed", error: error.message, progress: "failed" });
			throw error;
		}
	}

	// ── §六 接口：精读报告 ───────────────────────────────────────────────────

	/** createReadingReport：目标快照 + paper-card 审查要求，创建待精读报告。 */
	async createReadingReport({ projectId, bundleId, goalProfileId, goalProfileVersion, noteTemplateId, noteTemplateVersion, reportId, model, shortCitation, titleZh, summary }) {
		this.requireProject(projectId);
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.status !== "succeeded") throw new Error(`source bundle '${bundleId}' is ${bundle.status}, expected succeeded`);
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const requirements = toPaperCardRequirements(goal);
		// 阅读笔记模板快照：可选；缺省用内置 note-default（仅当 labNoteTemplates
		// 已注册时快照；未注册的服务不阻塞既有流程）。
		let noteTemplateSnapshot;
		let noteRequirements;
		try {
			const noteService = this.ctx.labNoteTemplates;
			const noteId = noteTemplateId ?? "note-default";
			const note = await noteService.snapshotForTask(noteId, noteTemplateVersion);
			noteTemplateSnapshot = note;
			noteRequirements = note;
			noteRequirements = noteService.toNoteRequirements(note);
		} catch (error) {
			this.ctx.logger.warn(`createReadingReport: note template snapshot skipped: ${String(error)}`);
		}
		const id = reportId ?? `report-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const report = readingReportSchema.parse({
			id,
			projectId,
			bundleId,
			goalSnapshot: goal,
			paperCardRequirements: requirements,
			noteTemplateSnapshot,
			noteRequirements,
			locatorMode: bundle.locatorMode,
			status: "pending",
			shortCitation: normalizeJournalShortCitation(shortCitation, bundle.title) ?? shortCitation ?? bundle.title ?? undefined,
			titleZh,
			summary,
			createdAt: now,
			updatedAt: now
		});
		await this.table("reports").put(id, report);
		return report;
	}

	/** completeReadingReport：把实际 DOCX 自动暂存到文献条目，再运行非阻断自查。 */
	async completeReadingReport({ reportId, paperCardPath, docxPath, locatorMode, model, shortCitation, titleZh, summary }) {
		const existing = this.table("reports").get(reportId);
		if (existing === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!paperCardPath || !existsSync(paperCardPath)) throw new Error(`paper card file missing: ${paperCardPath ?? "(empty path)"}`);
		const patch = {
			status: "under-review",
			progress: "DOCX staged; lightweight self-check pending",
			paperCardPath,
			locatorMode: locatorMode ?? existing.locatorMode,
			audit: { ok: false, errors: 0, warnings: 0, summary: "" },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		};
		if (shortCitation !== undefined) patch.shortCitation = normalizeJournalShortCitation(shortCitation, existing.shortCitation, this.table("bundles").get(existing.bundleId)?.title) ?? shortCitation;
		if (titleZh !== undefined) patch.titleZh = titleZh;
		if (summary !== undefined) patch.summary = summary;
		const staged = await this.materializeReadingDocx({ ...existing, ...patch }, docxPath);
		patch.docxPath = staged.docxPath;
		patch.artifactSha256 = staged.integrity.sha256;
		const report = await this.transit("reports", reportId, patch);
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { paperCardPath, locatorMode },
			model
		});
		return await this.validateReadingReport({ reportId, model });
	}

	/** 机器自查：只提供提醒；无论发现多少问题，实际产物都留在人工审阅暂存区。 */
	async validateReadingReport({ reportId, locatorMode, auditReportPath, model }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card; complete it first`);
		await this.transit("reports", reportId, { status: "under-review", progress: "running lightweight self-check; human review remains available" });
		const cardText = await readFile(report.paperCardPath, "utf8");
		const declaredMode = cardText.match(/locator[ _-]*mode[^\n]*(page-grounded|structure-grounded|source-limited)/i)?.[1]?.toLowerCase();
		const mode = locatorMode ?? declaredMode ?? report.locatorMode;
		const reportOut = auditReportPath ?? join(dirname(report.paperCardPath), `${reportId}-audit-report.json`);
		let result;
		try {
			const bundlePath = this.table("bundles").get(report.bundleId)?.sourceMapPath;
			result = /^##\s+01\b/m.test(cardText)
				? await this.executor.auditPaperCard({ card: report.paperCardPath, bundle: bundlePath, locatorMode: mode, report: reportOut })
				: await auditReadingNote({ cardPath: report.paperCardPath, bundlePath, locatorMode: mode, noteRequirements: report.noteRequirements, reportPath: reportOut });
		} catch (error) {
			return await this.transit("reports", reportId, {
				status: "under-review",
				progress: "self-check unavailable; awaiting human review",
				auditReportPath: reportOut,
				audit: { ok: false, errors: 0, warnings: 1, summary: `自查未完成：${error.message}` },
				error: undefined
			});
		}
		const next = await this.transit("reports", reportId, {
			status: "under-review",
			progress: result.ok ? "self-check completed; awaiting human review" : `self-check found ${result.errors} issue(s); awaiting human review`,
			locatorMode: mode,
			auditReportPath: reportOut,
			audit: { ok: result.ok, errors: result.errors, warnings: result.warnings, summary: result.summary }
		});
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { audit: reportOut, locatorMode: mode },
			model,
			source: "audit_paper_card.py"
		});
		return next;
	}

	/** 人工审阅精读报告：机器自查不设门槛；通过时绑定实际 DOCX 哈希。 */
	async reviewReadingReport({ reportId, decision, note, reviewer = "human-ui" }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (report.status !== "under-review") throw new Error(`reading report '${reportId}' is ${report.status}; only under-review can be reviewed`);
		if (!report.paperCardPath || !existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const staged = await this.materializeReadingDocx(report, report.docxPath);
		const reviewedAt = new Date().toISOString();
		return await this.transit("reports", reportId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: staged.integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: staged.integrity.sha256 }
		}, reviewedAt);
	}

	// ── §六 接口：PPT 生成 ───────────────────────────────────────────────────

	/** createPresentation：报告已有暂存产物即可制作；模板只作格式参考，不作阻断门禁。 */
	async createPresentation({ projectId, reportId, templateId, templateVersion, runId, model, skipAudit = false }) {
		this.requireProject(projectId);
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath || !report.docxPath) throw new Error(`reading report '${reportId}' has no staged report artifact yet`);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		try {
			const templateValidation = await this.ctx.labTemplates.validate(templateId, templateVersion);
			if (!templateValidation.ok) this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} has advisory issues: ${templateValidation.problems.join("; ")}`);
		} catch (error) {
			this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} advisory validation unavailable: ${error.message}`);
		}
		const id = runId ?? `pres-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const run = presentationRunSchema.parse({
			id,
			projectId,
			reportId,
			templateSnapshot: template,
			auditSkipped: skipAudit,
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("presentations").put(id, run);
		return run;
	}

	/** completePresentation：实际 PPTX 完整即可暂存；版面 QA 只作非阻断提醒。 */
	async completePresentation({ runId, pptxPath, outlinePath, speechNotesPath, figureSourcesPath, model }) {
		if (!pptxPath || !existsSync(pptxPath)) throw new Error(`pptx file missing: ${pptxPath ?? "(empty path)"}`);
		const integrity = await inspectOfficePackage(await readFile(pptxPath), "pptx");
		const run = await this.transit("presentations", runId, {
			status: "under-review",
			progress: "PPTX staged; lightweight self-check pending",
			pptxPath,
			artifactSha256: integrity.sha256,
			outlinePath,
			speechNotesPath,
			figureSourcesPath,
			qa: { ok: false, high: 0, medium: 0, low: 0 },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptxPath, outlinePath },
			model
		});
		return await this.validatePresentation({ runId, model });
	}

	/** 机器 QA：只给人工审阅提供提醒，高风险项也不阻断预览和人工决定。 */
	async validatePresentation({ runId, failOn = "high", qaReportPath, qaJsonPath, model }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (!run.pptxPath) throw new Error(`presentation run '${runId}' has no pptx; complete it first`);
		await this.transit("presentations", runId, { status: "under-review", progress: "running lightweight PPT self-check; human review remains available" });
		const base = dirname(run.pptxPath);
		const report = qaReportPath ?? join(base, `${runId}-qa-report.md`);
		const json = qaJsonPath ?? join(base, `${runId}-qa.json`);
		let result;
		try {
			result = await this.executor.auditPptx({ pptx: run.pptxPath, report, json, failOn });
		} catch (error) {
			return await this.transit("presentations", runId, {
				status: "under-review",
				progress: "PPT self-check unavailable; awaiting human review",
				qa: { ok: false, high: 0, medium: 1, low: 0, reportPath: report, jsonPath: json },
				error: undefined
			});
		}
		const next = await this.transit("presentations", runId, {
			status: "under-review",
			progress: result.ok ? "PPT self-check completed; awaiting human review" : `PPT self-check found ${result.findingCounts.high} high-risk item(s); awaiting human review`,
			qa: { ok: result.ok, ...result.findingCounts, reportPath: report, jsonPath: json }
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptx: run.pptxPath, failOn },
			model,
			source: "audit_pptx_quality.py"
		});
		return next;
	}

	/** 人工审阅 PPT：以实际 PPTX 完整性和哈希绑定为硬条件，QA 提醒不设门槛。 */
	async reviewPresentation({ runId, decision, note, reviewer = "human-ui" }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (run.status !== "under-review") throw new Error(`presentation run '${runId}' is ${run.status}; only under-review can be reviewed`);
		if (!run.pptxPath || !existsSync(run.pptxPath)) throw new Error(`pptx file missing: ${run.pptxPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const integrity = await inspectOfficePackage(await readFile(run.pptxPath), "pptx");
		const reviewedAt = new Date().toISOString();
		return await this.transit("presentations", runId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: integrity.sha256 }
		}, reviewedAt);
	}

	// ── 查询 ────────────────────────────────────────────────────────────────

	getProject(id) {
		return this.table("projects").get(id);
	}

	/** 返回机器评审的结构化详情，供课题面板解释错误/提醒，避免只显示红绿状态。 */
	async machineReviewDetails({ reportId, runId }) {
		if ((reportId ? 1 : 0) + (runId ? 1 : 0) !== 1) throw new Error("provide exactly one of reportId or runId");
		if (reportId) {
			const report = this.getReadingReport(reportId);
			if (!report) throw new Error(`reading report '${reportId}' not found`);
			let detail;
			if (report.auditReportPath && existsSync(report.auditReportPath)) {
				try { detail = JSON.parse(await readFile(report.auditReportPath, "utf8")); } catch { detail = undefined; }
			}
			return { kind: "reading-report", id: reportId, ok: report.audit?.ok === true, status: report.status, summary: report.audit, reportPath: report.auditReportPath, findings: detail?.findings ?? [], metrics: detail?.metrics, auditMode: detail?.audit_mode ?? "paper-card" };
		}
		const run = this.getPresentationRun(runId);
		if (!run) throw new Error(`presentation run '${runId}' not found`);
		let detail;
		if (run.qa?.jsonPath && existsSync(run.qa.jsonPath)) {
			try { detail = JSON.parse(await readFile(run.qa.jsonPath, "utf8")); } catch { detail = undefined; }
		}
		return { kind: "presentation", id: runId, ok: run.qa?.ok === true, status: run.status, summary: run.qa, reportPath: run.qa?.reportPath, findings: detail?.findings ?? [], slideCount: detail?.slide_count };
	}

	getSearchRun(id) {
		const row = this.table("searches").get(id);
		if (!row?.sessionId) return row;
		const related = [...this.table("searches").keys()]
			.map((key) => this.table("searches").get(key))
			.filter((candidate) => candidate.projectId === row.projectId && candidate.sessionId === row.sessionId);
		return mergeSessionSearchRows(related);
	}

	listSearchRuns(projectId) {
		const rows = [...this.table("searches").keys()]
			.map((k) => this.table("searches").get(k))
			.filter((r) => r.projectId === projectId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const groups = new Map();
		for (const row of rows) {
			const key = row.sessionId ? `session:${row.sessionId}` : `run:${row.id}`;
			groups.set(key, [...(groups.get(key) ?? []), row]);
		}
		return [...groups.values()].map(mergeSessionSearchRows).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	listBundles(projectId) {
		return [...this.table("bundles").keys()]
			.map((k) => this.table("bundles").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	listReadingReports(projectId) {
		return [...this.table("reports").keys()]
			.map((k) => this.table("reports").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	listPresentationRuns(projectId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	getBundle(id) {
		return this.table("bundles").get(id);
	}

	getReadingReport(id) {
		return this.table("reports").get(id);
	}

	getPresentationRun(id) {
		return this.table("presentations").get(id);
	}

	listProvenance(projectId) {
		return [...this.table("provenance").keys()]
			.map((k) => this.table("provenance").get(k))
			.filter((p) => p.projectId === projectId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}
}

export default LabTasksService;
