/**
 * dsh-lab-agent: 化学数据模型（纯逻辑层）。
 *
 * 计划 §四：
 *  - 小分子 / 单体 / 重复单元 / 聚合物 / 聚前药实体 + 带来源的 ChemicalProperty
 *    （区分 db-measured 数据库实测 / computed 计算 / model-predicted 模型预测）；
 *  - 实验方法计划：输入目标/规模/试剂/仪器/文献证据，输出计量表/步骤/监测/
 *    后处理/纯化/表征/安全/备选方案；仅生成待研究人员审核的计划，不控制
 *    仪器或自动采购（状态机没有 executing 状态）。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "../goal-profile.js";

// ── 化学实体 ────────────────────────────────────────────────────────────────

export const ENTITY_KINDS = ["small-molecule", "monomer", "repeat-unit", "polymer", "prodrug-polymer"];

export const chemicalEntitySchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	name: z.string().min(1),
	kind: z.enum(ENTITY_KINDS),
	formula: z.string().min(1),
	smiles: z.string().optional(),
	inchi: z.string().optional(),
	canonicalSmiles: z.string().optional(),
	structureNotes: z.string().optional(),
	/** 聚合物：聚合策略（RAFT/ATRP/开环等）。 */
	polymerization: z.string().optional(),
	backboneType: z.string().optional(),
	/** 聚前药：连接方式/连接臂/释放机制/连接位点。 */
	linkageType: z.string().optional(),
	linker: z.string().optional(),
	releaseMechanism: z.string().optional(),
	attachmentSite: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

// ── 化学性质（带来源） ───────────────────────────────────────────────────────

/** 来源类别：数据库实测 / 计算 / 模型预测。 */
export const PROPERTY_SOURCE_KINDS = ["db-measured", "computed", "model-predicted"];

export const chemicalPropertySchema = z.object({
	entityId: z.string().regex(PROFILE_ID_RE),
	property: z.string().min(1),
	value: z.union([z.number(), z.string()]),
	unit: z.string().default(""),
	sourceKind: z.enum(PROPERTY_SOURCE_KINDS),
	/** 具体来源：PubChem CID / RDKit / 公式名 / 文献 DOI / 用户输入。 */
	source: z.string().min(1),
	reference: z.string().optional(),
	confidence: z.string().optional(),
	notes: z.string().optional(),
	createdAt: z.string()
});

export const propertyKey = (entityId, property, sourceId) => `${entityId}@${property}@${sourceId}`;

// ── 实验方法计划 ─────────────────────────────────────────────────────────────

export const reagentSchema = z.object({
	name: z.string().min(1),
	formula: z.string().optional(),
	cas: z.string().optional(),
	amount: z.string().min(1),
	role: z.string().default("")
});

export const planStepSchema = z.object({
	step: z.string().min(1),
	description: z.string().min(1),
	monitoring: z.string().optional()
});

export const measurementSchema = z.object({
	metric: z.string().min(1),
	method: z.string().min(1),
	target: z.string().optional()
});

export const literatureEvidenceSchema = z.object({
	reference: z.string().min(1),
	notes: z.string().optional()
});

/** 实验计划状态：仅到人工审核；没有 executing/auto（不控制仪器、不自动采购）。 */
export const PLAN_STATUSES = ["draft", "under-review", "approved", "rejected"];
export const PLAN_TRANSITIONS = {
	draft: ["under-review", "rejected"],
	"under-review": ["approved", "rejected"],
	approved: ["rejected"],
	rejected: ["under-review"]
};

export const experimentPlanSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	title: z.string().min(1),
	objective: z.string().min(1),
	scale: z.string().min(1),
	reagents: z.array(reagentSchema).default([]),
	instruments: z.array(z.string()).default([]),
	literatureEvidence: z.array(literatureEvidenceSchema).default([]),
	measurementTable: z.array(measurementSchema).default([]),
	steps: z.array(planStepSchema).default([]),
	workup: z.string().optional(),
	purification: z.array(z.string()).default([]),
	characterization: z.array(z.string()).default([]),
	safety: z.array(z.string()).default([]),
	alternatives: z.array(z.string()).default([]),
	/** 0.4.0：生成时采用的实验计划模板版本快照（id/version/name/sections），旧记录可缺省。 */
	templateSnapshot: z.object({
		id: z.string(),
		version: z.string(),
		name: z.string(),
		sections: z.array(z.string()).default([])
	}).optional(),
	requiresReview: z.literal(true).default(true),
	status: z.enum(PLAN_STATUSES).default("draft"),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 实验计划完整性校验（发布/提交前）。 */
export function validateExperimentPlan(plan) {
	const problems = [];
	if (!plan.objective.trim()) problems.push("objective required");
	if (!plan.scale.trim()) problems.push("scale required");
	if (plan.reagents.length === 0) problems.push("at least one reagent required");
	else {
		plan.reagents.forEach((r, i) => {
			if (!r.name.trim()) problems.push(`reagent[${i}].name required`);
			if (!r.amount.trim()) problems.push(`reagent[${i}].amount required`);
		});
	}
	if (plan.steps.length === 0) problems.push("at least one step required");
	else plan.steps.forEach((s, i) => {
		if (!s.description.trim()) problems.push(`step[${i}].description required`);
	});
	if (plan.measurementTable.length === 0) problems.push("measurement table required");
	if (plan.safety.length === 0) problems.push("safety section required");
	if (plan.characterization.length === 0) problems.push("characterization section required");
	return { ok: problems.length === 0, problems };
}

export function canTransitPlan(from, to) {
	return (PLAN_TRANSITIONS[from] ?? []).includes(to);
}

export const labChemistryTables = {
	chemical_entities: "chemical_entities",
	chemical_properties: "chemical_properties",
	experiment_plans: "experiment_plans"
};
