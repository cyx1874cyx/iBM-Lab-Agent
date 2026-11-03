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

/** 子插件是否启用（默认启用；宿主硬启停状态为准，本地缓存用于首屏）。 */
export function isPluginEnabled(id) {
	return state[id] !== false;
}

/** 当前全部可见性状态（诊断用）。 */
export function pluginSoftStates() {
	return { ...state };
}

/** 本地即时可见性（拖动/增删后立即生效；真正持久化由宿主硬启停负责）。 */
export function setPluginEnabled(id, enabled) {
	state = { ...state, [id]: enabled !== false };
	persist();
	notify();
}

/** 用宿主返回的状态覆盖本地缓存。 */
export function hydratePluginSwitches(plugins) {
	if (!Array.isArray(plugins)) return;
	state = Object.fromEntries(plugins.map(plugin => [plugin.id, plugin.enabled !== false]));
	persist();
	notify();
}

/** 订阅软开关变化。 */
export function subscribePluginSwitches(listener) {
	if (typeof listener !== "function") throw new TypeError("listener 必须是函数");
	listeners.add(listener);
	return () => listeners.delete(listener);
}
