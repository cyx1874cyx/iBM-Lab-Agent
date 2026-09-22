// 文献浏览器 tab 的桥（client/src/webvpn-bridge.js）：opener 语义、首次矩形等待、
// 跨 iframe 上报。这一层刻意不依赖 React，所以能在 Node 里直接 import；
// 带 React 的 webvpn-tab.js 只能在 DSH ModuleLoader 里加载，不在本用例范围。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const bridgePath = fileURLToPath(new URL("../../client/src/webvpn-bridge.js", import.meta.url));
const bridgeHref = pathToFileURL(bridgePath).href;
// 模块内的 rectReported 是粘性状态；每个用例用不同的 query 取一份全新实例。
const bridge = (tag) => import(`${bridgeHref}?case=${tag}`);

test("waitForWebVpnRect 超时返回 false，不把调用方永久挂住", async () => {
	const api = await bridge("timeout");
	assert.equal(api.isWebVpnTabBound(), false);
	assert.equal(await api.waitForWebVpnRect(20), false, "超时必须给出明确结论");
	assert.equal(api.isWebVpnTabBound(), false, "超时不得冒充已接管布局");
});

test("markWebVpnRectReported 幂等且唤醒全部等待者", async () => {
	const api = await bridge("mark");
	const first = api.waitForWebVpnRect(1000);
	const second = api.waitForWebVpnRect(1000);
	api.markWebVpnRectReported();
	assert.equal(await first, true);
	assert.equal(await second, true);
	assert.equal(api.isWebVpnTabBound(), true);
	// 置位之后立即返回，不再等超时。
	assert.equal(await api.waitForWebVpnRect(5), true);
	// 重复标记不改变结论。
	api.markWebVpnRectReported();
	assert.equal(api.isWebVpnTabBound(), true);
});

test("没有 opener 时 openWebVpnTab 返回 false（调用方回落原生路径）", async () => {
	const api = await bridge("no-opener");
	assert.equal(await api.openWebVpnTab(), false);
});

test("openWebVpnTab 打开 tab 后要等首次矩形上报才返回", async () => {
	const api = await bridge("open");
	let opened = 0;
	api.setWebVpnTabOpener(() => { opened += 1; });
	let settled = false;
	const pending = api.openWebVpnTab().then((value) => { settled = true; return value; });
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(opened, 1, "必须先打开（或聚焦）右侧栏 tab");
	assert.equal(settled, false, "首次矩形上报前返回会让 Rust 先走一次旧的按比例分栏");
	api.markWebVpnRectReported();
	assert.equal(await pending, true);
	// 注销后不再打开任何东西：插件卸载 / 右侧栏组成变化时的回落路径。
	api.setWebVpnTabOpener(null);
	assert.equal(await api.openWebVpnTab(), false);
	assert.equal(opened, 1, "注销后不得再触发 opener");
});

test("opener 抛异常时 openWebVpnTab 返回 false 而不是冒泡", async () => {
	const api = await bridge("throw");
	api.setWebVpnTabOpener(() => { throw new Error("右侧栏不可用"); });
	assert.equal(await api.openWebVpnTab(), false);
});

test("sendWebVpnRect 只在 iframe 内上报，消息形状与桌面壳的约定一致", async () => {
	const api = await bridge("send");
	const sent = [];
	const postMessage = (message, target) => sent.push({ message, target });
	const original = globalThis.window;
	const useWindow = (value) => { globalThis.window = value; };
	try {
		useWindow({ parent: { postMessage } });
		api.sendWebVpnRect({ visible: true, x: 10.5, y: 20, width: 400, height: 600 });
		assert.equal(sent.length, 1);
		const [{ message, target }] = sent;
		assert.equal(target, "*");
		assert.equal(message.source, "ibm-lab-agent");
		assert.equal(message.type, api.WEBVPN_RECT_MESSAGE);
		assert.equal(message.type, "WEBVPN_SET_RECT", "桌面壳按这个字面量分发");
		assert.equal(typeof message.requestId, "string");
		assert.ok(message.requestId.length > 0, "桌面壳要求 requestId 非空，否则整条消息被丢弃");
		assert.deepEqual(message.payload, { visible: true, x: 10.5, y: 20, width: 400, height: 600 });

		// 顶层页面（parent === 自己）：没有壳可承接，不发消息。
		const self = { postMessage };
		self.parent = self;
		useWindow(self);
		api.sendWebVpnRect({ visible: false });
		assert.equal(sent.length, 1);

		// 没有 parent 字段 / parent 为空：同样静默跳过。
		useWindow({});
		api.sendWebVpnRect({ visible: false });
		useWindow({ parent: null });
		api.sendWebVpnRect({ visible: false });
		assert.equal(sent.length, 1);
	} finally {
		if (original === undefined) delete globalThis.window;
		else useWindow(original);
	}
});

test("sendWebVpnRect 吞掉 postMessage 异常，不打断布局循环", async () => {
	const api = await bridge("send-throw");
	const original = globalThis.window;
	try {
		globalThis.window = { parent: { postMessage: () => { throw new Error("通道已关闭"); } } };
		assert.doesNotThrow(() => api.sendWebVpnRect({ visible: false }));
	} finally {
		if (original === undefined) delete globalThis.window;
		else globalThis.window = original;
	}
});
