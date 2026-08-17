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
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { synthesisTargetSchema, synthesisRouteSchema, canTransitRoute, ROUTE_TRANSITIONS } from "../src/synthesis/models.js";
import { collectOpenEvidence } from "../src/synthesis/open-sources.js";
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
		synthesis_routes: domainTable(synthesisRouteSchema)
	}
});

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
			routes: domain.table("synthesis_routes")
		};
		this.casProvider = new CasProvider({ authorization: this.config.casAuthorization ?? null });
	}

	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labSynthesis is not started yet");
		return t;
	}

	// ── 目标 ────────────────────────────────────────────────────────────────

	async createTarget({ id, name, smiles, formula, entityId, notes }) {
		const now = new Date().toISOString();
		if (this.table("targets").get(id) !== undefined) throw new Error(`synthesis target '${id}' already exists`);
		const target = synthesisTargetSchema.parse({ id, name, smiles, formula, entityId, notes, createdAt: now, updatedAt: now });
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

	async createRoute({ id, targetId, name, steps = [] }) {
		if (this.table("targets").get(targetId) === undefined) throw new Error(`synthesis target '${targetId}' not found`);
		const now = new Date().toISOString();
		if (this.table("routes").get(id) !== undefined) throw new Error(`synthesis route '${id}' already exists`);
		const route = synthesisRouteSchema.parse({ id, targetId, name, steps, status: "draft", createdAt: now, updatedAt: now });
		await this.table("routes").put(id, route);
		return route;
	}

	getRoute(id) {
		const route = this.table("routes").get(id);
		if (route === undefined) throw new Error(`synthesis route '${id}' not found`);
		return route;
	}

	listRoutes() {
		return [...this.table("routes").keys()].sort().map((k) => this.table("routes").get(k));
	}

	/** 追加路线步骤。 */
	async addRouteStep(id, step) {
		const route = this.getRoute(id);
		if (route.status !== "draft") throw new Error(`route '${id}' is ${route.status}; steps can only be edited in draft`);
		const next = { ...route, steps: [...route.steps, step], updatedAt: new Date().toISOString() };
		await this.table("routes").put(id, next);
		return next;
	}

	/** 状态机：仅人工审核路径（与实验计划一致，不自动执行合成）。 */
	async updateRouteStatus(id, status) {
		const route = this.getRoute(id);
		if (!canTransitRoute(route.status, status)) {
			throw new Error(`invalid route transition ${route.status} -> ${status} (allowed: ${ROUTE_TRANSITIONS[route.status]?.join(", ") ?? "none"})`);
		}
		const next = { ...route, status, updatedAt: new Date().toISOString() };
		await this.table("routes").put(id, next);
		return next;
	}

	// ── 开放数据证据 ────────────────────────────────────────────────────────

	/** 收集开放数据证据（PubChem/PatentsView/OpenAlex 文献）并写入路线。 */
	async collectEvidence(routeId, { query, want = ["compound", "patent", "literature"], deps = {} } = {}) {
		const route = this.getRoute(routeId);
		const evidence = await collectOpenEvidence({ query: query ?? route.name, want, deps });
		const next = { ...route, evidence: [...route.evidence, ...evidence], updatedAt: new Date().toISOString() };
		await this.table("routes").put(routeId, next);
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

export default LabSynthesisService;
