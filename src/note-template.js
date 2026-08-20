/**
 * dsh-lab-agent: NoteTemplate — 可替换的「阅读笔记模板」系统（纯逻辑层）。
 *
 * 需求：插件主面板需要一个模板管理功能，管理**阅读笔记**与 **PPT** 两类模板，
 * 让 Agent 生成阅读笔记与汇报 PPT 时按模板生成。本模块是**阅读笔记模板**的
 * 纯逻辑层（PPT 模板沿用 PptTemplateProfile，见 ./ppt-template.js）。
 *
 * 阅读笔记模板定义一篇阅读笔记的：
 *   - 受众/语言/篇幅（字数上下限）；
 *   - 固定章节结构（section 列表：章节 key/标题/必填/要点提示）；
 *   - 风格规则（语气、编号、引用方式等）；
 *   - 证据与来源要求；
 *   - 附加输出要求。
 *
 * 版本语义与 ReadingGoalProfile 一致（./goal-profile.js）：
 *   - 版本行不可变，key = `${id}@${version}`，version 单调递增；
 *   - update = 基于最新版本发布新版本；delete = 发布 status:"archived" 尾部版本；
 *   - resolve(id, version?) 读具体版本，缺省取最新；历史/快照永远可读。
 *
 * 说明：本模块只做数据模型与转换，持久化放在 lib/note-templates.js 服务层。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";

/** 阅读笔记可用语言。 */
export const NOTE_LANGUAGES = ["zh", "en", "zh-en"];

/** 一个阅读笔记章节（固定结构中的一节）。 */
export const noteSectionSchema = z.object({
	/** 机器 key（小写英文连字符）。 */
	key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
	/** 展示标题（可中文）。 */
	title: z.string().min(1),
	/** 是否必填。 */
	required: z.boolean().default(true),
	/** 本节写作要点/提示。 */
	hint: z.string().default("")
});

/** 一个 NoteTemplate 版本行。 */
export const noteTemplateSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	version: z.string().regex(/^\d+$/),
	/** 显示名（可含中文/空格）。 */
	name: z.string().min(1),
	/** 适用课题。 */
	topics: z.array(z.string()).default([]),
	/** 标签。 */
	tags: z.array(z.string()).default([]),
	/** 目标受众。 */
	audience: z.string().default("课题组组会"),
	/** 笔记语言。 */
	language: z.enum(NOTE_LANGUAGES).default("zh"),
	/** 篇幅说明（如 "约 300-500 字/节"）。 */
	length: z.string().default("侧重核心内容，单篇 400-800 字"),
	/** 固定章节结构（阅读笔记的骨架）。 */
	sections: z.array(noteSectionSchema).default([]),
	/** 风格规则（语气/编号/引用方式等）。 */
	styleRules: z.array(z.string()).default([]),
	/** 证据与来源要求。 */
	evidenceRequirements: z.array(z.string()).default([]),
	/** 附加输出要求。 */
	outputRequirements: z.array(z.string()).default([]),
	/** 备注（可选，示意模板如何被使用）。 */
	remark: z.string().optional(),
	/** 内部 meta（由服务维护）。 */
	status: z.enum(["active", "archived"]).default("active"),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 模板行 key：id@version。 */
export const noteTemplateKey = (id, version) => `${id}@${version}`;

/** 从一组行计算下一个版本号（max+1，字符串）。 */
export function nextNoteTemplateVersion(versions) {
	const max = versions.reduce((m, v) => Math.max(m, Number(v)), 0);
	return String(max + 1);
}

/** 内置默认阅读笔记模板（课题组聚前药/高分子场景）。 */
export function createDefaultNoteTemplate(now = new Date().toISOString()) {
	return noteTemplateSchema.parse({
		id: "note-default",
		version: "1",
		name: "课题组阅读笔记模板（默认）",
		topics: ["聚前药", "高分子材料设计", "药物递送"],
		tags: ["note", "default"],
		audience: "课题组组会",
		language: "zh",
		length: "单篇 600-1000 字，突出与课题相关的关键内容",
		sections: [
			{ key: "citation", title: "文献信息", required: true, hint: "标题、作者、期刊、年份、DOI 的规范短引用" },
			{ key: "one-sentence-summary", title: "一句话概述", required: true, hint: "问题、做法、机制、成果各一短句" },
			{ key: "background-gap", title: "背景与空缺", required: true, hint: "研究背景、现有不足、本文切入点" },
			{ key: "core-idea", title: "核心思路", required: true, hint: "表面方法 + 核心洞察" },
			{ key: "methods", title: "方法与实验设计", required: true, hint: "输入输出、模块、表征手段、关键数据" },
			{ key: "key-results", title: "关键结果与证据链", required: true, hint: "关键参数（Mn/DP/取代度/载药量/粒径/释放）带来源" },
			{ key: "conclusions-boundary", title: "结论与边界", required: true, hint: "作者结论 + 任务范围/人群边界 + 未验证部分" },
			{ key: "limitations", title: "作者明确局限", required: true, hint: "仅作者承认的局限，附未来方向" },
			{ key: "critical-analysis", title: "批判性分析", required: false, hint: "可验证的疑点或替代解释" },
			{ key: "link-to-project", title: "与本课题的联系", required: true, hint: "对本课题可能的价值、可借鉴方法与启发" },
			{ key: "questions", title: "待讨论问题", required: false, hint: "组会可讨论的开放问题" }
		],
		styleRules: [
			"用中文正文，保留规范英文术语并用括号标注中文释义",
			"每个数字必须带来源定位（页码/图表/来源块）",
			"区分数据库实测值、计算值与模型预测值"
		],
		evidenceRequirements: [
			"关键数字追溯到原文图表、页码或来源块",
			"来源不足处标注“无法判断”，不补写不可见内容",
			"统计显著性（n、对照、p 值）核验后写入"
		],
		outputRequirements: [
			"输出为 Markdown，用模板章节作为二级标题",
			"每条结论与来源一一对应，避免泛泛而谈"
		],
		remark: "默认阅读笔记模板：Agent 生成阅读笔记时若未指定模板，使用本模板。",
		status: "active",
		createdAt: now,
		updatedAt: now
	});
}

/** 内置默认阅读笔记模板（服务种子用）。 */
export const BUILTIN_NOTES = [createDefaultNoteTemplate()];

/**
 * 转换为模型可直接注入阅读笔记生成流程的结构化要求。
 * 生成时按模板：章节为骨架，风格/证据/输出要求约束行文。
 */
export function toNoteRequirements(template) {
	return {
		audience: template.audience,
		language: template.language,
		length: template.length,
		sections: template.sections.map((s) => ({
			key: s.key,
			title: s.title,
			required: s.required,
			hint: s.hint
		})),
		styleRules: template.styleRules,
		evidenceRequirements: template.evidenceRequirements,
		outputRequirements: template.outputRequirements,
		contract: "Read the note template sections in order; keep every required section and mark optional ones when non-applicable as 不适用。"
	};
}

/** 复制一个模板为新 id（可复制后改造成自己的模板）。 */
export function cloneNoteTemplate(source, id, name, now = new Date().toISOString()) {
	return noteTemplateSchema.parse({
		...source,
		id,
		version: "1",
		name,
		status: "active",
		createdAt: now,
		updatedAt: now
	});
}
