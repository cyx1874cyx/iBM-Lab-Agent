/**
 * dsh-lab-agent: python environment management (pure logic).
 *
 * The vendored nature skills run their own python scripts (pdf parsing,
 * academic search, pptx generation). This module owns a pinned, managed
 * virtualenv at $DSH_HOME/lab-agent/.venv installed from a hash-pinned
 * requirements.lock — no system-site mutation, no auto-install at boot.
 *
 * Platform-aware (win32 venv layout and `py` launcher support).
 *
 * P1-2: unified Windows resolver. [resolvePythonExecutable] and
 * [pythonCandidates] give every consumer (RDKit / MarkItDown / nature
 * skills / Doctor) one deterministic resolution order:
 *   managed venv → bundled python → py -3.11 → py -3 → python.exe
 * Windows never falls back to the nonexistent `python3` command.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** sha256 of a lock file — the pin the venv was installed from. */
export async function sha256OfFile(path) {
	const buffer = await readFile(path);
	return createHash("sha256").update(buffer).digest("hex");
}

export function venvPythonPath(venvDir, platform = process.platform) {
	return platform === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
}

/** Locate a system python for creating the venv (prefers py launcher on win32). */
export function systemPythonCommand(platform = process.platform) {
	return platform === "win32" ? ["py", "-3"] : ["python3"];
}

/** Run a command, streaming output, resolving on exit code 0. */
export function runCommand(args, { cwd, env }) {
	return new Promise((resolve, reject) => {
		const child = spawn(args[0], args.slice(1), {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["ignore", "inherit", "inherit"]
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`command exited with ${signal ?? code}: ${args.join(" ")}`));
		});
	});
}

/** Synchronous-ish state probe: what exists where, and the lock's hash. */
export async function preflight({ venvDir, lockFile, platform = process.platform }) {
	const python = venvPythonPath(venvDir, platform);
	const lockExists = existsSync(lockFile);
	const venvExists = existsSync(python);
	const issues = [];
	if (!lockExists) issues.push(`missing lock file: ${lockFile}`);
	if (!venvExists) issues.push(`missing venv python: ${python}`);
	const lockHash = lockExists ? await sha256OfFile(lockFile) : undefined;
	return { venvDir, python, lockFile, lockExists, venvExists, lockHash, ok: issues.length === 0, issues };
}

/** Parse 'Python 3.11.9' → [3, 11]. */
export function parsePythonVersion(text) {
	const match = /Python\s+(\d+)\.(\d+)/.exec(text);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2])];
}

/**
 * Create the venv and install the pinned lock. Idempotent-ish: a venv whose
 * lock hash differs is reinstalled (pip install -r is incremental).
 */
export async function bootstrap({ venvDir, lockFile, platform = process.platform }) {
	const state = await preflight({ venvDir, lockFile, platform });
	if (!state.lockExists) throw new Error(`cannot bootstrap python env: ${state.issues[0]}`);

	const py = systemPythonCommand(platform);
	const sysVersion = await pythonVersionFrom(py, platform);
	const parsed = sysVersion ? parsePythonVersion(sysVersion) : undefined;
	if (parsed && (parsed[0] > 3 || (parsed[0] === 3 && parsed[1] >= 13))) {
		console.warn(`WARNING: system python ${sysVersion} >= 3.13; the pinned lock targets Python 3.11 ` +
			"(nature-skills CI environment). Some wheels may not exist for this version — expect possible build failures.");
	}

	const recreate = !state.venvExists || !(await pythonIsUsable(state.python, platform));
	if (recreate) {
		if (existsSync(venvDir)) {
			await rm(venvDir, { recursive: true, force: true });
			console.warn(`removed incomplete python venv: ${venvDir}`);
		}
		await runCommand([...py, "-m", "venv", venvDir], {});
	}
	await runCommand([venvPythonPath(venvDir, platform), "-m", "pip", "install", "--disable-pip-version-check", "-r", lockFile], {});
	return await preflight({ venvDir, lockFile, platform });
}

/** A version-only probe can succeed even when a venv has a broken stdlib path. */
async function pythonIsUsable(python, platform) {
	try {
		const child = spawn(python, ["-I", "-c", "import encodings, sys; assert sys.prefix"], {
			stdio: "ignore"
		});
		await new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("python stdlib probe failed"))));
		});
		return true;
	} catch {
		return false;
	}
}

/** Run a python command and return its version line ('' when unavailable). */
async function pythonVersionFrom(args, platform) {
	try {
		const child = spawn(args[0], [...args.slice(1), "--version"], {
			stdio: ["ignore", "pipe", "pipe"]
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		await new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("python --version failed"))));
		});
		return (stdout || stderr).trim();
	} catch {
		return "";
	}
}

/** Report the venv's python version (null when the venv does not exist). */
export async function pythonVersion(venvDir, platform = process.platform) {
	const python = venvPythonPath(venvDir, platform);
	if (!existsSync(python)) return null;
	const { stdout, stderr } = await new Promise((resolve, reject) => {
		const child = spawn(python, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`python --version failed: ${stderr || stdout}`))));
	});
	return (stdout || stderr).trim();
}

/**
 * P1-2：统一 Python Resolver 的候选解释器序列（高→低优先级）。
 *
 *   1. managed venv python.exe（存在时）
 *   2. bundled Python（可选捆绑，如桌面资源目录；未捆绑时为空）
 *   3. win32: py -3.11 → py -3 → python.exe；unix: python3
 *
 * 每个候选形如 `{ command: string[], source }`，command 可直接作为
 * `spawn(...command, args)` 的前缀（py launcher 需要多 token 表达）。
 */

/**
 * 桌面打包环境注入的捆绑 Python（Rust 启动 DSH 子进程时设置
 * IBM_LAB_AGENT_BUNDLED_PYTHON 环境变量）。未设置或文件不存在时返回
 * undefined，各 resolver 自然回退到 venv / 系统 python。
 */
export function bundledPythonFromEnv(env = process.env) {
	const value = env.IBM_LAB_AGENT_BUNDLED_PYTHON;
	return value && existsSync(value) ? value : undefined;
}

export function pythonCandidates({ venvPython, bundledPython, platform = process.platform } = {}) {
	const candidates = [];
	if (venvPython && existsSync(venvPython)) candidates.push({ command: [venvPython], source: "venv" });
	if (bundledPython && existsSync(bundledPython)) candidates.push({ command: [bundledPython], source: "bundled" });
	if (platform === "win32") {
		candidates.push({ command: ["py", "-3.11"], source: "py" });
		candidates.push({ command: ["py", "-3"], source: "py" });
		candidates.push({ command: ["python"], source: "python" });
	} else {
		candidates.push({ command: ["python3"], source: "python3" });
	}
	return candidates;
}

/**
 * P1-2：统一 Python Resolver。
 * 返回第一个版本可用的候选 `{ command, source, version }`；
 * 全部不可用时返回 `{ command: null, source: "unavailable", version: "" }`。
 * Windows 上绝不回退到不存在的 "python3"；Store alias（python.exe）的
 * 非零退出码会被 [pythonVersionFrom] 过滤，不会误判为已安装。
 * 桌面打包环境自动纳入 bundled Python（默认参数读取环境变量）。
 */
export async function resolvePythonExecutable({ venvPython, bundledPython = bundledPythonFromEnv(), platform = process.platform } = {}) {
	for (const candidate of pythonCandidates({ venvPython, bundledPython, platform })) {
		const version = await pythonVersionFrom(candidate.command, platform);
		if (version) return { ...candidate, version };
	}
	return { command: null, source: "unavailable", version: "" };
}

/**
 * Python 环境聚合状态（供 Doctor 一屏展示）：venv 路径/存在/版本、
 * lock 存在/hash、统一 resolver 结果。检测只读，不修改任何内容。
 */
export async function pythonEnvironmentStatus({ venvDir, lockFile, bundledPython, platform = process.platform } = {}) {
	const venvPython = venvDir ? venvPythonPath(venvDir, platform) : undefined;
	const venvExists = venvPython ? existsSync(venvPython) : false;
	const lockExists = lockFile ? existsSync(lockFile) : false;
	const [venvVersion, lockHash, resolved] = await Promise.all([
		venvExists ? pythonVersion(venvDir, platform) : null,
		lockExists ? sha256OfFile(lockFile) : undefined,
		resolvePythonExecutable({ venvPython, bundledPython, platform })
	]);
	return {
		venv: { dir: venvDir ?? null, python: venvPython ?? null, exists: venvExists, version: venvVersion },
		lock: { file: lockFile ?? null, exists: lockExists, hash: lockHash ?? null },
		resolved,
		available: resolved.source !== "unavailable",
		summary: resolved.source === "unavailable"
			? "未找到可用 Python（无 venv，且 py/python 均不可用）"
			: `${resolved.version}（${resolved.source}）`
	};
}
