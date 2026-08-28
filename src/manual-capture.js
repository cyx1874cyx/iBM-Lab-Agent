/**
 * dsh-lab-agent: 手工下载文献自动捕获（纯逻辑层）。
 *
 * 用户点击文献精读条目中未获取的 PDF/SI 灰色按钮 → 服务端创建一个一次性
 * 捕获任务（带 32 字节随机令牌，只持久化令牌哈希）→ 用户在出版社页面手工
 * 下载 → Chrome 扩展/本地桥接把文件 PUT 到上传端点 → 服务端校验并登记到
 * 原有 bundle。本文件只放不依赖 Cordis 的模型、校验与路径规则，便于单元测试；
 * Cordis 服务本体见 lib/manual-capture.js。
 *
 * 安全边界（与需求 P1 对应）：
 *   - 令牌一次性、绑定 projectId/bundleId/kind/到期时间，完成/失败/过期即失效；
 *   - 上传令牌只存哈希，明文只出现在创建响应中一次；
 *   - 文件名清洗路径字符、禁止目录穿越，保存路径由服务端从课题工作区构造，
 *     绝不接受客户端提供的保存路径；
 *   - 微信来源无 DOI 时拒绝启动捕获，不得回退到公众号链接；
 *   - 捕获只登记原始文件，不冒充已完成的全文精读（不改 report/bundle 状态机）。
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { normalizeDoi } from "./literature/search-engine.js";

/** 捕获任务生命周期：armed（等待下载）→ uploading → completed | failed | expired | cancelled。 */
export const CAPTURE_STATUSES = ["armed", "uploading", "completed", "failed", "expired", "cancelled"];

/** 默认有效期（毫秒）：20 分钟。 */
export const CAPTURE_TTL_MS = 20 * 60 * 1000;

/** 上传大小上限：100 MB。 */
export const CAPTURE_MAX_BYTES = 100 * 1024 * 1024;

/** PDF 最小字节数（复用文献浏览器的判断口径：过小疑似错误页）。 */
export const CAPTURE_PDF_MIN_BYTES = 8 * 1024;

/** SI 补充材料允许的扩展名（小写、无点）。 */
export const SUPPORTED_SI_EXTENSIONS = ["pdf", "zip", "docx", "xlsx", "csv", "txt", "cif", "sdf"];

/** 合法 chrome-extension:// Origin：MV3 扩展 id 是 32 个 a-p 字符。 */
export const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/([a-p]{32})$/i;

/** 捕获任务行（持久化；token 只存哈希）。 */
export const labCaptureTaskSchema = z.object({
	id: z.string().min(1),
	projectId: z.string().min(1),
	bundleId: z.string().min(1),
	/** pdf | si：决定匹配的下载类型与登记字段。 */
	kind: z.enum(["pdf", "si"]),
	/** 用户手工下载前同步打开的出版社页面（DOI 存在时为 https://doi.org/<doi>）。 */
	publisherUrl: z.string().url().optional(),
	status: z.enum(CAPTURE_STATUSES).default("armed"),
	/** 一次性令牌的 SHA-256 十六进制；明文 token 只出现在创建响应中一次。 */
	tokenSha256: z.string().regex(/^[0-9a-f]{64}$/),
	expiresAt: z.string(),
	fileName: z.string().optional(),
	size: z.number().int().nonnegative().optional(),
	fileSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
	error: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 生成 32 字节随机一次性令牌；只返回明文与哈希，调用方只持久化哈希。 */
export function createCaptureToken() {
	const token = randomBytes(32).toString("base64url");
	const tokenSha256 = createHash("sha256").update(token).digest("hex");
	return { token, tokenSha256 };
}

/** 默认到期时间：now + 20 分钟。 */
export function captureExpiresAt(now = new Date(), ttlMs = CAPTURE_TTL_MS) {
	return new Date(now.getTime() + ttlMs).toISOString();
}

/**
 * 清洗上传文件名：去除路径组件与保留字符，禁止目录穿越。
 * 保留扩展名（SI 校验要用）；空名回退 capture-<kind>。
 */
export function sanitizeCaptureFileName(value, kind) {
	const raw = String(value ?? "").trim();
	const cleaned = raw
		.replace(/\\/g, "/") // 统一分隔符
		.split("/")
		.pop() // 只留最后一段（去目录穿越）
		.replace(/[<>:"|?*\x00-\x1f]/g, "_")
		.replace(/^\.+/, "") // 去前导点（. / ..）
		.trim()
		.slice(0, 200);
	const withExt = /\.\w{1,12}$/.test(cleaned) ? cleaned : `${cleaned || `capture-${kind}`}.bin`;
	return withExt || `capture-${kind}.bin`;
}

/** 文件扩展名（小写、无点）。 */
export function extensionOf(fileName) {
	const match = String(fileName ?? "").match(/\.([A-Za-z0-9]{1,12})$/);
	return match ? match[1].toLowerCase() : "";
}

/** 下载文件名是否匹配捕获任务类型。 */
export function kindMatchesFileName(kind, fileName) {
	const ext = extensionOf(fileName);
	if (kind === "pdf") return ext === "pdf";
	if (kind === "si") return SUPPORTED_SI_EXTENSIONS.includes(ext);
	return false;
}

/**
 * 校验捕获文件内容。
 * PDF：%PDF- 头 + %%EOF + 大小上限；SI：扩展名白名单（内容不做深度解析，
 * 与出版社补充材料经常为打包格式的现实一致，但保留大小上限）。
 * @returns {{ sha256: string, byteLength: number }}
 */
export function validateCapturedFile({ kind, buffer, fileName }) {
	const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
	if (bytes.byteLength > CAPTURE_MAX_BYTES) {
		throw new Error(`文件超过 ${Math.round(CAPTURE_MAX_BYTES / 1024 / 1024)} MB 安全上限`);
	}
	const ext = extensionOf(fileName);
	if (kind === "pdf") {
		if (ext !== "pdf") throw new Error(`PDF 任务只接受 .pdf 文件（收到 .${ext || "?"}）`);
		if (bytes.byteLength < CAPTURE_PDF_MIN_BYTES) throw new Error(`PDF 文件过小（${bytes.byteLength} 字节），疑似错误页`);
		if (!bytes.subarray(0, Math.min(bytes.byteLength, 1024)).includes(Buffer.from("%PDF-"))) {
			throw new Error("下载内容不是有效 PDF（缺少 PDF 文件头）");
		}
		if (!bytes.subarray(Math.max(0, bytes.byteLength - 4096)).includes(Buffer.from("%%EOF"))) {
			throw new Error("PDF 结尾不完整（缺少 EOF 标记）");
		}
	} else if (kind === "si") {
		if (!SUPPORTED_SI_EXTENSIONS.includes(ext)) {
			throw new Error(`SI 只支持 ${SUPPORTED_SI_EXTENSIONS.join("/").toUpperCase()} 格式（收到 .${ext || "?"}）`);
		}
		if (bytes.byteLength === 0) throw new Error("SI 文件为空");
	} else {
		throw new Error(`未知捕获类型：${kind}`);
	}
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		byteLength: bytes.byteLength
	};
}

/**
 * 由 bundle 推导出版社页面地址。
 * DOI 存在时一律使用 https://doi.org/<doi>；微信来源（sourceType=wechat）没有
 * DOI 时返回 undefined——调用方必须拒绝启动捕获，绝不回退到公众号链接。
 */
export function publisherUrlForBundle(bundle) {
	const doi = bundle?.doi ? normalizeDoi(bundle.doi) : undefined;
	if (doi) return `https://doi.org/${doi}`;
	// 微信来源绝不回退公众号链接；普通来源允许使用已登记的 HTTPS 出版社页面。
	if (bundle?.sourceType !== "wechat" && bundle?.sourceUrl) {
		try {
			const url = new URL(bundle.sourceUrl);
			if (url.protocol === "https:" && url.hostname !== "mp.weixin.qq.com") return url.href;
		} catch { /* invalid source URL */ }
	}
	return undefined;
}

/** 任务是否已过期（惰性判定；不修改存储）。 */
export function isCaptureExpired(task, now = new Date()) {
	return task.status === "armed" && task.expiresAt !== undefined && new Date(task.expiresAt).getTime() <= now.getTime();
}

/** 上传响应错误映射：与 HTTP 状态码对齐。 */
export function captureHttpStatusFor(error) {
	const message = String(error?.message ?? error ?? "");
	if (message.includes("not found")) return 404; // 非法/未知令牌
	if (message.includes("replay") || message.includes("已使用") || message.includes("过期") || message.includes("已失效")) return 409;
	if (message.includes("Origin")) return 403;
	if (message.includes("上限") || message.includes("过大")) return 413; // 超过大小上限
	return 400; // 内容/格式/匹配错误（含"过小"）
}

/** 任务可上传性检查：armed 且未过期，且从未成功/失败过（防重放）。 */
export function assertTaskUploadable(task, now = new Date()) {
	if (task === undefined) throw new Error("token 无效（capture task not found）");
	if (task.status !== "armed") {
		if (task.status === "completed") throw new Error("该捕获令牌已使用（replay denied）");
		throw new Error(`捕获任务状态为 ${task.status}，令牌已失效`);
	}
	if (isCaptureExpired(task, now)) throw new Error("捕获任务已过期，令牌已失效");
}
