/**
 * Unit: NoteTemplate 纯逻辑层（src/note-template.js）。
 *
 * 覆盖：内置默认模板结构、noteTemplateKey / nextNoteTemplateVersion、
 * cloneNoteTemplate、toNoteRequirements 转换（Agent 生成阅读笔记按此骨架）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	BUILTIN_NOTES,
	NOTE_LANGUAGES,
	cloneNoteTemplate,
	createDefaultNoteTemplate,
	nextNoteTemplateVersion,
	noteLengthFloor,
	noteTemplateKey,
	noteTemplateSchema,
	parseNoteTemplateMarkdown,
	renderNoteContract,
	toNoteRequirements
} from "../../src/note-template.js";

test("default note template defines the reading-note skeleton groups", () => {
	const tpl = createDefaultNoteTemplate();
	assert.equal(tpl.id, "note-default");
	assert.equal(tpl.version, "1");
	assert.equal(tpl.language, "zh");
	assert.ok(tpl.sections.some((s) => s.key === "citation" && s.required));
	assert.ok(tpl.sections.some((s) => s.key === "link-to-project" && s.required));
	const optional = tpl.sections.filter((s) => !s.required);
	assert.ok(optional.length > 0, "has at least one optional section");
	assert.ok(tpl.styleRules.length > 0);
	assert.ok(tpl.evidenceRequirements.length > 0);
});

test("toNoteRequirements carries sections, style and evidence contract for the agent", () => {
	const req = toNoteRequirements(createDefaultNoteTemplate());
	assert.equal(req.language, "zh");
	assert.ok(Array.isArray(req.sections) && req.sections.length >= 5);
	const citation = req.sections.find((s) => s.key === "citation");
	assert.equal(citation.title, "文献信息");
	assert.equal(citation.required, true);
	assert.ok(req.styleRules.length > 0);
	assert.ok(req.evidenceRequirements.length > 0);
	assert.match(req.contract, /note template sections in order/);
});

test("cloneNoteTemplate copies to a new id as v1 and keeps sections", () => {
	const copy = cloneNoteTemplate(createDefaultNoteTemplate(), "note-lab-v2", "课题组进阶笔记");
	assert.equal(copy.id, "note-lab-v2");
	assert.equal(copy.version, "1");
	assert.equal(copy.name, "课题组进阶笔记");
	assert.deepEqual(copy.sections, createDefaultNoteTemplate().sections);
});

test("nextNoteTemplateVersion is max+1 and noteTemplateKey composes id@version", () => {
	assert.equal(nextNoteTemplateVersion([]), "1");
	assert.equal(nextNoteTemplateVersion(["1", "3", "2"]), "4");
	assert.equal(noteTemplateKey("note-x", "2"), "note-x@2");
});

test("noteTemplateSchema parses a minimal row with defaults", () => {
	const row = noteTemplateSchema.parse({
		id: "note-min",
		version: "1",
		name: "最小模板",
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z"
	});
	assert.deepEqual(row.topics, []);
	assert.equal(row.language, "zh");
	assert.equal(row.status, "active");
	assert.ok(NOTE_LANGUAGES.includes(row.language));
});

test("BUILTIN_NOTES seeds note-default", () => {
	assert.ok(BUILTIN_NOTES.some((t) => t.id === "note-default"));
});

const MARKDOWN_TEMPLATE = [
	"# 结构化阅读笔记模板",
	"",
	"## 一、文献基本信息",
	"| 项目 | 内容 |",
	"| --- | --- |",
	"| DOI | 【填写】 |",
	"",
	"## 二、主要结果",
	"### 2.1 条件对比",
	"【填写：不同条件下的表现】",
	"",
	"## 三、研究局限性（如有）",
	"- 【填写：局限】",
	"",
	"全文篇幅约 800-1200 字。"
].join("\n");

test("parseNoteTemplateMarkdown turns md headings into the real section skeleton", () => {
	const parsed = parseNoteTemplateMarkdown(MARKDOWN_TEMPLATE, { fileName: "结构化阅读笔记模板.md" });
	assert.equal(parsed.name, "结构化阅读笔记模板");
	assert.deepEqual(parsed.sections.map((s) => s.title), ["文献基本信息", "主要结果", "研究局限性（如有）"]);
	assert.equal(parsed.sections[0].required, true);
	assert.equal(parsed.sections[2].required, false);
	// 子节与表格要求保留在 hint 里，不丢失结构
	assert.match(parsed.sections[1].hint, /### 2\.1 条件对比/);
	assert.match(parsed.sections[0].hint, /\| DOI \| 【填写】 \|/);
	assert.equal(parsed.length, "800-1200 字");
	assert.equal(parsed.minContentChars, 800);
	assert.match(parsed.templateMarkdown, /## 二、主要结果/);
});

test("parseNoteTemplateMarkdown falls back to # sections and section-N keys", () => {
	const parsed = parseNoteTemplateMarkdown("# 模板名\n\n# 第一节\n正文\n\n# 第二节\n正文");
	assert.equal(parsed.name, "模板名");
	assert.deepEqual(parsed.sections.map((s) => s.key), ["section-1", "section-2"]);
});

test("noteLengthFloor reads ranges, lower bounds and approximate wording", () => {
	assert.equal(noteLengthFloor("单篇 600-1000 字"), 600);
	assert.equal(noteLengthFloor("不少于 500 字"), 500);
	assert.equal(noteLengthFloor("800 字左右"), 800);
	assert.equal(noteLengthFloor("内容翔实"), undefined);
});

test("toNoteRequirements carries the template length floor for the audit", () => {
	const base = createDefaultNoteTemplate();
	const tpl = noteTemplateSchema.parse({ ...base, length: "单篇 600-1000 字" });
	const req = toNoteRequirements(tpl);
	assert.equal(req.minContentChars, 600);
	// 原始 md 不进入工具 JSON（避免撑爆 8192 字符裁剪阈值）。
	assert.equal(req.templateMarkdown, undefined);
});

test("renderNoteContract writes the skeleton, per-section guidance and resources", () => {
	const parsed = parseNoteTemplateMarkdown(MARKDOWN_TEMPLATE, { fileName: "t.md" });
	const contract = renderNoteContract({
		template: { id: "note-x", version: "2", name: parsed.name },
		requirements: { ...parsed, sections: parsed.sections },
		resources: [
			{ kind: "main-pdf", available: true, path: "/p/正文.pdf", registered: true },
			{ kind: "si", available: false, path: "/p/SI.pdf", registered: true }
		],
		mustReadPaths: ["/p/正文.pdf"],
		formatSource: "reading-note-template",
		bundleId: "b-1",
		title: "示例论文"
	});
	assert.match(contract, /^# 精读生成契约/);
	assert.match(contract, /模板：note-x@2/);
	assert.match(contract, /### 1\. 文献基本信息/);
	assert.match(contract, /### 1\. 文献基本信息\n\n\| 项目 \| 内容 \|/);
	assert.match(contract, /### 3\. 研究局限性（如有） \[可选\]/);
	assert.match(contract, /- main-pdf：\/p\/正文\.pdf/);
	assert.match(contract, /- si：未就绪（已登记但文件缺失）/);
});
