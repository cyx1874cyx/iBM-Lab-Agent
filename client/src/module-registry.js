/**
 * 工作台模块注册表（跨客户端 bundle 的最小约定）。
 *
 * 为什么用 globalThis 而不是新建 Cordis 客户端服务：DSH 的每个 client 包都是
 * 独立 bundle（`__ModuleLoader__.load({ id, factory })`），加载顺序由宿主决定。
 * 注册表必须在"任何 bundle 先于母包加载"时也能工作，因此用惰性创建的全局对象，
 * 键为固定 Symbol —— 与模块缓存、HMR 重载都兼容，也不会重复建表。
 *
 * 插件客户端入口（各自 bundle）：
 *   import { registerWorkbenchModule } from "dsh-lab-agent/client-sdk";
 *   export const inject = ["remote"];
 *   export function apply() {
 *     return registerWorkbenchModule({ id: "reagents", label: "试剂管理", icon: "flask",
 *       caption: "…", render: ({ call, project }) => … });
 *   }
 * `apply` 返回的清理函数由宿主在停用插件时调用，注册项随之移除。
 *
 * 约束（保持与现有 WORKBENCH_MODULES 同构）：
 *   - id 全局唯一；重复注册视为"替换"，不报错（便于 HMR / 版本升级）；
 *   - label、render 必填；icon 可选，未知图标按默认文件图标渲染；
 *   - render 是 React 组件函数，由母包用 `h(Component, props)` 渲染。
 */

const REGISTRY_KEY = Symbol.for("ibm.lab.workbench");

import { isPluginEnabled } from "./plugin-switches.js";

function store() {
	const existing = globalThis[REGISTRY_KEY];
	if (existing !== undefined) return existing;
	const created = { modules: new Map(), listeners: new Set() };
	globalThis[REGISTRY_KEY] = created;
	return created;
}

function notify(state) {
	for (const listener of [...state.listeners]) {
		try { listener(); } catch { /* 一个插件监听器出错不影响其它插件 */ }
	}
}

/**
 * 注册一个工作台模块。返回幂等的注销函数。
 *
 * `override: true` 表示该模块接管同名内置页面（迁移期用：插件装上后替代母包里的
 * 硬编码页面；插件缺席时母包页面照常工作）。默认 false，插件不会意外顶掉核心页面。
 * @param {{ id: string, label: string, caption?: string, icon?: string, render: Function, order?: number, override?: boolean }} module
 */
export function registerWorkbenchModule(module) {
	if (module === null || typeof module !== "object") throw new TypeError("工作台模块必须是对象");
	if (typeof module.id !== "string" || module.id.length === 0) throw new TypeError("工作台模块缺少 id");
	if (typeof module.label !== "string" || module.label.length === 0) throw new TypeError(`工作台模块 ${module.id} 缺少 label`);
	if (typeof module.render !== "function") throw new TypeError(`工作台模块 ${module.id} 缺少 render 组件`);
	const state = store();
	const row = Object.freeze({ caption: "", icon: "file", order: 100, override: false, ...module });
	state.modules.set(row.id, row);
	notify(state);
	return () => {
		if (state.modules.get(module.id)?.label === row.label && state.modules.get(module.id)?.render === row.render) {
			state.modules.delete(module.id);
			notify(state);
		}
	};
}

/** 当前已注册且未被软停用的插件模块，按 order、label 排序。 */
export function listWorkbenchModules() {
	return [...store().modules.values()]
		.filter(row => isPluginEnabled(row.pluginId ?? row.id))
		.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label, "zh-CN"));
}

/** 订阅注册表变化；返回取消订阅函数。 */
export function subscribeWorkbenchModules(listener) {
	if (typeof listener !== "function") throw new TypeError("listener 必须是函数");
	const state = store();
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}
