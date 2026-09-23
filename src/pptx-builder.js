/**
 * dsh-lab-agent: PPTX 模板化构建执行器。
 *
 * 调用 scripts/pptx/build_from_template.py：以导入模板的 source.pptx 为起点，
 * 按版式角色映射把 plan.json 渲染成真正的 .pptx，并输出模板符合性报告。
 * 这是「PPT 格式按模板来」的落地路径 —— 不再由模型从零自由拼版式。
 *
 * 解释器候选经统一 resolver（venv → bundled → 系统 py/python3）；python-pptx
 * 缺失时脚本以退出码 2 + JSON error 返回，绝不静默产出伪结果。
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundledPythonFromEnv, pythonCandidates } from "./python-env.js";

export const PPTX_BUILDER_SCRIPT = fileURLToPath(new URL("../scripts/pptx/build_from_template.py", import.meta.url));

/** 从脚本 stdout 里取最后一个可解析的 JSON 对象（容忍前置日志行）。 */
export function parseBuilderJson(stdout) {
	const text = String(stdout ?? "").trim();
	if (!text) return undefined;
	const lines = text.split(/\r?\n/);
	for (let end = lines.length; end > 0; end -= 1) {
		const candidate = lines.slice(0, end).join("\n").trim();
		if (!candidate.startsWith("{")) continue;
		try {
			return JSON.parse(candidate);
		} catch {
			// 继续尝试更短的片段
		}
	}
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * 运行模板化构建脚本。
 * @param {string[]} args 传给 build_from_template.py 的参数
 * @param {{ venvPython?: string, platform?: string, timeoutMs?: number }} env
 * @returns {Promise<{ ok: boolean, code: number|null, json?: object, stdout: string, stderr: string, python?: string, error?: string }>}
 */
export async function runPptxBuilder(args, { venvPython, platform = process.platform, timeoutMs = 180000 } = {}) {
	const candidates = pythonCandidates({
		venvPython,
		bundledPython: bundledPythonFromEnv(),
		platform
	});
	const candidate = candidates[0];
	if (candidate === undefined) {
		return { ok: false, code: null, stdout: "", stderr: "", error: "no python interpreter available for PPTX build" };
	}
	const command = candidate.command;
	return await new Promise((resolve) => {
		const child = spawn(command[0], [...command.slice(1), PPTX_BUILDER_SCRIPT, ...args], {
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"]
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle({ ok: false, code: null, stdout, stderr, python: command.join(" "), error: "PPTX build timed out" });
		}, timeoutMs);
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", (error) => settle({ ok: false, code: null, stdout, stderr, python: command.join(" "), error: error.message }));
		child.on("exit", (code) => {
			const json = parseBuilderJson(stdout);
			settle({
				ok: code === 0 && json?.ok !== false,
				code,
				json,
				stdout,
				stderr,
				python: command.join(" "),
				error: json?.error ?? (code === 0 ? undefined : (stderr || stdout).slice(0, 400))
			});
		});
	});
}
