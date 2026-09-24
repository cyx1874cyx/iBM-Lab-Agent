/**
 * Unit: build_from_template.py 的图片 contain 几何（fit_contain）与几何策略。
 *
 * 背景（0.5.4 真实试用）：`Placeholder.insert_picture()` 只把图片塞进占位符 —— 既不写
 * `a:xfrm`，还会用 `a:srcRect` 把图片**裁**成占位符比例（实测 600x690 的竖长图放进
 * 12.85x4.78in 的占位符，上下各裁 33.8%），且两个渲染器对同一份 srcRect 处理不一致
 * （试用时竖长图被 LibreOffice 撑到 9.9in 高，幻灯片只有 7.5in）。所以 contain 必须
 * 自己算几何并显式写 width/height + 居中。
 *
 * fit_contain 是纯函数（只用标准库），所以这些断言在 CI 里真跑，不需要 python-pptx。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/pptx/build_from_template.py", import.meta.url));

/** Fig3 的图片占位符（EMU）：12.85in x 4.78in —— 宽幅槽，竖长图最容易出问题。 */
const WIDE_BOX = [11748706, 4368641];
/** Fig1 的图片占位符：9.14in x 6.00in。 */
const TALL_BOX = [8359788, 5486400];

/** 用 python3 直接加载脚本模块并批量求值 fit_contain（脚本有 __main__ 守卫，import 无副作用）。 */
function fitContain(cases) {
	const code = [
		"import importlib.util, json, sys",
		`spec = importlib.util.spec_from_file_location("bft", ${JSON.stringify(SCRIPT)})`,
		"mod = importlib.util.module_from_spec(spec)",
		"spec.loader.exec_module(mod)",
		"print(json.dumps([mod.fit_contain(*c) for c in json.loads(sys.argv[1])]))"
	].join("\n");
	const result = spawnSync("python3", ["-c", code, JSON.stringify(cases)], { encoding: "utf8" });
	assert.equal(result.status, 0, `fit_contain 求值失败：${result.stderr}`);
	return JSON.parse(result.stdout);
}

/** 断言一次 contain 结果：严格落在盒内、比例不变、居中。 */
function assertContained(fit, sourceWidth, sourceHeight, box) {
	const [boxWidth, boxHeight] = box;
	assert.ok(fit !== null, "fit_contain 不得返回 null");
	assert.ok(fit.width > 0 && fit.height > 0, "尺寸必须为正");
	assert.ok(fit.width <= boxWidth, `宽度必须落在占位符内：${fit.width} > ${boxWidth}`);
	assert.ok(fit.height <= boxHeight, `高度必须落在占位符内：${fit.height} > ${boxHeight}`);
	const sourceRatio = sourceWidth / sourceHeight;
	const fitRatio = fit.width / fit.height;
	assert.ok(Math.abs(fitRatio - sourceRatio) < 1e-3, `比例必须与源图一致：${fitRatio} vs ${sourceRatio}`);
	// 至少有一个方向贴满（contain 的定义），另一个方向不超过
	assert.ok(fit.width === boxWidth || fit.height === boxHeight, "至少一个方向必须贴满占位符");
	assert.equal(fit.left, Math.floor((boxWidth - fit.width) / 2), "必须水平居中");
	assert.equal(fit.top, Math.floor((boxHeight - fit.height) / 2), "必须垂直居中");
}

test("contain：竖长图（600x690）在宽幅槽里按高度贴合并水平居中", () => {
	const [fit] = fitContain([[600, 690, ...WIDE_BOX]]);
	assertContained(fit, 600, 690, WIDE_BOX);
	assert.equal(fit.height, WIDE_BOX[1], "受限于高度时高度应正好等于占位符高度");
	assert.ok(fit.left > 0, "宽幅槽里的竖长图必须居中留出左右空白");
});

test("contain：横图（1400x900）在宽幅槽里受高度限制，不会横向溢出", () => {
	// 1400x900 的比例 1.556 比占位符 2.689 更"高"，所以贴满高度、左右留白
	const [fit] = fitContain([[1400, 900, ...WIDE_BOX]]);
	assertContained(fit, 1400, 900, WIDE_BOX);
	assert.equal(fit.height, WIDE_BOX[1]);
	assert.ok(fit.width < WIDE_BOX[0]);
});

test("contain：超宽图（2700x900）在宽幅槽里贴满宽度", () => {
	// 比例 3.0 > 占位符 2.689，此时才轮到宽度成为限制方向
	const [fit] = fitContain([[2700, 900, ...WIDE_BOX]]);
	assertContained(fit, 2700, 900, WIDE_BOX);
	assert.equal(fit.width, WIDE_BOX[0], "宽图应先贴满宽度");
});

test("contain：比例与占位符完全一致时正好铺满且不裁切", () => {
	const [fit] = fitContain([[1400, 520, 1400 * 2, 520 * 2]]);
	assert.equal(fit.width, 2800);
	assert.equal(fit.height, 1040);
	assert.equal(fit.left, 0);
	assert.equal(fit.top, 0);
});

test("contain：极端竖长图（600x1400）也不越界", () => {
	const [wide, tall] = fitContain([[600, 1400, ...WIDE_BOX], [600, 1400, ...TALL_BOX]]);
	assertContained(wide, 600, 1400, WIDE_BOX);
	assertContained(tall, 600, 1400, TALL_BOX);
});

test("contain：非法尺寸返回 null（由调用方保持原样并记 warning）", () => {
	const [zeroSource, zeroBox, negative] = fitContain([[0, 690, ...WIDE_BOX], [600, 690, 0, 0], [-1, 690, ...WIDE_BOX]]);
	assert.equal(zeroSource, null);
	assert.equal(zeroBox, null);
	assert.equal(negative, null);
});

test("图片几何策略：contain 显式写几何并清裁切；cover 语义不被 contain 顶替", () => {
	const source = readFileSync(SCRIPT, "utf8");
	assert.match(source, /def fit_contain\(/, "应有可单测的纯函数 fit_contain");
	assert.match(source, /def apply_contain_fit\(/, "应有 contain 落地实现（写几何 + 居中）");
	// 不清 crop 的话，insert_picture 留下的 a:srcRect 会把完整图片继续裁掉一部分
	assert.match(source, /picture\.crop_left = picture\.crop_right = picture\.crop_top = picture\.crop_bottom = 0/,
		"contain 必须清空 crop（否则图仍被裁）");
	// 几何必须在 insert_picture 之前读：insert_picture 会清掉占位符的 spPr/xfrm，
	// 之后再读 target.width/target.left 会抛 AttributeError（0.5.4 的 cover 分支正是因此静默失效）
	const boxAt = source.indexOf("box = placeholder_box(target)");
	const insertAt = source.indexOf("picture = target.insert_picture(image)");
	assert.ok(boxAt > 0, "应显式读取占位符几何");
	assert.ok(insertAt > boxAt, "占位符几何必须在 insert_picture 之前读取");
	// contain 只能作为非 cover 的路径，否则会把 cover 的填充裁切语义改成 letterbox
	assert.match(source, /elif box is not None:/, "contain 兜底必须与 cover 分支互斥");
	assert.match(source, /if crop_mode != "cover":/, "cover 的既有降级不应再报 geometry_unresolved");
});
