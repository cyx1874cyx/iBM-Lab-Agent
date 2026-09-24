/**
 * dsh-lab-agent: PPT 计划编译器（plan.json → compiled.json）。
 *
 * 分工：Agent 只写**语义**（这一页是什么角色、每个槽位放什么文字/哪张图），编译器负责
 * 把它翻成 scripts/pptx/build_from_template.py 能直接执行的填充指令：
 *   * 角色 → 版式 id（来自 slots.json 的 roles）；
 *   * 槽位 → `texts[]`，每项带 **prompt（提示文字，最稳的定位键）+ idx（兜底）**、
 *     mode（分点/自然段）、align、sizePt；
 *   * 图片 → 图片槽位；图注 → 图注槽位（不再另加浮动文本框）。
 *
 * 编译期就把能查的错查掉（必填槽缺失、槽位名写错、图片路径不存在、容量超限预警），
 * 而不是等到构建完看渲染结果。构建器行为不变：compiled.json 就是一份**带
 * `kind: "compiled-plan"` 标记的 plan**，`--plan` 依旧能吃，另加 `--compiled` 显式入口。
 *
 * 容量估算：CJK 字按 1 个"字宽单位"、其余按 0.5 计，行容量 = 版式宽度(pt) / 字号(pt)。
 * 这是**粗估**，只用于预警（warning），不阻断构建、也不改任何文字。
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const COMPILED_PLAN_KIND = "compiled-plan";
export const COMPILED_PLAN_SCHEMA_VERSION = 1;
const EMU_PER_INCH = 914400;
/** 非 CJK 字符按半个字宽计（粗略但够用的预警模型）。 */
const LATIN_WIDTH_UNITS = 0.5;

const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 文本的"字宽单位"总量（CJK 1.0，其余 0.5）。 */
export function textWidthUnits(text) {
	let units = 0;
	for (const char of String(text ?? "")) units += CJK_RE.test(char) ? 1 : LATIN_WIDTH_UNITS;
	return units;
}

/**
 * 估算一段文字在槽位里的行数。
 * @param {string[]} paragraphs
 * @param {{ widthEmu?: number, fontPt?: number, capacityLines?: number }} slot
 */
export function estimateLines(paragraphs, slot) {
	const widthEmu = slot?.widthEmu;
	const fontPt = slot?.fontPt;
	if (!Number.isFinite(widthEmu) || !Number.isFinite(fontPt) || fontPt <= 0) return undefined;
	const widthPt = (widthEmu / EMU_PER_INCH) * 72;
	// 左右各留 0.1 英寸内边距，避免把"刚好一行"算成放得下。
	const usablePt = Math.max(widthPt - 0.2 * 72, 1);
	const unitsPerLine = Math.max(usablePt / fontPt, 1);
	let lines = 0;
	for (const paragraph of paragraphs ?? []) {
		lines += Math.max(1, Math.ceil(textWidthUnits(paragraph) / unitsPerLine));
	}
	return lines;
}

/** 归一化一个槽位取值：字符串 / 字符串数组 / {paragraphs, mode, align, sizePt}。 */
export function normalizeSlotValue(value) {
	if (typeof value === "string") return { paragraphs: value.split(/\r?\n/).filter((line) => line.trim() !== "") };
	if (Array.isArray(value)) return { paragraphs: value.filter((line) => typeof line === "string" && line.trim() !== "") };
	if (value !== null && typeof value === "object") {
		const paragraphs = Array.isArray(value.paragraphs)
			? value.paragraphs.filter((line) => typeof line === "string" && line.trim() !== "")
			: (typeof value.text === "string" ? [value.text] : []);
		return {
			paragraphs,
			mode: value.mode,
			align: value.align,
			sizePt: typeof value.sizePt === "number" ? value.sizePt : undefined
		};
	}
	return { paragraphs: [] };
}

/**
 * 编译计划。
 *
 * @param {object} options
 * @param {object} options.plan 现有 plan.json 契约（slides[].role/slots/texts/image/notes…）
 * @param {object} options.slotSpec slots.json（deriveSlotSpec 的产物）
 * @param {string} [options.baseDir] 相对路径（图片）的解析基准，缺省 plan 所在目录
 * @param {boolean} [options.requireImages=true] 图片文件不存在是否报 error
 * @returns {{compiled: object, diagnostics: object[], summary: object}}
 */
export function compilePlan({ plan, slotSpec, baseDir, requireImages = true } = {}) {
	const diagnostics = [];
	const add = (severity, code, message, location = {}) => diagnostics.push({ severity, code, message, location });
	if (plan === null || typeof plan !== "object") {
		add("error", "plan-invalid", "plan 不是一个 JSON 对象");
		return { compiled: undefined, diagnostics, summary: summarize(diagnostics) };
	}
	const slides = Array.isArray(plan.slides) ? plan.slides : [];
	if (slides.length === 0) add("error", "plan-empty", "plan.slides 为空：没有任何要生成的页");
	if (!slotSpec || !Array.isArray(slotSpec.layouts)) {
		add("error", "slots-missing", "缺少槽位规范（slots.json）：先跑模板导入/体检生成 slots.json");
		return { compiled: undefined, diagnostics, summary: summarize(diagnostics) };
	}

	const layoutsById = new Map(slotSpec.layouts.map((layout) => [layout.layoutId, layout]));
	// 版式名同样可用：compiled.json 的 roles 用版式名（构建器侧认这个），
	// 手写 plan 时写 manifest id 或版式名都应当能解析。
	const layoutsByName = new Map();
	for (const layout of slotSpec.layouts) {
		if (layout.layoutName && !layoutsByName.has(layout.layoutName)) layoutsByName.set(layout.layoutName, layout);
	}
	const roleToLayout = new Map();
	for (const layout of slotSpec.layouts) {
		if (layout.role && !roleToLayout.has(layout.role)) roleToLayout.set(layout.role, layout);
	}
	const planRoles = plan.roles !== null && typeof plan.roles === "object" ? plan.roles : {};
	/** 解析角色 → 版式；显式 plan.roles 优先（接受 id 或版式名），否则按 slots.json 的 roles。 */
	const resolveLayout = (role) => {
		const mapped = planRoles[role];
		if (typeof mapped === "string" && mapped.trim()) {
			const wanted = mapped.trim();
			return layoutsById.get(wanted) ?? layoutsByName.get(wanted);
		}
		return roleToLayout.get(role);
	};

	const notesRequired = plan.notesRequired === true;
	const requiredPages = Array.isArray(plan.requiredPages) ? plan.requiredPages.filter((role) => typeof role === "string") : [];
	const outSlides = [];

	for (const [index, slide] of slides.entries()) {
		const where = { slide: index + 1 };
		if (slide === null || typeof slide !== "object" || typeof slide.role !== "string" || !slide.role.trim()) {
			add("error", "slide-role-missing", `slides[${index}] 缺少 role`, where);
			continue;
		}
		const role = slide.role.trim();
		const layout = resolveLayout(role);
		if (layout === undefined) {
			const mapped = planRoles[role];
			add("error", "layout-unknown",
				typeof mapped === "string" && mapped
					? `slides[${index}] 的角色 '${role}' 映射到未知版式 '${mapped}'（既不是 layout id 也不是版式名）`
					: `slides[${index}] 的角色 '${role}' 在 slots.json 里找不到对应版式`,
				{ ...where, role, layoutId: typeof mapped === "string" ? mapped : undefined });
			continue;
		}
		const layoutId = layout.layoutId;
		const slotByKey = new Map((layout.slots ?? []).map((slot) => [slot.key, slot]));
		const slotByPrompt = new Map((layout.slots ?? []).map((slot) => [String(slot.prompt ?? "").trim(), slot]).filter(([prompt]) => prompt !== ""));
		const texts = [];
		const values = new Map();
		const slotValues = slide.slots !== null && typeof slide.slots === "object" ? slide.slots : {};
		for (const [key, rawValue] of Object.entries(slotValues)) {
			const slot = slotByKey.get(key);
			if (slot === undefined) {
				add("error", "slot-unknown", `slides[${index}]（${layoutId}）没有槽位 '${key}'；可用槽位：${[...slotByKey.keys()].join(", ")}`, { ...where, role, layoutId, slotKey: key });
				continue;
			}
			values.set(key, rawValue);
		}

		// texts[]：显式填充指令（Agent 也可以直接给 prompt/idx，兼容旧 plan）
		const explicitTexts = Array.isArray(slide.texts) ? slide.texts : [];
		const coveredKeys = new Set();
		for (const [position, entry] of explicitTexts.entries()) {
			if (entry === null || typeof entry !== "object") {
				add("error", "text-entry-invalid", `slides[${index}].texts[${position}] 不是对象`, where);
				continue;
			}
			const entryWhere = { ...where, role, layoutId, textIndex: position };
			let target = undefined;
			const prompt = typeof entry.prompt === "string" ? entry.prompt.trim() : "";
			if (prompt) {
				target = slotByPrompt.get(prompt) ?? (layout.slots ?? []).find((slot) => String(slot.prompt ?? "").startsWith(prompt));
				if (target === undefined) {
					add("warning", "text-prompt-unmatched", `slides[${index}].texts[${position}] 的 prompt「${prompt.slice(0, 24)}」在本版式槽位里找不到；将按 idx 兜底`, entryWhere);
				}
			}
			if (target === undefined && Number.isInteger(entry.idx)) {
				target = (layout.slots ?? []).find((slot) => slot.idx === entry.idx);
				if (target === undefined) add("warning", "text-idx-unmatched", `slides[${index}].texts[${position}] 的 idx=${entry.idx} 不在本版式槽位里`, entryWhere);
			}
			const normalized = normalizeSlotValue({ paragraphs: entry.paragraphs, mode: entry.mode, align: entry.align, sizePt: entry.sizePt });
			const promptText = target?.prompt ?? (prompt || undefined);
			const idx = target?.idx ?? (Number.isInteger(entry.idx) ? entry.idx : undefined);
			if (promptText === undefined && idx === undefined) {
				add("error", "text-unaddressable", `slides[${index}].texts[${position}] 既没有可用 prompt 也没有 idx，无法定位`, entryWhere);
				continue;
			}
			if (target !== undefined) coveredKeys.add(target.key);
			texts.push(buildTextEntry({ prompt: promptText, idx, slot: target, normalized, where: entryWhere, add, order: position }));
		}

		// slots{}：按槽位 key 给内容
		for (const [key, rawValue] of values) {
			const slot = slotByKey.get(key);
			if (slot.kind === "image") continue;
			if (coveredKeys.has(key)) continue;
			const normalized = normalizeSlotValue(rawValue);
			if (normalized.paragraphs.length === 0) continue;
			texts.push(buildTextEntry({ prompt: slot.prompt, idx: slot.idx, slot, normalized, where: { ...where, role, layoutId, slotKey: key }, add, order: 100 + texts.length }));
			coveredKeys.add(key);
		}

		// 图片：slide.image 或图片类槽位取值
		let image = typeof slide.image === "string" && slide.image ? slide.image : undefined;
		for (const [key, rawValue] of values) {
			const slot = slotByKey.get(key);
			if (slot?.kind !== "image") continue;
			if (typeof rawValue === "string" && rawValue) image = rawValue;
		}
		// 图注：优先槽位取值；否则把 imageCaption 路由进图注槽（比浮动文本框更符合模板）
		let captionEntry;
		const captionSlot = (layout.slots ?? []).find((slot) => slot.key === "caption");
		const captionValue = values.get("caption");
		if (captionSlot !== undefined && captionValue !== undefined && !coveredKeys.has("caption")) {
			const normalized = normalizeSlotValue(captionValue);
			if (normalized.paragraphs.length > 0) {
				captionEntry = buildTextEntry({ prompt: captionSlot.prompt, idx: captionSlot.idx, slot: captionSlot, normalized, where: { ...where, role, layoutId, slotKey: "caption" }, add, order: 200 });
				coveredKeys.add("caption");
			}
		} else if (captionSlot !== undefined && typeof slide.imageCaption === "string" && slide.imageCaption.trim() && !coveredKeys.has("caption")) {
			const normalized = normalizeSlotValue(slide.imageCaption);
			captionEntry = buildTextEntry({ prompt: captionSlot.prompt, idx: captionSlot.idx, slot: captionSlot, normalized, where: { ...where, role, layoutId, slotKey: "caption" }, add, order: 200 });
			coveredKeys.add("caption");
		}
		if (captionEntry !== undefined) texts.push(captionEntry);

		// 必填槽检查
		for (const slot of layout.slots ?? []) {
			if (!slot.required) continue;
			if (slot.kind === "image") {
				if (image === undefined) add("error", "required-slot-missing", `slides[${index}]（${layoutId} 角色 ${role}）缺必填图片槽 '${slot.key}'`, { ...where, role, layoutId, slotKey: slot.key });
				continue;
			}
			if (!coveredKeys.has(slot.key)) add("error", "required-slot-missing", `slides[${index}]（${layoutId} 角色 ${role}）缺必填文字槽 '${slot.key}'（提示「${String(slot.prompt ?? "").slice(0, 20)}」）`, { ...where, role, layoutId, slotKey: slot.key });
		}

		// 图片：解析成绝对路径后写进 compiled.json（构建器的工作目录不一定是 plan 目录），
		// 并做存在性检查。
		let resolvedImage;
		if (typeof image === "string" && image) {
			resolvedImage = resolveImagePath(image, baseDir);
			if (!existsSync(resolvedImage)) {
				add(requireImages ? "error" : "warning", "image-missing", `slides[${index}]（${layoutId}）的图片不存在：${resolvedImage}`, { ...where, role, layoutId, image: resolvedImage });
			}
		}

		const notes = typeof slide.notes === "string" ? slide.notes : "";
		if (notesRequired && notes.trim() === "") add("error", "notes-missing", `slides[${index}]（${layoutId} 角色 ${role}）缺少讲稿备注（plan.notesRequired=true）`, { ...where, role, layoutId });

		outSlides.push({
			index: index + 1,
			role,
			layoutId,
			layoutName: layout.layoutName,
			texts,
			...(resolvedImage !== undefined ? { image: resolvedImage } : {}),
			...(typeof slide.imageCaption === "string" && slide.imageCaption && captionEntry === undefined ? { imageCaption: slide.imageCaption } : {}),
			...(notes ? { notes } : {})
		});
	}

	// 必选页
	const presentRoles = new Set(outSlides.map((slide) => slide.role));
	for (const role of requiredPages) {
		if (!presentRoles.has(role)) add("error", "missing-required-page", `必选页 '${role}' 没有出现在 plan.slides 里`, { role });
	}
	const maxPages = Number.isInteger(plan.maxPages) ? plan.maxPages : undefined;
	if (maxPages !== undefined && slides.length > maxPages) add("error", "too-many-pages", `plan 有 ${slides.length} 页，超过 maxPages ${maxPages}`);

	// roles 用**版式名**而不是 manifest 的 slug id：构建器（parse.json 侧）认的是
	// slideLayoutN / 版式名，两套 id 空间不同。版式名是两个世界共有的稳定键；
	// manifest id 仍保留在 manifestLayoutIds 里供诊断与排查。
	const roleLayouts = (slotSpec.layouts ?? []).filter((layout) => layout.role);
	const compiled = {
		kind: COMPILED_PLAN_KIND,
		schemaVersion: COMPILED_PLAN_SCHEMA_VERSION,
		compiledAt: new Date().toISOString(),
		template: slotSpec.template ?? {},
		roles: Object.fromEntries(roleLayouts.map((layout) => [layout.role, layout.layoutName ?? layout.layoutId])),
		manifestLayoutIds: Object.fromEntries(roleLayouts.map((layout) => [layout.role, layout.layoutId])),
		...(requiredPages.length > 0 ? { requiredPages } : {}),
		...(maxPages !== undefined ? { maxPages } : {}),
		...(plan.notesRequired !== undefined ? { notesRequired: plan.notesRequired } : {}),
		...(plan.placeholderRules !== undefined ? { placeholderRules: plan.placeholderRules } : {}),
		...(slotSpec.policy ? { policy: slotSpec.policy } : {}),
		slides: outSlides,
		diagnostics
	};
	return { compiled, diagnostics, summary: summarize(diagnostics) };
}

/** 构造一条填充指令（prompt 优先、idx 兜底；mode/align/sizePt 来自槽位政策或显式覆盖）。 */
function buildTextEntry({ prompt, idx, slot, normalized, where, add, order }) {
	const mode = normalized.mode ?? slot?.mode ?? "paragraph";
	const align = normalized.align ?? slot?.align;
	const sizePt = normalized.sizePt;
	const paragraphs = normalized.paragraphs;
	if (slot !== undefined && paragraphs.length > 0) {
		const estimated = estimateLines(paragraphs, slot);
		if (estimated !== undefined && Number.isFinite(slot.capacityLines) && estimated > slot.capacityLines) {
			add("warning", "capacity-exceeded", `槽位 ${slot.key}（版式 ${where.layoutId ?? "?"}）内容约 ${estimated} 行，超过容量 ${slot.capacityLines} 行：可能溢出`, { ...where, slotKey: slot.key, estimatedLines: estimated, capacityLines: slot.capacityLines });
		}
	}
	return {
		...(prompt ? { prompt } : {}),
		...(Number.isInteger(idx) ? { idx } : {}),
		...(slot?.logicalName ? { logicalName: slot.logicalName } : {}),
		...(slot?.key ? { slotKey: slot.key } : {}),
		mode,
		...(align ? { align } : {}),
		...(sizePt !== undefined ? { sizePt } : {}),
		paragraphs,
		_order: order
	};
}

/** 相对图片路径按 baseDir 解析；绝对路径原样返回。 */
function resolveImagePath(image, baseDir) {
	if (isAbsolute(image)) return image;
	const base = baseDir ?? dirname(image);
	return resolve(base, image);
}

/** 诊断汇总。 */
function summarize(diagnostics) {
	const errors = diagnostics.filter((row) => row.severity === "error").length;
	const warnings = diagnostics.filter((row) => row.severity === "warning").length;
	return { errors, warnings, ok: errors === 0 };
}

/** 清洗掉内部排序字段（写盘前调用）。 */
export function cleanCompiledPlan(compiled) {
	return {
		...compiled,
		slides: (compiled.slides ?? []).map((slide) => ({
			...slide,
			texts: (slide.texts ?? []).map(({ _order, ...entry }) => entry)
		}))
	};
}
