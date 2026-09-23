/**
 * dsh-lab-agent: PPTX 成品 ↔ PPT 模板的符合性比对（纯逻辑层）。
 *
 * 背景：模板导入时 `src/pptx-parse.js` 已经读出模板的页面比例、主题色与字体；
 * 但生成端过去从不校验成品是否真的用了模板。此模块用同一套解析结果比对成品
 * 与模板的页面比例、主题字体与主色，作为「模板符合性」的机器信号。
 *
 * 语义：不一致记 error（成品很可能根本没按模板生成）；一致或无数据可比记 pass /
 * warning。结果只作提醒，不阻断人工审核（与 labTasks 的 QA 语义一致）。
 */

import { parsePptx } from "./pptx-parse.js";

const THEME_COLOR_SLOTS = ["dk1", "lt1", "accent1"];

function sameColor(left, right) {
	return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

/**
 * 比对两个已解析的 PPTX 结构。
 * @param {object|undefined} deck parsePptx 的成品结果
 * @param {object|undefined} template parsePptx 的模板结果
 * @returns {{ ok: boolean, findings: Array<{level: string, code: string, message: string}> }}
 */
export function comparePptxToTemplate(deck, template) {
	if (!deck || !template) {
		return {
			ok: false,
			findings: [{
				level: "warning",
				code: "template_not_checked",
				message: "缺少成品或模板的解析结构，无法比对主题与页面比例。"
			}]
		};
	}
	const findings = [];
	const mismatch = (code, message) => findings.push({ level: "error", code, message });

	// 页面比例（优先用 EMU 尺寸，缺尺寸时退回比例字符串）。
	const deckCx = deck.page?.cx;
	const deckCy = deck.page?.cy;
	const tplCx = template.page?.cx;
	const tplCy = template.page?.cy;
	if (Number.isFinite(deckCx) && Number.isFinite(deckCy) && Number.isFinite(tplCx) && Number.isFinite(tplCy)) {
		if (deckCx !== tplCx || deckCy !== tplCy) {
			mismatch("page_size_mismatch", `页面尺寸不一致：成品 ${deckCx}×${deckCy} EMU，模板 ${tplCx}×${tplCy} EMU。`);
		}
	} else if (deck.page?.ratio && template.page?.ratio && deck.page.ratio !== template.page.ratio) {
		mismatch("page_ratio_mismatch", `页面比例不一致：成品 ${deck.page.ratio}，模板 ${template.page.ratio}。`);
	}

	// 主题字体（模板声明了才比对）。
	const deckFonts = deck.theme?.fonts ?? {};
	const tplFonts = template.theme?.fonts ?? {};
	for (const key of ["major", "minor"]) {
		if (tplFonts[key] && deckFonts[key] && tplFonts[key] !== deckFonts[key]) {
			mismatch("theme_font_mismatch", `主题字体 ${key} 不一致：成品 ${deckFonts[key]}，模板 ${tplFonts[key]}。`);
		}
	}

	// 主题主色（模板声明了才比对）。
	const deckColors = deck.theme?.colors ?? {};
	const tplColors = template.theme?.colors ?? {};
	for (const slot of THEME_COLOR_SLOTS) {
		if (tplColors[slot] && deckColors[slot] && !sameColor(tplColors[slot], deckColors[slot])) {
			mismatch("theme_color_mismatch", `主题色 ${slot} 不一致：成品 ${deckColors[slot]}，模板 ${tplColors[slot]}。`);
		}
	}

	if (findings.length === 0) {
		findings.push({
			level: "pass",
			code: "template_theme",
			message: `成品页面比例与主题（字体/主色）与模板一致${template.theme?.name ? `：${template.theme.name}` : ""}。`
		});
	}
	return { ok: findings.every((row) => row.level !== "error"), findings };
}

/**
 * 读取两个 .pptx 字节并比对（供 labTasks 在暂存/自查阶段调用）。
 * 任一侧不是有效 PPTX 时抛出，由调用方决定如何记录。
 */
export async function checkPptxAgainstTemplate(deckBuffer, templateBuffer) {
	const [deck, template] = await Promise.all([parsePptx(deckBuffer), parsePptx(templateBuffer)]);
	return comparePptxToTemplate(deck, template);
}
