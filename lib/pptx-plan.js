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
 * 容量：需要几行由**宽度**决定（CJK 字按 1 个"字宽单位"、其余按 0.5 计），能放几行由
 * `computeTextCapacity()` 用**模板自己的行距/段间距/内边距 + 版面下边界**算 —— 不再信
 * pptx-cli 那个只按高度、行距硬编码 1.22 的 `max_lines`（本模板正文是固定 30pt 行距，
 * 按 1.22 估会把容量高估约 25%，0.5.4 试用里为此磨了 10 轮重建渲染）。
 * 两者都只用于预警（warning），不阻断构建、也不改任何文字。
 *
 * 版式选择：图片按**真实像素比例**在候选版式里选显示尺寸最大/留白最少的那个，
 * 比例不匹配时给 `figure-layout-mismatch`（见 scoreImageFit 的注释）。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DEFAULT_INSETS_EMU, computeTextCapacity } from "../src/ppt-slot-spec.js";

export const COMPILED_PLAN_KIND = "compiled-plan";
export const COMPILED_PLAN_SCHEMA_VERSION = 1;
const EMU_PER_INCH = 914400;
/** 非 CJK 字符按半个字宽计（粗略但够用的预警模型）。 */
const LATIN_WIDTH_UNITS = 0.5;
/** 图片等比缩放后的显示宽度低于这个值（英寸），就认为"字会小到看不清"。 */
export const MIN_READABLE_FIGURE_WIDTH_IN = 4;
/** 图片留白面积占占位符面积的比例超过这个值，就认为版式比例与图片比例不匹配。 */
export const MAX_FIGURE_WHITESPACE_RATIO = 0.4;
/** 自动换版式的门槛：候选的显示面积要比当前大这个倍数才算"明显更好"（保守，避免抖动）。 */
export const FIGURE_LAYOUT_SWITCH_GAIN = 1.15;

const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 文本的"字宽单位"总量（CJK 1.0，其余 0.5）。 */
export function textWidthUnits(text) {
	let units = 0;
	for (const char of String(text ?? "")) units += CJK_RE.test(char) ? 1 : LATIN_WIDTH_UNITS;
	return units;
}

/**
 * 估算一段文字在槽位里的行数（**需要几行**由宽度决定）。
 * 内边距与容量用同一套值，避免"宽度按一套、高度按另一套"两套模型打架。
 * @param {string[]} paragraphs
 * @param {{ widthEmu?: number, fontPt?: number, insets?: object }} slot
 */
export function estimateLines(paragraphs, slot) {
	const widthEmu = slot?.widthEmu;
	const fontPt = Number.isFinite(slot?.effectiveFontPt) ? slot.effectiveFontPt : slot?.fontPt;
	if (!Number.isFinite(widthEmu) || !Number.isFinite(fontPt) || fontPt <= 0) return undefined;
	const lIns = Number.isFinite(slot?.insets?.lIns) ? slot.insets.lIns : DEFAULT_INSETS_EMU.lIns;
	const rIns = Number.isFinite(slot?.insets?.rIns) ? slot.insets.rIns : DEFAULT_INSETS_EMU.rIns;
	const usablePt = Math.max(((widthEmu - lIns - rIns) / EMU_PER_INCH) * 72, 1);
	const unitsPerLine = Math.max(usablePt / fontPt, 1);
	let lines = 0;
	for (const paragraph of paragraphs ?? []) {
		lines += Math.max(1, Math.ceil(textWidthUnits(paragraph) / unitsPerLine));
	}
	return lines;
}

/**
 * 从图片文件头读取像素尺寸（PNG / JPEG / GIF / BMP）—— 不引入依赖、不调用 python。
 * 只解析文件头，识别不了返回 undefined（调用方按"无法评分"处理，不阻断编译）。
 * @param {Buffer} buffer
 * @returns {{width: number, height: number, format: string}|undefined}
 */
export function readImageSize(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 26) return undefined;
	if (buffer[0] === 0x89 && buffer.toString("latin1", 1, 4) === "PNG") {
		return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
	}
	if (buffer.toString("latin1", 0, 3) === "GIF") {
		return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), format: "gif" };
	}
	if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
		return { width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)), format: "bmp" };
	}
	if (buffer[0] === 0xff && buffer[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 <= buffer.length) {
			if (buffer[offset] !== 0xff) {
				offset += 1;
				continue;
			}
			const marker = buffer[offset + 1];
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				offset += 2;
				continue;
			}
			const length = buffer.readUInt16BE(offset + 2);
			const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (isStartOfFrame) {
				return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), format: "jpeg" };
			}
			if (length <= 0) break;
			offset += 2 + length;
		}
	}
	return undefined;
}

/** 按路径读图片尺寸；读不到（文件缺失/非图片/格式不支持）返回 undefined。 */
export function readImageSizeFromFile(path) {
	try {
		return readImageSize(readFileSync(path));
	} catch {
		return undefined;
	}
}

/**
 * 图片按等比缩放放进占位符后的显示尺寸与留白。
 *
 * 构建器与 PowerPoint 的行为都是 contain（`scale = min(W/w, H/h)`，居中留白），
 * 所以"竖长图塞进宽幅槽"会让图缩得很小、留白很大 —— 这正是 Fig3（12.85×4.78 in 的
 * 宽幅图片槽）放 Nature 单栏竖长图（宽高比约 0.87）时字小到看不清的原因。
 *
 * @param {{width: number, height: number}} imageSize 像素尺寸（比例即可，无需物理尺寸）
 * @param {{widthEmu?: number, heightEmu?: number}} slot 图片占位符
 * @returns {{displayWidthIn: number, displayHeightIn: number, scale: number, whitespaceRatio: number,
 *            targetWidthIn: number, targetHeightIn: number, imageAspect: number, targetAspect: number}|undefined}
 */
export function scoreImageFit(imageSize, slot) {
	if (!imageSize || !Number.isFinite(imageSize.width) || !Number.isFinite(imageSize.height)) return undefined;
	if (imageSize.width <= 0 || imageSize.height <= 0) return undefined;
	if (!Number.isFinite(slot?.widthEmu) || !Number.isFinite(slot?.heightEmu)) return undefined;
	const targetWidthIn = slot.widthEmu / EMU_PER_INCH;
	const targetHeightIn = slot.heightEmu / EMU_PER_INCH;
	if (targetWidthIn <= 0 || targetHeightIn <= 0) return undefined;
	const scale = Math.min(targetWidthIn / imageSize.width, targetHeightIn / imageSize.height);
	const displayWidthIn = imageSize.width * scale;
	const displayHeightIn = imageSize.height * scale;
	const whitespaceRatio = Math.max(0, 1 - (displayWidthIn * displayHeightIn) / (targetWidthIn * targetHeightIn));
	return {
		displayWidthIn: round2(displayWidthIn),
		displayHeightIn: round2(displayHeightIn),
		scale,
		whitespaceRatio: round3(whitespaceRatio),
		targetWidthIn: round2(targetWidthIn),
		targetHeightIn: round2(targetHeightIn),
		imageAspect: round3(imageSize.width / imageSize.height),
		targetAspect: round3(targetWidthIn / targetHeightIn)
	};
}

function round2(value) {
	return Math.round(value * 100) / 100;
}

function round3(value) {
	return Math.round(value * 1000) / 1000;
}

/**
 * 在候选版式里为一张图片挑最合适的那个：显示面积最大（= 留白最少）优先，
 * 面积相同时取显示宽度更大者。没有可评分的候选时返回 undefined。
 * @param {object} imageSize
 * @param {Array<{layout: object, slot: object}>} candidates
 */
export function chooseImageLayout(imageSize, candidates) {
	let best;
	for (const candidate of candidates ?? []) {
		const fit = scoreImageFit(imageSize, candidate.slot);
		if (fit === undefined) continue;
		const score = { candidate, fit, area: fit.displayWidthIn * fit.displayHeightIn };
		if (best === undefined || score.area > best.area || (score.area === best.area && fit.displayWidthIn > best.fit.displayWidthIn)) {
			best = score;
		}
	}
	return best;
}
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

	// —— 编译期图片版式选择 ——
	// 本模板族的图片角色是**逐图独立**的（figure-1 / figure-2 / figure-3 / figure-4，各自对应一个
	// 版式），所以"有多个图片版式候选"指的是**同一个角色家族**里的候选。构建器只按 role 解析版式，
	// 逐页换版式因此等价于逐页换角色 —— 而角色本来就是逐页给的，所以这一步是安全的。
	const roleFamily = (role) => String(role ?? "").replace(/-\d+$/, "");
	const imageSlotKeys = new Set((slotSpec.layouts ?? [])
		.flatMap((layout) => (layout.slots ?? []).filter((slot) => slot.kind === "image").map((slot) => slot.key)));
	/** 同家族、且带图片槽位的候选版式。 */
	const imageLayoutCandidates = (role) => (slotSpec.layouts ?? [])
		.filter((layout) => layout.role && roleFamily(layout.role) === roleFamily(role))
		.map((layout) => ({ layout, slot: (layout.slots ?? []).find((slot) => slot.kind === "image") }))
		.filter((candidate) => candidate.slot !== undefined);
	/** 计划里这一页要放的图（slide.image 优先，其次是图片类槽位取值）。 */
	const imageValueOfSlide = (slide) => {
		if (typeof slide.image === "string" && slide.image.trim()) return slide.image.trim();
		const values = slide.slots !== null && typeof slide.slots === "object" ? slide.slots : {};
		for (const [key, value] of Object.entries(values)) {
			if (imageSlotKeys.has(key) && typeof value === "string" && value.trim()) return value.trim();
		}
		return undefined;
	};
	/** 该页声明的槽位 key 是否都能在新版式里找到（换版式不能悄悄丢掉图注等已给内容）。 */
	const layoutAcceptsKeys = (layout, keys) => {
		const available = new Set((layout.slots ?? []).map((slot) => slot.key));
		return keys.every((key) => available.has(key));
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
		let role = slide.role.trim();
		const requestedRole = role;
		let layout = resolveLayout(role);
		if (layout === undefined) {
			const mapped = planRoles[role];
			add("error", "layout-unknown",
				typeof mapped === "string" && mapped
					? `slides[${index}] 的角色 '${role}' 映射到未知版式 '${mapped}'（既不是 layout id 也不是版式名）`
					: `slides[${index}] 的角色 '${role}' 在 slots.json 里找不到对应版式`,
				{ ...where, role, layoutId: typeof mapped === "string" ? mapped : undefined });
			continue;
		}
		// 图片比例定版式：同家族有多个候选时选显示面积最大（= 留白最少）的那个。
		// 只在"明显更好"且不破坏已声明内容时才自动换版式，否则只出诊断（保守、可回退）。
		let layoutSwitch;
		const earlyImage = imageValueOfSlide(slide);
		if (earlyImage !== undefined) {
			const candidates = imageLayoutCandidates(role);
			if (candidates.length >= 2) {
				const imageSize = readImageSizeFromFile(resolveImagePath(earlyImage, baseDir));
				const currentSlot = candidates.find((candidate) => candidate.layout.layoutId === layout.layoutId)?.slot;
				const current = scoreImageFit(imageSize, currentSlot);
				const best = chooseImageLayout(imageSize, candidates);
				if (best !== undefined && current !== undefined && best.candidate.layout.layoutId !== layout.layoutId) {
					const currentArea = current.displayWidthIn * current.displayHeightIn;
					const bestArea = best.fit.displayWidthIn * best.fit.displayHeightIn;
					const pinnedByPlan = typeof planRoles[role] === "string" && planRoles[role].trim() !== "";
					const requiredByPlan = requiredPages.includes(role);
					const declaredKeys = Object.keys(slide.slots !== null && typeof slide.slots === "object" ? slide.slots : {});
					if (bestArea >= currentArea * FIGURE_LAYOUT_SWITCH_GAIN && !pinnedByPlan && !requiredByPlan
						&& layoutAcceptsKeys(best.candidate.layout, declaredKeys)) {
						layoutSwitch = {
							requestedRole: role,
							fromLayoutId: layout.layoutId,
							fromDisplayAreaIn2: round2(currentArea),
							toLayoutId: best.candidate.layout.layoutId,
							toDisplayAreaIn2: round2(bestArea),
							candidates: candidates.map((candidate) => ({
								layoutId: candidate.layout.layoutId,
								layoutName: candidate.layout.layoutName,
								displayWidthIn: scoreImageFit(imageSize, candidate.slot)?.displayWidthIn,
								whitespaceRatio: scoreImageFit(imageSize, candidate.slot)?.whitespaceRatio
							}))
						};
						role = best.candidate.layout.role;
						layout = best.candidate.layout;
					}
				}
			}
		}
		const layoutId = layout.layoutId;
		// 版面高度随槽位带下去：容量复算要把它夹到版面下边界（占位符可以画到版面外）。
		const pageHeightEmu = slotSpec.pageSize?.heightEmu;
		const withPageHeight = (slot) => ({ ...slot, pageHeightEmu });
		const slotByKey = new Map((layout.slots ?? []).map((slot) => [slot.key, withPageHeight(slot)]));
		const slotByPrompt = new Map((layout.slots ?? []).map((slot) => [String(slot.prompt ?? "").trim(), withPageHeight(slot)]).filter(([prompt]) => prompt !== ""));
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

		// 图片真实比例 vs 版式图片槽比例：让 Agent 一眼看到"这一页该换版式"。
		if (resolvedImage !== undefined) {
			const imageSlot = (layout.slots ?? []).find((slot) => slot.kind === "image");
			const imageSize = imageSlot === undefined ? undefined : readImageSizeFromFile(resolvedImage);
			if (imageSlot !== undefined && imageSize === undefined) {
				add("info", "figure-size-unreadable", `slides[${index}] 的图片无法读取像素尺寸（非 PNG/JPEG/GIF/BMP 或文件损坏），跳过版式比例检查：${resolvedImage}`, { ...where, role, layoutId, image: resolvedImage });
			}
			const fit = scoreImageFit(imageSize, imageSlot);
			const candidates = imageLayoutCandidates(role).map((candidate) => {
				const candidateFit = scoreImageFit(imageSize, candidate.slot);
				return {
					layoutId: candidate.layout.layoutId,
					layoutName: candidate.layout.layoutName,
					role: candidate.layout.role,
					displayWidthIn: candidateFit?.displayWidthIn,
					displayHeightIn: candidateFit?.displayHeightIn,
					whitespaceRatio: candidateFit?.whitespaceRatio
				};
			});
			const best = chooseImageLayout(imageSize, imageLayoutCandidates(role));
			const recommendedLayoutId = best?.candidate.layout.layoutId;
			const recommendedRole = best?.candidate.layout.role;
			const otherLayoutIsBetter = recommendedLayoutId !== undefined && recommendedLayoutId !== layoutId;
			const tooSmall = fit !== undefined && fit.displayWidthIn < MIN_READABLE_FIGURE_WIDTH_IN;
			const tooMuchWhitespace = fit !== undefined && fit.whitespaceRatio > MAX_FIGURE_WHITESPACE_RATIO;
			if (layoutSwitch !== undefined) {
				add("info", "figure-layout-selected",
					`slides[${index}] 按图片比例把版式从 ${layoutSwitch.fromLayoutId} 换成 ${layoutSwitch.toLayoutId}（角色 ${layoutSwitch.requestedRole} → ${role}）：显示面积 ${layoutSwitch.fromDisplayAreaIn2} → ${layoutSwitch.toDisplayAreaIn2} in²`,
					{ ...where, role, requestedRole, layoutId, layoutSwitch, candidates });
			} else if (fit !== undefined && (otherLayoutIsBetter || tooSmall || tooMuchWhitespace)) {
				const reasons = [];
				if (otherLayoutIsBetter) reasons.push(`换成版式 ${best.candidate.layout.layoutName ?? recommendedLayoutId}（角色 ${recommendedRole}）显示更大`);
				if (tooSmall) reasons.push(`显示宽度仅 ${fit.displayWidthIn} in（< ${MIN_READABLE_FIGURE_WIDTH_IN} in，图里的字会小到看不清）`);
				if (tooMuchWhitespace) reasons.push(`留白占 ${Math.round(fit.whitespaceRatio * 100)}%（> ${Math.round(MAX_FIGURE_WHITESPACE_RATIO * 100)}%）`);
				const advice = otherLayoutIsBetter
					? (recommendedRole === requestedRole
						? `建议解除 plan.roles 对 ${requestedRole} 的钉住（推荐版式 ${recommendedLayoutId}，角色不变）；`
						: `建议把该页 role 改成 ${recommendedRole}；`)
					: "";
				add("warning", "figure-layout-mismatch",
					`slides[${index}]（角色 ${role}、版式 ${layout.layoutName ?? layoutId}）图片宽高比 ${fit.imageAspect}，占位符宽高比 ${fit.targetAspect}：等比缩放后显示 ${fit.displayWidthIn}×${fit.displayHeightIn} in。${reasons.join("；")}。${advice}若该页 role 已被 plan.roles 显式钉住，需先解除才换得动`,
					{
						...where,
						role,
						requestedRole,
						layoutId,
						image: resolvedImage,
						imageAspect: fit.imageAspect,
						targetAspect: fit.targetAspect,
						displayWidthIn: fit.displayWidthIn,
						displayHeightIn: fit.displayHeightIn,
						whitespaceRatio: fit.whitespaceRatio,
						recommendedRole,
						recommendedLayoutId,
						candidates
					});
			} else if (fit !== undefined) {
				add("info", "figure-layout-selected",
					`slides[${index}]（角色 ${role}、版式 ${layout.layoutName ?? layoutId}）图片等比缩放后显示 ${fit.displayWidthIn}×${fit.displayHeightIn} in，留白 ${Math.round(fit.whitespaceRatio * 100)}%`,
					{ ...where, role, layoutId, image: resolvedImage, displayWidthIn: fit.displayWidthIn, displayHeightIn: fit.displayHeightIn, whitespaceRatio: fit.whitespaceRatio, candidates });
			}
		}

		const notes = typeof slide.notes === "string" ? slide.notes : "";
		if (notesRequired && notes.trim() === "") add("error", "notes-missing", `slides[${index}]（${layoutId} 角色 ${role}）缺少讲稿备注（plan.notesRequired=true）`, { ...where, role, layoutId });

		outSlides.push({
			index: index + 1,
			role,
			// 按图片比例换过版式时，记下作者原本写的角色，便于回溯与复核。
			...(requestedRole !== role ? { requestedRole } : {}),
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

	// 容量模型来源：slots.json 若没带模板排版（行距/段间距），容量只能按默认 1.2 倍字号估，
	// 对写了固定行距的模板会系统性高估（本模板正文是 30pt，20pt 字号下高估约 25–36%）。
	// 这条 info 是给"容量为什么可能偏乐观"留的可见线索，不阻断构建。
	const defaultTypedSlots = (slotSpec.layouts ?? [])
		.flatMap((layout) => layout.slots ?? [])
		.filter((slot) => slot.capacitySource === "computed-default-typography");
	if (defaultTypedSlots.length > 0) {
		add("info", "capacity-default-typography",
			`slots.json 有 ${defaultTypedSlots.length} 个槽位的容量按**默认排版模型**估算（没读到模板行距/段间距）：模板若写了固定行距（本模板正文 30pt），容量会被高估 25–36%。生成 slots.json 时给 deriveSlotSpec 传 typography 即可（见 docs/PPT_TEMPLATE_PIPELINE_P14.md §7.5）`,
			{ capacityModel: slotSpec.capacityModel ?? {}, sampleSlotKeys: defaultTypedSlots.slice(0, 5).map((slot) => slot.key) });
	}

	// roles 用**版式名**而不是 manifest 的 slug id：构建器（parse.json 侧）认的是
	// slideLayoutN / 版式名，两套 id 空间不同。版式名是两个世界共有的稳定键；
	// manifest id 仍保留在 manifestLayoutIds 里供诊断与排查。
	// 角色 → 版式：first-wins（与 resolveLayout 的语义一致）→ 图片评分选中的候选 → plan.roles 显式覆盖。
	// 不能直接对 `roleLayouts` 用 Object.fromEntries：同名角色是 **last-wins**，会让 figure 这类
	// 「一个角色对应多个版式」的角色落到最后一个版式上，与解析用的 first-wins 语义自相矛盾。
	const chosenByRole = new Map();
	for (const layout of slotSpec.layouts ?? []) {
		if (layout.role && !chosenByRole.has(layout.role)) chosenByRole.set(layout.role, layout);
	}
	for (const [role, mapped] of Object.entries(planRoles)) {
		if (typeof mapped !== "string" || !mapped.trim()) continue;
		const layout = layoutsById.get(mapped.trim()) ?? layoutsByName.get(mapped.trim());
		if (layout !== undefined) chosenByRole.set(role, layout);
	}
	const compiled = {
		kind: COMPILED_PLAN_KIND,
		schemaVersion: COMPILED_PLAN_SCHEMA_VERSION,
		compiledAt: new Date().toISOString(),
		template: slotSpec.template ?? {},
		roles: Object.fromEntries([...chosenByRole].map(([role, layout]) => [role, layout.layoutName ?? layout.layoutId])),
		manifestLayoutIds: Object.fromEntries([...chosenByRole].map(([role, layout]) => [role, layout.layoutId])),
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
		// 容量用**同一个** computeTextCapacity 复算：模板真实行距 + 段间距 + 版面下边界，
		// 并按本次实际段落数扣段间距（slots.json 里的 capacityLines 是按 1 段估的）。
		const capacity = computeTextCapacity({
			geometry: { leftEmu: slot.leftEmu, topEmu: slot.topEmu, widthEmu: slot.widthEmu, heightEmu: slot.heightEmu },
			slideHeightEmu: slot.pageHeightEmu,
			fontPt: Number.isFinite(slot.effectiveFontPt) ? slot.effectiveFontPt : slot.fontPt,
			insets: slot.insets,
			lineSpacing: slot.lineSpacing ?? (Number.isFinite(slot.lineHeightPt) ? { kind: "pts", value: slot.lineHeightPt } : undefined),
			spaceBefore: Number.isFinite(slot.spaceBeforePt) ? { kind: "pts", value: slot.spaceBeforePt } : undefined,
			spaceAfter: Number.isFinite(slot.spaceAfterPt) ? { kind: "pts", value: slot.spaceAfterPt } : undefined,
			paragraphs
		});
		const capacityLines = Number.isFinite(capacity.capacityLines) ? capacity.capacityLines : slot.capacityLines;
		if (estimated !== undefined && Number.isFinite(capacityLines) && estimated > capacityLines) {
			add("warning", "capacity-exceeded",
				`槽位 ${slot.key}（版式 ${where.layoutId ?? "?"}）内容约 ${estimated} 行，超过容量 ${capacityLines} 行（行距 ${capacity.lineHeightPt}pt、段间距 ${capacity.spacingTotalPt}pt${capacity.clampedToSlide ? "、已按版面下边界夹高" : ""}）：可能溢出`,
				{
					...where,
					slotKey: slot.key,
					estimatedLines: estimated,
					capacityLines,
					lineHeightPt: capacity.lineHeightPt,
					spacingTotalPt: capacity.spacingTotalPt,
					clampedToSlide: capacity.clampedToSlide,
					cliCapacityLines: slot.cliCapacityLines
				});
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
