/**
 * Integration（可跳过）：真实 pptx-cli 的封装链路。
 *
 * CI 环境**不装 pptx-cli**，所以整文件默认 skip；在有 pptx-cli 的机器上（开发机、
 * `IBM_LAB_PPTX_CLI_PYTHON` 指定的解释器）跑真实 init/doctor/validate 与错误映射。
 * 真实模板路径用 `IBM_LAB_PPT_TEMPLATE` 指定（仓库不提交含校徽/logo 的模板）。
 *
 * 用法：
 *   IBM_LAB_PPTX_CLI_PYTHON=/tmp/pcvenv/bin/python \
 *   IBM_LAB_PPT_TEMPLATE=/path/to/template.pptx \
 *   node --test tests/integration/pptx-cli-manifest.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	doctorReport,
	initTemplateManifest,
	isManifestPackage,
	loadManifestPackage,
	probePptxCli,
	summarizeManifest,
	validateDeck
} from "../../lib/pptx-manifest.js";
import { deriveSlotSpec } from "../../src/ppt-slot-spec.js";
import { lintTemplatePackage } from "../../lib/ppt-template-lint.js";

/** 找一个装了 pptx-cli 的解释器；找不到返回 undefined。 */
function findCliPython() {
	const candidates = [process.env.IBM_LAB_PPTX_CLI_PYTHON, "/tmp/pcvenv/bin/python", "python3", "python"].filter(Boolean);
	for (const candidate of candidates) {
		const probe = spawnSync(candidate, ["-c", "import pptx_cli"], { encoding: "utf8" });
		if (probe.status === 0) return candidate;
	}
	return undefined;
}

const cliPython = findCliPython();
const templatePath = process.env.IBM_LAB_PPT_TEMPLATE;
const skipAll = cliPython === undefined ? "本机没有安装 pptx-cli（CI 预期如此）" : false;

test("probePptxCli：真实解释器上报告 available + 版本号", { skip: skipAll }, async () => {
	const probe = await probePptxCli({ python: cliPython });
	assert.equal(probe.available, true);
	assert.match(probe.version, /^\d+\.\d+\.\d+/);
});

test("validate：deck 不存在时把退出码 50 + ERR_IO_NOT_FOUND 映射成我们的错误对象", { skip: skipAll }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "pptx-cli-real-"));
	try {
		// manifest 目录不存在 → 同样是明确的 IO 错误，不能静默成功
		const result = await validateDeck({ manifestDir: dir, deckPath: join(dir, "nope.pptx"), python: cliPython });
		assert.equal(result.available, true);
		assert.equal(result.ok, false);
		assert.equal(result.failure, "io");
		assert.equal(result.errors[0].kind, "io");
		assert.match(result.errors[0].hint, /路径不存在/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("init → manifest 包 → 槽位规范 → 体检（需要 IBM_LAB_PPT_TEMPLATE）", {
	skip: skipAll || (templatePath ? false : "未设置 IBM_LAB_PPT_TEMPLATE（仓库不提交含 logo 的模板）")
}, async (t) => {
	assert.equal(existsSync(templatePath), true, `模板不存在：${templatePath}`);
	const dir = mkdtempSync(join(tmpdir(), "pptx-cli-init-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const init = await initTemplateManifest({ pptxPath: templatePath, outDir: dir, python: cliPython });
	assert.equal(init.ok, true, init.error);
	assert.equal(isManifestPackage(dir), true);

	const pkg = await loadManifestPackage(dir);
	assert.equal(pkg.ok, true);
	const summary = summarizeManifest(pkg.manifest);
	assert.ok(summary.layouts.length >= 1);
	assert.ok(summary.layouts.every((layout) => Array.isArray(layout.placeholders)));

	// 提示文字被抽成 guidance_text —— 这是我们「提示文字优先定位」的基础
	const withGuidance = summary.layouts.flatMap((layout) => layout.placeholders).filter((placeholder) => placeholder.guidanceText);
	assert.ok(withGuidance.length > 0, "manifest 必须带 guidance_text");

	const spec = deriveSlotSpec(summary, { minFontPt: 20 });
	assert.ok(Object.keys(spec.roles).length >= 1, "至少识别出一个角色");

	const doctor = await doctorReport({ manifestDir: dir, python: cliPython });
	assert.equal(doctor.ok, true);
	assert.equal(typeof doctor.envelope.result.status, "string");

	// 真跑一次 lint（含 doctor findings 并入）
	const report = await lintTemplatePackage({ manifestDir: dir, template: { id: "real", version: "1", pptxCliVersion: doctor.pythonSource }, cli: { python: cliPython } });
	assert.equal(typeof report.ok, "boolean");
	assert.ok(report.findings.length >= 1);
	assert.equal(report.template.manifestSource, "manifest");
});

test("模板服务导入：manifest + slots.json + GUIDE.md + lint.json 全部落盘（需要真实模板）", {
	skip: skipAll || (templatePath ? false : "未设置 IBM_LAB_PPT_TEMPLATE")
}, async (t) => {
	const { mkdtemp, mkdir, readFile } = await import("node:fs/promises");
	const { bootLite } = await import("../helpers/boot-lite.mjs");
	const dir = await mkdtemp(join(tmpdir(), "pptx-cli-service-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const templatesDir = join(dir, "templates");
	await mkdir(templatesDir, { recursive: true });
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			// 显式注入 pptx-cli 解释器：生产上走 bundled/venv，测试里指到装了 pptx-cli 的那个
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir, pptxCliPython: cliPython } }
		]
	});
	try {
		const templates = handle.ctx.labTemplates;
		const imported = await templates.importPptx("lab-real-template", { pptxPath: templatePath, meta: { name: "真实模板" } });
		assert.equal(imported.manifestSource, "manifest");
		assert.equal(imported.manifest.lint !== undefined, true);

		const versionDir = join(templatesDir, "lab-real-template", "v1");
		const slotsRaw = await readFile(join(versionDir, "slots.json"), "utf8");
		const slots = JSON.parse(slotsRaw);
		assert.equal(slots.schemaVersion, 1);
		assert.ok(Object.keys(slots.roles).length >= 1);
		assert.ok(Object.values(slots.roles).every((layoutId) => typeof layoutId === "string"));

		const guide = await readFile(join(versionDir, "GUIDE.md"), "utf8");
		assert.match(guide, /# 模板填充指南/);
		assert.match(guide, /排版政策/);

		const lint = JSON.parse(await readFile(join(versionDir, "lint.json"), "utf8"));
		assert.equal(lint.template.manifestSource, "manifest");
		assert.equal(typeof lint.summary.blocking, "number");

		// 服务侧只读接口
		assert.equal((await templates.slotSpec("lab-real-template", "1")).schemaVersion, 1);
		assert.equal((await templates.lintReport("lab-real-template", "1")).schemaVersion, 1);
		assert.match(await templates.guide("lab-real-template", "1"), /三步走/);
		const relinted = await templates.relint("lab-real-template", "1");
		assert.equal(relinted.manifestSource, "manifest");

		// validate 会把 lint 的「必须修」并进 problems，并标出来源
		const validation = await templates.validate("lab-real-template", "1");
		assert.equal(validation.manifestSource, "manifest");
		assert.ok(validation.problems.every((problem) => typeof problem === "string"));
	} finally {
		await handle.dispose?.();
	}
});
