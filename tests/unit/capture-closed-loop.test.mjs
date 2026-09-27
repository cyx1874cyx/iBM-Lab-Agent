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

test("R2.3/C8：预览器里没有可点元素时改走 ?download=true 的备用入口", () => {
	const entry = normalizeDownloadEntry("https://www.science.org/doi/epdf/10.1126/science.adz5300");
	assert.equal(entry, "https://www.science.org/doi/pdf/10.1126/science.adz5300?download=true");
	const manual = view({ automationStage: "manual", pageUrl: "https://www.science.org/doi/epdf/10.1126/science.adz5300" });
	assert.equal(manual.nextAction, "retry-download-entry");
	assert.equal(manual.alternateEntry, entry);
	// 不再返回那个会静默失败的动作名。
	assert.notEqual(manual.nextAction, "observe-or-save-pdf");
	// 无效 DOI 时不伪造入口。
	assert.equal(normalizeDownloadEntry("https://example.org/no-doi-here"), undefined);
});

test("R2.2/C1：PDF 载荷就绪才给 save-pdf-ready，且方向由同一份推导决定", () => {
	const notReady = view({ automationStage: "manual" });
	assert.notEqual(notReady.nextAction, "save-pdf-ready");
	const ready = view({
		automationStage: "manual",
		documentType: "application/pdf",
		pdfPayload: { ready: true, complete: true, contentLength: 2716660, receivedBytes: 2716660 }
	});
	assert.equal(ready.nextAction, "save-pdf-ready");
	assert.equal(ready.pdf.ready, true);
	assert.match(ready.message, /lab_browser_save_current_pdf/);
});

test("R6.2/C17：长时间没有字节增长就是 stalled，不再永远显示「正在保存」", () => {
	const saving = { state: "downloading", automationStage: "saving", downloadedBytes: 1024 };
	assert.equal(view(saving, {}, 0).phase, "downloading");
	const stalled = deriveCaptureView({
		task: TASK, desktop: desktop(saving), stalledMs: CAPTURE_STALL_MS + 1, now: Date.parse(TASK.createdAt) + 1000
	});
	assert.equal(stalled.phase, "stalled");
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
	const save = service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "save-pdf" });
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
	assert.match(expired.error, /保存原生 PDF 超时/);
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
	assert.match(preset, /save-pdf-ready/, "只有载荷就绪才调保存工具");
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

test("D5：只要载荷没被证明收全，就绝不允许引导去归档（治 HTTP 400 那条）", () => {
	const receiving = view({ automationStage: "manual", pdfPayload: { ready: true, complete: false, contentLength: 2716668, receivedBytes: 262144 } });
	assert.notEqual(receiving.nextAction, "save-pdf-ready");
	assert.equal(receiving.nextAction, "wait-and-poll");
	assert.equal(receiving.pdf.complete, false);
	assert.match(receiving.message, /正在接收/);
	// 分片绝不能冒充总长（现场原话是「已就绪（256.0 KB）」，真实 2.6 MB）。
	assert.match(receiving.message, /256\.0 KB \/ 2\.6 MB/);
	assert.equal(receiving.progress.percent, 10);
	assert.equal(receiving.progress.totalBytes, 2716668);

	const complete = view({ automationStage: "manual", pdfPayload: { ready: true, complete: true, contentLength: 2716668, receivedBytes: 2716668 } });
	assert.equal(complete.nextAction, "save-pdf-ready");
	assert.match(complete.message, /已完整接收（2\.6 MB）/);
});

test("D2/D5：载荷未收全是一个可执行的失败分支，不是「再等等」", () => {
	const failed = view({
		automationStage: "manual",
		pageUrl: "https://www.science.org/doi/pdf/10.1126/science.adz5300",
		pdfPayload: { ready: true, complete: false, contentLength: 2716668, receivedBytes: 262144, error: "已接收 262144 / 2716668 字节" }
	});
	assert.equal(failed.nextAction, "retry-download-entry");
	assert.match(failed.message, /未收全/);
	assert.match(failed.message, /256\.0 KB \/ 2\.6 MB/);
	assert.match(failed.message, /\?download=true/);
});

test("D6：总量未知时不给假的百分比，速度由相邻两次采样给出", () => {
	const unknown = view({ pdfPayload: { ready: true, complete: false, receivedBytes: 512 * 1024 } });
	assert.equal(unknown.progress.totalBytes, undefined);
	assert.equal(unknown.progress.percent, undefined);
	assert.match(unknown.message, /总大小未知/);
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
	assert.equal(described.progress.speedBps, 1024 * 1024);
	assert.equal(described.progress.etaSeconds, 3);
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

test("D9：预设只说 nextAction，不再教模型看 saveReady 布尔值", async () => {
	const preset = await readFile(new URL("../../presets/lab-research/preset.patch.yml", import.meta.url), "utf8");
	assert.doesNotMatch(preset, /saveReady=true/, "不要再教模型看 saveReady");
	assert.match(preset, /判据是 nextAction/);
	assert.match(preset, /只等，不要归档/);
	assert.match(preset, /2 的整次幂/);
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
	// 第二个响应绝不能和第一个共享载荷文件。
	assert.match(rust, /if existing\.error\.is_none\(\) \{\s*return false;/);
});
