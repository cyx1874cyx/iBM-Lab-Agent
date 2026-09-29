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

/** 只给 Science 官方正文页提供可由壳验证的备用入口；其他出版社不猜路径。 */
export function normalizeDownloadEntry(pageUrl, doi) {
	try {
		const page = new URL(String(pageUrl));
		if (page.protocol !== "https:" || page.port || !["science.org", "www.science.org"].includes(page.hostname)) return undefined;
		const match = page.pathname.match(/^\/doi\/(?:epdf\/|reader\/|pdf\/)?(10\.1126\/[a-z0-9._-]+)$/i);
		if (!match || (doi && doi.toLowerCase() !== match[1].toLowerCase())) return undefined;
		if (page.pathname.startsWith("/doi/pdf/") && page.searchParams.get("download") === "true") return undefined;
		const target = new URL(`/doi/pdf/${match[1]}?download=true`, page.origin).href;
		return target === page.href ? undefined : target;
	} catch { return undefined; }
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
	const payloadError = desktop.pdfPayload?.error;
	const payloadVerdict = /^wrong-object-html:/i.test(payloadError || "") ? "html-viewer"
		: /^wrong-object:/i.test(payloadError || "") ? "non-pdf"
		: desktop.pdfPayload?.complete ? "complete-pdf"
		: desktop.pdfPayload?.ready ? "unverified" : "none";
	const pdf = {
		ready: Boolean(desktop.pdfPayload?.ready) && !["html-viewer", "non-pdf"].includes(payloadVerdict),
		complete: Boolean(desktop.pdfPayload?.complete) && !["html-viewer", "non-pdf"].includes(payloadVerdict),
		contentLength: desktop.pdfPayload?.contentLength,
		receivedBytes: Number(desktop.pdfPayload?.receivedBytes) || 0,
		error: payloadError,
		verdict: payloadVerdict
	};
	const reasonCode = typeof pdf.error === "string" && /^(wrong-object-html|wrong-object|no-body|get-content-failed):/.test(pdf.error)
		? pdf.error.split(":", 1)[0] : pdf.error ? "transfer-incomplete" : undefined;
	const maxBytes = Number(desktop.maxCaptureBytes) || 0;
	// 实际下载进度只取浏览器写入目标文件的字节；响应层预览缓存另行展示。
	const receivedBytes0 = Number.isFinite(desktop.downloadEventBytes)
		? Number(desktop.downloadEventBytes)
		: Number(desktop.downloadedBytes) || Number(task.size) || 0;
	const agentDriven = task.requestedBy === "agent";
	// C?/D6：进度对象。`totalBytes` 未知时**省略** percent/etaSeconds，而不是给 0——
	// 报一个假的百分比比不报更糟（调用方会据此判断"快完了"）。
	const downloadActive = held && ["downloading", "uploading"].includes(desktop.state);
	const nativeSave = downloadActive && desktop.automationStage === "saving";
	const archived = task.status === "completed" && Number(task.size) > 0;
	const totalBytes = archived ? Number(task.size) : downloadActive ? Number(desktop.downloadTotalBytes) || undefined : pdf.contentLength;
	const receivedBytes = archived ? Number(task.size) : downloadActive ? Number(desktop.downloadEventBytes) || 0 : Math.max(pdf.receivedBytes, receivedBytes0);
	const sizeNote = maxBytes > 0 && receivedBytes > maxBytes
		? `；文件约 ${Math.round(receivedBytes / 1048576)} MB 已超过 ${Math.round(maxBytes / 1048576)} MB 捕获上限，上传会被拒（可用 lab_tasks_update_bundle_file 直接登记该文件）`
		: "";
	const percent = Number.isFinite(totalBytes) && totalBytes > 0
		? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
		: undefined;
	const speedBps = downloadActive && Number.isFinite(progressBps) && progressBps > 0 ? Math.round(progressBps) : undefined;
	const etaSeconds = percent !== undefined && speedBps && totalBytes > receivedBytes
		? Math.max(1, Math.round((totalBytes - receivedBytes) / speedBps))
		: undefined;
	const progress = {
		source: archived ? "archived-file" : nativeSave ? "native-save" : downloadActive ? "browser-download" : "viewer-buffer",
		isActualDownload: archived || downloadActive,
		note: archived ? "已归档文件大小" : nativeSave ? "WebView2 原生另存为已写入任务文件的字节" : downloadActive ? "浏览器实际下载字节" : "仅为预览响应缓存，不是下载进度",
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
	const alternateRouteId = alternateEntry && Number.isSafeInteger(page.pageSeq) && page.pageSeq > 0 ? "science-pdf" : undefined;
	const pdfViewer = /^application\/pdf(?:\s*;|$)/i.test(page.documentType || "");
	const viewerFailure = desktop.viewerDownloadFailure && typeof desktop.viewerDownloadFailure === "object"
		? { count: Number(desktop.viewerDownloadFailure.count) || 0, error: desktop.viewerDownloadFailure.error,
			terminal: Boolean(desktop.viewerDownloadFailure.terminal) }
		: { count: 0, error: undefined, terminal: false };

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
			if (phase === "waiting-download" && desktop.automationStage === "saving") {
				nextAction = "wait-and-poll";
			} else if (downloadActive) {
				nextAction = "wait-and-poll";
			} else if (viewerFailure.terminal && pdfViewer) {
				nextAction = "manual-handoff";
			} else if (pdfViewer || (pdf.ready && pdf.complete)) {
				nextAction = "download-viewer-pdf";
			} else if (pdf.error && !pdf.complete && alternateRouteId) {
				payloadFailed = true;
				nextAction = "retry-download-entry";
			} else if (agentDriven && phase === "waiting-download") {
				// 出版社 HTML 预览器的下载按钮仍在 DOM 中；响应层的 HTML 壳或
				// 206 分段不能迫使 Agent 无限等待。让 Agent 观察并点击真实入口。
				nextAction = "observe-or-click";
			} else if (pdf.error && !pdf.complete) {
				// 载荷没能收全（壳已放弃等待）。必须说清"收了多少 / 共多少"，并给一条
				// 可执行的路——绝不能让它看起来像"再等等就好"。
				payloadFailed = true;
				nextAction = alternateRouteId ? "retry-download-entry" : "manual-handoff";
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
					verification: "出版社页面要求人机验证：请在软件侧栏完成验证，通过后由 Agent 重新观察页面",
					manual: "页面已打开，请由 Agent 观察并选择正文或补充材料入口",
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
	if (stalled) {
		phase = "stalled";
		nextAction = "recreate-or-cancel";
	}

	const kind = PHASES[phase] ?? { tone: "waiting", text: phase };
	const phaseRequiresUserAction = USER_ACTION_PHASES.has(phase) || nextAction === "manual-handoff";
	const verificationPending = !phaseRequiresUserAction && phase === "waiting-download" && held
		&& desktop.automationStage === "verification";
	const requiresUserAction = phaseRequiresUserAction || verificationPending;
	if (verificationPending) nextAction = "complete-verification";

	let message;
	if (stalled) {
		message = `下载/保存已 ${Math.round(stalledMs / 1000)} 秒没有任何字节增长，任务疑似卡住`;
	} else if (phase === "heartbeat-lost") {
		message = `与软件内文献浏览器失去心跳（上次上报 ${Math.round((desktop.ageMs ?? 0) / 1000)} 秒前），任务已中断`;
	} else if (phase === "orphaned") {
		message = ownership === "released"
			? `文献浏览器已交还该任务（原因：${desktop.releaseReason || "未说明"}），任务已中断`
			: "文献浏览器始终没有接管该任务，任务已中断";
	} else if (verificationPending) {
		message = "出版社页面要求人机验证：请在软件侧栏完成验证，然后再等待页面变化";
	} else if (downloadActive) {
		// 按下载事件目标文件的已写入字节报告；仅有声明总长时才给百分比。
		// 完成后由壳自动归档，不在这里引导重复归档。
		const fileLabel = task.kind === "si" ? "补充材料" : "正文 PDF";
		message = phase === "uploading"
			? `${fileLabel}正在归档到课题`
			: `${nativeSave ? "WebView2 正在保存" : "浏览器正在下载"}${fileLabel}（已写入 ${formatBytes(progress.receivedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}，${progress.percent}%` : "，总量未知"}；${progress.idleSeconds} 秒未增长），完成后自动归档`;
	} else if (payloadFailed) {
		message = `PDF 载荷未收全（${formatBytes(pdf.receivedBytes)}${pdf.contentLength ? ` / ${formatBytes(pdf.contentLength)}` : ""}）：${pdf.error}${alternateRouteId ? `。请调用 lab_browser_navigate(routeId=${alternateRouteId}, expectedPageSeq=${page.pageSeq})` : "。已无可执行备用入口，请在侧栏手动处理"}`;
	} else if (receiving) {
		// 只有拿到 Content-Length 才谈得上百分比；缺总长时如实说"总大小未知"，
		// 绝不用分片大小冒充总量（现场那条「已就绪（256.0 KB）」就是这么来的）。
		message = progress.totalBytes
			? `预览响应正在接收（${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}，${progress.percent}%）；这不是实际下载进度`
			: `预览响应正在接收（${formatBytes(progress.receivedBytes)}，总大小未知）；这不是实际下载进度`;
	} else if (nextAction === "manual-handoff" && viewerFailure.terminal) {
		message = `PDF 查看器自动下载不可继续${viewerFailure.error ? `（${viewerFailure.error}）` : ""}${/Ctrl\+S/.test(viewerFailure.error || "") ? "" : "。请在软件侧栏的原生 PDF 查看器按 Ctrl+S；浏览器会自动捕获并归档，无需回传文件路径"}。随后重新查询任务状态`;
	} else if (nextAction === "download-viewer-pdf") {
		message = pdf.complete
			? "PDF 字节已完整接收；调用 lab_browser_download_viewer_pdf 完成归档，再核对任务终态"
			: `原生 PDF 查看器已打开；调用 lab_browser_download_viewer_pdf 让 WebView2 保存当前 PDF，再按任务文件的实际字节和状态等到归档${viewerFailure.count ? `；上次失败：${viewerFailure.error || "未知原因"}${/Ctrl\+S/.test(viewerFailure.error || "") ? "" : "。如再失败，请在侧栏按 Ctrl+S，浏览器会自动归档，无需回传路径"}` : ""}`;
	} else if (phase === "waiting-download" && desktop.automationStage === "saving") {
		message = "已请求 WebView2 原生另存为；等待任务文件写入，查看操作状态和实际进度";
	} else if (nextAction === "retry-download-entry") {
		message = `PDF 预览页没有完整载荷，请调用 lab_browser_navigate(routeId=${alternateRouteId}, expectedPageSeq=${page.pageSeq}) 使用受限下载入口`;
	} else if (agentDriven && phase === "waiting-download") {
		message = `页面已打开，由你观察并点击真实下载入口：lab_browser_observe(scope=all) → lab_browser_click → lab_browser_wait。点击后核对下载事件与归档状态${pdf.error ? `；预览器缓存未能构成完整 PDF（${pdf.error}）` : ""}`;
	} else {
		message = stageMessage ?? kind.text;
	}

	if (nextAction === undefined) {
		nextAction = requiresUserAction ? "recreate-or-cancel"
			: ["completed", "cancelled"].includes(phase) ? "done"
			: verificationPending ? "complete-verification"
			: agentDriven && phase === "waiting-download" ? "observe-or-click"
			: "wait-and-poll";
	}

	const question = verificationPending
		? "出版社页面要求人机验证。请在软件侧栏完成验证；通过后我会重新观察文章页。"
		: nextAction === "manual-handoff" && viewerFailure.terminal
		? `自动保存不可继续。请在软件侧栏原生 PDF 查看器按 Ctrl+S；下载会自动捕获归档，无需回传路径。完成后我会重新查询任务状态。`
		: requiresUserAction
		? `文献获取中断（${message}）。可以：（1）用同一篇文献重建获取任务；（2）终止并清理这个任务。你要哪一个？`
		: undefined;

	// 失败原因必须出现在终态消息里（R5a）。
	//
	// 旧实现只在**非**终态时才把 task.error 拼进消息——也就是说恰恰在失败时把原因
	// 藏起来，调用方只看到"下载失败"。2026-09-27 现场因此只能读日志反推。
	const reasons = [task.error, desktop.lastError, desktop.lastFailure?.message]
		.filter((item) => typeof item === "string" && item.trim())
		.filter((item, index, list) => list.indexOf(item) === index);
	const reasonText = reasons.length ? `：${reasons.join(" / ")}` : "";
	const salvage = desktop.lastFailure?.salvagedPath && desktop.lastFailure?.salvagedSha256
		? `；本地已保住完整文件 ${desktop.lastFailure.salvagedPath}（${formatBytes(desktop.lastFailure.salvagedBytes ?? 0)}，sha256 ${desktop.lastFailure.salvagedSha256.slice(0, 12)}…），可用 lab_tasks_update_bundle_file 直接登记，不必重新抓取`
		: "";
	return {
		phase,
		message: `${message}${phase === "queued" && queuePosition ? `（队列第 ${queuePosition} 位）` : ""}${reasonText}${salvage}${sizeNote}`,
		nextAction,
		reasonCode,
		requiresUserAction,
		question,
		alternateEntry,
		alternateRouteId,
		page,
		pdf,
		payloadVerdict,
		viewerDownloadFailure: viewerFailure,
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
