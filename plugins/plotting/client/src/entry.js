/**
 * 科研绘图子插件的前端入口（独立 bundle）。
 *
 * 接管课题页「科研绘图」页签；插件缺席时母包仍用内置面板。
 * 页面、编辑器、预览、样式全部在本包内，只从 client-sdk 复用通用 UI 部件。
 */
import { h, registerProjectPanel, injectStyle } from "dsh-lab-agent/client-sdk";
import { PlottingPanel } from "./plotting-panel.js";
import { plottingCss } from "./plotting.css.js";

export const inject = ["remote"];

export function apply() {
	const disposeStyle = injectStyle("ibm-lab-plotting-style", plottingCss);
	const disposePanel = registerProjectPanel({
		id: "plotting",
		label: "科研绘图",
		render: props => h(PlottingPanel, props)
	});
	return () => {
		disposePanel();
		disposeStyle();
	};
}
