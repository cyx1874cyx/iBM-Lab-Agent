/**
 * 容量模型单测：用「模板真实行距/段间距 + 版面下边界」自算容量，取代 pptx-cli 的 max_lines。
 *
 * 背景（0.5.4 真实试用复盘里最耗时的坑）：pptx-cli 的 `_estimate_text_capacity` 只按高度算，
 * 行距**硬编码** `字号 × 1.22`，不读 `a:lnSpc` / `a:spcBef` / `a:spcAft`，也不把可用高度夹到
 * 版面下边界。真实模板的正文占位符写的是**固定 30pt 行距**（`<a:spcPts val="3000"/>`），
 * 于是它把 fig1/body_15 的容量报成 **19 行**，而按模板实际排版只有 **14 行** —— 试用 Agent
 * 照它的数字填字就会溢出，为此磨了 10 轮「改文案 → 重建 → 渲染」。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	CAPACITY_OPTIMISTIC_RATIO,
	DEFAULT_INSETS_EMU,
	computeTextCapacity,
	deriveSlotSpec,
	resolveLineHeightPt,
	spacingToPt,
	typographyFromScan
} from "../../src/ppt-slot-spec.js";
import { summarizeManifest } from "../../lib/pptx-manifest.js";
import { scanLayoutXml } from "../../src/pptx-xml.js";
import { literatureManifest } from "../fixtures/ppt-manifest-fixture.mjs";

const EMU_IN = 914400;
const inch = (value) => Math.round(value * EMU_IN);
/** 真实模板：13.33 × 7.5 in。 */
const SLIDE_H = 6858000;

/** 真实模板 fig1/body_15 的几何（3.51 × 6.47 in，top 0.99 in，bottom 7.46 in）。 */
const FIG1_ANALYSIS = { leftEmu: inch(9.9), topEmu: inch(0.99), widthEmu: inch(3.51), heightEmu: inch(6.47) };
/** 真实模板 fig1/body_12 的几何（图注：9.14 × 0.40 in）。 */
const FIG1_CAPTION = { leftEmu: inch(0.2), topEmu: inch(7.06), widthEmu: inch(9.14), heightEmu: inch(0.4) };
/** 真实模板正文占位符的排版：固定 30pt 行距 + 段前 10pt / 段后 14pt。 */
const TEMPLATE_BODY_TYPOGRAPHY = {
	lineSpacing: { kind: "pts", value: 30 },
	spaceBefore: { kind: "pts", value: 10 },
	spaceAfter: { kind: "pts", value: 14 }
};

test("spacingToPt：pct 乘字号、pts 直接用", () => {
	assert.equal(spacingToPt({ kind: "pts", value: 30 }, 20), 30);
	assert.equal(spacingToPt({ kind: "pct", value: 100000 }, 20), 20);
	assert.equal(spacingToPt({ kind: "pct", value: 150000 }, 20), 30);
	assert.equal(spacingToPt(undefined, 20), undefined);
	assert.equal(spacingToPt({ kind: "pts", value: Number.NaN }, 20), undefined);
});

test("resolveLineHeightPt：模板写了 lnSpc 就用模板值，否则退化为 1.2 × 字号", () => {
	assert.deepEqual(resolveLineHeightPt({ fontPt: 20, lineSpacing: { kind: "pts", value: 30 } }), { lineHeightPt: 30, source: "template-lnSpc" });
	assert.deepEqual(resolveLineHeightPt({ fontPt: 20, lineSpacing: { kind: "pct", value: 150000 } }), { lineHeightPt: 30, source: "template-lnSpc" });
	const fallback = resolveLineHeightPt({ fontPt: 20 });
	assert.equal(fallback.lineHeightPt, 24);
	assert.equal(fallback.source, "default-multiplier");
	assert.equal(resolveLineHeightPt({}).source, "unresolved");
});

test("真实模板 fig1/body_15：自算 14 行，而 pptx-cli 按 1.22 倍报 19 行", () => {
	const computed = computeTextCapacity({
		geometry: FIG1_ANALYSIS,
		slideHeightEmu: SLIDE_H,
		fontPt: 20,
		...TEMPLATE_BODY_TYPOGRAPHY
	});
	assert.equal(computed.lineHeightPt, 30);
	assert.equal(computed.lineHeightSource, "template-lnSpc");
	assert.equal(computed.clampedToSlide, false, "fig1/body_15 的底边 7.46 in 仍在 7.5 in 版面内");
	assert.equal(computed.capacityLines, 14, "可用高度 458.64pt，扣掉 24pt 段间距后 30pt/行只能放 14 行");

	// 同一个占位符、不读模板行距与段间距（≈ pptx-cli 的模型）：19 行 —— 高估的方向与量级就在这里。
	const asPptxCliModelsIt = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20 });
	assert.equal(asPptxCliModelsIt.capacityLines, 19);

	// pptx-cli 自己报的也是 19 行：它把 text_frame 未显式设置的内边距当 0，且完全不扣段间距。
	const cliMaxLines = Math.floor((inch(6.47) / EMU_IN * 72) / (20 * 1.22));
	assert.equal(cliMaxLines, 19);
	assert.ok(cliMaxLines >= computed.capacityLines * CAPACITY_OPTIMISTIC_RATIO, "19 ≥ 14 × 1.25：必须被判为「元数据系统性高估」");
});

test("a:lnSpc 的百分比形式与等价点数得到同一容量", () => {
	const asPts = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20, ...TEMPLATE_BODY_TYPOGRAPHY });
	const asPct = computeTextCapacity({
		geometry: FIG1_ANALYSIS,
		slideHeightEmu: SLIDE_H,
		fontPt: 20,
		lineSpacing: { kind: "pct", value: 150000 },
		spaceBefore: { kind: "pts", value: 10 },
		spaceAfter: { kind: "pts", value: 14 }
	});
	assert.equal(asPct.lineHeightPt, asPts.lineHeightPt);
	assert.equal(asPct.capacityLines, asPts.capacityLines);
});

test("段间距按段落数扣减：段数越多容量越小", () => {
	const one = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20, ...TEMPLATE_BODY_TYPOGRAPHY, paragraphs: ["一段"] });
	const two = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20, ...TEMPLATE_BODY_TYPOGRAPHY, paragraphs: ["一段", "两段"] });
	const three = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20, ...TEMPLATE_BODY_TYPOGRAPHY, paragraphs: ["一", "二", "三"] });
	assert.equal(one.capacityLines, 14);
	assert.equal(two.capacityLines, 13);
	assert.equal(three.capacityLines, 12);
	assert.equal(one.spacingTotalPt, 24);
	assert.equal(two.spacingTotalPt, 48);
});

test("可用高度夹到版面下边界；完全在版面外时容量为 0", () => {
	// top 7.0 in + height 2.0 in = 9.0 in，超出 7.5 in 的版面 1.5 in。
	const overflowing = computeTextCapacity({ geometry: { topEmu: inch(7), heightEmu: inch(2), widthEmu: inch(6) }, slideHeightEmu: SLIDE_H, fontPt: 20 });
	assert.equal(overflowing.clampedToSlide, true);
	assert.equal(overflowing.effectiveBottomEmu, SLIDE_H);
	const unclamped = computeTextCapacity({ geometry: { topEmu: inch(7), heightEmu: inch(2), widthEmu: inch(6) }, slideHeightEmu: inch(12), fontPt: 20 });
	assert.equal(unclamped.clampedToSlide, false);
	assert.ok(overflowing.capacityLines < unclamped.capacityLines, "夹到版面后容量必须更小");

	const outside = computeTextCapacity({ geometry: { topEmu: inch(8), heightEmu: inch(1), widthEmu: inch(6) }, slideHeightEmu: SLIDE_H, fontPt: 20 });
	assert.equal(outside.usableHeightEmu, 0);
	assert.equal(outside.capacityLines, 0);

	// 图注槽（0.40 in）在「≥20pt」政策下连一行都放不下 —— 模板侧 14pt 设计的真实后果。
	const caption = computeTextCapacity({ geometry: FIG1_CAPTION, slideHeightEmu: SLIDE_H, fontPt: 20 });
	assert.equal(caption.capacityLines, 0);
	assert.ok(caption.usableHeightPt > 0 && caption.usableHeightPt < caption.lineHeightPt);
});

test("内边距可被模板显式覆盖（a:bodyPr 的 lIns/rIns/tIns/bIns）", () => {
	const defaults = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20, ...TEMPLATE_BODY_TYPOGRAPHY });
	const tight = computeTextCapacity({ geometry: FIG1_ANALYSIS, slideHeightEmu: SLIDE_H, fontPt: 20, ...TEMPLATE_BODY_TYPOGRAPHY, insets: { tIns: 0, bIns: 0 } });
	assert.equal(tight.insets.tIns, 0);
	assert.equal(tight.insets.lIns, DEFAULT_INSETS_EMU.lIns);
	assert.ok(tight.usableHeightEmu > defaults.usableHeightEmu);
});

test("typographyFromScan：按版式名对齐、占位符行距优先、母版兜底", () => {
	const layoutXml = (name, { withLineSpacing }) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="${name}"><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="10" name="文本占位符 20"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="15"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:bodyPr lIns="18288" tIns="0"/></p:spPr>
      <p:txBody><a:bodyPr/>
        <a:lstStyle><a:lvl1pPr>${withLineSpacing ? '<a:lnSpc><a:spcPts val="3000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:spcAft><a:spcPts val="1400"/></a:spcAft>' : ""}<a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle>
        <a:p><a:r><a:t>正文</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sldLayout>`;
	const scan = scanLayoutXml(layoutXml("Fig1", { withLineSpacing: true }));
	assert.equal(scan.placeholders[0].insets.lIns, 18288);
	assert.equal(scan.placeholders[0].insets.tIns, 0);
	assert.deepEqual(scan.placeholders[0].paragraph.lineSpacing, { kind: "pts", value: 30 });
	assert.deepEqual(scan.placeholders[0].paragraph.spaceBefore, { kind: "pts", value: 10 });
	assert.deepEqual(scan.placeholders[0].paragraph.spaceAfter, { kind: "pts", value: 14 });

	const plain = scanLayoutXml(layoutXml("Fig2", { withLineSpacing: false }));
	assert.equal(plain.placeholders[0].paragraph.lineSpacing, undefined);

	const typography = typographyFromScan(
		{
			ok: true,
			layouts: [{ index: 2, name: "Fig1", placeholders: scan.placeholders }, { index: 3, name: "Fig2", placeholders: plain.placeholders }],
			masters: [{ styles: { body: { 1: { lineSpacing: { kind: "pct", value: 120000 } } } } }]
		},
		[{ id: "fig1", name: "Fig1", sourceLayoutIndex: 2 }, { id: "fig2", name: "Fig2", sourceLayoutIndex: 3 }]
	);
	assert.deepEqual(typography.fig1.placeholders[15].lineSpacing, { kind: "pts", value: 30 });
	assert.equal(typography.fig1.placeholders[15].insets.lIns, 18288);
	assert.equal(typography.fig1.placeholders[15].insets.tIns, 0);
	// Fig2 没写 lnSpc → 回退到母版 bodyStyle/lvl1。
	assert.deepEqual(typography.fig2.placeholders[15].lineSpacing, { kind: "pct", value: 120000 });
});

test("typographyFromScan：扫描失败时返回空表（调用方退化为默认排版，不假装检查过）", () => {
	assert.deepEqual(typographyFromScan({ ok: false, error: "not a zip" }, [{ id: "fig1" }]), {});
	assert.deepEqual(typographyFromScan(undefined, []), {});
});

test("deriveSlotSpec：容量字段落盘，且与 pptx-cli 差 ≥25% 时报 capacity-metadata-optimistic", () => {
	const summary = summarizeManifest(literatureManifest());
	const typography = {
		fig1: {
			placeholders: {
				15: { ...TEMPLATE_BODY_TYPOGRAPHY }
			}
		}
	};
	const spec = deriveSlotSpec(summary, { minFontPt: 20, typography });
	assert.equal(spec.capacityModel.source, "template-xml");
	assert.equal(spec.pageSize.heightEmu, SLIDE_H, "版面高度必须随规范落盘，编译器要拿它夹边界");

	const analysis = spec.layouts.find((layout) => layout.layoutId === "fig1").slots.find((slot) => slot.key === "analysis");
	assert.equal(analysis.capacitySource, "computed-template");
	assert.equal(analysis.lineHeightPt, 30);
	assert.equal(analysis.spaceBeforePt, 10);
	assert.equal(analysis.spaceAfterPt, 14);
	assert.equal(analysis.capacityLines, 13, "夹具 fig1/analysis 是 4 × 6 in、top 1.0 in");
	assert.equal(analysis.cliCapacityLines, 18, "夹具的 estimated_text_capacity.max_lines = round(height × 3)");
	assert.equal(analysis.capacityOptimistic, true);
	assert.ok(analysis.cliCapacityLines >= analysis.capacityLines * CAPACITY_OPTIMISTIC_RATIO);

	// 夹具的合成 max_lines（round(height × 3)）在短占位符上普遍偏大，所以只针对本用例
	// 真正给了模板排版的 fig1/analysis 断言；这也说明警报复现的是"元数据 vs 可渲染容量"的差异。
	const optimistic = spec.warnings.filter((warning) => warning.code === "capacity-metadata-optimistic"
		&& warning.location?.layoutId === "fig1" && warning.location?.slotKey === "analysis");
	assert.equal(optimistic.length, 1);
	assert.match(optimistic[0].message, /pptx-cli 报 18 行/);
	assert.match(optimistic[0].message, /自算 13 行/);
	assert.match(optimistic[0].hint, /capacityLines 为准/);
});

test("deriveSlotSpec：没有模板排版表时仍落盘容量，但标记来源为默认值", () => {
	const spec = deriveSlotSpec(summarizeManifest(literatureManifest()), { minFontPt: 20 });
	const analysis = spec.layouts.find((layout) => layout.layoutId === "fig1").slots.find((slot) => slot.key === "analysis");
	assert.equal(spec.capacityModel.source, "defaults");
	assert.equal(analysis.capacitySource, "computed-default-typography");
	assert.equal(analysis.lineHeightSource, "default-multiplier");
	assert.equal(analysis.lineHeightPt, 24);
	assert.equal(analysis.capacityLines, 17);
	assert.equal(analysis.capacityOptimistic, undefined, "默认模型下差异不到 25%，不报警（避免噪声）");
});
