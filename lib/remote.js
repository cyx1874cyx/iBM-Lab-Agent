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

/** 递归删除 undefined 字段（zod optional 缺省会留下 undefined，不能过 JSON 边界）。 */
function cleanJson(value) {
	if (Array.isArray(value)) return value.map(cleanJson);
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			if (v === undefined) continue;
			out[k] = cleanJson(v);
		}
		return out;
	}
	return value;
}

export class LabRemoteService extends TypertRemoteService {
	static inject = ["labVersions", "labGoals", "labTemplates", "labTasks", "labChemistry", "labNmr", "labSynthesis", "labPython", "labConvert"];
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
		return { templates: await this.require("labTemplates").list() };
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

	// ── labTasks（文献→PPT 任务） ───────────────────────────────────────────
	async projects_list() {
		return { projects: this.require("labTasks").listProjects() };
	}
	async projects_create(request) {
		return cleanJson({ project: await this.require("labTasks").createProject(request.fields) });
	}
	async projects_get(request) {
		return cleanJson({ project: this.require("labTasks").getProject(request.id) ?? null });
	}
	async tasks_searches(request) {
		return cleanJson({ runs: this.require("labTasks").listSearchRuns(request.projectId) });
	}
	async tasks_provenance(request) {
		return cleanJson({ provenance: this.require("labTasks").listProvenance(request.projectId) });
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

	// ── labConvert（markitdown 文档转换） ─────────────────────────────────
	async convert_upload(request) {
		return { result: await this.require("labConvert").convertUpload(request) };
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
	...markRemote(LabRemoteService.prototype, "projects_list"),
	...markRemote(LabRemoteService.prototype, "projects_create"),
	...markRemote(LabRemoteService.prototype, "projects_get"),
	...markRemote(LabRemoteService.prototype, "tasks_searches"),
	...markRemote(LabRemoteService.prototype, "tasks_provenance"),
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
	...markRemote(LabRemoteService.prototype, "cas_policy"),
	...markRemote(LabRemoteService.prototype, "cas_prepare_query"),
	...markRemote(LabRemoteService.prototype, "cas_login_entry"),
	...markRemote(LabRemoteService.prototype, "convert_upload"),
	...markRemote(LabRemoteService.prototype, "convert_available"),
	...markRemote(LabRemoteService.prototype, "convert_runs"),
	...markRemote(LabRemoteService.prototype, "python_preflight")
];

export default LabRemoteService;
