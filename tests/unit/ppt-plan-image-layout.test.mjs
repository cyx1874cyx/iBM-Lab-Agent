/**
 * 版式选择单测：按图片**真实像素比例**挑候选版式，并在比例不匹配时给出可执行的诊断。
 *
 * 背景（0.5.4 试用复盘）：Fig3 版式的图片占位符是 12.85 × 4.78 in（宽高比 2.69），
 * 而 Nature 单栏插图多为竖长图（宽高比约 0.87）。两者比例不匹配时，等比缩放后图只有
 * 4 in 出头宽、留白过半 —— 图里的字小到看不清，但编译器当时只检查图片"存在"，不说话。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_FIGURE_WHITESPACE_RATIO,
	MIN_READABLE_FIGURE_WIDTH_IN,
	chooseImageLayout,
	compilePlan,
	readImageSize,
	readImageSizeFromFile,
	scoreImageFit
} from "../../lib/pptx-plan.js";
import { deriveSlotSpec } from "../../src/ppt-slot-spec.js";
import { summarizeManifest } from "../../lib/pptx-manifest.js";
import { literatureManifest } from "../fixtures/ppt-manifest-fixture.mjs";

const EMU_IN = 914400;
const inch = (value) => Math.round(value * EMU_IN);

/** 只要 PNG 文件头（readImageSize 只读 IHDR 的宽高，不需要真的是一张合法 PNG）。 */
function pngHeader(width, height) {
	const buffer = Buffer.alloc(33);
	buffer.write("\x89PNG\r\n\x1a\n", 0, "latin1");
	buffer.writeUInt32BE(13, 8);
	buffer.write("IHDR", 12, "latin1");
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
}

/** 最小 JPEG：SOI + SOF0（宽高在段内偏移 5/7）。 */
function jpegHeader(width, height) {
	const buffer = Buffer.alloc(26);
	buffer[0] = 0xff;
	buffer[1] = 0xd8;
	buffer[2] = 0xff;
	buffer[3] = 0xc0;
	buffer.writeUInt16BE(17, 4);
	buffer[6] = 8;
	buffer.writeUInt16BE(height, 7);
	buffer.writeUInt16BE(width, 9);
	return buffer;
}

/** 真实模板的图片占位符几何（英寸）。 */
const FIG_SLOT = { leftEmu: inch(0.6), topEmu: inch(0.99), widthEmu: inch(9.14), heightEmu: inch(6.0) };
const FIG3_SLOT = { leftEmu: inch(0.2), topEmu: inch(0.99), widthEmu: inch(12.85), heightEmu: inch(4.78) };

test("readImageSize：PNG / JPEG 文件头可读，非图片返回 undefined", () => {
	assert.deepEqual(readImageSize(pngHeader(1600, 1200)), { width: 1600, height: 1200, format: "png" });
	assert.deepEqual(readImageSize(jpegHeader(800, 2400)), { width: 800, height: 2400, format: "jpeg" });
	assert.equal(readImageSize(Buffer.from("not an image at all, really not")), undefined);
	assert.equal(readImageSize(Buffer.alloc(4)), undefined);
	assert.equal(readImageSize("string"), undefined);
});

test("readImageSizeFromFile：读不到（文件不存在/不是图片）返回 undefined，不抛", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-img-"));
	try {
		const good = join(dir, "good.png");
		const bad = join(dir, "bad.txt");
		await writeFile(good, pngHeader(1000, 500));
		await writeFile(bad, "hello");
		assert.deepEqual(readImageSizeFromFile(good), { width: 1000, height: 500, format: "png" });
		assert.equal(readImageSizeFromFile(bad), undefined);
		assert.equal(readImageSizeFromFile(join(dir, "nope.png")), undefined);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("scoreImageFit：竖长图进宽幅槽 → 显示宽度小、留白过半（Fig3 的真实病例）", () => {
	// Nature 单栏竖长图：宽高比约 0.57（800 × 1400 px）。
	const portrait = { width: 800, height: 1400 };
	const wide = scoreImageFit(portrait, FIG3_SLOT);
	assert.equal(wide.targetAspect, 2.688);
	assert.equal(wide.imageAspect, 0.571);
	assert.ok(wide.displayWidthIn < MIN_READABLE_FIGURE_WIDTH_IN, `显示宽度 ${wide.displayWidthIn} in 应小于 ${MIN_READABLE_FIGURE_WIDTH_IN} in`);
	assert.ok(wide.whitespaceRatio > MAX_FIGURE_WHITESPACE_RATIO, `留白 ${wide.whitespaceRatio} 应超过 ${MAX_FIGURE_WHITESPACE_RATIO}`);

	// 同一张图放进 9.14 × 6.00 in 的槽：显示面积更大（模板里没有竖槽，留白仍然偏大）。
	const tall = scoreImageFit(portrait, FIG_SLOT);
	assert.equal(tall.displayWidthIn, 3.43);
	assert.equal(tall.displayHeightIn, 6);
	assert.ok(tall.displayWidthIn * tall.displayHeightIn > wide.displayWidthIn * wide.displayHeightIn, "同一张图在 Fig1 槽里面积更大");

	// 宽幅图（宽高比 3）反过来：宽幅槽才是对的。
	const wideImage = { width: 1800, height: 600 };
	const wideInWide = scoreImageFit(wideImage, FIG3_SLOT);
	assert.equal(wideInWide.displayWidthIn, 12.85);
	assert.ok(wideInWide.whitespaceRatio < 0.15);
});

test("chooseImageLayout：竖长图选非宽幅版式，横图选宽幅版式", () => {
	const candidates = [
		{ layout: { layoutId: "fig1", layoutName: "Fig1" }, slot: FIG_SLOT },
		{ layout: { layoutId: "fig3", layoutName: "Fig3" }, slot: FIG3_SLOT }
	];
	const portrait = chooseImageLayout({ width: 800, height: 920 }, candidates);
	assert.equal(portrait.candidate.layout.layoutId, "fig1");
	const landscape = chooseImageLayout({ width: 1800, height: 600 }, candidates);
	assert.equal(landscape.candidate.layout.layoutId, "fig3");
	assert.equal(chooseImageLayout(undefined, candidates), undefined);
	assert.equal(chooseImageLayout({ width: 100, height: 100 }, []), undefined);
});

/** 夹具 slotSpec（合成模板，不入库真实模板）。 */
function fixtureSlotSpec() {
	return deriveSlotSpec(summarizeManifest(literatureManifest()), { minFontPt: 20 });
}

/** 写一张合成图片并返回路径。 */
async function writeImage(dir, name, width, height) {
	const path = join(dir, name);
	await writeFile(path, pngHeader(width, height));
	return path;
}

test("compilePlan：按图片比例在 figure 家族候选版式里自动换版式（面积明显更大才换）", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-layout-"));
	try {
		const portrait = await writeImage(dir, "portrait.png", 800, 850);
		const landscape = await writeImage(dir, "landscape.png", 1800, 600);
		const slotSpec = fixtureSlotSpec();
		// 本模板族的图片角色是逐图独立的（figure-1 / figure-2 / figure-3），逐页换版式 = 逐页换角色。
		// 注意：figure-1 的图注是**必填**（家族约定 requireFor [1,2,4]），而 figure-3 根本没有图注槽；
		// 所以"带图注的页"不会被自动换成 figure-3（换版式不能悄悄丢掉已给内容），
		// 只有没给图注的页才允许换 —— 这正是保守的可回退行为。
		const tallPlan = { slides: [{ role: "figure-1", slots: { figure: portrait, analysis: "一段图文解读。", caption: "Fig.1 xxx" } }] };
		const widePlan = { slides: [{ role: "figure-1", slots: { figure: landscape, analysis: "一段图文解读。" } }] };

		const tall = compilePlan({ plan: tallPlan, slotSpec });
		assert.equal(tall.summary.errors, 0, JSON.stringify(tall.diagnostics.slice(0, 3)));
		assert.equal(tall.compiled.slides[0].role, "figure-1", "竖长图本来就该在 Fig1，无需换");
		assert.equal(tall.compiled.roles["figure-1"], "Fig1");
		const selected = tall.diagnostics.filter((row) => row.code === "figure-layout-selected");
		assert.ok(selected.length >= 1, "选择结果要落成诊断");
		assert.ok(selected.some((row) => (row.location?.candidates ?? []).length >= 2), "诊断要带候选对比");

		const wide = compilePlan({ plan: widePlan, slotSpec });
		assert.equal(wide.summary.errors, 0, JSON.stringify(wide.diagnostics.slice(0, 3)));
		assert.equal(wide.compiled.slides[0].role, "figure-3", "宽幅图应换到宽幅版式 Fig3");
		assert.equal(wide.compiled.slides[0].requestedRole, "figure-1", "原角色要留痕");
		assert.equal(wide.compiled.roles["figure-3"], "Fig3", "家族里每个角色都可解析");
		const switched = wide.diagnostics.filter((row) => row.code === "figure-layout-selected" && row.location?.layoutSwitch !== undefined);
		assert.equal(switched.length, 1);
		assert.match(switched[0].message, /从 fig1 换成 fig3/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("compilePlan：plan.roles 显式钉住时尊重作者，比例不匹配则报 figure-layout-mismatch", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-layout-pin-"));
	try {
		const portrait = await writeImage(dir, "portrait.png", 800, 920);
		const slotSpec = fixtureSlotSpec();
		// 作者把 figure-1 钉在宽幅 Fig3 上，却给了一张竖长图 —— 这正是 Fig3 版式放竖长图的病例。
		const result = compilePlan({
			plan: {
				roles: { "figure-1": "Fig3" },
				slides: [{ role: "figure-1", slots: { figure: portrait, analysis: "一段图文解读。" } }]
			},
			slotSpec
		});
		assert.equal(result.compiled.roles["figure-1"], "Fig3", "显式映射优先，不被评分覆盖");
		assert.equal(result.compiled.slides[0].role, "figure-1", "钉住时不自动换角色");
		const mismatch = result.diagnostics.filter((row) => row.code === "figure-layout-mismatch");
		assert.equal(mismatch.length, 1);
		const location = mismatch[0].location;
		assert.equal(location.layoutId, "fig3");
		assert.equal(location.recommendedLayoutId, "fig1", "推荐换成竖长图更合适的版式");
		assert.equal(location.recommendedRole, "figure-1");
		assert.ok(location.displayWidthIn < MIN_READABLE_FIGURE_WIDTH_IN);
		assert.ok(location.candidates.length >= 2, "候选对比要进诊断");
		assert.match(mismatch[0].message, /解除 plan\.roles/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("compilePlan：换版式会引入**未声明的必填槽**时不换（不能把合法计划变成 required-slot-missing）", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-layout-guard-"));
	try {
		// 横图 1400×900：夹具里 Fig1/Fig2 的 8×5.2 槽显示面积远大于 Fig3 的 12×4.4 槽。
		const landscape = await writeImage(dir, "landscape.png", 1400, 900);
		const result = compilePlan({
			// figure-3 版式**没有图注槽**，所以这一页只声明 figure + analysis 本身是合法的。
			plan: { slides: [{ role: "figure-3", slots: { figure: landscape, analysis: "一段图文解读。" } }] },
			slotSpec: fixtureSlotSpec()
		});
		// 回归点：若守卫只检查"声明的键 ⊆ 目标版式的键"，本页会被换成 Fig1，
		// 而 Fig1 的 `caption` 是必填槽 → 编译直接报 required-slot-missing（把合法计划变成错误）。
		assert.equal(result.summary.errors, 0, JSON.stringify(result.diagnostics.filter((row) => row.severity === "error")));
		assert.equal(result.compiled.slides[0].role, "figure-3", "不换版式");
		assert.equal(result.compiled.slides[0].requestedRole, undefined);
		const mismatch = result.diagnostics.find((row) => row.code === "figure-layout-mismatch");
		assert.ok(mismatch, "要给出建议而不是静默");
		assert.equal(mismatch.location.recommendedLayoutId, "fig1", "Fig1 显示面积更大，仍要推荐");
		assert.equal(mismatch.location.blockedSwitch?.reason, "required-slot-undeclared");
		assert.deepEqual(mismatch.location.blockedSwitch?.missing, ["caption"]);
		assert.match(mismatch.message, /未自动换版式/);
		assert.match(mismatch.message, /caption/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("compilePlan：图片尺寸读不出来时只给 info，不阻断编译", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-layout-badimg-"));
	try {
		const bad = join(dir, "bad.png");
		await writeFile(bad, "definitely not a png");
		const result = compilePlan({
			plan: { slides: [{ role: "figure-3", slots: { figure: bad, analysis: "一段图文解读。" } }] },
			slotSpec: fixtureSlotSpec()
		});
		assert.equal(result.summary.errors, 0);
		assert.equal(result.compiled.slides[0].role, "figure-3", "无法评分时不换版式");
		const unreadable = result.diagnostics.filter((row) => row.code === "figure-size-unreadable");
		assert.equal(unreadable.length, 1);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
