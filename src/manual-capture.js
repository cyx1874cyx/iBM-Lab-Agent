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

/** 捕获文件大小上限：250 MiB。 */
export const CAPTURE_MAX_BYTES = 250 * 1024 * 1024;

/** PDF 最小字节数（复用文献浏览器的判断口径：过小疑似错误页）。 */
export const CAPTURE_PDF_MIN_BYTES = 8 * 1024;

/** SI 补充材料允许的扩展名（小写、无点）。 */
/** 出版社实际提供的 SI 格式：PDF、Office 文档或资源压缩包。 */
export const SUPPORTED_SI_EXTENSIONS = ["pdf", "docx", "zip"];

/** 合法 chrome-extension:// Origin：MV3 扩展 id 是 32 个 a-p 字符。 */
export const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/([a-p]{32})$/i;

/** 捕获任务行（持久化；token 只存哈希）。 */
export const labCaptureTaskSchema = z.object({
	id: z.string().min(1),
	projectId: z.string().min(1),
	bundleId: z.string().min(1),
	/** 发起获取的对话；浏览器侧栏跟随此对话，不按课题历史列表切换。 */
	sessionId: z.string().min(1).optional(),
	/** pdf | si：决定匹配的下载类型与登记字段。 */
	kind: z.enum(["pdf", "si"]),
	/** user：界面点击；agent：由 AI Tool 排队，等待桌面界面一次性领取令牌。 */
	requestedBy: z.enum(["user", "agent"]).default("user"),
	/** AI 仅在用户明确回复“我已登录”后置 true；桌面端据此执行确认并继续。 */
	loginConfirmedByUser: z.boolean().default(false),
	/** 历史任务可能仍带 auto；新任务均写 ai，并由 Agent 操作页面。 */
	mode: z.enum(["ai", "auto"]).default("ai"),
	/** 用户手工下载前同步打开的出版社页面（DOI 存在时为 https://doi.org/<doi>）。 */
	publisherUrl: z.string().url().optional(),
	status: z.enum(CAPTURE_STATUSES).default("armed"),
	/** beta1 兼容字段；beta2 不接受它作为覆盖授权。 */
	allowOverwrite: z.boolean().default(false),
	/** R4：机器可读的失败原因码（与 `message` 并存，message 给人看）。 */
	reasonCode: z.string().optional(),
	access: z.object({state:z.enum(['unknown','accessible','access-denied','login-required','verification-required','not-found','page-error']),evidence:z.string(),checkedAt:z.string()}).optional(),
	/** R3：归档冲突的现场信息（已归档的文件名/大小/哈希/时间），供状态与 UI 展示。 */
	archiveConflict: z.object({
		kind: z.enum(["pdf", "si"]),
		fileName: z.string(),
		size: z.number().int().nonnegative().optional(),
		sha256: z.string().optional(),
		archivedAt: z.string().optional()
	}).optional(),
	/** 一次性令牌的 SHA-256 十六进制；明文 token 只出现在创建响应中一次。 */
	tokenSha256: z.string().regex(/^[0-9a-f]{64}$/),
	expiresAt: z.string(),
	fileName: z.string().optional(),
	size: z.number().int().nonnegative().optional(),
	fileSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
	error: z.string().optional(),
	/** 取消原因单独存：`error` 要留给真正的失败原因（R5b）。 */
	cancelReason: z.string().optional(),
	/** 最近若干条错误/取消历史，便于事后回溯（取消不再覆盖诊断信息）。 */
	errorHistory: z.array(z.object({
		at: z.string(),
		kind: z.enum(["upload-failed", "browser-operation", "cancel", "restart"]),
		message: z.string()
	})).optional(),
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

/** 下载文件名是否匹配捕获任务类型。正文必须为 PDF，SI 按白名单接收。 */
export function kindMatchesFileName(kind, fileName) {
	const ext = extensionOf(fileName);
	if (kind === "pdf") return ext === "pdf";
	if (kind === "si") return SUPPORTED_SI_EXTENSIONS.includes(ext);
	return false;
}

/**
 * 校验捕获文件内容。PDF 检查签名与 EOF；DOCX/ZIP 检查 ZIP 容器签名；
 * 所有格式都执行大小与 SHA-256 校验。
 * @returns {{ sha256: string, byteLength: number }}
 */
/**
 * 带稳定 code 的校验错误（R3）。
 *
 * 200-9-27 现场：400 只给一句中文，而 `captureHttpStatusFor` 又把它压成状态码，
 * 事后无法判断到底是"过小""缺头"还是"缺 EOF"。code 是给机器看的，message 是给人看的。
 */
export function captureValidationError(code, message) {
	const error = new Error(message);
	error.code = code;
	error.captureBytes = undefined;
	return error;
}

export function validateCapturedFile({ kind, buffer, fileName }) {
	const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
	if (bytes.byteLength > CAPTURE_MAX_BYTES) {
		throw captureValidationError("too-large", `文件超过 ${Math.round(CAPTURE_MAX_BYTES / 1024 / 1024)} MiB 安全上限`);
	}
	if (kind !== "pdf" && kind !== "si") {
		throw new Error(`未知捕获类型：${kind}`);
	}
	const ext = extensionOf(fileName);
	if (!kindMatchesFileName(kind, fileName)) {
		throw captureValidationError("kind-mismatch", `${kind === "pdf" ? "正文" : "SI"}任务不接受 .${ext || "?"} 文件`);
	}
	if (ext === "pdf") {
		// R3：每条判据都带稳定 code，调用方不必靠中文文案猜失败原因。
		if (bytes.byteLength < CAPTURE_PDF_MIN_BYTES) {
			throw captureValidationError("payload-too-small", `PDF 文件过小（${bytes.byteLength} 字节），疑似错误页`);
		}
		if (!bytes.subarray(0, Math.min(bytes.byteLength, 1024)).includes(Buffer.from("%PDF-"))) {
			throw captureValidationError("missing-pdf-header", "下载内容不是有效 PDF（缺少 PDF 文件头）");
		}
		if (!bytes.subarray(Math.max(0, bytes.byteLength - 4096)).includes(Buffer.from("%%EOF"))) {
			throw captureValidationError("missing-eof", "PDF 结尾不完整（缺少 EOF 标记）");
		}
	} else {
		if (bytes.byteLength < 22) throw captureValidationError("payload-too-small", `${ext.toUpperCase()} 文件过小，疑似错误页`);
		if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]))) {
			throw captureValidationError("missing-zip-container", `${ext.toUpperCase()} 文件不是有效的 ZIP/Office 容器`);
		}
	}
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		byteLength: bytes.byteLength
	};
}

/**
 * 条目的归档槽位（R3）：该类型已登记的产物路径与摘要。
 *
 * 纯函数，不碰文件系统——"登记了但盘上文件已不在"由调用方用 `existsSync` 判定，
 * 这样这一层仍然可以在单测里直接跑。
 */
export function archiveSlotOf(bundle, kind) {
	const path = kind === "pdf" ? bundle?.pdfPath : bundle?.siPath;
	if (typeof path !== "string" || path.length === 0) return undefined;
	const digest = kind === "pdf" ? bundle?.pdfSha256 : bundle?.siSha256;
	return {
		kind,
		path,
		fileName: path.split(/[\\/]/).pop() || path,
		sha256: typeof digest === "string" && digest ? digest : undefined,
		archivedAt: typeof bundle?.updatedAt === "string" ? bundle.updatedAt : undefined
	};
}

/**
 * 归档冲突（R3）：同一 `bundle + kind` 上已经有一份被登记的产物时，**不得静默覆盖**。
 *
 * 现场教训：旧版会在目标存在时删除旧文件，再以新文件覆盖条目。beta2 一律拒绝
 * 冲突，直到分件管理具有可验证的人工确认和回滚能力。
 */
export function captureArchiveConflict(code, existing) {
	const label = existing?.kind === "si" ? "补充材料" : "正文";
	const error = captureValidationError(
		code,
		`条目已归档${label}（${existing?.fileName ?? "未知文件"}）；本版拒绝覆盖，请保留原文件`
	);
	error.existing = existing;
	return error;
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
	// R4：有 code 就按 code 判定，别再靠中文字符串匹配（文案一改，状态码就漂）。
	const byCode = {
		"token-invalid": 404,
		"token-replayed": 409,
		"task-not-armed": 409,
		"task-expired": 409,
		"already-archived": 409,
		"bundle-missing": 404,
		"kind-mismatch": 400,
		"payload-too-small": 400,
		"missing-pdf-header": 400,
		"missing-eof": 400,
		"too-large": 413,
		"storage-failed": 500,
		"browser-operation": 400
	};
	if (error?.code && byCode[error.code] !== undefined) return byCode[error.code];
	const message = String(error?.message ?? error ?? "");
	if (message.includes("not found")) return 404; // 非法/未知令牌
	if (message.includes("replay") || message.includes("已使用") || message.includes("过期") || message.includes("已失效")) return 409;
	if (message.includes("Origin")) return 403;
	if (message.includes("上限") || message.includes("过大")) return 413; // 超过大小上限
	return 400; // 内容/格式/匹配错误（含"过小"）
}

/** 任务可上传性检查：armed 且未过期，且从未成功/失败过（防重放）。 */
export function assertTaskUploadable(task, now = new Date()) {
	// R4：每条拒绝都带稳定的 code，调用方靠它决策，而不是靠中文文案。
	if (task === undefined) throw captureValidationError("token-invalid", "token 无效（capture task not found）");
	if (task.status !== "armed") {
		if (task.status === "completed") throw captureValidationError("token-replayed", "该捕获令牌已使用（replay denied）");
		throw captureValidationError("task-not-armed", `捕获任务状态为 ${task.status}，令牌已失效`);
	}
	if (isCaptureExpired(task, now)) throw captureValidationError("task-expired", "捕获任务已过期，令牌已失效");
}
