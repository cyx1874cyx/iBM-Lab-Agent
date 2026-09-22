// dsh-lab-agent：把「软件内浏览器」（WebVPN 子 WebView）挂进 DSH 自带的右侧栏。
//
// 需求合并点：DSH 的右侧栏（@deepseek-ai/dsh-client-ui-sidebar-right）本身是一个
// 可扩展停靠面，自带「文件」与「文档预览」两类 tab，并提供公开的 tab 类型注册表
// ctx.sidebarRightTabs 与导航控制器 ctx.sidebarRight。这里注册第三类**页面 tab**，
// 使 WebVPN 浏览器与自带预览共用同一个展开按钮、标签条、拆分/浮动/全屏行为。
//
// 布局分工（与改造前「Rust 自己按 width/3 分栏」相对）：
//   * DSH 负责让位——push presentation 由右侧栏自己收窄对话列；
//   * 本模块只负责量出 tab 正文的矩形并上报（逻辑在 webvpn-bridge.js）；
//   * 原生子 WebView 由 Rust 端 set_bounds 摆到该矩形上，不再改动主 WebView 宽度。
import { useEffect, useRef } from "react";
import { h } from "./h.js";
import { iwanStatusViaShell, openWebVpnPortalViaShell, webVpnStatusViaShell } from "./lib.js";
import { WEBVPN_MIN_RECT, isWebVpnCaptureArmed, markWebVpnRectReported, sendWebVpnRect, setWebVpnTabOpener } from "./webvpn-bridge.js";

/** tab 类型身份：同时是 sidebar.right.pane.tab 座位上的派发 key。 */
export const WEBVPN_TAB_ID = "dsh-lab-agent/webvpn";
/** 页面类型的 kind：ctx.sidebarRight.openTab 用它打开。 */
export const WEBVPN_TAB_KIND = "lab-webvpn";

/**
 * tab 正文。原生子 WebView 会覆盖这一区域，因此这里的 DOM 只在
 * 「桌面壳未接管」或「WebVPN 尚未打开」时可见。
 */
export function WebVpnTabBody({ useTabInfo }) {
	const { tab } = useTabInfo();
	const visible = tab?.visible === true;
	const hostRef = useRef(null);

	useEffect(() => {
		if (!visible) { sendWebVpnRect({ visible: false }); return undefined; }
		const node = hostRef.current;
		if (!node) { sendWebVpnRect({ visible: false }); return undefined; }
		let frame = 0;
		let disposed = false;
		const push = () => {
			frame = 0;
			if (disposed) return;
			const rect = node.getBoundingClientRect();
			if (!(rect.width >= WEBVPN_MIN_RECT) || !(rect.height >= WEBVPN_MIN_RECT)) {
				sendWebVpnRect({ visible: false });
				return;
			}
			markWebVpnRectReported();
			sendWebVpnRect({ visible: true, x: rect.left, y: rect.top, width: rect.width, height: rect.height });
		};
		const schedule = () => { if (frame || disposed) return; frame = requestAnimationFrame(push); };
		push();
		let observer = null;
		if (typeof ResizeObserver === "function") { observer = new ResizeObserver(schedule); observer.observe(node); }
		window.addEventListener("resize", schedule, true);
		window.addEventListener("scroll", schedule, true);
		return () => {
			disposed = true;
			if (frame) cancelAnimationFrame(frame);
			if (observer) observer.disconnect();
			window.removeEventListener("resize", schedule, true);
			window.removeEventListener("scroll", schedule, true);
			// 切 tab / 收起侧栏 / 关闭 tab 都会走到这里：必须立即收起原生子 WebView，
			// 否则它会继续浮在别的 tab 或对话区上方。
			sendWebVpnRect({ visible: false });
		};
	}, [visible]);

	const inShell = typeof window !== "undefined" && window.parent !== window;
	// 初始页：从「+」→ 类型列表选「文献浏览器」时，用户并没有指定目标地址，
	// 这时把原生载体打开到配置的 WebVPN 门户（默认中国科大）。载体已存在
	// （登录态保留、或正在看某个出版社页面）时绝不重新导航，否则会打断用户。
	const portalSeeded = useRef(false);
	useEffect(() => {
		if (!visible || portalSeeded.current || !inShell) return;
		portalSeeded.current = true;
		void (async () => {
			// 捕获正在布防：控制器马上会把载体开往出版社页面，这里再开一次门户
			// 会把目标页盖掉（用户看到的就是「必须先打开 WebVPN」）。
			if (isWebVpnCaptureArmed()) return;
			const [status, iwan] = await Promise.all([
				webVpnStatusViaShell().catch(() => null),
				iwanStatusViaShell().catch(() => null)
			]);
			if (!status || status.windowOpen) return;
			// iWAN 全部路由可用时机构可直接访问，不需要也不应该先绕 WebVPN 门户。
			if (iwan?.usable) return;
			await openWebVpnPortalViaShell().catch(() => {});
		})();
	}, [visible, inShell]);

	return h("div", { ref: hostRef, className: "ib-webvpn-tab", "data-shell": inShell ? "desktop" : "browser" },
		h("div", { className: "ib-webvpn-tab-note" },
			h("b", null, "文献浏览器"),
			h("p", null, inShell
				? "软件内浏览器由桌面窗口渲染。若此处为空，请回到「文献工作流」点击「打开 WebVPN」。"
				: "软件内浏览器仅在 iBM Lab Agent 桌面版可用；网页版请在新标签页打开文献链接。")));
}

/**
 * 注册「文献浏览器」tab 类型与正文。
 *
 * 贡献 guide 条目，使右侧栏「+」的类型列表里能选到「文献浏览器」；正文首次可见时
 * 若原生载体还不存在，自动打开到配置的 WebVPN 门户（默认中国科大）。
 *
 * @param ctx - hooks：`openTab` 为 ctx.sidebarRight.openTab 的绑定；其余为 Cordis 装配面。
 */
export function registerWebVpnTab(ctx, { openTab }) {
	ctx.effect(() => ctx.sidebarRightTabs.register({
		id: WEBVPN_TAB_ID,
		kind: WEBVPN_TAB_KIND,
		priority: "extension",
		title: () => "文献浏览器",
		// 贡献 guide 条目 = 在「+」的类型列表里出现「文献浏览器」。
		//
		// 代价要知道：DSH 的默认页规则是「恰好一个 guide 条目 → 直接打开它；零个或多个 →
		// 打开指南页」。自带「文件」已占一条，所以再加一条会让右侧栏首次展开时的默认页
		// 从「文件」变成「选择类型」的指南页。这是「+ 里能选浏览器」的唯一扩展点，
		// 属有意取舍。
		guide: [{
			order: 30,
			title: () => "文献浏览器",
			description: () => "软件内浏览器：中国科大 WebVPN 门户与出版社页面"
		}]
	}), "dsh-lab-agent: 文献浏览器 tab 类型");
	ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
		name: "sidebar.right.pane.tab",
		key: WEBVPN_TAB_ID
	}, WebVpnTabBody)), "dsh-lab-agent: 文献浏览器 tab 正文");
	setWebVpnTabOpener(openTab);
	ctx.effect(() => () => setWebVpnTabOpener(null), "dsh-lab-agent: 文献浏览器 opener");
}
