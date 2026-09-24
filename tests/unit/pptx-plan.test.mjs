/**
 * Unit: lib/pptx-plan.js —— plan.json → compiled.json 编译器。
 *
 * 覆盖：角色→版式（用**版式名**，因为构建器侧认 parse.json/版式名）、槽位→texts[]
 * （prompt 优先 + idx 兜底 + mode/align）、图片绝对路径、以及编译期诊断
 * （槽位名写错 / 必填槽缺失 / 图片不存在 / 容量超限 / 角色未知 / 缺讲稿）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	cleanCompiledPlan,
	compilePlan,
	estimateLines,
	normalizeSlotValue,
	textWidthUnits
} from "../../lib/pptx-plan.js";
import { deriveSlotSpec } from "../../src/ppt-slot-spec.js";
import { summarizeManifest } from "../../lib/pptx-manifest.js";
import { literatureManifest } from "../fixtures/ppt-manifest-fixture.mjs";

const COMPILE_CLI = fileURLToPath(new URL("../../scripts/compile-ppt-plan.mjs", import.meta.url));
const slotSpec = deriveSlotSpec(summarizeManifest(literatureManifest({ driftFig2StaticLayer: false })), { minFontPt: 20 });

function tmpDir(t) {
	const dir = mkdtempSync(join(tmpdir(), "ppt-plan-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

const codes = (diagnostics) => diagnostics.map((row) => row.code);

test("textWidthUnits / estimateLines：CJK 按 1 字宽、西文按 0.5 字宽估算", () => {
	assert.equal(textWidthUnits("中文四个字"), 5);
	assert.equal(textWidthUnits("abcdefgh"), 4);
	// 4 英寸宽、20pt：一行约 12.96 个 CJK 字 → 6 个字 1 行
	assert.equal(estimateLines(["中文中文中文"], { widthEmu: 4 * 914400, fontPt: 20 }), 1);
	// 1 英寸 = 72pt，减内边距后 57.6pt / 20pt ≈ 2.88 字宽/行 → 12 个字约 5 行
	const lines = estimateLines(["一二三四五六七八九十十一十二"], { widthEmu: 914400, fontPt: 20 });
	assert.equal(lines, 5);
	assert.equal(estimateLines(["x"], {}), undefined);
});

test("normalizeSlotValue：字符串/数组/对象三种写法", () => {
	assert.deepEqual(normalizeSlotValue("一段\n二段").paragraphs, ["一段", "二段"]);
	assert.deepEqual(normalizeSlotValue(["a", "", "b"]).paragraphs, ["a", "b"]);
	assert.deepEqual(normalizeSlotValue({ paragraphs: ["x"], mode: "bullets", align: "left", sizePt: 24 }), { paragraphs: ["x"], mode: "bullets", align: "left", sizePt: 24 });
	assert.deepEqual(normalizeSlotValue(42), { paragraphs: [] });
});

test("编译：角色→版式名、槽位→texts[]（prompt + idx + mode/align）、图片转绝对路径", (t) => {
	const dir = tmpDir(t);
	writeFileSync(join(dir, "fig.png"), Buffer.from("89504e470d0a1a0a", "hex"));
	const plan = {
		requiredPages: ["cover", "summary"],
		notesRequired: true,
		slides: [
			{ role: "cover", slots: { titleZh: "中文标题", titleEn: "English Title", date: "日期：2026/09/24" }, notes: "开头" },
			{ role: "figure-1", slots: { figure: "fig.png", caption: "Fig.1 图注", analysis: ["第一段。", "第二段。"] }, notes: "讲图" },
			{ role: "summary", slots: { innovation: ["（1）甲", "（2）乙"], paragraph1: "总结段" }, notes: "总结" }
		]
	};
	const { compiled, diagnostics, summary } = compilePlan({ plan, slotSpec, baseDir: dir });
	assert.equal(summary.errors, 0, JSON.stringify(diagnostics));
	assert.equal(compiled.kind, "compiled-plan");
	assert.equal(compiled.roles.cover, "标题幻灯片");
	assert.equal(compiled.roles["figure-1"], "Fig1");
	assert.equal(compiled.manifestLayoutIds["figure-1"], "fig1");
	assert.equal(compiled.slides.length, 3);

	const cover = compiled.slides[0];
	assert.deepEqual(cover.texts.map((entry) => [entry.slotKey, entry.idx, entry.mode, entry.align]), [
		["titleZh", 10, "paragraph", "center"],
		["titleEn", 11, "paragraph", "center"],
		["date", 13, "paragraph", "right"]
	]);
	assert.equal(cover.texts[0].prompt, "论文中文标题");
	assert.equal(cover.layoutName, "标题幻灯片");

	const figure = compiled.slides[1];
	assert.equal(figure.image, join(dir, "fig.png"), "图片必须是绝对路径，构建器不依赖 CWD");
	assert.deepEqual(figure.texts.map((entry) => entry.slotKey), ["caption", "analysis"]);
	assert.equal(figure.texts[0].mode, "paragraph");
	assert.equal(figure.texts[0].align, "center");
	assert.equal(figure.texts[1].align, "justify");
	assert.deepEqual(figure.texts[1].paragraphs, ["第一段。", "第二段。"]);

	const innovation = compiled.slides[2].texts.find((entry) => entry.slotKey === "innovation");
	assert.equal(innovation.mode, "bullets");
	assert.equal(cleanCompiledPlan(compiled).slides[0].texts[0]._order, undefined, "写盘前清掉内部排序字段");
});

test("编译诊断：槽位名写错 / 必填槽缺失 / 图片不存在 / 容量超限 / 角色未知 / 缺讲稿", (t) => {
	const dir = tmpDir(t);
	const plan = {
		notesRequired: true,
		slides: [
			{ role: "cover", slots: { titelZh: "拼错的槽位名", titleZh: "中文标题", titleEn: "EN", date: "日期" }, notes: "ok" },
			{ role: "figure-1", slots: { figure: "missing.png", caption: "图注", analysis: "解读".repeat(400) }, notes: "" },
			{ role: "not-a-role", slots: {}, notes: "x" }
		]
	};
	const { diagnostics, summary } = compilePlan({ plan, slotSpec, baseDir: dir });
	assert.ok(codes(diagnostics).includes("slot-unknown"));
	assert.ok(codes(diagnostics).includes("image-missing"));
	assert.ok(codes(diagnostics).includes("capacity-exceeded"));
	assert.ok(codes(diagnostics).includes("layout-unknown"));
	assert.ok(codes(diagnostics).includes("notes-missing"));
	// 未知角色的那一页不会进入 compiled.slides
	assert.equal(summary.errors >= 4, true);
	const unknownSlot = diagnostics.find((row) => row.code === "slot-unknown");
	assert.equal(unknownSlot.severity, "error");
	assert.match(unknownSlot.message, /可用槽位/);
});

test("编译诊断：plan.roles 覆盖 / texts[] 直接给 prompt / prompt 不匹配给 warning", (t) => {
	const dir = tmpDir(t);
	const plan = {
		roles: { cover: "标题幻灯片" },
		slides: [
			{ role: "cover", texts: [{ prompt: "论文中文标题", paragraphs: ["标题"] }, { prompt: "不存在的提示文字", paragraphs: ["x"] }, { idx: 12, paragraphs: ["汇报人"] }], notes: "n" },
			{ role: "abstract", slots: { abstractShot: "missing.png", abstractZh: "摘要" }, notes: "n" }
		]
	};
	const { compiled, diagnostics } = compilePlan({ plan, slotSpec, baseDir: dir, requireImages: false });
	assert.ok(codes(diagnostics).includes("text-prompt-unmatched"));
	const cover = compiled.slides[0];
	// prompt 命中槽位 → 带 idx；prompt 未命中但构建器仍可按提示文字直传（idx 留空）；
	// 只有 idx 的条目 → 按 idx 兜底。第二条同时给出 warning，不静默丢弃。
	assert.deepEqual(cover.texts.map((entry) => entry.idx), [10, undefined, 12]);
	assert.equal(cover.texts[1].prompt, "不存在的提示文字");
	assert.equal(diagnostics.find((row) => row.code === "text-prompt-unmatched").severity, "warning");
	assert.equal(diagnostics.find((row) => row.code === "image-missing").severity, "warning", "requireImages=false 时降级为 warning");
});

test("编译诊断：plan 结构错误直接返回诊断，不抛", () => {
	assert.equal(compilePlan({ plan: null, slotSpec }).compiled, undefined);
	// plan 结构合法但没内容 → 仍产出 compiled（便于写盘对照修），只是带 error 诊断
	assert.ok(codes(compilePlan({ plan: {}, slotSpec }).diagnostics).includes("plan-empty"));
	assert.ok(codes(compilePlan({ plan: { slides: [] }, slotSpec }).diagnostics).includes("plan-empty"));
	assert.ok(codes(compilePlan({ plan: { slides: [{ role: "cover" }] }, slotSpec: undefined }).diagnostics).includes("slots-missing"));
	assert.ok(codes(compilePlan({ plan: { slides: [{}] }, slotSpec }).diagnostics).includes("slide-role-missing"));
});

test("编译诊断：超页与必选页缺失", () => {
	const twoSlides = {
		maxPages: 1,
		slides: [
			{ role: "cover", slots: { titleZh: "a", titleEn: "b", date: "c" }, notes: "n" },
			{ role: "thanks", slots: { thanks: "敬请批评指正" }, notes: "n" }
		]
	};
	assert.ok(codes(compilePlan({ plan: twoSlides, slotSpec }).diagnostics).includes("too-many-pages"));

	const missingRole = {
		requiredPages: ["cover", "thanks"],
		slides: [{ role: "cover", slots: { titleZh: "a", titleEn: "b", date: "c" }, notes: "n" }]
	};
	assert.ok(codes(compilePlan({ plan: missingRole, slotSpec }).diagnostics).includes("missing-required-page"));
});

test("CLI：compile-ppt-plan.mjs 写出 compiled.json 并按 error 给退出码", (t) => {
	const dir = tmpDir(t);
	writeFileSync(join(dir, "fig.png"), Buffer.from("89504e470d0a1a0a", "hex"));
	const slotsPath = join(dir, "slots.json");
	writeFileSync(slotsPath, `${JSON.stringify(slotSpec, null, 2)}\n`);
	const planPath = join(dir, "plan.json");
	writeFileSync(planPath, `${JSON.stringify({
		notesRequired: false,
		slides: [{ role: "cover", slots: { titleZh: "中文标题", titleEn: "EN", date: "日期：2026/09/24" }, notes: "n" }]
	})}\n`);
	const out = join(dir, "compiled.json");
	const stdout = execFileSync(process.execPath, [COMPILE_CLI, "--plan", planPath, "--slots", slotsPath, "--out", out, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const payload = JSON.parse(stdout);
	assert.equal(payload.kind, "compiled-plan");
	assert.equal(payload.ok, true);
	assert.equal(payload.slides[0].role, "cover");
	const saved = JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(out)},'utf8'))`], { encoding: "utf8" }));
	assert.equal(saved.roles.cover, "标题幻灯片");

	// 有 error → 退出码 1，且仍写出 compiled.json 供对照修
	writeFileSync(planPath, `${JSON.stringify({ notesRequired: false, slides: [{ role: "cover", slots: {}, notes: "n" }] })}\n`);
	let code = 0;
	try {
		execFileSync(process.execPath, [COMPILE_CLI, "--plan", planPath, "--slots", slotsPath, "--out", out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		code = error.status;
	}
	assert.equal(code, 1);
	const failed = JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(out)},'utf8'))`], { encoding: "utf8" }));
	assert.equal(failed.ok, false);
	assert.ok(failed.diagnostics.some((row) => row.code === "required-slot-missing"));
});

test("CLI：缺 --plan 或既没有 --slots 也没有 --template → 退出码 2", () => {
	let code = 0;
	try {
		execFileSync(process.execPath, [COMPILE_CLI], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		code = error.status;
	}
	assert.equal(code, 2);
});
