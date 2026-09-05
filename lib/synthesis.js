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
import { createHash } from "node:crypto";
import {
	synthesisTargetSchema,
	synthesisRouteSchema,
	synthesisEvidenceSchema,
	extractionJobSchema,
	synthesisReviewBatchSchema,
	canTransitRoute,
	canTransitExtractionJob,
	canTransitReviewBatch,
	ROUTE_TRANSITIONS,
	ROUTE_ORIGINS,
	EVIDENCE_REVIEW_STATUSES,
	EXTRACTION_JOB_TRANSITIONS,
	REVIEW_BATCH_TRANSITIONS,
	labSynthesisTables
} from "../src/synthesis/models.js";
import { cleanJson } from "../src/json-boundary.js";
import { assessStepFeasibility, assessRouteFeasibility, stepCompleteness } from "../src/synthesis/analysis.js";
import { collectOpenEvidence } from "../src/synthesis/open-sources.js";
import { hydrateStepStructures, mergeStepStructures, structureLookup } from "../src/synthesis/structures.js";
import { resolveSmilesByNames } from "../src/synthesis/pubchem-resolve.js";
import { lookupPubChem, runRdkitCalc } from "../src/chemistry/rdkit-pubchem.js";
import { lookupCactus, resolveCompoundDual } from "../src/synthesis/compound-resolve.js";
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
		synthesis_extraction_jobs: domainTable(extractionJobSchema),
		synthesis_review_batches: domainTable(synthesisReviewBatchSchema)
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

	/**
	 * 该证据是否声明了“原文截图核验依据”（已捕获原文 bundle/documentId + 页码）。
	 * 注意：这只是定位元数据存在，不等于截图真实渲染成功（0.4.0-rc.4 起
	 * “确认/锁定”必须再通过 shotGate 检查 shotVerification.status==="ready"）。
	 */
	evidenceShotable(row) {
		return Boolean((row?.bundleId || row?.documentId) && row?.page !== undefined && row?.page !== null && row?.page !== "");
	}

	/** Evidence 对应正文还是 SI；兼容旧数据：paper-si 自动映射到 si。 */
	evidenceDocumentKind(row) {
		return row?.sourceKind === "si" || (!row?.sourceKind && row?.sourceType === "paper-si") ? "si" : "pdf";
	}

	/**
	 * 是否需要原文截图依据才能确认：
	 *  - 带 bundle/documentId+page 定位，或
	 *  - 自动提取类（text/vlm/search/model）且带摘录内容（不得把“无截图修正”
	 *    当作完成，修复书 §5.2）。
	 * 纯人工知识（extractionMethod=manual / internal sourceType）不强制截图。
	 */
	evidenceRequiresShot(row) {
		if (this.evidenceShotable(row)) return true;
		const method = String(row?.extractionMethod ?? "");
		if (["text", "vlm", "search", "model"].includes(method)) {
			return row?.excerpt !== undefined && row?.excerpt !== null && row?.excerpt !== "";
		}
		return false;
	}

	/**
	 * rc.4 review（§4.3）截图核验门禁。除状态 ready 外还必须满足：
	 *  1. sourceDigest 非空（渲染确已基于已归档原文内容）；
	 *  2. locationDigest 非空（定位快照存在，旧版不可信 ready 一律拒绝）；
	 *  3. locationDigest 与 Evidence 当前定位（bundle/page/bbox + 摘要）一致；
	 * 任一不满足返回带可行动原因 { ok:false }，确认/修正/锁定均不放行。
	 * @returns {{ ok: boolean, reason?: string }}
	 */
	evidenceShotGate(row) {
		if (!this.evidenceRequiresShot(row)) return { ok: true };
		const verification = row?.shotVerification;
		if (verification?.status === "ready") {
			if (!verification.sourceDigest) {
				return { ok: false, reason: "截图核验记录缺少原文内容摘要（sourceDigest），不可信——请重新渲染截图后再确认。" };
			}
			if (!verification.locationDigest) {
				return { ok: false, reason: "截图核验记录缺少定位快照（locationDigest，旧版数据不可信）——请重新渲染截图后再确认。" };
			}
			const current = shotLocationDigest({
				bundleId: row.bundleId ?? row.documentId,
				kind: this.evidenceDocumentKind(row),
				page: row.page,
				bbox: row.bbox,
				sourceDigest: verification.sourceDigest
			});
			if (current !== verification.locationDigest) {
				return { ok: false, reason: "Evidence 的原文定位（bundle/page/bbox）或 PDF 内容在截图核验后已变化，旧截图不再对应当前位置——请重新渲染截图后再确认。" };
			}
			return { ok: true };
		}
		const location = this.evidenceShotable(row) ? "（已声明原文定位）" : "（缺少 bundle/documentId+page 定位）";
		if (verification?.status === "stale") {
			return { ok: false, reason: `原文截图已失效（stale）：原 PDF/页码/定位在核验后发生变化，需重新打开右侧截图完成核验（${location}）。` };
		}
		if (verification?.status === "failed") {
			return { ok: false, reason: `原文截图渲染失败：${verification.error || "渲染器不可用或文件损坏"}（${location}）。请修复后重试，或改标“无法确认”交给 Agent。` };
		}
		if (verification?.status === "pending") {
			return { ok: false, reason: `原文截图尚未成功生成（pending）${location}；请先让右侧截图成功显示后再确认。` };
		}
		return { ok: false, reason: `该事实没有可用的原文截图核验结果${location}：未捕获原文/页码错误/渲染器缺失/文件损坏时不能计为“截图核验完成”——请修正定位后重试，或标“无法确认”交给 Agent。` };
	}

	/**
	 * rc.4 review（§4.3）：登记某条 Evidence 的原文截图核验结果。只允许
	 * evidence-shot 端点（真实渲染过 PDF）与等价的服务端内部流程调用；即使
	 * 路线已锁定也只更新渲染元数据（不改变事实字段），便于锁定后刷新查看截图。
	 * ready 必须携带 sourceDigest 与渲染时定位（bundleId/page/bbox），函数统一
	 * 计算 locationDigest 快照；stale/failed 保留原快照并在字段变化时更新摘要。
	 * @param shot {{ status, bundleId?, page?, bbox?, sourceDigest?, error? }}
	 */
	async registerEvidenceShotVerification(evidenceId, shot = {}) {
		const row = this.table("evidence").get(evidenceId);
		if (row === undefined) throw new Error(`evidence '${evidenceId}' not found`);
		const status = String(shot.status ?? "");
		if (!["pending", "ready", "failed", "stale"].includes(status)) throw new Error(`invalid shot verification status '${status}'`);
		const bundleId = shot.bundleId !== undefined ? String(shot.bundleId) : row.bundleId ?? row.documentId;
		const kind = shot.kind === "si" || (shot.kind === undefined && this.evidenceDocumentKind(row) === "si") ? "si" : "pdf";
		const page = shot.page !== undefined ? shot.page : row.page;
		const bbox = Array.isArray(shot.bbox) ? shot.bbox : Array.isArray(row.bbox) ? row.bbox : undefined;
		const sourceDigest = shot.sourceDigest;
		if (status === "ready" && !sourceDigest) {
			throw new Error("ready shot verification requires sourceDigest (rendered archive content digest)");
		}
		const digestFor = sourceDigest ?? row?.shotVerification?.sourceDigest;
		const locationDigest = digestFor
			? shotLocationDigest({ bundleId, kind, page, bbox, sourceDigest: digestFor })
			: undefined;
		const next = {
			...row,
			shotVerification: {
				status,
				bundleId,
				kind,
				page,
				bbox,
				sourceDigest,
				locationDigest,
				renderedAt: shot.renderedAt ?? new Date().toISOString(),
				error: shot.error
			},
			updatedAt: new Date().toISOString()
		};
		const parsed = synthesisEvidenceSchema.parse(next);
		await this.table("evidence").put(evidenceId, parsed);
		return parsed;
	}

	/** 已登记正文/SI 被替换时，主动使所有关联 ready 截图失效。 */
	async invalidateEvidenceShotsForBundle(bundleId, kind, sourceDigest) {
		const digest = String(sourceDigest ?? "").slice(0, 16);
		let changed = 0;
		for (const key of this.table("evidence").keys()) {
			const row = this.table("evidence").get(key);
			if ((row?.bundleId ?? row?.documentId) !== bundleId) continue;
			if (this.evidenceDocumentKind(row) !== kind) continue;
			const verification = row?.shotVerification;
			if (verification?.status !== "ready" || verification.sourceDigest === digest) continue;
			const next = {
				...row,
				shotVerification: { ...verification, status: "stale", error: `已归档${kind === "si" ? "SI" : "正文"}文件已更新，原截图核验失效，需重新打开截图核验` },
				updatedAt: new Date().toISOString()
			};
			await this.table("evidence").put(key, synthesisEvidenceSchema.parse(next));
			changed += 1;
		}
		return changed;
	}

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
			jobs: domain.table("synthesis_extraction_jobs"),
			reviewBatches: domain.table("synthesis_review_batches")
		};
		this.casProvider = new CasProvider({ authorization: this.config.casAuthorization ?? null });
	}

	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labSynthesis is not started yet");
		return t;
	}

	/**
	 * 0.4.0 写保护语义：版本锁与审核状态独立 —— 只有 locked 才是最终写保护。
	 * locked=true 时所有原位写接口都在服务端拒绝（不能只靠前端禁用按钮）；
	 * locked=false 时非 draft 版本同样允许修改（复制出的新版本 locked=false）。
	 */
	assertWritable(route, action = "modify") {
		if (route.locked) throw new Error(`route '${route.id}' is locked; copy a new version before ${action}`);
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

	/** 追加路线步骤（未锁定 draft）。 */
	async addRouteStep(id, step) {
		const route = this.getRoute(id);
		this.assertWritable(route, "add steps");
		const withId = { ...step, id: step.id ?? `s${step.step}` };
		const next = { ...route, steps: [...route.steps, withId], updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(id, parsed);
		return hydrateRoute(parsed);
	}

	/** 更新指定步骤（按 step.id 或步骤序号定位；仅 draft）。 */
	async updateRouteStep(id, stepKeyOrId, patch) {
		const route = this.getRoute(id);
		this.assertWritable(route, "edit steps");
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
		this.assertWritable(route, "resolve structures");
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
			verification: { status: "single-source", sources: ["pubchem"], checkedAt: new Date().toISOString() },
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
	 * 0.4.0：对该步骤缺 SMILES 的化合物做 PubChem/CACTUS 双源核验（只查不写）。
	 * 复用 hydrate/缺失名单逻辑；每个候选返回四态（dual-confirmed/single-source/
	 * conflict/unresolved）与两源明细。登记由 synth_step_set_structure（可带
	 * verification）承担；冲突/未解析候选绝不自动写入。
	 * @returns {{ results: [{name,status,smiles,casNumber,inchiKey,sources}], missingAfter: string[] }}
	 */
	async resolveStepCompoundsDual(routeId, stepKeyOrId, deps = {}) {
		const route = this.getRoute(routeId);
		this.assertWritable(route, "dual resolve structures");
		const key = String(stepKeyOrId);
		const targetIndex = route.steps.findIndex((step) => step.id === key || String(step.step) === key);
		if (targetIndex < 0) throw new Error(`step '${key}' not found in route '${routeId}'`);
		const step = route.steps[targetIndex];
		const hydrated = hydrateStepStructures(step);
		const lookupIndex = structureLookup(hydrated);
		const missing = [...new Set(hydrated.map((row) => row.name).filter((name) => !lookupIndex[name.toLowerCase()]?.smiles))];
		const results = [];
		for (const name of missing) {
			const result = await this.resolveCompoundDual(name, deps);
			results.push({ name, status: result.status, smiles: result.smiles, casNumber: result.casNumber, inchiKey: result.inchiKey, sources: result.sources });
		}
		return { results, missingAfter: missing, stepId: step.id ?? `s${step.step}` };
	}

	/**
	 * 人工设置某化合物的 SMILES（Ketcher 编辑器补绘/修正、或双源核验登记后回写）。
	 * source=manual 覆盖既有 pubchem/agent 值，让 Ketcher 修正成为该结构的最终
	 * 人工决定；双源登记时可传入 verification 覆盖（如 dual-confirmed/single-source）
	 * 并携带可追溯 casNumber / inchiKey（WP3：最终结构记录持久化
	 * name/casNumber/smiles/inchiKey/source/verification）。
	 * 写保护仅以版本锁为准（0.4.0）。
	 * @returns 更新后的 route（hydrate 形态）
	 */
	async setStepStructure(routeId, stepKeyOrId, name, smiles, verification, extra = {}) {
		const route = this.getRoute(routeId);
		this.assertWritable(route, "edit structures");
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
			verification: verification ?? { status: "manual", sources: ["manual"], checkedAt: new Date().toISOString() },
			role: structureLookup(hydrated)[cleanName.toLowerCase()]?.role ?? "unknown",
			...pickStructureIdentity(extra),
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
		this.assertWritable(route, "change route status");
		if (!canTransitRoute(route.status, status)) {
			throw new Error(`invalid route transition ${route.status} -> ${status} (allowed: ${ROUTE_TRANSITIONS[route.status]?.join(", ") ?? "none"})`);
		}
		const next = { ...route, status, updatedAt: new Date().toISOString() };
		const parsed = synthesisRouteSchema.parse(next);
		await this.table("routes").put(id, parsed);
		return hydrateRoute(parsed);
	}

	/**
	 * 0.4.0 用户锁定已核验路线版本（仅显式 user 角色可锁定；Agent/伪造字符串
	 * 一律拒绝，见 §4.2）。
	 *
	 * 锁定门禁（服务端校验，不依赖客户端状态）：
	 *  ① 所有步骤证据均已人工决定（无 pending）；
	 *  ② 没有运行中的审核批次（pending/applied 均阻断，§4.3）；
	 *  ③ 需要原文依据的最终事实（confirmed/corrected 且 evidenceRequiresShot）
	 *     必须截图核验真实成功（shotVerification.status==="ready"），不能只看
	 *     bundleId+page 元数据（§5.3）。
	 * 被拒时抛 RouteLockBlockedError（结构化 blockers），远程层序列化为
	 * { ok:false, blockers } 返回 UI 定位具体步骤/事实。
	 *
	 * rc.4 review（§5.2）可信身份：锁定不再默认放行缺省主体——调用方必须
	 * 显式携带 by:"user"，且该调用只能来自专用 user-action 通道（HTTP 端点
	 * 或受信内部流程）；Agent 工具注册表与通用 Remote 网关均不暴露锁定方法
	 * （by:"agent" / by:"root" / 缺省 by 一律拒绝，无法伪造字符串冒充用户）。
	 */
	async lockRoute(id, { by } = {}) {
		const route = this.getRoute(id);
		// 先校验主体再幂等返回：无 by/伪造 by 的调用即使针对已锁定版本也拒绝，
		// 不得借“已锁定再次锁定返回成功”的幂等响应绕过授权校验（§5.3）。
		if (by !== "user") {
			const reason = by === undefined ? "missing actor" : `by='${by}'`;
			throw new Error(`route '${id}' cannot be locked: ${reason} — only an explicit user action via the trusted user-action channel may lock a route`);
		}
		if (route.locked) return route; // 幂等：合法 user 动作对已锁定版本保持稳定
		const blockers = [];
		const evidenceRows = this.listRouteEvidence(id);
		// ① 待审事实：pending / rejected（人工无法确认，属于未决，须先提交批次处理）
		const pendingRows = evidenceRows.filter((row) => row.reviewStatus === "pending");
		if (pendingRows.length) {
			blockers.push({
				code: "pending-evidence",
				message: `${pendingRows.length} 条事实仍待人工审核（确认/修正/无法确认）`,
				evidenceIds: pendingRows.map((row) => row.id),
				stepIds: [...new Set(pendingRows.map((row) => row.stepId).filter(Boolean))]
			});
		}
		// ② 运行中的审核批次：pending（等待 Agent）与 applied（Agent 已回写、
		//    待下一轮人工审核）都阻断锁定（§4.3，与 UI 语义一致）。
		const openBatches = this.listReviewBatches(id).filter((row) => ["pending", "applied"].includes(row.status));
		if (openBatches.length) {
			blockers.push({
				code: "open-review-batch",
				message: `${openBatches.length} 个审核批次处于运行中（${openBatches.map((row) => row.status).join("/")}），须先完成本轮核验并关闭批次`,
				batchIds: openBatches.map((row) => row.id),
				stepIds: [...new Set(openBatches.map((row) => row.stepId).filter(Boolean))]
			});
		}
		// ③ 截图核验真实成功：需要原文依据的最终事实必须 shotVerification ready。
		//    只检查元数据（bundleId+page）不能证明 PDF 存在/页码有效/渲染成功（§5）。
		const finalRows = evidenceRows.filter((row) => ["confirmed", "corrected"].includes(row.reviewStatus));
		const notReady = finalRows.filter((row) => !this.evidenceShotGate(row).ok);
		if (notReady.length) {
			blockers.push({
				code: "shot-not-ready",
				message: `${notReady.length} 条已确认/已修正事实的原文截图核验未通过（截图未成功生成/已失效/缺原文），不能计为截图核验完成：` +
					notReady.map((row) => this.evidenceShotGate(row).reason).join(" "),
				evidenceIds: notReady.map((row) => row.id),
				stepIds: [...new Set(notReady.map((row) => row.stepId).filter(Boolean))]
			});
		}
		if (blockers.length) throw new RouteLockBlockedError(blockers);
		const now = new Date().toISOString();
		const parsed = synthesisRouteSchema.parse({ ...route, locked: true, lockedAt: now, lockedBy: "user", updatedAt: now });
		await this.table("routes").put(id, parsed);
		return hydrateRoute(parsed);
	}

	/**
	 * PubChem/CACTUS 双源确认只返回可追溯候选；冲突时绝不自动写入路线。
	 * 0.4.0-rc.4：结构一致性按化学身份比较——两源优先用各自标准 InChIKey；
	 * 缺 key 一侧经 RDKit（venv 可用时）本地规范化后比较（§6.1），绝不直接
	 * 比较原始 SMILES 字符串。PubChem 名称命中后还查 synonyms 追溯 CAS（§6.2）。
	 */
	async resolveCompoundDual(identifier, deps = {}) {
		const { lookupPubChemCas } = await import("../src/chemistry/rdkit-pubchem.js");
		const pubchemLookup = async (query) => {
			const props = await (deps.pubchem ?? lookupPubChem)(query);
			if (!props?.cid) return props;
			try {
				const casResult = await (deps.pubchemCas ?? lookupPubChemCas)(query, { cid: props.cid, fetchImpl: deps.pubchemFetchImpl });
				return { ...props, casNumber: casResult?.casNumber, casSource: casResult?.casSource, queryTime: new Date().toISOString() };
			} catch {
				return { ...props, queryTime: new Date().toISOString() }; // synonyms 失败不阻塞结构查询
			}
		};
		return resolveCompoundDual(identifier, {
			pubchem: pubchemLookup,
			cactus: deps.cactus ?? lookupCactus,
			canonizer: deps.canonizer,
			rdkit: deps.rdkit ?? ((smiles, opts = {}) => runRdkitCalc(undefined, smiles, { timeoutMs: opts.timeoutMs ?? 20000 }))
		});
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
			locked: false,
			lockedAt: undefined,
			lockedBy: undefined,
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
		const route = this.getRoute(routeId);
		this.assertWritable(route, "add evidence");
		if (stepId === undefined && stepKey !== undefined) {
			const step = this.getRoute(routeId).steps.find((s) => s.step === Number(stepKey));
			if (step) stepId = step.id;
		}
		if (!rest.supportsField) throw new Error("evidence.supportsField required (e.g. 'procedure.temperature')");
		if (!rest.sourceName) throw new Error("evidence.sourceName required");
		const now = new Date().toISOString();
		const recordId = id ?? `${safeId("ev", routeId)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
		// 0.4.0：已人工确认/修正的 Evidence 是最终决定——Agent 回写/批量更新不允许覆盖同 id 记录；
		// 需要修正时只能新建记录进入下一审核轮（reviewRound 由提取方传入）。
		if (id !== undefined) {
			const existing = this.table("evidence").get(recordId);
			if (existing && ["confirmed", "corrected"].includes(existing.reviewStatus)) {
				throw new Error(`evidence '${recordId}' is ${existing.reviewStatus}; human-confirmed facts cannot be overwritten by batch writes`);
			}
		}
		// AI/自动提取时保留原始抽取值（供人工修正对照）；人工录入不写。
		const autoExtract = ["model", "text", "vlm"].includes(rest.extractionMethod);
		const withOriginal = autoExtract && rest.excerpt !== undefined && rest.originalExtract === undefined
			? { ...rest, originalExtract: String(rest.excerpt) }
			: rest;
		const record = synthesisEvidenceSchema.parse({ id: recordId, routeId, stepId, stepKey, ...withOriginal, createdAt: now, updatedAt: now });
		await this.table("evidence").put(recordId, record);
		return record;
	}

	/** FR-24：Evidence 人工审核（pending → confirmed/corrected/edited/rejected）。
	 *  0.4.0：修正必须同时保留原始提取值与人工修正值；人工单项点击不推进
	 *  reviewRound —— 轮次只在 Agent 回写新事实时开启（applyUncertainBatch /
	 *  显式传入 reviewRound），避免把每次点击误当作新审核轮次（完成书 §3）。
	 *  0.4.0-rc.4（§5.3）：confirmed/corrected 属于“需要原文依据的最终决定”，
	 *  服务端先验证该事实的原文截图核验真实成功（shotVerification ready）——
	 *  不能只看 bundleId+page 元数据，也不能用无截图修正绕过首次截图审核。 */
	async reviewEvidence(id, status, { correction } = {}) {
		if (!EVIDENCE_REVIEW_STATUSES.includes(status)) throw new Error(`invalid evidence review status '${status}'`);
		const row = this.table("evidence").get(id);
		if (row === undefined) throw new Error(`evidence '${id}' not found`);
		if (row.routeId) {
			const route = this.getRoute(row.routeId);
			if (route?.locked) throw new Error(`route '${row.routeId}' is locked; evidence review is read-only on locked versions`);
		}
		if (status === "corrected" && (!correction || !String(correction).trim())) {
			throw new Error("corrected evidence requires a human correction value");
		}
		if (["confirmed", "corrected"].includes(status)) {
			const gate = this.evidenceShotGate(row);
			if (!gate.ok) {
				throw new EvidenceShotNotReadyError(`evidence '${id}' cannot be ${status}: ${gate.reason}`);
			}
		}
		const round = row.reviewRound ?? 1;
		// rc.4 review（§4.4）：旧版无摘要 ready 先迁移为 stale 再落库（不静默放行）；
		// 迁移后 gate 已在上面拒绝 confirmed/corrected，此处分支只影响其余状态落库。
		const migratedRow = migrateLegacyShotVerification(row);
		if (status === "corrected") {
			const next = {
				...migratedRow,
				reviewStatus: "corrected",
				userCorrection: String(correction).trim(),
				reviewRound: round,
				updatedAt: new Date().toISOString()
			};
			await this.table("evidence").put(id, next);
			return next;
		}
		const next = { ...migratedRow, reviewStatus: status, reviewRound: round, updatedAt: new Date().toISOString() };
		await this.table("evidence").put(id, next);
		return next;
	}

	// ── 事实核验批次（0.4.0 WP4） ────────────────────────────────────────────

	listReviewBatches(routeId) {
		this.getRoute(routeId); // 校验存在
		return [...this.table("reviewBatches").keys()]
			.map((k) => this.table("reviewBatches").get(k))
			.filter((row) => row.routeId === routeId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	getReviewBatch(id) {
		const row = this.table("reviewBatches").get(id);
		if (row === undefined) throw new Error(`review batch '${id}' not found`);
		return row;
	}

	/**
	 * 人工完成一轮事实核验后提交审核批次（WP4）：
	 *  - itemIds 必须属于该 route 的字段级证据，且都已人工决定（非 pending）；
	 *  - 自动关闭同 step 之前未关闭的 open 批次（新轮取代旧轮，避免遗留
	 *    “运行中批次”阻断后续锁定）；
	 *  - uncertainItemIds 缺省 = 人工标为“无法确认”（rejected）的项；
	 *    本轮 round = 该 step 证据当前最大 reviewRound + 1。
	 */
	async createReviewBatch({ id, routeId, stepId, createdBy = "user", itemIds, uncertainItemIds, notes } = {}) {
		const route = this.getRoute(routeId);
		if (route.locked) throw new Error(`route '${routeId}' is locked; copy a new version before review batch`);
		const step = (route.steps ?? []).find((row) => row.id === stepId || String(row.step) === stepId);
		if (!step) throw new Error(`step '${stepId}' not found in route '${routeId}'`);
		const key = step.id ?? `s${step.step}`;
		const routeEvidence = this.listRouteEvidence(routeId);
		const stepEvidence = routeEvidence.filter(
			(row) => (row.stepId !== undefined && String(row.stepId) === key) || (row.stepId === undefined && row.stepKey !== undefined && row.stepKey === step.step)
		);
		if (!stepEvidence.length) throw new Error(`step '${key}' has no field evidence to review`);
		const ids = new Set(stepEvidence.map((row) => row.id));
		const selected = (itemIds ?? stepEvidence.map((row) => row.id)).map(String);
		for (const itemId of selected) {
			if (!ids.has(itemId)) throw new Error(`evidence '${itemId}' does not belong to step '${key}'`);
		}
		const items = stepEvidence.filter((row) => selected.includes(row.id));
		const undecided = items.filter((row) => row.reviewStatus === "pending");
		if (undecided.length) {
			throw new Error(`cannot submit review batch: ${undecided.length} item(s) still pending human review (${undecided.map((row) => row.id).join(", ")})`);
		}
		const now = new Date().toISOString();
		const batchId = id ?? `rb-${safeId("", routeId)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
		// 批次轮次 = 本批人工审核覆盖的证据轮次（AI 提取第 1 轮；Agent 每次回写 +1）。
		// 人工单项点击不推进轮次（0.4.0 完成书 §3）。
		const batchRound = Math.max(1, ...items.map((row) => row.reviewRound ?? 1));
		const uncertain = (uncertainItemIds ?? []).map(String);
		for (const itemId of uncertain) {
			if (!selected.includes(itemId)) throw new Error(`uncertain item '${itemId}' is not part of this batch`);
		}
		// 缺省：人工“无法确认”（rejected）即需 Agent 重查；缺失/冲突/需重算由调用方显式传入
		const uncertainIds = uncertain.length
			? [...new Set(uncertain)]
			: [...new Set(items.filter((row) => row.reviewStatus === "rejected").map((row) => row.id))];
		const batch = synthesisReviewBatchSchema.parse({
			id: batchId,
			projectId: route.projectId,
			routeId,
			stepId: key,
			round: batchRound,
			status: "pending",
			itemIds: [...new Set(selected)],
			uncertainItemIds: uncertainIds,
			createdBy,
			notes,
			createdAt: now
		});
		// 关闭同 step 之前的 open 批次（新轮取代旧轮）
		for (const open of this.listReviewBatches(routeId).filter((row) => ["pending", "applied"].includes(row.status) && (row.stepId ?? null) === key)) {
			await this.table("reviewBatches").put(open.id, { ...open, status: "completed", completedAt: now });
		}
		await this.table("reviewBatches").put(batch.id, batch);
		return batch;
	}

	/** Agent 只能更新批次里标为 uncertain 且未被人工确认/修正覆盖的项。 */
	async applyUncertainBatch(id, { by = "agent", updates = [] } = {}) {
		const batch = this.getReviewBatch(id);
		const route = this.getRoute(batch.routeId);
		if (route.locked) throw new Error(`route '${batch.routeId}' is locked; agent writes are rejected on locked versions`);
		if (batch.status !== "pending") throw new Error(`review batch '${id}' is ${batch.status}; only pending batches can be applied`);
		if (!Array.isArray(updates) || updates.length === 0) throw new Error("applyUncertainBatch requires at least one update");
		const uncertainIds = new Set(batch.uncertainItemIds ?? []);
		const appliedAt = new Date().toISOString();
		const handled = [];
		for (const update of updates) {
			const evidenceId = String(update?.evidenceId ?? "");
			const row = this.table("evidence").get(evidenceId);
			if (row === undefined) throw new Error(`evidence '${evidenceId}' not found`);
			if (["confirmed", "corrected"].includes(row.reviewStatus)) {
				throw new Error(`evidence '${evidenceId}' is ${row.reviewStatus}; human-confirmed facts cannot be overwritten by agent batch writes`);
			}
			if (!uncertainIds.has(evidenceId)) throw new Error(`evidence '${evidenceId}' is not an uncertain item of batch '${id}'`);
			// Agent 新事实进入下一审核轮（reviewRound+1, pending），不得自动视为已确认
			const patch = pickAgentUpdate(update, row);
			// rc.4 review（§4.3）：Agent 回写若改变定位字段（page/bbox/bundleId/
			// documentId），旧 ready 截图核验在同一写事务中置 stale；旧版无摘要
			// ready 数据同步迁移为 stale（不可信，不得静默放行）。
			const staleShot = staleShotIfLocationChanged(row, patch);
			const migrated = migrateLegacyShotVerification({ ...row, ...patch, reviewStatus: "pending", reviewRound: (row.reviewRound ?? 1) + 1, updatedAt: appliedAt });
			const next = staleShot ? { ...migrated, shotVerification: staleShot } : migrated;
			await this.table("evidence").put(evidenceId, next);
			handled.push(evidenceId);
		}
		const completed = { ...batch, status: "applied", appliedAt };
		await this.table("reviewBatches").put(batch.id, completed);
		return { batch: completed, applied: handled };
	}

	/** 人工/用户关闭（完成）审核批次：仅未锁定版本、open 批次可完成。 */
	async completeReviewBatch(id, { by = "user" } = {}) {
		const batch = this.getReviewBatch(id);
		if (!canTransitReviewBatch(batch.status, "completed")) {
			throw new Error(`review batch '${id}' cannot complete from status ${batch.status} (allowed: ${REVIEW_BATCH_TRANSITIONS[batch.status]?.join(", ") ?? "none"})`);
		}
		const route = this.getRoute(batch.routeId);
		if (route.locked) throw new Error(`route '${batch.routeId}' is locked; review batch is read-only on locked versions`);
		const completed = { ...batch, status: "completed", completedAt: new Date().toISOString() };
		await this.table("reviewBatches").put(batch.id, completed);
		return completed;
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
		this.assertWritable(route, "collect evidence");
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

/** 结构身份字段透传：仅接受显式传入的 CAS / InChIKey（WP3 可追溯来源）。 */
function pickStructureIdentity(extra) {
	const out = {};
	const casNumber = String(extra?.casNumber ?? "").trim();
	const inchiKey = String(extra?.inchiKey ?? "").trim();
	if (casNumber) out.casNumber = casNumber;
	if (inchiKey) out.inchiKey = inchiKey;
	return out;
}

/** Agent 回写允许覆盖的字段（不覆盖人工确认/修正值及定位/来源字段）。 */
function pickAgentUpdate(update, row) {
	const out = {};
	const excerpt = update?.excerpt;
	if (excerpt !== undefined && excerpt !== null) out.excerpt = String(excerpt);
	const supportsField = update?.supportsField;
	if (supportsField !== undefined && supportsField !== null) out.supportsField = String(supportsField);
	const sourceName = update?.sourceName;
	if (sourceName !== undefined && sourceName !== null) out.sourceName = String(sourceName);
	const sourceType = update?.sourceType;
	if (sourceType !== undefined && sourceType !== null) out.sourceType = String(sourceType);
	// Agent 复核定位/页码后允许修正定位（保留原文 id 绑定不变）；
	// bundleId/documentId 同样允许 Agent 在复核后补上（截图核验门禁前提）。
	const page = update?.page;
	if (page !== undefined && page !== null) out.page = page;
	const bundleId = update?.bundleId;
	if (bundleId !== undefined && bundleId !== null) out.bundleId = String(bundleId);
	const documentId = update?.documentId;
	if (documentId !== undefined && documentId !== null) out.documentId = String(documentId);
	const bbox = update?.bbox;
	if (Array.isArray(bbox)) out.bbox = bbox;
	if (!Object.keys(out).length && !row) throw new Error("agent update provides no fields to write");
	return out;
}

/**
 * rc.4 review（§4.2）：截图核验定位快照摘要。对规范化的
 * bundle/documentId + page + bbox + sourceDigest 计算摘要；
 * 门禁用它校验「核验时定位」与「Evidence 当前定位」完全一致，
 * 防止旧页/旧内容截图放行新位置的人工确认。
 */
export function shotLocationDigest({ bundleId, documentId, kind = "pdf", page, bbox, sourceDigest } = {}) {
	const parts = [
		String(bundleId ?? documentId ?? "").trim(),
		kind === "si" ? "si" : "pdf",
		page === undefined || page === null ? "" : String(page).trim(),
		Array.isArray(bbox) ? bbox.map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0)).join(",") : "",
		String(sourceDigest ?? "").trim()
	];
	return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

/** 定位字段（page/bbox/bundleId/documentId）任一变化且原 shotVerification 为
 *  ready 时，返回 stale 化的 shotVerification（须在同一服务端写事务中落库，
 *  §4.3：不得等用户再次打开截图端点才发现失效）；无变化或非 ready 返回 undefined。 */
export function staleShotIfLocationChanged(row, patch) {
	const verification = row?.shotVerification;
	if (!verification || verification.status !== "ready") return undefined;
	const locKeys = ["page", "bbox", "bundleId", "documentId", "sourceKind", "sourceType"];
	const changed = locKeys.some((key) => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(row[key]));
	if (!changed) return undefined;
	return {
		...verification,
		status: "stale",
		error: "Evidence 定位（原文/页码/bbox）在截图核验后发生变更，原 ready 核验失效，需重新渲染截图"
	};
}

/** 旧版无 locationDigest/sourceDigest 的 ready 数据按不可信数据迁移为 stale
 *  （§4.4：不能静默放行，也不可静默确认）；无摘要缺口则返回原行。 */
export function migrateLegacyShotVerification(row) {
	const verification = row?.shotVerification;
	if (!verification || verification.status !== "ready") return row;
	if (verification.locationDigest && verification.sourceDigest) return row;
	return {
		...row,
		shotVerification: {
			...verification,
			status: "stale",
			error: "旧版截图核验缺少定位/内容摘要（locationDigest/sourceDigest），不可信，已降级为 stale；请重新渲染截图后再确认"
		}
	};
}

/** 锁定被阻断的结构化错误：remote 层序列化为 { ok:false, blockers }。 */
export class RouteLockBlockedError extends Error {
	constructor(blockers) {
		super(`route lock blocked: ${blockers.map((row) => row.message).join("; ")}`);
		this.name = "RouteLockBlockedError";
		this.code = "ROUTE_LOCK_BLOCKED";
		this.blockers = blockers;
	}
}

/** 确认/修正被截图核验门禁拒绝（0.4.0-rc.4 §5.3）：消息为可行动原因。 */
export class EvidenceShotNotReadyError extends Error {
	constructor(message) {
		super(message);
		this.name = "EvidenceShotNotReadyError";
		this.code = "EVIDENCE_SHOT_NOT_READY";
	}
}

export default LabSynthesisService;
