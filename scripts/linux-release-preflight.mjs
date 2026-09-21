#!/usr/bin/env node
/**
 * dsh-lab-agent: Linux 发布预检 / 体积门禁。
 *
 * 这是路线书 Phase 0.3 与 5.1 在 Linux 线上的对应物。Windows 线有
 * desktop/scripts/build-windows-release.ps1（345 行、12 个 phase、失败关闭的预检），
 * 而 Linux 的 scripts/build-linux-release.sh 只有 24 行（git archive + sha256），
 * **零门禁**：谁都可以提交一个 30 MB 的二进制或删掉一棵必需目录，而没有任何东西会响。
 *
 * 本脚本补上双向断言（与 src/python-env.js 的「捆绑 Python 是隔离边界，not merely
 * a preference」同一哲学）：
 *   - 上限：归档体积超过基线 110% 时**告警**（Phase 0.3 先只报警，不阻断）；
 *   - 下限：必需路径、19 个 nature skill、vendor.lock.json 的登记条目必须仍在。
 *
 * 用法：
 *   node scripts/linux-release-preflight.mjs                 # 全量：预检 + 闸门 + 体积
 *   node scripts/linux-release-preflight.mjs --report-only    # 只做必需项 + 体积（CI 构建后）
 *   node scripts/linux-release-preflight.mjs --json
 *   node scripts/linux-release-preflight.mjs --tarball dist/xxx.tar.gz
 *   node scripts/linux-release-preflight.mjs --allow-dirty
 *
 * 退出码：任何**非体积**检查失败即 1；体积超标只告警，仍为 0（Phase 5.1 再转强制）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const flagValue = (name, fallback) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const asJson = hasFlag("--json");
const reportOnly = hasFlag("--report-only");
const allowDirty = hasFlag("--allow-dirty");

/**
 * 归档体积基线。测量方式：
 *   bash scripts/build-linux-release.sh HEAD     # 读的是 git archive HEAD，故须先提交
 * 历史：
 *   51,291,488 B (48.9 MiB)  release-0.5.0 + Phase 3 拆分后
 *   23,122,955 B (22.1 MiB)  vendor 白名单剔除 32.2 MB 后（figures4papers + 顶层 assets，−54.9%）
 * 作为**告警**阈值：超过基线的 110% 就提醒，不阻断（路线书 0.3）。
 */
const SIZE_BASELINE_BYTES = 23_122_955;
const SIZE_WARN_RATIO = 1.1;

/** 必需路径（下限断言）。删掉任何一项都应该让发布预检红，而不是等到用户装完才发现。 */
const REQUIRED_PATHS = [
	"install.sh",
	"bin/ibm-lab-agent",
	"cordis.patch.yml",
	"package.json",
	"client/index.js",
	"python/requirements.lock",
	"python/requirements-linux.lock",
	"presets/lab-research/agent.cordis.yml",
	"presets/lab-research/preset.yml",
	"runtime/versions.env",
	"runtime/apt-packages.txt",
	"runtime/launcher/package.json",
	"runtime/launcher/pnpm-lock.yaml",
	"vendor.lock.json",
	"harness.lock.json",
	"vendor/nature-skills/skills",
	"vendor/nature-skills/README.md",
	"docs/LINUX_RELEASE.md",
	"scripts/build-linux-release.sh",
	"scripts/install.mjs",
	"scripts/lab-doctor.mjs",
	// Phase 3 拆分后的新结构：这几条一旦被误删，插件会在运行期才炸。
	"lib/tasks/index.js",
	"lib/capabilities.js",
	"lib/adapters/browser.js",
	"lib/applications/registry.js"
];

const results = [];
function record(name, ok, detail) {
	results.push({ name, ok, detail });
	return ok;
}

function run(cmd, args, options = {}) {
	return spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", ...options });
}

// ── phase: repo-state ───────────────────────────────────────────────────────
function checkRepoState() {
	const head = run("git", ["rev-parse", "--verify", "HEAD"]);
	if (head.status !== 0) {
		return record("repo-state", false, "git HEAD 无法解析");
	}
	const status = run("git", ["status", "--porcelain"]);
	if (status.status !== 0) {
		return record("repo-state", false, "git status 失败");
	}
	const dirty = status.stdout.trim();
	if (dirty && !allowDirty) {
		return record("repo-state", false, `工作区不干净（发布要求干净；如需跳过用 --allow-dirty）：\n${dirty}`);
	}
	return record("repo-state", true, `HEAD ${head.stdout.trim().slice(0, 12)}${dirty ? "（工作区脏，已允许）" : " 工作区干净"}`);
}

// ── phase: shell-syntax ─────────────────────────────────────────────────────
function checkShellSyntax() {
	const files = ["install.sh", "bin/ibm-lab-agent", "runtime/install-ubuntu.sh", "scripts/build-linux-release.sh"];
	const broken = [];
	for (const file of files) {
		const r = run("bash", ["-n", file]);
		if (r.status !== 0) broken.push(`${file}: ${(r.stderr || "").trim()}`);
	}
	return record("shell-syntax", broken.length === 0, broken.length ? broken.join("; ") : `bash -n 通过（${files.length} 个入口）`);
}

// ── phase: required-paths（下限断言）────────────────────────────────────────
function checkRequiredPaths() {
	const missing = REQUIRED_PATHS.filter((rel) => !existsSync(join(repoRoot, rel)));
	const notes = [];

	// nature skill 数量必须与 vendor.lock.json 登记一致（锁定版本纪律）。
	let skillCount = 0;
	const skillsDir = join(repoRoot, "vendor/nature-skills/skills");
	if (existsSync(skillsDir)) {
		skillCount = readdirSync(skillsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md"))).length;
	}
	let lockedCount = null;
	try {
		const lock = JSON.parse(readFileSync(join(repoRoot, "vendor.lock.json"), "utf8"));
		lockedCount = lock.skills ? Object.keys(lock.skills).length : null;
	} catch (error) {
		notes.push(`vendor.lock.json 解析失败：${error.message}`);
	}
	const skillMismatch = lockedCount !== null && skillCount !== lockedCount;
	if (skillMismatch) notes.push(`nature skill 数量与 vendor.lock.json 不一致：目录 ${skillCount} vs 登记 ${lockedCount}`);

	const ok = missing.length === 0 && notes.length === 0;
	const detail = ok
		? `${REQUIRED_PATHS.length} 个必需路径齐备；nature skill ${skillCount} 个与锁文件一致`
		: [
			missing.length ? `缺失必需路径：${missing.join(", ")}` : "",
			...notes
		].filter(Boolean).join("；");
	return record("required-paths", ok, detail);
}

// ── gates（路线书的五道闸门）───────────────────────────────────────────────
const GATES = [
	["client-consistency", ["run", "check:client", "--silent"]],
	["tests", ["run", "test", "--silent"]],
	["regression", ["run", "regression", "--silent"]],
	["preset-exports", ["run", "check:preset-exports", "--silent"]],
	["lint", ["run", "lint", "--silent"]]
];

function checkGates() {
	for (const [name, args] of GATES) {
		const r = run("npm", args, { maxBuffer: 64 * 1024 * 1024 });
		if (r.status === 0) {
			record(`gate:${name}`, true, "退出码 0");
			continue;
		}
		const tail = `${r.stdout || ""}\n${r.stderr || ""}`.trim().split("\n").slice(-8).join("\n");
		record(`gate:${name}`, false, `退出码 ${r.status}\n${tail}`);
	}
}

// ── phase: size-report（上限，只告警）──────────────────────────────────────
function checkSize() {
	let tarball = flagValue("--tarball", null);
	if (!tarball) {
		const distDir = join(repoRoot, "dist");
		if (existsSync(distDir)) {
			const candidate = readdirSync(distDir).filter((n) => n.endsWith(".tar.gz")).sort().pop();
			if (candidate) tarball = join(distDir, candidate);
		}
	}
	if (!tarball || !existsSync(tarball)) {
		return { name: "size-report", ok: true, skipped: true, detail: "未找到归档（跳过；用 --tarball 指定，或先跑 scripts/build-linux-release.sh）" };
	}
	const bytes = statSync(tarball).size;
	// 字节数取整：阈值是可断言的整数，避免浮点余数泄进 JSON 与比较。
	const ceiling = Math.round(
		Number(flagValue("--size-ceiling-mb", "0")) > 0
			? Number(flagValue("--size-ceiling-mb")) * 1024 * 1024
			: SIZE_BASELINE_BYTES * SIZE_WARN_RATIO
	);
	const mb = (n) => (n / 1024 / 1024).toFixed(1);
	const over = bytes > ceiling;
	const entry = {
		name: "size-report",
		ok: true, // 体积超标只告警，不影响退出码（路线书 0.3）
		warning: over,
		detail: `归档 ${mb(bytes)} MB（基线 ${mb(SIZE_BASELINE_BYTES)} MB，告警阈值 ${mb(ceiling)} MB）` +
			(over ? ` —— 超出阈值 ${mb(bytes - ceiling)} MB` : " —— 在阈值内"),
		tarball,
		bytes,
		baselineBytes: SIZE_BASELINE_BYTES,
		ceilingBytes: ceiling
	};
	if (over) {
		entry.detail += "\n  提示：大体积来源通常是 client/assets/ketcher-standalone、vendor 内的素材树与 README 配图；" +
			"确认是必要产物还是误提交。";
	}
	return entry;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
checkRepoState();
checkShellSyntax();
const sizeResult = checkSize();
checkRequiredPaths();
if (!reportOnly) checkGates();

const failed = results.filter((r) => !r.ok);
const warnings = [sizeResult, ...results].filter((r) => r && r.warning);

if (asJson) {
	console.log(JSON.stringify({
		reportOnly,
		ok: failed.length === 0,
		baseline: { sizeBaselineBytes: SIZE_BASELINE_BYTES, sizeWarnRatio: SIZE_WARN_RATIO },
		checks: [...results, sizeResult],
		warnings: warnings.map((w) => w.detail)
	}, null, 2));
} else {
	console.log("=== Linux 发布预检 ===");
	for (const r of results) {
		console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(22)} ${r.detail}`);
	}
	console.log(`  ${sizeResult.warning ? "!" : "✓"} ${sizeResult.name.padEnd(22)} ${sizeResult.detail}`);
	if (warnings.length) {
		console.log("");
		console.log("--- 告警（不阻断）---");
		for (const w of warnings) console.log(`  ! ${w.name}: ${w.detail.split("\n")[0]}`);
	}
	console.log("");
	if (failed.length) {
		console.log(`预检失败：${failed.length} 项未通过（${failed.map((f) => f.name).join(", ")}）`);
	} else {
		console.log(reportOnly ? "报告完成：必需项与体积检查通过。" : "预检通过：闸门全绿。");
	}
}

process.exit(failed.length ? 1 : 0);
