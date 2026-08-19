#!/usr/bin/env node
/**
 * dsh-lab-agent: 安装 PyMuPDF（nature-paper2ppt 配图渲染依赖）。
 *
 * 本环境常见约束（Ubuntu 24+ / Debian 12+）：
 *   - 系统 Python 受 PEP 668（externally-managed-environment）保护，
 *     `pip install` 会被拒绝；
 *   - `python3-venv`（ensurepip）可能未装，`python3 -m venv` 失败；
 *   - 无 uv / pipx / conda。
 * 因此默认用 `pip install --user --break-system-packages` 装到
 * `~/.local/lib/pythonX/site-packages`（与本机 markitdown/python-pptx
 * 同位置，不需要 root，不污染系统包）。
 *
 * Usage:
 *   node scripts/install-pymupdf.mjs [--python <cmd>] [--index-url <镜像>]
 *
 * 装完后可用 `node scripts/lab-doctor.mjs` 验证。
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
	const flags = { python: undefined, indexUrl: undefined };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--python") flags.python = argv[++i];
		else if (argv[i] === "--index-url") flags.indexUrl = argv[++i];
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
	const flags = parseArgs(process.argv.slice(2));
	const python = flags.python ?? (process.platform === "win32" ? "py" : "python3");
	const extra = flags.indexUrl ? ["-i", flags.indexUrl] : [];

	console.log(`installing PyMuPDF -> ${python} (--user --break-system-packages)`);
	// 先试普通 --user；被 PEP 668 拒绝后加 --break-system-packages
	try {
		await run([python, "-m", "pip", "install", "--user", ...extra, "pymupdf"]);
	} catch {
		console.log("PEP 668 阻止 --user，改用 --user --break-system-packages");
		await run([python, "-m", "pip", "install", "--user", "--break-system-packages", ...extra, "pymupdf"]);
	}
	// 验证
	try {
		const check = spawn(python, ["-c", "import fitz; print('PyMuPDF', fitz.__version__ if hasattr(fitz,'__version__') else 'ok')"], { stdio: ["ignore", "pipe", "pipe"] });
		check.stdout.on("data", (c) => process.stdout.write(c));
		check.stderr.on("data", (c) => process.stderr.write(c));
		await new Promise((resolve2) => check.on("exit", (code) => (code === 0 ? resolve2() : resolve2())));
	} catch {
		// 校验失败不致命，doctor 会再查
	}
	console.log("done. nature-paper2ppt 现在可以渲染 PDF 页面裁剪配图。");
}

main().catch((error) => {
	console.error(`install-pymupdf failed: ${error.message}`);
	process.exit(1);
});
