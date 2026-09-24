#!/usr/bin/env node
/**
 * dsh-lab-agent: 渲染助手 —— 把 PPT/PDF 变成可核对的 PNG（并可合成一张 contact sheet）。
 *
 * **渲染器优先级**（0.5.5-beta2 起）：
 *   1. **DSH 自带的 LibreOffice kit**（`@deepseek-ai/libreoffice-kit` 的 CLI `render` 子命令）——
 *      DSH 已经把它打进安装包（Windows 是 `libreoffice-kit-win32-x64` 约 341 MB，Linux 是
 *      `libreoffice-kit-wasm` 约 186 MB），所以**用户不需要自己装 LibreOffice**，也不需要
 *      PyMuPDF 做栅格化（kit 内部用 pdfium）。它还会回报 `missingFonts`。
 *   2. 兜底：宿主 `soffice` 转 PDF + 捆绑 Python 的 PyMuPDF 栅格化（开发机没有 kit 时的老路）。
 *
 * 为什么需要这个助手（0.5.4 现场复盘）：
 *   * Agent 自己拼 `soffice` 命令行时踩了坑：找不到 soffice、把 LibreOffice profile 留在
 *     `%LOCALAPPDATA%\Temp`（桌面壳沙箱拒绝写 → **静默不产出 PDF**，退出码却是 0）；
 *   * 逐页读图是 Agent 最贵的开销（现场 25 次读图，约 15 次可省）→ 默认额外合成一张
 *     contact sheet：一次读图看完整套页面的**版面**。
 *
 * 用法：
 *   node scripts/render-deck.mjs <deck.pptx|deck.pdf> [选项]
 *     --out <dir>            输出目录（缺省 <工作区>/.lab-tmp/render-<文件名>）
 *     --pages 1,3,5-7        只渲染这些页（缺省全部）
 *     --dpi 110              栅格化分辨率（缺省 110）
 *     --no-contact-sheet     不合成网格总览图
 *     --no-kit               不用 DSH 自带的 LibreOffice kit，强制走宿主 soffice 兜底路径
 *     --sheet-cols 3         总览图列数
 *     --json                 机器可读输出
 *
 * 退出码：0 成功；2 输入/环境/渲染失败（诊断在 stderr 或 JSON 的 errors 里）。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveSofficeExecutable } from "../lib/office-preview.js";
import { resolveAgentRuntime } from "../src/lab-runtime.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_HELPER = join(HERE, "pptx", "pdf_to_png.py");
/** 走 LibreOffice 转换的输入扩展名（与 lib/convert.js 的可转换集合保持一致）。 */
const OFFICE_EXTS = new Set([".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx", ".rtf", ".odp", ".odt", ".ods"]);

export function parseArgv(argv) {
	const options = { input: null, out: null, pages: "", dpi: 110, contactSheet: true, sheetCols: 3, json: false, help: false, noKit: false };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--json") options.json = true;
		else if (token === "--no-kit") options.noKit = true;
		else if (token === "--no-contact-sheet") options.contactSheet = false;
		else if (token === "--out") options.out = argv[++i];
		else if (token === "--pages") options.pages = argv[++i] ?? "";
		else if (token === "--dpi") options.dpi = Number(argv[++i]);
		else if (token === "--sheet-cols") options.sheetCols = Number(argv[++i]);
		else if (token === "-h" || token === "--help") options.help = true;
		else if (token.startsWith("--")) throw new Error(`未知参数：${token}`);
		else if (options.input === null) options.input = token;
		else throw new Error(`只接受一个输入文件，多余参数：${token}`);
	}
	return options;
}

/** `1,3,5-7` → `1,3,5,6,7`（kit CLI 只接受逗号列表，自己展开区间）。 */
export function expandPages(text) {
	const out = [];
	for (const chunk of String(text ?? "").split(",")) {
		const piece = chunk.trim();
		if (piece === "") continue;
		const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
		if (range === null) {
			out.push(piece);
			continue;
		}
		const [from, to] = [Number(range[1]), Number(range[2])];
		for (let page = Math.min(from, to); page <= Math.max(from, to); page += 1) out.push(String(page));
	}
	return out.join(",");
}

/** 运行子进程并回收输出（不抛错，交由调用方判定）。 */
export function run(command, args, { timeoutMs = 300000 } = {}) {
	return new Promise((settle) => {
		let child;
		try {
			child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			settle({ code: -1, stdout: "", stderr: error.message });
			return;
		}
		let stdout = "";
		let stderr = "";
		let done = false;
		const finish = (value) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			settle(value);
		};
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* 已退出 */
			}
			finish({ code: -1, stdout, stderr: `${stderr}\n[超时 ${timeoutMs} ms，已终止]` });
		}, timeoutMs);
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }));
		child.on("close", (code) => finish({ code, stdout, stderr }));
	});
}

/**
 * 解析 DSH 自带的 LibreOffice kit CLI。
 *
 * 不能只靠 `import('@deepseek-ai/libreoffice-kit')`：本脚本是独立 CLI，模块解析从
 * `scripts/` 往上一层层找，而安装后的插件树与 DSH 的 node_modules 可能不在同一条链上。
 * 所以先试着 import，再逐个探已知位置，最后用 `capabilities --json` 证伪（跑不通就当没有）。
 */
export async function resolveOfficeKit({ env = process.env, probe = true } = {}) {
	// 允许显式关闭：`--no-kit` 走这里；环境变量给 `off` 是同一语义（用户遇到 kit 问题时的逃生门）。
	if (String(env.IBM_LAB_AGENT_OFFICE_KIT ?? "").trim().toLowerCase() === "off") {
		return { cliPath: null, source: "disabled", backend: undefined };
	}
	const candidates = [];
	if (typeof env.IBM_LAB_AGENT_OFFICE_KIT === "string" && env.IBM_LAB_AGENT_OFFICE_KIT !== "") {
		candidates.push({ cliPath: env.IBM_LAB_AGENT_OFFICE_KIT, source: "env" });
	}
	try {
		const kit = await import("@deepseek-ai/libreoffice-kit");
		const runtime = await kit.discoverRuntime();
		if (typeof runtime?.cliPath === "string") candidates.push({ cliPath: runtime.cliPath, source: "module" });
	} catch {
		/* 解析不到就继续探路径 */
	}
	const roots = [
		env.DSH_HARNESS_NODE_MODULES,
		join(HERE, "..", "node_modules"),
		join(HERE, "..", "..", "node_modules"),
		join(HERE, "..", "..", "..", "node_modules")
	].filter((root) => typeof root === "string" && root !== "");
	for (const root of roots) {
		candidates.push({ cliPath: join(root, "@deepseek-ai", "libreoffice-kit", "lib", "cli.js"), source: "path" });
	}
	for (const candidate of candidates) {
		if (!existsSync(candidate.cliPath)) continue;
		if (!probe) return candidate;
		const result = await run(process.execPath, [candidate.cliPath, "capabilities", "--json"], { timeoutMs: 120000 });
		if (result.code === 0 && result.stdout.includes("\"conversions\"")) {
			let backend;
			try {
				backend = JSON.parse(result.stdout.trim().split("\n").pop())?.runtime?.backend;
			} catch {
				backend = undefined;
			}
			return { ...candidate, backend };
		}
	}
	return { cliPath: null, source: "unavailable", backend: undefined };
}

/**
 * 用 kit CLI 渲染：一条命令出逐页 PNG（kit 内部走 LibreOffice + pdfium）。
 *
 * 注意 `--output-dir` **必须不存在**（kit 自己 mkdir，不会 -p），所以每次先清出一个
 * 新目录再调用。返回 kit 的 JSON 结果（含 images 与 missingFonts）。
 */
export async function renderViaKit({ cliPath, input, outDir, pages, dpi, errors }) {
	const kitDir = join(outDir, "kit-pages");
	await rm(kitDir, { recursive: true, force: true });
	const args = [cliPath, "render", "--input", input, "--output-dir", kitDir, "--dpi", String(dpi)];
	const expanded = expandPages(pages);
	args.push("--pages", expanded === "" ? "all" : expanded);
	const result = await run(process.execPath, args);
	let payload;
	try {
		payload = JSON.parse(result.stdout.trim().split("\n").pop() ?? "");
	} catch {
		errors.push(`LibreOffice kit 输出无法解析（退出码 ${result.code}）：${(result.stdout || result.stderr || "").trim().slice(0, 400)}`);
		return null;
	}
	if (result.code !== 0 || payload?.code === "failed" || !Array.isArray(payload?.images)) {
		errors.push(`LibreOffice kit 渲染失败（退出码 ${result.code}）：${JSON.stringify(payload?.error ?? payload).slice(0, 400)}`);
		return null;
	}
	return {
		backend: payload.backend,
		rasterEngine: payload.rasterEngine,
		missingFonts: Array.isArray(payload.missingFonts) ? payload.missingFonts : [],
		pages: payload.images.map((image) => ({ page: image.page, path: image.path, width: image.width, height: image.height }))
	};
}

/** 兜底：宿主 soffice 转 PDF。profile 固定放在运行时临时目录里（沙箱拒绝写系统临时目录）。 */
export async function convertToPdf({ input, outDir, runtime, soffice, errors }) {
	const profile = join(runtime.tempDir, "lo-profile");
	await mkdir(profile, { recursive: true });
	const result = await run(soffice.command, [
		`-env:UserInstallation=${pathToFileURL(profile).href}`,
		"--headless",
		"--norestore",
		"--invisible",
		"--convert-to", "pdf",
		"--outdir", outDir,
		input
	]);
	const expected = join(outDir, `${basename(input, extname(input))}.pdf`);
	if (!existsSync(expected)) {
		errors.push(
			`LibreOffice 未产出 PDF（退出码 ${result.code}）。profile 已指向 ${profile}；` +
			"若该目录可写仍失败，通常是 soffice 已有实例占用或被杀毒拦截。" +
			`stderr: ${(result.stderr || "").trim().slice(0, 400) || "（空）"}`
		);
		return null;
	}
	return expected;
}

async function main() {
	let options;
	try {
		options = parseArgv(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		return 2;
	}
	if (options.help) {
		console.log("用法：node scripts/render-deck.mjs <deck.pptx|deck.pdf> [--out dir] [--pages 1,3,5-7] [--dpi 110] [--no-contact-sheet] [--no-kit] [--json]");
		return 0;
	}
	if (!options.input) {
		console.error("缺少输入文件：node scripts/render-deck.mjs <deck.pptx|deck.pdf>");
		return 2;
	}
	const input = resolve(options.input);
	if (!existsSync(input)) {
		console.error(`输入文件不存在：${input}`);
		return 2;
	}

	const errors = [];
	const notes = [];
	const runtime = await resolveAgentRuntime();
	const tempDir = options.out ? resolve(options.out) : join(runtime.tempDir, `render-${basename(input, extname(input))}`);
	await mkdir(tempDir, { recursive: true });

	const extension = extname(input).toLowerCase();
	if (extension !== ".pdf" && !OFFICE_EXTS.has(extension)) {
		errors.push(`不支持的输入类型 ${extension}：只接受 .pdf 与 Office 文档（${[...OFFICE_EXTS].join(" ")}）。`);
		console.error(errors.join("\n"));
		return 2;
	}

	// ── 路径 1：DSH 自带 kit（首选）────────────────────────────────────────────
	const kit = options.noKit ? { cliPath: null, source: "disabled", backend: undefined } : await resolveOfficeKit();
	let pages = [];
	let sheetSource = null;
	let usedKit = false;
	if (kit.cliPath !== null) {
		const rendered = await renderViaKit({ cliPath: kit.cliPath, input, outDir: tempDir, pages: options.pages, dpi: options.dpi, errors });
		if (rendered !== null) {
			usedKit = true;
			pages = rendered.pages;
			sheetSource = join(tempDir, "kit-pages");
			notes.push(`渲染器：DSH 自带 LibreOffice kit（backend=${rendered.backend ?? "?"}，rasterEngine=${rendered.rasterEngine ?? "?"}），无需宿主安装 LibreOffice。`);
			notes.push(
				"注意：kit 的渲染会在图片占位符上画一行英文 “Double-click to add an image” —— 那是它自带的占位提示，" +
				"**不代表图没插进去**（实测同一份 deck 在宿主 LibreOffice 下不显示这行）。判断图是否插入请以 inspect_deck.py 的 XML 结论为准。"
			);
			if (rendered.missingFonts.length > 0) {
				notes.push(
					`⚠ 本机缺少这些字体：${rendered.missingFonts.join("、")} —— 渲染会用替代字体，字形与 PowerPoint 里可能不同；` +
					"核对字号/排版可以用，核对字形请以目标机器（Windows）为准。"
				);
			}
		} else {
			notes.push("DSH 自带 kit 渲染失败，回退到宿主 LibreOffice。");
		}
	}

	// ── 路径 2：宿主 soffice + PyMuPDF（兜底）─────────────────────────────────
	if (!usedKit) {
		if (!runtime.python.available) {
			errors.push("没有可用的 Python（兜底路径需要 PyMuPDF 栅格化）：请确认安装包完整，或由桌面壳注入 IBM_LAB_AGENT_BUNDLED_PYTHON。");
			console.error(errors.join("\n"));
			return 2;
		}
		let pdfPath = input;
		if (extension !== ".pdf") {
			const soffice = await resolveSofficeExecutable({ explicit: process.env.LAB_OFFICE_RENDERER });
			if (!soffice.command) {
				errors.push(`既没有 DSH 自带 kit，也没找到 LibreOffice：${soffice.hint}（可用 LAB_OFFICE_RENDERER 指定 soffice 路径）。`);
				console.error(errors.join("\n"));
				return 2;
			}
			pdfPath = await convertToPdf({ input, outDir: tempDir, runtime, soffice, errors });
			if (!pdfPath) {
				console.error(errors.join("\n"));
				return 2;
			}
			notes.push("渲染器：宿主 LibreOffice → PDF → PyMuPDF 栅格化（兜底路径）。");
		}
		const helperArgs = ["--pdf", pdfPath, "--out", tempDir, "--dpi", String(options.dpi), "--json"];
		if (options.pages) helperArgs.push("--pages", String(options.pages));
		if (options.contactSheet) helperArgs.push("--contact-sheet", "--sheet-cols", String(options.sheetCols));
		const [pythonExe, ...pythonPrefix] = runtime.python.argv;
		const rendered = await run(pythonExe, [...pythonPrefix, PDF_HELPER, ...helperArgs]);
		let parsed = null;
		try {
			parsed = JSON.parse(rendered.stdout.trim().split("\n").pop() ?? "");
		} catch {
			errors.push(`栅格化输出无法解析：${(rendered.stdout || rendered.stderr || "").trim().slice(0, 400)}`);
		}
		pages = parsed?.pages ?? [];
		sheetSource = null;
		if (options.contactSheet && parsed?.contactSheet) notes.push(`contact sheet：${parsed.contactSheet}`);
	}

	// kit 路径下总览图由我们的 Pillow 助手从逐页 PNG 合成（kit 只出逐页图）。
	let contactSheet = null;
	if (usedKit && options.contactSheet && pages.length > 0) {
		const [pythonExe, ...pythonPrefix] = runtime.python.argv;
		if (!runtime.python.available) {
			notes.push("没有可用的 Python，跳过 contact sheet（逐页 PNG 仍可用）。");
		} else {
			const sheetPath = join(tempDir, "contact-sheet.png");
			const sheet = await run(pythonExe, [...pythonPrefix, PDF_HELPER, "--png-dir", sheetSource, "--out", tempDir, "--sheet-cols", String(options.sheetCols), "--contact-sheet", "--json"], { timeoutMs: 180000 });
			let parsedSheet = null;
			try {
				parsedSheet = JSON.parse(sheet.stdout.trim().split("\n").pop() ?? "");
			} catch {
				parsedSheet = null;
			}
			contactSheet = parsedSheet?.contactSheet ?? (existsSync(sheetPath) ? sheetPath : null);
			if (contactSheet === null) notes.push("contact sheet 合成失败（逐页 PNG 仍可用）。");
		}
	} else if (!usedKit) {
		contactSheet = pages.length > 0 ? join(tempDir, "contact-sheet.png") : null;
		if (contactSheet !== null && !existsSync(contactSheet)) contactSheet = null;
	}

	const payload = {
		ok: errors.length === 0 && pages.length > 0,
		input,
		outDir: tempDir,
		renderer: usedKit ? "dsh-libreoffice-kit" : "host-soffice",
		kitBackend: usedKit ? (kit.backend ?? null) : null,
		pages,
		contactSheet,
		python: runtime.python.command,
		tempDir: runtime.tempDir,
		notes,
		errors
	};
	if (options.json) {
		console.log(JSON.stringify(payload, null, 2));
	} else if (payload.ok) {
		console.log(`渲染完成：${pages.length} 页 → ${tempDir}`);
		for (const note of notes) console.log(`  · ${note}`);
		if (contactSheet) console.log(`contact sheet（先看这张核版面）：${contactSheet}`);
		console.log("需要看清文字时再单独读某一页；不要为了核对版面逐页读图。");
	} else {
		console.error(["渲染失败：", ...errors, ...notes].join("\n"));
	}
	return payload.ok ? 0 : 2;
}

// 只有被直接执行时才跑 CLI：被 import（单元测试）时不能有副作用。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	main().then((code) => {
		process.exitCode = code;
	});
}
