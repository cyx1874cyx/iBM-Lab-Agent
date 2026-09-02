/**
 * 文献条目目录布局（0.1.15）。
 *
 * 为每个 bundle 生成稳定的文献条目标识 entryStem = "<短引用> <10字以内短介绍>"，
 * 所有产物（正文 PDF、SI PDF、精读报告 md/docx、文献汇报 PPTX、审计文件）固化到
 * 同一条目目录：
 *
 *   <课题工作区>/literature/<entryStem>/
 *     <entryStem> 正文.pdf
 *     <entryStem> SI.pdf
 *     <entryStem> 精读报告.md
 *     <entryStem> 精读报告.docx
 *     <entryStem> 文献汇报.pptx
 *
 * entryStem 在 bundle 占位创建时固化（bundle.entryStem/entryDir），同一 bundle 的
 * 分批存档（先正文后 SI）必须复用同一目录，不产生第二个文件夹。
 */

import { join } from "node:path";

export const ENTRY_DIR_NAME = "literature";
export const ENTRY_STEM_MAX = 80;
export const SHORT_INTRO_MAX = 10;
export const WINDOWS_INVALID_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g;
export const TRAILING_DOT_OR_SPACE_RE = /[. ]+$/;

/** 清理 Windows 非法字符、控制字符；压缩空白；去掉尾部空格与句点；限制总长。 */
export function sanitizeEntryStem(text) {
	const cleaned = String(text ?? "")
		.replace(WINDOWS_INVALID_CHARS_RE, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(TRAILING_DOT_OR_SPACE_RE, "");
	return cleaned.slice(0, ENTRY_STEM_MAX);
}

/**
 * 短介绍：去除标点与 Windows 非法字符后截取不超过 10 个 Unicode 字符。
 * 中文标点直接删除（否则目录名中会留下空格碎屑）；英文标点与数字替换为空格，
 * 保留词间分隔，避免 "Prodrug-polymer" 被连成 "Prodrugpolymer"。
 */
export function shortIntroOf(title) {
	const cleaned = String(title ?? "")
		.replace(/[，。；：、！？…·—～（）【】《》〈〉「」『』“”‘’]/g, "")
		.replace(/[,.!?;:()\[\]{}"'`~@#$%^&*_+=/\\|<>*\d]/g, " ")
		.replace(WINDOWS_INVALID_CHARS_RE, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(TRAILING_DOT_OR_SPACE_RE, "");
	return Array.from(cleaned).slice(0, SHORT_INTRO_MAX).join("");
}

/** 短引用：report.shortCitation → 第一作者 et al. 年份 → DOI → bundle id。 */
export function shortCitationOf(bundle, report) {
	if (report?.shortCitation) return report.shortCitation;
	const author = bundle?.authors?.[0];
	if (author && bundle?.year) return `${author} et al. ${bundle.year}`;
	if (author) return `${author} et al.`;
	if (bundle?.doi) return bundle.doi;
	return bundle?.id ?? "literature";
}

/** 构造稳定条目标识 "<短引用> <短介绍>"；缺短介绍时只保留短引用。 */
export function buildEntryStem(bundle, report) {
	const citation = sanitizeEntryStem(shortCitationOf(bundle, report));
	const intro = shortIntroOf(report?.titleZh ?? bundle?.title);
	const stem = intro ? `${citation} ${intro}` : citation;
	return sanitizeEntryStem(stem) || sanitizeEntryStem(bundle?.id ?? "literature");
}

/** 由课题工作区与 bundle/report 推导条目目录；bundle 已固化 entryStem/entryDir 时直接复用。 */
export function literatureEntryLayout(workspacePath, bundle, report) {
	const entryStem = bundle?.entryStem ?? buildEntryStem(bundle, report);
	return {
		entryStem,
		entryDir: bundle?.entryDir ?? join(workspacePath, ENTRY_DIR_NAME, entryStem)
	};
}

/** 条目目录内的产物文件名（kind: pdf|si|report-md|report-docx|ppt）。 */
export function entryFileName(entryStem, kind) {
	const label = {
		pdf: "正文",
		si: "SI",
		"report-md": "精读报告",
		"report-docx": "精读报告",
		ppt: "文献汇报"
	}[kind] ?? kind;
	const ext = {
		pdf: "pdf",
		si: "pdf",
		"report-md": "md",
		"report-docx": "docx",
		ppt: "pptx"
	}[kind] ?? "bin";
	return `${entryStem} ${label}.${ext}`;
}
