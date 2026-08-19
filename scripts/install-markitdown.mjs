#!/usr/bin/env node
/**
 * dsh-lab-agent: 安装 markitdown（文档转 Markdown 的可选依赖）。
 *
 * 目标：让 lab_convert_document / labConvert 可用。按顺序尝试：
 *   1. labPython venv（$DSH_HOME/lab-agent/.venv）里已可用的 pip → 装进去；
 *   2. venv 残缺/无 pip → 回退用户级安装
 *      `python3 -m pip install --user --break-system-packages markitdown[all]`
 *      （本机 markitdown/pptx 就在 ~/.local，PEP 668 下唯一无需 root 的姿势）。
 *
 * 默认安装全部格式依赖（markitdown[all]）。网络慢时可用镜像：--index-url <镜像>。
 *
 * Usage:
 *   node scripts/install-markitdown.mjs [--dsh-home <path>] [--python <cmd>]
 *   node scripts/install-markitdown.mjs --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome, venvDir } from "../src/paths.js";
import { venvPythonPath } from "../src/python-env.js";

function parseArgs(argv) {
	const flags = { dshHome: undefined, python: undefined, indexUrl: undefined };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--dsh-home") flags.dshHome = argv[++i];
		else if (argv[i] === "--python") flags.python = argv[++i];
		else if (argv[i] === "--index-url") flags.indexUrl = argv[++i];
	}
	return flags;
}

function pipExtra(flags) {
	return flags.indexUrl ? ["-i", flags.indexUrl] : [];
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

/** 探测 python 是否能用 pip（有 pip 模块且可执行）。 */
function hasPip(python) {
	return new Promise((resolve2) => {
		const child = spawn(python, ["-m", "pip", "--version"], { stdio: ["ignore", "pipe", "pipe"] });
		child.on("error", () => resolve2(false));
		child.on("exit", (code) => resolve2(code === 0));
	});
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	const { dshHome, python } = flags;
	const dsh = dshHome ? resolve(dshHome) : resolveDshHome();
	const venv = venvDir(dsh);

	if (python) {
		// 显式 python（如 Windows 的 py -3）
		await run([python, "-m", "pip", "install", ...pipExtra(flags), "markitdown[all]"]);
		console.log("markitdown[all] installed into", python);
		return;
	}

	const sysPython = process.platform === "win32" ? "py" : "python3";
	const venvPy = venvPythonPath(venv);

	// 1) venv 存在且有 pip → 装进 venv
	if (existsSync(venvPy) && (await hasPip(venvPy))) {
		console.log(`installing markitdown[all] -> ${venvPy} (venv)`);
		await run([venvPy, "-m", "pip", "install", ...pipExtra(flags), "markitdown[all]"]);
		console.log("done.");
		return;
	}

	// 2) venv 缺失或残缺 → 用户级安装（PEP 668 用 --break-system-packages）
	if (!existsSync(venvPy)) {
		console.log(`venv ${venv} 不存在，创建中…`);
		await mkdir(venv, { recursive: true });
		try {
			await run([sysPython, "-m", "venv", venv]);
			await run([venvPy, "-m", "pip", "install", ...pipExtra(flags), "markitdown[all]"]);
			console.log("done. (venv)");
			return;
		} catch {
			console.log("venv 创建/安装失败（常见：缺 python3-venv/ensurepip），回退用户级安装…");
		}
	} else {
		console.log(`venv ${venv} 存在但无 pip（残缺），回退用户级安装…`);
	}

	console.log(`installing markitdown[all] -> ${sysPython} (--user --break-system-packages)`);
	await run([sysPython, "-m", "pip", "install", "--user", "--break-system-packages", ...pipExtra(flags), "markitdown[all]"]);
	console.log("done. 可在实验室面板「文档转MD」上传 Office/PDF/图片文件转 Markdown。");
}

main().catch((error) => {
	console.error(`install-markitdown failed: ${error.message}`);
	process.exit(1);
});
