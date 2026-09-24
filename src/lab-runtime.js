/**
 * dsh-lab-agent: 统一的「Agent 运行时环境」解析器。
 *
 * 0.5.4 现场反馈：Agent 在 shell 里干活时会去猜宿主机上的 python / node / soffice ——
 * 结果硬编码了 `C:\Program Files\iBM Lab Agent\node\node.exe`，还因为桌面壳的沙箱
 * 不让写 `%LOCALAPPDATA%\Temp` 而让 LibreOffice 建不出 user profile、**静默不产出
 * PDF**。本模块把这些路径收敛成一个可查询的事实源，优先级固定为：
 *
 *   1. 桌面壳注入的捆绑运行时（`IBM_LAB_AGENT_BUNDLED_PYTHON` / `_NODE`、工作区）；
 *   2. 本进程自身 —— DSH 就是被壳用捆绑 node 启动的，`process.execPath` 即那一份；
 *   3. 系统 PATH（仅在前两者都不可用时，且需要显式 allowSystemFallback）。
 *
 * 顺序不可颠倒：捆绑运行时是**隔离边界**，不是"偏好"。与 `src/python-env.js`
 * 同一哲学 —— 回退到宿主机环境会让结果依赖用户机器上装了什么。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { bundledPythonFromEnv, resolvePythonExecutable } from "./python-env.js";

/** Agent 工作区根目录（桌面壳注入 `IBM_LAB_AGENT_WORKSPACE`）。 */
export function workspaceDirFromEnv(env = process.env) {
	const value = env.IBM_LAB_AGENT_WORKSPACE;
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Agent 应当使用的临时目录：一律放在工作区内的 `.lab-tmp`。
 *
 * 不要默认回退到系统临时目录：桌面壳的沙箱会拒绝写 `%LOCALAPPDATA%\Temp`，
 * 而 LibreOffice 在写不了 user profile 时会**静默失败**（不报错、不产出 PDF）。
 * 工作区内既有写权限，也便于事后清理与排查。
 *
 * @param {{ env?: NodeJS.ProcessEnv, fallback?: string }} [options]
 */
export function runtimeTempDir({ env = process.env, fallback } = {}) {
	const workspace = workspaceDirFromEnv(env);
	if (workspace) return join(workspace, ".lab-tmp");
	return fallback ?? join(process.cwd(), ".lab-tmp");
}

/** 确保临时目录存在（幂等）。 */
export async function ensureRuntimeTempDir(options = {}) {
	const dir = runtimeTempDir(options);
	await mkdir(dir, { recursive: true });
	return dir;
}

/** 桌面壳注入的捆绑 Node.js（Rust 侧 `runtime/process.rs` 设置）。 */
export function bundledNodeFromEnv(env = process.env) {
	const value = env.IBM_LAB_AGENT_BUNDLED_NODE;
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Node.js 候选序列（高→低优先级）。
 *
 * 注意第 2 条：DSH 自己就跑在壳启动的 node 上，因此 `process.execPath`
 * 在桌面端等于捆绑 node、在纯 CLI 端等于当前 node —— 两种场景都正确，
 * 而且不依赖任何环境变量，是比"查 PATH"可靠得多的兜底。
 *
 * @param {{ env?: NodeJS.ProcessEnv, allowSystemFallback?: boolean }} [options]
 */
export function nodeCandidates({ env = process.env, allowSystemFallback } = {}) {
	const candidates = [];
	const bundled = bundledNodeFromEnv(env);
	if (bundled && existsSync(bundled)) candidates.push({ command: bundled, source: "bundled" });
	const self = process.execPath;
	if (typeof self === "string" && self !== "" && existsSync(self) && !candidates.some((entry) => entry.command === self)) {
		candidates.push({ command: self, source: "harness" });
	}
	if (allowSystemFallback === true) candidates.push({ command: "node", source: "node" });
	return candidates;
}

/** 探测一个可执行文件的版本行（失败返回 undefined，绝不抛）。 */
export function probeVersionLine(command, args = ["--version"], { timeoutMs = 10000 } = {}) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			resolve(undefined);
			return;
		}
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* 进程可能已退出 */
			}
			finish(undefined);
		}, timeoutMs);
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", () => finish(undefined));
		child.on("close", (code) => {
			if (code !== 0 && stdout.trim() === "" && stderr.trim() === "") {
				finish(undefined);
				return;
			}
			const line = (stdout || stderr).split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry !== "");
			finish(line || undefined);
		});
	});
}

/** 解析出第一个真正可执行的 Node.js 候选。 */
export async function resolveNodeExecutable(options = {}) {
	for (const candidate of nodeCandidates(options)) {
		const version = await probeVersionLine(candidate.command);
		if (version) return { ...candidate, version };
	}
	return { command: null, source: "unavailable", version: "" };
}

/** 把解析结果里的 `command` 归一成 argv 前缀数组。
 *
 * `pythonCandidates` 的 `command` 是**数组**（`py` 启动器需要多 token 表达，
 * 如 `["py", "-3.12"]`），而 `nodeCandidates` 是字符串。这里统一成 argv，
 * 调用方用 `argv[0]` 当可执行文件、整个数组当前缀，避免再有人把数组当字符串。
 */
function argvOf(command) {
	if (Array.isArray(command)) return command.filter((entry) => typeof entry === "string" && entry !== "");
	if (typeof command === "string" && command.trim() !== "") return [command];
	return [];
}

/**
 * 解析 Agent 应当使用的一整套运行时环境。
 *
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, cwd?: string }} [options]
 * @returns {Promise<{
 *   python: { available: boolean, command: string, argv: string[], source: string, version: string },
 *   node: { available: boolean, command: string, argv: string[], source: string, version: string },
 *   tempDir: string,
 *   workspaceDir: string | undefined,
 *   isolated: boolean,
 *   warnings: string[]
 * }>}
 */
export async function resolveAgentRuntime({ env = process.env, platform = process.platform, cwd } = {}) {
	const warnings = [];
	const pythonResolved = await resolvePythonExecutable({ bundledPython: bundledPythonFromEnv(env), platform });
	const pythonArgv = argvOf(pythonResolved.command);
	if (pythonArgv.length === 0) {
		warnings.push(
			"没有可用的 Python：桌面壳未注入 IBM_LAB_AGENT_BUNDLED_PYTHON，且系统 Python 不可用；需要 Python 的功能会降级。"
		);
	}
	const nodeResolved = await resolveNodeExecutable({ env });
	const nodeArgv = argvOf(nodeResolved.command);
	if (nodeArgv.length === 0) {
		warnings.push("没有可用的 Node.js：安装包可能不完整，请重新安装 iBM Lab Agent。");
	}
	const isolated = bundledPythonFromEnv(env) !== undefined || bundledNodeFromEnv(env) !== undefined;
	return {
		python: {
			available: pythonArgv.length > 0,
			command: pythonArgv[0] ?? "",
			argv: pythonArgv,
			source: pythonResolved.source,
			version: pythonResolved.version ?? ""
		},
		node: {
			available: nodeArgv.length > 0,
			command: nodeArgv[0] ?? "",
			argv: nodeArgv,
			source: nodeResolved.source,
			version: nodeResolved.version ?? ""
		},
		tempDir: runtimeTempDir({ env, fallback: cwd ? join(cwd, ".lab-tmp") : undefined }),
		workspaceDir: workspaceDirFromEnv(env),
		isolated,
		warnings
	};
}
