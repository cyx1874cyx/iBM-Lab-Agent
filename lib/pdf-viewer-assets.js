/**
 * dsh-lab-agent: Evidence 原文 PDF 定位查看器静态资源托管（RC2）。
 *
 * 需求（对接文档 §9）：审核抽屉内嵌 PDF.js 查看器，自动跳页 + 定位高亮 quote。
 * 前端 client/index.js 是单文件注入（禁止 import），无法把 pdfjs-dist 打进 bundle；
 * 这里与 lib/ketcher-assets.js 同构，把预构建的 pdf-viewer standalone 应用
 * （client/assets/pdf-viewer-standalone，vite 一次构建产物，自包含 pdfjs + worker）
 * 作为同源静态前缀托管，client 用 iframe + postMessage 打开并回传定位结果。
 *
 * 安全与结构：
 *  - 只服务 /api/lab-pdf-viewer/* → client/assets/pdf-viewer-standalone/ 下的文件，
 *    路径规范化后必须仍在该目录内（防目录穿越）；
 *  - 只允许 GET；MIME 按扩展名白名单；入口/worker 禁止缓存，哈希资源允许长缓存；
 *  - denyCrossSite 与 ketcher-assets 一致：浏览器 fetch/img/iframe 同源即可，跨站拒绝。
 *  - PDF 二进制本身不经本服务：宿主通过 /api/lab-artifacts?kind=pdf&bundleId=..&preview=1
 *    获取（PDF.js getDocument({url}) 可直接消费同源 URL），本服务只托管 viewer 代码与 worker。
 */

import { Service } from "@deepseek-ai/cordis";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** 仓库内静态根：本文件在 lib/ 下，pdf-viewer 产物在 client/assets/pdf-viewer-standalone。 */
export const PDF_VIEWER_ASSETS_ROOT = resolve(here, "..", "client", "assets", "pdf-viewer-standalone");

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8"
};

/** 纯函数：把请求 path 规范化后映射到静态根内的安全绝对路径（与 ketcher-assets 同构）。 */
export function resolvePdfViewerAsset(requestPath) {
	let pathname;
	try {
		pathname = decodeURIComponent(String(requestPath ?? ""));
	} catch {
		pathname = String(requestPath ?? "");
	}
	if (!pathname.startsWith("/")) return null;
	if (/\.{1,2}(\\|\/|$)/.test(pathname)) return null;
	const rel = pathname.replace(/^\/+/, "").replace(/\\/g, "/");
	if (!rel || rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	const target = resolve(PDF_VIEWER_ASSETS_ROOT, ...rel.split("/"));
	return target.startsWith(PDF_VIEWER_ASSETS_ROOT + sep) || target === PDF_VIEWER_ASSETS_ROOT ? target : null;
}

function denyCrossSite(req) {
	const fetchSite = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
	if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return true;
	const origin = req.headers.origin;
	const host = req.headers.host;
	if (!origin || !host) return false;
	try {
		return new URL(String(origin)).host !== String(host);
	} catch {
		return true;
	}
}

function send(res, status, body, extra = {}) {
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "content-length": String(Buffer.byteLength(body)), "cache-control": "no-store", ...extra });
	res.end(body);
}

export class LabPdfViewerAssetsService extends Service {
	static inject = ["webServer"];

	constructor(ctx, config = {}) {
		super(ctx, "labPdfViewerAssets");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const webServer = this.ctx.get?.("webServer") ?? this.ctx.webServer;
		if (webServer?.register) {
			this.ctx.effect(() => webServer.register({
				kind: "prefix",
				path: "/api/lab-pdf-viewer",
				handler: (req, res) => void this.handle(req, res)
			}), "lab-agent.pdf-viewer-assets");
		}
	}

	async handle(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			send(res, 405, "method not allowed", { allow: "GET, HEAD" });
			return;
		}
		if (denyCrossSite(req)) {
			send(res, 403, "cross-site pdf-viewer asset denied");
			return;
		}
		const url = new URL(req.url ?? "/api/lab-pdf-viewer/", "http://localhost");
		const requestPath = url.pathname.replace(/^\/api\/lab-pdf-viewer/, "") || "/index.html";
		if (requestPath.endsWith("/")) {
			send(res, 404, "directory listing disabled");
			return;
		}
		const target = resolvePdfViewerAsset(requestPath);
		if (!target) {
			send(res, 400, "invalid asset path");
			return;
		}
		try {
			const info = await stat(target);
			if (!info.isFile()) {
				send(res, 404, "asset not found");
				return;
			}
			const ext = target.slice(target.lastIndexOf(".")).toLowerCase();
			const mime = MIME[ext] ?? "application/octet-stream";
			const body = await readFile(target);
			// HTML 和 worker 的 URL 固定，桌面 WebView2 跨应用升级仍会保留 HTTP 缓存。
			// 入口与 worker 禁止缓存；带内容哈希的 JS/CSS 才允许长缓存。
			const cacheControl = ext === ".html" || target.endsWith("pdf.worker.mjs") || target.endsWith("pdf.worker.min.mjs")
				? "no-store"
				: "public, max-age=86400, immutable";
			res.writeHead(200, {
				"content-type": mime,
				"content-length": String(body.length),
				"cache-control": cacheControl,
				"x-content-type-options": "nosniff"
			});
			res.end(body);
		} catch (error) {
			const status = error?.code === "ENOENT" ? 404 : 500;
			send(res, status, error?.message || "asset read failed");
		}
	}
}

export default LabPdfViewerAssetsService;
