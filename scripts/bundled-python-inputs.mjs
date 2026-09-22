#!/usr/bin/env node
/**
 * bundled-python 的输入指纹（路线书 §0.1，P0）。
 *
 * 问题：`build-windows-release.ps1` 原先只用 `Test-Path python.exe` 判断捆绑 Python
 * 是否需要重建 —— **一次生成，永久跳过**。改了 recipe（或 requirements.lock）也不会
 * 重建，安装包会静默继续带旧产物。对照组里 plugin/dsh/node 三个资源都有正确的增量
 * 缓存，唯独 python 没有。
 *
 * 做法：把"决定 dist 内容的输入"算成一个指纹，写进产物旁的 `.build-stamp.json`；
 * 出包时比对，不一致（或缺失/损坏）就重建。方向是保守的：**判定不通过只会多重建，
 * 不会漏重建**。
 *
 * 为什么是 Node 而不是在 PowerShell 里算两遍：两个 .ps1 各写一份必然漂移，而
 * `python/requirements.lock` 的 LF 归一化哈希项目里**已有** `src/python-lock-hash.js`。
 * 单一实现还带来一个好处：这套判定能在 Linux 上直接跑单元测试（见
 * tests/unit/bundled-python-inputs.test.mjs），不必等一次 20 分钟的 Windows 出包。
 *
 * 用法（由 PowerShell 调用）：
 *   node scripts/bundled-python-inputs.mjs --check <stampDir> [--python-exe <exe>]
 *   node scripts/bundled-python-inputs.mjs --write <stampDir> [--python-exe <exe>]
 *   node scripts/bundled-python-inputs.mjs --print
 *
 * `--check` 始终以退出码 0 输出一行 JSON `{current, reason, changed}`；只有内部错误
 * 才非零退出（调用方据此走"重建"分支）。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { pythonLockSha256 } from "../src/python-lock-hash.js";

/**
 * 指纹文件的固定名字。
 *
 * 刻意**不**写在 `resources/python/dist/` 里：`tauri.conf.json` 的 `bundle.resources`
 * 把 `resources/python/` 整目录打进安装包，放在那里会把构建元数据一起出货。改放
 * `desktop/.build/`（`/.build/` 已被 gitignore）。两个失效方向都是安全的：
 * dist 在而指纹被清掉 → 缺指纹 → 重建；指纹在而 dist 被删 → python.exe 存在性检查
 * 兜住 → 重建。
 */
export const STAMP_NAME = "bundled-python.stamp.json";

/** 指纹方案版本：规则本身变了就 +1，使所有旧产物自动判为过期。 */
export const STAMP_VERSION = 1;

/** 单文件输入：任一变化都意味着 dist 需要重建。 */
export const INPUT_FILES = [
	// 基础依赖集合（pandas/openpyxl/pdfminer.six 等 markitdown 格式依赖都在这里）
	"python/requirements.lock",
	// recipe 本体：markitdown 固定版本清单、剥离策略、收尾自检
	"desktop/scripts/build-bundled-python.ps1",
	// magika 可选化补丁：锚点 + 目标文件 sha256 + 替换文本
	"src/markitdown-patch.js",
	// 应用补丁的 CLI（参数契约变了也要重建）
	"scripts/patch-markitdown.mjs",
	// 版本 pin（python/node/tauri 等）
	"runtime/versions.env",
];

/** 目录输入：mnova-mcp 是从 vendor 源码本地打 wheel 装进 dist 的。 */
export const INPUT_TREES = ["vendor/mnova-mcp"];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * 内容摘要：文本（无 NUL 字节）做 BOM 剥离 + CRLF→LF 归一，二进制按原始字节。
 *
 * 指纹应当标识"内容"，而不是检出时的行尾转换：否则同一份代码在 Windows（CRLF）与
 * WSL（LF）会得出不同指纹，或因为一次 core.autocrlf 变更就整树重建。
 */
export function digestFile(absPath) {
	const raw = readFileSync(absPath);
	if (raw.includes(0)) return `bin:${sha256(raw)}`;
	const text = raw.toString("utf8").replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
	return `txt:${sha256(Buffer.from(text, "utf8"))}`;
}

/** 目录摘要：按相对路径排序后逐个摘要，路径与内容一起参与，增删改名都会变。 */
export function digestTree(absDir) {
	const hash = createHash("sha256");
	const walk = (dir) => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			const rel = relative(absDir, abs).split(sep).join("/");
			if (entry.isDirectory()) {
				walk(abs);
			} else if (entry.isFile()) {
				hash.update(`${rel}\0${digestFile(abs)}\n`);
			}
		}
	};
	walk(absDir);
	return hash.digest("hex");
}

/**
 * 计算当前输入指纹。
 * @param {string} repoRoot 仓库根
 * @returns {{ fingerprint: string, files: Record<string,string>, trees: Record<string,string>, missing: string[] }}
 */
export function computeInputs(repoRoot) {
	const files = {};
	const trees = {};
	const missing = [];

	for (const rel of INPUT_FILES) {
		const abs = join(repoRoot, rel);
		if (!existsSync(abs)) {
			missing.push(rel);
			continue;
		}
		// requirements.lock 走项目既有的 LF 归一化工具，保持与 vendor.lock 一致
		files[rel] =
			rel === "python/requirements.lock"
				? `lock:${pythonLockSha256(readFileSync(abs))}`
				: digestFile(abs);
	}
	for (const rel of INPUT_TREES) {
		const abs = join(repoRoot, rel);
		if (!existsSync(abs)) {
			missing.push(rel);
			continue;
		}
		trees[rel] = digestTree(abs);
	}

	// 指纹 = 规范化 JSON 的摘要；missing 也参与，避免"输入缺失"被当成"内容相同"
	const canonical = JSON.stringify({ version: STAMP_VERSION, files, trees, missing });
	return { fingerprint: sha256(Buffer.from(canonical, "utf8")), files, trees, missing };
}

/** 读出被捆绑解释器的版本，仅作溯源与"基础解释器升级"的过期线索。 */
function readPythonVersion(pythonExe) {
	if (!pythonExe || !existsSync(pythonExe)) return null;
	try {
		return execFileSync(pythonExe, ["-c", "import sys;print(sys.version.split()[0])"], {
			encoding: "utf8",
			timeout: 60_000,
		}).trim();
	} catch {
		return null;
	}
}

/**
 * 解析解释器版本：显式注入优先，否则去真正执行解释器。
 *
 * 注入这条路径是刻意的 —— 单元测试必须能在 Windows 上跑，而"造一个 #!/bin/sh 假
 * python"在 Windows 上根本执行不了（曾因此在 Windows 的 tests 阶段失败、阻断出包）。
 * 依赖注入让这条轴的测试与平台无关，也不必真的启动进程。
 */
function resolvePythonVersion({ pythonVersion, pythonExe }) {
	if (pythonVersion !== undefined) return pythonVersion;
	return readPythonVersion(pythonExe);
}

/**
 * 写入指纹文件。
 * @returns {{ stampPath: string, fingerprint: string, pythonVersion: string|null }}
 */
export function writeStamp(repoRoot, stampDir, { pythonExe = null, pythonVersion, now = () => new Date() } = {}) {
	const { fingerprint, files, trees, missing } = computeInputs(repoRoot);
	const version = resolvePythonVersion({ pythonVersion, pythonExe });
	const stamp = {
		stampVersion: STAMP_VERSION,
		fingerprint,
		files,
		trees,
		missing,
		pythonVersion: version,
		builtAt: now().toISOString(),
	};
	const stampPath = join(stampDir, STAMP_NAME);
	writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
	return { stampPath, fingerprint, pythonVersion: version };
}

/**
 * 比对指纹。
 * @returns {{ current: boolean, reason: string, changed: string[] }}
 */
export function checkStamp(repoRoot, stampDir, { pythonExe = null, pythonVersion } = {}) {
	const stampPath = join(stampDir, STAMP_NAME);
	if (!existsSync(stampPath)) {
		return { current: false, reason: "no stamp: 该产物早于指纹机制，无法证明它对应当前 recipe", changed: ["<stamp>"] };
	}

	let stamp;
	try {
		stamp = JSON.parse(readFileSync(stampPath, "utf8"));
	} catch (error) {
		return { current: false, reason: `stamp unreadable: ${error.message}`, changed: ["<stamp>"] };
	}
	if (stamp?.stampVersion !== STAMP_VERSION) {
		return {
			current: false,
			reason: `stamp scheme changed: ${stamp?.stampVersion} -> ${STAMP_VERSION}`,
			changed: ["<stampVersion>"],
		};
	}

	const { fingerprint, files, trees, missing } = computeInputs(repoRoot);
	if (missing.length > 0) {
		return { current: false, reason: `inputs missing: ${missing.join(", ")}`, changed: missing };
	}

	const changed = [];
	for (const [rel, digest] of Object.entries(files)) {
		if (stamp.files?.[rel] !== digest) changed.push(rel);
	}
	for (const [rel, digest] of Object.entries(trees)) {
		if (stamp.trees?.[rel] !== digest) changed.push(`${rel}/`);
	}
	for (const rel of Object.keys(stamp.files ?? {})) {
		if (!(rel in files)) changed.push(`removed:${rel}`);
	}
	for (const rel of Object.keys(stamp.trees ?? {})) {
		if (!(rel in trees)) changed.push(`removed:${rel}/`);
	}

	const pythonVersionNow = resolvePythonVersion({ pythonVersion, pythonExe });
	if (pythonVersionNow && stamp.pythonVersion && pythonVersionNow !== stamp.pythonVersion) {
		changed.push(`pythonVersion:${stamp.pythonVersion}->${pythonVersionNow}`);
	}

	if (changed.length > 0) {
		return { current: false, reason: `inputs changed: ${changed.join(", ")}`, changed };
	}
	if (stamp.fingerprint !== fingerprint) {
		return { current: false, reason: "fingerprint mismatch (未识别的差异)", changed: ["<fingerprint>"] };
	}
	return { current: true, reason: "fingerprint matches", changed: [] };
}

function parseArgs(argv) {
	const options = { command: null, stampDir: null, pythonExe: null };
	const [, , command, ...rest] = argv;
	options.command = command;
	for (let i = 0; i < rest.length; i += 1) {
		if (rest[i] === "--python-exe") options.pythonExe = rest[++i];
		else if (options.stampDir === null) options.stampDir = rest[i];
		else throw new Error(`unknown argument: ${rest[i]}`);
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv);
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

	if (options.command === "--print") {
		console.log(JSON.stringify(computeInputs(repoRoot), null, 2));
		return;
	}
	if (options.command === "--write") {
		if (!options.stampDir) throw new Error("--write 需要 <stampDir>");
		const result = writeStamp(repoRoot, options.stampDir, { pythonExe: options.pythonExe });
		console.log(JSON.stringify({ written: result.stampPath, fingerprint: result.fingerprint, pythonVersion: result.pythonVersion }));
		return;
	}
	if (options.command === "--check") {
		if (!options.stampDir) throw new Error("--check 需要 <stampDir>");
		const verdict = checkStamp(repoRoot, options.stampDir, { pythonExe: options.pythonExe });
		// 判定结果本身不是错误：调用方读 JSON 决定是否重建。
		console.log(JSON.stringify(verdict));
		return;
	}
	throw new Error(`unknown command: ${options.command ?? "(none)"} (use --check/--write/--print)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	try {
		main();
	} catch (error) {
		console.error(`bundled-python-inputs failed: ${error.message}`);
		process.exitCode = 1;
	}
}
