/**
 * dsh-lab-agent: Ketcher standalone 静态资源托管（0.3.2 合成路线工作台）。
 *
 * 需求：「实验条件的反应物/产物显示对应结构式，通过集成 Ketcher 方案显示」。
 * 前端是无打包单文件注入的 Harness client，无法把 Ketcher(React+WASM) 打进
 * bundle；这里把预构建的 Ketcher standalone 应用（client/assets/ketcher-standalone，
 * vite 一次构建产物，自包含 worker/wasm）作为同源静态前缀托管，client 用
 * iframe + postMessage 打开编辑弹层并回传 SMILES。
 *
 * 安全与结构：
 *  - 只服务 /api/lab-ketcher/* → client/assets/ketcher-standalone/ 下的文件，
 *    路径规范化后必须仍在该目录内（防目录穿越）；
 *  - 只允许 GET；MIME 按扩展名白名单；Cache-Control 允许长缓存（哈希文件名）；
 *  - denyCrossSite 与 artifact-download 一致：浏览器 fetch/img 同源即可，跨站拒绝。
 *
 * 更新资源：node 端构建脚本见 scripts/build-ketcher.mjs（暂以一次性构建产物
 * 入库；产物自带版本锁说明文件 client/assets/ketcher-standalone/VERSION）。
 */

import { Service } from "@deepseek-ai/cordis";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** 仓库内静态根：本文件在 lib/ 下，Ketcher 产物在 client/assets/ketcher-standalone。 */
export const KETCHER_ASSETS_ROOT = resolve(here, "..", "client", "assets", "ketcher-standalone");

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

/** 纯函数：把请求 path 规范化后映射到静态根内的安全绝对路径。
 *  只接受无 `..`/`.` 段的相对 URL 路径（可带多层子目录）；解码后先拒绝
 *  任何父目录跳转，再拼接到根下，杜绝目录穿越。 */
export function resolveKetcherAsset(requestPath) {
	let pathname;
	try {
		pathname = decodeURIComponent(String(requestPath ?? ""));
	} catch {
		pathname = String(requestPath ?? "");
	}
	if (!pathname.startsWith("/")) return null;
	// 拒绝原始/解码后出现的任何父目录与当前目录段（含 %2e%2e 之类已解码）
	if (/\.{1,2}(\\|\/|$)/.test(pathname)) return null;
	// 归一化反斜杠并剥离前导斜杠，得到相对段
	const rel = pathname.replace(/^\/+/, "").replace(/\\/g, "/");
	if (!rel || rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
	const target = resolve(KETCHER_ASSETS_ROOT, ...rel.split("/"));
	return target.startsWith(KETCHER_ASSETS_ROOT + sep) || target === KETCHER_ASSETS_ROOT ? target : null;
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

export class LabKetcherAssetsService extends Service {
	static inject = ["webServer"];

	constructor(ctx, config = {}) {
		super(ctx, "labKetcherAssets");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const webServer = this.ctx.get?.("webServer") ?? this.ctx.webServer;
		if (webServer?.register) {
			this.ctx.effect(() => webServer.register({
				kind: "prefix",
				path: "/api/lab-ketcher",
				handler: (req, res) => void this.handle(req, res)
			}), "lab-agent.ketcher-assets");
		}
	}

	async handle(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			send(res, 405, "method not allowed", { allow: "GET, HEAD" });
			return;
		}
		if (denyCrossSite(req)) {
			send(res, 403, "cross-site ketcher asset denied");
			return;
		}
		const url = new URL(req.url ?? "/api/lab-ketcher/", "http://localhost");
		const requestPath = url.pathname.replace(/^\/api\/lab-ketcher/, "") || "/index.html";
		if (requestPath.endsWith("/")) {
			send(res, 404, "directory listing disabled");
			return;
		}
		const target = resolveKetcherAsset(requestPath);
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
			res.writeHead(200, {
				"content-type": mime,
				"content-length": String(body.length),
				"cache-control": "public, max-age=86400",
				"x-content-type-options": "nosniff"
			});
			res.end(body);
		} catch (error) {
			const status = error?.code === "ENOENT" ? 404 : 500;
			send(res, status, error?.message || "asset read failed");
		}
	}
}

export default LabKetcherAssetsService;
