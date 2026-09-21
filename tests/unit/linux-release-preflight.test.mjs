/**
 * Linux 发布预检脚本的测试（路线书 0.3/5.1 的 Linux 对应物）。
 *
 * 只跑 --report-only 路径：它不触发 npm 闸门（那些已由 Node 测试自身覆盖），
 * 因此快且稳定，但仍真实执行 git / bash -n / 必需路径 / 体积四段逻辑。
 * 同时用源码级断言守住必需路径清单本身，避免清单被悄悄削短。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/linux-release-preflight.mjs");

/** 运行预检并解析 --json 输出。 */
function runPreflight(extraArgs = []) {
	const stdout = execFileSync(process.execPath, [script, "--report-only", "--json", "--allow-dirty", ...extraArgs], {
		cwd: repoRoot,
		encoding: "utf8",
		timeout: 120_000
	});
	return JSON.parse(stdout);
}

test("report-only 输出结构化报告，且预检通过", () => {
	const report = runPreflight();
	assert.equal(report.ok, true, `预检未通过：${JSON.stringify(report.checks.filter((c) => !c.ok))}`);
	assert.equal(report.reportOnly, true);

	const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
	for (const required of ["repo-state", "shell-syntax", "required-paths", "size-report"]) {
		assert.ok(byName[required], `报告缺少 ${required} 段`);
		assert.equal(byName[required].ok, true, `${required} 未通过：${byName[required].detail}`);
	}
	// --allow-dirty 只影响 repo-state 的判定，不应让脏工作区被判为失败
	assert.match(byName["repo-state"].detail, /HEAD [0-9a-f]{12}/);
	// report-only 不跑 npm 闸门
	assert.equal(Object.keys(byName).some((name) => name.startsWith("gate:")), false);
});

test("体积报告给出基线、阈值与告警判定", () => {
	const report = runPreflight();
	const size = report.checks.find((c) => c.name === "size-report");
	assert.equal(report.baseline.sizeBaselineBytes, 51_291_488, "体积基线不得被悄悄改动");
	assert.ok(report.baseline.sizeWarnRatio > 1, "告警阈值必须宽于基线（Phase 0.3 只报警）");
	if (size.skipped) {
		// 未构建归档时跳过是允许的，但必须显式说明而不是静默
		assert.match(size.detail, /未找到归档/);
		return;
	}
	assert.equal(typeof size.bytes, "number");
	assert.equal(typeof size.warning, "boolean");
	assert.equal(size.baselineBytes, report.baseline.sizeBaselineBytes);
	assert.equal(size.ceilingBytes, Math.round(51_291_488 * report.baseline.sizeWarnRatio));
	// 体积超标只告警：ok 恒为 true，退出码不受影响
	assert.equal(size.ok, true);
});

test("体积超标时给出告警但仍以 0 退出（只报警，不阻断）", () => {
	const report = runPreflight(["--size-ceiling-mb", "1"]);
	const size = report.checks.find((c) => c.name === "size-report");
	if (size.skipped) return;
	assert.equal(size.warning, true, "阈值压到 1 MB 后应判定超标");
	assert.equal(size.ok, true, "体积超标不得把 ok 置为 false");
	assert.equal(report.ok, true, "体积超标不得让预检失败");
	assert.equal(size.ceilingBytes, 1024 * 1024);
	assert.match(size.detail, /超出阈值/);
});

test("必需路径清单覆盖 Phase 3 拆分后的新结构（防止清单被削短）", () => {
	const source = readFileSync(script, "utf8");
	const manifest = source.slice(source.indexOf("const REQUIRED_PATHS"), source.indexOf("const results"));
	for (const path of [
		"install.sh",
		"python/requirements-lock-does-not-exist",
		"lib/tasks/index.js",
		"lib/capabilities.js",
		"lib/adapters/browser.js",
		"lib/applications/registry.js",
		"vendor/nature-skills/skills",
		"presets/lab-research/agent.cordis.yml",
		"scripts/build-linux-release.sh"
	]) {
		if (path === "python/requirements-lock-does-not-exist") {
			assert.equal(manifest.includes(path), false, "清单不应包含不存在的路径");
			continue;
		}
		assert.ok(manifest.includes(path), `必需路径清单缺少 ${path}`);
	}
});
