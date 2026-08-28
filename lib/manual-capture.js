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
import { join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
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
			res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "PUT, OPTIONS", "access-control-allow-headers": "content-type, x-file-name", "access-control-max-age": "600", "content-length": "0" });
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
			task = await capture.resolveTaskByToken(token);
			assertTaskUploadable(task);
			const fileName = sanitizeCaptureFileName(uploadFileName(req), task.kind);
			if (!kindMatchesFileName(task.kind, fileName)) {
				throw new Error(`${task.kind === "pdf" ? "PDF" : "SI"} 任务不匹配文件名「${fileName}」`);
			}
			await capture.transit(task.id, { status: "uploading", fileName, error: undefined });
			const buffer = await readRequestBody(req, CAPTURE_MAX_BYTES);
			const integrity = validateCapturedFile({ kind: task.kind, buffer, fileName });
			const bundle = await capture.saveCapturedFile(task, { buffer, fileName, ...integrity });
			await capture.transit(task.id, {
				status: "completed",
				fileName,
				size: integrity.byteLength,
				fileSha256: integrity.sha256,
				error: undefined
			});
			sendJson(res, 200, {
				ok: true,
				taskId: task.id,
				bundleId: bundle.id,
				kind: task.kind,
				fileName,
				size: integrity.byteLength,
				sha256: integrity.sha256,
				acquisitionStatus: bundle.acquisitionStatus
			}, { ...corsHeaders(req), "x-capture-task-id": task.id });
		} catch (error) {
			const message = String(error?.message ?? error ?? "upload failed");
			const status = captureHttpStatusFor(error);
			if (task?.id) {
				await capture.transit(task.id, { status: "failed", error: message }).catch(() => {});
			}
			sendError(res, status, message, corsHeaders(req));
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
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labCapturesDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.captures.domainClose");
		this.domain = domain;
		this.table = domain.table("lab_capture_tasks");
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

	transit(id, patch, now = new Date().toISOString()) {
		const row = this.table.get(id);
		if (row === undefined) return Promise.resolve(undefined);
		const next = { ...row, ...patch, updatedAt: now };
		return this.table.put(id, next).then(() => next);
	}

	/**
	 * 创建一次性捕获任务。
	 * @returns {{ task: object, token: string }} task 为持久化行（含 tokenSha256），
	 * token 为明文一次性令牌（只在创建响应中返回一次）。
	 */
	async createCaptureTask({ projectId, bundleId, kind }) {
		const tasks = this.requireTasks();
		const project = tasks.getProject(projectId);
		if (project === undefined) throw new Error(`project '${projectId}' not found`);
		const bundle = tasks.getBundle(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		if (!["pdf", "si"].includes(kind)) throw new Error(`kind must be pdf or si, got '${kind}'`);
		// 微信来源/任何无 DOI 的条目：只允许 DOI 出版社页面；无 DOI 一律拒绝，
		// 绝不回退到公众号链接。
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

	getTask(taskId) {
		return this.table.get(taskId) ?? undefined;
	}

	listTasks(projectId) {
		return [...this.table.keys()]
			.map((key) => this.table.get(key))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
	 * 保存捕获文件到课题工作区 captured-literature/<bundleId>/，原子写入后
	 * 登记到原 bundle。目录与文件名全部由服务端决定，不接受客户端路径。
	 */
	async saveCapturedFile(task, { buffer, fileName }) {
		const tasks = this.requireTasks();
		const project = tasks.getProject(task.projectId);
		if (project === undefined) throw new Error(`project '${task.projectId}' not found`);
		const workspace = await tasks.ensureProjectWorkspace(task.projectId);
		const captureDir = join(workspace.path, "captured-literature", task.bundleId);
		await mkdir(captureDir, { recursive: true });
		const tmpPath = join(captureDir, `.tmp-${randomBytes(8).toString("hex")}`);
		const targetPath = join(captureDir, fileName);
		await writeFile(tmpPath, buffer);
		try {
			await rename(tmpPath, targetPath);
		} catch (error) {
			// Windows 上目标已存在时 rename 可能失败：先移除旧目标再重试一次。
			await rm(targetPath, { force: true });
			await rename(tmpPath, targetPath);
		}
		const bundle = await tasks.registerCapturedFile({
			projectId: task.projectId,
			bundleId: task.bundleId,
			kind: task.kind,
			filePath: targetPath,
			fileName,
			size: buffer.byteLength,
			fileSha256: createHash("sha256").update(buffer).digest("hex"),
			tokenSha256: task.tokenSha256
		});
		return bundle;
	}
}

export default LabCaptureService;
