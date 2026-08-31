/**
 * dsh-lab-agent: markitdown 可选执行器。
 *
 * 调用 scripts/markitdown/convert.py（需要 python 环境安装 markitdown）。
 * 不可用时返回 { available: false } + 安装指引，绝不静默给出伪结果。
 *
 * P1-2：解释器候选经统一 resolver（venv → bundled → py -3.11/-3 → python），
 * 对每个候选探测 markitdown 是否已安装；Windows 不再单独回退 python3。
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pythonCandidates } from "./python-env.js";

const SCRIPT = fileURLToPath(new URL("../scripts/markitdown/convert.py", import.meta.url));

/** 用指定 python 命令探测 markitdown 可用性（--check，只做 import 检查）。 */
function probeWith(command, platform) {
	return new Promise((resolve) => {
		const child = spawn(command[0], [...command.slice(1), SCRIPT, "--check"], {
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
			shell: platform === "win32"
		});
		let stdout = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.on("error", () => resolve({ available: false }));
		child.on("exit", (code) => {
			try {
				const result = JSON.parse(stdout);
				resolve({ available: result.available === true, error: result.error });
			} catch {
				resolve({ available: code === 0, error: `probe output not JSON: ${stdout.slice(0, 120)}` });
			}
		});
	});
}

/**
 * 解析实际可用的 python 命令：按统一 resolver 候选序列（venv 优先）
 * 探测其中是否装有 markitdown。
 * @returns {Promise<{ command: string[] | null, source: string, note: string, probe: { available: boolean, error?: string } | null }>}
 */
async function resolveMarkitdownPython({ venvPython, platform = process.platform } = {}) {
	for (const candidate of pythonCandidates({ venvPython, platform })) {
		const probe = await probeWith(candidate.command, platform);
		if (probe.available) return { ...candidate, note: candidate.source, probe };
	}
	return { command: null, source: "unavailable", note: "unavailable", probe: null };
}

/**
 * 转换文件 → Markdown。
 * @param {{ venvPython?: string, platform?: string }} env
 * @returns Promise<{ available: boolean, text?: string, error?: string, code?: number, note?: string }>
 */
export async function convertWithMarkitdown(path, { venvPython, platform = process.platform, output } = {}) {
	const resolved = await resolveMarkitdownPython({ venvPython, platform });
	if (!resolved.command) {
		return { available: false, error: "no python with markitdown found (venv missing and py/python unavailable); run: python -m pip install markitdown" };
	}
	const command = resolved.command;
	const args = [SCRIPT, path];
	if (output) args.push(output);
	return new Promise((resolve) => {
		const child = spawn(command[0], [...command.slice(1), ...args], {
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
			shell: platform === "win32"
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle({ available: false, error: "markitdown convert timed out" });
		}, 120000);
		const settle = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) => settle({ available: false, error: error.message }));
		child.on("exit", (code) => {
			if (code === 2) {
				settle({ available: false, error: `markitdown not installed in python (${resolved.note}); run: python -m pip install markitdown` });
				return;
			}
			try {
				const result = JSON.parse(stdout);
				if (result.ok) settle({ available: true, text: result.text, code, note: resolved.note });
				else settle({ available: true, error: result.error, code, note: resolved.note });
			} catch {
				settle({ available: false, error: `markitdown output not JSON: ${(stdout || stderr).slice(0, 200)}` });
			}
		});
	});
}

/** 探测 markitdown 是否可用（convert.py --check，只做 import 检查）。 */
export async function probeMarkitdown({ venvPython, platform = process.platform } = {}) {
	const resolved = await resolveMarkitdownPython({ venvPython, platform });
	return resolved.probe ?? { available: false, error: "no python with markitdown found" };
}
