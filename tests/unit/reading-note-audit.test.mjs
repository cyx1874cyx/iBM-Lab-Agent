import { test } from "node:test";
import assert from "node:assert/strict";
import { auditReadingNoteText } from "../../src/reading-note-audit.js";

const evidence = "证据见 PDF p. 3、Fig. 2 和图 4；无法判断未报告的长期结局。";

test("template-aware reading-note audit accepts required headings and grounded evidence", () => {
	const markdown = [
		"# 精读笔记",
		"## 文献信息", "Nature 2024, DOI: 10.0000/example",
		"## 背景与空缺", "研究背景与关键缺口。",
		"## 方法与实验设计", "实验方法。",
		"## 关键结果与证据链", evidence,
		"## 结论与边界", "结论存在适用边界。",
		"## 作者明确局限", "作者报告了局限。",
		"## 与本课题的联系", "可用于课题设计。",
		"补充正文".repeat(200)
	].join("\n\n");
	const result = auditReadingNoteText(markdown, {
		locatorMode: "page-grounded",
		hasBundle: true,
		noteRequirements: { sections: [
			{ title: "文献信息", required: true },
			{ title: "背景与空缺", required: true },
			{ title: "方法与实验设计", required: true },
			{ title: "关键结果与证据链", required: true },
			{ title: "结论与边界", required: true },
			{ title: "作者明确局限", required: true },
			{ title: "与本课题的联系", required: true }
		] }
	});
	assert.equal(result.summary.errors, 0);
	assert.equal(result.audit_mode, "note-template");
	assert.ok(result.metrics.source_pointer_count >= 3);
});

test("reading-note audit rejects missing required headings or source grounding", () => {
	const result = auditReadingNoteText("# 简略笔记\n\n## 结果\n没有来源。", {
		locatorMode: "page-grounded",
		hasBundle: false,
		noteRequirements: { sections: [{ title: "文献信息", required: true }, { title: "关键结果", required: true }] }
	});
	assert.ok(result.summary.errors >= 3);
	assert.equal(result.summary.status, "fail");
});

test("legacy scientific note uses semantic section groups instead of forcing 01-16", () => {
	const markdown = [
		"# 结构化阅读笔记",
		"## 一、文献基本信息", "Nature 2024",
		"## 二、研究背景与科学问题", "背景。",
		"## 三、实验方法", "方法。",
		"## 四、主要结果", evidence,
		"## 五、研究局限性", "局限。",
		"## 六、对本课题的启示", "课题联系。",
		"正文".repeat(500)
	].join("\n\n");
	const result = auditReadingNoteText(markdown, { locatorMode: "page-grounded", hasBundle: true });
	assert.equal(result.summary.errors, 0);
	assert.equal(result.audit_mode, "scientific-note");
});
