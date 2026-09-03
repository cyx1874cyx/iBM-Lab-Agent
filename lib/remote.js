/**
 * dsh-lab-agent: lab 服务聚合 Remote（Cordis host service, ctx.labRemote）。
 *
 * 把 9 个 lab 服务的能力经 Typert Gateway 暴露给浏览器 client（ctx.remote.lab.*）。
 * 采用 TypertRemoteService + Remote 标记（JS 手写装饰器等价调用），host 端
 * api-gateway 的 source-mode discovery 自动生成描述符（无需生成器）。
 *
 * 参数约定：每个 Remote 方法只接收单个 `request` 对象参数（wire 与 host 的
 * source-mode 参数名推断一致，避免解构参数导致 signature-invalid）。
 * 返回值统一为 { ok, value } / { ok:false, error }（gateway 自动包装）。
 */

import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { join } from "node:path";
import { cleanJson } from "../src/json-boundary.js";
import { normalizeDoi } from "../src/literature/search-engine.js";
import { buildPlanDraftFields } from "../src/synthesis/plan-draft.js";

/** 手写 Remote 装饰器应用（等价 @Remote("name") 编译产物）。 */
function markRemote(prototype, name) {
	const initializers = [];
	const context = {
		kind: "method",
		name,
		static: false,
		private: false,
		access: {
			has: (obj) => name in obj,
			get: (obj) => obj[name]
		},
		metadata: {},
		addInitializer(fn) {
			initializers.push(fn);
		}
	};
	Remote(name)(prototype, context);
	return initializers;
}

export class LabRemoteService extends TypertRemoteService {
	static inject = ["labVersions", "labGoals", "labNoteTemplates", "labTemplates", "labTasks", "labLiterature", "labChemistry", "labNmr", "labSynthesis", "labPython", "labConvert", "labCapture"];
	initializers;

	constructor(ctx, config = {}) {
		super(ctx, "lab");
		this.config = config ?? {};
		// 运行 @Remote 装饰器注册的 initializer（以实例为 this）
		for (const init of REMOTE_INITIALIZERS) init.call(this);
	}

	require(name) {
		const service = this.ctx.get(name);
		if (service === undefined) throw new Error(`lab service '${name}' unavailable`);
		return service;
	}

	// ── labVersions（版本登记） ──────────────────────────────────────────────
	async versions_list() {
		return { rows: this.require("labVersions").snapshot() };
	}
	async versions_resolve(request) {
		return cleanJson({ version: this.require("labVersions").resolveNatureSkill(request.skillName) ?? null });
	}

	// ── labGoals（精读目标） ────────────────────────────────────────────────
	async goals_list() {
		return { goals: await this.require("labGoals").list() };
	}
	async goals_resolve(request) {
		return cleanJson({ goal: await this.require("labGoals").resolve(request.id, request.version) ?? null });
	}
	async goals_create(request) {
		return cleanJson({ goal: await this.require("labGoals").create(request.id, request.fields) });
	}
	async goals_update(request) {
		return cleanJson({ goal: await this.require("labGoals").update(request.id, request.fields) });
	}
	async goals_copy(request) {
		return cleanJson({ goal: await this.require("labGoals").copy(request.id, request.newId, request.name) });
	}
	async goals_delete(request) {
		await this.require("labGoals").deleteProfile(request.id);
		return cleanJson({ ok: true });
	}
	async goals_requirements(request) {
		const goal = await this.require("labGoals").resolve(request.id, request.version);
		if (goal === undefined) throw new Error(`goal '${request.id}' not found`);
		return cleanJson({ requirements: this.require("labGoals").toPaperCardRequirements(goal) });
	}

	// ── labTemplates（PPT 模板） ─────────────────────────────────────────────
	async templates_list() {
		return cleanJson({ templates: await this.require("labTemplates").list() });
	}
	async templates_resolve(request) {
		return cleanJson({ template: await this.require("labTemplates").resolve(request.id, request.version) ?? null });
	}
	async templates_preview(request) {
		return cleanJson({ preview: await this.require("labTemplates").preview(request.id, request.version) });
	}
	async templates_validate(request) {
		return cleanJson({ validation: await this.require("labTemplates").validate(request.id, request.version) });
	}
	async templates_import(request) {
		return cleanJson(await this.require("labTemplates").importPptxUpload(request.id, request));
	}
	async templates_confirm(request) {
		return cleanJson(await this.require("labTemplates").confirmMapping(request.id, request.version, request.mapping));
	}
	async templates_update_meta(request) {
		return cleanJson({ template: await this.require("labTemplates").updateMeta(request.id, request.fields) });
	}
	async templates_archive(request) {
		await this.require("labTemplates").deleteProfile(request.id);
		return cleanJson({ ok: true });
	}

	// ── labNoteTemplates（阅读笔记模板） ─────────────────────────────────────
	async note_templates_list() {
		return { templates: await this.require("labNoteTemplates").list() };
	}
	async note_templates_resolve(request) {
		return cleanJson({ template: await this.require("labNoteTemplates").resolve(request.id, request.version) ?? null });
	}
	async note_templates_create(request) {
		return cleanJson({ template: await this.require("labNoteTemplates").create(request.id, request.fields) });
	}
	async note_templates_update(request) {
		return cleanJson({ template: await this.require("labNoteTemplates").update(request.id, request.fields) });
	}
	async note_templates_copy(request) {
		return cleanJson({ template: await this.require("labNoteTemplates").copy(request.id, request.newId, request.name) });
	}
	async note_templates_delete(request) {
		await this.require("labNoteTemplates").deleteProfile(request.id);
		return cleanJson({ ok: true });
	}
	async note_templates_requirements(request) {
		const template = await this.require("labNoteTemplates").resolve(request.id, request.version);
		if (template === undefined) throw new Error(`note template '${request.id}' not found`);
		return cleanJson({ requirements: this.require("labNoteTemplates").toNoteRequirements(template) });
	}

	// ── labTasks（文献→PPT 任务） ───────────────────────────────────────────
	async projects_list() {
		return cleanJson({ projects: this.require("labTasks").listProjects() });
	}
	async projects_create(request) {
		const tasks = this.require("labTasks");
		return cleanJson({
			project: await tasks.createProject(request.fields),
			presetId: tasks.researchPreset
		});
	}
	async projects_delete(request) {
		return cleanJson(await this.require("labTasks").deleteProject(request.projectId));
	}
	async projects_get(request) {
		return cleanJson({ project: this.require("labTasks").getProject(request.id) ?? null });
	}
	async projects_ensure_workspace(request) {
		return cleanJson({ path: (await this.require("labTasks").ensureProjectWorkspace(request.projectId)).path });
	}
	async projects_bind_workspace(request) {
		return cleanJson({ binding: await this.require("labTasks").bindProjectWorkspace(request) });
	}
	async projects_bind_session(request) {
		return cleanJson({ binding: await this.require("labTasks").bindProjectSession(request) });
	}
	async projects_binding(request) {
		return cleanJson({ binding: this.require("labTasks").getProjectSession(request.projectId) ?? null });
	}
	async projects_by_session(request) {
		return cleanJson({ bound: this.require("labTasks").getProjectBySession(request.sessionId) ?? null });
	}
	async projects_by_workspace(request) {
		return cleanJson({ bound: this.require("labTasks").getProjectByWorkspace(request.workspaceId) ?? null });
	}
	async projects_by_cwd(request) {
		return cleanJson({ bound: this.require("labTasks").getProjectByCwd(request.path) ?? null });
	}
	async projects_memory(request) {
		const tasks = this.require("labTasks");
		return cleanJson({
			memory: tasks.getProjectMemory(request.projectId, request.version) ?? null,
			history: tasks.listProjectMemoryVersions(request.projectId)
		});
	}
	async projects_memory_update(request) {
		return cleanJson({ memory: await this.require("labTasks").updateProjectMemory(request.fields) });
	}
	async projects_workspace(request) {
		const projectId = request.projectId;
		const tasks = this.require("labTasks");
		const chemistry = this.require("labChemistry");
		const nmr = this.require("labNmr");
		const synthesis = this.require("labSynthesis");
		const targets = synthesis.listTargets().filter((row) => row.projectId === projectId);
		const targetIds = new Set(targets.map((row) => row.id));
		const project = tasks.getProject(projectId);
		if (project === undefined) throw new Error(`project '${projectId}' not found`);
		const memory = tasks.getProjectMemory(projectId) ?? {
			id: `${projectId}@0`, projectId, version: "0",
			markdown: `# ${project.name}\n\n## 核心课题\n请补充研究问题、核心假设和预期目标。`,
			changeNote: "等待首次提交", contentSha256: "", createdAt: project.createdAt
		};
		const filesByDoi = this.buildPaperFileIndex(tasks, projectId);
		const searches = tasks.listSearchRuns(projectId).map((run) => {
			if (!(run.results ?? []).some((paper) => paper.doi)) return run;
			return { ...run, results: (run.results ?? []).map((paper) => {
				if (!paper.doi) return paper;
				const files = filesByDoi.get(normalizeDoi(paper.doi));
				return files ? { ...paper, localPdfUrl: files.pdfUrl || undefined, localSiUrl: files.siUrl || undefined, localSiIsPdf: files.siIsPdf || undefined } : paper;
			}) };
		});
		return cleanJson({
			project,
			presetId: tasks.researchPreset,
			memory,
			memoryHistory: tasks.listProjectMemoryVersions(projectId),
			literature: {
				searches,
				bundles: tasks.listBundles(projectId),
				reports: tasks.listReadingReports(projectId),
				presentations: tasks.listPresentationRuns(projectId)
			},
			planning: {
				plans: chemistry.listExperimentPlans().filter((row) => row.projectId === projectId),
				targets,
				routes: synthesis.listRoutes().filter((row) => row.projectId === projectId || targetIds.has(row.targetId))
			},
			characterization: {
				nmr: nmr.listDatasets().filter((row) => row.projectId === projectId)
			}
		});
	}
	async tasks_searches(request) {
		return cleanJson({ runs: this.require("labTasks").listSearchRuns(request.projectId) });
	}

	/**
	 * 构建「DOI → 本地原文文件」索引，供文献条目的 PDF/SI 按钮判断状态：
	 *   - 优先取已登记原文 bundle（pdfPath/siPath，走 /api/lab-artifacts?kind=pdf|si）；
	 *   - 全文下载队列中 completed 且有本地 PDF 的任务作为兜底（走 /api/lab-literature-download）。
	 * 键为 normalizeDoi 后的 DOI，小写、去 URL 前缀，保证检索结果与登记路径能对上。
	 */
	buildPaperFileIndex(tasks, projectId) {
		const filesByDoi = new Map();
		const entry = (doi) => {
			const key = normalizeDoi(doi);
			if (!key) return null;
			if (!filesByDoi.has(key)) filesByDoi.set(key, { pdfUrl: "", siUrl: "", siIsPdf: false });
			return filesByDoi.get(key);
		};
		for (const bundle of tasks.listBundles(projectId)) {
			if (!bundle.doi) continue;
			const target = entry(bundle.doi);
			if (!target) continue;
			// v0.1.2 source-map-only rows stored the JSON input in pdfPath. Do not expose
			// those legacy rows as downloadable PDFs; new rows leave pdfPath undefined.
			if (bundle.pdfPath && /\.pdf$/i.test(bundle.pdfPath)) target.pdfUrl = `/api/lab-artifacts?kind=pdf&bundleId=${encodeURIComponent(bundle.id)}`;
			if (bundle.siPath) {
				target.siUrl = `/api/lab-artifacts?kind=si&bundleId=${encodeURIComponent(bundle.id)}`;
				// 0.1.15：已登记的 SI 一律按 PDF 处理，不再依据路径后缀猜测类型。
				target.siIsPdf = true;
			}
		}
		try {
			const downloads = this.require("labLiterature").listDownloads({ limit: 1000 }).jobs ?? [];
			for (const job of downloads) {
				if (job.state !== "completed" || !job.doi || !job.downloadUrl) continue;
				const target = entry(job.doi);
				if (target && !target.pdfUrl) target.pdfUrl = job.downloadUrl;
			}
		} catch {
			// 下载服务未注册/不可用时，仅以 bundle 登记为准
		}
		return filesByDoi;
	}
	async tasks_provenance(request) {
		return cleanJson({ provenance: this.require("labTasks").listProvenance(request.projectId) });
	}
	// ── 文献数据库状态 + USTC 授权浏览器 ───────────────────────────────────
	async literature_sources() {
		return cleanJson({ sources: this.require("labLiterature").listSources() });
	}
	async literature_status(request) {
		return cleanJson(await this.require("labLiterature").statuses(request ?? {}));
	}
	async literature_configure(request) {
		return cleanJson({ source: await this.require("labLiterature").configure(request.sourceId, request.resourceUrl) });
	}
	async literature_connect(request) {
		return cleanJson(await this.require("labLiterature").connect(request.sourceId, request.resourceUrl, { mode: request.mode }));
	}
	async literature_verify(request) {
		return cleanJson(await this.require("labLiterature").verify(request.sourceId));
	}
	async literature_download_create(request) {
		return cleanJson({ job: await this.require("labLiterature").queueDownload(request) });
	}
	async literature_downloads(request) {
		return cleanJson(this.require("labLiterature").listDownloads(request ?? {}));
	}
	async literature_download_retry(request) {
		return cleanJson({ job: await this.require("labLiterature").retryDownload(request.id) });
	}
	// ── 文献产物写入端点（Agent 在对话中登记检索/原文/精读/PPT）────────────
	async tasks_search_create(request) {
		return cleanJson({ run: await this.require("labTasks").searchLiterature(request.fields) });
	}
	async tasks_bundle_create(request) {
		return cleanJson({ bundle: await this.require("labTasks").preparePaper(request.fields) });
	}
	async tasks_report_create(request) {
		return cleanJson({ report: await this.require("labTasks").createReadingReport(request.fields) });
	}
	async tasks_report_complete(request) {
		return cleanJson({ report: await this.require("labTasks").completeReadingReport(request.fields) });
	}
	async tasks_report_validate(request) {
		return cleanJson({ report: await this.require("labTasks").validateReadingReport(request.fields) });
	}
	async tasks_report_review(request) {
		return cleanJson({ report: await this.require("labTasks").reviewReadingReport(request.fields) });
	}
	async tasks_presentation_create(request) {
		return cleanJson({ run: await this.require("labTasks").createPresentation(request.fields) });
	}
	async tasks_presentation_complete(request) {
		return cleanJson({ run: await this.require("labTasks").completePresentation(request.fields) });
	}
	async tasks_presentation_validate(request) {
		return cleanJson({ run: await this.require("labTasks").validatePresentation(request.fields) });
	}
	async tasks_presentation_review(request) {
		return cleanJson({ run: await this.require("labTasks").reviewPresentation(request.fields) });
	}
	async tasks_review_details(request) {
		return cleanJson({ review: await this.require("labTasks").machineReviewDetails(request) });
	}
	async tasks_search_ris(request) {
		return cleanJson({ ris: this.require("labTasks").searchRunRis(request.runId) });
	}
	async tasks_overview(request) {
		return cleanJson({ overview: await this.require("labTasks").readingReportOverview(request.reportId) });
	}
	async tasks_report_download(request) {
		return cleanJson({ file: await this.require("labTasks").readingReportDownload(request.reportId, request.format) });
	}
	async tasks_ppt_download(request) {
		return cleanJson({ file: await this.require("labTasks").presentationDownload(request.reportId) });
	}

	// ── labChemistry（化学性质/实验计划） ───────────────────────────────────
	async chem_entities(request) {
		return cleanJson({ entities: request.id === undefined ? this.require("labChemistry").listEntities() : this.require("labChemistry").getEntity(request.id) ?? null });
	}
	async chem_entity_create(request) {
		return cleanJson({ entity: await this.require("labChemistry").createEntity(request.fields) });
	}
	async chem_properties(request) {
		return cleanJson({ properties: this.require("labChemistry").queryProperty(request.entityId, request.property) });
	}
	async chem_formula(request) {
		return cleanJson({ result: this.require("labChemistry").computeFromFormula(request.formula) });
	}
	async chem_metrics(request) {
		return cleanJson({ metrics: this.require("labChemistry").computePolymerMetrics(request.input) });
	}
	async chem_plans(request) {
		return cleanJson({ plans: request.id === undefined ? this.require("labChemistry").listExperimentPlans() : this.require("labChemistry").getExperimentPlan(request.id) ?? null });
	}
	async chem_plan_create(request) {
		return cleanJson({ plan: await this.require("labChemistry").createExperimentPlan(request.fields) });
	}
	async chem_plan_validate(request) {
		return cleanJson({ validation: this.require("labChemistry").validatePlan(request.id) });
	}
	async chem_plan_status(request) {
		return cleanJson({ plan: await this.require("labChemistry").updatePlanStatus(request.id, request.status) });
	}

	// ── labNmr（NMR 工作流） ────────────────────────────────────────────────
	async nmr_list() {
		return { datasets: this.require("labNmr").listDatasets() };
	}
	async nmr_get(request) {
		return cleanJson({ dataset: this.require("labNmr").getDataset(request.id) });
	}
	async nmr_create(request) {
		return cleanJson({ dataset: await this.require("labNmr").createDataset(request.fields) });
	}
	async nmr_integrals(request) {
		return cleanJson({ dataset: await this.require("labNmr").setDraftIntegrals(request.id, request.integrals) });
	}
	async nmr_approve(request) {
		return { dataset: await this.require("labNmr").approveIntegrals(request.id, { note: request.note }) };
	}
	async nmr_written_back(request) {
		return { dataset: await this.require("labNmr").markWrittenBack(request.id, { note: request.note }) };
	}
	async nmr_verify(request) {
		return { dataset: await this.require("labNmr").visualVerify(request.id, { note: request.note }) };
	}
	async nmr_reopen(request) {
		return { dataset: await this.require("labNmr").reopenReview(request.id, { note: request.note }) };
	}
	async nmr_calculate(request) {
		return cleanJson({ result: await this.require("labNmr").calculate(request.id, request.kind, request.params) });
	}

	// ── labSynthesis（合成路线 + CAS 边界） ─────────────────────────────────
	async synth_targets(request) {
		return cleanJson({ targets: request.id === undefined ? this.require("labSynthesis").listTargets() : this.require("labSynthesis").getTarget(request.id) ?? null });
	}
	async synth_target_create(request) {
		return cleanJson({ target: await this.require("labSynthesis").createTarget(request.fields) });
	}
	async synth_routes(request) {
		return cleanJson({ routes: request.id === undefined ? this.require("labSynthesis").listRoutes() : this.require("labSynthesis").getRoute(request.id) ?? null });
	}
	async synth_route_create(request) {
		return cleanJson({ route: await this.require("labSynthesis").createRoute(request.fields) });
	}
	async synth_route_step(request) {
		return cleanJson({ route: await this.require("labSynthesis").addRouteStep(request.id, request.step) });
	}
	async synth_route_status(request) {
		return cleanJson({ route: await this.require("labSynthesis").updateRouteStatus(request.id, request.status) });
	}
	async synth_evidence(request) {
		return { evidence: await this.require("labSynthesis").collectEvidence(request.id, { query: request.query, want: request.want, deps: request.deps }) };
	}
	async cas_policy() {
		return { policy: this.require("labSynthesis").casPolicy() };
	}
	async cas_prepare_query(request) {
		return cleanJson({ query: this.require("labSynthesis").casPrepareQuery(request) });
	}
	async cas_login_entry() {
		return { entry: this.require("labSynthesis").casLoginEntry() };
	}

	// ── labSynthesis 0.3.0 合成路线工作台（SYN-004 / FR / ANA / PLAN） ────

	/** 路线工作台数据：hydrate 后的 route + 其全部字段级 Evidence。 */
	async synth_route_detail(request) {
		const synthesis = this.require("labSynthesis");
		const route = synthesis.getRoute(request.id);
		return cleanJson({ route, evidence: synthesis.listRouteEvidence(request.id), capability: synthesis.extractionCapability() });
	}

	/** FR-04 / §6.4：复制为带 parentRouteId 的新 draft 版本（含证据复制）。 */
	async synth_route_revision(request) {
		return cleanJson({ route: await this.require("labSynthesis").createRouteRevision(request.id, { name: request.name, changeNotes: request.changeNotes, origin: request.origin }) });
	}

	/** FR-12：更新步骤（仅 draft 版本可编辑；按 stepId 或步骤序号定位）。 */
	async synth_route_update_step(request) {
		return cleanJson({ route: await this.require("labSynthesis").updateRouteStep(request.id, request.stepKey, request.patch) });
	}

	/** Step 人工确认/驳回（写入 step.review）。 */
	async synth_step_review(request) {
		const status = request.status;
		if (!["pending", "confirmed", "edited", "rejected"].includes(status)) throw new Error(`invalid step review status '${status}'`);
		return cleanJson({ route: await this.require("labSynthesis").updateRouteStep(request.id, request.stepKey, { review: { status, reviewedAt: new Date().toISOString() } }) });
	}

	/** FR-20/24：步骤/路线 Evidence 列表。 */
	async synth_evidence_list(request) {
		const synthesis = this.require("labSynthesis");
		const evidence = request.stepId === undefined
			? synthesis.listRouteEvidence(request.routeId)
			: synthesis.listStepEvidence(request.routeId, request.stepId);
		return cleanJson({ evidence });
	}

	/** FR-20：登记字段级证据。 */
	async synth_evidence_add(request) {
		return cleanJson({ evidence: await this.require("labSynthesis").addStepEvidence(request.fields) });
	}

	/** FR-24：Evidence 审核。 */
	async synth_evidence_review(request) {
		return cleanJson({ evidence: await this.require("labSynthesis").reviewEvidence(request.id, request.status) });
	}

	/** ANA-001：Step 可行性（规则层）。 */
	async synth_step_assess(request) {
		return cleanJson({ result: this.require("labSynthesis").assessStep(request.routeId, request.stepId) });
	}

	/** ANA-002：Route 可行性/瓶颈。 */
	async synth_route_assess(request) {
		return cleanJson({ assessment: this.require("labSynthesis").assessRoute(request.routeId) });
	}

	/** FR-30/§10：Step 其他方法检索（0.3.0 未配置 Provider → 明确空状态）。 */
	async synth_step_alternatives(request) {
		return cleanJson({ result: this.require("labSynthesis").searchStepAlternatives(request) });
	}

	/** EXT-001：多模态提取能力声明 + Job 列表/状态机（Provider 未配置）。 */
	async synth_extraction_capability() {
		return cleanJson({ capability: this.require("labSynthesis").extractionCapability() });
	}
	async synth_extraction_jobs(request) {
		return cleanJson({ jobs: this.require("labSynthesis").listExtractionJobs(request.projectId) });
	}
	async synth_extraction_job_create(request) {
		return cleanJson({ job: await this.require("labSynthesis").createExtractionJob(request) });
	}
	async synth_extraction_job_update(request) {
		return cleanJson({ job: await this.require("labSynthesis").updateExtractionJob(request.id, request.status, request.patch) });
	}

	/**
	 * PLAN-001 / §7.2：Route → ExperimentPlan 桥接。
	 * 由 labSynthesis 提供已确认路线数据与证据，labChemistry 创建 draft 计划
	 * （requiresReview=true）；UI 不自行拼装 Plan。
	 */
	async synth_plan_from_route(request) {
		const synthesis = this.require("labSynthesis");
		const chemistry = this.require("labChemistry");
		const route = synthesis.getRoute(request.routeId);
		const target = synthesis.getTarget(route.targetId) ?? null;
		const evidence = synthesis.listRouteEvidence(request.routeId);
		const fields = buildPlanDraftFields(route, target, {
			evidence,
			scale: request.scale,
			extraSafety: request.extraSafety
		});
		let planId = `plan-${route.id}`;
		let probe = 1;
		while (chemistry.getExperimentPlan(planId) !== undefined && probe < 1000) {
			probe += 1;
			planId = `plan-${route.id}-${probe}`;
		}
		const plan = await chemistry.createExperimentPlan({ id: planId, ...fields });
		return cleanJson({ plan });
	}

	// ── labConvert（markitdown 文档转换） ─────────────────────────────────
	async convert_upload(request) {
		return { result: await this.require("labConvert").convertUpload(request) };
	}
	/**
	 * 当前课题会话上传普通科研文件。浏览器只提交 projectId/文件内容；保存目录
	 * 必须在 host 端由已登记课题的 workspacePath 构造，防止客户端指定任意路径。
	 */
	async project_file_upload(request) {
		const tasks = this.require("labTasks");
		if (!tasks.getProject(request.projectId)) throw new Error(`project '${request.projectId}' not found`);
		const workspace = await tasks.ensureProjectWorkspace(request.projectId);
		const file = await this.require("labConvert").ingestUpload({
			name: request.name,
			base64: request.base64,
			uploadDir: join(workspace.path, "uploads"),
			outputDir: join(workspace.path, "converted")
		});
		return cleanJson({ file });
	}
	async convert_available() {
		return { available: await this.require("labConvert").markitdownAvailable() };
	}
	async convert_runs() {
		return { runs: this.require("labConvert").listRuns() };
	}

	// ── labPython（环境） ───────────────────────────────────────────────────
	async python_preflight() {
		return { preflight: await this.require("labPython").preflight() };
	}

	// ── labCapture（手工下载文献自动捕获） ─────────────────────────────────
	async manual_capture_create(request) {
		const created = await this.require("labCapture").createCaptureTask(request);
		// token 为一次性明文，只在创建响应中返回一次；wire 层不暴露 tokenSha256。
		const { tokenSha256, ...task } = created.task;
		return cleanJson({ task: { ...task, token: created.token } });
	}
	async manual_capture_get(request) {
		const capture = this.require("labCapture");
		await capture.sweepExpired();
		return cleanJson({ task: capture.getTask(request.taskId) ?? null });
	}
	async manual_capture_list(request) {
		await this.require("labCapture").sweepExpired();
		return cleanJson({ tasks: this.require("labCapture").listTasks(request.projectId) });
	}
}

/** @Remote 装饰器 initializers（类声明后填充，构造函数里执行）。 */
const REMOTE_INITIALIZERS = [
	...markRemote(LabRemoteService.prototype, "versions_list"),
	...markRemote(LabRemoteService.prototype, "versions_resolve"),
	...markRemote(LabRemoteService.prototype, "goals_list"),
	...markRemote(LabRemoteService.prototype, "goals_resolve"),
	...markRemote(LabRemoteService.prototype, "goals_create"),
	...markRemote(LabRemoteService.prototype, "goals_update"),
	...markRemote(LabRemoteService.prototype, "goals_copy"),
	...markRemote(LabRemoteService.prototype, "goals_delete"),
	...markRemote(LabRemoteService.prototype, "goals_requirements"),
	...markRemote(LabRemoteService.prototype, "templates_list"),
	...markRemote(LabRemoteService.prototype, "templates_resolve"),
	...markRemote(LabRemoteService.prototype, "templates_preview"),
	...markRemote(LabRemoteService.prototype, "templates_validate"),
	...markRemote(LabRemoteService.prototype, "templates_import"),
	...markRemote(LabRemoteService.prototype, "templates_confirm"),
	...markRemote(LabRemoteService.prototype, "templates_update_meta"),
	...markRemote(LabRemoteService.prototype, "templates_archive"),
	...markRemote(LabRemoteService.prototype, "note_templates_list"),
	...markRemote(LabRemoteService.prototype, "note_templates_resolve"),
	...markRemote(LabRemoteService.prototype, "note_templates_create"),
	...markRemote(LabRemoteService.prototype, "note_templates_update"),
	...markRemote(LabRemoteService.prototype, "note_templates_copy"),
	...markRemote(LabRemoteService.prototype, "note_templates_delete"),
	...markRemote(LabRemoteService.prototype, "note_templates_requirements"),
	...markRemote(LabRemoteService.prototype, "projects_list"),
	...markRemote(LabRemoteService.prototype, "projects_create"),
	...markRemote(LabRemoteService.prototype, "projects_delete"),
	...markRemote(LabRemoteService.prototype, "projects_get"),
	...markRemote(LabRemoteService.prototype, "projects_ensure_workspace"),
	...markRemote(LabRemoteService.prototype, "projects_bind_workspace"),
	...markRemote(LabRemoteService.prototype, "projects_bind_session"),
	...markRemote(LabRemoteService.prototype, "projects_binding"),
	...markRemote(LabRemoteService.prototype, "projects_by_session"),
	...markRemote(LabRemoteService.prototype, "projects_by_workspace"),
	...markRemote(LabRemoteService.prototype, "projects_by_cwd"),
	...markRemote(LabRemoteService.prototype, "projects_memory"),
	...markRemote(LabRemoteService.prototype, "projects_memory_update"),
	...markRemote(LabRemoteService.prototype, "projects_workspace"),
	...markRemote(LabRemoteService.prototype, "tasks_searches"),
	...markRemote(LabRemoteService.prototype, "tasks_provenance"),
	...markRemote(LabRemoteService.prototype, "literature_sources"),
	...markRemote(LabRemoteService.prototype, "literature_status"),
	...markRemote(LabRemoteService.prototype, "literature_configure"),
	...markRemote(LabRemoteService.prototype, "literature_connect"),
	...markRemote(LabRemoteService.prototype, "literature_verify"),
	...markRemote(LabRemoteService.prototype, "literature_download_create"),
	...markRemote(LabRemoteService.prototype, "literature_downloads"),
	...markRemote(LabRemoteService.prototype, "literature_download_retry"),
	...markRemote(LabRemoteService.prototype, "tasks_search_create"),
	...markRemote(LabRemoteService.prototype, "tasks_bundle_create"),
	...markRemote(LabRemoteService.prototype, "tasks_report_create"),
	...markRemote(LabRemoteService.prototype, "tasks_report_complete"),
	...markRemote(LabRemoteService.prototype, "tasks_report_validate"),
	...markRemote(LabRemoteService.prototype, "tasks_report_review"),
	...markRemote(LabRemoteService.prototype, "tasks_presentation_create"),
	...markRemote(LabRemoteService.prototype, "tasks_presentation_complete"),
	...markRemote(LabRemoteService.prototype, "tasks_presentation_validate"),
	...markRemote(LabRemoteService.prototype, "tasks_presentation_review"),
	...markRemote(LabRemoteService.prototype, "tasks_review_details"),
	...markRemote(LabRemoteService.prototype, "tasks_search_ris"),
	...markRemote(LabRemoteService.prototype, "tasks_overview"),
	...markRemote(LabRemoteService.prototype, "tasks_report_download"),
	...markRemote(LabRemoteService.prototype, "tasks_ppt_download"),
	...markRemote(LabRemoteService.prototype, "chem_entities"),
	...markRemote(LabRemoteService.prototype, "chem_entity_create"),
	...markRemote(LabRemoteService.prototype, "chem_properties"),
	...markRemote(LabRemoteService.prototype, "chem_formula"),
	...markRemote(LabRemoteService.prototype, "chem_metrics"),
	...markRemote(LabRemoteService.prototype, "chem_plans"),
	...markRemote(LabRemoteService.prototype, "chem_plan_create"),
	...markRemote(LabRemoteService.prototype, "chem_plan_validate"),
	...markRemote(LabRemoteService.prototype, "chem_plan_status"),
	...markRemote(LabRemoteService.prototype, "nmr_list"),
	...markRemote(LabRemoteService.prototype, "nmr_get"),
	...markRemote(LabRemoteService.prototype, "nmr_create"),
	...markRemote(LabRemoteService.prototype, "nmr_integrals"),
	...markRemote(LabRemoteService.prototype, "nmr_approve"),
	...markRemote(LabRemoteService.prototype, "nmr_written_back"),
	...markRemote(LabRemoteService.prototype, "nmr_verify"),
	...markRemote(LabRemoteService.prototype, "nmr_reopen"),
	...markRemote(LabRemoteService.prototype, "nmr_calculate"),
	...markRemote(LabRemoteService.prototype, "synth_targets"),
	...markRemote(LabRemoteService.prototype, "synth_target_create"),
	...markRemote(LabRemoteService.prototype, "synth_routes"),
	...markRemote(LabRemoteService.prototype, "synth_route_create"),
	...markRemote(LabRemoteService.prototype, "synth_route_step"),
	...markRemote(LabRemoteService.prototype, "synth_route_status"),
	...markRemote(LabRemoteService.prototype, "synth_evidence"),
	...markRemote(LabRemoteService.prototype, "synth_route_detail"),
	...markRemote(LabRemoteService.prototype, "synth_route_revision"),
	...markRemote(LabRemoteService.prototype, "synth_route_update_step"),
	...markRemote(LabRemoteService.prototype, "synth_step_review"),
	...markRemote(LabRemoteService.prototype, "synth_evidence_list"),
	...markRemote(LabRemoteService.prototype, "synth_evidence_add"),
	...markRemote(LabRemoteService.prototype, "synth_evidence_review"),
	...markRemote(LabRemoteService.prototype, "synth_step_assess"),
	...markRemote(LabRemoteService.prototype, "synth_route_assess"),
	...markRemote(LabRemoteService.prototype, "synth_step_alternatives"),
	...markRemote(LabRemoteService.prototype, "synth_extraction_capability"),
	...markRemote(LabRemoteService.prototype, "synth_extraction_jobs"),
	...markRemote(LabRemoteService.prototype, "synth_extraction_job_create"),
	...markRemote(LabRemoteService.prototype, "synth_extraction_job_update"),
	...markRemote(LabRemoteService.prototype, "synth_plan_from_route"),
	...markRemote(LabRemoteService.prototype, "cas_policy"),
	...markRemote(LabRemoteService.prototype, "cas_prepare_query"),
	...markRemote(LabRemoteService.prototype, "cas_login_entry"),
	...markRemote(LabRemoteService.prototype, "convert_upload"),
	...markRemote(LabRemoteService.prototype, "project_file_upload"),
	...markRemote(LabRemoteService.prototype, "convert_available"),
	...markRemote(LabRemoteService.prototype, "convert_runs"),
	...markRemote(LabRemoteService.prototype, "python_preflight"),
	...markRemote(LabRemoteService.prototype, "manual_capture_create"),
	...markRemote(LabRemoteService.prototype, "manual_capture_get"),
	...markRemote(LabRemoteService.prototype, "manual_capture_list")
];

export default LabRemoteService;
