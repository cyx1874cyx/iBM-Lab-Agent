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
 *
 * 0.3.0 合成路线工作台（研究设计页）扩展约定：
 *  - 所有新增字段均为 optional / default，保证 storage domain 打开旧记录
 *    时 zod parse 仍然通过（读取时 parse，见 dsh-storage-domain）；
 *  - 旧 routeStep 的步骤序号用 step 表示、无 id；工作台读取时由服务层
 *    hydrate 出 id（如 S1/S2）与 label，不写回存储（lazy migration）；
 *  - procedure 是结构化条件（真数据）；legacy `conditions` 字符串只作为
 *    raw 摘要保留，不作为新字段的事实来源；
 *  - Evidence 独立成表，支持“字段级”溯源（supportsField）；
 *  - Route 版本通过“复制为新 Route + parentRouteId”实现（§6.4），不引入
 *    不可变快照表。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "../goal-profile.js";

// ── 状态机（与 0.2.x 一致，人工审核） ──────────────────────────────────────

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

// ── 路线版本 / 来源（§6.4） ────────────────────────────────────────────────

export const ROUTE_ORIGINS = ["literature-extracted", "human-edited", "agent-optimized", "retrosynthesis"];

export const STEP_REVIEW_STATUSES = ["pending", "confirmed", "edited", "rejected"];

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"];

// ── Evidence 来源分层（§9.1） ──────────────────────────────────────────────

/** 证据来源类型：目标论文 SI/正文、引用方法、相似文献/专利/开放库、内部、模型推断。 */
export const EVIDENCE_SOURCE_TYPES = [
	"paper-si", //        当前论文 Supporting Information（首要实验事实）
	"paper-main", //      当前论文正文 / Scheme / Caption
	"cited-method", //    当前论文明确引用的原始方法
	"similar-literature", // 相似反应 / 相似底物文献
	"patent", //          专利
	"reaction-db", //     开放反应数据库
	"compound-db", //     化合物数据库（PubChem 等）
	"internal", //        内部 SOP / 用户人工确认
	"model-inference" //  Agent 推断（只能作为建议，必须显式标记）
];

export const EVIDENCE_SOURCE_TIERS = [1, 2, 3, 4, 5];

export const EVIDENCE_RELATIONS = ["supports", "conflicts", "context"];

export const EVIDENCE_EXTRACTION_METHODS = ["text", "vlm", "manual", "search", "model"];

export const EVIDENCE_REVIEW_STATUSES = ["pending", "confirmed", "edited", "rejected"];

// ── 合成目标分子（可关联化学实体） ────────────────────────────────────────

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

// ── Step 结构化条件（§6.2 procedure） ──────────────────────────────────────

/** 每个结构条目；name 为展示名。amount/equivalent 只接受文献给出或人工填写，
 *  不存在的值一律缺省，由 UI 显示“文献未提供 / 待确认”。 */
export const stepReagentSchema = z.object({
	name: z.string().min(1),
	entityId: z.string().regex(PROFILE_ID_RE).optional(),
	amount: z.string().optional(),
	equivalent: z.string().optional(),
	role: z.string().optional()
});

export const stepCatalystSchema = z.object({
	name: z.string().min(1),
	entityId: z.string().regex(PROFILE_ID_RE).optional(),
	loading: z.string().optional(),
	role: z.string().optional()
});

export const stepSolventSchema = z.object({
	name: z.string().min(1),
	volume: z.string().optional(),
	ratio: z.string().optional()
});

export const stepTemperatureSchema = z.object({
	value: z.string().min(1), // 如 "-78 °C"；保留原文格式，不做单位换算
	unit: z.string().optional(),
	stage: z.string().optional() // 如 "reaction" / "workup"；多阶段可多条
});

export const stepTimeSchema = z.object({
	value: z.string().optional(), // 数值，如 "2"
	unit: z.string().optional(), // 如 "h" / "min"
	text: z.string().optional() // 原文描述，优先展示
});

export const stepYieldSchema = z.object({
	value: z.string().optional(),
	unit: z.string().default("%"),
	type: z.string().optional() // isolated / crude / brsm 等
});

/** 结构化反应条件：作为 Step 的真数据来源；旧数据无此对象（optional）。 */
export const stepProcedureSchema = z.object({
	reagents: z.array(stepReagentSchema).default([]),
	catalysts: z.array(stepCatalystSchema).default([]),
	solvents: z.array(stepSolventSchema).default([]),
	temperature: z.array(stepTemperatureSchema).default([]),
	time: stepTimeSchema.optional(),
	atmosphere: z.string().optional(),
	concentration: z.string().optional(),
	yield: stepYieldSchema.optional(),
	workup: z.array(z.string()).default([]),
	purification: z.array(z.string()).default([]),
	monitoring: z.array(z.string()).default([]),
	notes: z.array(z.string()).default([])
});

/** 一条路线步骤。
 *
 * 兼容策略（§6.1）：不删除 legacy 字段（reactants/products/reagents/
 * conditions/references/openSources），新增字段全部 optional/default；
 * 旧记录在 storage domain 打开时 parse 通过，服务层读取时 lazy hydrate。
 */
export const routeStepSchema = z.object({
	step: z.number().int().positive(),
	id: z.string().regex(PROFILE_ID_RE).optional(), // hydrate: S{step}
	label: z.string().optional(), // 短名，如 "RAFT 聚合"

	reaction: z.string().min(1),

	// legacy + quick display
	reactants: z.array(z.string()).default([]),
	products: z.array(z.string()).default([]),
	reagents: z.array(z.string()).default([]),
	conditions: z.string().optional(), // legacy/raw 摘要

	entityRefs: z
		.object({
			reactants: z.array(z.string()).default([]),
			products: z.array(z.string()).default([])
		})
		.default({ reactants: [], products: [] }),

	// 结构化条件（0.3.0 工作台主数据）
	procedure: stepProcedureSchema.optional(),

	evidenceIds: z.array(z.string()).default([]),
	confidence: z
		.object({
			overall: z.enum(CONFIDENCE_LEVELS).default("unknown"),
			missingFields: z.array(z.string()).default([])
		})
		.optional(),
	review: z
		.object({
			status: z.enum(STEP_REVIEW_STATUSES).default("pending"),
			reviewedAt: z.string().optional()
		})
		.default({ status: "pending" }),

	references: z.array(z.string()).default([]), // DOI / 专利号
	openSources: z.array(z.string()).default([]) // 开放数据源（openalex/patentsview/pubchem）
});

// ── Step Evidence（§6.3，独立表） ──────────────────────────────────────────

/** 字段级证据：能回答“这个温度从哪来？”。 */
export const synthesisEvidenceSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	routeId: z.string().regex(PROFILE_ID_RE),
	/** 兼容：旧步骤没有 id，可用 stepKey（1-based 序号）定位。 */
	stepId: z.string().regex(PROFILE_ID_RE).optional(),
	stepKey: z.number().int().positive().optional(),
	/** 支持字段描述，如 "procedure.temperature" / "温度"；允许自由文本便于 UI 弱匹配。 */
	supportsField: z.string().min(1),

	sourceType: z.enum(EVIDENCE_SOURCE_TYPES).default("paper-si"),
	sourceTier: z.number().int().min(1).max(5).default(5),
	sourceName: z.string().min(1),
	title: z.string().optional(),
	doi: z.string().optional(),
	documentId: z.string().optional(),
	page: z.union([z.string(), z.number()]).optional(),
	figure: z.string().optional(),
	table: z.string().optional(),
	bbox: z.array(z.number()).optional(), // [x1,y1,x2,y2]，首版可选
	excerpt: z.string().optional(),

	relation: z.enum(EVIDENCE_RELATIONS).default("supports"),
	extractionMethod: z.enum(EVIDENCE_EXTRACTION_METHODS).default("manual"),
	confidence: z.enum(CONFIDENCE_LEVELS).default("unknown"),
	reviewStatus: z.enum(EVIDENCE_REVIEW_STATUSES).default("pending"),
	createdAt: z.string(),
	updatedAt: z.string()
});

// ── Extraction Job（§6.5，异步多模态解析占位） ─────────────────────────────

export const EXTRACTION_JOB_STATUSES = ["queued", "parsing", "extracting", "resolving", "needs-review", "completed", "failed"];

export const EXTRACTION_JOB_TRANSITIONS = {
	queued: ["parsing", "failed"],
	parsing: ["extracting", "failed"],
	extracting: ["resolving", "needs-review", "failed"],
	resolving: ["needs-review", "completed", "failed"],
	"needs-review": ["completed", "resolving", "failed"],
	completed: [],
	failed: ["queued"]
};

export function canTransitExtractionJob(from, to) {
	return (EXTRACTION_JOB_TRANSITIONS[from] ?? []).includes(to);
}

export const extractionJobSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE),
	documentIds: z.array(z.string()).default([]),
	status: z.enum(EXTRACTION_JOB_STATUSES).default("queued"),
	progress: z.number().min(0).max(1).default(0), // 0..1
	warnings: z.array(z.string()).default([]),
	routeId: z.string().regex(PROFILE_ID_RE).optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

// ── Route（含版本 / origin，§6.4） ─────────────────────────────────────────

/** 化合物节点（可选）。工作台优先使用它构图；旧数据缺省时由前端按步骤
 *  reactants/products 推导线性展示，不写回存储。 */
export const routeCompoundSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	label: z.string().min(1),
	subtitle: z.string().optional(),
	smiles: z.string().optional(),
	role: z.enum(["starting-material", "intermediate", "target"]).optional()
});

/** 一条合成路线（目标 → 多步），带版本/origin/审核状态。 */
export const synthesisRouteSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	targetId: z.string().regex(PROFILE_ID_RE),
	name: z.string().min(1),
	steps: z.array(routeStepSchema).default([]),
	compounds: z.array(routeCompoundSchema).default([]),

	// 0.3.0：版本 / 来源 / 父版本（复制为新 Route 实现版本管理）
	version: z.number().int().positive().default(1),
	origin: z.enum(ROUTE_ORIGINS).default("human-edited"),
	parentRouteId: z.string().regex(PROFILE_ID_RE).optional(),
	changeNotes: z.string().optional(),

	evidence: z
		.array(
			z.object({
				type: z.enum(["literature", "patent", "compound", "reaction-db"]),
				source: z.string().min(1),
				reference: z.string().min(1),
				notes: z.string().optional()
			})
		)
		.default([]), // legacy route-level 开放证据（保留兼容；新证据入 synthesis_evidence 表）
	status: z.enum(ROUTE_STATUSES).default("draft"),
	createdAt: z.string(),
	updatedAt: z.string()
});

export const labSynthesisTables = {
	synthesis_targets: "synthesis_targets",
	synthesis_routes: "synthesis_routes",
	synthesis_evidence: "synthesis_evidence",
	synthesis_extraction_jobs: "synthesis_extraction_jobs"
};
