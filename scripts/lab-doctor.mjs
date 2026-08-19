#!/usr/bin/env node
/**
 * dsh-lab-agent: 环境自检（lab doctor）。
 *
 * 一次性输出科研工作台所需 Python 环境的完整状态：
 *   - Python 版本与 pip 管理策略（PEP 668）
 *   - markitdown / PyMuPDF / python-pptx 可用性（含用户级 ~/.local 路径）
 *   - PDF 渲染器（pdftoppm / ghostscript / mutool）与 venv 组件（ensurepip）
 *   - 修复建议（缺失项给出安装命令）
 *
 * Usage: node scripts/lab-doctor.mjs [--python <cmd>] [--json]
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const python = process.argv.includes("--python") ? process.argv[process.argv.indexOf("--python") + 1] : (process.platform === "win32" ? "py" : "python3");
const asJson = process.argv.includes("--json");

function probePython(code) {
	return new Promise((resolve2) => {
		const child = spawn(python, ["-c", code], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
		let out = "";
		let err = "";
		child.stdout.on("data", (c) => (out += c));
		child.stderr.on("data", (c) => (err += c));
		child.on("error", (e) => resolve2({ ok: false, out, err: e.message }));
		child.on("exit", (code) => resolve2({ ok: code === 0, out: out.trim(), err: err.trim() }));
	});
}

function probeBin(name) {
	return new Promise((resolve2) => {
		const child = spawn("which", [name], { stdio: ["ignore", "pipe", "pipe"] });
		child.on("error", () => resolve2(false));
		child.on("exit", (code) => resolve2(code === 0));
	});
}

async function main() {
	const report = {
		python: { command: python },
		pip: {},
		packages: {},
		renderers: {},
		venv: {},
		fixes: []
	};

	const ver = await probePython("import sys; print(sys.version.split()[0])");
	report.python.version = ver.ok ? ver.out : `unavailable (${ver.err})`;

	// pip 可用性与 PEP 668
	const pip = await probePython("import pip; print(pip.__version__)");
	report.pip.version = pip.ok ? pip.out : "not available";
	const pep668 = await probePython(`
try:
    import sysconfig
    print(sysconfig.get_paths().get("stdlib",""))
except Exception as e:
    print("?")
`);
	// PEP 668: EXTERNALLY-MANAGED 文件存在
	const pep668file = await probePython(`
import sys, os, sysconfig
p = os.path.join(sysconfig.get_paths().get("stdlib",""), "EXTERNALLY-MANAGED")
print("yes" if os.path.exists(p) else "no")
`);
	report.pip.pep668 = pep668file.ok && pep668file.out === "yes" ? "yes (externally-managed; need --break-system-packages or --user)" : "no";
	if (report.pip.pep668 !== "no") report.fixes.push("系统 pip 受 PEP 668 保护；用户级安装请用：python3 -m pip install --user --break-system-packages <pkg>");

	// 关键包：markitdown / fitz(PyMuPDF) / pptx
	for (const [pkg, mod, hint] of [
		["markitdown", "markitdown", "文档转 Markdown（lab_convert_document）"],
		["PyMuPDF", "fitz", "PDF 渲染/配图（nature-paper2ppt）"],
		["python-pptx", "pptx", "PPT 生成（nature-paper2ppt）"]
	]) {
		const r = await probePython(`import importlib.util; print("yes" if importlib.util.find_spec("${mod}") else "no")`);
		report.packages[pkg] = r.ok && r.out === "yes" ? "ok" : `missing (${hint})`;
		if (r.ok && r.out !== "yes") {
			const cmd = pkg === "markitdown" ? "node scripts/install-markitdown.mjs"
				: pkg === "PyMuPDF" ? "node scripts/install-pymupdf.mjs"
				: `python3 -m pip install --user --break-system-packages python-pptx`;
			report.fixes.push(`${pkg} 缺失 → ${cmd}`);
		}
	}

	// 用户级 site-packages 路径
	const userSite = await probePython("import site; print(site.getusersitepackages())");
	report.python.userSitePackages = userSite.ok ? userSite.out : "?";
	const localPkgs = await probePython(`
import importlib.util, os, site
sp = site.getusersitepackages()
found = []
for m in ("markitdown","fitz","pptx"):
    spec = importlib.util.find_spec(m)
    found.append(f"{m}={'yes' if spec else 'no'}")
print(" | ".join(found))
`);
	report.python.userLocalPkgs = localPkgs.ok ? localPkgs.out : "?";

	// 渲染器
	for (const name of ["pdftoppm", "gs", "mutool", "magick", "soffice"]) {
		report.renderers[name] = (await probeBin(name)) ? "ok" : "missing";
	}
	if (report.renderers.pdftoppm === "missing" && report.renderers.gs === "missing" && report.packages.PyMuPDF !== "ok") {
		report.fixes.push("无 PDF 渲染器且无 PyMuPDF：配图渲染不可用。装 PyMuPDF（node scripts/install-pymupdf.mjs）或系统 pdftoppm/ghostscript");
	}

	// venv 组件（ensurepip）
	const venvOk = await probePython(`
import subprocess, tempfile, os
d = tempfile.mkdtemp()
r = subprocess.run([sys.executable, "-m", "venv", d], capture_output=True, text=True)
print("ok" if r.returncode == 0 else r.stderr.strip().splitlines()[0] if r.stderr else "fail")
`.replace("sys.executable", `"${python}"`));
	report.venv.create = venvOk.ok && venvOk.out === "ok" ? "ok" : venvOk.out ?? "fail";
	if (report.venv.create !== "ok") report.fixes.push("venv 组件缺失（ensurepip 不可用）。Ubuntu/Debian: sudo apt install python3-venv；或直接用 --user --break-system-packages 装到用户级");

	// 输出
	if (asJson) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	console.log("=== dsh-lab-agent 环境自检 ===");
	console.log(`Python      : ${report.python.command} ${report.python.version}`);
	console.log(`pip         : ${report.pip.version}  PEP668=${report.pip.pep668}`);
	console.log(`user site   : ${report.python.userSitePackages}`);
	console.log(`user pkgs   : ${report.python.userLocalPkgs}`);
	console.log("");
	console.log("--- 关键包 ---");
	for (const [k, v] of Object.entries(report.packages)) console.log(`  ${k.padEnd(14)} ${v}`);
	console.log("");
	console.log("--- PDF 渲染器 ---");
	for (const [k, v] of Object.entries(report.renderers)) console.log(`  ${k.padEnd(14)} ${v}`);
	console.log("");
	console.log(`--- venv ---`);
	console.log(`  create      ${report.venv.create}`);
	console.log("");
	if (report.fixes.length) {
		console.log("--- 建议修复 ---");
		for (const f of report.fixes) console.log(`  * ${f}`);
	} else {
		console.log("环境就绪，无缺失依赖。");
	}
}

main().catch((error) => {
	console.error(`lab-doctor failed: ${error.message}`);
	process.exit(1);
});
