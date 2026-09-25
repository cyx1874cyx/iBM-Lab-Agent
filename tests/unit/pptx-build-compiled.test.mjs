/**
 * Unit: scripts/pptx/build_from_template.py 的 `--compiled` 入口。
 *
 * 标准流程只有一条（0.5.5-beta3 起取消向后兼容）：`plan.json` → `compile-ppt-plan.mjs`
 * → `compiled.json` → `build_from_template.py --compiled`。
 *
 * 只跑 `--check`（不需要 python-pptx）：验证
 *   * compiled.json 的 `kind` 校验（不是 compiled-plan 就明确报错）；
 *   * `--plan` 旧入口已移除（明确报错并给出迁移指引）、只给 `--compiled` 才通过；
 *   * 编译期诊断并入符合性报告（前缀 compiled_），error 使退出码为 1；
 *   * 版式按**版式名**解析（pptx-cli manifest 的 slug id 与 parse.json 的
 *     slideLayoutN 不是同一套 id 空间，这是两者之间的桥）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/pptx/build_from_template.py", import.meta.url));

const PARSE = {
	ok: true,
	page: { cx: 12192000, cy: 6858000, ratio: "16:9", type: "wide" },
	theme: { name: "fixture", colors: {}, fonts: {} },
	masters: [{ id: "slideMaster1", layouts: ["slideLayout1", "slideLayout2", "slideLayout3"] }],
	layouts: [
		{ id: "slideLayout1", name: "标题幻灯片", placeholders: [{ type: "body", idx: 10 }, { type: "body", idx: 11 }] },
		{ id: "slideLayout2", name: "Abs", placeholders: [{ type: "pic", idx: 10 }, { type: "body", idx: 15 }] },
		{ id: "slideLayout3", name: "Fig1", placeholders: [{ type: "pic", idx: 10 }, { type: "body", idx: 12 }, { type: "body", idx: 15 }] }
	],
	layoutCount: 3
};

const COMPILED = {
	kind: "compiled-plan",
	schemaVersion: 1,
	roles: { cover: "标题幻灯片", abstract: "Abs", "figure-1": "Fig1" },
	manifestLayoutIds: { cover: "item", abstract: "abs", "figure-1": "fig1" },
	requiredPages: ["cover"],
	maxPages: 10,
	slides: [
		{ index: 1, role: "cover", layoutId: "item", layoutName: "标题幻灯片", texts: [{ prompt: "论文中文标题", idx: 10, mode: "paragraph", align: "center", paragraphs: ["中文标题"] }], notes: "开场" },
		{ index: 2, role: "figure-1", layoutId: "fig1", layoutName: "Fig1", texts: [{ prompt: "Fig.1图注", idx: 12, mode: "paragraph", paragraphs: ["Fig.1 图注"] }], notes: "讲图" }
	],
	diagnostics: [
		{ severity: "warning", code: "capacity-exceeded", message: "槽位 analysis 约 22 行，超过容量 20 行", location: { slide: 2, slotKey: "analysis" } },
		{ severity: "error", code: "required-slot-missing", message: "第 2 页缺必填槽 analysis", location: { slide: 2 } },
		{ severity: "info", code: "note", message: "示例 info" }
	]
};

/** 造 fixture 目录（parse.json + compiled.json），返回路径。 */
function fixtures(t, { compiled = COMPILED } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pptx-compiled-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const template = join(dir, "source.pptx");
	const parsePath = join(dir, "parse.json");
	const compiledPath = join(dir, "compiled.json");
	writeFileSync(template, "not-a-real-pptx");
	writeFileSync(parsePath, JSON.stringify(PARSE));
	writeFileSync(compiledPath, JSON.stringify(compiled));
	return { dir, template, parsePath, compiledPath };
}

function run(files, extra) {
	return spawnSync("python3", [SCRIPT, "--template", files.template, "--parse", files.parsePath, "--check", ...extra], { encoding: "utf8" });
}

test("--compiled：诊断并入 finding（compiled_ 前缀），error 使退出码为 1", (t) => {
	const files = fixtures(t);
	const result = run(files, ["--compiled", files.compiledPath]);
	assert.equal(result.status, 1);
	const report = JSON.parse(result.stdout);
	assert.equal(report.planKind, "compiled");
	assert.equal(report.summary.slideCount, 2);
	assert.equal(report.ok, false);
	const compiledFindings = report.findings.filter((finding) => finding.code.startsWith("compiled_"));
	assert.deepEqual(compiledFindings.map((finding) => [finding.level, finding.code]), [
		["warning", "compiled_capacity-exceeded"],
		["error", "compiled_required-slot-missing"],
		["pass", "compiled_note"],
		["pass", "compiled_plan"]
	]);
	// 位置信息被拼进 message，便于不看 payload 也能定位
	assert.match(compiledFindings[1].message, /slide=2/);
});

test("--compiled：角色按版式名解析（不报 unknown_role_layout）", (t) => {
	const files = fixtures(t);
	const result = run(files, ["--compiled", files.compiledPath]);
	const report = JSON.parse(result.stdout);
	assert.equal(report.findings.some((finding) => finding.code === "unknown_role_layout"), false);
	const byName = report.findings.filter((finding) => finding.code === "role_layout_by_name");
	assert.equal(byName.length, 2);
	assert.deepEqual(report.slides.map((slide) => slide.layoutId), ["slideLayout1", "slideLayout3"]);
	assert.deepEqual(report.slides.map((slide) => slide.layoutName), ["标题幻灯片", "Fig1"]);
});

test("--compiled：clean compiled plan（无诊断）→ ok=true 退出码 0", (t) => {
	const files = fixtures(t, { compiled: { ...COMPILED, diagnostics: [] } });
	const result = run(files, ["--compiled", files.compiledPath]);
	assert.equal(result.status, 0);
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, true);
	assert.equal(report.summary.errors, 0);
});

test("--compiled：kind 不对时明确报错（退出码 2，不是 JSON error 但无 traceback）", (t) => {
	const files = fixtures(t, { compiled: { kind: "plan", slides: [] } });
	const result = run(files, ["--compiled", files.compiledPath]);
	assert.equal(result.status, 2);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, false);
	assert.match(payload.error, /not a compiled plan/);
	assert.match(payload.error, /compile-ppt-plan\.mjs/);
});

test("--plan 旧入口已移除；不给 --compiled 时报必填（退出码 2）", (t) => {
	const files = fixtures(t);
	// 旧入口：单独给 --plan 就会被明确拒绝（它绕过编译期门禁）
	const legacy = run(files, ["--plan", join(files.dir, "plan.json")]);
	assert.equal(legacy.status, 2);
	assert.match(JSON.parse(legacy.stdout).error, /--plan 旧路径已移除/);

	// 与 --compiled 一起给也不行：旧入口先被拒绝，不会静默挑一个用
	const both = run(files, ["--plan", join(files.dir, "plan.json"), "--compiled", files.compiledPath]);
	assert.equal(both.status, 2);
	assert.match(JSON.parse(both.stdout).error, /--plan 旧路径已移除/);

	// 什么都不给：提示 --compiled 是必需的
	const neither = run(files, []);
	assert.equal(neither.status, 2);
	assert.match(JSON.parse(neither.stdout).error, /--compiled is required/);
});

test("手写 plan 直接构建被拒：报错给出「先编译再 --compiled」的迁移指引", (t) => {
	const files = fixtures(t);
	const planPath = join(files.dir, "plan.json");
	writeFileSync(planPath, JSON.stringify({
		roles: { cover: "slideLayout1" },
		requiredPages: ["cover"],
		slides: [{ role: "cover", title: "标题", bullets: [], notes: "n" }]
	}));
	const result = spawnSync("python3", [SCRIPT, "--template", files.template, "--parse", files.parsePath, "--plan", planPath, "--check"], { encoding: "utf8" });
	assert.equal(result.status, 2, "旧路径不得再产出报告（不静默降级）");
	assert.doesNotMatch(result.stderr, /Traceback/);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, false);
	assert.match(payload.error, /--plan 旧路径已移除/);
	// 指引必须能照着做：编译命令 + 模板目录 + --compiled
	assert.match(payload.error, /compile-ppt-plan\.mjs/);
	assert.match(payload.error, /--compiled/);
	// 手写计划里的 title/bullets 也不再是合法内容来源
	const source = readFileSync(SCRIPT, "utf8");
	assert.doesNotMatch(source, /item\.get\("bullets"\)/);
	assert.doesNotMatch(source, /item\.get\("imageCaption"\)/);
});

test("--check 不写成品文件（compiled 路径同样不写）", (t) => {
	const files = fixtures(t);
	const out = join(files.dir, "deck.pptx");
	run(files, ["--compiled", files.compiledPath, "--out", out]);
	assert.equal(existsSync(out), false);
});
