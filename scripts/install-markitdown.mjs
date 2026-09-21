#!/usr/bin/env node
/**
 * dsh-lab-agent: 安装 markitdown（文档转 Markdown 的可选依赖）。
 *
 * 目标：让 lab_convert_document / labConvert 可用。按顺序尝试：
 *   1. labPython venv（$DSH_HOME/lab-agent/.venv）里已可用的 pip → 装进去；
 *   2. venv 残缺/无 pip → 回退用户级安装
 *      `python3 -m pip install --user --break-system-packages …`
 *      （本机 markitdown/pptx 就在 ~/.local，PEP 668 下唯一无需 root 的姿势）。
 *
 * 装法与 install.sh 的第 5 步完全一致（**不用** `markitdown[all]`）：
 *   1) 装 python/requirements-linux.lock 里的格式依赖（精确 pin，单一真源）；
 *   2) `pip install --no-deps markitdown==<版本>`；
 *   3) 打「magika 可选化」补丁（scripts/patch-markitdown.mjs，锚点 + sha256 + 可回滚）。
 * 原因见 requirements-linux.lock 的注释：0.1.7 把 magika 列为无条件依赖，而它要求
 * onnxruntime（实测 60.9 MB）；`[all]` 还会额外拉入 Azure SDK / 音频 / YouTube 链。
 * 只有 [pdf,docx,pptx,xls,xlsx] 这些格式能力是我们真正需要的。
 *
 * 网络慢时可用镜像：--index-url <镜像>。
 *
 * Usage:
 *   node scripts/install-markitdown.mjs [--dsh-home <path>] [--python <cmd>]
 *   node scripts/install-markitdown.mjs --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKITDOWN_PATCH_VERSION } from "../src/markitdown-patch.js";
import { resolveDshHome, venvDir } from "../src/paths.js";
import { venvPythonPath } from "../src/python-env.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PATCH_SCRIPT = resolve(repoRoot, "scripts", "patch-markitdown.mjs");
/** markitdown 的版本从补丁模块取，避免两处漂移。 */
const MARKITDOWN_PIN = `markitdown==${MARKITDOWN_PATCH_VERSION}`;

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

/** 格式依赖：直接读 linux 锁，保持与 install.sh 同一真源。 */
function lockedDependencies() {
	const text = readFileSync(resolve(repoRoot, "python", "requirements-linux.lock"), "utf8");
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

function run(args) {
	return new Promise((resolve2, reject) => {
		const child = spawn(args[0], args.slice(1), {
			env: { ...process.env },
			stdio: "inherit"
		});
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve2() : reject(new Error(`command failed (${code}): ${args.join(" ")}`))));
	});
}

/** 捕获 stdout（用于让解释器报告 _markitdown.py 的真实位置）。 */
function capture(args) {
	return new Promise((resolve2, reject) => {
		const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (chunk) => (out += chunk));
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve2(out) : reject(new Error(`command failed (${code})`))));
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

/**
 * 三步装好 markitdown 并打补丁。
 * 注意：补丁前**不要** import markitdown —— 那时必然 ImportError（缺 magika）。
 */
async function installMarkitdown(python, flags) {
	const extra = pipExtra(flags);
	await run([python, "-m", "pip", "install", "--disable-pip-version-check", ...extra, ...lockedDependencies()]);
	await run([python, "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", ...extra, MARKITDOWN_PIN]);

	const locate = [
		"import os, site",
		"candidates = [os.path.join(site.getsitepackages()[0], 'markitdown', '_markitdown.py')]",
		"try:",
		"    candidates.append(os.path.join(site.getusersitepackages(), 'markitdown', '_markitdown.py'))",
		"except Exception:",
		"    pass",
		"print(next((p for p in candidates if os.path.exists(p)), ''))"
	].join("\n");
	const target = (await capture([python, "-c", locate])).trim();
	if (!target) throw new Error("安装后仍找不到 markitdown/_markitdown.py");
	await run([process.execPath, PATCH_SCRIPT, "patch", "--target", target]);

	// smoke test：构造 MarkItDown 才会走到被改写的 magika 分支
	await run([python, "-c", "import markitdown; markitdown.MarkItDown(); print('markitdown OK (magika optional)')"]);
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	const { dshHome, python } = flags;
	const dsh = dshHome ? resolve(dshHome) : resolveDshHome();
	const venv = venvDir(dsh);

	if (python) {
		// 显式 python（如 Windows 的 py -3）
		await installMarkitdown(python, flags);
		console.log("markitdown installed into", python);
		return;
	}

	const sysPython = process.platform === "win32" ? "py" : "python3";
	const venvPy = venvPythonPath(venv);

	// 1) venv 存在且有 pip → 装进 venv
	if (existsSync(venvPy) && (await hasPip(venvPy))) {
		console.log(`installing markitdown -> ${venvPy} (venv)`);
		await installMarkitdown(venvPy, flags);
		console.log("done.");
		return;
	}

	// 2) venv 缺失或残缺 → 用户级安装（PEP 668 用 --break-system-packages）
	if (!existsSync(venvPy)) {
		console.log(`venv ${venv} 不存在，创建中…`);
		await mkdir(venv, { recursive: true });
		try {
			await run([sysPython, "-m", "venv", venv]);
			await installMarkitdown(venvPy, flags);
			console.log("done. (venv)");
			return;
		} catch {
			console.log("venv 创建/安装失败（常见：缺 python3-venv/ensurepip），回退用户级安装…");
		}
	} else {
		console.log(`venv ${venv} 存在但无 pip（残缺），回退用户级安装…`);
	}

	console.log(`installing markitdown -> ${sysPython} (--user --break-system-packages)`);
	const extra = pipExtra(flags);
	const userPip = ["-m", "pip", "install", "--disable-pip-version-check", "--user", "--break-system-packages", ...extra];
	await run([sysPython, ...userPip, ...lockedDependencies()]);
	await run([sysPython, ...userPip, "--no-deps", MARKITDOWN_PIN]);
	const userLocate = "import os, site; p=os.path.join(site.getusersitepackages(),'markitdown','_markitdown.py'); print(p if os.path.exists(p) else '')";
	const target = (await capture([sysPython, "-c", userLocate])).trim();
	if (!target) throw new Error("用户级安装后仍找不到 markitdown/_markitdown.py");
	await run([process.execPath, PATCH_SCRIPT, "patch", "--target", target]);
	await run([sysPython, "-c", "import markitdown; markitdown.MarkItDown(); print('markitdown OK (magika optional)')"]);
	console.log("done. 可在实验室面板「文档转MD」上传 Office/PDF/图片文件转 Markdown。");
}

main().catch((error) => {
	console.error(`install-markitdown failed: ${error.message}`);
	process.exit(1);
});
