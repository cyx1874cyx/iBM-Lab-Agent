/**
 * dsh-lab-agent: 平台能力声明 —— 把散落的隐式平台假设收敛为显式、可测的判据。
 *
 * 背景：同一条代码路径要在三种形态下运行，但此前靠「隐式假设」区分，导致在
 * 非预期形态上静默走错分支：
 *
 *   形态① 即插即用（Linux 服务端/源码安装，`install.sh` + `bin/ibm-lab-agent`）
 *   形态② 桌面端（Windows Tauri 客户端，packaged runtime）
 *   形态③ 纯 Web（直接把插件挂到既有 DSH profile）
 *
 * 本模块只声明**能从环境同步判定**的能力。需要异步探测的（如 LibreOffice
 * `soffice` 是否可用）不放在这里，避免把"声明能力"变成"启动时做 IO"。
 *
 * 用法（宿主代码）：
 *   import { defaultBrowserMode, isDesktopShell } from "./capabilities.js";
 *
 * 用法（cordis 组合的 !!js 表达式，见 cordis.patch.yml 的 lab-literature-sources）：
 *   browserMode: !!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON'] ? 'desktop-edge-handoff' : 'web-current'
 *   ↑ 组合期无法 import 本模块，故该表达式必须与 defaultBrowserMode() 保持同一判据；
 *     两边都由 tests/unit/capabilities.test.mjs 的同一组用例约束。
 */

/**
 * 桌面封装环境的判据。Tauri 启动 DSH 子进程时设置该变量
 * （desktop/src-tauri/src/runtime/process.rs:208），并且它已经是本仓库既有的
 * "是否桌面打包环境" 判据（同 dsh.rs 生成 MCP patch 时的
 * `!!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']`）。
 *
 * 不能改用 IBM_LAB_AGENT_WORKSPACE：bin/ibm-lab-agent:23 会把它默认成 $HOME，
 * 在 Linux 形态上也为真，会误判为桌面环境。
 */
export const DESKTOP_SHELL_ENV = "IBM_LAB_AGENT_BUNDLED_PYTHON";

/** 桌面端默认：外部 Edge 承担登录/下载，经 capture handoff 回传。 */
export const BROWSER_MODE_DESKTOP_HANDOFF = "desktop-edge-handoff";

/** 非桌面形态默认：传统 DSH Web 运行在真实浏览器，复用当前标签页。 */
export const BROWSER_MODE_WEB_CURRENT = "web-current";

/** 独立 Edge profile + CDP：可自动定位页面（服务端亦可行）。 */
export const BROWSER_MODE_MANAGED_EDGE = "managed-edge";

/**
 * 受支持的浏览器模式全集。由上面的常量派生，避免「加了常量却忘了登记」的漂移；
 * 语义/能力矩阵在 lib/adapters/browser.js。
 */
export const BROWSER_MODES = [
	BROWSER_MODE_WEB_CURRENT,
	BROWSER_MODE_MANAGED_EDGE,
	BROWSER_MODE_DESKTOP_HANDOFF
];

/** 是否运行在桌面封装环境（Tauri 客户端）。 */
export function isDesktopShell(env = process.env) {
	return Boolean(env?.[DESKTOP_SHELL_ENV]);
}

/** 桌面封装环境注入的捆绑 Python 路径（未注入时为 undefined）。 */
export function bundledPythonFromEnv(env = process.env) {
	return env?.[DESKTOP_SHELL_ENV] || undefined;
}

/**
 * 默认浏览器模式：
 *   - 桌面封装环境 → desktop-edge-handoff（有外部 Edge + 扩展 + Native Messaging 回传链）
 *   - 其它形态     → web-current（没有那条回传链，回落 managed-edge 会去启动不存在的 Edge）
 */
export function defaultBrowserMode(env = process.env) {
	return isDesktopShell(env) ? BROWSER_MODE_DESKTOP_HANDOFF : BROWSER_MODE_WEB_CURRENT;
}

/** 聚合描述，供 doctor / 诊断面板一屏展示。只读，不做任何 IO。 */
export function describeCapabilities({ env = process.env, platform = process.platform } = {}) {
	const desktopShell = isDesktopShell(env);
	return {
		platform,
		desktopShell,
		bundledPython: bundledPythonFromEnv(env) ?? null,
		defaultBrowserMode: defaultBrowserMode(env),
		// 形态判定：桌面端需要窗口客户端承载 WebVPN 子 WebView 与 Edge 回传链。
		form: desktopShell ? "desktop" : "server"
	};
}
