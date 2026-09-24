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
	/** 模板用途：note = 单篇阅读笔记（默认，兼容旧数据）；review = 多篇文献综述。 */
	kind: z.enum(["note", "review"]).default("note"),
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
	/** 原始 Markdown 模板全文（.md 导入时保留；生成契约以原文为准）。 */
	templateMarkdown: z.string().default(""),
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

/* ── Markdown 模板解析（.md 导入 → 真实章节结构）──────────────────────────── */

const NOTE_HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
/** 占位符：模板里的【填写：……】/【填写】。 */
const PLACEHOLDER_RE = /【[^】]*】/g;
/** 章节标题里出现这些词视为可选节。 */
const OPTIONAL_TITLE_RE = /可选|选填|如有|非必填|optional/i;
/** 允许的章节 key：小写英文/数字/连字符。 */
const SECTION_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 从篇幅说明或原文里解析最小正文字数（如 "600-1000 字" → 600）。 */
export function noteLengthFloor(length) {
	const text = String(length ?? "");
	const range = text.match(/(\d+)\s*[-–~—至到]\s*(\d+)\s*字/);
	if (range) return Number(range[1]);
	const atLeast = text.match(/(?:不少于|至少|不低于)\s*(\d+)\s*字/);
	if (atLeast) return Number(atLeast[1]);
	const approx = text.match(/(\d+)\s*字\s*(?:左右|以上)/);
	if (approx) return Number(approx[1]);
	return undefined;
}

/** 由章节标题生成稳定 key：优先 ASCII 化，纯中文标题回退 section-N。 */
function sectionKeyOf(title, index) {
	const ascii = String(title ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return SECTION_KEY_RE.test(ascii) ? ascii : `section-${index + 1}`;
}

/**
 * 解析自由格式的 Markdown 阅读笔记模板 → 结构化模板字段。
 *
 * 规则：
 *   - 第一个 `#` 标题作为模板名（其后 `#` 视结构层级而定）；
 *   - 若存在 `##`，则 `##` 为章节骨架，`###` 及以下、表格、正文都并入该节
 *     写作要点（hint），保留原始层级文字；
 *   - 若没有 `##`，则把 `#` 作为章节（第一个 `#` 仍是模板名）；
 *   - 标题里含"可选/如有/非必填"的节标为非必填；
 *   - 全文原文保留在 templateMarkdown，生成契约以它为准。
 *
 * @param {string} markdown 模板 Markdown 全文
 * @param {{ fileName?: string }} options
 * @returns {{ name: string, length: string, minContentChars?: number, sections: Array, templateMarkdown: string }}
 */
export function parseNoteTemplateMarkdown(markdown, { fileName } = {}) {
	const text = String(markdown ?? "").replace(/\r\n?/g, "\n");
	const lines = text.split("\n");
	const fileStem = String(fileName ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
	const hasH2 = /^##\s+\S/m.test(text);
	const sectionLevel = hasH2 ? 2 : 1;

	let name = "";
	let current = null;
	const sections = [];

	const flush = () => {
		if (current === null) return;
		current.hint = current.bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
		delete current.bodyLines;
		sections.push(current);
		current = null;
	};

	for (const line of lines) {
		const match = NOTE_HEADING_RE.exec(line);
		const level = match ? match[1].length : 0;

		if (match && level === 1 && name === "" && !hasH2) {
			// 无 ## 结构时，第一个 # 是模板名；其余 # 由下面的 level===sectionLevel 处理。
			name = match[2].replace(PLACEHOLDER_RE, "").trim() || match[2].trim();
			continue;
		}
		if (match && level === 1 && name === "") {
			name = match[2].replace(PLACEHOLDER_RE, "").trim() || match[2].trim();
			continue;
		}
		if (match && level === sectionLevel) {
			flush();
			const raw = match[2].trim();
			const stripped = raw.replace(PLACEHOLDER_RE, "").replace(/^[\d一二三四五六七八九十]+[、.．)）]\s*/, "").trim();
			const title = stripped || (raw ? "封面信息" : `章节 ${sections.length + 1}`);
			current = {
				title,
				required: !OPTIONAL_TITLE_RE.test(raw),
				bodyLines: [],
				raw
			};
			continue;
		}
		if (match && level > sectionLevel && current !== null) {
			const sub = match[2].replace(PLACEHOLDER_RE, "").trim();
			if (sub) current.bodyLines.push(`${"#".repeat(level)} ${sub}`);
			continue;
		}
		if (current !== null) current.bodyLines.push(line);
	}
	flush();

	// 分配 key 并去重（审计按 title 匹配，key 仅作稳定标识）。
	const seen = new Map();
	const normalized = sections.map((section, index) => {
		let key = sectionKeyOf(section.title, index);
		const count = (seen.get(key) ?? 0) + 1;
		seen.set(key, count);
		if (count > 1) key = `${key}-${count}`;
		return {
			key,
			title: section.title,
			required: section.required,
			hint: section.hint
		};
	});

	const lengthMatch = text.match(/(?:不少于|至少|不低于)\s*(\d+)\s*字/)
		?? text.match(/(\d+)\s*[-–~—至到]\s*(\d+)\s*字/)
		?? text.match(/(\d+)\s*字\s*(?:左右|以上)/);
	const length = lengthMatch
		? (/不少于|至少|不低于/.test(lengthMatch[0])
			? `不少于 ${lengthMatch[1]} 字`
			: lengthMatch[2]
				? `${lengthMatch[1]}-${lengthMatch[2]} 字`
				: `${lengthMatch[1]} 字左右`)
		: "";
	const minContentChars = noteLengthFloor(length);

	return {
		name: name || fileStem || "导入的阅读笔记模板",
		length,
		...(minContentChars !== undefined ? { minContentChars } : {}),
		sections: normalized,
		templateMarkdown: text.trim()
	};
}

/**
 * 渲染「精读生成契约」Markdown：模板骨架 + 原文 + 现有资源 + 强制顺序。
 * 落盘成文件由 Agent 用 read 读取，避免超长工具结果被结果裁剪器截断。
 */
export function renderNoteContract({ template, requirements, resources = [], mustReadPaths = [], formatSource, bundleId, reportId, title } = {}) {
	const lines = [
		"# 精读生成契约",
		"",
		`- 文献：${title || bundleId || "(未命名)"}`,
		`- bundleId：${bundleId ?? "(无)"}${reportId ? `\n- reportId：${reportId}` : ""}`,
		`- 格式来源：${formatSource ?? "reading-note-template"}`,
		`- 模板：${template?.id ?? "(无)"}@${template?.version ?? ""}${template?.name ? ` ${template.name}` : ""}`,
		`- 受众/语言：${requirements?.audience ?? ""} / ${requirements?.language ?? ""}`,
		`- 篇幅：${requirements?.length || "(未指定)"}`,
		""
	];
	if (Array.isArray(requirements?.sections) && requirements.sections.length > 0) {
		lines.push("## 章节骨架（必须按此顺序，标题逐字一致；标 [可选] 的节不适用时写「不适用」）", "");
		requirements.sections.forEach((section, index) => {
			lines.push(`### ${index + 1}. ${section.title}${section.required === false ? " [可选]" : ""}`);
			// 每节正文要点（含子节与表格要求）随骨架下发，保证结构与原文一致。
			if (section.hint) lines.push("", section.hint);
		});
		lines.push("");
	}
	const list = (label, values) => {
		if (!Array.isArray(values) || values.length === 0) return;
		lines.push(`## ${label}`, "");
		for (const value of values) lines.push(`- ${value}`);
		lines.push("");
	};
	list("风格规则", requirements?.styleRules);
	list("证据与来源要求", requirements?.evidenceRequirements);
	list("附加输出要求", requirements?.outputRequirements);
	lines.push("## 现有资源（逐个读取；PDF/Office 先经 lab_convert_document 转 Markdown）", "");
	if (resources.length === 0) lines.push("- （无登记资源）");
	for (const resource of resources) {
		lines.push(`- ${resource.kind}：${resource.available ? resource.path : `未就绪（${resource.registered ? "已登记但文件缺失" : "未登记"}）`}`);
	}
	lines.push("");
	lines.push("## 强制顺序", "");
	lines.push("1. 逐个读取上面 available 的正文与 SI，再写精读报告；不得只看元数据或公众号导读。");
	lines.push("2. 报告章节严格采用本契约的章节骨架，不得改用 Nature paper-card 的 01–16 结构。");
	lines.push("3. 每个数字/结论注明来源定位（页码/图表/公式），无法核对的写「无法判断」。");
	if (mustReadPaths.length > 0) {
		lines.push("");
		lines.push("> mustReadPaths：" + mustReadPaths.map((p) => `\`${p}\``).join("、"));
	}
	return lines.join("\n");
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

/** 内置默认文献综述模板（多篇检索结果 → 一篇综述）。 */
export function createDefaultReviewTemplate(now = new Date().toISOString()) {
	return noteTemplateSchema.parse({
		id: "review-default",
		version: "1",
		kind: "review",
		name: "课题组文献综述模板（默认）",
		topics: ["聚前药", "高分子材料设计", "药物递送"],
		tags: ["review", "default"],
		audience: "课题组组会与开题材料",
		language: "zh",
		length: "3000-6000 字，按主题归类而不是逐篇摘要",
		sections: [
			{ key: "scope", title: "综述范围与检索策略", required: true, hint: "检索式、数据源、时间窗、纳入与排除标准" },
			{ key: "background", title: "研究背景与问题", required: true, hint: "领域现状、未解决的关键问题" },
			{ key: "taxonomy", title: "技术路线归类", required: true, hint: "按设计策略/材料体系/机制把文献分组，给出各组代表工作" },
			{ key: "progress", title: "关键进展", required: true, hint: "分组论述代表性结果与数据，标注来源文献" },
			{ key: "comparison", title: "横向对比", required: true, hint: "跨组对比指标（载药量/释放行为/靶向性/疗效），指出可比与不可比之处" },
			{ key: "challenges", title: "挑战与争议", required: true, hint: "证据冲突、方法学局限、重复性存疑处" },
			{ key: "outlook", title: "趋势与展望", required: true, hint: "可验证的下一步方向，区分已有证据与推测" },
			{ key: "project-link", title: "与本课题的关系", required: true, hint: "对本课题选题/设计/实验的直接启发" },
			{ key: "references", title: "参考文献", required: true, hint: "只列本次检索结果中实际引用的条目，含 DOI" }
		],
		styleRules: [
			"用中文正文，保留规范英文术语并用括号标注中文释义",
			"按主题组织，禁止逐篇罗列摘要式段落",
			"每个论断标注来源文献（作者 年份 或 DOI）"
		],
		evidenceRequirements: [
			"只使用本次检索条目的题名/摘要/已登记全文，不补写未检索到的内容",
			"摘要不足以下结论时写明「摘要信息不足」",
			"对比表格中的数字必须来自所选文献的可见内容"
		],
		outputRequirements: [
			"输出为 Markdown，模板章节作为二级标题",
			"参考文献与正文引用一一对应"
		],
		remark: "默认文献综述模板：对某个检索条目的多篇结果写综述时若未指定模板，使用本模板。",
		status: "active",
		createdAt: now,
		updatedAt: now
	});
}

/** 内置模板（服务种子用）：单篇阅读笔记 + 多篇文献综述。 */
export const BUILTIN_NOTES = [createDefaultNoteTemplate(), createDefaultReviewTemplate()];

/**
 * 转换为模型可直接注入阅读笔记生成流程的结构化要求。
 * 生成时按模板：章节为骨架，风格/证据/输出要求约束行文。
 */
export function toNoteRequirements(template) {
	const minContentChars = noteLengthFloor(template.length);
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
		// 篇幅下限用于审计；模板未写字数时不填。
		...(minContentChars !== undefined ? { minContentChars } : {}),
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
