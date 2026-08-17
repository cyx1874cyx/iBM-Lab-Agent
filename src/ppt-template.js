/**
 * dsh-lab-agent: PptTemplateProfile — 可替换 PPT 模板系统（纯逻辑层）。
 *
 * 计划 §四：PPTX 主题 + 版式角色映射。模板包含原始 .pptx、名称/版本/用途/
 * 受众、页面比例/主题字体/颜色/Logo/页脚规则、版式角色→母版布局映射、
 * 必须页/可选页/最大页数/备注要求、占位符/安全区域/图像裁剪/字号限制。
 *
 * 导入流程（计划 §四）：上传 → 读取母版/布局/占位符/字体/主题色/比例 →
 * 自动提出版式角色映射 → 填充示例与预览 → 用户确认/调整 → 验证后发布。
 * 映射无效时在生成前明确失败，不静默替换为默认模板。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";

/** 统一版式角色（计划 §四）。 */
export const LAYOUT_ROLES = [
	"cover",
	"background",
	"research-gap",
	"design-workflow",
	"full-figure",
	"figure-with-analysis",
	"comparison",
	"mechanism",
	"limitations",
	"summary",
	"appendix"
];

export const TEMPLATE_STATUSES = ["draft", "ready", "archived"];

/** 一个版式角色的映射（版式角色 → PowerPoint 母版布局）。 */
export const roleMappingSchema = z.object({
	layoutId: z.string().min(1),
	notes: z.string().optional()
});

export const placeholderRulesSchema = z.object({
	safeAreaInches: z.number().nonnegative().optional(),
	imageCrop: z.enum(["contain", "cover"]).default("contain"),
	minFontPt: z.number().positive().optional()
});

/** 一个 PptTemplateProfile 版本行。 */
export const pptTemplateProfileSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	version: z.string().regex(/^\d+$/),
	name: z.string().min(1),
	purpose: z.string().default(""),
	audience: z.string().default("课题组组会"),
	pageSize: z.object({
		ratio: z.string().min(1),
		type: z.string().optional()
	}),
	theme: z
		.object({
			name: z.string().optional(),
			colors: z.record(z.string(), z.string()).default({}),
			fonts: z.object({ major: z.string().optional(), minor: z.string().optional() }).default({})
		})
		.default({}),
	logo: z.string().optional(),
	footerRules: z.string().default(""),
	/** 版式角色 → 母版布局映射。 */
	layoutRoleMapping: z.record(z.enum(LAYOUT_ROLES), roleMappingSchema),
	requiredPages: z.array(z.enum(LAYOUT_ROLES)).default([]),
	optionalPages: z.array(z.enum(LAYOUT_ROLES)).default([]),
	maxPages: z.number().int().positive().optional(),
	notesRequirement: z.string().default(""),
	placeholderRules: placeholderRulesSchema.default({}),
	source: z.object({
		file: z.string().min(1),
		sha256: z.string()
	}),
	status: z.enum(TEMPLATE_STATUSES).default("draft"),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 内置默认：Nature 默认模板（无源文件，交由 nature-paper2ppt 默认流程）。 */
export function createNatureDefaultTemplate(now = new Date().toISOString()) {
	return pptTemplateProfileSchema.parse({
		id: "nature-default",
		version: "1",
		name: "Nature Skills 默认模板",
		purpose: "使用 nature-paper2ppt 的默认版式与生成流程",
		audience: "通用",
		pageSize: { ratio: "16:9" },
		theme: {},
		logo: undefined,
		footerRules: "",
		layoutRoleMapping: Object.fromEntries(LAYOUT_ROLES.map((role) => [role, { layoutId: "nature-default", notes: "由 nature-paper2ppt 处理" }])),
		requiredPages: ["cover", "summary"],
		optionalPages: ["appendix"],
		maxPages: 20,
		notesRequirement: "每页含讲稿备注",
		placeholderRules: {},
		source: { file: "(nature-default)", sha256: "nature-default" },
		status: "ready",
		createdAt: now,
		updatedAt: now
	});
}

/** 内置默认模板（服务种子用）。 */
export const BUILTIN_TEMPLATES = [createNatureDefaultTemplate()];

/** 行 key：id@version。 */
export const templateKey = (id, version) => `${id}@${version}`;

/** 从一组行计算下一个版本号。 */
export function nextTemplateVersion(versions) {
	const max = versions.reduce((m, v) => Math.max(m, Number(v)), 0);
	return String(max + 1);
}

/**
 * 自动提出版式角色映射建议（计划 §四 步骤 3）。
 * 基于每个布局的占位符特征打分；返回每个角色的 { layoutId, score, reason }。
 * 用户确认或调整后才发布。
 */
export function suggestRoleMapping(layouts, page) {
	const scored = (role, layout, score, reason) => ({ role, layoutId: layout.id, score, reason });

	const has = (layout, type) => layout.placeholders.some((p) => p.type === type);
	const phCount = (layout) => layout.placeholders.length;
	const firstBody = layouts.find((l) => has(l, "body")) ?? layouts[0];
	const firstTitle = layouts.find((l) => has(l, "title")) ?? firstBody;
	const fewest = (predicate) => {
		const pool = layouts.filter(predicate);
		if (pool.length === 0) return undefined;
		return [...pool].sort((a, b) => phCount(a) - phCount(b))[0];
	};

	const suggestions = {};
	const assign = (role, layout, score, reason) => {
		if (layout === undefined) return;
		const current = suggestions[role];
		if (!current || score > current.score) suggestions[role] = { layoutId: layout.id, score, reason };
	};

	for (const layout of layouts) {
		let s = 0;
		if (has(layout, "title")) s += 2;
		if (has(layout, "body")) s += 1;
		if (has(layout, "pic") || has(layout, "picture")) s += 3;
		if (phCount(layout) >= 3) s += 1;
		assign("cover", layout, s + (has(layout, "title") && !has(layout, "body") ? 5 : 0), "title-only layout");
		assign("background", layout, phCount(layout) === 0 ? 10 : 0, "empty layout");
		assign("full-figure", layout, (has(layout, "pic") ? 6 : 0) + (phCount(layout) <= 1 ? 3 : 0), "picture layout");
		assign("figure-with-analysis", layout, (has(layout, "pic") ? 4 : 0) + (has(layout, "body") ? 4 : 0), "picture+body");
		assign("comparison", layout, phCount(layout) >= 3 ? 6 : 0, "3+ placeholders");
		assign("research-gap", layout, has(layout, "title") && has(layout, "body") ? 4 : 0, "title+body");
		assign("design-workflow", layout, has(layout, "title") && has(layout, "body") ? 4 : 0, "title+body");
		assign("mechanism", layout, has(layout, "title") && has(layout, "body") ? 4 : 0, "title+body");
		assign("summary", layout, has(layout, "title") && has(layout, "body") ? 4 : 0, "title+body");
		assign("limitations", layout, has(layout, "title") && has(layout, "body") ? 4 : 0, "title+body");
		assign("appendix", layout, has(layout, "body") && phCount(layout) >= 2 ? 4 : 0, "body-rich");
	}

	// 兜底：未获得建议的角色落到 title+body（或首个布局）
	const fallback = firstTitle;
	for (const role of LAYOUT_ROLES) {
		if (!suggestions[role]) suggestions[role] = { layoutId: fallback.id, score: 0, reason: "fallback" };
	}
	return suggestions;
}

/**
 * 验证模板（发布/生成前）。计划 §四：映射无效时在生成前明确失败。
 * @returns { ok: true } 或 { ok: false, problems: string[] }
 */
export function validateTemplate(profile, parsed) {
	const problems = [];
	if (!profile.pageSize?.ratio) problems.push("missing page size ratio");
	if (!parsed) {
		problems.push("no parsed template structure (source pptx unavailable)");
		return { ok: false, problems };
	}
	if (!parsed.layouts || parsed.layouts.length === 0) problems.push("no slide layouts found");
	const layoutIds = new Set((parsed.layouts ?? []).map((l) => l.id));
	for (const [role, mapping] of Object.entries(profile.layoutRoleMapping)) {
		if (!layoutIds.has(mapping.layoutId)) {
			problems.push(`role '${role}' maps to unknown layout '${mapping.layoutId}'`);
		}
	}
	if (profile.status === "ready") {
		const mapped = new Set(Object.keys(profile.layoutRoleMapping));
		for (const role of LAYOUT_ROLES) {
			if (!mapped.has(role)) problems.push(`role '${role}' unmapped (required for ready)`);
		}
	}
	return { ok: problems.length === 0, problems };
}
