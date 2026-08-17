import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePptx, PptxParseError, emuRatio } from "../../src/pptx-parse.js";
import { buildPptx, buildThreeTemplates } from "../fixtures/pptx-builder.mjs";

test("emuRatio reduces EMU sizes to simplest ratio", () => {
	assert.equal(emuRatio(12192000, 6858000), "16:9");
	assert.equal(emuRatio(9144000, 6858000), "4:3");
});

test("parsePptx extracts page size, theme, masters, layouts and placeholders", async () => {
	const { buffer } = await buildPptx({
		name: "lab-test",
		size: { cx: 12192000, cy: 6858000, type: "wide" },
		accent: "#1F4E79",
		font: "SimSun"
	});
	const parsed = await parsePptx(buffer);
	assert.equal(parsed.page.ratio, "16:9");
	assert.equal(parsed.page.type, "wide");
	assert.equal(parsed.theme.name, "lab-test");
	assert.equal(parsed.theme.colors.accent1, "#1F4E79");
	assert.equal(parsed.theme.fonts.major, "SimSun");
	assert.equal(parsed.theme.fonts.minor, "SimSun");
	assert.equal(parsed.layoutCount, 5);
	assert.deepEqual(parsed.masters.map((m) => m.id), ["slideMaster1"]);
	assert.equal(parsed.masters[0].layouts.length, 5);
	const title = parsed.layouts.find((l) => l.id === "slideLayout1");
	assert.equal(title.name, "Title Slide");
	assert.deepEqual(title.placeholders.map((p) => p.type), ["title", "subtitle"]);
	const blank = parsed.layouts.find((l) => l.name === "Blank");
	assert.deepEqual(blank.placeholders, []);
	const comparison = parsed.layouts.find((l) => l.name === "Comparison");
	assert.equal(comparison.placeholders.filter((p) => p.type === "body").length, 3);
});

test("parsePptx rejects non-pptx content", async () => {
	await assert.rejects(() => parsePptx(Buffer.from("this is not a zip")), PptxParseError);
});

test("three template presets differ in ratio/theme/layouts", async () => {
	const [a, b, c] = await buildThreeTemplates();
	const pa = await parsePptx(a.buffer);
	const pb = await parsePptx(b.buffer);
	const pc = await parsePptx(c.buffer);
	assert.equal(pa.page.ratio, "16:9");
	assert.equal(pb.page.ratio, "4:3");
	assert.equal(pc.page.ratio, "16:9");
	assert.equal(pa.theme.colors.accent1, "#1F4E79");
	assert.equal(pb.theme.colors.accent1, "#548235");
	assert.equal(pc.theme.colors.accent1, "#C00000");
	assert.equal(pa.layoutCount, 5);
	assert.equal(pb.layoutCount, 3);
	assert.equal(pc.layoutCount, 4);
});
