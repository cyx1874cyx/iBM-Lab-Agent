/**
 * 项目页签面板注册表（跨客户端 bundle）。
 *
 * 课题页有四个固定页签：文献资料 / 研究设计 / 核磁解析 / 科研绘图。
 * 子插件通过本注册表接管某个页签的内容；插件缺席时母包继续用内置面板，
 * 因此停用插件不会让课题页空白，只是回到内置实现。
 *
 * 约定：`render` 是 React 组件函数，接收母包计算的同一组 props
 * （projectId、call、onOpenConversation、headerTarget 等），插件不应假设更多。
 */

const REGISTRY_KEY = Symbol.for("ibm.lab.project-panels");

import { isPluginEnabled } from "./plugin-switches.js";

function store() {
	const existing = globalThis[REGISTRY_KEY];
	if (existing !== undefined) return existing;
	const created = { panels: new Map() };
	globalThis[REGISTRY_KEY] = created;
	return created;
}

/**
 * @param {{ id: string, label?: string, render: Function }} panel
 * @returns {() => void} 注销函数（幂等；旧注销不会移除新版本）
 */
export function registerProjectPanel(panel) {
	if (panel === null || typeof panel !== "object") throw new TypeError("项目面板必须是对象");
	if (typeof panel.id !== "string" || panel.id.length === 0) throw new TypeError("项目面板缺少 id");
	if (typeof panel.render !== "function") throw new TypeError(`项目面板 ${panel.id} 缺少 render 组件`);
	const state = store();
	const row = Object.freeze({ label: undefined, ...panel });
	state.panels.set(row.id, row);
	return () => {
		const current = state.panels.get(row.id);
		if (current?.render === row.render) state.panels.delete(row.id);
	};
}

/** 取某个页签的插件面板；未注册或该插件被软停用时返回 undefined（回退内置面板）。 */
export function projectPanelFor(id) {
	const row = store().panels.get(id);
	if (row === undefined) return undefined;
	if (!isPluginEnabled(row.pluginId ?? row.id)) return undefined;
	return row;
}

/** 当前注册的全部面板（测试/诊断用）。 */
export function listProjectPanels() {
	return [...store().panels.values()];
}
