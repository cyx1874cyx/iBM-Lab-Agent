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

/**
 * 终态：不会再前进的阶段。
 *
 * 用途之一是"队列位次"（B5）——终态任务仍然 `armed`，但它们不该继续占位，
 * 否则队列位置会一直骗人。
 */
export const TERMINAL_PHASES = new Set([
	...USER_ACTION_PHASES, "completed", "cancelled"
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
export function deriveCaptureView({ task, desktop = {}, queuePosition, stalledMs = 0, progressBps, now = Date.now() }) {
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
	// 壳上报的"已接收"（下载目标与响应层载荷取较大者），回退到任务行里的 size。
	const receivedBytes0 = Number(desktop.downloadedBytes) || Number(task.size) || 0;
	const sizeNote = maxBytes > 0 && receivedBytes0 > maxBytes
		? `；文件约 ${Math.round(receivedBytes / 1048576)} MB 已超过 ${Math.round(maxBytes / 1048576)} MB 捕获上限，上传会被拒（可用 lab_tasks_update_bundle_file 直接登记该文件）`
		: "";
	const agentDriven = task.mode === "ai" && task.requestedBy === "agent";
	// C?/D6：进度对象。`totalBytes` 未知时**省略** percent/etaSeconds，而不是给 0——
	// 报一个假的百分比比不报更糟（调用方会据此判断"快完了"）。
	const totalBytes = pdf.contentLength;
	const receivedBytes = Math.max(pdf.receivedBytes, receivedBytes0);
	const percent = Number.isFinite(totalBytes) && totalBytes > 0
		? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
		: undefined;
	const speedBps = Number.isFinite(progressBps) && progressBps > 0 ? Math.round(progressBps) : undefined;
	const etaSeconds = percent !== undefined && speedBps && totalBytes > receivedBytes
		? Math.max(1, Math.round((totalBytes - receivedBytes) / speedBps))
		: undefined;
	const progress = {
		receivedBytes,
		totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined,
		// 与 totalBytes 同源，但把"这是声明的文件总长"写成显式字段：调用方据此判断
		// "收满了没有"，不必猜 totalBytes 是总长还是某一次分片的大小（B1）。
		declaredTotalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined,
		percent,
		speedBps,
		etaSeconds,
		// 最后一次字节变化至今的秒数：调用方可以据此判"是不是还在动"。
		idleSeconds: Math.round((Number(stalledMs) || 0) / 1000)
	};
	const entry = normalizeDownloadEntry(page.url || task.publisherUrl, doiOf(task));
	const alternateEntry = entry && entry !== String(page.url || "") ? entry : undefined;

	let phase = task.status;
	let stageMessage;
	let nextAction;
	// 载荷正在接收（还没有完整性证明）：消息要走"已接收 X / 共 Y"分支。
	let receiving = false;
	// 载荷收了但没证明完整（壳已放弃）：要报"未收全"，不许伪装成"正在接收"。
	let payloadFailed = false;

	if (task.status === "armed") {
		if (desktop.stale) {
			// C6 第 1 种：心跳过期 ≠ 排队。前者是「不知道」，后者是「确定在等」。
			phase = "heartbeat-lost";
		} else if (held) {
			phase = desktop.state;
			// 归档门必须同时要求 ready 与 complete（D5）。只看 ready 会踩上一个
			// 真实事故：壳在累计收到 256 KiB 时就把 ready 打出来，调用方据此去归档
			// 一个还没下完的文件，最后拿回一个 HTTP 400，而真正的原因（载荷没下完）
			// 已经丢失。`complete` 只由壳的正向证明给出（收满 Content-Length，或
			// 尾部出现 %%EOF）。
			if (pdf.ready && pdf.complete && ["waiting-download", "downloading", "navigating"].includes(phase)) {
				nextAction = "save-pdf-ready";
			} else if (pdf.error && !pdf.complete) {
				// 载荷没能收全（壳已放弃等待）。必须说清"收了多少 / 共多少"，并给一条
				// 可执行的路——绝不能让它看起来像"再等等就好"。
				payloadFailed = true;
				nextAction = "retry-download-entry";
			} else if (pdf.ready && !pdf.complete) {
				// 字节还在进：只等，绝不归档。这是调用方唯一需要的信号。
				nextAction = "wait-and-poll";
				receiving = true;
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
	} else if (payloadFailed) {
		message = `PDF 载荷未收全（${formatBytes(progress.receivedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}）：${pdf.error}${entry ? `。请改用下载入口 ${entry} 重新进入` : "。请重新观察页面另选入口"}`;
	} else if (receiving) {
		// 只有拿到 Content-Length 才谈得上百分比；缺总长时如实说"总大小未知"，
		// 绝不用分片大小冒充总量（现场那条「已就绪（256.0 KB）」就是这么来的）。
		message = progress.totalBytes
			? `PDF 正在接收（${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}，${progress.percent}%${progress.etaSeconds === undefined ? "" : `，约剩 ${progress.etaSeconds} 秒`}）；收满后 nextAction 会变成 save-pdf-ready，现在不要归档`
			: `PDF 正在接收（已接收 ${formatBytes(progress.receivedBytes)}，总大小未知）；收满后 nextAction 会变成 save-pdf-ready，现在不要归档`;
	} else if (nextAction === "save-pdf-ready") {
		// 完整性已证明，这里给的是**总长**（不是当前分片）。
		message = `PDF 已完整接收（${formatBytes(pdf.contentLength || pdf.receivedBytes)}），调用 lab_browser_save_current_pdf 归档到课题`;
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
		progress,
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
