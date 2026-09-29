import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { apply } from "../../lib/tasks-tool.js";
import { LabCaptureService, SAVE_OPERATION_TTL_MS } from "../../lib/manual-capture.js";
import {
	CAPTURE_HEARTBEAT_TTL_MS,
	CAPTURE_BUSY_HEARTBEAT_TTL_MS,
	CAPTURE_STALL_MS,
	deriveCaptureView,
	normalizeDownloadEntry
} from "../../lib/capture-phase.js";

/**
 * 文献下载「AI 主导闭环」（2026-09-27 需求 R1–R7 / C1–C22）。
 *
 * 现场根因是「唯一真相」缺失：工具里的 phase 与文献浏览器小球各自推导，而且
 * armed 且（心跳过期 或 浏览器已交给别的任务）被一律折叠成 queued，于是
 * **已经死掉的任务会被描述成「排队第 1 位」**，AI 只能一直等。这一组测试锁住
 * 「读得到真相」「终态可执行」「入口可判别」三条底线。
 */
const TASK = {
	id: "capture-1",
	projectId: "proj-test",
	bundleId: "bundle-1",
	kind: "pdf",
	requestedBy: "agent",
	mode: "ai",
	status: "armed",
	publisherUrl: "https://www.science.org/doi/10.1126/science.adz5300",
	createdAt: "2026-09-27T00:00:00.000Z"
};

const desktop = (patch = {}) => ({
	stale: false,
	pendingTaskId: "capture-1",
	state: "waiting-download",
	automationStage: "searching",
	ready: true,
	iwanReady: true,
	ageMs: 1200,
	...patch
});

const view = (patch = {}, taskPatch = {}, now) => deriveCaptureView({
	task: { ...TASK, ...taskPatch },
	desktop: desktop(patch),
	...now === undefined ? {} : { now }
});

/** 收集 apply() 注册的工具；ctx 只填被测工具真正会用的成员。 */
function harness(labCapture) {
	const registered = [];
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labCapture,
		labTasks: { getProject: () => ({ id: "proj-test" }), getBundle: () => null }
	});
	return registered;
}

function captureStub({ task = TASK, desktop: status = desktop(), tables = null } = {}) {
	return {
		table: tables,
		sweepExpired: async () => {},
		getTask: () => task,
		listTasks: () => [task],
		getDesktopWebVpnStatus: () => status,
		describeTask: (row, queuePosition) => deriveCaptureView({ task: row, desktop: status, queuePosition })
	};
}

test("Agent 可排入只读浏览器调试快照", async () => {
	let submitted;
	const tools = harness({
		...captureStub(),
		createBrowserOperation: (operation) => {
			submitted = operation;
			return { id: "browser-debug-1", status: "queued" };
		}
	});
	const debug = tools.find((item) => item.name === "lab_browser_debug");
	assert.ok(debug);
	const result = await debug.execute({ projectId: TASK.projectId, taskId: TASK.id }, {});
	assert.equal(result.ok, true);
	assert.equal(result.operationId, "browser-debug-1");
	assert.equal(submitted.action, "debug");
	assert.equal(submitted.taskId, TASK.id);
});

test("R3.3/C6：心跳过期是「失去接管」，绝不能伪装成排队", () => {
	const lost = view({ stale: true, pendingTaskId: undefined, ageMs: 42_000 });
	assert.equal(lost.phase, "heartbeat-lost");
	assert.notEqual(lost.phase, "queued");
	assert.equal(lost.requiresUserAction, true);
	assert.equal(lost.nextAction, "recreate-or-cancel");
	assert.match(lost.message, /心跳/);
});

test("R3.3/C6：接管过又被交还 = orphaned，从未被接管才可能还在排队", () => {
	const released = view({ pendingTaskId: undefined, lastPendingTaskId: "capture-1", releaseReason: "新的捕获任务替换了它" });
	assert.equal(released.phase, "orphaned");
	assert.equal(released.requiresUserAction, true);

	// 浏览器正忙着别的任务：这是**真的**排队，必须保留 queued。
	const busy = view({ pendingTaskId: "capture-other" }, {}, Date.parse(TASK.createdAt) + 60_000);
	assert.equal(busy.phase, "queued");
	assert.equal(busy.queuePosition, undefined);
	assert.equal(busy.requiresUserAction, false);

	// 排队宽限期过后仍然没人接管：同样按失去接管处理（否则 AI 会无限等）。
	const abandoned = view({ pendingTaskId: undefined }, {}, Date.parse(TASK.createdAt) + 5 * 60_000);
	assert.equal(abandoned.phase, "orphaned");
});

test("R4.3/C7：终态给「重建 / 终止」两个可执行选项", () => {
	const failed = view({}, { status: "failed", error: "未捕获到 PDF" });
	assert.equal(failed.requiresUserAction, true);
	assert.equal(failed.nextAction, "recreate-or-cancel");
	assert.match(failed.question, /重建/);
	assert.match(failed.question, /终止/);
	assert.equal(failed.ball.canRecreate, true);
	assert.equal(failed.ball.tone, "error");
});

test("R2.3/C8：原生 PDF 优先触发查看器保存，Science 备用入口仍受限", () => {
	const entry = normalizeDownloadEntry("https://www.science.org/doi/epdf/10.1126/science.adz5300");
	assert.equal(entry, "https://www.science.org/doi/pdf/10.1126/science.adz5300?download=true");
	const manual = view({ automationStage: "manual", documentType: "application/pdf", pageUrl: "https://www.science.org/doi/epdf/10.1126/science.adz5300", pageSeq: 7 });
	assert.equal(manual.nextAction, "download-viewer-pdf");
	assert.equal(manual.alternateEntry, entry);
	assert.equal(manual.alternateRouteId, "science-pdf");
	assert.equal(manual.page.pageSeq, 7);
	// 不再返回那个会静默失败的动作名。
	assert.notEqual(manual.nextAction, "observe-or-save-pdf");
	// 无效 DOI 时不伪造入口。
	assert.equal(normalizeDownloadEntry("https://example.org/no-doi-here"), undefined);
	assert.equal(normalizeDownloadEntry("https://www.nature.com/articles/s41586-test", "10.1038/s41586-test"), undefined);
	assert.equal(normalizeDownloadEntry("https://webvpn.example.edu/doi/epdf/10.1126/science.adz5300"), undefined);
});

test("R2.2/C1：完整 PDF 载荷可归档，原生 PDF 可触发查看器保存", () => {
	const notReady = view({ automationStage: "manual" });
	assert.notEqual(notReady.nextAction, "download-viewer-pdf");
	const ready = view({
		automationStage: "manual",
		documentType: "application/pdf",
		pdfPayload: { ready: true, complete: true, contentLength: 2716660, receivedBytes: 2716660 }
	});
	assert.equal(ready.nextAction, "download-viewer-pdf");
	assert.equal(ready.pdf.ready, true);
	assert.match(ready.message, /lab_browser_download_viewer_pdf/);
});

test("Nature SI 已在 PDF 查看器但未捕获载荷时给出可执行保存动作", () => {
	const si = view({
		automationStage: "manual", documentType: "application/pdf", contentLength: 452463,
		pageUrl: "https://media.springernature.com/full/springer-static/41586_2026_11032_MOESM1_ESM.pdf"
	}, { kind: "si", publisherUrl: "https://doi.org/10.1038/s41586-026-11032" });
	assert.equal(si.nextAction, "download-viewer-pdf");
	assert.equal(si.pdf.ready, false);
	assert.match(si.message, /lab_browser_download_viewer_pdf/);
	const article = view({ automationStage: "manual", documentType: "text/html", pageUrl: "https://www.nature.com/articles/s41586-026-11032" },
		{ publisherUrl: "https://doi.org/10.1038/s41586-026-11032" });
	assert.equal(article.nextAction, "observe-or-click");
});

test("ScienceDirect 查看器动作连续失败两次后交给用户 Ctrl+S，禁止第三次重试", async () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map();
	service.captureProgressSamples = new Map();
	service.getTask = () => TASK;
	service.listTasks = () => [TASK];
	service.sweepExpired = async () => {};
	service.getDesktopWebVpnStatus = () => desktop({ documentType: "application/pdf", pageUrl: "https://www.sciencedirect.com/science/article/pii/S095656631300849X/pdfft",
		pdfPayload: { ready: true, complete: false, receivedBytes: 348, error: "wrong-object-html: 响应体是 HTML 查看器页面" } });
	for (let index = 0; index < 2; index++) {
		const operation = service.createBrowserOperation({ projectId: "proj-test", taskId: TASK.id, action: "viewer-download" });
		service.claimBrowserOperation("proj-test");
		service.completeBrowserOperation({ projectId: "proj-test", id: operation.id, error: "查看器未响应" });
		assert.match(service.getBrowserOperation(operation.id, "proj-test").error, /Ctrl\+S.*自动捕获并归档/);
	}
	const status = harness(service).find((item) => item.name === "lab_publisher_browser_download_status");
	const result = await status.execute({ projectId: "proj-test", taskId: TASK.id }, {});
	assert.equal(result.nextAction, "manual-handoff");
	assert.equal(result.requiresUserAction, true);
	assert.equal(result.downloadReady, false);
	assert.equal(result.payloadReady, false);
	assert.equal(result.payloadVerdict, "html-viewer");
	assert.equal(result.viewerDownloadFailure.count, 2);
	assert.match(result.question, /Ctrl\+S.*无需回传路径/);
	assert.throws(() => service.createBrowserOperation({ projectId: "proj-test", taskId: TASK.id, action: "viewer-download" }), /不可继续/);
});

test("主窗口句柄不可用属于永久错误，一次失败后直接提示 Ctrl+S", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map([["browser-1", { taskId: TASK.id, action: "viewer-download", status: "failed", error: "主窗口句柄不可用" }]]);
	assert.equal(service.viewerDownloadFailure(TASK.id).terminal, true);
	const handoff = view({ documentType: "application/pdf", viewerDownloadFailure: service.viewerDownloadFailure(TASK.id) });
	assert.equal(handoff.nextAction, "manual-handoff");
	assert.equal(handoff.requiresUserAction, true);
	assert.equal((handoff.message.match(/Ctrl\+S/g) || []).length, 1, "同一状态文案不应重复人工兜底指引");
	const result = view({ documentType: "application/pdf", viewerDownloadFailure: {
		count: 1, error: "主窗口句柄不可用", terminal: true
	} });
	assert.equal(result.nextAction, "manual-handoff");
	assert.match(result.message, /Ctrl\+S.*自动捕获并归档/);
});

test("前台焦点或保存事件不可用时，一次失败就人工接管；预览缓存不冒充下载字节", async () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map([["browser-1", { taskId: TASK.id, action: "viewer-download", status: "failed",
		error: "PDF 查看器未获得前台焦点；请按 Ctrl+S" }]]);
	assert.equal(service.viewerDownloadFailure(TASK.id).terminal, true);
	service.browserOperations.set("browser-2", { taskId: "other", action: "viewer-download", status: "failed",
		error: "原生 PDF 查看器保存指令未触发下载" });
	assert.equal(service.viewerDownloadFailure("other").terminal, true);
	const status = harness(captureStub({ desktop: desktop({
		pdfPayload: { ready: false, complete: false, receivedBytes: 348, contentLength: 2_151_341,
			error: "wrong-object-html: HTML 查看器" }
	}) })).find((item) => item.name === "lab_publisher_browser_download_status");
	const result = await status.execute({ projectId: "proj-test", taskId: TASK.id }, {});
	assert.equal(result.downloadedBytes, undefined);
	assert.equal(result.progress.isActualDownload, false);
	assert.match(result.progress.note, /不是下载进度/);
});

test("验证页状态要求用户处理，再由 Agent 重新观察", () => {
	const result = view({ automationStage: "verification", documentType: "text/html" });
	assert.equal(result.nextAction, "complete-verification");
	assert.equal(result.requiresUserAction, true);
	assert.match(result.question, /侧栏完成验证/);
});

test("人工 Ctrl+S 归档后，状态报告真实文件大小而非 348 B 预览缓存", () => {
	const archived = view({ pendingTaskId: undefined, pdfPayload: { ready: true, complete: false, receivedBytes: 348, error: "wrong-object-html: HTML" } },
		{ status: "completed", size: 2_151_364, fileName: "article.pdf" });
	assert.equal(archived.nextAction, "done");
	assert.equal(archived.progress.source, "archived-file");
	assert.equal(archived.progress.receivedBytes, 2_151_364);
	assert.equal(archived.progress.percent, 100);
	assert.equal(archived.payloadVerdict, "html-viewer");
});

test("归档终态向 Agent 返回条目文件路径与哈希，不再要求用户回传路径", async () => {
	const task = { ...TASK, status: "completed", size: 2_151_364, fileName: "article.pdf", fileSha256: "a".repeat(64) };
	const registered = [];
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labCapture: captureStub({ task, desktop: desktop({ pendingTaskId: undefined, pdfPayload: { ready: true, complete: false, receivedBytes: 348, error: "wrong-object-html: HTML" } }) }),
		labTasks: { getProject: () => ({ id: "proj-test" }), getBundle: () => ({ id: "bundle-1", projectId: "proj-test", pdfPath: "C:\\literature\\article.pdf" }) }
	});
	const status = registered.find((item) => item.name === "lab_publisher_browser_download_status");
	const result = await status.execute({ projectId: "proj-test", taskId: TASK.id }, {});
	assert.equal(result.status, "completed");
	assert.equal(result.filePath, "C:\\literature\\article.pdf");
	assert.equal(result.fileSha256, "a".repeat(64));
	assert.equal(result.downloadedBytes, 2_151_364);
	assert.equal(result.progress.source, "archived-file");
});

test("原生 PDF 保存进行时报告任务文件实际写入进度", () => {
	const saving = view({ automationStage: "saving", documentType: "application/pdf", contentLength: 3_200_000 });
	assert.equal(saving.nextAction, "wait-and-poll");
	assert.match(saving.message, /等待任务文件写入/);
	const downloading = view({ state: "downloading", automationStage: "saving", documentType: "application/pdf",
		contentLength: 3_200_000, downloadEventBytes: 800_000, downloadTotalBytes: 3_200_000 });
	assert.equal(downloading.nextAction, "wait-and-poll");
	assert.equal(downloading.progress.source, "native-save");
	assert.match(downloading.message, /WebView2 正在保存正文 PDF/);
	assert.equal(downloading.progress.receivedBytes, 800_000);
	assert.equal(downloading.progress.percent, 25);
});

test("确定性 MIME 错误一次即交给人工 Ctrl+S", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map([["browser-1", { taskId: TASK.id, action: "viewer-download", status: "failed",
		error: "当前另存为对象不是 PDF（contentType=text/html）；请在侧栏 PDF 查看器按 Ctrl+S，壳会自动捕获归档，无需回传路径" }]]);
	const failure = service.viewerDownloadFailure(TASK.id);
	assert.equal(failure.count, 1);
	assert.equal(failure.terminal, true);
	assert.equal(view({ documentType: "application/pdf", viewerDownloadFailure: failure }).nextAction, "manual-handoff");
});

test("偶发原生保存失败虽附人工提示，仍保留一次重试机会", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map([["browser-1", { taskId: TASK.id, action: "viewer-download", status: "failed",
		error: "WebView2 原生另存为响应超时；请在侧栏 PDF 查看器按 Ctrl+S" }]]);
	assert.equal(service.viewerDownloadFailure(TASK.id).terminal, false);
});

test("查看器错误保留完整诊断路径，且一次失败即进入人工接管", () => {
	const service = Object.create(LabCaptureService.prototype);
	const path = "C:\\Users\\admin\\AppData\\Local\\iBM-Lab-Agent\\dsh\\lab-agent\\projects\\test\\webvpn-downloads\\capture-evidence.notpdf.bin";
	service.browserOperations = new Map([["browser-1", { id: "browser-1", projectId: "proj-test", taskId: TASK.id,
		action: "viewer-download", status: "running", error: undefined }]]);
	service.completeBrowserOperation({ projectId: "proj-test", id: "browser-1",
		error: `HTTP 200 text/html；诊断文件 ${path}；请在侧栏 PDF 查看器按 Ctrl+S` });
	const operation = service.getBrowserOperation("browser-1", "proj-test");
	assert.match(operation.error, /capture-evidence\.notpdf\.bin/);
	assert.equal(service.viewerDownloadFailure(TASK.id).terminal, true);
});

test("R6.2/C17：长时间没有字节增长就是 stalled，不再永远显示「正在保存」", () => {
	const saving = { state: "downloading", automationStage: "saving", downloadedBytes: 1024 };
	assert.equal(view(saving, {}, 0).phase, "downloading");
	const stalled = deriveCaptureView({
		task: TASK, desktop: desktop(saving), stalledMs: CAPTURE_STALL_MS + 1, now: Date.parse(TASK.createdAt) + 1000
	});
	assert.equal(stalled.phase, "stalled");
	assert.equal(stalled.nextAction, "recreate-or-cancel");
	assert.equal(stalled.requiresUserAction, true);
	assert.equal(stalled.ball.stalled, true);
	assert.equal(stalled.ball.tone, "error");
});

test("R1.2/R1.4/C10/C11：任务可枚举，失败可用同一篇文献重建", async () => {
	const listed = harness(captureStub());
	const listTool = listed.find((item) => item.name === "lab_publisher_browser_capture_list");
	assert.ok(listTool, "必须注册 lab_publisher_browser_capture_list");
	const value = await listTool.execute({ projectId: "proj-test" }, {});
	assert.equal(value.ok, true);
	assert.equal(value.tasks[0].taskId, "capture-1");
	assert.equal(value.tasks[0].phase, "waiting-download");

	const calls = [];
	const tools = harness({
		...captureStub({ task: { ...TASK, status: "failed" } }),
		recreateTask: async (taskId, reason) => {
			calls.push([taskId, reason]);
			return { previousTaskId: taskId, task: { id: "capture-2", status: "armed" } };
		}
	});
	const cancel = tools.find((item) => item.name === "lab_publisher_browser_download_cancel");
	assert.ok(cancel.parameters.properties.recreate, "cancel 必须暴露 recreate");
	const rebuilt = await cancel.execute({ projectId: "proj-test", taskId: "capture-1", recreate: true }, {});
	assert.deepEqual(rebuilt, { ok: true, taskId: "capture-1", status: "cancelled", recreatedTaskId: "capture-2", recreatedStatus: "armed" });
	assert.equal(calls.length, 1);
});

test("R2.1/C9：wait 的指纹必须含页面维度，否则导航永远算「没有变化」", async () => {
	const tools = harness(captureStub());
	const wait = tools.find((item) => item.name === "lab_browser_wait");
	assert.ok(wait);
	// 拿指纹的方式与实现一致：直接比对两次不同页面快照产生的状态差异。
	const before = await tools.find((item) => item.name === "lab_publisher_browser_download_status")
		.execute({ projectId: "proj-test", taskId: "capture-1" }, {});
	const after = await harness(captureStub({
		desktop: desktop({ pageUrl: "https://www.science.org/doi/epdf/10.1126/science.adz5300", pageSeq: 7, readyState: "complete" })
	})).find((item) => item.name === "lab_publisher_browser_download_status")
		.execute({ projectId: "proj-test", taskId: "capture-1" }, {});
	assert.notEqual(before.page.url, after.page.url);
	assert.equal(after.page.pageSeq, 7);
	assert.equal(after.page.readyState, "complete");

	const source = await readFile(new URL("../../lib/tasks-tool.js", import.meta.url), "utf8");
	const fingerprint = source.match(/const fingerprint = \(value\) => \[([\s\S]*?)\]/)?.[1] ?? "";
	for (const field of ["page?.url", "page?.documentType", "page?.readyState", "page?.pageSeq"]) {
		assert.match(fingerprint, new RegExp(field.replace(/[?.]/g, "\\$&")), `指纹必须含 ${field}`);
	}
});

test("R3.2/C13/C14：心跳按阶段分档，且「超时」与「不属于本任务」是两句不同的话", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map();
	service.desktopWebVpnActions = new Map();
	service.desktopLastPendingTaskId = null;
	service.desktopReleaseReason = null;
	service.captureProgressSamples = new Map();
	service.getTask = () => ({ id: "capture-1", projectId: "p1", requestedBy: "agent", status: "armed" });

	// 下载中：距今 30 秒仍不算心跳过期（分档 TTL）。
	service.reportDesktopWebVpnStatus({ state: "downloading", windowOpen: true, pendingTaskId: "capture-1" });
	service.desktopWebVpnStatus.observedAt = new Date(Date.now() - 30_000).toISOString();
	const busy = service.getDesktopWebVpnStatus();
	assert.equal(busy.stale, false, "下载阶段必须用放宽后的 TTL");
	assert.ok(CAPTURE_BUSY_HEARTBEAT_TTL_MS > CAPTURE_HEARTBEAT_TTL_MS);

	// 空闲阶段：超过 10 秒即 stale。
	service.reportDesktopWebVpnStatus({ state: "ready", windowOpen: true, pendingTaskId: "capture-1" });
	service.desktopWebVpnStatus.observedAt = new Date(Date.now() - 30_000).toISOString();
	assert.equal(service.getDesktopWebVpnStatus().stale, true);

	// C14：两句不同的错误。
	const staleService = Object.create(LabCaptureService.prototype);
	staleService.browserOperations = new Map();
	staleService.desktopWebVpnStatus = null;
	staleService.getTask = () => ({ id: "capture-1", projectId: "p1", requestedBy: "agent", status: "armed" });
	assert.throws(() => staleService.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "observe" }), /心跳|打开文献浏览器/);

	const otherService = Object.create(LabCaptureService.prototype);
	otherService.browserOperations = new Map();
	otherService.desktopWebVpnStatus = null;
	otherService.desktopLastPendingTaskId = null;
	otherService.captureProgressSamples = new Map();
	otherService.getTask = () => ({ id: "capture-1", projectId: "p1", requestedBy: "agent", status: "armed" });
	otherService.reportDesktopWebVpnStatus({ state: "ready", windowOpen: true, pendingTaskId: "capture-other" });
	assert.throws(
		() => otherService.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "observe" }),
		/pendingTaskId=capture-other/
	);
});

test("R4.1/C15：保存类操作的窗口远大于 30 秒，过期也要写回原因", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map();
	service.desktopWebVpnActions = new Map();
	service.desktopLastPendingTaskId = null;
	service.captureProgressSamples = new Map();
	service.getTask = () => ({ id: "capture-1", projectId: "p1", requestedBy: "agent", status: "armed" });
	service.reportDesktopWebVpnStatus({ state: "waiting-download", windowOpen: true, pendingTaskId: "capture-1" });
	const save = service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "viewer-download" });
	const stored = service.browserOperations.get(save.id);
	assert.ok(stored.expiresAt - stored.createdAt >= SAVE_OPERATION_TTL_MS, "保存操作 TTL 必须远大于 30 秒");
	// 同一任务已有未结束的动作：串行保证仍然生效（这里会抛）。
	assert.throws(
		() => service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "observe" }),
		/尚未结束/
	);
	// 过期时的原因要能被读出来，而不是只标一个 failed。
	service.browserOperations.get(save.id).expiresAt = Date.now() - 1;
	const expired = service.getBrowserOperation(save.id, "p1");
	assert.equal(expired.status, "failed");
	assert.match(expired.error, /PDF 查看器下载超时/);
});

test("R6.1/C20：小球与工具读同一份推导（同一任务同一个 phase）", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map();
	service.table = null;
	service.desktopLastPendingTaskId = null;
	service.captureProgressSamples = new Map();
	service.getDesktopWebVpnStatus = () => ({ ...desktop({ stale: true, pendingTaskId: undefined }), ageMs: 30_000 });
	const row = { ...TASK };
	const described = service.describeTask(row, 1);
	assert.equal(described.phase, "heartbeat-lost");
	assert.equal(described.ball.phase, described.phase);
	assert.equal(described.ball.text, described.message.replace(/（队列第 1 位）/, ""));
	assert.equal(described.ball.canRecreate, true);
});

test("R5.1/C1：壳在响应层取 PDF 载荷，不再只依赖 viewer 工具栏", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	assert.match(rust, /add_WebResourceResponseReceived/, "必须监听响应");
	assert.match(rust, /GetContent/, "必须取响应体");
	assert.match(rust, /write_stream_to_file/, "响应体必须落盘成载荷");
	assert.match(rust, /pdf_payload_ready/, "保存必须先看载荷是否就绪");
	assert.match(rust, /starts_with\(b"%PDF-"\)/, "归档前必须校验是真 PDF");
	// 保存必须等到终态，不能只回 started。
	assert.match(rust, /wait_for_outcome/);
	assert.doesNotMatch(rust, /json!\(\{ "started": true, "phase": "saving" \}\)/, "不得再返回「已开始」就失联");
	// 接管/交还必须显式上报（C3）。
	assert.match(rust, /last_pending_task_id/);
	assert.match(rust, /release_reason/);
	// 不得为了重取而读取/导出 Cookie。
	assert.doesNotMatch(rust, /CookieManager|GetCookies|CookieList/);
});

test("R7.1/C21/C22：预设不再把模型引向失效支路", async () => {
	const preset = await readFile(new URL("../../presets/lab-research/preset.patch.yml", import.meta.url), "utf8");
	assert.doesNotMatch(preset, /observe-or-save-pdf/, "不能再教一个会静默失败的动作名");
	assert.match(preset, /download-viewer-pdf/, "原生 PDF 应触发查看器保存");
	assert.match(preset, /retry-download-entry/);
	assert.match(preset, /alternateEntry/);
	assert.match(preset, /recreate=true/, "失败后要能直接重建");
	assert.match(preset, /lab_publisher_browser_capture_list/);
});

test("C19/C20 接线：list 带 view，客户端把 ball 交给壳，壳渲染插件文案", async () => {
	const [remote, bridge, shell, ball] = await Promise.all([
		readFile(new URL("../../lib/remote.js", import.meta.url), "utf8"),
		readFile(new URL("../../client/src/webvpn-bridge.js", import.meta.url), "utf8"),
		readFile(new URL("../../desktop/src/index.html", import.meta.url), "utf8"),
		readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8")
	]);
	// 队列的每一行都带同一份真相。
	assert.match(remote, /listTaskViews\(request\.projectId\)/);
	assert.match(remote, /\{ \.\.\.task, view \}/);
	// 客户端把 ball 原样交给壳（含 canRecreate），壳再转给 Rust。
	assert.match(bridge, /task\?\.view\?\.ball/);
	assert.match(bridge, /canRecreate: Boolean\(ball\.canRecreate\)/);
	assert.match(shell, /ballPhase: String\(task\?\.ball\?\.phase \|\| ''\)/);
	assert.match(shell, /ballCanRecreate: Boolean\(task\?\.ball\?\.canRecreate\)/);
	// Rust 状态里带上这些字段，并且小球优先用插件文案。
	assert.match(ball, /ball_can_recreate: bool/);
	assert.match(ball, /"ballText": active\.map/);
	// 重建入口：小球 → 壳钩子 → 客户端 → 插件 RPC，一路都在。
	assert.match(ball, /url\.host_str\(\) == Some\("recreate-task"\)/);
	assert.match(ball, /window\.__ibmBallRecreateTask/);
	assert.match(shell, /window\.__ibmBallRecreateTask = /);
	assert.match(shell, /type: 'WEBVPN_RECREATE_TASK'/);
	assert.match(remote, /async manual_capture_recreate\(request\)/);
});

test("D5：不完整预览缓存不能引导归档，HTML 页仍可寻找下载入口", () => {
	const receiving = view({ automationStage: "manual", pdfPayload: { ready: true, complete: false, contentLength: 2716668, receivedBytes: 262144 } });
	assert.notEqual(receiving.nextAction, "download-viewer-pdf");
	assert.equal(receiving.nextAction, "observe-or-click");
	assert.equal(receiving.pdf.complete, false);
	assert.match(receiving.message, /真实下载入口/);
	// 分片绝不能冒充总长（现场原话是「已就绪（256.0 KB）」，真实 2.6 MB）。
	assert.equal(receiving.progress.source, "viewer-buffer");
	assert.equal(receiving.progress.receivedBytes, 262144);
	assert.equal(receiving.progress.percent, 10);
	assert.equal(receiving.progress.totalBytes, 2716668);

	const complete = view({ automationStage: "manual", pdfPayload: { ready: true, complete: true, contentLength: 2716668, receivedBytes: 2716668 } });
	assert.equal(complete.nextAction, "download-viewer-pdf");
	assert.match(complete.message, /已完整接收/);
});

test("D2/D5：载荷未收全是一个可执行的失败分支，不是「再等等」", () => {
	const failed = view({
		automationStage: "manual",
		pageUrl: "https://www.science.org/doi/pdf/10.1126/science.adz5300",
		pageSeq: 9,
		pdfPayload: { ready: true, complete: false, contentLength: 2716668, receivedBytes: 262144, error: "已接收 262144 / 2716668 字节" }
	});
	assert.equal(failed.nextAction, "retry-download-entry");
	assert.match(failed.message, /未收全/);
	assert.match(failed.message, /256\.0 KB \/ 2\.6 MB/);
	assert.match(failed.message, /lab_browser_navigate/);
	assert.equal(failed.alternateRouteId, "science-pdf");
});

test("Science 双通路：下载事件运行时，失败的响应载荷不抢走下一步", () => {
	const active = view({
		state: "downloading", downloadedBytes: 1_000_000,
		pageUrl: "https://www.science.org/doi/pdf/10.1126/science.adz5300", pageSeq: 10,
		pdfPayload: { ready: true, complete: false, contentLength: 348, receivedBytes: 348, error: "HTML viewer shell" }
	});
	assert.equal(active.nextAction, "wait-and-poll");
	assert.equal(active.progress.receivedBytes, 0, "没有实际下载文件就不能把响应缓存当进度");
	// 下载事件通路没有声明总长：不许编造百分比（拿载荷的 348 B 当总量更糟）。
	assert.equal(active.progress.totalBytes, undefined);
	assert.equal(active.progress.percent, undefined);
	// 断言行为而不是内部术语：文案要说清"正在下载 + 会自动归档"，并且不得引导归档。
	assert.match(active.message, /正在下载/);
	assert.match(active.message, /自动归档/);
	assert.notEqual(active.nextAction, "download-viewer-pdf");
	const tooLarge = view({ maxCaptureBytes: 100, downloadedBytes: 101 });
	assert.match(tooLarge.message, /超过/);
});

test("Science 备用入口用过后仍可观察页面，空壳和空流有不同原因码", () => {
	const pageUrl = "https://www.science.org/doi/pdf/10.1126/science.adz5300?download=true";
	for (const [error, code] of [
		["wrong-object-html: 响应体是 HTML 查看器页面", "wrong-object-html"],
		["no-body: WebView2 未提供 PDF 响应体", "no-body"]
	]) {
		const result = view({ pageUrl, pageSeq: 20, pdfPayload: { ready: true, complete: false, receivedBytes: 348, error } });
		assert.equal(result.reasonCode, code);
		assert.equal(result.nextAction, "observe-or-click");
		assert.equal(result.alternateRouteId, undefined);
	}
});

test("D6：总量未知时不给假的百分比，速度由相邻两次采样给出", () => {
	const unknown = view({ pdfPayload: { ready: true, complete: false, receivedBytes: 512 * 1024 } });
	assert.equal(unknown.progress.totalBytes, undefined);
	assert.equal(unknown.progress.percent, undefined);
	assert.equal(unknown.progress.source, "viewer-buffer");
	const withSpeed = view({ pdfPayload: { ready: true, complete: false, contentLength: 4 * 1024 * 1024, receivedBytes: 1024 * 1024 } }, {}, undefined);
	assert.equal(withSpeed.progress.percent, 25);
	// progressBps 走第四参数注入（服务层按两次采样算）
	const svc = Object.create(LabCaptureService.prototype);
	svc.captureProgressSamples = new Map();
	svc.desktopLastPendingTaskId = null;
	svc.desktopReleaseReason = null;
	svc.desktopWebVpnStatus = null;
	svc.reportDesktopWebVpnStatus({ state: "waiting-download", windowOpen: true, pendingTaskId: "capture-1", automationStage: "manual", downloadedBytes: 1024 * 1024, pdfPayload: { ready: true, complete: false, contentLength: 4 * 1024 * 1024, receivedBytes: 1024 * 1024 } });
	svc.speedBps = () => 1024 * 1024;
	svc.stalledMs = () => 0;
	const described = svc.describeTask(TASK, 1);
	assert.equal(described.progress.speedBps, undefined, "预览缓存没有下载速度");
	assert.equal(described.progress.etaSeconds, undefined);
});

test("D7：指纹含载荷完整性维度，wait 才能在「收完」那一刻返回", async () => {
	const source = await readFile(new URL("../../lib/tasks-tool.js", import.meta.url), "utf8");
	const fingerprint = source.match(/const fingerprint = \(value\) => \[([\s\S]*?)\]/)?.[1] ?? "";
	for (const field of ["pdf?.complete", "pdf?.contentLength", "progress?.receivedBytes"]) {
		assert.match(fingerprint, new RegExp(field.replace(/[?.]/g, "\\$&")), `指纹必须含 ${field}`);
	}
	// 终态必须直接返回，不允许空转到超时。
	assert.match(source, /if \(before\.requiresUserAction \|\| before\.nextAction === "done"\) return before/);
});

test("D9：预设区分预览缓存与实际下载", async () => {
	const preset = await readFile(new URL("../../presets/lab-research/preset.patch.yml", import.meta.url), "utf8");
	assert.match(preset, /progress.source=viewer-buffer/);
	assert.match(preset, /browser-download/);
	assert.match(preset, /lab_browser_download_viewer_pdf/);
});

test("D1/D2 壳侧接线：正向证明 + 归档前三道校验", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	// ready 的语义边界必须写明，且 complete 不能写成「有字节就算完整」。
	assert.match(rust, /ready: payload\.received_bytes > 0/);
	assert.doesNotMatch(rust, /payload\.complete = bytes > 0/);
	// 读流不能把一次空读当成 EOF。
	assert.match(rust, /read == 0 \*\*不等于\*\* EOF|read == 0 \*\*不等于\*\*/);
	assert.match(rust, /PDF_STREAM_STALL_TIMEOUT/);
	// 归档前的三道校验。
	assert.match(rust, /tail_has_eof\(&head\)/);
	assert.match(rust, /pdf_payload_total\(task_id\)/);
	// 进度要两条路一起算。
	assert.match(rust, /fn pending_progress_bytes/);
	// 读取必须在工作线程上：这个流由网络响应驱动，在 UI 线程读完会把整应用冻住。
	assert.match(rust, /CoMarshalInterThreadInterfaceInStream/, "必须按 COM 规矩封送，而不是硬搬裸指针");
	assert.match(rust, /CoGetInterfaceAndReleaseStream/);
	assert.match(rust, /std::thread::spawn\(move \|\| \{/);
	assert.match(rust, /fn spawn_payload_read/);
	// 多个响应现在**必须**能共享载荷文件（分段装配）；但已完整的载荷不再接受新段。
	assert.match(rust, /pub fn ensure_pdf_payload\(&self, task_id: &str, path: PathBuf, total_hint: Option<u64>\) -> bool/);
	assert.match(rust, /!payload\.complete/, "载荷已完整后不再接受新段");
});

test("R1-A：页内右下角「保存到课题」浮层（壳注入、壳响应，模型给不了选择器）", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	// 独立宿主 + 自己的阴影根：与小球分开，不能复用被反向位移的工具栏。
	assert.match(rust, /id = '__ibm_webvpn_save'/);
	assert.match(rust, /syncCaptureSaveButton/);
	// 位置：右下角；且必须用 popover 逃逸（PDF 页被施加 html transform 时，
	// position:fixed 的后代以 html 为包含块，会跟着页面滚走）。
	assert.match(rust, /right:16px;bottom:16px;left:auto;top:auto/);
	assert.match(rust, /host\.setAttribute\('popover', 'manual'\)/);
	// 点击走内部命令（绝不能用 location.href：那是一次真实导航，会打白屏）。
	assert.match(rust, /notifyShell\('viewer-download\/'/);
	assert.match(rust, /url\.host_str\(\) == Some\("viewer-download"\)/);
	// 用户触发与 Agent 触发必须同一条实现（等终态 + 归档前三道校验）。
	assert.match(rust, /pub fn request_native_save/);
	assert.match(rust, /download_viewer_pdf\(&task_app, &task_id, &webview\)\.await/);
	// 原生 PDF 不必等待预览缓存收全；按钮只能对 PDF 文档启用。
	assert.match(rust, /payload\.documentType === 'application\/pdf'/);
	// 点过之后不再放开：避免重复归档。
	assert.match(rust, /button\.dataset\.busy = 'true'/);
	// 归档中拒绝第二次保存（侧栏按钮可能在浮层之后被按下）。
	assert.match(rust, /matches!\(session\.state, WebVpnSessionState::Uploading\)/);
});

test("R1-B：侧栏兜底按钮——不在上报矩形内，因此不会被原生子 WebView 盖住", async () => {
	const tab = await readFile(new URL("../../client/src/webvpn-tab.js", import.meta.url), "utf8");
	// 工具行与上报矩形的容器必须分开：hostRef 只能挂在 stage 上。
	assert.match(tab, /className: "ib-webvpn-bar"/);
	assert.match(tab, /ref: hostRef, className: "ib-webvpn-stage"/);
	assert.doesNotMatch(tab, /ref: hostRef, className: "ib-webvpn-tab"/);
	// 按钮走与 Agent 同一条 shell 动作；不给它开新的桥。
	assert.match(tab, /webVpnBrowserActionViaShell\(\{ taskId, action: "viewer-download"/);
	// 状态与浮层同源：都读 webvpn_status。
	assert.match(tab, /useSaveToProject/);
	assert.match(tab, /status\?\.pdfPayload/);
	// 原生 PDF 文档即使预览缓存不完整也可下载。
	assert.match(tab, /application\\\/pdf/);
});

test("B1：declaredTotalBytes / idleSeconds 是显式字段，percent 不许恒为 100", () => {
	const receiving = view({
		downloadedBytes: 302200,
		pdfPayload: { ready: true, complete: false, contentLength: 2744110, receivedBytes: 302200 }
	});
	assert.equal(receiving.progress.declaredTotalBytes, 2744110);
	assert.equal(receiving.progress.totalBytes, 2744110);
	assert.equal(receiving.progress.percent, 11, "percent 必须是真实比例，不能因为分片被算成 100");
	assert.equal(receiving.progress.idleSeconds, 0);
	assert.notEqual(receiving.nextAction, "download-viewer-pdf");
});

test("B5：终态任务不再占用队列位次，但仍然是列表里的一条记录", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.desktopLastPendingTaskId = null;
	service.captureProgressSamples = new Map();
	service.desktopWebVpnStatus = null;
	// createdAt 必须在"排队宽限期"内，否则会按"从未被接管"判成 orphaned（那是另一条规则）。
	const recent = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
	const rows = [
		{ id: "capture-a", projectId: "p", requestedBy: "agent", status: "armed", kind: "pdf", createdAt: recent(4), publisherUrl: "https://www.science.org/doi/10.1126/science.adz5300" },
		{ id: "capture-b", projectId: "p", requestedBy: "agent", status: "armed", kind: "pdf", createdAt: recent(2), publisherUrl: "https://www.science.org/doi/10.1126/science.adz5300" }
	];
	service.table = { keys: () => rows.map((row) => row.id), get: (id) => rows.find((row) => row.id === id) };
	// 浏览器正忙着 capture-a，capture-b 是真排队；把 capture-a 判成 orphaned（交还过）
	service.getDesktopWebVpnStatus = () => ({
		stale: false, pendingTaskId: undefined, lastPendingTaskId: "capture-a", releaseReason: "已交还",
		state: "ready", ready: true, iwanReady: true
	});
	const views = service.listTaskViews("p");
	assert.equal(views.length, 2, "终态任务仍要在列表里（历史记录不该消失）");
	const a = views.find((item) => item.task.id === "capture-a");
	const b = views.find((item) => item.task.id === "capture-b");
	assert.equal(a.view.phase, "orphaned");
	assert.equal(a.view.queuePosition, undefined, "终态任务不占位");
	assert.equal(b.view.queuePosition, 1, "活着的那条从第 1 位开始重新排");
});

test("bug1 回归：CoGetInterfaceAndReleaseStream 之后绝不能再 Drop 那个流", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	// MSDN：Releases the stream pointer. Even if the unmarshaling fails, the stream is
	// still released. 让 Rust 包装器再 Drop 一次 = 双重释放 = 一进 PDF 页就崩
	// （2026-09-27 现场："ibm-lab-desktop has stopped working"）。
	assert.match(rust, /ManuallyDrop::new\(unsafe \{\s*IStream::from_raw/, "必须用 ManuallyDrop 接管生命周期");
	assert.match(rust, /CoGetInterfaceAndReleaseStream/);
	// 退化路径（在 UI 线程上读）必须有更短的上限，不能冻住界面几分钟。
	assert.match(rust, /INLINE_STREAM_MAX_WAIT/);
	assert.match(rust, /max_wait\.min\(PDF_STREAM_MAX_WAIT\)/);
});

test("B1 回归：状态与归档共用同一个完整性判据，且分段响应不进入载荷路径", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	assert.match(rust, /fn payload_is_whole\(bytes: &\[u8\], declared_total: Option<u64>\) -> bool/);
	// 两处都必须用它（状态上报 + 归档校验），不许各写一份。
	const uses = rust.match(/payload_is_whole\(/g) ?? [];
	assert.ok(uses.length >= 3, `payload_is_whole 必须被定义一次、使用两处，实际出现 ${uses.length} 次`);
	// 分段响应不再被跳过，而是**装配**进同一个载荷文件（2026-09-28 现场：Wiley 的
	// 4.4 MB PDF 由 18 个 Range 请求组成，跳过它们等于永远收不全）。
	assert.match(rust, /fn parse_content_range\(value: &str\) -> Option<\(u64, u64, Option<u64>\)>/);
	assert.match(rust, /fn covered_bytes\(segments: &\[\(u64, u64\)\]\) -> u64/);
	assert.match(rust, /fn covers_from_zero\(segments: &\[\(u64, u64\)\], total: u64\) -> bool/);
	assert.match(rust, /fn write_segment_at\(path: &Path, offset: u64, bytes: &\[u8\]\)/);
	// 只有**无法解析**的分段才跳过，并留下记录。
	assert.match(rust, /is_partial_response\(status, content_range\.as_deref\(\)\) && parsed_range\.is_none\(\)/);
	assert.match(rust, /跳过无法解析的 PDF 分段响应/);
	// 查看器保存必须先验产物：ShowSaveAsUI 保存的是**页面**，不是 PDF。
	assert.match(rust, /fn viewer_saved_pdf_is_usable\(path: &Path\) -> Result<u64, String>/);
	assert.match(rust, /查看器保存得到的是页面/);
	// 工具栏可收起：出版社自己的保存按钮在右上角，被我们的固定条压住过。
	assert.match(rust, /__ibmWebVpnSetChromeCollapsed/);
	assert.match(rust, /导航栏 ⌄/);
});

test("B2 回归：进 failed 之前先验产物，完整就归档；不完整也保留文件", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	const fn = rust.match(/fn fail_pending_download\(&self, app: &AppHandle, message: &str\) \{[\s\S]*?\n    \}/)?.[0] ?? "";
	assert.ok(fn, "fail_pending_download 必须拿到 AppHandle（否则无法改成归档）");
	assert.match(fn, /if file_is_whole\(&pending\.temp_path\)/, "失败前必须先验产物");
	assert.match(fn, /upload_capture\(app\.clone\(\), upload\)/, "产物完整时要归档而不是报失败");
	assert.match(fn, /preserve_failed_download/, "不完整时要保留证据文件");
	assert.doesNotMatch(fn, /fs::remove_file\(path\)/, "失败时不得再删掉用户的文件");
	assert.match(rust, /fn file_is_whole\(path: &Path\) -> bool/);
});

test("R1（beta16 报告）：下载事件说 success 之后必须等到文件写完才上传", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	// 旧实现一次 fs::read 成功就返回 → 可能把还在写的文件当整份上传 → 捕获服务 400。
	// 现场：同一序列 3 次失败（上传半截）+ 1 次成功，落盘文件其实完整。
	assert.match(rust, /fn read_captured_file\(path: &Path, kind: &str\)/);
	assert.match(rust, /captured_body_defect\(kind, &body\)/, "必须校验结构完整（%PDF- 头 + %%EOF）");
	assert.match(rust, /previous_len == Some\(body\.len\(\)\)/, "必须要求长度稳定才交出去");
	assert.match(rust, /CAPTURE_READ_TIMEOUT/, "必须有等待上限，不能无限等");
	// 交给上传的必须是下载回调确认的那一个路径。
	assert.match(rust, /read_captured_file\(&upload\.path, &upload\.kind\)/);
});

test("R2/R4：服务端拒绝原因与已救回的产物必须可达（不能只进日志）", async () => {
	const rust = await readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");
	// R2：把响应体读出来写进错误（以前只有状态码）
	assert.match(rust, /捕获服务拒绝了文件（HTTP \{status\}）：\{detail\}/);
	assert.match(rust, /response\s*\n?\.text\(\)/, "必须读取响应体");
	// R4：状态里带上 salvaged 产物
	assert.match(rust, /pub struct FailureNotice/);
	assert.match(rust, /pub salvaged_path: Option<String>/);
	assert.match(rust, /pub salvaged_sha256: Option<String>/);
	assert.match(rust, /pub last_failure: Option<FailureNotice>/);
	// 只有"文件确实是完整 PDF"才给 sha256，避免误导调用方去救半截文件
	assert.match(rust, /filter\(\|path\| file_is_whole\(path\)\)/);

	// 客户端要把这两个字段上报（以前根本没传）
	const client = await readFile(new URL("../../client/src/components-literature.js", import.meta.url), "utf8");
	assert.match(client, /lastError: shellStatus\?\.lastError/);
	assert.match(client, /lastFailure: shellStatus\?\.lastFailure/);
});

test("R5：失败原因不许被藏起来，也不许被 cancel 吃掉", async () => {
	const phase = await readFile(new URL("../../lib/capture-phase.js", import.meta.url), "utf8");
	// 旧写法 `task.error && !requiresUserAction` —— 恰恰在失败时把原因藏掉。
	assert.doesNotMatch(phase, /task\.error && !requiresUserAction/);
	assert.match(phase, /const reasons = \[task\.error, desktop\.lastError, desktop\.lastFailure\?\.message\]/);
	assert.match(phase, /本地已保住完整文件/);

	const capture = await readFile(new URL("../../lib/manual-capture.js", import.meta.url), "utf8");
	assert.match(capture, /cancelReason,/, "取消原因要单独存");
	assert.match(capture, /error: previous \?\? cancelReason/, "已有失败原因不许被取消覆盖");
	assert.match(capture, /errorHistory/, "要留历史便于事后回溯");
});

test("R3：400 的返回体带可判别 code 与收到的字节数", async () => {
	const [src, capture] = await Promise.all([
		readFile(new URL("../../src/manual-capture.js", import.meta.url), "utf8"),
		readFile(new URL("../../lib/manual-capture.js", import.meta.url), "utf8")
	]);
	for (const code of ["payload-too-small", "missing-pdf-header", "missing-eof", "kind-mismatch"]) {
		assert.match(src, new RegExp(`captureValidationError\\("${code}"`), `校验失败必须带 code ${code}`);
	}
	assert.match(src, /export function captureValidationError\(code, message\)/);
	assert.match(capture, /code: error\?\.code/, "上传失败要回传 code");
	assert.match(capture, /receivedBytes:/, "上传失败要回传 receivedBytes");
});

test("R7：预设把「先读原因、再决定」写成了固定顺序", async () => {
	const preset = await readFile(new URL("../../presets/lab-research/preset.patch.yml", import.meta.url), "utf8");
	assert.match(preset, /先读原因，再决定/);
	assert.match(preset, /不要先 cancel/);
	assert.match(preset, /本地已保住完整文件/);
	assert.match(preset, /连续 400\/失败超过 2 次就停止自动重试/);
});

test("downloadReady 必须与 nextAction=download-viewer-pdf 同义（348 B 空壳不可保存）", async () => {
	const tools = harness(captureStub({
		task: { ...TASK, status: "armed" },
		desktop: desktop({
			state: "waiting-download",
			automationStage: "manual",
			// 348 B 的 HTML 空壳：进来了字节（ready）但没被证明完整（complete=false）
			pdfPayload: { ready: true, complete: false, receivedBytes: 348, error: "已接收 348 字节，且尾部没有 %%EOF" }
		})
	}));
	const status = tools.find((item) => item.name === "lab_publisher_browser_download_status");
	const value = await status.execute({ projectId: "proj-test", taskId: "capture-1" }, {});
	assert.equal(value.downloadReady, false, "HTML 空壳不能触发原生查看器保存");
	assert.equal(value.payloadReady, true, "有字节了就是 ready");
	assert.equal(value.payloadComplete, false);
	assert.notEqual(value.nextAction, "download-viewer-pdf");
	assert.ok(
		value.downloadReady === (value.nextAction === "download-viewer-pdf"),
		"downloadReady 与 nextAction 必须同义"
	);
});
