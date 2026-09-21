/**
 * Linux 发布预检脚本的测试（路线书 0.3/5.1 的 Linux 对应物）。
 *
 * 只跑 --report-only 路径：它不触发 npm 闸门（那些由 Node 测试自身覆盖），因此快
 * 且稳定，但仍真实执行 git / bash -n / 必需路径 / 体积四段逻辑。
 *
 * 体积相关用例**一律用临时文件显式传 --tarball**，不依赖 dist/ 是否存在 ——
 * 否则在干净检出（CI 里测试先于构建运行）时断言会被静默跳过，等于没有守卫。
 * 这个坑是实测踩出来的：最初依赖 dist/ 存在，本地因先构建了归档才暴露浮点比较
 * 失败，而 CI 里根本不会执行到那条断言。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/linux-release-preflight.mjs");
const SIZE_BASELINE_BYTES = 51_291_488;

/** 造一个指定大小的临时归档文件，供体积用例显式注入。 */
function makeTarball(bytes) {
	const dir = mkdtempSync(join(tmpdir(), "ibm-preflight-"));
	const file = join(dir, "fake.tar.gz");
	writeFileSync(file, Buffer.alloc(bytes));
	return file;
}

/** 运行预检并解析 --json 输出。 */
function runPreflight(extraArgs = []) {
	const stdout = execFileSync(process.execPath, [script, "--report-only", "--json", "--allow-dirty", ...extraArgs], {
		cwd: repoRoot,
		encoding: "utf8",
		timeout: 120_000
	});
	return JSON.parse(stdout);
}

const sizeOf = (report) => report.checks.find((c) => c.name === "size-report");

test("report-only 输出结构化报告，且预检通过", () => {
	const report = runPreflight(["--tarball", makeTarball(1024)]);
	assert.equal(report.ok, true, `预检未通过：${JSON.stringify(report.checks.filter((c) => !c.ok))}`);
	assert.equal(report.reportOnly, true);

	const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
	for (const required of ["repo-state", "shell-syntax", "required-paths", "size-report"]) {
		assert.ok(byName[required], `报告缺少 ${required} 段`);
		assert.equal(byName[required].ok, true, `${required} 未通过：${byName[required].detail}`);
	}
	// --allow-dirty 只放宽脏工作区判定，不应让预检失败
	assert.match(byName["repo-state"].detail, /HEAD [0-9a-f]{12}/);
	// report-only 不跑 npm 闸门
	assert.equal(Object.keys(byName).some((name) => name.startsWith("gate:")), false);
});

test("体积报告给出基线、整数阈值与判定", () => {
	const report = runPreflight(["--tarball", makeTarball(1024)]);
	const size = sizeOf(report);
	assert.equal(size.skipped, undefined, "显式传 --tarball 时不应跳过");
	assert.equal(report.baseline.sizeBaselineBytes, SIZE_BASELINE_BYTES, "体积基线不得被悄悄改动");
	assert.ok(report.baseline.sizeWarnRatio > 1, "告警阈值必须宽于基线（Phase 0.3 只报警）");

	assert.equal(size.bytes, 1024);
	assert.equal(size.baselineBytes, SIZE_BASELINE_BYTES);
	// 阈值必须是整数（字节数不该带浮点余数）
	assert.equal(size.ceilingBytes, Math.round(SIZE_BASELINE_BYTES * report.baseline.sizeWarnRatio));
	assert.equal(Number.isInteger(size.ceilingBytes), true);
	assert.equal(size.warning, false, "1 KB 远低于阈值，不应告警");
	assert.equal(size.ok, true);
});

test("体积超标时告警但仍以 0 退出（只报警，不阻断）", () => {
	const report = runPreflight(["--tarball", makeTarball(2 * 1024 * 1024), "--size-ceiling-mb", "1"]);
	const size = sizeOf(report);
	assert.equal(size.ceilingBytes, 1024 * 1024);
	assert.equal(size.warning, true, "2 MB 相对 1 MB 阈值应判定超标");
	assert.equal(size.ok, true, "体积超标不得把 ok 置为 false");
	assert.equal(report.ok, true, "体积超标不得让预检失败（execFileSync 未抛错即为 0 退出码）");
	assert.match(size.detail, /超出阈值/);
	assert.equal(report.warnings.length, 1);
});

test("未找到归档时显式跳过，而不是静默失败", () => {
	const report = runPreflight(["--tarball", join(tmpdir(), "definitely-not-here.tar.gz")]);
	const size = sizeOf(report);
	assert.equal(size.skipped, true);
	assert.match(size.detail, /未找到归档/);
	assert.equal(report.ok, true);
});

test("必需路径清单覆盖 Phase 3 拆分后的新结构（防止清单被削短）", () => {
	const source = readFileSync(script, "utf8");
	const manifest = source.slice(source.indexOf("const REQUIRED_PATHS"), source.indexOf("const results"));
	for (const path of [
		"install.sh",
		"python/requirements.lock",
		"python/requirements-linux.lock",
		"vendor.lock.json",
		"vendor/nature-skills/skills",
		"presets/lab-research/agent.cordis.yml",
		"scripts/build-linux-release.sh",
		// Phase 3 拆分后的新结构
		"lib/tasks/index.js",
		"lib/capabilities.js",
		"lib/adapters/browser.js",
		"lib/applications/registry.js"
	]) {
		assert.ok(manifest.includes(path), `必需路径清单缺少 ${path}`);
	}
	// 清单里不应含明显不存在的路径（退化检查，防手滑拼错）
	assert.equal(manifest.includes('"python/requirements-lock-does-not-exist"'), false);
});
