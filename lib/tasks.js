/**
 * dsh-lab-agent: 文献→PPT 任务编排服务（Cordis host service, ctx.labTasks）。
 *
 * 计划 §五 流程 + §六 任务接口。机械化步骤直接调用 nature-skills 的 stdlib
 * 脚本（SkillExecutor）；LLM 驱动的步骤（精读报告、PPT 内容）由 agent 在会话
 * 中执行对应 skill 后调用 complete* 登记产物，再走审计门禁。
 *
 * 门禁（§五 步骤 6/10）：ReadingReport 审计 errors>0 时 createPresentation
 * 明确拒绝；PresentationRun 高严重度 QA 未清零时 validatePresentation 失败。
 * 每个产物记录 ArtifactProvenance（输入哈希 / skill 版本 / 模型 / 时间）。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { SkillExecutor } from "../src/skill-executor.js";
import { venvPythonPath } from "../src/python-env.js";
import { resolveDshHome, labAgentRoot } from "../src/paths.js";
import { toPaperCardRequirements } from "../src/goal-profile.js";
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

export class LabTasksService extends Service {
	static inject = ["storageDomain", "labGoals", "labTemplates", "labVersions"];
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
		await this.migrateLegacySessionBindings();
		this.executor = new SkillExecutor({
			skillsRoot: this.config.skillsRoot,
			venvPython: this.config.venvDir ? venvPythonPath(this.config.venvDir) : undefined
		});
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
		return project;
	}

	listProjects() {
		return [...this.table("projects").keys()].sort().map((k) => this.table("projects").get(k));
	}

	/** 确保课题有专属工作区目录（升级前的旧项目可能没有 workspacePath）：
	 *  有则返回原路径；没有则建默认目录并写回项目行。返回 { path }。 */
	async ensureProjectWorkspace(projectId) {
		const project = this.requireProject(projectId);
		if (project.workspacePath) return { path: project.workspacePath };
		const workspacePath = join(this.projectsRoot, projectId);
		await mkdir(workspacePath, { recursive: true });
		const updated = { ...project, workspacePath };
		await this.table("projects").put(projectId, updated);
		return { path: workspacePath };
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
		return memory;
	}

	// ── §六 接口：文献检索 ───────────────────────────────────────────────────

	/** searchLiterature：创建检索 run 并执行 OpenAlex 搜索。 */
	async searchLiterature({ projectId, query, sources, limit, sort, yearFrom, runId, mailto, model }) {
		this.requireProject(projectId);
		const id = runId ?? `search-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const run = literatureSearchRunSchema.parse({
			id,
			projectId,
			query,
			sources: sources ?? ["openalex", "crossref", "arxiv"],
			limit: limit ?? 10,
			sort: sort ?? "relevance_score",
			yearFrom,
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("searches").put(id, run);
		try {
			await this.transit("searches", id, { status: "running", progress: "searching OpenAlex" });
			const results = await this.executor.search(query, { limit, sort, yearFrom, mailto });
			const next = await this.transit("searches", id, {
				status: "succeeded",
				progress: `${results.length} results`,
				results: results.map((r) => ({
					title: String(r.title ?? r.display_name ?? "untitled"),
					doi: r.doi,
					authors: Array.isArray(r.authorships) ? r.authorships.map((a) => a.author?.display_name).filter(Boolean) : (r.authors ?? []),
					year: r.publication_year ?? r.year,
					citations: r.cited_by_count ?? r.citations,
					source: r.primary_location?.source?.display_name ?? "openalex"
				}))
			});
			await this.recordProvenance({ projectId, kind: "search", runId: id, inputs: { query, limit, sort, yearFrom }, model });
			return next;
		} catch (error) {
			await this.transit("searches", id, { status: "failed", error: error.message, progress: "failed" });
			throw error;
		}
	}

	/** 检索结果导出（format-converter.py；需网络访问 PubMed/CrossRef/arXiv）。 */
	async exportSearchCitations(runId, { format = "ris" } = {}) {
		const run = this.table("searches").get(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const dois = run.results.map((r) => r.doi).filter(Boolean).slice(0, 10);
		if (dois.length === 0) throw new Error("no DOIs to export");
		const result = await this.executor.exportCitations({ doi: dois.join(",") }, { format });
		return { format, text: result.stdout };
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
	async createReadingReport({ projectId, bundleId, goalProfileId, goalProfileVersion, reportId, model }) {
		this.requireProject(projectId);
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.status !== "succeeded") throw new Error(`source bundle '${bundleId}' is ${bundle.status}, expected succeeded`);
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const requirements = toPaperCardRequirements(goal);
		const id = reportId ?? `report-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const report = readingReportSchema.parse({
			id,
			projectId,
			bundleId,
			goalSnapshot: goal,
			paperCardRequirements: requirements,
			locatorMode: bundle.locatorMode,
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("reports").put(id, report);
		return report;
	}

	/** completeReadingReport：agent 执行 nature-paper-card 后登记产物。 */
	async completeReadingReport({ reportId, paperCardPath, locatorMode, model }) {
		const existing = this.table("reports").get(reportId);
		if (existing === undefined) throw new Error(`reading report '${reportId}' not found`);
		const report = await this.transit("reports", reportId, {
			status: "running",
			progress: "paper card written",
			paperCardPath,
			locatorMode: locatorMode ?? existing.locatorMode
		});
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { paperCardPath, locatorMode },
			model
		});
		return report;
	}

	/** validateReadingReport：门禁——运行 audit_paper_card.py，errors 阻止进入 PPT。 */
	async validateReadingReport({ reportId, locatorMode, auditReportPath, model }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card; complete it first`);
		await this.transit("reports", reportId, { status: "running", progress: "auditing paper card" });
		const mode = locatorMode ?? report.locatorMode;
		const reportOut = auditReportPath ?? join(dirname(report.paperCardPath), `${reportId}-audit-report.json`);
		const result = await this.executor.auditPaperCard({
			card: report.paperCardPath,
			bundle: this.table("bundles").get(report.bundleId)?.sourceMapPath,
			locatorMode: mode,
			report: reportOut
		});
		const next = await this.transit("reports", reportId, {
			status: result.ok ? "succeeded" : "failed",
			progress: result.ok ? "audit passed" : `audit failed (${result.errors} errors)`,
			locatorMode: mode,
			auditReportPath: reportOut,
			audit: { ok: result.ok, errors: result.errors, warnings: result.warnings, summary: result.summary }
		});
		if (!result.ok) throw new Error(`paper card audit failed with ${result.errors} error(s): ${result.summary}`);
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

	// ── §六 接口：PPT 生成 ───────────────────────────────────────────────────

	/** createPresentation：门禁——仅审计通过的报告可进入 PPT 阶段。 */
	async createPresentation({ projectId, reportId, templateId, templateVersion, runId, model }) {
		this.requireProject(projectId);
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (report.audit?.ok !== true) {
			throw new Error(`reading report '${reportId}' has not passed audit (status ${report.status}) — validateReadingReport first`);
		}
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		const templateValidation = await this.ctx.labTemplates.validate(templateId, templateVersion);
		if (!templateValidation.ok) {
			throw new Error(`template '${templateId}'@${templateVersion} invalid: ${templateValidation.problems.join("; ")} — fix before generating`);
		}
		const id = runId ?? `pres-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const run = presentationRunSchema.parse({
			id,
			projectId,
			reportId,
			templateSnapshot: template,
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("presentations").put(id, run);
		return run;
	}

	/** completePresentation：agent 执行 nature-paper2ppt 后登记产物。 */
	async completePresentation({ runId, pptxPath, outlinePath, speechNotesPath, figureSourcesPath, model }) {
		const run = await this.transit("presentations", runId, {
			status: "running",
			progress: "pptx written",
			pptxPath,
			outlinePath,
			speechNotesPath,
			figureSourcesPath
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptxPath, outlinePath },
			model
		});
		return run;
	}

	/** validatePresentation：门禁——audit_pptx_quality.py，高严重度未清零则失败。 */
	async validatePresentation({ runId, failOn = "high", qaReportPath, qaJsonPath, model }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (!run.pptxPath) throw new Error(`presentation run '${runId}' has no pptx; complete it first`);
		await this.transit("presentations", runId, { status: "running", progress: "auditing pptx" });
		const base = dirname(run.pptxPath);
		const report = qaReportPath ?? join(base, `${runId}-qa-report.md`);
		const json = qaJsonPath ?? join(base, `${runId}-qa.json`);
		const result = await this.executor.auditPptx({ pptx: run.pptxPath, report, json, failOn });
		const next = await this.transit("presentations", runId, {
			status: result.ok ? "succeeded" : "failed",
			progress: result.ok ? "qa passed" : `qa failed (high=${result.findingCounts.high})`,
			qa: { ok: result.ok, ...result.findingCounts, reportPath: report }
		});
		if (!result.ok) throw new Error(`pptx quality audit failed (high=${result.findingCounts.high}) — fix and re-validate`);
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

	// ── 查询 ────────────────────────────────────────────────────────────────

	getProject(id) {
		return this.table("projects").get(id);
	}

	getSearchRun(id) {
		return this.table("searches").get(id);
	}

	listSearchRuns(projectId) {
		return [...this.table("searches").keys()]
			.map((k) => this.table("searches").get(k))
			.filter((r) => r.projectId === projectId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
