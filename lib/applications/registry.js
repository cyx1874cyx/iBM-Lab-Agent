/**
 * dsh-lab-agent: 外部应用注册表（跨形态）。
 *
 * 原型是 desktop/src-tauri/src/runtime/mcp.rs 的 `MCP_APPS` 静态表 + `spec_for()`。
 * 那里已经有一条**必须保留的安全设计**（原文注释）：
 *
 *   「启动类型由 app_key 决定（McpAppSpec），不写入用户配置，避免任意 executable
 *     被 MCP manager 启动。」
 *
 * 本模块把同一张表提升到跨形态的 JS 侧，并补上 `availableOn`，使「服务端形态自动
 * 不提供 Mnova / Origin」成为**数据**而不是散落各处的条件分支。
 *
 * 安全约束（对应路线书 3.4 验收③）：
 *   - 启动方式（launch.kind / launch.module / 可执行文件）**只**由本表决定；
 *   - applicationSpec() 只接受 appKey，不读取任何用户配置来覆盖启动方式；
 *   - 表与每个条目都在加载期冻结，运行期不可改写。
 *   也就是说：用户/客户端能做的只是「启用或不启用」，不能改变「用什么启动」。
 *
 * 与 Rust 侧的同步：本表与 MCP_APPS 必须逐项一致，由
 * tests/unit/applications-registry.test.mjs 直接解析 mcp.rs 源码比对（漂移即失败）。
 */

import { describeCapabilities } from "../capabilities.js";

/** 启动方式枚举。当前只有 bundled Python 模块型（0.2.0 起 Origin/Mnova 均走它）。 */
export const APPLICATION_LAUNCH_KINDS = Object.freeze({
	/** <bundled-python> -m <module> */
	BUNDLED_PYTHON_MODULE: "bundled-python-module"
});

/**
 * 应用规格表。字段与 mcp.rs::McpAppSpec 对齐，另加 availableOn / label / notes。
 *   appKey            稳定键（对应 Rust 的 app_key，也是 mcp__<serverName>__* 的来源）
 *   serverName        MCP server 名（模型侧工具前缀）
 *   requiresDirectory 是否需要一个工作目录参数
 *   launch            启动方式（安全关键，见文件头）
 *   availableOn       哪些形态可用：desktop（Windows Tauri 客户端）
 */
export const APPLICATIONS = Object.freeze([
	Object.freeze({
		appKey: "mnova",
		serverName: "mnova",
		requiresDirectory: false,
		launch: Object.freeze({
			kind: APPLICATION_LAUNCH_KINDS.BUNDLED_PYTHON_MODULE,
			module: "mnova_mcp"
		}),
		// Mnova 的 GUI/Verify 工作流需要本机安装并授权的 MestReNova，且其
		// bundled Python 由桌面运行时注入；服务端形态没有这条链。
		availableOn: Object.freeze(["desktop"]),
		label: "MestReNova（NMR）",
		notes: "需要本机已安装并授权的 MestReNova；文件型 NMR 分析不依赖它。"
	}),
	Object.freeze({
		appKey: "origin",
		serverName: "origin",
		requiresDirectory: false,
		launch: Object.freeze({
			kind: APPLICATION_LAUNCH_KINDS.BUNDLED_PYTHON_MODULE,
			module: "origin_mcp"
		}),
		// Origin 是 Windows 桌面软件，且 bundled Python 由桌面运行时注入。
		availableOn: Object.freeze(["desktop"]),
		label: "Origin（绘图）",
		notes: "需要本机已安装 Origin。"
	})
]);

/** app_key → 规格。未知键抛错（不静默返回 undefined，避免把错配置当可用）。 */
export function applicationSpec(appKey) {
	const spec = APPLICATIONS.find((entry) => entry.appKey === appKey);
	if (!spec) throw new Error(`未知的外部应用：${appKey}`);
	return spec;
}

/** 某个形态下可用的应用。form 取 lib/capabilities.js 的 "desktop" | "server"。 */
export function applicationsFor(form) {
	return APPLICATIONS.filter((spec) => spec.availableOn.includes(form));
}

/** 诊断用汇总：两种形态各自可用的应用 + 为什么不可用。 */
export function describeApplications({ form = describeCapabilities().form } = {}) {
	return {
		form,
		available: applicationsFor(form).map((spec) => ({
			appKey: spec.appKey,
			serverName: spec.serverName,
			label: spec.label,
			launch: { ...spec.launch }
		})),
		unavailable: APPLICATIONS.filter((spec) => !spec.availableOn.includes(form)).map((spec) => ({
			appKey: spec.appKey,
			label: spec.label,
			reason: `仅在这些形态可用：${spec.availableOn.join(", ")}`
		}))
	};
}
