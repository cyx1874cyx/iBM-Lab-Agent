#!/usr/bin/env node
/**
 * dsh-lab-agent: 安装 markitdown（文档转 Markdown 的可选依赖）。
 *
 * 在 labPython venv（$DSH_HOME/lab-agent/.venv）安装 markitdown；
 * venv 不存在时创建。Windows 本地建议先用 Python 安装器创建 venv 或直接
 * 用系统 python -m pip install markitdown。
 *
 * Usage:
 *   node scripts/install-markitdown.mjs [--dsh-home <path>] [--python <cmd>]
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome, venvDir } from "../src/paths.js";
import { venvPythonPath } from "../src/python-env.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
	const flags = { dshHome: undefined, python: undefined };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--dsh-home") flags.dshHome = argv[++i];
		else if (argv[i] === "--python") flags.python = argv[++i];
	}
	return flags;
}

function run(args) {
	return new Promise((resolve2, reject) => {
		const child = spawn(args[0], args.slice(1), {
			env: { ...process.env },
			stdio: "inherit",
			shell: process.platform === "win32"
		});
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve2() : reject(new Error(`command failed (${code}): ${args.join(" ")}`))));
	});
}

async function main() {
	const { dshHome, python } = parseArgs(process.argv.slice(2));
	const dsh = dshHome ? resolve(dshHome) : resolveDshHome();
	const venv = venvDir(dsh);

	if (python) {
		// 显式 python（如 Windows 的 py -3）
		await run([python, "-m", "pip", "install", "markitdown"]);
		console.log("markitdown installed into", python);
		return;
	}

	const venvPy = venvPythonPath(venv);
	if (!existsSync(venvPy)) {
		console.log(`creating venv -> ${venv}`);
		await mkdir(venv, { recursive: true });
		await run([process.platform === "win32" ? "py" : "python3", "-m", "venv", venv]);
	}
	console.log(`installing markitdown -> ${venvPy}`);
	await run([venvPy, "-m", "pip", "install", "markitdown"]);
	console.log("done. 可在实验室面板「文档转MD」上传 Office/PDF/图片文件转 Markdown。");
}

main().catch((error) => {
	console.error(`install-markitdown failed: ${error.message}`);
	process.exit(1);
});
