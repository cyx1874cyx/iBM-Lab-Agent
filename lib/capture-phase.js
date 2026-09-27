/**
 * dsh-lab-agent: 文献捕获任务的「唯一真相」推导。
 *
 * 2026-09-27 现场反馈的根因：工具里的 `phase` 与文献浏览器小球各自推导，于是出现
 * 「工具说 queued（队列第 1 位）、面板/小球说失败」这种自相矛盾；更要命的是
 * armed 且（心跳过期 或 浏览器已交给别的任务）被一律折叠成 `queued`，
 * 让 AI 把「已经死掉的任务」当成「还在排队」反复 wait-and-poll。
 *
 * 这里把推导收成一个纯函数：插件工具、状态工具、队列小球、前端提示条全部读它。
 * 本模块不依赖 Cordis、不读文件、不发请求，因此可以在任何一层直接 import。
 */

/** 客户端上报心跳的新鲜度上限（与 `lib/manual-capture.js` 的 stale 判定一致）。 */
export const CAPTURE_HEARTBEAT_TTL_MS = 10_000;

/** 长耗时阶段（下载/保存/归档前等待）放宽后的心跳上限（C13）。 */
export const CAPTURE_BUSY_HEARTBEAT_TTL_MS = 60_000;

/** 下载/保存期间「无字节增长」多久算停滞（C17）。 */
export const CAPTURE_STALL_MS = 60_000;

/**
 * 从未被浏览器接管时的排队宽限：客户端每 1.8 秒领取一次任务，
 * 超过这个时间还停在「没人接管」就不是排队，而是失去了接管（C6 第 3 种终态）。
 */
export const CAPTURE_QUEUE_GRACE_MS = 25_000;

/** 保持真实顺序：先分档 TTL，再按阶段判断。 */
export function heartbeatTtlMs(state, automationStage) {
	const busy = state === "downloading" || state === "uploading"
		|| (state === "waiting-download" && automationStage === "saving");
	return busy ? CAPTURE_BUSY_HEARTBEAT_TTL_MS : CAPTURE_HEARTBEAT_TTL_MS;
}

const DOI_RE = /10\.\d{4,9}\/[^\s"'<>\\]+/i;

/** 从任务行或页面 URL 里取 DOI（去掉尾随标点，避免把句号带进 URL）。 */
export function doiOf(value = {}) {
	const fromDoi = String(value.doi ?? "").match(DOI_RE);
	if (fromDoi) return fromDoi[0].replace(/[.,;:)\]]+$/, "");
	const fromUrl = String(value.publisherUrl ?? value.pageUrl ?? "").match(DOI_RE);
	return fromUrl ? fromUrl[0].replace(/[.,;:)\]]+$/, "") : undefined;
}

/**
 * 规范化出「点了就下载」的备用入口（C8）。
 *
 * 现场实测：`/doi/epdf/<doi>` 与 `/doi/reader/<doi>` 都只进预览器，
 * `/doi/pdf/<doi>?download=true` 才是直接触发下载的入口。支路失效时必须把
 * 这条可执行的路交给调用方，而不是让它去点一个点了没反应的按钮。
 */
export function normalizeDownloadEntry(pageUrl, doi) {
	const target = doiOf({ publisherUrl: pageUrl, doi });
	if (!target) return undefined;
	let origin = "";
	try { origin = new URL(String(pageUrl)).origin; } catch { origin = ""; }
	return `${origin}/doi/pdf/${target}?download=true`;
}

const PHASES = {
	queued: { tone: "waiting", text: "已排队，等待软件内浏览器接管" },
	"waiting-login": { tone: "waiting", text: "等待 WebVPN 登录：请在软件侧栏完成登录" },
	ready: { tone: "waiting", text: "机构访问通道可用，正在打开出版社页面…" },
	navigating: { tone: "waiting", text: "正在打开出版社页面…" },
	"waiting-download": { tone: "waiting", text: "正在等待出版社页面加载…" },
	downloading: { tone: "busy", text: "正在下载文件…" },
	saving: { tone: "busy", text: "正在保存原生 PDF…" },
	uploading: { tone: "busy", text: "正在归档到课题…" },
	completed: { tone: "complete", text: "下载完成，文件已归档到课题" },
	failed: { tone: "error", text: "下载失败" },
	expired: { tone: "error", text: "下载任务已过期" },
	cancelled: { tone: "error", text: "下载任务已取消" },
	error: { tone: "error", text: "软件内浏览器发生错误" },
	"heartbeat-lost": { tone: "error", text: "失去文献浏览器心跳，任务已中断" },
	orphaned: { tone: "error", text: "文献浏览器已释放该任务，任务已中断" },
	stalled: { tone: "error", text: "长时间没有进度，任务疑似卡住" }
};

const USER_ACTION_PHASES = new Set([
	"failed", "expired", "error", "heartbeat-lost", "orphaned", "stalled"
]);

/** 可以「用同一篇文献重建」的阶段（C11）。 */
const RECREATABLE_PHASES = new Set([
	"failed", "expired", "error", "heartbeat-lost", "orphaned", "stalled", "cancelled"
]);

const formatBytes = (bytes) => {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function ownershipOf(task, desktop) {
	if (desktop.stale) return "unknown";
	if (desktop.pendingTaskId === task.id) return "held";
	if (desktop.pendingTaskId) return "busy-other";
	if (desktop.lastPendingTaskId === task.id) return "released";
	return "never";
}

/**
 * 推导任务视图。所有消费方（工具、小球、提示条）都应使用本函数的结果。
 *
 * @param {object} input
 * @param {object} input.task 捕获任务行
 * @param {object} input.desktop `getDesktopWebVpnStatus()` 的返回值
 * @param {number} [input.queuePosition] 1 起的排队位置
 * @param {number} [input.stalledMs] 壳/服务观测到的无进度毫秒数
 * @param {number} [input.now] 当前毫秒时间戳（测试注入）
 */
export function deriveCaptureView({ task, desktop = {}, queuePosition, stalledMs = 0, now = Date.now() }) {
	const held = !desktop.stale && desktop.pendingTaskId === task.id;
	const ownership = ownershipOf(task, desktop);
	const page = {
		url: desktop.pageUrl,
		documentType: desktop.documentType,
		httpStatus: desktop.httpStatus,
		readyState: desktop.readyState,
		pageSeq: desktop.pageSeq,
		contentLength: desktop.contentLength
	};
	const pdf = {
		ready: Boolean(desktop.pdfPayload?.ready),
		complete: Boolean(desktop.pdfPayload?.complete),
		contentLength: desktop.pdfPayload?.contentLength,
		receivedBytes: Number(desktop.pdfPayload?.receivedBytes) || 0,
		error: desktop.pdfPayload?.error
	};
	const maxBytes = Number(desktop.maxCaptureBytes) || 0;
	const receivedBytes = Number(desktop.downloadedBytes) || Number(task.size) || 0;
	const sizeNote = maxBytes > 0 && receivedBytes > maxBytes
		? `；文件约 ${Math.round(receivedBytes / 1048576)} MB 已超过 ${Math.round(maxBytes / 1048576)} MB 捕获上限，上传会被拒（可用 lab_tasks_update_bundle_file 直接登记该文件）`
		: "";
	const agentDriven = task.mode === "ai" && task.requestedBy === "agent";
	const entry = normalizeDownloadEntry(page.url || task.publisherUrl, doiOf(task));
	const alternateEntry = entry && entry !== String(page.url || "") ? entry : undefined;

	let phase = task.status;
	let stageMessage;
	let nextAction;

	if (task.status === "armed") {
		if (desktop.stale) {
			// C6 第 1 种：心跳过期 ≠ 排队。前者是「不知道」，后者是「确定在等」。
			phase = "heartbeat-lost";
		} else if (held) {
			phase = desktop.state;
			// 原生 PDF 的字节流已经在壳里落盘：此时保存是**确定可执行**的一步，
			// 所以明确给出 save-pdf-ready，而不是让调用方去猜查看器能不能点。
			if (pdf.ready && ["waiting-download", "downloading", "navigating"].includes(phase)) {
				nextAction = "save-pdf-ready";
			} else if (phase === "waiting-download") {
				const stageLabels = {
					opening: "正在打开出版社页面",
					searching: "正在查找下载入口",
					clicked: "已点击下载入口，等待浏览器开始下载",
					// 验证只能由人完成：必须说清楚「请你点一下」，否则调用方会一直 wait-and-poll。
					verification: "出版社页面要求人机验证：请在软件侧栏点一下「请验证您是真人」，通过后会自动继续查找下载入口",
					manual: task.kind === "pdf"
						? "保存支路未就绪：原生 PDF 查看器里没有可点元素，请改用带 ?download=true 的入口重新进入"
						: "未确认自动下载入口，请在预览器中手动保存补充材料",
					saving: "正在保存原生 PDF"
				};
				stageMessage = stageLabels[desktop.automationStage];
			}
		} else if (ownership === "busy-other") {
			// 浏览器正忙着别的任务：这是真正的排队。
			phase = "queued";
		} else if (ownership === "released") {
			// C6 第 2 种：接管过又被交还（壳上报 releaseReason）= 终态，不是 queued。
			phase = "orphaned";
		} else if (needsLogin(desktop, task)) {
			phase = "waiting-login";
		} else if (waitingTooLong(task, now)) {
			// C6 第 3 种：一直没人接管，超过宽限期就不是排队，而是「从未被接管」。
			phase = "orphaned";
		} else {
			phase = "queued";
		}
	}

	// 停滞检测（C17）：下载/保存期间长期没有字节增长，不能再显示「正在保存」。
	const stalled = ["downloading", "saving"].includes(phase) && stalledMs >= CAPTURE_STALL_MS;
	if (stalled) phase = "stalled";

	const kind = PHASES[phase] ?? { tone: "waiting", text: phase };
	const requiresUserAction = USER_ACTION_PHASES.has(phase);
	const verificationPending = !requiresUserAction && phase === "waiting-download" && held
		&& desktop.automationStage === "verification";

	let message;
	if (stalled) {
		message = `下载/保存已 ${Math.round(stalledMs / 1000)} 秒没有任何字节增长，任务疑似卡住`;
	} else if (phase === "heartbeat-lost") {
		message = `与软件内文献浏览器失去心跳（上次上报 ${Math.round((desktop.ageMs ?? 0) / 1000)} 秒前），任务已中断`;
	} else if (phase === "orphaned") {
		message = ownership === "released"
			? `文献浏览器已交还该任务（原因：${desktop.releaseReason || "未说明"}），任务已中断`
			: "文献浏览器始终没有接管该任务，任务已中断";
	} else if (nextAction === "save-pdf-ready") {
		message = `PDF 字节流已就绪（${formatBytes(pdf.contentLength || pdf.receivedBytes)}），调用 lab_browser_save_current_pdf 归档到课题`;
	} else if (phase === "waiting-download" && (desktop.automationStage === "manual") && task.kind === "pdf" && !pdf.ready) {
		message = entry
			? `保存支路不可用（原生 PDF 查看器无可用元素）。请改用下载入口 ${entry} 重新进入`
			: "保存支路不可用（原生 PDF 查看器无可用元素），请重新观察页面另选入口";
	} else if (agentDriven && phase === "waiting-download") {
		message = "页面已打开，由你直接操作：lab_browser_observe（scope=all）看清页面 → lab_browser_click 点入口 → lab_browser_wait 等变化 → 需要时 lab_browser_save_current_pdf 保存";
	} else {
		message = stageMessage ?? kind.text;
	}

	if (nextAction === undefined) {
		nextAction = requiresUserAction ? "recreate-or-cancel"
			: ["completed", "cancelled"].includes(phase) ? "done"
			: verificationPending ? "complete-verification"
			: phase === "waiting-download" && desktop.automationStage === "manual"
				? task.kind === "pdf" ? "retry-download-entry" : "observe-or-click"
			: agentDriven && phase === "waiting-download" ? "observe-or-click"
			: "wait-and-poll";
	}

	const question = requiresUserAction
		? `文献获取中断（${message}）。可以：（1）用同一篇文献重建获取任务；（2）终止并清理这个任务。你要哪一个？`
		: undefined;

	return {
		phase,
		message: `${message}${phase === "queued" && queuePosition ? `（队列第 ${queuePosition} 位）` : ""}${task.error && !requiresUserAction ? `：${task.error}` : ""}${sizeNote}`,
		nextAction,
		requiresUserAction,
		question,
		alternateEntry,
		page,
		pdf,
		queuePosition,
		ball: {
			phase,
			tone: kind.tone,
			text: message,
			stalled,
			canRecreate: RECREATABLE_PHASES.has(phase),
			canCancel: !["completed", "cancelled"].includes(phase)
		}
	};
}

function needsLogin(desktop, task) {
	// 公开 SI 不依赖 WebVPN；正文必须等登录。
	if (task.kind === "pdf") return !desktop.ready && !desktop.iwanReady;
	return !/10\.(?:1038|1007)\//i.test(task.publisherUrl || "") && !desktop.ready && !desktop.iwanReady;
}

function waitingTooLong(task, now) {
	const created = Date.parse(task.createdAt || "");
	if (!Number.isFinite(created)) return false;
	return now - created > CAPTURE_QUEUE_GRACE_MS;
}
