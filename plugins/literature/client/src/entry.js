/**
 * 文献阅读子插件的前端入口（独立 bundle）。
 *
 * 接管课题页「文献资料」页签；插件缺席时母包仍用内置 LitPanel。
 * 页面、检索/精读列表、捕获状态全部在本包内，只从 client-sdk 复用宿主能力。
 */
import { h, registerProjectPanel } from "dsh-lab-agent/client-sdk";
import { LitPanel } from "./lit-panel.js";

export const inject = ["remote"];

export function apply() {
	return registerProjectPanel({
		id: "literature",
		label: "文献资料",
		render: props => h(LitPanel, props)
	});
}
