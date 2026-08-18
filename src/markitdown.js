/**
 * dsh-lab-agent: markitdown 可选执行器。
 *
 * 调用 scripts/markitdown/convert.py（需要 python 环境安装 markitdown）。
 * 不可用时返回 { available: false } + 安装指引，绝不静默给出伪结果。
 * Python 解析：labPython venv 优先，回退系统 python3。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/markitdown/convert.py", import.meta.url));

/**
 * 转换文件 → Markdown。
 * @param {{ venvPython?: string, platform?: string }} env
 * @returns Promise<{ available: boolean, text?: string, error?: string, code?: number }>
 */
export function convertWithMarkitdown(path, { venvPython, platform = process.platform, output } = {}) {
	const python = venvPython && existsSync(venvPython) ? venvPython : platform === "win32" ? "py" : "python3";
	const args = [SCRIPT, path];
	if (output) args.push(output);
	return new Promise((resolve) => {
		const child = spawn(python, args, {
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
				settle({ available: false, error: "markitdown not installed in python; run: python -m pip install markitdown" });
				return;
			}
			try {
				const result = JSON.parse(stdout);
				if (result.ok) settle({ available: true, text: result.text, code });
				else settle({ available: true, error: result.error, code });
			} catch {
				settle({ available: false, error: `markitdown output not JSON: ${(stdout || stderr).slice(0, 200)}` });
			}
		});
	});
}

/** 探测 markitdown 是否可用（convert.py --check，只做 import 检查）。 */
export function probeMarkitdown({ venvPython, platform = process.platform } = {}) {
	const python = venvPython && existsSync(venvPython) ? venvPython : platform === "win32" ? "py" : "python3";
	return new Promise((resolve) => {
		const child = spawn(python, [SCRIPT, "--check"], {
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
			shell: platform === "win32"
		});
		let stdout = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.on("error", (error) => resolve({ available: false, error: error.message }));
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
