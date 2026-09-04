/**
 * dsh-lab-agent: 合成路线分析与 CAS 边界服务（Cordis host service,
 * ctx.labSynthesis）。
 *
 * 计划 §七（阶段六，开放数据首版）：开放文献（OpenAlex）/专利
 * （PatentsView）/化合物（PubChem）证据收集完成路线分析；路线状态机
 * draft→under-review→approved|rejected（人工审核，不自动执行）。
 * CAS/SciFinder：未获书面授权前仅准备查询与登录入口（src/cas/boundary.js），
 * 不自动操作、不把 CAS 内容输入模型。
 *
 * 0.3.0 合成路线工作台（SYN-001..004 + EXT-001 + ANA-001/002）：
 *  - 读取时 lazy hydrate 旧步骤（补 step.id=Sn / label），不写回存储；
 *  - Step Evidence 独立表（synthesis_evidence），字段级溯源；
 *  - Route 版本：复制为新 Route + parentRouteId（§6.4），并复制其证据行；
 *  - Extraction Job 状态机 + capability 声明（多模态 Provider 未配置时
 *    UI 显示明确的“未配置”，不报错）；
 *  - Step/Route 可行性为纯规则层（src/synthesis/analysis.js），无 LLM。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
	synthesisTargetSchema,
	synthesisRouteSchema,
	synthesisEvidenceSchema,
	extractionJobSchema,
	canTransitRoute,
	canTransitExtractionJob,
	ROUTE_TRANSITIONS,
	ROUTE_ORIGINS,
	EVIDENCE_REVIEW_STATUSES,
	EXTRACTION_JOB_TRANSITIONS,
	labSynthesisTables
} from "../src/synthesis/models.js";
import { cleanJson } from "../src/json-boundary.js";
import { assessStepFeasibility, assessRouteFeasibility, stepCompleteness } from "../src/synthesis/analysis.js";
import { collectOpenEvidence } from "../src/synthesis/open-sources.js";
import { hydrateStepStructures, mergeStepStructures, structureLookup } from "../src/synthesis/structures.js";
import { resolveSmilesByNames } from "../src/synthesis/pubchem-resolve.js";
import { lookupPubChem } from "../src/chemistry/rdkit-pubchem.js";
import {
	assertCasAuthorized,
	prepareCasQuery,
	casLoginEntry,
	CasProvider,
	CAS_POLICY
} from "../src/cas/boundary.js";

export const labSynthesisDomainSpec = defineDomain({
	name: "lab_synthesis",
	version: 0,
	tables: {
		synthesis_targets: domainTable(synthesisTargetSchema),
		synthesis_routes: domainTable(synthesisRouteSchema),
		synthesis_evidence: domainTable(synthesisEvidenceSchema),
		synthesis_extraction_jobs: domainTable(extractionJobSchema)
	}
});

/** 读取时 lazy hydrate：给旧步骤补 id（s{step}，小写以匹配 PROFILE_ID_RE）
 *  与 label，并 hydrate 化合物结构条目（structures 缺失的补占位、可回填
 *  路线 compounds 里的 smiles），不写回存储。 */
function hydrateRoute(route) {
	const compoundsByLabel = new Map();
	for (const compound of route.compounds ?? []) {
		if (compound?.label) compoundsByLabel.set(String(compound.label).replace(/\s+/g, " ").trim().toLowerCase(), compound.smiles);
	}
	const steps = (route.steps ?? []).map((step, index) => {
		const stepKey = step.step ?? index + 1;
		const hydrated = {
			...step,
			id: step.id ?? `s${stepKey}`,
			label: step.label ?? step.reaction,
			structures: hydrateStepStructures(step)
		};
		// 仅对仍未回填 smiles 的占位条目尝试用路线 compounds(label 精确匹配)回填，
		// 不作为存储写入（避免两条数据源互相覆盖）。
		hydrated.structures = hydrated.structures.map((row) =>
			row.smiles || !compoundsByLabel.has(row.name.toLowerCase())
				? row
				: { ...row, smiles: compoundsByLabel.get(row.name.toLowerCase()), source: "entity" }
		);
		return hydrated;
	});
	return { ...route, steps };
}

/** 摘要文本安全（id 里可能出现旧数据非法字符，做归一化兜底）。 */
function safeId(prefix, input) {
	return `${prefix}-${String(input).replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}`;
}

export class LabSynthesisService extends Service {
	static inject = ["storageDomain"];
	tables = {};

	constructor(ctx, config = {}) {
		super(ctx, "labSynthesis");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labSynthesisDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.synthesis.domainClose");
		this.domain = domain;
		this.tables = {
			targets: domain.table("synthesis_targets"),
			routes: domain.table("synthesis_routes"),
			evidence: domain.table("synthesis_evidence"),
			jobs: domain.table("synthesis_extraction_jobs")
		};
		this.casProvider = new CasProvider({ authorization: this.config.casAuthorization ?? null });
	}

	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labSynthesis is not started yet");
		return t;
	}

	// ── 目标 ────────────────────────────────────────────────────────────────

	async createTarget({ id, projectId, name, smiles, formula, entityId, notes }) {
		const now = new Date().toISOString();
		if (this.table("targets").get(id) !== undefined) throw new Error(`synthesis target '${id}' already exists`);
		const target = cleanJson(synthesisTargetSchema.parse({ id, projectId, name, smiles, formula, entityId, notes, createdAt: now, updatedAt: now }));
		await this.table("targets").put(id, target);
		return target;
	}

	getTarget(id) {
		return this.table("targets").get(id);
	}

	listTargets() {
		return [...this.table("targets").keys()].sort().map((k) => this.table("targets").get(k));
	}

	// ── 路线 ────────────────────────────────────────────────────────────────

	async createRoute({ id, projectId, targetId, name, steps = [], compounds = [], version, origin, parentRouteId, changeNotes }) {
		if (this.table("targets").get(targetId) === undefined) throw new Error(`synthesis target '${targetId}' not found`);
		const now = new Date().toISOString();
		if (this.table("routes").get(id) !== undefined) throw new Error(`synthesis route '${id}' already exists`);
		const route = synthesisRouteSchema.parse({
			id, projectId, targetId, name, steps, compounds,
			version: version ?? 1,
			origin: origin ?? "human-edited",
			parentRouteId,
			changeNotes,
			status: "draft",
			createdAt: now,
			updatedAt: now
		});
		await this.table("routes").put(id, route);
		return hydrateRoute(route);
	}

	getRoute(id) {
		const route = this.table("routes").get(id);
		if (route === undefined) throw new Error(`synthesis route '${id}' not found`);
		return hydrateRoute(route);
	}

	listRoutes() {
		return [...this.table("routes").keys()].sort().map((k) => hydrateRoute(this.table("routes").get(k)));
	}

	/** SYN-004：某课题全部路线（含其目标信息便于构图）。 */
	getProjectRoutes(projectId) {
		const targetIds = new Set(this.listTargets().filter((row) => row.projectId === projectId).map((row) => row.id));
		return this.listRoutes().filter((row) => row.projectId === projectId || targetIds.has(row.targetId));
	}

	/** 追加路线步骤（仅 draft）。 */
	async addRouteStep(id, step) {
		const route = this.getRoute(id);
		if (route.status !== "draft") throw new Error(`route '${id}' is ${route.status}; steps can only be edited in draft`);
		const withId = { ...step, id: step.id ?? `s${step.step}` };
		const next = { ...route, steps: [...route.steps, withId], updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(id, parsed);
		return hydrateRoute(parsed);
	}

	/** 更新指定步骤（按 step.id 或步骤序号定位；仅 draft）。 */
	async updateRouteStep(id, stepKeyOrId, patch) {
		const route = this.getRoute(id);
		if (route.status !== "draft") throw new Error(`route '${id}' is ${route.status}; steps can only be edited in draft`);
		if (!patch || typeof patch !== "object") throw new Error("step patch required");
		const key = String(stepKeyOrId);
		const targetIndex = route.steps.findIndex((step) => step.id === key || String(step.step) === key || String(step.step) === stepKeyOrId);
		if (targetIndex < 0) throw new Error(`step '${key}' not found in route '${id}'`);

		const oldStep = route.steps[targetIndex];
		const mergeObject = (base, incoming) => (incoming === undefined ? base : { ...(base ?? {}), ...incoming });
		const merged = {
			...oldStep,
			...patch,
			procedure: mergeObject(oldStep.procedure, patch.procedure),
			entityRefs: mergeObject(oldStep.entityRefs, patch.entityRefs),
			review: mergeObject(oldStep.review, patch.review),
			confidence: mergeObject(oldStep.confidence, patch.confidence)
		};
		const steps = route.steps.map((step, index) => (index === targetIndex ? merged : step));
		const next = { ...route, steps, updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(id, parsed);
		return hydrateRoute(parsed);
	}

	// ── 化合物结构条目（0.3.2，SYN structure 工作台） ────────────────────────

	/**
	 * 对指定步骤缺 SMILES 的化合物名称逐个做 PubChem 解析，成功合并回
	 * step.structures（source=pubchem）；解析失败的名称保留待补绘。
	 * 仅 draft 可写。网络实现可注入（测试 stub）。
	 * 注：先基于 hydrateRoute（含 route.compounds 同 label 回填）后的步骤处理，
	 * 已回填实体结构的名称不再重复解析，写入不会把 entity 覆盖成 pubchem。
	 * @returns {{ resolved: [{name, smiles, cid?}], failed: [{name, reason}], missingAfter: string[] }}
	 */
	async resolveStepStructures(routeId, stepKeyOrId, { lookup = lookupPubChem } = {}) {
		const route = this.getRoute(routeId);
		if (route.status !== "draft") throw new Error(`route '${routeId}' is ${route.status}; structure resolve only allowed in draft`);
		const key = String(stepKeyOrId);
		const targetIndex = route.steps.findIndex((step) => step.id === key || String(step.step) === key);
		if (targetIndex < 0) throw new Error(`step '${key}' not found in route '${routeId}'`);
		const step = route.steps[targetIndex];
		const hydrated = hydrateStepStructures(step);
		const lookupIndex = structureLookup(hydrated);
		const missing = [...new Set(hydrated.map((row) => row.name).filter((name) => !lookupIndex[name.toLowerCase()]?.smiles))];
		if (missing.length === 0) {
			return { resolved: [], failed: [], missingAfter: [], stepId: step.id ?? `s${step.step}` };
		}
		const { resolved, failed } = await resolveSmilesByNames(missing, lookup);
		if (resolved.length === 0) {
			return { resolved: [], failed, missingAfter: missing, stepId: step.id ?? `s${step.step}` };
		}
		const additions = resolved.map((row) => ({
			name: row.name,
			smiles: row.smiles,
			source: "pubchem",
			role: lookupIndex[row.name.toLowerCase()]?.role ?? "unknown",
			updatedAt: new Date().toISOString()
		}));
		const mergedStructures = mergeStepStructures({ ...step, structures: hydrated }, additions);
		const merged = { ...step, structures: mergedStructures };
		const steps = route.steps.map((s, index) => (index === targetIndex ? merged : s));
		const next = { ...route, steps, updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(routeId, parsed);
		const missingAfter = mergedStructures.filter((row) => !row.smiles).map((row) => row.name);
		return { resolved, failed, missingAfter, stepId: step.id ?? `s${step.step}` };
	}

	/**
	 * 人工设置某化合物的 SMILES（Ketcher 编辑器补绘/修正后回写）。
	 * 仅 draft 可写；source=manual 覆盖既有 pubchem/agent 值，让 Ketcher
	 * 修正成为该结构的最终人工决定。
	 * @returns 更新后的 route（hydrate 形态）
	 */
	async setStepStructure(routeId, stepKeyOrId, name, smiles) {
		const route = this.getRoute(routeId);
		if (route.status !== "draft") throw new Error(`route '${routeId}' is ${route.status}; structure edit only allowed in draft`);
		const cleanName = String(name ?? "").replace(/\s+/g, " ").trim();
		if (!cleanName) throw new Error("structure name required");
		const cleanSmiles = String(smiles ?? "").trim();
		if (!cleanSmiles) throw new Error("structure smiles required");
		const key = String(stepKeyOrId);
		const targetIndex = route.steps.findIndex((step) => step.id === key || String(step.step) === key);
		if (targetIndex < 0) throw new Error(`step '${key}' not found in route '${routeId}'`);
		const step = route.steps[targetIndex];
		const hydrated = hydrateStepStructures(step);
		const additions = [{
			name: cleanName,
			smiles: cleanSmiles,
			source: "manual",
			role: structureLookup(hydrated)[cleanName.toLowerCase()]?.role ?? "unknown",
			updatedAt: new Date().toISOString()
		}];
		const mergedStructures = mergeStepStructures({ ...step, structures: hydrated }, additions);
		const merged = { ...step, structures: mergedStructures };
		const steps = route.steps.map((s, index) => (index === targetIndex ? merged : s));
		const next = { ...route, steps, updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(routeId, parsed);
		return hydrateRoute(parsed);
	}

	/** 状态机：仅人工审核路径（与实验计划一致，不自动执行合成）。 */
	async updateRouteStatus(id, status) {
		const route = this.getRoute(id);
		if (!canTransitRoute(route.status, status)) {
			throw new Error(`invalid route transition ${route.status} -> ${status} (allowed: ${ROUTE_TRANSITIONS[route.status]?.join(", ") ?? "none"})`);
		}
		const next = { ...route, status, updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(id, parsed);
		return hydrateRoute(parsed);
	}

	/**
	 * FR-04 / §6.4：创建新版本 = 复制为新 Route（parentRouteId 指向源路线），
	 * 状态重置为 draft，并把源路线的步骤证据一并复制到新版本名下。
	 * 不静默覆盖任何已审核版本。
	 */
	async createRouteRevision(id, { name, changeNotes, origin = "human-edited" } = {}) {
		if (!ROUTE_ORIGINS.includes(origin)) throw new Error(`invalid origin '${origin}' (allowed: ${ROUTE_ORIGINS.join(", ")})`);
		const source = this.getRoute(id);
		const baseId = source.parentRouteId ?? id;
		const family = this.listRoutes().filter((row) => row.id === baseId || row.parentRouteId === baseId || row.id.startsWith(`${baseId}-r`));
		const maxVersion = family.reduce((max, row) => Math.max(max, row.version ?? 1), 1);
		const newVersion = maxVersion + 1;
		let newId = `${baseId}-r${newVersion}`;
		let probe = 0;
		while (this.table("routes").get(newId) !== undefined && probe < 1000) {
			probe += 1;
			newId = `${baseId}-r${newVersion}-${probe}`;
		}
		const now = new Date().toISOString();
		const next = synthesisRouteSchema.parse({
			...source,
			id: newId,
			name: name ?? `${source.name}（版本 ${newVersion}）`,
			version: newVersion,
			origin,
			parentRouteId: baseId,
			changeNotes: changeNotes ?? "",
			status: "draft",
			createdAt: now,
			updatedAt: now
		});
		await this.table("routes").put(newId, next);
		// 复制独立 Evidence 行，保证新版本在证据面板可追溯
		for (const row of this.listRouteEvidence(id)) {
			const copyId = `${row.id}-v${newVersion}`;
			if (this.table("evidence").get(copyId) !== undefined) continue;
			await this.table("evidence").put(copyId, {
				...row,
				id: copyId,
				routeId: newId,
				createdAt: now,
				updatedAt: now
			});
		}
		return hydrateRoute(next);
	}

	// ── Step Evidence（§6.3 / FR-20..24） ───────────────────────────────────

	/** 路线全部证据（按更新时间排序，新在前）。 */
	listRouteEvidence(routeId) {
		this.getRoute(routeId); // 校验存在
		return [...this.table("evidence").keys()]
			.map((k) => this.table("evidence").get(k))
			.filter((row) => row.routeId === routeId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	/** 单条证据（供截图端点按 id 定位 PDF）。 */
	evidenceById(id) {
		const row = this.table("evidence").get(id);
		return row === undefined ? null : row;
	}

	/** 指定步骤证据（stepId 或 stepKey）；stepId 缺失时也返回 route-level 行。 */
	listStepEvidence(routeId, stepId) {
		const rows = this.listRouteEvidence(routeId);
		if (stepId === undefined) return rows;
		const key = String(stepId);
		const step = this.getRoute(routeId).steps.find((s) => s.id === key || String(s.step) === key);
		const numeric = Number.isInteger(Number(key)) ? Number(key) : undefined;
		return rows.filter(
			(row) =>
				(row.stepId !== undefined && String(row.stepId) === key) ||
				(row.stepId === undefined && row.stepKey !== undefined && row.stepKey === (step?.step ?? numeric))
		);
	}

	/** FR-20：登记字段级证据。id 缺省自动生成；routeId 必填。 */
	async addStepEvidence({ id, routeId, stepId, stepKey, ...rest }) {
		this.getRoute(routeId);
		if (stepId === undefined && stepKey !== undefined) {
			const step = this.getRoute(routeId).steps.find((s) => s.step === Number(stepKey));
			if (step) stepId = step.id;
		}
		if (!rest.supportsField) throw new Error("evidence.supportsField required (e.g. 'procedure.temperature')");
		if (!rest.sourceName) throw new Error("evidence.sourceName required");
		const now = new Date().toISOString();
		const recordId = id ?? `${safeId("ev", routeId)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
		const record = synthesisEvidenceSchema.parse({ id: recordId, routeId, stepId, stepKey, ...rest, createdAt: now, updatedAt: now });
		await this.table("evidence").put(recordId, record);
		return record;
	}

	/** FR-24：Evidence 人工审核（pending → confirmed/edited/rejected）。 */
	async reviewEvidence(id, status) {
		if (!EVIDENCE_REVIEW_STATUSES.includes(status)) throw new Error(`invalid evidence review status '${status}'`);
		const row = this.table("evidence").get(id);
		if (row === undefined) throw new Error(`evidence '${id}' not found`);
		const next = { ...row, reviewStatus: status, updatedAt: new Date().toISOString() };
		await this.table("evidence").put(id, next);
		return next;
	}

	// ── 多模态提取 Job（EXT-001：状态机；Provider 未配置时 UI 明确显示） ─────

	/** 0.3.0 未内置多模态提取 Provider（计划 M3），返回明确的未配置状态。 */
	extractionCapability() {
		return {
			available: false,
			providers: [],
			reason: "0.3.0 未内置多模态提取 Provider（计划 M3/EXT-002 范围）。可先在研究设计页人工登记路线与字段级 Evidence，或在对话中让 Agent 调用 extract_route_from_documents（需先配置 MultimodalExtractionProvider）。"
		};
	}

	async createExtractionJob({ id, projectId, documentIds = [] }) {
		const capability = this.extractionCapability();
		if (!capability.available) throw new Error(`extraction provider not configured: ${capability.reason}`);
		const now = new Date().toISOString();
		const jobId = id ?? safeId("ext", projectId);
		if (this.table("jobs").get(jobId) !== undefined) throw new Error(`extraction job '${jobId}' already exists`);
		const job = extractionJobSchema.parse({ id: jobId, projectId, documentIds, status: "queued", createdAt: now, updatedAt: now });
		await this.table("jobs").put(jobId, job);
		return job;
	}

	getExtractionJob(id) {
		const job = this.table("jobs").get(id);
		if (job === undefined) throw new Error(`extraction job '${id}' not found`);
		return job;
	}

	listExtractionJobs(projectId) {
		return [...this.table("jobs").keys()]
			.map((k) => this.table("jobs").get(k))
			.filter((row) => projectId === undefined || row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async updateExtractionJob(id, status, patch = {}) {
		const job = this.getExtractionJob(id);
		if (!canTransitExtractionJob(job.status, status)) {
			throw new Error(`invalid extraction job transition ${job.status} -> ${status} (allowed: ${EXTRACTION_JOB_TRANSITIONS[job.status]?.join(", ") ?? "none"})`);
		}
		const next = { ...job, ...patch, status, updatedAt: new Date().toISOString() };
		const parsed = extractionJobSchema.parse(next);
		await this.table("jobs").put(id, parsed);
		return parsed;
	}

	// ── Step/Route 可行性（ANA-001/002，规则层） ────────────────────────────

	/** Step 可行性：规则 + 该步 Evidence；不输出伪精确概率。 */
	assessStep(routeId, stepId) {
		const route = this.getRoute(routeId);
		const key = String(stepId);
		const step = route.steps.find((s) => s.id === key || String(s.step) === key);
		if (step === undefined) throw new Error(`step '${stepId}' not found in route '${routeId}'`);
		const evidence = this.listStepEvidence(routeId, step.id);
		const assessment = assessStepFeasibility(step, { evidence });
		return { stepId: step.id, stepKey: step.step, label: step.label, completeness: stepCompleteness(step), assessment };
	}

	assessRoute(routeId) {
		const route = this.getRoute(routeId);
		const evidence = this.listRouteEvidence(routeId);
		return assessRouteFeasibility(route, { evidence });
	}

	/**
	 * FR-30 / §10：检索该步骤其他方法（Step-level，与整体逆向分开）。
	 * 0.3.0 未配置 AlternativeSearchProvider：返回明确空状态，结果不会自动
	 * 覆盖当前 Step（永远不直接替换）。
	 */
	searchStepAlternatives({ routeId, stepId, constraints = {} } = {}) {
		const route = this.getRoute(routeId);
		const key = String(stepId);
		const step = route.steps.find((s) => s.id === key || String(s.step) === key);
		if (step === undefined) throw new Error(`step '${stepId}' not found in route '${routeId}'`);
		return {
			available: false,
			providers: [],
			reason: "0.3.0 未配置 AlternativeSearchProvider（计划 M4/SRCH-002：OpenAlex / PatentsView / PubChem 查询生成 + 归一化）。当前步骤条件不会被自动替换；可先人工核对文献或后续接入 Provider。",
			query: {
				stepId: step.id,
				reaction: step.reaction,
				reactants: step.reactants ?? [],
				products: step.products ?? [],
				currentConditions: summarizeLegacyStep(step),
				constraints
			},
			alternatives: []
		};
	}

	// ── 开放数据证据（legacy，0.2.x） ───────────────────────────────────────

	/** 收集开放数据证据（PubChem/PatentsView/OpenAlex 文献）并写入路线。 */
	async collectEvidence(routeId, { query, want = ["compound", "patent", "literature"], deps = {} } = {}) {
		const route = this.getRoute(routeId);
		const evidence = await collectOpenEvidence({ query: query ?? route.name, want, deps });
		const next = { ...route, evidence: [...route.evidence, ...evidence], updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(routeId, parsed);
		return next.evidence;
	}

	// ── CAS 边界（§七 授权前置） ────────────────────────────────────────────

	/** CAS 政策状态（只读）。 */
	casPolicy() {
		return { policy: CAS_POLICY, authorizationGranted: this.casProvider.authorization?.granted === true };
	}

	/** 仅准备 CAS 查询（不执行请求）。 */
	casPrepareQuery(input) {
		return prepareCasQuery(input);
	}

	/** SciFinder 登录入口（仅 URL）。 */
	casLoginEntry() {
		return casLoginEntry();
	}

	/** 授权门禁：未授权时抛错（供未来 CAS Provider 调用）。 */
	casRequireAuthorization() {
		return assertCasAuthorized(this.casProvider.authorization);
	}
}

/** 旧步骤的字符串条件摘要（供 alternative query / plan 桥接兜底）。 */
function summarizeLegacyStep(step) {
	const bits = [
		step.conditions ?? "",
		...(step.reagents ?? []),
		...(step.references ?? []),
		...(step.openSources ?? [])
	].filter(Boolean);
	return bits.join(" | ");
}

export default LabSynthesisService;
