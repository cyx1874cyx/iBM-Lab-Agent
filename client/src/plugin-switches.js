/**
 * 子插件软启停开关（客户端）。
 *
 * 语义：软启停只影响"入口与面板是否可见"，插件服务仍驻留；硬启停要改 profile
 * 并重启（见设置页说明）。开关保存在本机 localStorage，重启后保持。
 *
 * 注册表（工作台模块 / 课题页签）读取 `isPluginEnabled` 过滤；组件用
 * `plugin-switch-hook.js` 里的 `usePluginSwitches` 订阅变化，切换后立即重渲染。
 */
const STORAGE_KEY = "ibm-lab:plugin-soft";

function load() {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
		return parsed !== null && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

let state = load();
const listeners = new Set();

function persist() {
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch { /* 隐私模式或存储不可用时只保留内存态 */ }
}

function notify() {
	for (const listener of [...listeners]) {
		try { listener(); } catch { /* 单个订阅者出错不影响其它 */ }
	}
}

/** 子插件是否处于软启用状态（默认启用）。 */
export function isPluginEnabled(id) {
	return state[id] !== false;
}

/** 当前全部软开关状态（诊断/设置页用）。 */
export function pluginSoftStates() {
	return { ...state };
}

/** 设置软开关；`enabled=false` 表示立即隐藏该插件的入口与面板。 */
export function setPluginEnabled(id, enabled) {
	state = { ...state, [id]: enabled !== false };
	persist();
	notify();
}

/** 用宿主返回的状态覆盖本地（设置页加载时调用）。 */
export function hydratePluginSwitches(plugins) {
	if (!Array.isArray(plugins)) return;
	state = Object.fromEntries(plugins.map(plugin => [plugin.id, plugin.soft !== false]));
	persist();
	notify();
}

/** 订阅软开关变化。 */
export function subscribePluginSwitches(listener) {
	if (typeof listener !== "function") throw new TypeError("listener 必须是函数");
	listeners.add(listener);
	return () => listeners.delete(listener);
}
