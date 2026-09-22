// dsh-lab-agent：文献浏览器 tab 与桌面壳之间的桥。
//
// 刻意不 import React：这一层是纯逻辑（打开 tab、等待首次矩形、上报矩形），
// 拆出来才能在 Node 里直接单测（React 由 DSH ModuleLoader 在运行时注入，
// 仓库 node_modules 里没有，带 React 的模块无法在测试进程里 import）。
//
// 矩形语义：客户端只上报「相对自己视口」的 CSS 像素；跨 iframe 的偏移由桌面壳
// （desktop/src/index.html）补上，因为只有它知道 iframe 在窗口里的位置。

/** 桌面壳消息类型：tab 正文矩形上报（客户端 → shell → webvpn_set_rect）。 */
export const WEBVPN_RECT_MESSAGE = "WEBVPN_SET_RECT";
/** 原生子 WebView 的最小可用尺寸；低于此值按不可见处理（收起、切走或隐藏）。 */
export const WEBVPN_MIN_RECT = 80;
/** 等待首次矩形上报的默认上限。 */
export const WEBVPN_RECT_READY_TIMEOUT_MS = 800;

let openTabAction = null;
let rectReported = false;
const rectWaiters = new Set();

/** 本次进程内是否已成功上报过可用矩形（即布局是否已由 DSH 右侧栏接管）。 */
export function isWebVpnTabBound() {
	return rectReported;
}

/**
 * 装配右侧栏 opener。由注册层在 sidebarRight 服务就绪后调用；传 null 注销。
 * @param fn - 打开（或聚焦）文献浏览器 tab 的动作。
 */
export function setWebVpnTabOpener(fn) {
	openTabAction = typeof fn === "function" ? fn : null;
}

/** 标记「已上报过可用矩形」。幂等；首次标记会唤醒所有等待者。 */
export function markWebVpnRectReported() {
	if (rectReported) return;
	rectReported = true;
	for (const resolve of rectWaiters) resolve(true);
	rectWaiters.clear();
}

/**
 * 等到首次矩形上报。
 * @param timeoutMs - 上限；超时返回 false（调用方仍可继续，只是没有布局保证）。
 */
export function waitForWebVpnRect(timeoutMs = WEBVPN_RECT_READY_TIMEOUT_MS) {
	if (rectReported) return Promise.resolve(true);
	return new Promise((resolve) => {
		rectWaiters.add(resolve);
		setTimeout(() => { if (rectWaiters.delete(resolve)) resolve(false); }, timeoutMs);
	});
}

/**
 * 上报一次 tab 正文状态。不在桌面壳内（没有 parent）时静默跳过。
 * @param payload - `{ visible, x?, y?, width?, height? }`，坐标为相对本视口的 CSS 像素。
 */
export function sendWebVpnRect(payload) {
	if (typeof window === "undefined" || !window.parent || window.parent === window) return;
	try {
		window.parent.postMessage({
			source: "ibm-lab-agent",
			type: WEBVPN_RECT_MESSAGE,
			requestId: `webvpn-rect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			payload
		}, "*");
	} catch { /* 壳未就绪：下一次布局变化会重发 */ }
}

/**
 * 打开（或聚焦）右侧栏的「文献浏览器」tab，并等到首次矩形上报完成。
 *
 * 必须等首个矩形：`webvpn_open_login` 会走 show_sidebar，而 Rust 端只有在收到过
 * 矩形之后才切换到「客户端接管布局」模式；不等就会先走一次旧的按比例分栏。
 *
 * @returns 右侧栏服务不可用时返回 false，调用方应回落原生兜底路径。
 */
export async function openWebVpnTab() {
	if (!openTabAction) return false;
	try { openTabAction(); }
	catch (reason) { console.warn("[dsh-lab-agent] 打开文献浏览器 tab 失败", reason); return false; }
	await waitForWebVpnRect();
	return true;
}
