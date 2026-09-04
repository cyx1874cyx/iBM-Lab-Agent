/**
 * dsh-lab-agent: Evidence 原文截图端点（0.3.2 合成路线工作台）。
 *
 * 需求：「文献来源板块直接截取原文截图进行人工审核」。Evidence 记录
 * bundleId/documentId/page/bbox/excerpt；本服务把已捕获原文 PDF 的对应页
 * （可按 bbox 裁切）渲染成 PNG，供前端 Evidence 卡内嵌展示与人工核对。
 *
 * 设计（与 lib/artifact-download.js 同构）：
 *  - 同源 HTTP 前缀 /api/lab-evidence-shot，GET，query: routeId + evidenceId
 *    (+ bbox 可覆盖记录值；zoom 默认 2.0)；
 *  - 渲染脚本 scripts/evidence-shot.py（PyMuPDF/fitz），与 rdkit calc.py
 *    相同的解释器解析策略（venv → bundled → py/python），fitz 缺失时返回
 *    503 + 明确原因（界面降级为"原文截图不可用"，不静默给假图）；
 *  - 截图文件缓存到 evidenceShotsDir，按 <bundleId>-<page>-<zoom>.png 命名，
 *    原始 PDF 不落盘（直接由 tasks.bundleFile 校验后读入内存，写临时文件
 *    给 fitz）；
 *  - 未捕获原文 / 无 page / 页越界 / 跨站拒绝都返回明确错误，不猜不补。
 */

import { Service } from "@deepseek-ai/cordis";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePythonExecutable } from "../src/python-env.js";

const here = dirname(fileURLToPath(import.meta.url));
const SHOT_SCRIPT = resolve(here, "..", "scripts", "evidence-shot.py");

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** 纯函数：从 evidence 行取页码（page 支持 "12"、"p.12"、"S12" 等）。 */
export function pageNumberFrom(page) {
	if (page === undefined || page === null || page === "") return undefined;
	const text = String(page);
	const match = /\d+/.exec(text);
	return match ? Number(match[0]) : undefined;
}

/** 纯函数：从 evidence 行取 bbox（[x1,y1,x2,y2] 全部为有限数）。 */
export function bboxFrom(row) {
	const bbox = row?.bbox ?? row?.shotBbox;
	if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;
	const nums = bbox.map(Number);
	return nums.every((value) => Number.isFinite(value)) ? nums : undefined;
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

function sendError(res, status, message) {
	const body = Buffer.from(String(message), "utf8");
	res.writeHead(status, {
		"content-type": "text/plain;charset=utf-8",
		"content-length": String(body.length),
		"cache-control": "no-store"
	});
	res.end(body);
}

/** 用统一 resolver 找可执行 python，并探测 fitz。返回 { python } 或抛错。 */
async function resolveFitzPython({ venvPython, bundledPython, platform = process.platform }) {
	const resolved = await resolvePythonExecutable({ venvPython, bundledPython, platform });
	if (!resolved.command) {
		throw new Error("未找到可用 Python（无 venv，且 py/python 均不可用）");
	}
	return resolved.command;
}

/**
 * 渲染 PDF 内存 buffer 的指定页为 PNG。PDF 经 tasks.bundleFile 校验读入内存，
 * 这里先写临时文件供 fitz 打开，渲染后删除。
 * @returns { png: Buffer, width, height }
 */
export async function renderPageToPng({ pdfBuffer, page, bbox, zoom = 2.0, pythonCommand, workDir }) {
	await mkdir(workDir, { recursive: true });
	const hash = createHash("sha256").update(pdfBuffer).digest("hex").slice(0, 24);
	const pdfTmp = join(workDir, `${hash}.pdf`);
	const pngTmp = join(workDir, `${hash}-p${page}${bbox ? "-b" : ""}z${zoom}.png`);
	try {
		await writeFile(pdfTmp, pdfBuffer);
		const args = [SHOT_SCRIPT, "--pdf", pdfTmp, "--page", String(page), "--out", pngTmp, "--zoom", String(zoom)];
		if (bbox) args.push("--bbox", bbox.map((n) => Number(n).toFixed(2)).join(","));
		await new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(pythonCommand[0], [...pythonCommand.slice(1), ...args], {
				stdio: ["ignore", "pipe", "pipe"]
			});
			let stderr = "";
			child.stderr.on("data", (chunk) => (stderr += chunk));
			child.on("error", rejectPromise);
			child.on("exit", (code) => {
				if (code === 0) resolvePromise();
				else rejectPromise(new Error(`evidence-shot render failed (exit ${code}): ${stderr.trim().slice(0, 300) || "fitz 不可用?"}`));
			});
		});
		const png = await readFile(pngTmp);
		return { png };
	} finally {
		for (const path of [pdfTmp, pngTmp]) {
			try {
				await rm(path, { force: true });
			} catch {
				/* 清理失败不影响结果 */
			}
		}
	}
}

export class LabEvidenceShotService extends Service {
	static inject = ["labTasks", "labSynthesis", "webServer"];

	constructor(ctx, config = {}) {
		super(ctx, "labEvidenceShot");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const webServer = this.ctx.get?.("webServer") ?? this.ctx.webServer;
		if (webServer?.register) {
			this.ctx.effect(() => webServer.register({
				kind: "prefix",
				path: "/api/lab-evidence-shot",
				handler: (req, res) => void this.handle(req, res)
			}), "lab-agent.evidence-shot");
		}
	}

	/** 定位 evidence → bundle → 校验 → 渲染缓存 PNG。 */
	async handle(req, res) {
		if (req.method !== "GET") {
			res.writeHead(405, { allow: "GET" });
			res.end("method not allowed");
			return;
		}
		if (denyCrossSite(req)) {
			sendError(res, 403, "cross-site evidence shot denied");
			return;
		}
		const url = new URL(req.url ?? "/api/lab-evidence-shot", "http://localhost");
		const routeId = url.searchParams.get("routeId") ?? "";
		const evidenceId = url.searchParams.get("evidenceId") ?? "";
		if (!ID_RE.test(routeId) || !ID_RE.test(evidenceId)) {
			sendError(res, 400, "invalid routeId/evidenceId");
			return;
		}
		try {
			const synthesis = this.ctx.labSynthesis;
			const evidence = synthesis.evidenceById(evidenceId);
			if (!evidence || evidence.routeId !== routeId) {
				sendError(res, 404, "evidence not found for route");
				return;
			}
			synthesis.getRoute(routeId); // 校验路线存在
			const bundleId = evidence.bundleId ?? evidence.documentId;
			const page = pageNumberFrom(evidence.page);
			if (!bundleId || !page) {
				sendError(res, 422, "evidence 缺少 bundleId/documentId 或页码，无法渲染原文截图");
				return;
			}
			const kind = url.searchParams.get("kind") === "si" ? "si" : "pdf";
			let file;
			try {
				file = await this.ctx.labTasks.bundleFile(bundleId, kind);
			} catch (error) {
				sendError(res, 404, `原文未归档或不可读：${error.message || "bundleFile failed"}（截图仅对已捕获原文可用）`);
				return;
			}
			const bbox = bboxFrom(evidence);
			const zoom = Math.min(Math.max(Number(url.searchParams.get("zoom") ?? 2.0) || 2.0, 1.0), 4.0);
			const cacheDir = this.config.cacheDir ?? join(process.cwd(), "evidence-shots");
			const sha = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
			const cacheName = `${bundleId}-${sha}-p${page}${bbox ? `-b${bbox.join("x")}` : ""}-z${zoom}.png`;
			const cachePath = join(cacheDir, cacheName);
			// 防御：文件名只来自白名单 bundleId + 哈希 + 数字。
			if (!cacheName.match(/^[A-Za-z0-9_-]+\.png$/)) {
				sendError(res, 500, "invalid cache name");
				return;
			}
			if (!existsSync(cachePath)) {
				const venvPython = this.config.venvDir ? join(this.config.venvDir, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python") : undefined;
				const pythonCommand = await resolveFitzPython({ venvPython });
				await mkdir(cacheDir, { recursive: true });
				const rendered = await renderPageToPng({ pdfBuffer: file.buffer, page, bbox, zoom, pythonCommand, workDir: cacheDir });
				await writeFile(cachePath, rendered.png);
			}
			const png = await readFile(cachePath);
			res.writeHead(200, {
				"content-type": "image/png",
				"content-length": String(png.length),
				"cache-control": "public, max-age=86400",
				"x-content-type-options": "nosniff"
			});
			res.end(png);
		} catch (error) {
			const message = error?.message || String(error);
			const status = /python|fitz|venv|解释器/i.test(message) ? 503 : 500;
			sendError(res, status, message.slice(0, 300));
		}
	}
}

export default LabEvidenceShotService;
