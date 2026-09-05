/**
 * Browser helper: 用系统 Edge/Chrome headless + puppeteer-core 打开仓库内
 * 的 ketcher-standalone 页面（完全离线资产），以 postMessage 宿主协议驱动
 * 真实 Ketcher。仓库不下载浏览器——复用本机已安装的 Edge/Chrome。
 */

/* global window */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KETCHER_STANDALONE = resolve(fileURLToPath(new URL("../../..", import.meta.url)), "client", "assets", "ketcher-standalone");

const MIME = {
	".html": "text/html;charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".wasm": "application/wasm"
};

/** 极简静态服务器：只服务 ketcher-standalone 目录（离线资产，无任何外部依赖）。 */
export function serveKetcherStandalone(root = KETCHER_STANDALONE) {
	return createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			let pathname = decodeURIComponent(url.pathname);
			if (pathname === "/" || pathname === "") pathname = "/index.html";
			const file = join(root, normalize(pathname).replace(/^([/\\])+/, ""));
			if (!file.startsWith(resolve(root))) {
				res.writeHead(403).end("forbidden");
				return;
			}
			if (!existsSync(file) || !statSync(file).isFile()) {
				res.writeHead(404).end("not found");
				return;
			}
			const body = await readFile(file);
			res.writeHead(200, {
				"content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
				"content-length": body.length,
				"cache-control": "no-store"
			});
			res.end(body);
		} catch {
			res.writeHead(500).end("server error");
		}
	});
}

/** 探测本机浏览器可执行文件（优先 Edge，其次 Chrome；可用环境变量覆盖）。 */
export function resolveBrowserExecutable() {
	if (process.env.LAB_BROWSER_PATH && existsSync(process.env.LAB_BROWSER_PATH)) return process.env.LAB_BROWSER_PATH;
	const candidates = [
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		"/usr/bin/microsoft-edge",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** 启动 headless 浏览器并打开 ketcher 页面。返回 { browser, page, messages }。 */
export async function launchKetcherPage({ port = 0, headless = "new", executablePath = resolveBrowserExecutable(), timeoutMs = 30000 } = {}) {
	if (!executablePath) {
		throw new Error("未找到系统 Edge/Chrome。请安装 Edge（或设置 LAB_BROWSER_PATH 指向浏览器可执行文件）以运行浏览器验收。");
	}
	const { default: puppeteer } = await import("puppeteer-core");
	const server = serveKetcherStandalone();
	let browser;
	try {
		await new Promise((resolvePromise, rejectPromise) => {
			server.once("error", rejectPromise);
			server.listen(port, "127.0.0.1", () => { server.off("error", rejectPromise); resolvePromise(); });
		});
		const address = server.address();
		const baseUrl = `http://127.0.0.1:${address.port}`;
		browser = await puppeteer.launch({
			executablePath,
			headless,
			args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--allow-file-access-from-files"]
		});
		const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	// 宿主消息收集器：必须在目标文档任何脚本之前安装（导航会清空 about:blank
	// 上下文里的监听器）——evaluateOnNewDocument 保证每份文档加载前先注册，
	// 不丢失 Ketcher onInit 的 ready（慢于脚本执行，但绝不早于本注入）。
	await page.evaluateOnNewDocument(() => {
		window.__ketchMsgs = [];
		window.__ketchErrors = [];
		window.addEventListener("message", (event) => {
			const data = event.data || {};
			if (["ready", "image", "image:error", "phase", "molecule", "cancel"].includes(data?.type)) {
				window.__ketchMsgs.push({ type: data.type, requestId: data.requestId, dataUrl: data.dataUrl, format: data.format, phase: data.phase, message: data.message, smiles: data.smiles });
			}
		});
		window.addEventListener("error", (event) => { window.__ketchErrors.push(String(event.message || event.error || "").slice(0, 300)); });
		window.addEventListener("unhandledrejection", (event) => { window.__ketchErrors.push("unhandledrejection: " + String(event.reason || "").slice(0, 300)); });
	});
	const messages = [];
	await page.goto(`${baseUrl}/index.html`, { waitUntil: "load", timeout: timeoutMs });
	// goto 完成后再补一次（防极端时序：壳在 load 事件前已发 ready）
	await page.evaluate(() => {
		if (!window.__ketchMsgs) { window.__ketchMsgs = []; window.__ketchErrors = []; }
	});
		return {
		browser,
		page,
		server,
		baseUrl,
		messages,
		/** 等待某类消息出现（轮询页面收集器，超时抛错给出已收消息摘要）。 */
		async waitFor(type, { timeout = 30000, since = 0, predicate = null } = {}) {
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				const snapshot = await page.evaluate(() => (window.__ketchMsgs || []).slice());
				const match = snapshot.slice(since).find((row) => row.type === type && (!predicate || predicate(row)));
				if (match) return { index: snapshot.indexOf(match), message: match };
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
			}
			const snapshot = await page.evaluate(() => (window.__ketchMsgs || []).slice());
			throw new Error(`timeout waiting for ${type}；已收消息：${JSON.stringify(snapshot.slice(since)).slice(0, 400)}`);
		},
		/** 向 shell 发宿主指令（主帧对自身 postMessage，shell onMsg 会处理）。 */
		async post(kind, payload = {}) {
			await page.evaluate(({ kind: k, payload: p }) => {
				window.postMessage({ type: k, requestId: p.requestId ?? `t${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...p }, window.location.origin);
			}, { kind, payload });
		},
		async close() {
			await browser.close().catch(() => {});
			await new Promise((resolvePromise) => server.close(resolvePromise));
		}
		};
	} catch (error) {
		if (browser) await browser.close().catch(() => {});
		if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
		throw error;
	}
}
