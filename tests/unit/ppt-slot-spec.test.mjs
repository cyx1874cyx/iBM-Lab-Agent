/**
 * Unit: src/ppt-slot-spec.js + src/ppt-template-guide.js。
 *
 * 用合成 manifest 夹具（tests/fixtures/ppt-manifest-fixture.mjs，无校徽/logo）验证：
 *   角色识别只看**提示文字**（不看 layout id / idx）；槽位绑定三轮策略；
 *   图注按图号约定（图 1 要、图 3 不要）；改名/缺失分别归类；GUIDE.md 内容完整。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	allSlots,
	bindLayoutSlots,
	deriveSlotSpec,
	detectLayoutRole,
	expectedSlotsForRole,
	indexSlotSpec,
	readingOrder
} from "../../src/ppt-slot-spec.js";
import { renderTemplateGuide, blockingErrorCount } from "../../src/ppt-template-guide.js";
import { summarizeManifest } from "../../lib/pptx-manifest.js";
import { literatureManifest } from "../fixtures/ppt-manifest-fixture.mjs";

const summary = summarizeManifest(literatureManifest());

test("detectLayoutRole 按提示文字识别角色，figure 带图号", () => {
	const byId = new Map(summary.layouts.map((layout) => [layout.id, layout]));
	assert.equal(detectLayoutRole(byId.get("item")).role, "cover");
	assert.equal(detectLayoutRole(byId.get("abs")).role, "abstract");
	assert.deepEqual(detectLayoutRole(byId.get("fig1")), { role: "figure-1", figureNumber: 1, matched: "Fig1图占位" });
	assert.equal(detectLayoutRole(byId.get("end")).role, "summary");
	assert.equal(detectLayoutRole(byId.get("ppt-end")).role, "thanks");
	assert.equal(detectLayoutRole({ placeholders: [{ guidanceText: "完全无关的提示" }] }).role, "unknown");
});

test("expectedSlotsForRole：图 1 要图注、图 3 不要（用户约定）", () => {
	assert.deepEqual(expectedSlotsForRole("figure-1").map((slot) => slot.key), ["figure", "caption", "analysis"]);
	assert.deepEqual(expectedSlotsForRole("figure-3").map((slot) => slot.key), ["figure", "analysis"]);
	// 未在约定清单里的新图号：按"要有图注"的安全默认
	assert.deepEqual(expectedSlotsForRole("figure-7").map((slot) => slot.key), ["figure", "caption", "analysis"]);
	assert.deepEqual(expectedSlotsForRole("cover").map((slot) => slot.key), ["titleZh", "titleEn", "date", "speaker"]);
});

test("deriveSlotSpec：7 个角色全部识别、18 个槽位全绑定、无未分配", () => {
	const spec = deriveSlotSpec(summary, { minFontPt: 20 });
	assert.deepEqual(Object.keys(spec.roles).sort(), ["abstract", "cover", "figure-1", "figure-2", "figure-3", "summary", "thanks"].sort());
	assert.equal(allSlots(spec).length, 18);
	assert.equal(spec.missingSlots.length, 0);
	assert.equal(spec.promptMismatches.length, 0);
	assert.equal(spec.unassignedPlaceholders.length, 0);
	const caption = allSlots(spec).find((slot) => slot.layoutId === "fig1" && slot.key === "caption");
	assert.equal(caption.idx, 12);
	assert.equal(caption.fontPt, 14);
	assert.equal(caption.belowFontFloor, true);
	assert.equal(caption.mode, "paragraph");
	const innovation = allSlots(spec).find((slot) => slot.key === "innovation");
	assert.equal(innovation.mode, "bullets");
	assert.equal(innovation.align, "left");
	assert.ok(innovation.usage.includes("分点"));
});

test("bindLayoutSlots：提示文字被改名 → 结构兜底并标记 promptMismatch", () => {
	const layout = summary.layouts.find((entry) => entry.id === "fig1");
	const renamed = {
		...layout,
		placeholders: layout.placeholders.map((placeholder) => (placeholder.idx === 12 ? { ...placeholder, guidanceText: "图1说明文字" } : placeholder))
	};
	const bound = bindLayoutSlots(renamed, "figure-1");
	assert.deepEqual(bound.slots.map((slot) => slot.key), ["figure", "caption", "analysis"]);
	const caption = bound.slots.find((slot) => slot.key === "caption");
	assert.equal(caption.boundBy, "structure");
	assert.equal(bound.promptMismatches.length, 1);
	assert.equal(bound.promptMismatches[0].actualPrompt, "图1说明文字");
});

test("bindLayoutSlots：图注槽被整条删掉 → 记为缺失（不静默错配到正文）", () => {
	const layout = summary.layouts.find((entry) => entry.id === "fig1");
	const withoutCaption = { ...layout, placeholders: layout.placeholders.filter((placeholder) => placeholder.idx !== 12) };
	const bound = bindLayoutSlots(withoutCaption, "figure-1");
	assert.deepEqual(bound.missing.map((slot) => slot.key), ["caption"]);
	assert.equal(bound.missing[0].required, true);
	assert.deepEqual(bound.slots.map((slot) => slot.key), ["figure", "analysis"]);
});

test("deriveSlotSpec：summary 版式的可选槽（结尾段）如实标 optional", () => {
	const spec = deriveSlotSpec(summary);
	const end = spec.layouts.find((layout) => layout.layoutId === "end");
	assert.deepEqual(end.slots.map((slot) => `${slot.key}:${slot.required}`), ["innovation:true", "paragraph1:true", "paragraph2:false"]);
});

test("readingOrder / indexSlotSpec：阅读顺序与索引可用", () => {
	const layout = summary.layouts.find((entry) => entry.id === "item");
	const ordered = readingOrder(layout.placeholders).map((placeholder) => placeholder.idx);
	assert.deepEqual(ordered, [10, 11, 12, 13]);
	const spec = deriveSlotSpec(summary);
	const index = indexSlotSpec(spec);
	assert.equal(index.byLayout.get("fig3").role, "figure-3");
	assert.equal(index.byRole.get("summary").layoutId, "end");
});

test("renderTemplateGuide：给出角色表、逐槽位说明、政策、改模板步骤", () => {
	const spec = deriveSlotSpec(summary);
	const guide = renderTemplateGuide({
		template: { id: "lab-lint-fixture", version: "1", name: "夹具模板", audience: "组会", purpose: "文献汇报", pageSize: { ratio: "16:9" }, maxPages: 12, requiredPages: ["cover"] },
		slotSpec: spec,
		lintReport: { summary: { error: 3, warning: 1, info: 0, blocking: 1, compensatedErrors: 2 }, findings: [{ severity: "error", code: "required-slot-missing", message: "缺 caption 槽" }] },
		manifestInfo: { manifestDir: "manifest/", sha256: "sha256:deadbeefcafe" },
		cliVersion: "1.3.5"
	});
	assert.match(guide, /# 模板填充指南：夹具模板/);
	assert.match(guide, /pptx-cli 1\.3\.5/);
	assert.match(guide, /figure-1/);
	assert.match(guide, /Fig\.1图注/);
	assert.match(guide, /一个自然段/);
	assert.match(guide, /微软雅黑/);
	assert.match(guide, /必须修.*required-slot-missing/s);
	assert.match(guide, /node scripts\/compile-ppt-plan\.mjs/);
	assert.match(guide, /怎么改模板/);
	assert.equal(blockingErrorCount({ findings: [{ severity: "error", compensated: true }, { severity: "error" }, { severity: "warning" }] }), 1);
});

test("deriveSlotSpec：无角色版式给 warning，不静默当成可填充", () => {
	const unknown = summarizeManifest({
		...literatureManifest(),
		layouts: [{ id: "odd", name: "奇怪版式", source_layout_index: 0, placeholders: [{ logical_name: "body_1", placeholder_idx: 1, placeholder_type: "body", guidance_text: "随便写点什么", supported_content_types: ["text"], left_emu: 0, top_emu: 0, width_emu: 100, height_emu: 100 }] }]
	});
	const spec = deriveSlotSpec(unknown);
	assert.equal(spec.warnings.length, 1);
	assert.equal(spec.warnings[0].code, "layout_role_unknown");
	assert.equal(spec.layouts[0].slots.length, 0);
	assert.equal(spec.layouts[0].unassignedPlaceholders.length, 1);
});
