import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { apply } from "../../lib/tasks-tool.js";

/**
 * AI 主导的文献浏览器闭环（2026-09-27 需求）。
 *
 * 旧形状是「壳内脚本自己点 + Agent 轮询状态」，AI 只是旁观者；现在默认把页面交给
 * Agent：脚本不点击，Agent 用 observe（scope=all）看页面、click 点入口、wait 等页面
 * 变化、需要时 save 归档。
 */
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

/** 收集 apply() 注册的工具；ctx 只填被测工具真正会用的成员。 */
function harness(labCapture, labTasks = {}) {
	const registered = [];
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labCapture,
		labTasks: { getProject: () => ({ id: "proj-test" }), getBundle: () => null, ...labTasks }
	});
	return registered;
}

const desktopStatus = (patch = {}) => ({
	stale: false,
	pendingTaskId: "capture-1",
	state: "waiting-download",
	automationStage: "searching",
	ready: true,
	iwanReady: true,
	downloadedBytes: undefined,
	...patch
});

function captureStub({ task, desktop }) {
	return {
		sweepExpired: async () => {},
		getTask: () => task,
		listTasks: () => [task],
		getDesktopWebVpnStatus: () => desktop
	};
}

test("下载工具默认 mode=ai（页面交给 Agent），显式传 auto 才走脚本快路径", async () => {
	const calls = [];
	const tools = harness({
		getDesktopWebVpnStatus: () => desktopStatus({ iwanReady: true }),
		createAgentCaptureTask: async (args) => {
			calls.push(args);
			return { id: "capture-1", kind: args.kind };
		}
	}, {
		getBundle: () => ({ id: "bundle-1", projectId: "proj-test", bundleId: "bundle-1", doi: "10.1038/s41586-026-10998-3" })
	});
	const tool = tools.find((item) => item.name === "lab_publisher_browser_download");
	assert.ok(tool, "必须注册下载工具");
	assert.equal(tool.parameters.properties.mode.enum.join("/"), "ai/auto", "必须暴露 mode");
	await tool.execute({ projectId: "proj-test", bundleId: "bundle-1", kind: "pdf" }, {});
	await tool.execute({ projectId: "proj-test", bundleId: "bundle-1", kind: "pdf", mode: "auto" }, {});
	assert.equal(calls[0].mode, "ai", "不传 mode 必须是 ai");
	assert.equal(calls[1].mode, "auto", "显式 auto 必须透传");
});

test("AI 主导的任务：状态直接要求观察+点击，而不是等自动下载", async () => {
	const task = {
		id: "capture-1", projectId: "proj-test", bundleId: "bundle-1", kind: "pdf",
		requestedBy: "agent", mode: "ai", status: "armed", createdAt: "2026-09-27T00:00:00.000Z"
	};
	const tools = harness(captureStub({ task, desktop: desktopStatus() }));
	const tool = tools.find((item) => item.name === "lab_publisher_browser_download_status");
	assert.ok(tool);
	const value = await tool.execute({ projectId: "proj-test", taskId: "capture-1" }, {});
	assert.equal(value.nextAction, "observe-or-click", "AI 主导时不能让调用方干等自动下载");
	assert.match(value.message, /由你直接操作/, "消息必须说清页面由 Agent 操作");
	assert.match(value.message, /lab_browser_wait/, "必须给出闭环里的等待工具");
});

test("脚本快路径（mode=auto）仍按老规则：automationStage=manual 才 observe", async () => {
	const task = {
		id: "capture-1", projectId: "proj-test", bundleId: "bundle-1", kind: "pdf",
		requestedBy: "agent", mode: "auto", status: "armed", createdAt: "2026-09-27T00:00:00.000Z"
	};
	const tools = harness(captureStub({ task, desktop: desktopStatus({ automationStage: "searching" }) }));
	const tool = tools.find((item) => item.name === "lab_publisher_browser_download_status");
	const value = await tool.execute({ projectId: "proj-test", taskId: "capture-1" }, {});
	assert.equal(value.nextAction, "wait-and-poll", "auto 模式下脚本还在找入口，应等待");
});

test("lab_browser_wait：状态一变就返回，不必让调用方轮询", async () => {
	const task = {
		id: "capture-1", projectId: "proj-test", bundleId: "bundle-1", kind: "pdf",
		requestedBy: "agent", mode: "ai", status: "armed", createdAt: "2026-09-27T00:00:00.000Z"
	};
	let stage = "searching";
	const tools = harness(captureStub({ task, desktop: desktopStatus({ automationStage: "searching" }) }));
	const tool = tools.find((item) => item.name === "lab_browser_wait");
	assert.ok(tool, "必须注册 lab_browser_wait");
	// 300ms 后页面状态变化（模拟点击后开始下载）。
	setTimeout(() => { stage = "downloading"; }, 300);
	const capture = captureStub({ task, desktop: desktopStatus({ automationStage: "searching" }) });
	capture.getDesktopWebVpnStatus = () => desktopStatus({ automationStage: stage, state: stage === "downloading" ? "downloading" : "waiting-download" });
	const waited = harness(capture).find((item) => item.name === "lab_browser_wait");
	const started = Date.now();
	const value = await waited.execute({ projectId: "proj-test", taskId: "capture-1", timeoutMs: 5000 }, {});
	const elapsed = Date.now() - started;
	assert.ok(elapsed < 2500, `状态一变就该返回，实际等了 ${elapsed}ms`);
	assert.ok(!/秒内没有变化/.test(value.message || ""), "命中变化时不应带超时说明");
});

test("闭环四处接线：observe scope、wait 工具、客户端按 mode 决定 automate", async () => {
	const [rust, shell, plugin, client, capture] = await Promise.all([
		read("desktop/src-tauri/src/webvpn.rs"),
		read("desktop/src/index.html"),
		read("lib/tasks-tool.js"),
		read("client/src/components-literature.js"),
		read("lib/manual-capture.js"),
	]);
	// observe 支持 scope=all：AI 要看整页可交互元素，而不是只有下载入口。
	assert.match(rust, /__OBSERVE_SCOPE__/, "页面脚本必须支持 scope");
	assert.match(rust, /scope: &str/, "browser_action 必须接收 scope");
	assert.match(shell, /scope: String\(data\.payload\?\.scope \|\| 'download'\)/, "壳必须转交 scope");
	assert.match(plugin, /scope: \{ type: "string"/, "observe 工具必须暴露 scope");
	assert.match(capture, /scope: scope === "all" \? "all" : "download"/, "插件必须记住 scope");
	// 观察结果必须带页面摘要，AI 才知道"这是哪一页、处于什么阶段"。
	assert.match(rust, /text: bodyText\.slice\(0, 1200\)/, "观察必须带可见文本摘要");
	assert.match(rust, /readyState: document\.readyState/, "观察必须带加载状态");
	// 客户端只对 mode=auto 才发自动点击脚本。
	assert.match(client, /automate: claimedTask\.mode === "auto"/, "automate 必须由任务模式决定");
});
