/**
 * dsh-lab-agent: 化学性质与实验计划服务（Cordis host service, ctx.labChemistry）。
 *
 * 计划 §四：
 *  - 小分子/单体/重复单元/聚合物/聚前药实体 + 带来源的 ChemicalProperty
 *    （db-measured / computed / model-predicted 严格区分）；
 *  - 分子式级计算纯 JS 离线可用；RDKit（venv 可选）提供 SMILES 级性质，
 *    不可用时清晰降级；PubChem 开放数据查询（网络）；
 *  - 实验方法计划：仅生成待研究人员审核的计划——状态机只到 under-review/
 *    approved，没有 executing 状态，不控制仪器、不自动采购。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
	chemicalEntitySchema,
	chemicalPropertySchema,
	experimentPlanSchema,
	propertyKey,
	validateExperimentPlan,
	canTransitPlan,
	PLAN_TRANSITIONS,
	labChemistryTables
} from "../src/chemistry/models.js";
import {
	parseFormula,
	molecularWeightFromFormula,
	normalizeFormula,
	formulaToString
} from "../src/chemistry/elements.js";
import {
	polydispersity,
	degreeOfPolymerization,
	drugLoading,
	substitutionDegree,
	weightAverageFrom,
	theoreticalMn
} from "../src/chemistry/polymer-calc.js";
import { runRdkitCalc, lookupPubChem } from "../src/chemistry/rdkit-pubchem.js";
import { venvPythonPath } from "../src/python-env.js";

export const labChemistryDomainSpec = defineDomain({
	name: "lab_chemistry",
	version: 0,
	tables: {
		chemical_entities: domainTable(chemicalEntitySchema),
		chemical_properties: domainTable(chemicalPropertySchema),
		experiment_plans: domainTable(experimentPlanSchema)
	}
});

export class LabChemistryService extends Service {
	static inject = ["storageDomain"];
	tables = {};

	/** @param config {{ venvDir?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labChemistry");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labChemistryDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.chemistry.domainClose");
		this.domain = domain;
		this.tables = {
			entities: domain.table("chemical_entities"),
			properties: domain.table("chemical_properties"),
			plans: domain.table("experiment_plans")
		};
		this.venvPython = this.config.venvDir ? venvPythonPath(this.config.venvDir) : undefined;
	}

	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labChemistry is not started yet");
		return t;
	}

	// ── 实体 ────────────────────────────────────────────────────────────────

	async createEntity({ id, kind, name, formula, smiles, ...rest }) {
		const now = new Date().toISOString();
		if (this.table("entities").get(id) !== undefined) throw new Error(`chemical entity '${id}' already exists`);
		const entity = chemicalEntitySchema.parse({ id, kind, name, formula, smiles, ...rest, createdAt: now, updatedAt: now });
		// 分子式可解析性预检（不存坏公式）
		parseFormula(entity.formula);
		await this.table("entities").put(id, entity);
		return entity;
	}

	getEntity(id) {
		return this.table("entities").get(id);
	}

	listEntities() {
		return [...this.table("entities").keys()].sort().map((k) => this.table("entities").get(k));
	}

	// ── 带来源性质 ──────────────────────────────────────────────────────────

	/** 记录一条性质（sourceKind 区分 db-measured/computed/model-predicted）。 */
	async addProperty({ entityId, property, value, unit, sourceKind, source, sourceId, reference, confidence, notes }) {
		if (this.table("entities").get(entityId) === undefined) throw new Error(`chemical entity '${entityId}' not found`);
		const now = new Date().toISOString();
		const sid = sourceId ?? `${sourceKind}-${Date.now().toString(36)}`;
		const record = chemicalPropertySchema.parse({
			entityId,
			property,
			value,
			unit,
			sourceKind,
			source,
			reference,
			confidence,
			notes,
			createdAt: now
		});
		await this.table("properties").put(propertyKey(entityId, property, sid), record);
		return record;
	}

	/** 查询某实体的某性质，返回全部来源记录（最新在前）。 */
	queryProperty(entityId, property) {
		const rows = [];
		for (const k of this.table("properties").keys()) {
			const record = this.table("properties").get(k);
			if (record.entityId === entityId && record.property === property) rows.push(record);
		}
		return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	// ── 计算（纯 JS，离线） ─────────────────────────────────────────────────

	/** 分子式 → 元素组成 + 平均分子量（computed）。 */
	computeFromFormula(formula) {
		const counts = parseFormula(formula);
		return {
			formula: formulaToString(counts),
			elements: counts,
			molecularWeight: molecularWeightFromFormula(formula),
			sourceKind: "computed",
			source: "formula/mass calculation (dsh-lab-agent)"
		};
	}

	/** 聚合物派生指标（computed，公式来源）。 */
	computePolymerMetrics(input) {
		const out = {};
		if (input.Mw !== undefined && input.Mn !== undefined) out.Đ = polydispersity(input.Mw, input.Mn);
		if (input.Mn !== undefined && input.repeatUnitMw !== undefined) out.DP = degreeOfPolymerization(input);
		if (input.polymerMw !== undefined && input.drugMw !== undefined && input.drugCount !== undefined) out.drugLoading = drugLoading(input);
		if (input.drugCount !== undefined && input.availableSites !== undefined) out.substitutionDegree = substitutionDegree(input);
		if (input.Mn !== undefined && input.dispersity !== undefined) out.Mw = weightAverageFrom(input);
		if (input.repeatUnitMw !== undefined && input.dp !== undefined) out.theoreticalMn = theoreticalMn(input);
		return out;
	}

	// ── RDKit（venv 可选）与 PubChem（网络） ────────────────────────────────

	/** SMILES 级性质（需要 venv 安装 rdkit）；不可用返回 { available: false }。 */
	rdkitProperties(smiles) {
		return runRdkitCalc(this.venvPython, smiles);
	}

	/** PubChem 开放数据查询（网络）；返回 db-measured 性质集。 */
	async pubchemLookup(name, { fetchImpl = fetch } = {}) {
		const data = await lookupPubChem(name, { fetchImpl });
		return {
			...data,
			sourceKind: "db-measured",
			source: `PubChem CID ${data.cid}`
		};
	}

	/** 从 PubChem 导入：自动建实体（如缺）+ 登记 MW/formula/SMILES 性质。 */
	async importFromPubChem(name, { entityId, entityName = name, fetchImpl } = {}) {
		const data = await this.pubchemLookup(name, { fetchImpl });
		const id = entityId ?? `pubchem-${data.cid}`;
		if (this.table("entities").get(id) === undefined) {
			await this.createEntity({
				id,
				kind: "small-molecule",
				name: entityName,
				formula: data.formula ?? "?",
				smiles: data.canonicalSmiles,
				structureNotes: `PubChem CID ${data.cid} (${data.iupacName ?? ""})`
			});
		}
		const sourceId = `pubchem-${data.cid}`;
		if (data.molecularWeight !== undefined) {
			await this.addProperty({ entityId: id, property: "molecularWeight", value: data.molecularWeight, unit: "g/mol", sourceKind: "db-measured", source: data.source, sourceId });
		}
		if (data.formula) {
			await this.addProperty({ entityId: id, property: "formula", value: data.formula, unit: "", sourceKind: "db-measured", source: data.source, sourceId });
		}
		return { entity: this.getEntity(id), properties: this.queryProperty(id, "molecularWeight") };
	}

	// ── 实验方法计划 ────────────────────────────────────────────────────────

	/** 创建计划（draft）；创建前完整性校验。 */
	async createExperimentPlan({ id, projectId, title, objective, scale, ...rest }) {
		const now = new Date().toISOString();
		if (this.table("plans").get(id) !== undefined) throw new Error(`experiment plan '${id}' already exists`);
		const plan = experimentPlanSchema.parse({ id, projectId, title, objective, scale, ...rest, createdAt: now, updatedAt: now });
		const validation = validateExperimentPlan(plan);
		if (!validation.ok) {
			throw new Error(`experiment plan incomplete: ${validation.problems.join("; ")}`);
		}
		await this.table("plans").put(id, plan);
		return plan;
	}

	getExperimentPlan(id) {
		return this.table("plans").get(id);
	}

	listExperimentPlans() {
		return [...this.table("plans").keys()].sort().map((k) => this.table("plans").get(k));
	}

	/** 计划完整性校验（发布/提交前）。 */
	validatePlan(id) {
		const plan = this.getExperimentPlan(id);
		if (plan === undefined) throw new Error(`experiment plan '${id}' not found`);
		return validateExperimentPlan(plan);
	}

	/**
	 * 状态流转：仅人工审核路径（draft→under-review→approved|rejected）。
	 * 没有 executing/auto —— 本系统不控制仪器、不自动采购（计划 §四）。
	 */
	async updatePlanStatus(id, status) {
		const plan = this.getExperimentPlan(id);
		if (plan === undefined) throw new Error(`experiment plan '${id}' not found`);
		if (!canTransitPlan(plan.status, status)) {
			throw new Error(`invalid plan transition ${plan.status} -> ${status} (allowed: ${(PLAN_TRANSITIONS[plan.status] ?? []).join(", ")})`);
		}
		const next = { ...plan, status, updatedAt: new Date().toISOString() };
		await this.table("plans").put(id, next);
		return next;
	}
}

export default LabChemistryService;
