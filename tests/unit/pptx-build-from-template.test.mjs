/**
 * Unit: scripts/pptx/build_from_template.py —— 模板化构建脚本的 --check 契约。
 *
 * 覆盖：合法计划通过（模板 pass finding + 版式解析）；未映射角色 / 缺失必选页 /
 * 超页 / 缺备注的 error 与退出码 1；finding 形状；python-pptx 缺失时构建模式
 * 退出码 2 且 JSON error 提到 python-pptx；坏 JSON / 缺文件的退出码 2 且无 traceback。
 * 真实构建（python-pptx）不在本机跑（环境未安装，符合预期）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/pptx/build_from_template.py", import.meta.url));
const FINDING_LEVELS = new Set(["error", "warning", "pass"]);

const LAYOUTS = [
	{ id: "slideLayout1", name: "Title Slide", placeholders: [{ type: "title" }, { type: "subtitle" }] },
	{ id: "slideLayout2", name: "Title and Content", placeholders: [{ type: "title" }, { type: "body" }] },
	{ id: "slideLayout3", name: "Blank", placeholders: [] }
];

function parseFixture(overrides = {}) {
	return {
		ok: true,
		page: { cx: 12192000, cy: 6858000, ratio: "16:9", type: "wide" },
		theme: { name: "lab-test", colors: { accent1: "#1F4E79" }, fonts: { major: "SimSun", minor: "SimSun" } },
		masters: [{ id: "slideMaster1", layouts: LAYOUTS.map((layout) => layout.id) }],
		layouts: LAYOUTS,
		layoutCount: LAYOUTS.length,
		...overrides
	};
}

function validPlan(overrides = {}) {
	return {
		roles: { cover: "slideLayout1", summary: "slideLayout2" },
		requiredPages: ["cover", "summary"],
		maxPages: 20,
		notesRequired: true,
		slides: [
			{ role: "cover", title: "标题", subtitle: "副标题", bullets: [], notes: "开场讲稿" },
			{ role: "summary", title: "总结", bullets: ["要点一", "要点二"], notes: "总结讲稿" }
		],
		...overrides
	};
}

/** 在 os.tmpdir() 下造一份 fixture 目录，测试结束自动清理。 */
function writeFixtures(t, { plan, parse, templateBytes = "not-a-real-pptx" } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pptx-build-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const files = {
		dir,
		template: join(dir, "source.pptx"),
		parsePath: join(dir, "parse.json"),
		planPath: join(dir, "plan.json"),
		report: join(dir, "conformance.json"),
		out: join(dir, "deck.pptx")
	};
	writeFileSync(files.template, templateBytes);
	writeFileSync(files.parsePath, JSON.stringify(parse ?? parseFixture()));
	writeFileSync(files.planPath, typeof plan === "string" ? plan : JSON.stringify(plan ?? validPlan()));
	return files;
}

function runCheck(files, extra = []) {
	return spawnSync("python3", [SCRIPT, "--template", files.template, "--parse", files.parsePath, "--plan", files.planPath, "--check", ...extra], { encoding: "utf8" });
}

function checkReport(result) {
	assert.doesNotMatch(result.stderr, /Traceback/, "check 模式不得抛 Python traceback");
	return JSON.parse(result.stdout);
}

function assertFindingShape(findings) {
	assert.ok(findings.length > 0, "findings 不得为空");
	for (const finding of findings) {
		assert.ok(FINDING_LEVELS.has(finding.level), `finding.level 非法：${finding.level}`);
		assert.equal(typeof finding.code, "string");
		assert.ok(finding.code.length > 0, "finding.code 不得为空字符串");
		assert.equal(typeof finding.message, "string");
		assert.ok(finding.message.length > 0, "finding.message 不得为空字符串");
	}
}

test("--check passes for a valid plan and resolves each role to its layout", (t) => {
	const files = writeFixtures(t);
	const result = runCheck(files, ["--max-pages", "20", "--required", "cover,summary", "--notes-required", "true", "--report", files.report]);
	assert.equal(result.status, 0, result.stderr);
	const report = checkReport(result);
	assert.equal(report.ok, true);
	assert.equal(report.mode, "check");
	assert.equal(report.summary.slideCount, 2);
	assert.equal(report.summary.errors, 0);
	assert.equal(report.template.ratio, "16:9");
	assert.equal(report.template.layoutCount, 3);
	assert.ok(report.findings.some((finding) => finding.level === "pass" && finding.code === "template_applied"));
	assert.deepEqual(report.slides.map((slide) => slide.role), ["cover", "summary"]);
	assert.deepEqual(report.slides.map((slide) => slide.layoutId), ["slideLayout1", "slideLayout2"]);
	assert.equal(report.slides[1].layoutName, "Title and Content");
	assert.equal(report.slides[1].bulletCount, 2);
	assert.ok(report.slides[1].notesChars > 0);
	assert.deepEqual(JSON.parse(readFileSync(files.report, "utf8")), report, "--report 必须与 stdout 一致");
	assert.equal(existsSync(files.out), false, "--check 不得写 --out");
});

test("--check fails for an unmapped role and falls back to the previous layout", (t) => {
	const plan = validPlan({ roles: { cover: "slideLayout1" }, requiredPages: [] });
	const files = writeFixtures(t, { plan });
	const result = runCheck(files);
	assert.equal(result.status, 1);
	const report = checkReport(result);
	assert.equal(report.ok, false);
	assert.ok(report.findings.some((finding) => finding.level === "error" && finding.code === "role_unmapped"));
	assert.equal(report.slides[1].layoutId, "slideLayout1", "未映射的非 cover 角色回退到上一页版式");
});

test("--check falls back to the title layout for an unmapped cover", (t) => {
	const plan = validPlan({ roles: {}, requiredPages: [], notesRequired: false, slides: [
		{ role: "cover", title: "封面", bullets: [], notes: "" },
		{ role: "summary", title: "总结", bullets: [], notes: "" }
	] });
	const files = writeFixtures(t, { plan });
	const result = runCheck(files);
	assert.equal(result.status, 1);
	const report = checkReport(result);
	assert.equal(report.slides[0].layoutId, "slideLayout1", "未映射 cover 回退到 title 版式");
	assert.equal(report.slides[1].layoutId, "slideLayout1", "后续未映射页回退到上一页版式");
});

test("--check flags a role mapped to an unknown layout", (t) => {
	const plan = validPlan({ roles: { cover: "slideLayout9", summary: "slideLayout2" }, requiredPages: [] });
	const files = writeFixtures(t, { plan });
	const result = runCheck(files);
	assert.equal(result.status, 1);
	const report = checkReport(result);
	assert.ok(report.findings.some((finding) => finding.level === "error" && finding.code === "unknown_role_layout"));
	assert.equal(report.slides[0].layoutId, "slideLayout1", "未知映射同样回退");
});

test("--check fails for a missing required page and too many pages", (t) => {
	const plan = validPlan({ requiredPages: ["cover", "appendix"], maxPages: 1, notesRequired: false, slides: [
		{ role: "cover", title: "封面", bullets: [], notes: "" },
		{ role: "summary", title: "总结", bullets: [], notes: "" }
	] });
	const files = writeFixtures(t, { plan });
	const result = runCheck(files);
	assert.equal(result.status, 1);
	const report = checkReport(result);
	assert.equal(report.ok, false);
	assert.ok(report.findings.some((finding) => finding.level === "error" && finding.code === "missing_required_page"));
	assert.ok(report.findings.some((finding) => finding.level === "error" && finding.code === "too_many_pages"));
	assert.equal(report.summary.errors >= 2, true);
});

test("--check fails when notes are required but a slide has none", (t) => {
	const plan = validPlan({ slides: [
		{ role: "cover", title: "封面", bullets: [], notes: "有备注" },
		{ role: "summary", title: "总结", bullets: [], notes: "" }
	] });
	const files = writeFixtures(t, { plan });
	const result = runCheck(files, ["--notes-required", "true"]);
	assert.equal(result.status, 1);
	const report = checkReport(result);
	assert.ok(report.findings.some((finding) => finding.level === "error" && finding.code === "missing_notes"));
	assert.equal(report.slides[1].notesChars, 0);
});

test("--check warns (but does not fail) on a page ratio mismatch", (t) => {
	const files = writeFixtures(t);
	const result = runCheck(files, ["--ratio", "4:3"]);
	assert.equal(result.status, 0, result.stderr);
	const report = checkReport(result);
	assert.equal(report.ok, true);
	assert.ok(report.findings.some((finding) => finding.level === "warning" && finding.code === "page_ratio_mismatch"));
	assert.equal(report.summary.warnings >= 1, true);
});

test("every finding is well formed for both passing and failing plans", (t) => {
	const passReport = checkReport(runCheck(writeFixtures(t), ["--max-pages", "5"]));
	assertFindingShape(passReport.findings);
	const failingPlan = validPlan({ roles: {}, requiredPages: ["appendix"], maxPages: 1, notesRequired: true, slides: [
		{ role: "cover", title: "封面", bullets: [], notes: "" }
	] });
	const failReport = checkReport(runCheck(writeFixtures(t, { plan: failingPlan })));
	assert.ok(failReport.findings.some((finding) => finding.level === "error"));
	assertFindingShape(failReport.findings);
});

test("定点写入契约：--check 接受 texts（按 idx 写多段）并保持 finding 形状", (t) => {
	// 模板2 的封面没有 title 占位符（4 个 body/10..13），总结页有 3 个 body；
	// 只按"第一个 body"写会把标题写错位置。texts 是这类模板的唯一正确入口。
	const files = writeFixtures(t, {
		plan: validPlan({
			roles: { cover: "slideLayout1", summary: "slideLayout2" },
			slides: [
				{
					role: "cover",
					texts: [
						{ idx: 10, paragraphs: ["论文中文标题"], sizePt: 32 },
						{ idx: 11, paragraphs: ["English Paper Title"], sizePt: 24 },
						{ idx: 12, paragraphs: ["讲解人：张三"], sizePt: 20 }
					],
					notes: "开场"
				},
				{
					role: "summary",
					texts: [
						{ idx: 11, paragraphs: ["第一段总结"], mode: "paragraph" },
						{ idx: 12, paragraphs: ["创新点一", "创新点二"], mode: "bullets" }
					],
					notes: "总结"
				}
			]
		})
	});
	const result = runCheck(files);
	assert.equal(result.status, 0, result.stderr);
	const report = checkReport(result);
	assert.equal(report.ok, true);
	assertFindingShape(report.findings);
});

test("构建脚本保留定点写入/去项目符号/字体统一/删除模板自带页的实现", () => {
	const source = readFileSync(SCRIPT, "utf8");
	// 静态元素在版式上时，模板自带的示例页必须删掉，否则会原样留在成品里
	assert.match(source, /def drop_template_slides\(/, "应删除模板自带幻灯片");
	assert.match(source, /keepTemplateSlides/, "应允许显式保留（在模板页上续写的场景）");
	// 按 idx 定点写入 + 形状名兜底
	assert.match(source, /def placeholder_by_idx\(/, "应按 idx 定位占位符");
	assert.match(source, /def write_into_placeholder\(/, "应有定点写入入口");
	// 自然段模式：去掉项目符号
	assert.match(source, /def strip_bullet\(/, "应有去项目符号实现");
	assert.match(source, /a:buNone/, "应写入 buNone");
	assert.match(source, /"a:buChar", "a:buAutoNum"/, "应删除 buChar/buAutoNum");
	// 字体：latin 用 python-pptx，ea/cs 手写并按 schema 顺序插在 latin 之后
	assert.match(source, /def set_typeface\(/, "应设置 a:ea/a:cs");
	assert.match(source, /latin\.addnext\(element\)/, "ea/cs 必须插在 a:latin 之后（schema 顺序）");
	assert.match(source, /font_ea = str\(fonts\.get\("ea"\) or plan\.get\("fontEa"\) or "微软雅黑"\)/, "默认东亚字体为微软雅黑");
	assert.match(source, /minFontPt/, "应有字号下限");
});

test("build mode without python-pptx exits 2 with a JSON error mentioning python-pptx", (t) => {
	const probe = spawnSync("python3", ["-c", "import pptx"], { encoding: "utf8" });
	if (probe.status === 0) {
		t.skip("python-pptx is importable on this machine; build path is exercised elsewhere");
		return;
	}
	const files = writeFixtures(t);
	const result = spawnSync("python3", [SCRIPT, "--template", files.template, "--parse", files.parsePath, "--plan", files.planPath, "--out", files.out], { encoding: "utf8" });
	assert.equal(result.status, 2, result.stderr);
	assert.doesNotMatch(result.stderr, /Traceback/);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, false);
	assert.match(payload.error, /python-pptx/);
	assert.equal(existsSync(files.out), false, "python-pptx 缺失时不得产出伪 deck");
});

test("bad plan JSON exits 2 with a JSON error and no traceback", (t) => {
	const files = writeFixtures(t, { plan: "{ this is not json" });
	const result = runCheck(files);
	assert.equal(result.status, 2);
	assert.doesNotMatch(result.stderr, /Traceback/);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, false);
	assert.equal(typeof payload.error, "string");
	assert.match(payload.error, /plan\.json/);
});

test("missing input files exit 2 with a JSON error and no traceback", (t) => {
	const noTemplate = writeFixtures(t);
	rmSync(noTemplate.template);
	const missingTemplate = runCheck(noTemplate);
	assert.equal(missingTemplate.status, 2);
	assert.doesNotMatch(missingTemplate.stderr, /Traceback/);
	assert.equal(JSON.parse(missingTemplate.stdout).ok, false);

	const noParse = writeFixtures(t);
	rmSync(noParse.parsePath);
	const missingParse = runCheck(noParse);
	assert.equal(missingParse.status, 2);
	assert.doesNotMatch(missingParse.stderr, /Traceback/);
	assert.match(JSON.parse(missingParse.stdout).error, /parse\.json/);
});

test("an empty plan or bad slide role exits 2 without a traceback", (t) => {
	const emptyPlan = runCheck(writeFixtures(t, { plan: { roles: {}, slides: [] } }));
	assert.equal(emptyPlan.status, 2);
	assert.doesNotMatch(emptyPlan.stderr, /Traceback/);
	assert.equal(JSON.parse(emptyPlan.stdout).ok, false);

	const badRole = runCheck(writeFixtures(t, { plan: { roles: {}, slides: [{ title: "无角色" }] } }));
	assert.equal(badRole.status, 2);
	assert.doesNotMatch(badRole.stderr, /Traceback/);
	assert.equal(JSON.parse(badRole.stdout).ok, false);
});
