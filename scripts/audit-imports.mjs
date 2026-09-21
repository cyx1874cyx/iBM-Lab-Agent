#!/usr/bin/env node
/**
 * dsh-lab-agent: import 可达性审计（路线书 1.4）。
 *
 * 目的：为「依赖能不能删」提供**证据**，而不是靠猜。此前一次真实误判是把 scipy
 * （143 MB）当成可删 —— 根因是静态扫描用了 `^import`，漏掉函数体内的缩进导入：
 *
 *   process_1d.py
 *     15 行  import numpy as np            ← ^import 能命中
 *    143 行      import nmrglue as ng      ← 函数体内缩进，^import 漏掉
 *    147 行      from scipy.signal import find_peaks   ← 同样漏掉
 *    295 行      import matplotlib         ← 同样漏掉（且是软依赖，见下）
 *
 * 所以本脚本用**两条互补证据**：
 *   ① 静态扫描：正则 `^\s*(?:import|from)\s+`，能命中任意缩进层级的导入；
 *   ② 运行期追踪：`<python> -X importtime <target>`，只统计**真正被导入**的模块。
 *      注意：函数体内的导入只有走到那条代码路径才会出现，所以「运行期没出现」
 *      不等于「用不到」——本脚本把两者分开列，绝不合并成一个"可删"结论。
 *
 * 硬/软依赖同样要分开看（路线书纪律 #2）：`raise RuntimeError` 是硬依赖，
 * `except ImportError: plt = None` 是软依赖，二者都不可直接删。
 *
 * **本脚本只读不写**：不删文件、不改锁文件，只输出候选与理由。
 *
 * 用法：
 *   node scripts/audit-imports.mjs --target vendor/.../process_1d.py
 *   node scripts/audit-imports.mjs --target vendor/.../process_1d.py --lock python/requirements.lock
 *   node scripts/audit-imports.mjs --target <file> --run-args "<args>"   # 触发运行期路径
 *   node scripts/audit-imports.mjs --target <file> --python /path/to/venv/bin/python --json
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 静态扫描用的正则。**必须**允许前导空白：函数体内的导入是缩进的，
 * 用 `^import` 会漏掉它们（这正是 scipy 被误判的根因）。
 */
export const IMPORT_PATTERN = /^[ \t]*(?:import|from)[ \t]+([A-Za-z_][A-Za-z0-9_.]*)/gm;

/** 从源码文本中提取顶层模块名（静态证据）。 */
export function staticImports(source) {
	const found = new Set();
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		const top = match[1].split(".")[0];
		if (top) found.add(top);
	}
	return found;
}

/** 解析 `python -X importtime` 的 stderr，取出顶层模块名（运行期证据）。 */
export function parseImportTime(stderr) {
	const found = new Set();
	for (const line of String(stderr).split("\n")) {
		// 形如：import time:     1234 |     5678 | scipy.signal
		const match = /^import time:\s*\d+\s*\|\s*\d+\s*\|\s*(\S+)\s*$/.exec(line.trim());
		if (!match) continue;
		const top = match[1].split(".")[0];
		if (top && top !== "import" && top !== "time") found.add(top);
	}
	return found;
}

/** 发行版名规范化（与 pip 的 canonical name 一致）：小写，-/_/. 视为等价。 */
export function canonicalDistribution(name) {
	return String(name).trim().toLowerCase().replace(/[-_.]+/g, "-");
}

/** 解析 requirements.lock 风格的锁定清单，返回 canonical 名 → 原始行。 */
export function parseLock(text) {
	const locked = new Map();
	for (const raw of String(text).split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*([=<>!~]=?.*)?$/.exec(line);
		if (!match) continue;
		locked.set(canonicalDistribution(match[1]), line);
	}
	return locked;
}

/**
 * 锁文件与「本次路径可达发行版」的差集。纯函数，便于测试与复用。
 *
 * 语义提醒：`unreached` 是**候选**，不是结论 —— 动态导入、插件注册表、CLI 入口、
 * 惰性导入（如 matplotlib 只在画等高线时才 import contourpy）都会表现为未触达。
 */
export function compareWithLock({ lockText, reachedDistributions = [] }) {
	const locked = parseLock(lockText);
	const reached = new Set(reachedDistributions.map(canonicalDistribution));
	const names = [...locked.keys()];
	return {
		lockedCount: locked.size,
		reachedCount: names.filter((name) => reached.has(name)).length,
		unreached: names.filter((name) => !reached.has(name)).sort()
	};
}

/** 向解释器要一次元数据：stdlib 名单 + 导入名→发行版名映射。 */function interpreterMetadata(python) {
	const code = [
		"import json, sys",
		"try:",
		"    from importlib.metadata import packages_distributions",
		"    pd = packages_distributions()",
		"except Exception:",
		"    pd = {}",
		"print(json.dumps({'stdlib': sorted(getattr(sys, 'stdlib_module_names', [])), 'distributions': pd}))"
	].join("\n");
	const result = spawnSync(python, ["-c", code], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	if (result.status !== 0) {
		return { ok: false, error: (result.stderr || result.error?.message || "unknown").trim(), stdlib: new Set(), distributions: {} };
	}
	try {
		const parsed = JSON.parse(result.stdout);
		return { ok: true, stdlib: new Set(parsed.stdlib), distributions: parsed.distributions ?? {} };
	} catch (error) {
		return { ok: false, error: error.message, stdlib: new Set(), distributions: {} };
	}
}

/** 运行目标脚本并追踪导入（运行期证据）。 */
export function runtimeImports({ python, target, runArgs = [] }) {
	const result = spawnSync(python, ["-X", "importtime", target, ...runArgs], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		cwd: repoRoot
	});
	const modules = parseImportTime(result.stderr ?? "");
	return {
		modules,
		exitCode: result.status,
		// 只留最后一小段，便于解释「运行期为什么没触达某些路径」
		errorTail: (result.stderr ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("import time:")).slice(-3).join("\n")
	};
}

/** 把模块名集合映射为发行版名集合。 */
function toDistributions(modules, { stdlib, distributions, extraIgnore = [] }) {
	const ignore = new Set(extraIgnore);
	const dists = new Set();
	const unmapped = new Set();
	for (const module of modules) {
		if (stdlib.has(module) || ignore.has(module)) continue;
		const names = distributions[module];
		if (Array.isArray(names) && names.length) {
			for (const name of names) dists.add(canonicalDistribution(name));
		} else {
			// 无元数据（例如未安装、或本地模块）——如实单列，不假装它是发行版
			unmapped.add(module);
		}
	}
	return { dists, unmapped };
}

function parseArgv(argv) {
	const targets = [];
	let python = "python3";
	let lock = null;
	let runArgs = [];
	let asJson = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--target") targets.push(argv[++i]);
		else if (arg === "--python") python = argv[++i];
		else if (arg === "--lock") lock = argv[++i];
		else if (arg === "--run-args") runArgs = String(argv[++i] ?? "").split(" ").filter(Boolean);
		else if (arg === "--json") asJson = true;
		else if (arg === "--help" || arg === "-h") return { help: true };
		else throw new Error(`未知参数：${arg}`);
	}
	return { targets, python, lock, runArgs, asJson };
}

const USAGE = `用法: node scripts/audit-imports.mjs --target <file.py> [选项]

  --target <file>     被审计的 Python 脚本（可多次）
  --python <cmd>      解释器（默认 python3；要对齐 venv 请显式指定）
  --lock <file>       比对锁定清单，报告「锁定但未被触达」的发行版（候选，非结论）
  --run-args "<args>" 实际执行 --target 时传入的参数（空格分隔）
  --json              输出 JSON`;

function main() {
	const options = parseArgv(process.argv.slice(2));
	if (options.help) {
		console.log(USAGE);
		return 0;
	}
	if (options.targets.length === 0) {
		console.error(USAGE);
		return 2;
	}
	for (const target of options.targets) {
		if (!existsSync(target)) {
			console.error(`目标不存在：${target}`);
			return 2;
		}
	}

	const meta = interpreterMetadata(options.python);
	const report = {
		python: options.python,
		metadata: { ok: meta.ok, error: meta.ok ? undefined : meta.error },
		targets: [],
		lock: null
	};

	// 本地模块名（目标脚本自身与其同级目录名）不应被当成第三方发行版
	const extraIgnore = ["__future__"];

	for (const target of options.targets) {
		const source = readFileSync(target, "utf8");
		const staticSet = staticImports(source);
		const runtime = runtimeImports({ python: options.python, target, runArgs: options.runArgs });
		// 只看第三方差异：stdlib 在启动期就已被导入（`-X importtime` 追不到），
		// 把它列进「仅静态可达」会把告警淹没在噪声里。
		const isNoise = (name) => meta.stdlib.has(name) || extraIgnore.includes(name) || name.startsWith("_");
		const onlyStatic = [...staticSet].filter((m) => !runtime.modules.has(m) && !isNoise(m)).sort();
		const onlyRuntime = [...runtime.modules].filter((m) => !staticSet.has(m) && !isNoise(m)).sort();
		const combined = new Set([...staticSet, ...runtime.modules]);
		const { dists, unmapped } = toDistributions(combined, { stdlib: meta.stdlib, distributions: meta.distributions, extraIgnore });

		report.targets.push({
			target,
			staticModules: [...staticSet].sort(),
			runtimeModules: [...runtime.modules].sort(),
			runtimeExitCode: runtime.exitCode,
			runtimeErrorTail: runtime.errorTail,
			staticOnly: onlyStatic,
			runtimeOnly: onlyRuntime,
			distributions: [...dists].sort(),
			unmappedModules: [...unmapped].sort()
		});
	}

	// 锁文件比对：锁定但未被触达 = 候选，绝不是「可删」
	if (options.lock) {
		const reached = report.targets.flatMap((t) => t.distributions);
		report.lock = {
			file: options.lock,
			...compareWithLock({ lockText: readFileSync(options.lock, "utf8"), reachedDistributions: reached })
		};
	}

	if (options.asJson) {
		console.log(JSON.stringify(report, null, 2));
		return 0;
	}

	console.log("=== import 可达性审计 ===");
	console.log(`解释器: ${options.python}${meta.ok ? "" : `（元数据不可用：${meta.error}）`}`);
	for (const t of report.targets) {
		console.log("");
		console.log(`--- ${t.target} ---`);
		console.log(`静态扫描命中模块 : ${t.staticModules.join(", ") || "（无）"}`);
		console.log(`运行期实际导入   : ${t.runtimeModules.join(", ") || "（无）"}`);
		if (t.runtimeExitCode !== 0) {
			console.log(`运行期退出码     : ${t.runtimeExitCode}（被审计脚本未正常结束，运行期证据不完整）`);
			if (t.runtimeErrorTail) console.log(`  最后输出: ${t.runtimeErrorTail.split("\n").join(" / ")}`);
		}
		console.log(`可达发行版       : ${t.distributions.join(", ") || "（无）"}`);
		if (t.staticOnly.length) {
			console.log(`⚠ 仅静态可达     : ${t.staticOnly.join(", ")}`);
			console.log(`  （在函数体内或未走到该分支；需要真实调用路径才能确认，不可据此判定可删）`);
		}
		if (t.unmappedModules.length) console.log(`无发行版元数据   : ${t.unmappedModules.join(", ")}`);
	}
	if (report.lock) {
		console.log("");
		console.log(`--- 锁文件比对：${report.lock.file} ---`);
		console.log(`锁定 ${report.lock.lockedCount} 个，其中被本次路径触达 ${report.lock.reachedCount} 个`);
		console.log(`未被触达（候选，需人工/补路径确认，**不是**可删结论）:`);
		for (const name of report.lock.unreached) console.log(`  - ${name}`);
		console.log("");
		console.log("提醒：动态导入、插件注册表、CLI 入口与仅特定分支触达的包都会表现为「未被触达」。");
		console.log("      本脚本只读不写；任何删除都必须先补齐运行路径证据（路线书纪律 #2/#6）。");
	}
	return 0;
}

// 仅在作为入口执行时跑 CLI；被 import（测试）时不产生副作用。
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	try {
		process.exit(main());
	} catch (error) {
		console.error(`audit-imports failed: ${error.message}`);
		process.exit(1);
	}
}
