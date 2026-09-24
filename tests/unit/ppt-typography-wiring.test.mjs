/**
 * 回归守卫：slots.json 的派生必须用**模板真实排版**算容量。
 *
 * 背景（真实发生过）：容量模型做进了 `src/ppt-slot-spec.js`，单测也全绿，但派生 slots.json 的
 * 两个写入方（`lib/ppt-templates.js` 的导入流程、`scripts/lint-ppt-template.mjs` 的
 * `--write-slots`）**没有把 typography 传进去**，于是落盘的 `capacityLines` 仍是默认模型值
 * （行距按 1.2 倍、段间距 0），自算值与 pptx-cli 完全一致（fig1 分析槽 19 vs 19）——
 * 也就是说"修掉容量高估"这件事在生产路径上根本没生效，而所有测试都是绿的。
 *
 * 本文件覆盖两层：
 *   1. 功能层：`templateTypography()` 能从真实 pptx 里解出行距/段前后/内边距，失败时返回
 *      undefined（不假装检查过）；
 *   2. 接线层：两个写入方确实 import 了它并把它交给 `deriveSlotSpec`（源码级断言 ——
 *      这类"测试绿但接线断"的缺陷只有在接线处断言才能守住）。
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import JSZip from "jszip";

import { compilePlan } from "../../lib/pptx-plan.js";
import { summarizeManifest, templateTypography } from "../../lib/pptx-manifest.js";
import { computeTextCapacity, deriveSlotSpec } from "../../src/ppt-slot-spec.js";
import { literatureManifest } from "../fixtures/ppt-manifest-fixture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const base = "http://schemas.openxmlformats.org";
const LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${base}/drawingml/2006/main" xmlns:p="${base}/presentationml/2006/main">
  <p:cSld name="Fig1"><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="10" name="文本占位符 20"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="15"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:bodyPr lIns="18288" tIns="0"/></p:spPr>
      <p:txBody><a:bodyPr/>
        <a:lstStyle><a:lvl1pPr><a:lnSpc><a:spcPts val="3000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:spcAft><a:spcPts val="1400"/></a:spcAft><a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle>
        <a:p><a:r><a:t>正文</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sldLayout>`;

const LAYOUTS = [{ id: "fig1", name: "Fig1", sourceLayoutIndex: 0 }];

test("templateTypography：从模板 pptx 解出行距/段前后/内边距（本模板是固定 30pt 行距）", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-typography-"));
	try {
		const zip = new JSZip();
		zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT_XML);
		const templatePath = join(dir, "source.pptx");
		await writeFile(templatePath, await zip.generateAsync({ type: "nodebuffer" }));

		const typography = await templateTypography({ sourceTemplate: templatePath }, LAYOUTS);
		assert.ok(typography !== undefined, "有模板时必须扫出排版，而不是返回 undefined");
		const placeholder = typography.fig1.placeholders[15];
		assert.deepEqual(placeholder.lineSpacing, { kind: "pts", value: 30 }, "行距必须来自 a:lnSpc，而不是默认 1.2 倍");
		assert.deepEqual(placeholder.spaceBefore, { kind: "pts", value: 10 });
		assert.deepEqual(placeholder.spaceAfter, { kind: "pts", value: 14 });
		assert.equal(placeholder.insets.lIns, 18288);
		assert.equal(placeholder.insets.tIns, 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("templateTypography：模板缺失或不是 zip 时返回 undefined（不假装检查过）", async () => {
	assert.equal(await templateTypography({}, LAYOUTS), undefined);
	assert.equal(await templateTypography({ sourceTemplate: "" }, LAYOUTS), undefined);
	assert.equal(await templateTypography({ sourceTemplate: "/nonexistent/source.pptx" }, LAYOUTS), undefined);

	const dir = await mkdtemp(join(tmpdir(), "ppt-typography-bad-"));
	try {
		const broken = join(dir, "source.pptx");
		await writeFile(broken, "not a zip");
		assert.equal(await templateTypography({ sourceTemplate: broken }, LAYOUTS), undefined);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("接线守卫：slots.json 的两个写入方都必须把 typography 交给 deriveSlotSpec", async () => {
	const writers = {
		"lib/ppt-templates.js": await readFile(join(repoRoot, "lib/ppt-templates.js"), "utf8"),
		"scripts/lint-ppt-template.mjs": await readFile(join(repoRoot, "scripts/lint-ppt-template.mjs"), "utf8")
	};
	for (const [name, source] of Object.entries(writers)) {
		assert.match(source, /templateTypography/, `${name} 必须使用 templateTypography 取模板排版`);
		// deriveSlotSpec 调用与其后的 typography 实参之间不应跨太远（防止"导入了但没传"）。
		assert.match(
			source,
			/deriveSlotSpec\([\s\S]{0,400}?typography/,
			`${name} 必须把 typography 传给 deriveSlotSpec —— 不传就会静默退化为默认排版模型，容量与 pptx-cli 等价`
		);
	}

	const manifestModule = await readFile(join(repoRoot, "lib/pptx-manifest.js"), "utf8");
	assert.match(manifestModule, /export async function templateTypography/, "lib/pptx-manifest.js 必须导出 templateTypography");
	assert.match(manifestModule, /scanPresentationXml/, "必须读模板 pptx 的 XML，而不是只信 manifest 的估算");
	assert.match(manifestModule, /typographyFromScan/);
});

/**
 * 把 fig1 的 analysis 槽框高压到指定值。
 *
 * 注意不能直接改 `capacityLines` —— 编译器会用 `computeTextCapacity()` 拿槽位几何
 * **重算**容量（这是它和 slots.json 同源的关键），注入的字段会被覆盖。压框高才是
 * "模板把框做得比行高还矮"的忠实模拟。
 */
function withAnalysisHeight(spec, heightEmu) {
	return {
		...spec,
		layouts: spec.layouts.map((layout) => layout.layoutId !== "fig1"
			? layout
			: { ...layout, slots: layout.slots.map((slot) => (slot.key !== "analysis" ? slot : { ...slot, heightEmu })) })
	};
}

test("容量分级：连一行都放不下只报 info，装得下但内容超长才报 warning", () => {
	const spec = deriveSlotSpec(summarizeManifest(literatureManifest()), { minFontPt: 20 });
	const basePlan = (analysis) => ({ slides: [{ role: "figure-1", slots: { analysis } }] });

	// 框高 1 EMU：重算容量必然为 0。Agent 改文案也修不了（只能改模板），因此只能是 info。
	const zero = compilePlan({ plan: basePlan("一段图文解读。"), slotSpec: withAnalysisHeight(spec, 1), requireImages: false });
	const boxFindings = zero.diagnostics.filter((row) => row.code === "slot-box-smaller-than-one-line");
	assert.equal(boxFindings.length, 1, `0 容量必须单独成一条 finding，实际诊断：${JSON.stringify(zero.diagnostics.map((row) => row.code))}`);
	assert.equal(boxFindings[0].severity, "info");
	assert.equal(zero.diagnostics.filter((row) => row.code === "capacity-exceeded").length, 0,
		"0 容量不得再报 capacity-exceeded —— 那会让每页都响一声，真信号被淹没");
	// 这份最小计划本身还缺 figure/caption 等必填槽（那是另一类诊断），所以这里只断言
	// "0 容量没被算成 warning"，不去断言整份诊断的 warning 总数。
	assert.equal(
		zero.diagnostics.filter((row) => row.code === "slot-box-smaller-than-one-line" && row.severity !== "info").length,
		0,
		"0 容量只能是 info 级"
	);

	// 正常框高 + 超长文案 → warning（这才是要 Agent 真去看、去删字的信号）。
	const long = "这是一段明显超过槽位容量的图文解读文字，".repeat(12);
	const long_ = compilePlan({ plan: basePlan(long), slotSpec: spec, requireImages: false });
	const exceeded = long_.diagnostics.filter((row) => row.code === "capacity-exceeded");
	assert.equal(exceeded.length, 1, `超长必须报 capacity-exceeded，实际诊断：${JSON.stringify(long_.diagnostics.map((row) => row.code))}`);
	assert.equal(exceeded[0].severity, "warning");
	assert.ok(exceeded[0].location?.estimatedLines > 1, "诊断要带估算行数，Agent 才能判断要删多少字");
});

test("容量分级：单行框只在超过时告警；多行框顶格（恰好等于容量）就要告警", () => {
	const spec = deriveSlotSpec(summarizeManifest(literatureManifest()), { minFontPt: 20 });
	const layout = spec.layouts.find((row) => row.layoutId === "fig1");
	const slot = layout.slots.find((row) => row.key === "analysis");
	const fontPt = Number.isFinite(slot.effectiveFontPt) ? slot.effectiveFontPt : slot.fontPt;
	const capacity = computeTextCapacity({
		geometry: { leftEmu: slot.leftEmu, topEmu: slot.topEmu, widthEmu: slot.widthEmu, heightEmu: slot.heightEmu },
		slideHeightEmu: spec.pageSize?.heightEmu,
		fontPt,
		insets: slot.insets,
		lineSpacing: slot.lineSpacing ?? (Number.isFinite(slot.lineHeightPt) ? { kind: "pts", value: slot.lineHeightPt } : undefined),
		spaceBefore: Number.isFinite(slot.spaceBeforePt) ? { kind: "pts", value: slot.spaceBeforePt } : undefined,
		spaceAfter: Number.isFinite(slot.spaceAfterPt) ? { kind: "pts", value: slot.spaceAfterPt } : undefined
	}).capacityLines;
	assert.ok(capacity >= 2, `夹具 analysis 容量应至少 2 行，实际 ${capacity}`);
	// 每行可容纳的"字宽单位"：宽度减去左右各 0.1in 内边距后除以字号（CJK 记 1.0）。
	const unitsPerLine = Math.max(((slot.widthEmu / 914400) * 72 - 0.2 * 72) / fontPt, 1);
	const compile = (text) => compilePlan({
		plan: { slides: [{ role: "figure-1", slots: { analysis: text } }] },
		slotSpec: spec,
		requireImages: false
	});
	const exceeded = (result) => result.diagnostics.filter((row) => row.code === "capacity-exceeded");

	// 明显有余量：不告警。
	assert.equal(exceeded(compile("字".repeat(Math.floor((capacity - 2) * unitsPerLine)))).length, 0);
	// 恰好等于容量（顶格）：必须告警，且文案说"已达到容量"——这正是试用现场渲染溢出而编译器沉默的那种情形。
	const exact = "字".repeat(Math.floor((capacity - 1) * unitsPerLine) + 1);
	const atLimit = compile(exact);
	assert.equal(exceeded(atLimit).length, 1, `顶格必须告警（capacity=${capacity}）`);
	assert.match(exceeded(atLimit)[0].message, /已达到容量/);
	assert.equal(exceeded(atLimit)[0].location?.capacityLines, capacity);
	// 超过容量：文案说"超过"。
	const over = compile("字".repeat(Math.ceil((capacity + 2) * unitsPerLine)));
	assert.equal(exceeded(over).length, 1);
	assert.match(exceeded(over)[0].message, /超过容量/);
});
