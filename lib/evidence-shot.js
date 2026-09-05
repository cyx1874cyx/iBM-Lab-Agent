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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePythonExecutable } from "../src/python-env.js";

const here = dirname(fileURLToPath(import.meta.url));
const SHOT_SCRIPT = resolve(here, "..", "scripts", "evidence-shot.py");

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** §11.2：超时后终止整个 python/fitz 进程树（win: taskkill /T；其它: 进程组）。 */
export function killPythonTree(child, { platform = process.platform } = {}) {
	if (!child || typeof child.pid !== "number") return;
	try {
		if (platform === "win32") {
			spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
		} else {
			try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
		}
	} catch {
		/* 终止尽力而为 */
	}
}

/** 同缓存键的渲染请求合并：避免同一 PDF 页被并发触发多个 python 渲染进程（§11.5）。 */
const inflightRenders = new Map();

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
 * rc.4 review（§11）：python 子进程有显式超时（默认 45s，可配置）；超时后终止
 * 整个进程树并清理临时 PDF/PNG；stderr 缓冲设上限，防止异常进程持续输出导致
 * 内存增长。
 * @returns { png: Buffer, width, height }
 */
export async function renderPageToPng({ pdfBuffer, page, bbox, zoom = 2.0, pythonCommand, workDir, timeoutMs = 45000, stderrLimit = 8192, platform = process.platform }) {
	await mkdir(workDir, { recursive: true });
	// 每次渲染使用独立临时目录。不同 bbox/zoom 的请求可能同时渲染同一 PDF；
	// 共享临时文件名会互相覆盖或删除，最终把错误裁剪登记为 ready。
	const taskDir = await mkdtemp(join(workDir, ".render-"));
	const pdfTmp = join(taskDir, "source.pdf");
	const pngTmp = join(taskDir, "shot.png");
	try {
		await writeFile(pdfTmp, pdfBuffer);
		const args = [SHOT_SCRIPT, "--pdf", pdfTmp, "--page", String(page), "--out", pngTmp, "--zoom", String(zoom)];
		if (bbox) args.push("--bbox", bbox.map((n) => Number(n).toFixed(2)).join(","));
		await new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(pythonCommand[0], [...pythonCommand.slice(1), ...args], {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				...(platform !== "win32" ? { detached: true } : {})
			});
			let stderr = "";
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				killPythonTree(child, { platform });
				rejectPromise(new Error(`evidence-shot render timed out after ${timeoutMs}ms（已终止渲染进程并清理临时文件）`));
			}, Number(timeoutMs) || 45000);
			child.stderr.on("data", (chunk) => {
				if (stderr.length < stderrLimit) stderr += String(chunk);
			});
			child.on("error", (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				rejectPromise(error);
			});
			child.on("exit", (code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (code === 0) resolvePromise();
				else rejectPromise(new Error(`evidence-shot render failed (exit ${code}): ${stderr.trim().slice(0, 300) || "fitz 不可用?"}`));
			});
		});
		const png = await readFile(pngTmp);
		return { png };
	} finally {
		try { await rm(taskDir, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
	}
}

/** 缓存文件名只含稳定摘要，避免浮点 bbox/zoom 中的小数点触发文件名白名单。 */
export function evidenceShotCacheName({ bundleId, sourceDigest, kind = "pdf", page, bbox, zoom }) {
	const normalized = JSON.stringify({
		kind: kind === "si" ? "si" : "pdf",
		page: Number(page),
		bbox: Array.isArray(bbox) ? bbox.map((value) => Number(value)) : null,
		zoom: Number(zoom)
	});
	const location = createHash("sha256").update(normalized).digest("hex").slice(0, 20);
	return `${bundleId}-${sourceDigest}-${location}.png`;
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

	/** 定位 evidence → bundle → 校验 → 渲染缓存 PNG。
	 *
	 *  0.4.0-rc.4（§5）：本端点是服务端唯一把证据截图核验状态登记为 ready 的
	 *  位置——必须真实渲染成功（含缓存命中）才登记；原 PDF/页码变化登记 stale
	 *  （渲染前 digest 对比）；缺文件/渲染失败登记 failed（含可行动 error）。
	 *  确认/修正/锁定门禁只信服务端登记状态，不信任前端元数据。 */
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
		const synthesis = this.ctx.labSynthesis;
		/** 登记截图核验结果。rc.4 review（§8）：必须 await —— 成功响应 PNG 前
		 *  ready 登记必须已持久化，避免「先响应后写入」竞态导致用户快速确认时
		 *  读不到 ready；failed/stale 同样 await 保证 UI 查询看到一致状态。
		 *  mock ctx 无该方法时跳过登记。 */
		const registerShot = async (status, extra = {}) => {
			if (typeof synthesis?.registerEvidenceShotVerification !== "function") return;
			await synthesis.registerEvidenceShotVerification(evidenceId, { status, ...extra });
		};
		/** 错误路径的登记：等待完成但登记自身失败不覆盖主错误语义（响应本就不是
		 *  图片成功态，UI 不会误判核验成功；§8「登记失败不得伪装成功」针对 ready
		 *  放行路径——该路径登记失败会直接抛 5xx，见下）。 */
		const registerBestEffort = async (status, extra = {}) => {
			try { await registerShot(status, extra); } catch { /* 主错误已回给 UI */ }
		};
		try {
			const evidence = synthesis.evidenceById(evidenceId);
			if (!evidence || evidence.routeId !== routeId) {
				sendError(res, 404, "evidence not found for route");
				return;
			}
			synthesis.getRoute(routeId); // 校验路线存在
			const bundleId = evidence.bundleId ?? evidence.documentId;
			const page = pageNumberFrom(evidence.page);
			if (!bundleId || !page) {
				// 无原文定位：无法渲染，登记 failed（缺原文/页码），UI 明示可行动原因
				await registerBestEffort("failed", { bundleId, page: evidence.page, bbox: bboxFrom(evidence), error: "evidence 缺少 bundleId/documentId 或页码，无法渲染原文截图" });
				sendError(res, 422, "evidence 缺少 bundleId/documentId 或页码，无法渲染原文截图");
				return;
			}
			const inferredKind = this.ctx.labSynthesis.evidenceDocumentKind?.(evidence) ?? (evidence.sourceKind === "si" || evidence.sourceType === "paper-si" ? "si" : "pdf");
			const requestedKind = url.searchParams.get("kind");
			const kind = requestedKind === "si" || requestedKind === "pdf" ? requestedKind : inferredKind;
			let file;
			try {
				file = await this.ctx.labTasks.bundleFile(bundleId, kind);
			} catch (error) {
				await registerBestEffort("failed", { bundleId, kind, page, bbox: bboxFrom(evidence), error: `原文未归档或不可读：${error.message || "bundleFile failed"}` });
				sendError(res, 404, `原文未归档或不可读：${error.message || "bundleFile failed"}（截图仅对已捕获原文可用）`);
				return;
			}
			const bbox = bboxFrom(evidence);
			const zoom = Math.min(Math.max(Number(url.searchParams.get("zoom") ?? 2.0) || 2.0, 1.0), 4.0);
			const cacheDir = this.config.cacheDir ?? join(process.cwd(), "evidence-shots");
			const sha = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
			// §4.3/§5.1：原 PDF 内容变化（digest 不同）→ 既有 ready 判定先失效为
			//  stale（含当前内容摘要），重新渲染成功后才以新 digest 登记 ready。
			const prior = evidence?.shotVerification;
			if (prior?.status === "ready" && prior.sourceDigest && prior.sourceDigest !== sha) {
				await registerBestEffort("stale", { bundleId, kind, page, bbox, sourceDigest: sha, error: "原文内容已变化，既有截图核验失效，需重新核验" });
			}
			const cacheName = evidenceShotCacheName({ bundleId, sourceDigest: sha, kind, page, bbox, zoom });
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
				const renderTimeoutMs = Number(this.config.renderTimeoutMs ?? 45000);
				// §11.5：同一缓存键并发请求合并为一次渲染，避免重复启动 python 进程
				const runRender = async () => {
					const rendered = await renderPageToPng({ pdfBuffer: file.buffer, page, bbox, zoom, pythonCommand, workDir: cacheDir, timeoutMs: renderTimeoutMs });
					await writeFile(cachePath, rendered.png);
				};
				const inFlight = inflightRenders.get(cachePath);
				if (inFlight) {
					await inFlight;
				} else {
					const pending = runRender().finally(() => inflightRenders.delete(cachePath));
					inflightRenders.set(cachePath, pending);
					await pending;
				}
			}
			// 真实渲染/缓存命中均代表“截图成功生成”。§8：ready 登记**先于** PNG
			// 响应；登记失败必须抛 5xx（不得把未持久化的截图显示为核验成功）。
			await registerShot("ready", { bundleId, kind, page, bbox, sourceDigest: sha, renderedAt: new Date().toISOString() });
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
			// 渲染类失败（含页码越界/文件损坏/渲染器缺失/子进程超时）→ failed 可行动原因
			if (/python|fitz|venv|解释器|render failed|timed out|out of range|page/i.test(message)) {
				await registerBestEffort("failed", { error: message.slice(0, 300) });
			}
			sendError(res, status, message.slice(0, 300));
		}
	}
}

export default LabEvidenceShotService;
