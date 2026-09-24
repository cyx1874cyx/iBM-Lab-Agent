/**
 * Unit: lib/ppt-template-lint.js —— 六类规则的表驱动验证。
 *
 * 全部跑在合成 manifest 夹具上（无 pptx-cli 依赖）：`runCliChecks:false` 关掉 doctor，
 * XML 级规则（a:ea / 项目符号）跑在夹具自带的合成 source-template.pptx 上。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	describeManifestChange,
	humanSummary,
	lintTemplatePackage,
	readSlotSpec,
	writeLintReport
} from "../../lib/ppt-template-lint.js";
import { literatureManifest, writeManifestPackage } from "../fixtures/ppt-manifest-fixture.mjs";

const LINT_CLI = fileURLToPath(new URL("../../scripts/lint-ppt-template.mjs", import.meta.url));

/** 造一个临时 manifest 包目录（测试结束清理）。 */
async function fixture(t, { manifest = literatureManifest(), skipSourceTemplate = false } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "ppt-lint-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	await writeManifestPackage(dir, { manifest, skipSourceTemplate });
	return dir;
}

const codes = (report) => report.findings.map((finding) => finding.code);

test("① 静态层一致性：逐版式一致时无告警；把 fig2 的 logo 挪动 → error", async (t) => {
	const clean = await fixture(t, { manifest: literatureManifest({ driftFig2StaticLayer: false }) });
	const report = await lintTemplatePackage({ manifestDir: clean, template: { id: "f", version: "1" }, runCliChecks: false });
	assert.equal(codes(report).includes("static-layer-inconsistent"), false, "一致时不应报漂移");
	assert.equal(report.ok, true);

	const drifted = await fixture(t, { manifest: literatureManifest({ driftFig2StaticLayer: true }) });
	const driftedReport = await lintTemplatePackage({ manifestDir: drifted, template: { id: "f", version: "1" }, runCliChecks: false });
	const drift = driftedReport.findings.filter((finding) => finding.code === "static-layer-inconsistent");
	assert.ok(drift.length >= 1, "应当报静态层漂移");
	assert.equal(drift[0].compensated, false, "静态层漂移构建器兜不住 → 必须修");
	assert.equal(driftedReport.ok, false);
});

test("① 静态层指纹：与基线对比时，几何/指纹变化 → static-layer-drift", async (t) => {
	const baseline = await fixture(t, { manifest: literatureManifest({ driftFig2StaticLayer: false }) });
	const mutated = literatureManifest({ driftFig2StaticLayer: false });
	const fig1 = mutated.layouts.find((layout) => layout.id === "fig1");
	fig1.protected_static_elements[0].fingerprint = "sha256:line-changed";
	fig1.protected_static_elements[1].left_emu = 1;
	const current = await fixture(t, { manifest: mutated });
	const report = await lintTemplatePackage({ manifestDir: current, baselineManifestDir: baseline, template: { id: "f", version: "2" }, runCliChecks: false });
	const drift = report.findings.filter((finding) => finding.code === "static-layer-drift");
	assert.equal(drift.length, 2, "一处指纹变化 + 一处几何变化");
	assert.equal(report.destructiveChanges.staticLayer.comparedProtectedElements > 0, true);
	assert.equal(report.ok, false);
});

test("② 槽位提示文字：改名 → warning；缺必填槽 → error（对照期望角色）", async (t) => {
	const manifest = literatureManifest({ driftFig2StaticLayer: false });
	const fig1 = manifest.layouts.find((layout) => layout.id === "fig1");
	fig1.placeholders = fig1.placeholders.map((placeholder) => (placeholder.placeholder_idx === 12 ? { ...placeholder, guidance_text: "图1说明", guidance_lines: ["图1说明"] } : placeholder));
	const renamed = await fixture(t, { manifest });
	const renamedReport = await lintTemplatePackage({ manifestDir: renamed, template: { id: "f", version: "1" }, runCliChecks: false });
	const renameFinding = renamedReport.findings.find((finding) => finding.code === "slot-prompt-renamed");
	assert.ok(renameFinding, "改名应被识别为 slot-prompt-renamed");
	assert.equal(renameFinding.severity, "warning");
	assert.equal(renameFinding.compensated, false);
	assert.equal(renameFinding.location.slotKey, "caption");

	const dropped = literatureManifest({ driftFig2StaticLayer: false });
	const droppedFig1 = dropped.layouts.find((layout) => layout.id === "fig1");
	droppedFig1.placeholders = droppedFig1.placeholders.filter((placeholder) => placeholder.placeholder_idx !== 12);
	const droppedReport = await lintTemplatePackage({ manifestDir: await fixture(t, { manifest: dropped }), template: { id: "f", version: "1" }, runCliChecks: false });
	const missing = droppedReport.findings.find((finding) => finding.code === "required-slot-missing");
	assert.ok(missing, "删掉图注槽应报 required-slot-missing");
	assert.equal(missing.severity, "error");
	assert.equal(missing.compensated, false);
	assert.equal(droppedReport.ok, false);
});

test("② 角色识别不出 → layout-role-unknown（error，不静默跳过）", async (t) => {
	const manifest = literatureManifest({ driftFig2StaticLayer: false });
	manifest.layouts = manifest.layouts.map((layout) => (layout.id === "fig3"
		? { ...layout, placeholders: layout.placeholders.map((placeholder) => ({ ...placeholder, guidance_text: "没写提示", guidance_lines: ["没写提示"] })) }
		: layout));
	const report = await lintTemplatePackage({ manifestDir: await fixture(t, { manifest }), template: { id: "f", version: "1" }, runCliChecks: false });
	assert.ok(codes(report).includes("layout-role-unknown"));
	assert.equal(report.ok, false);
});

test("③ 字号：14pt 图注 → error 但 compensated；无字号 → font-size-unresolved", async (t) => {
	const report = await lintTemplatePackage({ manifestDir: await fixture(t), template: { id: "f", version: "1" }, runCliChecks: false });
	const low = report.findings.filter((finding) => finding.code === "font-size-below-floor");
	assert.equal(low.length, 2, "fig1/fig2 的图注都是 14pt");
	assert.deepEqual(low.map((finding) => finding.location.slotKey), ["caption", "caption"]);
	assert.equal(low[0].severity, "error");
	assert.equal(low[0].compensated, true, "构建器会把写入 run 抬到下限 → 不阻断");

	const manifest = literatureManifest({ driftFig2StaticLayer: false });
	const abs = manifest.layouts.find((layout) => layout.id === "abs");
	const body = abs.placeholders.find((placeholder) => placeholder.placeholder_idx === 15);
	body.estimated_text_capacity = { ...body.estimated_text_capacity, font_size_pt: null };
	delete body.text_defaults.guidance_text;
	const unresolved = await lintTemplatePackage({ manifestDir: await fixture(t, { manifest }), template: { id: "f", version: "1" }, runCliChecks: false });
	assert.ok(codes(unresolved).includes("font-size-unresolved"));
});

test("④ 中文字体槽：静态中文缺 a:ea → warning（compensated）；缺源模板 → 明确 unchecked", async (t) => {
	const report = await lintTemplatePackage({ manifestDir: await fixture(t), template: { id: "f", version: "1" }, runCliChecks: false });
	const cjk = report.findings.filter((finding) => finding.code === "cjk-typeface-missing");
	assert.equal(cjk.length, 7, "每个版式一条静态中文");
	assert.equal(cjk.every((finding) => finding.severity === "warning" && finding.compensated === true), true);
	assert.match(cjk[0].message, /a:ea/);

	const noSource = await fixture(t, { skipSourceTemplate: true });
	const unchecked = await lintTemplatePackage({ manifestDir: noSource, template: { id: "f", version: "1" }, runCliChecks: false });
	assert.ok(codes(unchecked).includes("cjk-typeface-unchecked"), "缺源模板必须显式说检查不可用");
	assert.ok(codes(unchecked).includes("template-bullet-unchecked"));
	assert.equal(unchecked.findings.filter((finding) => finding.code === "cjk-typeface-missing").length, 0);
});

test("⑤ 项目符号：图注占位符没有 buNone 且母版 bodyStyle 带 buChar → template-bullet-leak", async (t) => {
	const report = await lintTemplatePackage({ manifestDir: await fixture(t), template: { id: "f", version: "1" }, runCliChecks: false });
	const leaks = report.findings.filter((finding) => finding.code === "template-bullet-leak");
	assert.deepEqual(leaks.map((finding) => finding.location.layoutId), ["fig1", "fig2"]);
	assert.equal(leaks[0].location.idx, 12);
	assert.equal(leaks[0].compensated, true);
});

test("报告结构稳定 + 人类摘要 + lint.json 可写", async (t) => {
	const dir = await fixture(t);
	const report = await lintTemplatePackage({ manifestDir: dir, template: { id: "f", version: "1" }, runCliChecks: false });
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.template.manifestSource, "manifest");
	assert.equal(typeof report.summary.error, "number");
	assert.equal(typeof report.summary.blocking, "number");
	assert.equal(typeof report.summary.compensatedErrors, "number");
	for (const finding of report.findings) {
		assert.equal(typeof finding.code, "string");
		assert.ok(["error", "warning", "info"].includes(finding.severity));
		assert.equal(typeof finding.message, "string");
		assert.equal(typeof finding.location, "object");
		assert.equal(typeof finding.compensated, "boolean");
	}
	assert.match(humanSummary(report), /体检/);
	const path = await writeLintReport(dir, report);
	const saved = JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path)},'utf8'))`], { encoding: "utf8" }));
	assert.equal(saved.schemaVersion, 1);
});

test("readSlotSpec：损坏/缺失返回 undefined，不抛", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ppt-lint-slots-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	assert.equal(await readSlotSpec(join(dir, "nope.json")), undefined);
});

test("基线 slots.json：槽位提示文字改变/槽位消失都能识别", async (t) => {
	const manifest = literatureManifest({ driftFig2StaticLayer: false });
	const current = await fixture(t, { manifest });
	const baselineSlotSpec = {
		schemaVersion: 1,
		layouts: [
			{ layoutId: "fig1", role: "figure-1", slots: [{ key: "caption", prompt: "Fig.1图注（旧文案）", required: true }] },
			{ layoutId: "fig9", role: "figure-9", slots: [{ key: "figure", prompt: "Fig9图占位", required: true }] }
		]
	};
	const report = await lintTemplatePackage({ manifestDir: current, baselineSlotSpec, template: { id: "f", version: "2" }, runCliChecks: false });
	assert.ok(codes(report).includes("slot-prompt-renamed-vs-baseline"));
	assert.ok(codes(report).includes("slot-key-removed"));
});

test("describeManifestChange：已知类型中文描述，未知类型 JSON 兜底", () => {
	assert.match(describeManifestChange({ type: "layout.removed", layout_id: "fig4" }), /版式 fig4 被删除/);
	assert.match(describeManifestChange({ type: "unknown.thing", x: 1 }), /unknown\.thing/);
});

test("CLI：lint-ppt-template.mjs 对夹具目录给出 ok/退出码，并写出 lint.json", async (t) => {
	const dir = await fixture(t, { manifest: literatureManifest({ driftFig2StaticLayer: false }) });
	const output = execFileSync(process.execPath, [LINT_CLI, dir, "--no-cli", "--json", "--fail-on", "error"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const report = JSON.parse(output);
	assert.equal(report.template.manifestSource, "manifest");
	assert.equal(report.ok, true, "夹具里的 error 全部被构建器兜住 → 门控通过");

	// 破坏静态层后：CLI 退出码 1（有必须修的 error）
	const broken = await fixture(t, { manifest: literatureManifest({ driftFig2StaticLayer: true }) });
	let code = 0;
	let payload;
	try {
		execFileSync(process.execPath, [LINT_CLI, broken, "--no-cli", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		code = error.status;
		payload = JSON.parse(error.stdout);
	}
	assert.equal(code, 1);
	assert.equal(payload.ok, false);
	assert.ok(payload.summary.blocking >= 1);
});

test("CLI：--fail-on none 时即使有必须修的 error 也返回 0；路径不存在返回 2", async (t) => {
	const broken = await fixture(t, { manifest: literatureManifest({ driftFig2StaticLayer: true }) });
	const output = execFileSync(process.execPath, [LINT_CLI, broken, "--no-cli", "--json", "--fail-on", "none"], { encoding: "utf8" });
	assert.equal(JSON.parse(output).ok, false);
	let missing = 0;
	try {
		execFileSync(process.execPath, [LINT_CLI, "/no/such/template", "--no-cli"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		missing = error.status;
	}
	assert.equal(missing, 2);
});
