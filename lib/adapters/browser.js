/**
 * dsh-lab-agent: 浏览器交互适配器（抽象接口）。
 *
 * 背景（路线书 3.3）：文献/捕获侧（板块一）此前直接用具体模式字符串做分支，
 * 因而必须知道「desktop-edge-handoff 意味着外部 Edge + Tauri shell」这类
 * **板块三的实现细节**，形成唯一的双向依赖。本模块把模式语义收敛成一张
 * 描述符表：
 *
 *   - 板块一（lib/literature-sources.js 等）只按描述符字段分支，
 *     不再出现任何具体模式字面量；
 *   - 板块三（lib/capture-handoff.js 的 handoff 页面、桌面端 Tauri shell 的
 *     open_in_edge）是实现提供方，只需满足描述符声明的能力；
 *   - 模式**词表**由 lib/capabilities.js 拥有，本模块只给它加语义。
 *
 * 三种模式的语义矩阵：
 *
 *   mode                 kind              sessionTarget  launchesBrowser  requiresDesktopShell  captureHandoff  autoLocate
 *   web-current          current-tab       current        false            false                 false           false
 *   managed-edge         managed-profile   managed        true             false                 false           true
 *   desktop-edge-handoff handoff           handoff        false            true                  true            false
 *
 * 关键结论（路线书 3.3 验收 ③）：managed-edge **不依赖桌面 shell**，因此在没有
 * Tauri 的 Linux 服务端环境同样可用 —— 它自己启动受控 profile 并经 CDP 定位页面。
 */

import {
	BROWSER_MODE_DESKTOP_HANDOFF,
	BROWSER_MODE_MANAGED_EDGE,
	BROWSER_MODES,
	BROWSER_MODE_WEB_CURRENT
} from "../capabilities.js";

/**
 * 模式描述符。字段含义：
 *   mode                 模式标识（与 lib/capabilities.js 的词表一致）
 *   label                人读名称（UI/诊断用）
 *   kind                 适配器类别：current-tab | managed-profile | handoff
 *   sessionTarget        connect({ mode }) 的线上词汇（current | managed | handoff）
 *   sessionBrowser       会话行持久化的 browser 枚举；不落库的模式为 undefined
 *   launchesBrowser      宿主是否要自己 spawn 一个浏览器进程
 *   requiresDesktopShell 是否必须有桌面封装环境（Tauri）才能工作
 *   captureHandoff       是否经「捕获扩展 + Native Messaging」回传 PDF/SI
 *   autoLocate           是否可经 CDP 自动定位到目标数据库页面
 */
export const BROWSER_ADAPTERS = Object.freeze({
	[BROWSER_MODE_WEB_CURRENT]: Object.freeze({
		mode: BROWSER_MODE_WEB_CURRENT,
		label: "当前浏览器",
		kind: "current-tab",
		sessionTarget: "current",
		sessionBrowser: "current-browser",
		launchesBrowser: false,
		requiresDesktopShell: false,
		captureHandoff: false,
		autoLocate: false
	}),
	[BROWSER_MODE_MANAGED_EDGE]: Object.freeze({
		mode: BROWSER_MODE_MANAGED_EDGE,
		label: "受控检索浏览器",
		kind: "managed-profile",
		sessionTarget: "managed",
		sessionBrowser: undefined,
		launchesBrowser: true,
		requiresDesktopShell: false,
		captureHandoff: false,
		autoLocate: true
	}),
	[BROWSER_MODE_DESKTOP_HANDOFF]: Object.freeze({
		mode: BROWSER_MODE_DESKTOP_HANDOFF,
		label: "外部 Edge（捕获回传）",
		kind: "handoff",
		sessionTarget: "handoff",
		sessionBrowser: "edge-handoff",
		launchesBrowser: false,
		requiresDesktopShell: true,
		captureHandoff: true,
		autoLocate: false
	})
});

/** 描述符表必须覆盖 capabilities 声明的全部模式（启动即失败，便于尽早发现漂移）。 */
const MISSING = BROWSER_MODES.filter((mode) => !Object.prototype.hasOwnProperty.call(BROWSER_ADAPTERS, mode));
if (MISSING.length) {
	throw new Error(`browser adapter 缺少模式描述符：${MISSING.join(", ")}`);
}

/** 取某个模式的描述符；未知模式抛错（不静默回落，避免把错配置当成可用环境）。 */
export function browserAdapter(mode) {
	const adapter = BROWSER_ADAPTERS[mode];
	if (!adapter) throw new Error(`未知的浏览器模式：${mode}`);
	return adapter;
}

/** 该模式在当前能力下是否可用（例如 handoff 需要桌面 shell）。 */
export function browserAdapterAvailable(mode, { desktopShell = false } = {}) {
	const adapter = browserAdapter(mode);
	if (!adapter.requiresDesktopShell) return true;
	return Boolean(desktopShell);
}

/** 描述符摘要，供 doctor / 诊断输出。 */
export function describeBrowserAdapters({ desktopShell = false } = {}) {
	return BROWSER_MODES.map((mode) => {
		const adapter = browserAdapter(mode);
		return { ...adapter, available: browserAdapterAvailable(mode, { desktopShell }) };
	});
}
