/**
 * 论文润色子插件的前端入口（独立 bundle）。
 *
 * 用 override:true 接管母包里同名的占位页：插件缺席时母包仍显示占位，
 * 插件装上后由本包渲染，后续替换渲染实现即可升级为真实功能。
 */
import { h, registerWorkbenchModule } from "dsh-lab-agent/client-sdk";
import { PolishingPanel } from "./panel.js";

export const inject = ["remote"];

export function apply() {
	return registerWorkbenchModule({
		id: "polishing",
		label: "论文润色",
		icon: "pen",
		caption: "功能规划中",
		order: 60,
		override: true,
		render: () => h(PolishingPanel)
	});
}
