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
/** 布防后多久内视为「正在把载体开往目标页」。 */
const CAPTURE_ARM_WINDOW_MS = 15000;

let openTabAction = null;
let rectReported = false;
let captureArmedAt = 0;
const rectWaiters = new Set();

/**
 * 标记「马上要把载体开往某个出版社页面」。
 *
 * tab 正文首次可见时会自己打开 WebVPN 门户（用户从「+」进来时没有目标地址）。
 * 但捕获流程也在同一时刻开 tab，两条导航会互相覆盖——门户可能把出版社页面盖掉。
 * 布防窗口内门户不再抢导航。
 */
export function armWebVpnCaptureWindow() {
	captureArmedAt = Date.now();
}

/** 是否处在捕获布防窗口内。 */
export function isWebVpnCaptureArmed() {
	return captureArmedAt > 0 && Date.now() - captureArmedAt < CAPTURE_ARM_WINDOW_MS;
}

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
 * 把当前捕获队列快照交给桌面壳（壳再转给 Rust，最终画在捕获小球上）。
 *
 * 队列的真源在插件里，所以只能由客户端主动上报；小球用它显示排队序列，
 * 并对每条排队任务提供"删除 / 重建"入口。
 *
 * `view.ball` 是插件按「同一份真相」推导好的文案/色调（C20）：壳只负责渲染，
 * 不再自己按 state 猜一遍，否则工具说 queued、小球说失败这种矛盾又会回来。
 *
 * @param tasks - 插件返回的任务数组（含 view.ball）。
 */
export function sendWebVpnBallQueue(tasks) {
	if (typeof window === "undefined" || !window.parent || window.parent === window) return;
	const entries = (Array.isArray(tasks) ? tasks : []).slice(0, 50).map((task) => {
		const ball = task?.view?.ball;
		return {
			id: String(task?.id ?? ""),
			kind: String(task?.kind ?? ""),
			status: String(task?.status ?? ""),
			requestedBy: String(task?.requestedBy ?? ""),
			ball: ball ? {
				phase: String(ball.phase ?? ""),
				text: String(ball.text ?? "").slice(0, 160),
				tone: String(ball.tone ?? ""),
				stalled: Boolean(ball.stalled),
				canRecreate: Boolean(ball.canRecreate),
				canCancel: Boolean(ball.canCancel)
			} : undefined
		};
	}).filter((entry) => entry.id);
	try {
		window.parent.postMessage({
			source: "ibm-lab-agent",
			type: "WEBVPN_BALL_QUEUE",
			payload: { tasks: entries }
		}, "*");
	} catch { /* 壳未就绪：下一轮轮询会重发 */ }
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
