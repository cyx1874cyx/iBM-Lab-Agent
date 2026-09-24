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
function slotEntry(bound, { minFontPt }) {
	const library = SLOT_LIBRARY[bound.key] ?? {};
	const placeholder = bound.placeholder;
	const fontPt = placeholder.capacity?.font_size_pt;
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
		capacityLines: placeholder.capacity?.max_lines,
		// 几何随槽位一起落盘：编译器只靠 slots.json 就能估算容量，不必再读 manifest。
		widthEmu: placeholder.geometry?.widthEmu,
		heightEmu: placeholder.geometry?.heightEmu,
		fontPt,
		fontFamily: placeholder.capacity?.font_family,
		belowFontFloor: typeof fontPt === "number" && fontPt < minFontPt,
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
	duplicateTextPrompts
} = {}) {
	const warnings = [];
	const layouts = [];
	const roles = {};
	const unassigned = [];
	const promptMismatches = [];
	const missingSlots = [];
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
		layouts.push({
			layoutId: layout.id,
			layoutName: layout.name,
			role,
			figureNumber: detected.figureNumber,
			slots: bound.slots.map((entry) => slotEntry(entry, { minFontPt })),
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

function briefPlaceholder(placeholder) {
	return {
		idx: placeholder.idx,
		logicalName: placeholder.logicalName,
		prompt: placeholder.guidanceText ?? "",
		kind: placeholderKind(placeholder),
		capacityLines: placeholder.capacity?.max_lines
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
