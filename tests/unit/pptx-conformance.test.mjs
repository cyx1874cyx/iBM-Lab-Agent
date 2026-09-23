/**
 * Unit: PPTX ↔ 模板符合性比对（src/pptx-conformance.js）。
 *
 * 用 tests/fixtures/pptx-builder.mjs 生成同一主题 / 不同主题与页面尺寸的
 * 最小 PPTX，验证页面比例、主题字体与主色不一致会被判为 error。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePptxToTemplate, checkPptxAgainstTemplate } from "../../src/pptx-conformance.js";
import { defaultLayouts, buildPptx } from "../fixtures/pptx-builder.mjs";

const base = {
	name: "课题组模板",
	accent: "#1F4E79",
	font: "Microsoft YaHei",
	size: { cx: 12192000, cy: 6858000, type: "wide" },
	layouts: defaultLayouts()
};

test("a deck built with the template theme passes conformance", async () => {
	const template = await buildPptx(base);
	const deck = await buildPptx({ ...base, name: "成品", slides: 3 });
	const result = await checkPptxAgainstTemplate(deck.buffer, template.buffer);
	assert.equal(result.ok, true);
	assert.equal(result.findings.filter((row) => row.level === "error").length, 0);
	assert.equal(result.findings[0].code, "template_theme");
});

test("a different theme colour is reported as an error", async () => {
	const template = await buildPptx(base);
	const deck = await buildPptx({ ...base, name: "成品", accent: "#C00000", slides: 1 });
	const result = await checkPptxAgainstTemplate(deck.buffer, template.buffer);
	assert.equal(result.ok, false);
	const finding = result.findings.find((row) => row.code === "theme_color_mismatch");
	assert.equal(finding.level, "error");
	assert.match(finding.message, /accent1/);
});

test("a different theme font is reported as an error", async () => {
	const template = await buildPptx(base);
	const deck = await buildPptx({ ...base, name: "成品", font: "Arial", slides: 1 });
	const result = await checkPptxAgainstTemplate(deck.buffer, template.buffer);
	assert.equal(result.ok, false);
	assert.ok(result.findings.some((row) => row.code === "theme_font_mismatch"));
});

test("a different page size is reported as an error", async () => {
	const template = await buildPptx(base);
	const deck = await buildPptx({ ...base, name: "成品", size: { cx: 9144000, cy: 6858000, type: "4x3" }, slides: 1 });
	const result = await checkPptxAgainstTemplate(deck.buffer, template.buffer);
	assert.equal(result.ok, false);
	assert.ok(result.findings.some((row) => row.code === "page_size_mismatch"));
});

test("missing parse structures degrade to a warning instead of crashing", () => {
	const result = comparePptxToTemplate(undefined, undefined);
	assert.equal(result.ok, false);
	assert.equal(result.findings[0].code, "template_not_checked");
	assert.equal(result.findings[0].level, "warning");
});
