#!/usr/bin/env node
/**
 * dsh-lab-agent: 渲染助手 —— 把 PPT/PDF 变成可核对的 PNG（并可合成一张 contact sheet）。
 *
 * 为什么需要它（0.5.4 现场复盘的两条教训）：
 *   1. Agent 自己拼 `soffice` 命令行时踩了三个坑：不知道软件自带运行时在哪、找不到
 *      soffice、把 LibreOffice 的 user profile 留在了 `%LOCALAPPDATA%\Temp`（桌面壳
 *      沙箱拒绝写 → LibreOffice **静默不产出 PDF**，退出码却是 0）。本脚本复用应用
 *      自己的渲染器解析链（`lib/office-preview.js`），把 profile 固定放在工作区的
 *      `.lab-tmp` 下，并在"退出码 0 但没产出 PDF"时给出明确诊断。
 *   2. 逐页读图是 Agent 最贵的开销（现场 25 次读图，约 15 次可省）。默认额外合成一张
 *      contact sheet：一次读图看完整套页面的**版面**，只在发现异常时再看单页细节。
 *
 * 用法：
 *   node scripts/render-deck.mjs <deck.pptx|deck.pdf> [选项]
 *     --out <dir>            输出目录（缺省 <工作区>/.lab-tmp/render-<文件名>）
 *     --pages 1,3,5-7        只渲染这些页（缺省全部）
 *     --dpi 110              栅格化分辨率（缺省 110）
 *     --no-contact-sheet     不合成网格总览图
 *     --sheet-cols 3         总览图列数
 *     --json                 机器可读输出
 *
 * 退出码：0 成功；2 输入/环境/渲染失败（诊断在 stderr 或 JSON 的 errors 里）。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveSofficeExecutable } from "../lib/office-preview.js";
import { resolveAgentRuntime } from "../src/lab-runtime.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_HELPER = join(HERE, "pptx", "pdf_to_png.py");
/** 走 LibreOffice 转换的输入扩展名（与 lib/convert.js 的可转换集合保持一致）。 */
const OFFICE_EXTS = new Set([".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx", ".rtf", ".odp", ".odt", ".ods"]);

export function parseArgv(argv) {
	const options = { input: null, out: null, pages: "", dpi: 110, contactSheet: true, sheetCols: 3, json: false, help: false };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--json") options.json = true;
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

/** 运行子进程并回收输出（不抛错，交由调用方判定）。 */
export function run(command, args, { timeoutMs = 180000 } = {}) {
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
 * Office 文档 → PDF。
 *
 * profile 固定放在运行时临时目录里（工作区内的 `.lab-tmp`）：桌面壳的沙箱拒绝写
 * `%LOCALAPPDATA%\Temp`，而 LibreOffice 写不了 profile 时会**静默不产出 PDF**、
 * 退出码仍是 0 —— 这里对"没产出文件"单独判定并报出来。
 */
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
		console.log("用法：node scripts/render-deck.mjs <deck.pptx|deck.pdf> [--out dir] [--pages 1,3,5-7] [--dpi 110] [--no-contact-sheet] [--json]");
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
	const runtime = await resolveAgentRuntime();
	if (!runtime.python.available) {
		errors.push("没有可用的 Python（PDF 栅格化需要 PyMuPDF）：请确认安装包完整，或由桌面壳注入 IBM_LAB_AGENT_BUNDLED_PYTHON。");
		console.error(errors.join("\n"));
		return 2;
	}
	const tempDir = options.out ? resolve(options.out) : join(runtime.tempDir, `render-${basename(input, extname(input))}`);
	await mkdir(tempDir, { recursive: true });

	const extension = extname(input).toLowerCase();
	let pdfPath = input;
	if (extension !== ".pdf") {
		if (!OFFICE_EXTS.has(extension)) {
			errors.push(`不支持的输入类型 ${extension}：只接受 .pdf 与 Office 文档（${[...OFFICE_EXTS].join(" ")}）。`);
			console.error(errors.join("\n"));
			return 2;
		}
		const soffice = await resolveSofficeExecutable({ explicit: process.env.LAB_OFFICE_RENDERER });
		if (!soffice.command) {
			errors.push(`未找到 LibreOffice：${soffice.hint}（可用 LAB_OFFICE_RENDERER 指定 soffice 路径）。`);
			console.error(errors.join("\n"));
			return 2;
		}
		pdfPath = await convertToPdf({ input, outDir: tempDir, runtime, soffice, errors });
		if (!pdfPath) {
			console.error(errors.join("\n"));
			return 2;
		}
	}

	const helperArgs = ["--pdf", pdfPath, "--out", tempDir, "--dpi", String(options.dpi), "--json"];
	if (options.pages) helperArgs.push("--pages", String(options.pages));
	if (options.contactSheet) helperArgs.push("--contact-sheet", "--sheet-cols", String(options.sheetCols));
	// python 的 argv 前缀可能是多 token（Windows 的 `py -3.12`），必须整体作为前缀。
	const [pythonExe, ...pythonPrefix] = runtime.python.argv;
	const rendered = await run(pythonExe, [...pythonPrefix, PDF_HELPER, ...helperArgs]);
	let parsed = null;
	try {
		parsed = JSON.parse(rendered.stdout.trim().split("\n").pop() ?? "");
	} catch {
		errors.push(`栅格化输出无法解析：${(rendered.stdout || rendered.stderr || "").trim().slice(0, 400)}`);
	}

	const payload = {
		ok: parsed?.ok === true && errors.length === 0,
		input,
		pdf: pdfPath,
		outDir: tempDir,
		pages: parsed?.pages ?? [],
		contactSheet: parsed?.contactSheet ?? null,
		python: runtime.python.command,
		tempDir: runtime.tempDir,
		errors: [...errors, ...(parsed?.errors ?? [])]
	};
	if (options.json) {
		console.log(JSON.stringify(payload, null, 2));
	} else if (payload.ok) {
		console.log(`渲染完成：${payload.pages.length} 页 → ${tempDir}`);
		if (payload.contactSheet) console.log(`contact sheet（先看这张核版面）：${payload.contactSheet}`);
		console.log("需要看清文字时再单独读某一页；不要为了核对版面逐页读图。");
	} else {
		console.error(["渲染失败：", ...payload.errors].join("\n"));
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
