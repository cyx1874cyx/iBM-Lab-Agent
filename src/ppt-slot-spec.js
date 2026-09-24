/**
 * dsh-lab-agent: 模板槽位规范（slots.json）—— 从 pptx-cli manifest 派生的声明式规范。
 *
 * 为什么是「声明式数据」而不是「每个模板一份代码」：
 *   * 模板是可下载的内容，代码化的模板 = 把代码执行面暴露给模板作者；
 *   * 规范是数据时，Agent 可以**读**它来决定填什么、可以**改**它（例如把某个图注
 *     标为可选），改动由 schema + lint 门控；代码则由仓库维护者维护。
 *   落地记录见 docs/PPT_TEMPLATE_SPEC.md。
 *
 * 设计要点：
 *   1. **提示文字（guidance_text）优先**做槽位身份，idx 只作兜底 —— PowerPoint 会在
 *      增删占位符时重排 `p:ph/@idx`（实测同一模板三次修订：正文 11→15，总结页
 *      12→14→15/16），而提示文字是作者写的语义。pptx-cli 的 manifest 恰好把它抽成
 *      `guidance_text`，所以这一步是纯派生，不需要我们解 XML。
 *   2. 槽位→占位符的绑定分三轮：① 提示文字匹配；② 结构兜底（按类型/容量在**阅读顺序**里
 *      分配，并标记 promptMismatch → lint 报「提示文字被改名」）；③ 仍无匹配 → 缺失。
 *      这样"改名"不会被误报成"删了一个又多了一个"，也不会静默错配。
 *   3. 期望角色表（FAMILY_EXPECTATIONS）是本模板族的**约定数据**：例如图 1/2/4 有图注、
 *      图 3 不要图注（用户明确要求）。改约定就改这张表或改生成的 slots.json，不用改代码。
 */

import { isTextPlaceholder } from "../lib/pptx-manifest.js";

export const SLOT_SPEC_VERSION = 1;
export const TEMPLATE_FAMILY_LITERATURE = "literature-reading-v1";

const EMU_PER_INCH = 914400;
const PT_PER_INCH = 72;

/**
 * 文字容量模型的基准常量（权威实现见 `computeTextCapacity()`）。
 *
 * 为什么必须自己算，而不信 pptx-cli 的 `estimated_text_capacity.max_lines`：
 *   * 它只按**高度**算，行距**硬编码** `字号 × 1.22`，从不读模板的 `a:lnSpc`；
 *   * 它不读 `a:spcBef` / `a:spcAft`（段前段后）；
 *   * 它不把可用高度夹到**版面下边界**（占位符可以画到幻灯片外面）。
 * 实测本模板：正文占位符写的是**固定 30pt 行距**
 * （`<a:lnSpc><a:spcPts val="3000"/></a:lnSpc>`）+ 段前 10pt / 段后 14pt。
 * pptx-cli 按 20pt 字号算出 24.4pt/行 → 465.8pt 可用高度报 **19 行**（fig1/body_15），
 * 而按模板真实行距只有 **15 行**。0.5.4 真实试用里"改文案 → 重建 → 渲染"磨 10 轮，
 * 就是被这个高估驱动的。
 */

/** PowerPoint 对 `a:bodyPr` 的默认内边距（EMU）：左右 0.1 in、上下 0.05 in。 */
export const DEFAULT_INSETS_EMU = { lIns: 91440, rIns: 91440, tIns: 45720, bIns: 45720 };
/** 模板没写行距时的兜底倍数（保守取 1.2 倍字号）。 */
export const DEFAULT_LINE_SPACING_MULTIPLIER = 1.2;
/** 拿不到版面尺寸时的兜底高度（EMU）：16:9 的 7.5 in。 */
export const DEFAULT_SLIDE_HEIGHT_EMU = 6858000;
/** pptx-cli 的 max_lines 比自算容量大到这个倍数以上，即认定元数据系统性高估。 */
export const CAPACITY_OPTIMISTIC_RATIO = 1.25;

/**
 * 把 `{kind:"pct"|"pts", value}` 的间距解析成 pt。
 * pct 的 100000 表示 1.0 倍（乘字号）；pts 的 value 已经是 pt。
 */
export function spacingToPt(spacing, fontPt) {
	if (spacing === null || typeof spacing !== "object") return undefined;
	if (!Number.isFinite(spacing.value)) return undefined;
	if (spacing.kind === "pts") return spacing.value;
	if (spacing.kind === "pct") return Number.isFinite(fontPt) ? (fontPt * spacing.value) / 100000 : undefined;
	return undefined;
}

/**
 * 有效行高（pt）：模板显式写了 `a:lnSpc` 就用它，否则退化为 `字号 × 1.2`。
 * @returns {{lineHeightPt: number|undefined, source: "template-lnSpc"|"default-multiplier"|"unresolved"}}
 */
export function resolveLineHeightPt({ fontPt, lineSpacing } = {}) {
	const explicit = spacingToPt(lineSpacing, fontPt);
	if (explicit !== undefined && explicit > 0) return { lineHeightPt: explicit, source: "template-lnSpc" };
	if (Number.isFinite(fontPt) && fontPt > 0) return { lineHeightPt: fontPt * DEFAULT_LINE_SPACING_MULTIPLIER, source: "default-multiplier" };
	return { lineHeightPt: undefined, source: "unresolved" };
}

/**
 * 权威容量计算：一个占位符按给定字号与模板排版属性，最多能放几行。
 *
 * @param {object} input
 * @param {{leftEmu?: number, topEmu?: number, widthEmu?: number, heightEmu?: number}} input.geometry
 * @param {number} [input.slideHeightEmu] 版面高度；可用高度会夹到 `top + height` 与它的小者
 * @param {number} [input.fontPt] 槽位最终字号（构建器会强制 ≥ minFontPt，调用方应传已经抬高过的值）
 * @param {{lIns?: number, rIns?: number, tIns?: number, bIns?: number}} [input.insets]
 * @param {{kind: "pct"|"pts", value: number}} [input.lineSpacing] 模板 `a:lnSpc`
 * @param {{kind: "pct"|"pts", value: number}} [input.spaceBefore] 模板 `a:spcBef`
 * @param {{kind: "pct"|"pts", value: number}} [input.spaceAfter] 模板 `a:spcAft`
 * @param {string[]} [input.paragraphs] 实际要写的段落（用于扣掉段间距）；省略按 1 段计
 * @returns {object} 容量与全部中间量（写进 slots.json，便于 lint/编译器复算与解释）
 */
export function computeTextCapacity({
	geometry,
	slideHeightEmu,
	fontPt,
	insets,
	lineSpacing,
	spaceBefore,
	spaceAfter,
	paragraphs
} = {}) {
	const resolvedInsets = { ...DEFAULT_INSETS_EMU };
	for (const key of ["lIns", "rIns", "tIns", "bIns"]) {
		const value = insets?.[key];
		if (Number.isFinite(value) && value >= 0) resolvedInsets[key] = value;
	}
	const topEmu = Number.isFinite(geometry?.topEmu) ? geometry.topEmu : 0;
	const heightEmu = Number.isFinite(geometry?.heightEmu) ? geometry.heightEmu : 0;
	const widthEmu = Number.isFinite(geometry?.widthEmu) ? geometry.widthEmu : 0;
	const slideH = Number.isFinite(slideHeightEmu) && slideHeightEmu > 0 ? slideHeightEmu : DEFAULT_SLIDE_HEIGHT_EMU;
	// 占位符可以画到版面外面：可用底边取"占位符底边"与"版面底边"的小者。
	const bottomEmu = topEmu + heightEmu;
	const effectiveBottomEmu = Math.min(slideH, bottomEmu);
	const clampedToSlide = bottomEmu > slideH;
	const usableHeightEmu = Math.max(effectiveBottomEmu - topEmu - resolvedInsets.tIns - resolvedInsets.bIns, 0);
	const usableWidthEmu = Math.max(widthEmu - resolvedInsets.lIns - resolvedInsets.rIns, 0);
	const usableHeightPt = (usableHeightEmu / EMU_PER_INCH) * PT_PER_INCH;
	const { lineHeightPt, source: lineHeightSource } = resolveLineHeightPt({ fontPt, lineSpacing });
	const spaceBeforePt = spacingToPt(spaceBefore, fontPt) ?? 0;
	const spaceAfterPt = spacingToPt(spaceAfter, fontPt) ?? 0;
	const paragraphCount = Array.isArray(paragraphs) && paragraphs.length > 0 ? paragraphs.length : 1;
	const spacingTotalPt = paragraphCount * (spaceBeforePt + spaceAfterPt);
	const rawLines = usableHeightPt <= 0 || lineHeightPt === undefined
		? 0
		: Math.floor((usableHeightPt - spacingTotalPt) / lineHeightPt);
	return {
		capacityLines: Math.max(rawLines, 0),
		usableHeightEmu,
		usableHeightPt: round(usableHeightPt, 2),
		usableWidthEmu,
		lineHeightPt: lineHeightPt === undefined ? undefined : round(lineHeightPt, 2),
		lineHeightSource,
		spaceBeforePt: round(spaceBeforePt, 2),
		spaceAfterPt: round(spaceAfterPt, 2),
		paragraphCount,
		spacingTotalPt: round(spacingTotalPt, 2),
		effectiveBottomEmu,
		clampedToSlide,
		insets: resolvedInsets
	};
}

function round(value, digits) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/**
 * 把 `scanPresentationXml()` 的结果整理成"按 manifest 版式 id 索引"的排版表。
 *
 * 版式匹配优先用**名字**（pptx-cli 的版式名与 slideLayout 的 `p:cSld/@name` 同源），
 * 退化为按 `source_layout_index` 对齐。占位符自己的排版属性缺失时回退到母版
 * `bodyStyle/lvl1`（与 PowerPoint 的继承顺序一致）。
 *
 * @param {object} scan `scanPresentationXml()` 的返回值
 * @param {Array} layouts manifest 摘要里的版式数组（`summarizeManifest().layouts`）
 * @returns {{[layoutId: string]: {placeholders: {[idx: number]: object}, masterBody?: object}}}
 */
export function typographyFromScan(scan, layouts) {
	const out = {};
	if (!scan || scan.ok !== true) return out;
	const byName = new Map((scan.layouts ?? []).filter((layout) => typeof layout.name === "string").map((layout) => [layout.name, layout]));
	const byIndex = new Map((scan.layouts ?? []).map((layout) => [layout.index, layout]));
	const masterBody = (scan.masters ?? [])
		.map((master) => master.styles?.body?.[1])
		.find((level) => level !== undefined);
	for (const layout of layouts ?? []) {
		if (layout?.id === undefined) continue;
		const scanned = (typeof layout.name === "string" ? byName.get(layout.name) : undefined) ?? byIndex.get(layout.sourceLayoutIndex);
		if (scanned === undefined) continue;
		const placeholders = {};
		for (const placeholder of scanned.placeholders ?? []) {
			if (!Number.isInteger(placeholder.idx)) continue;
			placeholders[placeholder.idx] = {
				insets: placeholder.insets,
				lineSpacing: placeholder.paragraph?.lineSpacing ?? masterBody?.lineSpacing,
				spaceBefore: placeholder.paragraph?.spaceBefore ?? masterBody?.spaceBefore,
				spaceAfter: placeholder.paragraph?.spaceAfter ?? masterBody?.spaceAfter
			};
		}
		out[layout.id] = { placeholders, masterBody };
	}
	return out;
}

/**
 * 版式角色识别：按占位符提示文字匹配（不看 layout id —— 它由 pptx-cli 从版式名
 * slug 而来，而版式名在 PowerPoint 里随时可改；也不看 idx —— 会被重排）。
 */
export const LAYOUT_ROLE_RULES = [
	{ role: "cover", match: [/论文中文标题/, /English\s+Paper\s+Title/i] },
	{ role: "abstract", match: [/摘要截图/, /摘要的中文翻译/] },
	{ role: "figure", match: [/Fig\s*\.?\s*(\d+)\s*图占位/i, /Fig\s*\.?\s*(\d+)\s*图注/i] },
	{ role: "summary", match: [/创新方法有/, /创新点/, /第一段[:：]概括文章主要工作/] },
	{ role: "thanks", match: [/批评指正/] }
];

/** 每个槽位的默认填充政策（mode/sizePt/align）与给 Agent 看的说明。 */
export const SLOT_LIBRARY = {
	titleZh: {
		label: "论文中文标题", kind: "text", mode: "paragraph", align: "center",
		usage: "论文标题的中文翻译，单行，不要换行、不加句末标点。"
	},
	titleEn: {
		label: "英文标题", kind: "text", mode: "paragraph", align: "center",
		usage: "论文英文标题原文，单行，保持原始大小写。"
	},
	speaker: {
		label: "汇报人", kind: "text", mode: "paragraph", align: "left",
		usage: "汇报人姓名；模板里已有默认值时可留空不改。"
	},
	date: {
		label: "汇报日期", kind: "text", mode: "paragraph", align: "right",
		usage: "汇报日期，形如「日期：2026/09/24」。"
	},
	abstractShot: {
		label: "摘要截图", kind: "image",
		usage: "论文摘要页的截图（PNG/JPG），按占位符区域等比缩放。"
	},
	abstractZh: {
		label: "摘要中文翻译", kind: "text", mode: "paragraph", align: "justify",
		usage: "摘要的中文翻译，**一个自然段**（3–6 句），覆盖背景/目的/方法/结果/结论，填满右侧剩余版面。"
	},
	figure: {
		label: "论文插图", kind: "image",
		usage: "该页对应的论文插图截图，与图注编号一致。"
	},
	caption: {
		label: "图注", kind: "text", mode: "paragraph", align: "center",
		usage: "图注原文，形如「Fig.1 xxx」；与论文里的编号、文字保持一致。"
	},
	analysis: {
		label: "图文解读", kind: "text", mode: "paragraph", align: "justify",
		usage: "该图展示的内容 + 论文中相关文字，**一到两个自然段、不分点**，填满除图外剩余版面。"
	},
	innovation: {
		label: "创新点", kind: "text", mode: "bullets", align: "left",
		usage: "本文创新点，按（1）（2）（3）**分点**写，与论文描述一致。"
	},
	paragraph1: {
		label: "总结第一段", kind: "text", mode: "paragraph", align: "justify",
		usage: "第一段：2–3 句总述研究了什么问题、用了什么方法、取得了什么结果。"
	},
	paragraph2: {
		label: "总结补充段", kind: "text", mode: "paragraph", align: "justify",
		usage: "可选结尾段：结果的意义、对本课题的启发；不需要就留空。"
	},
	thanks: {
		label: "结束页", kind: "text", mode: "paragraph", align: "center",
		usage: "致谢/结束语，模板默认「敬请各位批评指正」即可。"
	}
};

/**
 * 本模板族的期望角色表（数据，不是代码）。
 * `require` / `optional` 是槽位 key；`captions` 声明哪些图号需要图注。
 */
export const FAMILY_EXPECTATIONS = {
	[TEMPLATE_FAMILY_LITERATURE]: {
		cover: { require: ["titleZh", "titleEn", "date"], optional: ["speaker"] },
		abstract: { require: ["abstractShot", "abstractZh"], optional: [] },
		figure: {
			require: ["figure", "analysis"],
			// 用户约定：图 1/2/4 有图注，图 3（整页宽图）不要图注。其余图号按"要有图注"处理。
			captions: { requireFor: [1, 2, 4], optionalFor: [3] },
			optional: []
		},
		summary: { require: ["innovation", "paragraph1"], optional: ["paragraph2"] },
		thanks: { require: [], optional: ["thanks"] }
	}
};

/** 槽位 → 结构选择器：先按提示文字，再按类型 + 容量（用于改名/结构兜底）。 */
const SLOT_SELECTORS = {
	titleZh: { kind: "text", prompt: [/论文中文标题/] },
	titleEn: { kind: "text", prompt: [/English\s+Paper\s+Title/i] },
	speaker: { kind: "text", prompt: [/演讲人/] },
	date: { kind: "text", prompt: [/日期/] },
	abstractShot: { kind: "image", prompt: [/摘要截图/] },
	abstractZh: { kind: "text", prompt: [/摘要的中文翻译/] },
	figure: { kind: "image", prompt: [/图占位/] },
	caption: { kind: "text", prompt: [/图注/], pick: "caption" },
	analysis: { kind: "text", prompt: [/此处概括论文/], pick: "analysis" },
	innovation: { kind: "text", prompt: [/创新方法有/] },
	paragraph1: { kind: "text", prompt: [/第一段[:：]概括文章主要工作/] },
	paragraph2: { kind: "text", prompt: [/结尾补充段落/] },
	thanks: { kind: "text", prompt: [/批评指正/] }
};

/** 占位符是否属于某个 kind。 */
export function placeholderKind(placeholder) {
	return isTextPlaceholder(placeholder) ? "text" : "image";
}

/** 阅读顺序：上→下，左→右，同位置用 idx 兜底。 */
export function readingOrder(placeholders) {
	return [...placeholders].sort((a, b) => {
		const at = a.geometry?.topEmu ?? 0;
		const bt = b.geometry?.topEmu ?? 0;
		if (at !== bt) return at - bt;
		const al = a.geometry?.leftEmu ?? 0;
		const bl = b.geometry?.leftEmu ?? 0;
		if (al !== bl) return al - bl;
		return (a.idx ?? 0) - (b.idx ?? 0);
	});
}

/** 提示文字是否命中给定模式集合。 */
function promptHits(placeholder, patterns) {
	const text = String(placeholder?.guidanceText ?? "");
	if (!text) return false;
	return patterns.some((pattern) => pattern.test(text));
}

/**
 * 结构化兜底选择：按类型 + 容量挑最像的占位符。
 * caption = 容量最小的文本框（单行图注）；analysis = 容量最大的文本框（正文块）。
 */
function pickByShape(candidates, pick) {
	if (candidates.length === 0) return undefined;
	if (pick === "caption") {
		return [...candidates].sort((a, b) => (a.capacity?.max_lines ?? 99) - (b.capacity?.max_lines ?? 99))[0];
	}
	if (pick === "analysis") {
		return [...candidates].sort((a, b) => (b.capacity?.max_lines ?? 0) - (a.capacity?.max_lines ?? 0))[0];
	}
	return undefined;
}

/** 识别一个版式的角色。返回 `{role, figureNumber, matched}`；识别不出时 role="unknown"。 */
export function detectLayoutRole(layout) {
	const placeholders = layout?.placeholders ?? [];
	const prompts = placeholders.map((p) => String(p.guidanceText ?? "")).filter(Boolean);
	for (const rule of LAYOUT_ROLE_RULES) {
		for (const pattern of rule.match) {
			for (const prompt of prompts) {
				const match = pattern.exec(prompt);
				if (!match) continue;
				if (rule.role === "figure") {
					const number = Number(match[1]);
					return {
						role: Number.isFinite(number) && number > 0 ? `figure-${number}` : "figure",
						figureNumber: Number.isFinite(number) && number > 0 ? number : undefined,
						matched: prompt
					};
				}
				return { role: rule.role, matched: prompt };
			}
		}
	}
	return { role: "unknown" };
}

/**
 * 该角色期望的槽位定义列表（顺序 = 阅读顺序），来自 FAMILY_EXPECTATIONS。
 * @returns {Array<{key:string, required:boolean}>}
 */
export function expectedSlotsForRole(role, { family = TEMPLATE_FAMILY_LITERATURE } = {}) {
	const table = FAMILY_EXPECTATIONS[family];
	if (!table) return [];
	if (role.startsWith("figure")) {
		const number = Number(role.split("-")[1]);
		const spec = table.figure;
		const slots = spec.require.map((key) => ({ key, required: true }));
		const requireFor = spec.captions?.requireFor ?? [];
		const optionalFor = spec.captions?.optionalFor ?? [];
		// 未在任一清单里的图号按"要有图注"处理（安全默认：新加的图应当有题注）。
		const captioned = !Number.isFinite(number) || requireFor.includes(number) || !optionalFor.includes(number);
		if (captioned) slots.splice(1, 0, { key: "caption", required: true });
		for (const key of spec.optional ?? []) {
			if (!slots.some((slot) => slot.key === key)) slots.push({ key, required: false });
		}
		return slots;
	}
	const spec = table[role];
	if (!spec) return [];
	return [
		...spec.require.map((key) => ({ key, required: true })),
		...spec.optional.map((key) => ({ key, required: false }))
	];
}

/**
 * 把一个版式的期望槽位绑定到实际占位符上。
 * @returns {{slots: object[], promptMismatches: object[], missing: object[], unassigned: object[]}}
 */
export function bindLayoutSlots(layout, role, { family = TEMPLATE_FAMILY_LITERATURE } = {}) {
	const expected = expectedSlotsForRole(role, { family });
	const placeholders = layout?.placeholders ?? [];
	const used = new Set();
	const slots = [];
	const promptMismatches = [];
	const missing = [];

	// 第一轮：提示文字精确匹配
	for (const slot of expected) {
		const selector = SLOT_SELECTORS[slot.key] ?? { kind: "text", prompt: [] };
		const hit = placeholders.find((placeholder) => !used.has(placeholder)
			&& placeholderKind(placeholder) === selector.kind
			&& promptHits(placeholder, selector.prompt));
		if (hit) {
			used.add(hit);
			slots.push({ ...slot, placeholder: hit, boundBy: "prompt" });
		}
	}

	// 第二轮：结构兜底（只在"剩余期望槽"与"剩余同类型占位符"一一对应时才敢配，
	// 否则按缺失处理 —— 宁可报缺失，也不静默错配到别的槽上）
	const unmatchedSlots = expected.filter((slot) => !slots.some((entry) => entry.key === slot.key));
	const remainingOfType = (kind) => readingOrder(placeholders.filter((placeholder) => !used.has(placeholder) && placeholderKind(placeholder) === kind));
	for (const kind of ["image", "text"]) {
		const slotsOfKind = unmatchedSlots.filter((slot) => (SLOT_SELECTORS[slot.key]?.kind ?? "text") === kind);
		const pool = remainingOfType(kind);
		if (slotsOfKind.length === 0 || pool.length === 0) continue;
		if (pool.length !== slotsOfKind.length) continue;
		slotsOfKind.forEach((slot, index) => {
			const placeholder = pool[index];
			used.add(placeholder);
			promptMismatches.push({
				key: slot.key,
				expectedPrompts: SLOT_SELECTORS[slot.key]?.prompt ?? [],
				actualPrompt: placeholder.guidanceText ?? "",
				idx: placeholder.idx
			});
			slots.push({ ...slot, placeholder, boundBy: "structure" });
		});
	}

	// 第三轮：仍未绑定的期望槽 = 缺失
	for (const slot of expected) {
		if (slots.some((entry) => entry.key === slot.key)) continue;
		missing.push({ key: slot.key, required: slot.required });
	}

	// 兜底：pick 选择器（caption/analysis）在文字未命中时按容量挑，属"同义槽"，
	// 只有第一、二轮都失败才用，避免和其它文本槽抢。
	for (const slot of missing) {
		const selector = SLOT_SELECTORS[slot.key];
		if (!selector?.pick) continue;
		const pool = readingOrder(placeholders.filter((placeholder) => !used.has(placeholder) && placeholderKind(placeholder) === selector.kind));
		const placeholder = pickByShape(pool, selector.pick);
		if (!placeholder) continue;
		used.add(placeholder);
		promptMismatches.push({
			key: slot.key,
			expectedPrompts: selector.prompt,
			actualPrompt: placeholder.guidanceText ?? "",
			idx: placeholder.idx
		});
		slots.push({ ...slot, placeholder, boundBy: "shape" });
	}

	const finalMissing = missing.filter((slot) => !slots.some((entry) => entry.key === slot.key));
	return {
		slots: orderSlots(slots, expected),
		promptMismatches,
		missing: finalMissing,
		unassigned: readingOrder(placeholders.filter((placeholder) => !used.has(placeholder)))
	};
}

/** 按期望顺序（阅读顺序）排列已绑定槽位。 */
function orderSlots(slots, expected) {
	const rank = new Map(expected.map((slot, index) => [slot.key, index]));
	return [...slots].sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99));
}

/** 把一个已绑定占位符 + 政策展开成 slots.json 里的槽位条目。 */
function slotEntry(bound, { minFontPt, pageSize, typography }) {
	const library = SLOT_LIBRARY[bound.key] ?? {};
	const placeholder = bound.placeholder;
	const cliFontPt = placeholder.capacity?.font_size_pt;
	// 构建器会把字号抬到 ≥ minFontPt（只升不降）：容量必须按**抬升后**的字号算，
	// 但 `fontPt` 仍保留 manifest 原值 —— 体检报告要看模板真实值，政策抬升是构建期的事。
	const effectiveFontPt = Number.isFinite(cliFontPt) ? Math.max(cliFontPt, minFontPt) : minFontPt;
	const geometry = {
		leftEmu: placeholder.geometry?.leftEmu,
		topEmu: placeholder.geometry?.topEmu,
		widthEmu: placeholder.geometry?.widthEmu,
		heightEmu: placeholder.geometry?.heightEmu
	};
	const capacity = computeTextCapacity({
		geometry,
		slideHeightEmu: pageSize?.heightEmu,
		fontPt: effectiveFontPt,
		insets: typography?.insets,
		lineSpacing: typography?.lineSpacing,
		spaceBefore: typography?.spaceBefore,
		spaceAfter: typography?.spaceAfter
	});
	const cliCapacityLines = placeholder.capacity?.max_lines;
	const capacityOptimistic = Number.isFinite(cliCapacityLines) && capacity.capacityLines > 0
		&& cliCapacityLines >= capacity.capacityLines * CAPACITY_OPTIMISTIC_RATIO;
	// 只有真的读到模板排版属性才算"按模板算"；全为 undefined 时与默认值等价，标签要如实。
	const hasTemplateTypography = typography !== undefined
		&& ["insets", "lineSpacing", "spaceBefore", "spaceAfter"].some((key) => typography[key] !== undefined);
	return {
		key: bound.key,
		label: library.label ?? bound.key,
		kind: library.kind ?? placeholderKind(placeholder),
		prompt: placeholder.guidanceText ?? "",
		idx: placeholder.idx,
		logicalName: placeholder.logicalName,
		required: bound.required,
		boundBy: bound.boundBy,
		...(library.mode ? { mode: library.mode } : {}),
		...(library.align ? { align: library.align } : {}),
		// —— 容量：自算值（权威，按模板真实行距+版面边界）与 pptx-cli 的参考值并列落盘 ——
		capacityLines: capacity.capacityLines,
		capacitySource: hasTemplateTypography ? "computed-template" : "computed-default-typography",
		cliCapacityLines,
		...(capacityOptimistic ? { capacityOptimistic: true } : {}),
		lineSpacing: typography?.lineSpacing,
		lineHeightPt: capacity.lineHeightPt,
		lineHeightSource: capacity.lineHeightSource,
		spaceBeforePt: capacity.spaceBeforePt,
		spaceAfterPt: capacity.spaceAfterPt,
		clampedToSlide: capacity.clampedToSlide,
		// 几何与内边距随槽位一起落盘：编译器只靠 slots.json 就能复算容量，不必再读 manifest。
		leftEmu: geometry.leftEmu,
		topEmu: geometry.topEmu,
		widthEmu: geometry.widthEmu,
		heightEmu: geometry.heightEmu,
		insets: capacity.insets,
		fontPt: cliFontPt,
		effectiveFontPt,
		fontFamily: placeholder.capacity?.font_family,
		belowFontFloor: typeof cliFontPt === "number" && cliFontPt < minFontPt,
		usage: library.usage ?? ""
	};
}

/**
 * 从 manifest 摘要派生槽位规范（slots.json 的内容）。
 * @param {object} summary `summarizeManifest()` 的结果
 * @param {{ family?: string, minFontPt?: number, templateRef?: object, duplicateTextPrompts?: object }} options
 */
export function deriveSlotSpec(summary, {
	family = TEMPLATE_FAMILY_LITERATURE,
	minFontPt = 20,
	templateRef = {},
	duplicateTextPrompts,
	typography
} = {}) {
	const warnings = [];
	const layouts = [];
	const roles = {};
	const unassigned = [];
	const promptMismatches = [];
	const missingSlots = [];
	const pageSize = {
		widthEmu: summary?.pageSize?.widthEmu,
		heightEmu: summary?.pageSize?.heightEmu
	};
	for (const layout of summary?.layouts ?? []) {
		const detected = detectLayoutRole(layout);
		const role = detected.role;
		if (role === "unknown") {
			warnings.push({ code: "layout_role_unknown", message: `版式 ${layout.id}（${layout.name ?? ""}）的占位符提示文字不匹配任何已知角色，Agent 无法自动填充`, location: { layoutId: layout.id } });
			layouts.push({ layoutId: layout.id, layoutName: layout.name, role, slots: [], unassignedPlaceholders: (layout.placeholders ?? []).map(briefPlaceholder) });
			continue;
		}
		const bound = bindLayoutSlots(layout, role, { family });
		if (roles[role] === undefined) {
			roles[role] = layout.id;
		} else {
			warnings.push({ code: "duplicate_role_layout", message: `角色 ${role} 已映射到 ${roles[role]}，版式 ${layout.id} 被忽略（同一角色只取第一个版式）`, location: { layoutId: layout.id } });
		}
		for (const slot of bound.missing) {
			missingSlots.push({ role, layoutId: layout.id, key: slot.key, required: slot.required, expectedPrompts: (SLOT_SELECTORS[slot.key]?.prompt ?? []).map(String) });
		}
		for (const mismatch of bound.promptMismatches) {
			promptMismatches.push({ role, layoutId: layout.id, ...mismatch, expectedPrompts: mismatch.expectedPrompts.map(String) });
		}
		for (const placeholder of bound.unassigned) {
			unassigned.push({ layoutId: layout.id, ...briefPlaceholder(placeholder) });
		}
		const slots = bound.slots.map((entry) => slotEntry(entry, {
			minFontPt,
			pageSize,
			// 排版表按「版式 id + 占位符 idx」取：同一版式里各占位符的行距/段间距可以不同。
			typography: typography?.[layout.id]?.placeholders?.[entry.placeholder.idx]
		}));
		for (const slot of slots) {
			if (slot.capacityOptimistic !== true) continue;
			// 这条是 0.5.4 真实试用里磨了 10 轮重建渲染的根因：pptx-cli 的 max_lines 只按高度、
			// 行距硬编码 1.22，模板写了固定行距（本模板 30pt）时它把容量系统性报大。
			warnings.push({
				code: "capacity-metadata-optimistic",
				message: `版式 ${layout.id} 槽位 ${slot.key}（idx=${slot.idx}）：pptx-cli 报 ${slot.cliCapacityLines} 行，按模板实际排版自算 ${slot.capacityLines} 行（行距 ${slot.lineHeightPt}pt、段前/段后 ${slot.spaceBeforePt}/${slot.spaceAfterPt}pt），高出 ${Math.round((slot.cliCapacityLines / slot.capacityLines - 1) * 100)}%`,
				location: { layoutId: layout.id, slotKey: slot.key, idx: slot.idx },
				hint: "以 capacityLines 为准决定写多少字；或把该占位符的行距/段间距改小"
			});
		}
		layouts.push({
			layoutId: layout.id,
			layoutName: layout.name,
			role,
			figureNumber: detected.figureNumber,
			slots,
			unassignedPlaceholders: bound.unassigned.map(briefPlaceholder)
		});
	}
	if (duplicateTextPrompts && Object.keys(duplicateTextPrompts).length > 0) {
		warnings.push({ code: "duplicate_prompts", message: `有占位符提示文字在模板内重复，定位会退化为 idx：${JSON.stringify(duplicateTextPrompts)}` });
	}
	return {
		schemaVersion: SLOT_SPEC_VERSION,
		family,
		template: templateRef,
		// 版面尺寸随规范落盘：编译器要靠它把容量夹到版面下边界。
		pageSize,
		capacityModel: {
			version: 1,
			source: typography !== undefined ? "template-xml" : "defaults",
			defaultLineSpacingMultiplier: DEFAULT_LINE_SPACING_MULTIPLIER,
			optimisticRatio: CAPACITY_OPTIMISTIC_RATIO,
			note: "capacityLines 为自算值（模板真实行距/段间距 + 版面下边界，按 1 段估）；cliCapacityLines 为 pptx-cli 只按高度、行距固定 1.22 的参考值"
		},
		policy: {
			minFontPt,
			fonts: { latin: "Arial", ea: "微软雅黑", cs: "Arial" },
			bodyMode: "paragraph"
		},
		roles,
		layouts,
		promptMismatches,
		missingSlots,
		unassignedPlaceholders: unassigned,
		warnings
	};
}

/** 未绑定到槽位的占位符简报（只用于「这个版式还有什么没被用到」的报告）。 */
function briefPlaceholder(placeholder) {
	return {
		idx: placeholder.idx,
		logicalName: placeholder.logicalName,
		prompt: placeholder.guidanceText ?? "",
		kind: placeholderKind(placeholder),
		// 这里只能给 pptx-cli 的参考值：自算容量需要几何 + 模板排版属性，只对已绑定的槽位计算。
		cliCapacityLines: placeholder.capacity?.max_lines
	};
}

/** slots.json → 索引（按角色/按版式查）。 */
export function indexSlotSpec(spec) {
	const byLayout = new Map((spec?.layouts ?? []).map((layout) => [layout.layoutId, layout]));
	const byRole = new Map();
	for (const layout of spec?.layouts ?? []) {
		if (!byRole.has(layout.role)) byRole.set(layout.role, layout);
	}
	return { byLayout, byRole };
}

/** 所有槽位的扁平列表（GUIDE 与编译期校验共用）。 */
export function allSlots(spec) {
	return (spec?.layouts ?? []).flatMap((layout) => (layout.slots ?? []).map((slot) => ({ ...slot, layoutId: layout.layoutId, role: layout.role })));
}
