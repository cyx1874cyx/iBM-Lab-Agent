/**
 * dsh-lab-agent: 手工下载文献自动捕获服务（Cordis host service, ctx.labCapture）。
 *
 * 职责：
 *   - 创建一次性捕获任务（32 字节随机令牌，仅持久化 SHA-256，默认 20 分钟有效）；
 *   - 提供 PUT /api/lab-capture-upload?token=... 上传端点（含 Chrome 扩展 CORS 预检、
 *     Origin 校验、100 MB 上限、路径穿越防护、临时文件 + 原子重命名、PDF/SI 校验）；
 *   - 校验通过后调用 LabTasksService.registerCapturedFile 登记到原 bundle，
 *     不新建文献、不冒充已完成的全文精读。
 *
 * 安全：token 绑定 projectId/bundleId/kind/到期时间；完成/失败/过期后令牌失效，
 * 同一令牌只允许成功一次（重放返回 409）。保存目录由服务端从课题工作区构造
 * （captured-literature/<bundleId>/），不接受客户端提供的保存路径。
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { entryFileName, literatureEntryLayout } from "./entry-layout.js";
import { TERMINAL_PHASES, deriveCaptureView } from "./capture-phase.js";
import { cleanJson } from "../src/json-boundary.js";
import {
	assertTaskUploadable,
	captureHttpStatusFor,
	CHROME_EXTENSION_ORIGIN_RE,
	createCaptureToken,
	captureExpiresAt,
	labCaptureTaskSchema,
	kindMatchesFileName,
	publisherUrlForBundle,
	sanitizeCaptureFileName,
	validateCapturedFile,
	CAPTURE_MAX_BYTES
} from "../src/manual-capture.js";

export const labCapturesDomainSpec = defineDomain({
	name: "lab_captures",
	version: 0,
	tables: {
		lab_capture_tasks: domainTable(labCaptureTaskSchema)
	}
});

/** 上传端点的路由前缀（query 参数 token）。 */
export const CAPTURE_UPLOAD_PATH = "/api/lab-capture-upload";

/**
 * 保存 PDF 的浏览器操作 TTL（C15）。保存 = 等字节流落盘 + 上传归档，
 * 30 秒必然不够；现场实测正是「已返回 started，操作却已经过期」。
 */
export const SAVE_OPERATION_TTL_MS = 240_000;

/** 读请求体：兼容真实 HTTP 流与测试传入的 Buffer。 */
export function readRequestBody(req, limit = CAPTURE_MAX_BYTES) {
	if (req.body instanceof Buffer) return Promise.resolve(req.body);
	if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body, "binary"));
	if (typeof req.body === "object" && req.body !== null && req.body.byteLength !== undefined) {
		return Promise.resolve(Buffer.from(req.body));
	}
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > limit) {
				reject(new Error(`上传超过 ${Math.round(limit / 1024 / 1024)} MB 上限`));
				req.destroy?.();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

/** CORS 头：仅对合法 chrome-extension:// Origin 反射；同源/本地工具无 Origin 不加。 */
export function corsHeaders(req) {
	const origin = req?.headers?.origin;
	if (origin && CHROME_EXTENSION_ORIGIN_RE.test(origin)) {
		return {
			"access-control-allow-origin": origin,
			"access-control-allow-methods": "PUT, OPTIONS",
			"access-control-allow-headers": "content-type, x-file-name",
			"access-control-expose-headers": "x-capture-task-id, x-file-name",
			"vary": "origin"
		};
	}
	return {};
}

/** 拒绝跨站 Origin：无 Origin（同源/本地桥接）放行；合法扩展 Origin 放行；同源放行。 */
export function denyUploadOrigin(req) {
	const origin = req?.headers?.origin;
	if (!origin) return false;
	if (CHROME_EXTENSION_ORIGIN_RE.test(origin)) return false;
	try {
		const host = req?.headers?.host;
		if (host && new URL(origin).host === String(host)) return false;
	} catch { /* fallthrough */ }
	return true;
}

function sendJson(res, status, payload, headers = {}) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	res.writeHead(status, {
		"content-type": "application/json;charset=utf-8",
		"content-length": String(body.byteLength),
		"cache-control": "no-store",
		...headers
	});
	res.end(body);
}

function sendError(res, status, message, headers = {}) {
	sendJson(res, status, { ok: false, error: String(message) }, headers);
}

/** 从 header 提取上传文件名（X-File-Name 优先，其次 Content-Disposition filename*）。 */
export function uploadFileName(req) {
	const direct = req?.headers?.["x-file-name"];
	if (direct) {
		try { return decodeURIComponent(String(direct)); } catch { return String(direct); }
	}
	const disposition = String(req?.headers?.["content-disposition"] ?? "");
	const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
	if (star) {
		try { return decodeURIComponent(star[1]); } catch { return star[1]; }
	}
	const plain = disposition.match(/filename="?([^";]+)"?/i);
	if (plain) return plain[1];
	return undefined;
}

/**
 * 构造上传处理器（导出以便测试直接驱动，不依赖 webServer 服务行）。
 * @param {LabCaptureService} capture 已初始化的 labCapture 服务实例
 */
export function createCaptureUploadHandler(capture) {
	return async (req, res) => {
		const method = String(req.method ?? "").toUpperCase();
		if (method === "OPTIONS") {
			if (denyUploadOrigin(req)) {
				sendError(res, 403, "cross-site capture upload denied（非法 Origin）", corsHeaders(req));
				return;
			}
			res.writeHead(204, { ...corsHeaders(req), "access-control-max-age": "600", "content-length": "0" });
			res.end();
			return;
		}
		if (method !== "PUT") {
			sendError(res, 405, "method not allowed; use PUT", corsHeaders(req));
			return;
		}
		if (denyUploadOrigin(req)) {
			sendError(res, 403, "cross-site capture upload denied（非法 Origin）", corsHeaders(req));
			return;
		}
		const declared = Number(req?.headers?.["content-length"]);
		if (Number.isFinite(declared) && declared > CAPTURE_MAX_BYTES) {
			sendError(res, 413, `上传超过 ${Math.round(CAPTURE_MAX_BYTES / 1024 / 1024)} MB 上限`, corsHeaders(req));
			return;
		}
		let task;
		try {
			const url = new URL(req.url ?? CAPTURE_UPLOAD_PATH, "http://localhost");
			const token = url.searchParams.get("token") ?? "";
			if (!token) throw new Error("缺少一次性上传令牌（?token=...）");
			task = await capture.claimTaskForUpload(token);
			const fileName = sanitizeCaptureFileName(uploadFileName(req), task.kind);
			if (!kindMatchesFileName(task.kind, fileName)) {
				throw new Error(`${task.kind === "pdf" ? "PDF" : "SI"} 任务不匹配文件名「${fileName}」`);
			}
			await capture.transit(task.id, { fileName, error: undefined });
			const buffer = await readRequestBody(req, CAPTURE_MAX_BYTES);
			const integrity = validateCapturedFile({ kind: task.kind, buffer, fileName });
			const bundle = await capture.saveCapturedFile(task, { buffer, fileName, ...integrity });
			// 回传与入库都用最终归档名（条目规则生成），不沿用出版社下载名。
			const savedName = basename(task.kind === "pdf" ? bundle.pdfPath : bundle.siPath);
			await capture.transit(task.id, {
				status: "completed",
				fileName: savedName,
				size: integrity.byteLength,
				fileSha256: integrity.sha256,
				error: undefined
			});
			sendJson(res, 200, {
				ok: true,
				taskId: task.id,
				bundleId: bundle.id,
				kind: task.kind,
				fileName: savedName,
				size: integrity.byteLength,
				sha256: integrity.sha256,
				acquisitionStatus: bundle.acquisitionStatus
			}, { ...corsHeaders(req), "x-capture-task-id": task.id });
		} catch (error) {
			const message = String(error?.message ?? error ?? "upload failed");
			const status = captureHttpStatusFor(error);
			if (task?.id) {
				// 失败原因写进任务行，并留一条历史（取消不再覆盖它）。
				const history = Array.isArray(task.errorHistory) ? task.errorHistory : [];
				await capture.transit(task.id, {
					status: "failed",
					error: message,
					errorHistory: [...history, {
						at: new Date().toISOString(),
						kind: error?.code === "browser-operation" ? "browser-operation" : "upload-failed",
						message
					}].slice(-10)
				}).catch(() => {});
			}
			// R3：返回体带 code 与收到的字节数，壳再把它写进日志（R2），
			// 于是"为什么被拒"从服务端一路可读到状态里。
			sendJson(res, status, cleanJson({
				ok: false,
				error: message,
				code: error?.code,
				receivedBytes: Number.isSafeInteger(error?.captureBytes) ? error.captureBytes : undefined
			}), corsHeaders(req));
		} finally {
			if (task?.id) capture.releaseTaskClaim(task.id);
		}
	};
}

export class LabCaptureService extends Service {
	static inject = ["storageDomain", "labTasks"];
	/** 上传端点路由；测试直接调用 createCaptureUploadHandler(this)。 */
	static UPLOAD_PATH = CAPTURE_UPLOAD_PATH;

	constructor(ctx, config = {}) {
		super(ctx, "labCapture");
		this.config = config;
		this.uploadClaims = new Set();
		// AI 发起捕获时，明文一次性令牌只暂存在当前进程内，绝不进入持久化表。
		this.agentCaptureTokens = new Map();
		// 桌面 WebVPN 状态由可见客户端定期上报，只保存在内存中。模型工具据此
		// 在正文任务排队前做短时效预检，避免产生无人接管的 armed 任务。
		this.desktopWebVpnStatus = null;
		this.desktopWebVpnActions = new Map();
		this.browserOperations = new Map();
		// 接管关系（C3）：单例浏览器只服务一个任务，所以「上一次被谁接管」是一个值。
		// 壳若能显式上报就以上报为准；壳没报时由这里按 pendingTaskId 的消失推断，
		// 否则「接管过又交还」会被误判成「还在排队」。
		this.desktopLastPendingTaskId = null;
		this.desktopReleaseReason = null;
		// 进度采样（C17）：{ [taskId]: { bytes, at } }，用于算「无字节增长」的时长。
		this.captureProgressSamples = new Map();
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labCapturesDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.captures.domainClose");
		this.domain = domain;
		this.table = domain.table("lab_capture_tasks");
		// AI 令牌只驻留内存。服务重启后，历史 armed AI 任务已不可能再被桌面
		// 领取，必须立即结束，避免永久显示成“排队/等待登录”。
		for (const key of this.table.keys()) {
			const row = this.table.get(key);
			if (row?.requestedBy === "agent" && row.status === "armed") {
				await this.transit(key, { status: "cancelled", error: "应用已重启，原下载请求的一次性令牌已失效，请重新发起" });
			}
		}
		try {
			const webServer = this.ctx.webServer;
			if (webServer?.register) {
				const handler = createCaptureUploadHandler(this);
				this.ctx.effect(() => webServer.register({
					kind: "prefix",
					path: CAPTURE_UPLOAD_PATH,
					handler
				}), "lab-agent.captures.upload");
			}
		} catch (error) {
			this.ctx.logger?.warn?.("labCapture: upload route registration skipped: " + String(error));
		}
	}

	requireTasks() {
		const tasks = this.ctx.labTasks;
		if (!tasks) throw new Error("labTasks unavailable");
		return tasks;
	}

	reportDesktopWebVpnStatus(value = {}) {
		const states = new Set(["closed", "opening", "waiting-login", "ready", "navigating", "waiting-download", "downloading", "uploading", "expired", "error"]);
		const state = states.has(value.state) ? value.state : "closed";
		const pendingTaskId = typeof value.pendingTaskId === "string" ? value.pendingTaskId : undefined;
		// 接管/交还显式化（C3）：壳上报 lastPendingTaskId/releaseReason 时直接采信；
		// 没上报时用「本进程记得的上一次 pendingTaskId」推断，保证老壳也能区分
		// 「从未被接管」与「接管过又交还」。
		if (typeof value.lastPendingTaskId === "string") {
			this.desktopLastPendingTaskId = value.lastPendingTaskId;
		} else if (pendingTaskId) {
			this.desktopLastPendingTaskId = pendingTaskId;
		}
		if (typeof value.releaseReason === "string") this.desktopReleaseReason = value.releaseReason;
		else if (pendingTaskId) this.desktopReleaseReason = null;
		const automationStage = ["opening", "searching", "clicked", "verification", "manual", "saving"].includes(value.automationStage) ? value.automationStage : undefined;
		this.desktopWebVpnStatus = {
			state,
			authenticated: Boolean(value.authenticated),
			windowOpen: Boolean(value.windowOpen),
			sidebarVisible: Boolean(value.sidebarVisible),
			pendingTaskId,
			automationStage,
			downloadedBytes: Number.isSafeInteger(value.downloadedBytes) && value.downloadedBytes >= 0 ? value.downloadedBytes : undefined,
			downloadEventBytes: Number.isSafeInteger(value.downloadEventBytes) && value.downloadEventBytes >= 0 ? value.downloadEventBytes : undefined,
			downloadTotalBytes: Number.isSafeInteger(value.downloadTotalBytes) && value.downloadTotalBytes > 0 ? value.downloadTotalBytes : undefined,
			downloadElapsedMs: Number.isSafeInteger(value.downloadElapsedMs) && value.downloadElapsedMs >= 0 ? value.downloadElapsedMs : undefined,
			// 单次捕获上限：状态里前置暴露，避免大文件下载完才在 413 上失败。
			maxCaptureBytes: Number.isSafeInteger(value.maxCaptureBytes) && value.maxCaptureBytes > 0 ? value.maxCaptureBytes : undefined,
			// 页面级事实（C2）：每次导航/加载完成由壳上报，wait 的指纹据此变化。
			pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : undefined,
			documentType: typeof value.documentType === "string" ? value.documentType : undefined,
			httpStatus: Number.isSafeInteger(value.httpStatus) && value.httpStatus > 0 ? value.httpStatus : undefined,
			readyState: typeof value.readyState === "string" ? value.readyState : undefined,
			pageSeq: Number.isSafeInteger(value.pageSeq) && value.pageSeq >= 0 ? value.pageSeq : undefined,
			contentLength: Number.isSafeInteger(value.contentLength) && value.contentLength >= 0 ? value.contentLength : undefined,
			// PDF 载荷（C1/C2.2/R2）：`ready` = 至少进来了一个字节（还在涨也可能为真），
			// `complete` = 已被正向证明收全。判"能不能归档"必须看 complete。
			pdfPayload: value.pdfPayload && typeof value.pdfPayload === "object"
				? {
					ready: Boolean(value.pdfPayload.ready),
					complete: Boolean(value.pdfPayload.complete),
					contentLength: Number.isSafeInteger(value.pdfPayload.contentLength) ? value.pdfPayload.contentLength : undefined,
					receivedBytes: Number.isSafeInteger(value.pdfPayload.receivedBytes) && value.pdfPayload.receivedBytes >= 0 ? value.pdfPayload.receivedBytes : 0,
					error: typeof value.pdfPayload.error === "string" ? value.pdfPayload.error : undefined
				}
				: undefined,
			lastPendingTaskId: typeof value.lastPendingTaskId === "string" ? value.lastPendingTaskId : this.desktopLastPendingTaskId ?? undefined,
			releaseReason: typeof value.releaseReason === "string" ? value.releaseReason : this.desktopReleaseReason ?? undefined,
			takenOverAt: typeof value.takenOverAt === "string" ? value.takenOverAt : undefined,
			// 壳侧最近一次失败：原因 + 可救回的产物（R4）。这两个字段以前根本不上报，
			// 于是"归档被 400 拒绝但本地文件完整"这件事只有日志知道。
			lastError: typeof value.lastError === "string" && value.lastError ? value.lastError : undefined,
			lastFailure: value.lastFailure && typeof value.lastFailure === "object"
				? {
					message: String(value.lastFailure.message ?? "").slice(0, 400),
					salvagedPath: typeof value.lastFailure.salvagedPath === "string" ? value.lastFailure.salvagedPath : undefined,
					salvagedBytes: Number.isSafeInteger(value.lastFailure.salvagedBytes) ? value.lastFailure.salvagedBytes : undefined,
					salvagedSha256: typeof value.lastFailure.salvagedSha256 === "string" ? value.lastFailure.salvagedSha256 : undefined
				}
				: undefined,
			iwanInstalled: Boolean(value.iwanInstalled),
			iwanConnected: Boolean(value.iwanConnected),
			iwanUsable: Boolean(value.iwanUsable),
			iwanGlobalRoute: Boolean(value.iwanGlobalRoute),
			observedAt: new Date().toISOString()
		};
		const pdfPayload = this.desktopWebVpnStatus.pdfPayload;
		this.noteProgress(
			pendingTaskId,
			state === "downloading" || state === "uploading"
				? this.desktopWebVpnStatus.downloadEventBytes ?? 0
				: this.desktopWebVpnStatus.downloadedBytes,
			state,
			automationStage,
			Boolean(pdfPayload && !pdfPayload.complete)
		);
		return this.desktopWebVpnStatus;
	}

	/**
	 * 进度采样（C17）：长耗时阶段「无字节增长」的时长。
	 *
	 * 只在下发状态时采样，读的时候算差值，因此不需要定时器；一次调用既做记录
	 * 又返回旧样本算出的停滞时长。
	 */
	noteProgress(taskId, bytes, state, automationStage, pdfReceiving = false) {
		if (!taskId) return;
		// 「长耗时」的判据要包含**响应层正在收 PDF 载荷**：那条路上壳的 state 可能
		// 仍是 waiting-download、automationStage 也不是 saving，只看这两个会让
		// 进度与停滞检测双双失效（R2 要的速度就是这么丢的）。
		const busy = state === "downloading" || state === "uploading"
			|| automationStage === "saving" || pdfReceiving === true;
		const now = Date.now();
		const previous = this.captureProgressSamples.get(taskId);
		if (!busy) {
			// 离开长耗时阶段就丢弃样本，下一次进入重新计时。
			this.captureProgressSamples.delete(taskId);
			return;
		}
		const value = Number.isFinite(bytes) ? bytes : 0;
		if (!previous) {
			this.captureProgressSamples.set(taskId, { bytes: value, at: now, stalledMs: 0, speedBps: undefined });
			return;
		}
		const elapsed = now - previous.at;
		if (value !== previous.bytes) {
			// 相邻两次采样算速度（D6）：字节没变时不刷新，停滞时长才不会被"心跳"抹掉。
			const speedBps = elapsed >= 200 ? ((value - previous.bytes) * 1000) / elapsed : previous.speedBps;
			this.captureProgressSamples.set(taskId, { bytes: value, at: now, stalledMs: 0, speedBps });
			return;
		}
		this.captureProgressSamples.set(taskId, {
			bytes: previous.bytes,
			at: previous.at,
			// 停滞 = 无字节增长 ∧ 无新采样时间（两者都不动才算停滞，D7）。
			stalledMs: Math.max(previous.stalledMs, now - previous.at),
			speedBps: previous.speedBps
		});
	}

	/** 停滞毫秒数（不下发、不采样，纯读）。 */
	stalledMs(taskId) {
		return this.captureProgressSamples.get(taskId)?.stalledMs ?? 0;
	}

	/** 相邻两次采样的速度（B/s）；样本不足时 undefined，绝不猜。 */
	speedBps(taskId) {
		return this.captureProgressSamples.get(taskId)?.speedBps;
	}

	getDesktopWebVpnStatus(now = Date.now()) {
		const status = this.desktopWebVpnStatus;
		if (!status) return { state: "unavailable", ready: false, stale: true };
		const ageMs = Math.max(0, now - new Date(status.observedAt).getTime());
		// C13：按阶段分档 TTL。下载/归档本来就可能几十秒没有新字节或新阶段，
		// 用统一的 10 秒会把正常的长耗时阶段误报成「心跳丢失」。
		const ttl = status.state === "downloading" || status.state === "uploading"
			|| (status.state === "waiting-download" && status.automationStage === "saving")
			? 60_000
			: 10_000;
		const stale = !Number.isFinite(ageMs) || ageMs > ttl;
		return {
			...status,
			ageMs,
			stale,
			ready: !stale && status.windowOpen && status.authenticated,
			iwanReady: !stale && status.iwanUsable
		};
	}

	/**
	 * Agent 浏览器动作只绑定当前已登记的捕获任务。结果仅留在本进程；
	 * 页面元素引用由 WebView2 页面脚本二次核对，不能由模型直接提供选择器。
	 */
	createBrowserOperation({ projectId, taskId, action, observationId, elementId, scope, routeId, expectedPageSeq }) {
		const task = this.getTask(taskId);
		if (!task || task.projectId !== projectId || task.requestedBy !== "agent"
			|| task.status !== "armed") throw new Error("当前课题没有可操作的文献捕获任务");
		if (!["debug", "observe", "click", "navigate", "viewer-download"].includes(action)) throw new Error("浏览器动作无效");
		if (action === "viewer-download" && this.viewerDownloadFailure(taskId).terminal) {
			throw new Error("此任务的 PDF 查看器自动下载已不可继续；请在侧栏原生 PDF 查看器按 Ctrl+S，浏览器会自动捕获并归档，无需回传文件路径");
		}
		if (action === "click" && (!/^[a-zA-Z0-9-]{8,80}$/.test(String(observationId || ""))
			|| !/^e[0-9]{1,2}$/.test(String(elementId || "")))) throw new Error("点击必须引用有效的页面观察结果");
		const desktop = this.getDesktopWebVpnStatus();
		// C14：「心跳超时」与「任务不属于当前浏览器」是两种完全不同的处境，
		// 折叠成一句话会让调用方无法判断该重连还是该重建。
		if (desktop.stale) {
			throw new Error(desktop.state === "unavailable"
				? "尚未收到文献浏览器的心跳：请先在软件侧栏打开文献浏览器"
				: `文献浏览器心跳超时（上次上报 ${Math.round((desktop.ageMs ?? 0) / 1000)} 秒前），请确认文献浏览器仍在运行`);
		}
		if (desktop.pendingTaskId !== taskId) {
			throw new Error(desktop.pendingTaskId
				? `该任务未在此浏览器打开（当前 pendingTaskId=${desktop.pendingTaskId}），请等待它接管或重建任务`
				: "该任务未在此浏览器打开（当前没有任务被接管），文献浏览器可能已释放它，请重建任务");
		}
		if (action === "navigate") {
			if (routeId !== "science-pdf" || !Number.isSafeInteger(expectedPageSeq) || expectedPageSeq <= 0
				|| expectedPageSeq !== desktop.pageSeq) throw new Error("备用入口已失效，请重新查询任务状态");
			const taskDoi = String(task.publisherUrl || "").match(/^https:\/\/doi\.org\/(10\.1126\/[a-z0-9._-]+)$/i)?.[1];
			const pageDoi = String(desktop.pageUrl || "").match(/^https:\/\/(?:www\.)?science\.org\/doi\/(?:reader\/|epdf\/|pdf\/)?(10\.1126\/[a-z0-9._-]+)(?:[?#]|$)/i)?.[1];
			if (task.kind !== "pdf" || !taskDoi || !pageDoi || taskDoi.toLowerCase() !== pageDoi.toLowerCase()) {
				throw new Error("当前任务不支持此备用入口");
			}
		}
		for (const item of this.browserOperations.values()) {
			if (["queued", "running"].includes(item.status) && Date.now() > item.expiresAt) {
				this.expireBrowserOperation(item);
			}
			if (item.taskId === taskId && ["queued", "running"].includes(item.status)) throw new Error("当前浏览器动作尚未结束");
		}
		const id = "browser-" + randomBytes(12).toString("hex");
		const operation = {
			id, projectId, taskId, action, observationId, elementId, routeId, expectedPageSeq,
			// scope 只对 observe 有意义：download=只给下载入口，all=整页可交互元素。
			scope: scope === "all" ? "all" : "download",
			status: "queued", createdAt: Date.now(),
			// PDF 查看器下载要等字节流落盘 + 归档上传，30 秒必然不够（现场实测
			// 保存已经返回 started 之后操作就过期了，失败原因无处可查）。
			expiresAt: Date.now() + (action === "viewer-download" ? SAVE_OPERATION_TTL_MS : 30_000)
		};
		this.browserOperations.set(id, operation);
		return this.getBrowserOperation(id, projectId);
	}

	/** 同一任务的查看器动作失败次数；只读操作记录，不把一次失败误判为下载任务终态。 */
	viewerDownloadFailure(taskId) {
		const failed = [...(this.browserOperations?.values() ?? [])]
			.filter((item) => item.taskId === taskId && item.action === "viewer-download" && item.status === "failed");
		const error = failed.at(-1)?.error;
		return { count: failed.length, error,
			terminal: failed.length >= 2 || /主窗口(?:句柄)?不可用|无法(?:获取主窗口句柄|聚焦|显示主窗口|恢复主窗口)|未获得前台焦点|保存指令未触发下载|viewer-unavailable|toolbar-unavailable|save-unavailable|不支持原生另存为接口|当前另存为对象不是 PDF|text\/html/.test(error || "") };
	}

	/**
	 * 把「为什么失败」写回任务行（C15/C16）。
	 *
	 * 尽力而为：轻量 stub（单测会直接 new 出服务而不跑 init）没有持久化表，
	 * 那种情况下只跳过写回，绝不让状态工具的返回值因为一次写库失败而变成异常。
	 */
	writeBackTaskError(taskId, message) {
		try {
			if (!this.table) return;
			const task = this.table.get(taskId);
			if (!task || ["completed", "cancelled", "failed"].includes(task.status)) return;
			void this.transit(taskId, { error: String(message).slice(0, 300) }).catch(() => {});
		} catch { /* 没有持久化表时忽略 */ }
	}

	/** 操作过期：除了标失败，还要把原因写回任务行（C15），否则 status 说不出为什么。 */
	expireBrowserOperation(item) {
		item.status = "failed";
		item.error = item.action === "viewer-download"
			? "PDF 查看器下载超时（未在时限内完成归档）；请先查询任务状态，仍未完成时可在侧栏原生 PDF 查看器按 Ctrl+S，下载会自动捕获并归档，无需回传路径"
			: "浏览器操作超时，请重新观察页面";
		this.writeBackTaskError(item.taskId, item.error);
	}

	getBrowserOperation(id, projectId) {
		const item = this.browserOperations.get(id);
		if (!item || item.projectId !== projectId) return null;
		if (["queued", "running"].includes(item.status) && Date.now() > item.expiresAt) {
			this.expireBrowserOperation(item);
		}
		return {
			id: item.id, taskId: item.taskId, action: item.action, scope: item.scope, status: item.status,
			result: item.result, error: item.error
		};
	}

	claimBrowserOperation(projectId) {
		for (const item of this.browserOperations.values()) {
			if (item.projectId !== projectId || item.status !== "queued") continue;
			if (Date.now() > item.expiresAt) { this.expireBrowserOperation(item); continue; }
			const task = this.getTask(item.taskId);
			if (task?.status !== "armed") {
				item.status = "failed";
				item.error = "文献捕获任务已经结束";
				// C16：任务已经结束这件事必须写回任务行，否则 status 只会说
				// 「排队第 1 位」，而操作那边已经静默失败。
				this.writeBackTaskError(item.taskId, "浏览器动作被丢弃：捕获任务已经结束");
				continue;
			}
			item.status = "running";
			return { id: item.id, taskId: item.taskId, action: item.action,
				observationId: item.observationId, elementId: item.elementId,
				scope: item.scope, routeId: item.routeId, expectedPageSeq: item.expectedPageSeq };
		}
		return null;
	}

	completeBrowserOperation(request) {
		const item = this.browserOperations.get(request.id);
		if (!item || item.projectId !== request.projectId || item.status !== "running") return null;
		item.status = request.error ? "failed" : "completed";
		item.error = request.error ? String(request.error).slice(0, item.action === "viewer-download" ? 1024 : 300) : undefined;
		if (item.error && item.action === "viewer-download" && !item.error.includes("Ctrl+S")) {
			item.error = `${item.error}；可在侧栏原生 PDF 查看器按 Ctrl+S，下载会自动捕获并归档，无需回传路径`.slice(0, 1024);
		}
		item.result = request.error ? undefined : request.result;
		return this.getBrowserOperation(item.id, item.projectId);
	}

	requestDesktopWebVpnLogin(projectId) {
		this.desktopWebVpnActions.set(projectId, { type: "open-login", requestedAt: new Date().toISOString() });
	}

	claimDesktopWebVpnAction(projectId) {
		const action = this.desktopWebVpnActions.get(projectId);
		if (action) this.desktopWebVpnActions.delete(projectId);
		return action;
	}

	transit(id, patch, now = new Date().toISOString()) {
		const row = this.table.get(id);
		if (row === undefined) return Promise.resolve(undefined);
		const next = { ...row, ...patch, updatedAt: now };
		return this.table.put(id, next).then(() => next);
	}

	/**
	 * 单进程内原子认领上传任务：避免两个并发 PUT 都在 armed 检查后继续写文件。
	 * 持久化状态仍写入 uploading；uploadClaims 覆盖 await 让出的竞争窗口。
	 */
	async claimTaskForUpload(token) {
		const task = await this.resolveTaskByToken(token);
		assertTaskUploadable(task);
		if (this.uploadClaims.has(task.id)) throw new Error("该捕获令牌正在使用（replay denied）");
		this.uploadClaims.add(task.id);
		try {
			const latest = this.getTask(task.id);
			assertTaskUploadable(latest);
			await this.transit(task.id, { status: "uploading", error: undefined });
			return task;
		} catch (error) {
			this.uploadClaims.delete(task.id);
			throw error;
		}
	}

	releaseTaskClaim(taskId) {
		this.uploadClaims.delete(taskId);
	}

	/**
	 * 创建一次性捕获任务。
	 * @returns {{ task: object, token: string }} task 为持久化行（含 tokenSha256），
	 * token 为明文一次性令牌（只在创建响应中返回一次）。
	 */
	async createCaptureTask({ projectId, bundleId, kind, requestedBy = "user", loginConfirmedByUser = false }) {
		const tasks = this.requireTasks();
		const project = tasks.getProject(projectId);
		if (project === undefined) throw new Error(`project '${projectId}' not found`);
		const bundle = tasks.getBundle(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		if (!["pdf", "si"].includes(kind)) throw new Error(`kind must be pdf or si, got '${kind}'`);
		// 微信来源只允许 DOI 出版社页面，绝不回退公众号链接；普通来源可使用
		// 已登记的 HTTPS 出版社页面。
		const publisherUrl = publisherUrlForBundle(bundle);
		if (!publisherUrl) throw new Error(`无法启动捕获：bundle '${bundleId}' 未登记 DOI，无法打开出版社页面`);
		// 同一 bundle + kind 已有一个未过期的 armed 任务时：用户再次点击按钮 =
		// 明确重新捕获意图。作废旧任务（cancelled，旧令牌立即失效，防重放），
		// 再创建新任务——否则扩展侧上传失败（如桥接未注册）时服务端任务永远停在
		// armed，用户会一直被「已有进行中的捕获任务」卡住无法重试。
		const now = new Date();
		for (const key of this.table.keys()) {
			const row = this.table.get(key);
			if (row.bundleId !== bundleId || row.kind !== kind) continue;
			if (row.status === "armed" && new Date(row.expiresAt).getTime() > now.getTime()) {
				await this.transit(key, { status: "cancelled", error: "用户重新发起捕获，旧任务作废" });
				this.agentCaptureTokens.delete(key);
			}
		}
		const { token, tokenSha256 } = createCaptureToken();
		const id = `capture-${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
		const createdAt = now.toISOString();
		const task = labCaptureTaskSchema.parse({
			id,
			projectId,
			bundleId,
			kind,
			requestedBy,
			loginConfirmedByUser,
			mode: "ai",
			publisherUrl,
			status: "armed",
			tokenSha256,
			expiresAt: captureExpiresAt(now),
			createdAt,
			updatedAt: createdAt
		});
		await this.table.put(id, task);
		return { task, token };
	}

	async createAgentCaptureTask({ projectId, bundleId, kind, loginConfirmedByUser = false }) {
		const created = await this.createCaptureTask({ projectId, bundleId, kind, requestedBy: "agent", loginConfirmedByUser });
		this.agentCaptureTokens.set(created.task.id, created.token);
		return created.task;
	}

	/** 桌面界面一次性领取 AI 请求的令牌；令牌不会返回给模型。 */
	claimAgentCaptureTask(taskId) {
		const task = this.getTask(taskId);
		if (!task || task.status !== "armed" || task.requestedBy !== "agent") {
			throw new Error("AI 文献捕获请求不存在或已结束");
		}
		const token = this.agentCaptureTokens.get(taskId);
		if (!token) throw new Error("AI 文献捕获请求已失效，请让 AI 重新发起");
		this.agentCaptureTokens.delete(taskId);
		return { task, token };
	}

	getTask(taskId) {
		// 未 init（单测里的轻量 stub）时没有持久化表：返回 undefined 而不是抛异常，
		// 让调用方的「任务不存在」分支正常生效。
		return this.table?.get(taskId) ?? undefined;
	}

	listTasks(projectId) {
		if (!this.table) return [];
		return [...this.table.keys()]
			.map((key) => this.table.get(key))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/**
	 * 给一个任务行算「同一份真相」的视图（C6/C20）。
	 *
	 * 状态工具、队列小球、前端提示条都读这里，所以工具说 queued、小球说失败这种
	 * 自相矛盾不可能再出现。`queuePosition` 由调用方按 FIFO 顺序给。
	 */
	describeTask(task, queuePosition) {
		if (!task) return undefined;
		const desktop = { ...this.getDesktopWebVpnStatus(), viewerDownloadFailure: this.viewerDownloadFailure(task.id) };
		return deriveCaptureView({
			task,
			desktop,
			queuePosition,
			stalledMs: this.stalledMs(task.id),
			progressBps: this.speedBps(task.id)
		});
	}

	/**
	 * 队列视图：{ task, view }[]，供小球与状态工具共用。
	 *
	 * 位次只发给**还活着**的任务（B5）：`orphaned`/`failed`/`stalled` 这些终态任务
	 * 仍然 `armed`，以前会继续占着"队列第 2 位"，于是队列长度与位次都在骗人。
	 * 它们仍然出现在列表里（历史记录不该消失），只是不再占位。
	 */
	listTaskViews(projectId) {
		const tasks = this.listTasks(projectId);
		const provisional = tasks.map((task) => ({ task, view: this.describeTask(task) }));
		const fifo = provisional
			.filter(({ task, view }) => task.requestedBy === "agent"
				&& task.status === "armed"
				&& !TERMINAL_PHASES.has(view.phase))
			.sort((a, b) => String(a.task.createdAt || "").localeCompare(String(b.task.createdAt || "")));
		const positions = new Map(fifo.map((entry, index) => [entry.task.id, index + 1]));
		return tasks.map((task) => ({ task, view: this.describeTask(task, positions.get(task.id)) }));
	}

	/**
	 * 用同一篇文献重建获取任务（C11/R1.4）。
	 *
	 * 「重建」= 作废旧任务 + 用同一个 bundleId/kind 建新任务，且不需要用户重新确认
	 * （AI 已获授权）。旧任务标 cancelled 并写明原因，队列位置按新任务的 createdAt
	 * 重新计算 —— 这正是「重建会丢队列位置」的诚实表达，而不是悄悄假装没变。
	 */
	async recreateTask(taskId, reason = "文献获取失败，重建获取任务") {
		const task = this.getTask(taskId);
		if (task === undefined) throw new Error(`capture task '${taskId}' not found`);
		if (task.status === "uploading" || this.uploadClaims.has(task.id)) {
			throw new Error("文件正在归档，无法重建；请等待归档完成");
		}
		if (!["completed", "cancelled"].includes(task.status)) {
			await this.cancelTask(task.id, `重建：${String(reason).slice(0, 200)}`);
		}
		const created = await this.createAgentCaptureTask({
			projectId: task.projectId,
			bundleId: task.bundleId,
			kind: task.kind,
			loginConfirmedByUser: Boolean(task.loginConfirmedByUser)
		});
		return { previousTaskId: task.id, task: created };
	}

	/** 由桌面壳在页面自动化确定“无对应文件”或遇到安全检查时结束任务。 */
	async cancelTask(taskId, reason = "捕获任务已取消") {
		const task = this.getTask(taskId);
		if (task === undefined) throw new Error(`capture task '${taskId}' not found`);
		if (["completed", "cancelled"].includes(task.status)) return task;
		if (task.status === "uploading" || this.uploadClaims.has(task.id)) {
			throw new Error("文件正在归档，无法取消");
		}
		this.agentCaptureTokens.delete(task.id);
		this.desktopWebVpnActions.set(task.projectId, { type: "cancel-capture", taskId: task.id, requestedAt: new Date().toISOString() });
		// R5b：取消**不能吃掉**上一次失败的原因。清理动作本身不是诊断信息，而
		// "为什么失败"是——2026-09-27 现场三条失败的具体校验文案就是这么永久丢失的。
		const cancelReason = String(reason).slice(0, 300);
		const history = Array.isArray(task.errorHistory) ? task.errorHistory : [];
		const previous = typeof task.error === "string" && task.error ? task.error : undefined;
		return await this.transit(task.id, {
			status: "cancelled",
			cancelReason,
			error: previous ?? cancelReason,
			errorHistory: previous
				? [...history, { at: new Date().toISOString(), kind: "cancel", message: cancelReason }].slice(-10)
				: history
		});
	}

	/** 惰性标记过期：armed 且已到期的行置为 expired。 */
	async sweepExpired(now = new Date()) {
		let count = 0;
		for (const key of this.table.keys()) {
			const row = this.table.get(key);
			if (row.status !== "armed") continue;
			if (new Date(row.expiresAt).getTime() <= now.getTime()) {
				await this.transit(key, { status: "expired", error: "捕获任务已过期" });
				count += 1;
			}
		}
		return count;
	}

	async resolveTaskByToken(token) {
		const tokenSha256 = createHash("sha256").update(String(token)).digest("hex");
		for (const key of this.table.keys()) {
			const row = this.table.get(key);
			if (row.tokenSha256 === tokenSha256) return row;
		}
		return undefined;
	}

	/**
	 * 保存捕获文件到课题工作区的文献条目目录
	 * （<workspace>/literature/<entryStem>/，正文为 PDF，SI 保留受支持扩展名），
	 * 写临时文件后原子替换，再登记到原 bundle。
	 * 最终文件名由服务端按条目规则生成（entryFileName），
	 * 不接受浏览器提供的原始下载文件名作为最终文件名。
	 */
	async saveCapturedFile(task, { buffer, fileName }) {
		const tasks = this.requireTasks();
		const project = tasks.getProject(task.projectId);
		if (project === undefined) throw new Error(`project '${task.projectId}' not found`);
		const bundle = tasks.table("bundles").get(task.bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${task.bundleId}' not found`);
		if (!["pdf", "si"].includes(task.kind)) throw new Error(`kind must be pdf or si, got '${task.kind}'`);
		const workspace = await tasks.ensureProjectWorkspace(task.projectId);
		// 旧数据迁移：先把 captured-literature/<bundleId>/ 下已登记文件迁到条目目录，
		// 再写本次文件，确保正文与 SI 永远落在同一条目目录（文档 4.1 迁移要求）。
		const settled = await tasks.ensureBundleEntryLayout(bundle);
		const layout = { entryStem: settled.entryStem, entryDir: settled.entryDir };
		await mkdir(layout.entryDir, { recursive: true });
		const extension = fileName.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1];
		const targetName = entryFileName(layout.entryStem, task.kind, extension);
		const targetPath = join(layout.entryDir, targetName);
		const tmpPath = join(layout.entryDir, `.tmp-${randomBytes(8).toString("hex")}`);
		await writeFile(tmpPath, buffer);
		try {
			await rename(tmpPath, targetPath);
		} catch (error) {
			// Windows 上目标已存在时 rename 可能失败：先移除旧目标再重试一次。
			await rm(targetPath, { force: true });
			await rename(tmpPath, targetPath);
		}
		await tasks.registerCapturedFile({
			projectId: task.projectId,
			bundleId: task.bundleId,
			kind: task.kind,
			filePath: targetPath,
			fileName: targetName,
			size: buffer.byteLength,
			fileSha256: createHash("sha256").update(buffer).digest("hex"),
			tokenSha256: task.tokenSha256
		});
		if (task.kind === "si" && bundle.siPath && bundle.siPath !== targetPath) {
			await rm(bundle.siPath, { force: true }).catch(() => {});
		}
		return tasks.table("bundles").get(task.bundleId);
	}
}

export default LabCaptureService;
