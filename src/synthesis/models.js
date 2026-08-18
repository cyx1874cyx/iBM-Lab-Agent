/**
 * dsh-lab-agent: 合成路线分析数据模型（纯逻辑层）。
 *
 * 计划 §七（阶段六，开放数据首版）：使用开放文献（OpenAlex）、专利
 * （USPTO PatentsView 适配器）与公开反应/化合物数据（PubChem）完成路线
 * 分析；CAS/SciFinder 在获得额外书面授权前不自动操作、不把 CAS 内容输入
 * 模型（见 src/cas/boundary.js）。
 *
 * 状态机：draft → under-review → approved | rejected（人工审核；与实验
 * 计划一致——不自动执行合成）。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "../goal-profile.js";

export const ROUTE_STATUSES = ["draft", "under-review", "approved", "rejected"];
export const ROUTE_TRANSITIONS = {
	draft: ["under-review", "rejected"],
	"under-review": ["approved", "rejected", "draft"],
	approved: ["rejected"],
	rejected: ["under-review", "draft"]
};

export function canTransitRoute(from, to) {
	return (ROUTE_TRANSITIONS[from] ?? []).includes(to);
}

/** 合成目标分子（可关联化学实体）。 */
export const synthesisTargetSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	name: z.string().min(1),
	smiles: z.string().optional(),
	formula: z.string().optional(),
	entityId: z.string().regex(PROFILE_ID_RE).optional(),
	notes: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 一条路线步骤。 */
export const routeStepSchema = z.object({
	step: z.number().int().positive(),
	reaction: z.string().min(1),
	reactants: z.array(z.string()).default([]),
	products: z.array(z.string()).default([]),
	reagents: z.array(z.string()).default([]),
	conditions: z.string().optional(),
	references: z.array(z.string()).default([]), // DOI / 专利号
	openSources: z.array(z.string()).default([]) // 开放数据源（openalex/patentsview/pubchem）
});

/** 一条合成路线（目标 → 多步）。 */
export const synthesisRouteSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	targetId: z.string().regex(PROFILE_ID_RE),
	name: z.string().min(1),
	steps: z.array(routeStepSchema).default([]),
	evidence: z
		.array(
			z.object({
				type: z.enum(["literature", "patent", "compound", "reaction-db"]),
				source: z.string().min(1),
				reference: z.string().min(1),
				notes: z.string().optional()
			})
		)
		.default([]),
	status: z.enum(ROUTE_STATUSES).default("draft"),
	createdAt: z.string(),
	updatedAt: z.string()
});

export const labSynthesisTables = {
	synthesis_targets: "synthesis_targets",
	synthesis_routes: "synthesis_routes"
};
