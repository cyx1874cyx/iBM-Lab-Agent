/**
 * dsh-lab-agent: NMR 工作流服务（Cordis host service, ctx.labNmr）。
 *
 * 计划 §五：mnova-mcp 之外，插件负责 NMR 工作流编排与聚合物积分计算：
 *   准备（登记原始 FID/结构）→ 人工审核积分计划 → 写回 Mnova →
 *   视觉质检。原始 FID、结构、已审核积分计划均不可覆盖（immutable）。
 * 计算（组成/转化率/端基 DP/取代度/载药量）为纯公式层（integration-calc），
 * 只接受"已审核积分"作为输入，全部标记 computed。
 *
 * 实际 Mnova 交互通过 Harness MCP Client（mcp__mnova__* 工具）由 agent 执行；
 * 本服务记录工作流状态与结果。集成配置模板见 presets/mcp/。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { nmrDatasetSchema, canTransitNmr, NMR_TRANSITIONS } from "../src/nmr/models.js";
import {
	compositionFromIntegrals,
	conversionFromIntegrals,
	endGroupDp,
	substitutionFromIntegrals,
	drugLoadingFromSubstitution
} from "../src/nmr/integration-calc.js";

export const labNmrDomainSpec = defineDomain({
	name: "lab_nmr",
	version: 0,
	tables: {
		nmr_datasets: domainTable(nmrDatasetSchema)
	}
});

export class LabNmrService extends Service {
	static inject = ["storageDomain"];
	table;

	constructor(ctx, config = {}) {
		super(ctx, "labNmr");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labNmrDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.nmr.domainClose");
		this.domain = domain;
		this.table = domain.table("nmr_datasets");
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labNmr is not started yet");
		return this.table;
	}

	require(id) {
		const row = this.table.get(id);
		if (row === undefined) throw new Error(`nmr dataset '${id}' not found`);
		return row;
	}

	async persist(row) {
		await this.requireTable().put(row.id, { ...row, updatedAt: new Date().toISOString() });
		return { ...row, updatedAt: new Date().toISOString() };
	}

	async transit(id, status, patch = {}) {
		const row = this.require(id);
		if (!canTransitNmr(row.status, status)) {
			throw new Error(`invalid NMR transition ${row.status} -> ${status} (allowed: ${NMR_TRANSITIONS[row.status]?.join(", ") ?? "none"})`);
		}
		return await this.persist({ ...row, ...patch, status });
	}

	// ── 工作流 ──────────────────────────────────────────────────────────────

	/** 准备：登记原始 FID 与结构（此后不可变）。 */
	async createDataset({ id, projectId, name, fidPath, structurePath, nucleus, solvent }) {
		if (this.table.get(id) !== undefined) throw new Error(`nmr dataset '${id}' already exists`);
		const now = new Date().toISOString();
		const row = nmrDatasetSchema.parse({
			id, projectId, name, fidPath, structurePath, nucleus: nucleus ?? "1H", solvent,
			status: "prepared", createdAt: now, updatedAt: now
		});
		await this.requireTable().put(id, row);
		return row;
	}

	getDataset(id) {
		return this.require(id);
	}

	listDatasets() {
		return [...this.requireTable().keys()].sort().map((k) => this.requireTable().get(k));
	}

	/** 提交草稿积分计划 → 进入人工审核（prepared 或 under-review 可改草稿）。 */
	async setDraftIntegrals(id, integrals) {
		const row = this.require(id);
		if (row.status === "approved-written" || row.status === "visually-verified") {
			throw new Error(`nmr dataset '${id}' is ${row.status}; approved integrals cannot be changed`);
		}
		const next = { ...row, draftIntegrals: integrals };
		await this.persist(next);
		if (next.status === "prepared") {
			return await this.transit(id, "under-review");
		}
		return next;
	}

	/**
	 * 人工审核通过：草稿 → 已审核（冻结）。
	 * 已审核积分计划不可覆盖：approvedIntegrals 非空时再次 approve 被拒绝。
	 */
	async approveIntegrals(id, { note } = {}) {
		const row = this.require(id);
		if (row.status !== "under-review") {
			throw new Error(`nmr dataset '${id}' is ${row.status}; only under-review can be approved`);
		}
		if (row.approvedIntegrals.length > 0) {
			throw new Error(`nmr dataset '${id}' already has approved integrals; approved plans cannot be overwritten`);
		}
		if (row.draftIntegrals.length === 0) throw new Error(`nmr dataset '${id}' has no draft integrals to approve`);
		const next = await this.transit(id, "approved-written", {
			approvedIntegrals: row.draftIntegrals.map((i) => ({ ...i })),
			writeBack: { at: new Date().toISOString(), note: note ?? "integrals approved; written back to Mnova" }
		});
		return next;
	}

	/** 打回：重新拟积分计划（approvedIntegrals 历史保留，不被覆盖）。 */
	async reopenReview(id, { note } = {}) {
		const row = this.require(id);
		if (row.status !== "approved-written" && row.status !== "visually-verified") {
			throw new Error(`nmr dataset '${id}' is ${row.status}; cannot reopen review`);
		}
		const next = await this.transit(id, "prepared", {
			draftIntegrals: [],
			writeBack: { at: undefined, note: note ?? "reopened for re-integration" }
		});
		return next;
	}

	/** 写回 Mnova（approved-written 后由 agent 通过 mcp__mnova__* 写回）。 */
	async markWrittenBack(id, { note } = {}) {
		const row = this.require(id);
		if (row.status !== "approved-written") {
			throw new Error(`nmr dataset '${id}' is ${row.status}; write-back requires approved-written`);
		}
		return await this.persist({
			...row,
			writeBack: { at: new Date().toISOString(), note: note ?? "written back to Mnova" }
		});
	}

	/** 人工视觉质检完成。 */
	async visualVerify(id, { note } = {}) {
		const row = this.require(id);
		if (row.status !== "approved-written") {
			throw new Error(`nmr dataset '${id}' is ${row.status}; visual check requires approved-written`);
		}
		return await this.transit(id, "visually-verified", {
			visualCheck: { at: new Date().toISOString(), note: note ?? "visually verified" }
		});
	}

	// ── 计算（只接受已审核积分） ────────────────────────────────────────────

	/** 用已审核积分执行一种计算并写入 results。 */
	async calculate(id, kind, params) {
		const row = this.require(id);
		if (row.approvedIntegrals.length === 0) {
			throw new Error(`nmr dataset '${id}' has no approved integrals; approve before calculating`);
		}
		let result;
		switch (kind) {
			case "composition":
				result = compositionFromIntegrals(params);
				break;
			case "conversion":
				result = conversionFromIntegrals(params);
				break;
			case "endGroupDp":
				result = endGroupDp(params);
				break;
			case "substitution":
				result = substitutionFromIntegrals(params);
				break;
			case "drugLoading":
				result = drugLoadingFromSubstitution(params);
				break;
			default:
				throw new Error(`unknown NMR calculation kind '${kind}'`);
		}
		const next = await this.persist({ ...row, results: { ...row.results, [kind]: result } });
		return next.results[kind];
	}

	/** 从已审核积分中按 assignment 名称取积分/质子数（便捷查询）。 */
	peak(row, assignment) {
		const all = row.approvedIntegrals.length > 0 ? row.approvedIntegrals : row.draftIntegrals;
		const found = all.find((i) => i.assignment === assignment);
		if (found === undefined) throw new Error(`no integral with assignment '${assignment}'`);
		return found;
	}
}

export default LabNmrService;
