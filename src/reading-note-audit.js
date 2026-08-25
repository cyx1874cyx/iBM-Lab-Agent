/** Template-aware audit for normal reading notes (non canonical 01-16 Paper Cards). */
import { readFile, writeFile } from "node:fs/promises";

const HEADING_RE = /^##\s+(.+)$/gm;
const SOURCE_POINTER_RE = /(?:\bPDF\s*)?\bp{1,2}\.\s*\d+|\b(?:Fig(?:ure)?|Table|Eq(?:uation)?)\.?\s*\d+|(?:图|表|公式)\s*\d+/gi;

const clean = (value) => String(value ?? "")
	.toLowerCase()
	.replace(/^[一二三四五六七八九十百\d.、（）()\s-]+/, "")
	.replace(/[\s:：·—_\-/（）()]+/g, "");

const GENERIC_GROUPS = [
	{ code: "identity", label: "文献信息", terms: ["文献信息", "文献基本信息", "基本信息", "citation"] },
	{ code: "background", label: "背景与问题", terms: ["背景", "科学问题", "研究问题", "研究空缺", "background"] },
	{ code: "methods", label: "方法与实验", terms: ["方法", "实验设计", "实验系统", "methods"] },
	{ code: "results", label: "关键结果", terms: ["主要结果", "关键结果", "结果与证据", "results"] },
	{ code: "limitations", label: "局限与边界", terms: ["局限", "结论与边界", "limitations"] },
	{ code: "project_link", label: "与本课题的联系", terms: ["本课题", "课题启示", "对课题的启示", "linktoproject"] }
];

function hasHeading(headings, title) {
	const wanted = clean(title);
	return headings.some((heading) => {
		const value = clean(heading);
		return value.includes(wanted) || wanted.includes(value);
	});
}

function hasAnyHeading(headings, terms) {
	return terms.some((term) => hasHeading(headings, term));
}

function item(level, code, message, details) {
	return details ? { level, code, message, details } : { level, code, message };
}

export function auditReadingNoteText(markdown, { locatorMode = "structure-grounded", noteRequirements, hasBundle = false } = {}) {
	const headings = [...markdown.matchAll(HEADING_RE)].map((match) => match[1].trim());
	const findings = [];
	const required = (noteRequirements?.sections ?? []).filter((section) => section.required !== false);
	if (required.length) {
		const missing = required.filter((section) => !hasHeading(headings, section.title)).map((section) => section.title);
		findings.push(missing.length
			? item("error", "template_sections", `缺少 ${missing.length} 个模板必填章节。`, { missing })
			: item("pass", "template_sections", `模板的 ${required.length} 个必填章节均存在。`));
	} else {
		const missing = GENERIC_GROUPS.filter((group) => !hasAnyHeading(headings, group.terms));
		findings.push(missing.length
			? item("error", "scientific_sections", `缺少 ${missing.map((group) => group.label).join("、")}。`, { missing: missing.map((group) => group.code) })
			: item("pass", "scientific_sections", "文献信息、背景、方法、结果、局限和课题联系均存在。"));
	}

	const pointers = markdown.match(SOURCE_POINTER_RE) ?? [];
	const pointerMinimum = locatorMode === "page-grounded" ? 3 : 1;
	findings.push(pointers.length >= pointerMinimum
		? item("pass", "source_pointers", `发现 ${pointers.length} 个可核对的页码/图表/公式定位。`)
		: item("error", "source_pointers", `证据定位不足：${locatorMode} 模式至少需要 ${pointerMinimum} 个页码/图表/公式定位。`, { found: pointers.length, required: pointerMinimum }));
	if (locatorMode === "page-grounded" && !hasBundle) {
		findings.push(item("error", "bundle_required", "页码定位模式缺少 source bundle，无法核对来源。"));
	} else {
		findings.push(item("pass", "bundle_available", hasBundle ? "source bundle 已提供。" : "当前定位模式不强制 source bundle。"));
	}

	const compactLength = markdown.replace(/\s/g, "").length;
	findings.push(compactLength >= 800
		? item("pass", "substance", `正文信息量 ${compactLength} 字符。`)
		: item("warning", "substance", `正文仅 ${compactLength} 字符，可能不足以支撑精读。`));
	const hasUnknownMarker = /无法判断|证据不足|原文未报告|not reported|insufficient evidence/i.test(markdown);
	findings.push(hasUnknownMarker
		? item("pass", "uncertainty", "报告显式标记了证据不足或无法判断项。")
		: item("warning", "uncertainty", "未发现“无法判断/证据不足”标记，请人工确认是否存在过度推断。"));

	const errors = findings.filter((row) => row.level === "error").length;
	const warnings = findings.filter((row) => row.level === "warning").length;
	const passes = findings.filter((row) => row.level === "pass").length;
	return {
		schema_version: "2.0",
		audit_mode: required.length ? "note-template" : "scientific-note",
		summary: {
			status: errors ? "fail" : (warnings ? "pass_with_warnings" : "pass"),
			passes,
			warnings,
			errors,
			text: errors ? `机器评审未通过：${errors} 个错误，${warnings} 个提醒。` : `机器评审通过：${warnings} 个提醒。`
		},
		metrics: { locator_mode: locatorMode, headings_found: headings, source_pointer_count: pointers.length, content_characters: compactLength },
		findings
	};
}

export async function auditReadingNote({ cardPath, bundlePath, locatorMode, noteRequirements, reportPath }) {
	const markdown = await readFile(cardPath, "utf8");
	const result = auditReadingNoteText(markdown, { locatorMode, noteRequirements, hasBundle: Boolean(bundlePath) });
	if (reportPath) await writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");
	return {
		ok: result.summary.errors === 0,
		errors: result.summary.errors,
		warnings: result.summary.warnings,
		summary: result.summary.text,
		report: reportPath,
		mode: result.audit_mode
	};
}
