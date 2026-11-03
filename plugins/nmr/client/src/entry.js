/**
 * 核磁解析子插件的前端入口（独立 bundle）。
 *
 * 接管课题页「核磁解析」页签；插件缺席时母包仍用内置面板。
 * 面板依赖的通用部件（Ketcher、图标、右键菜单、桌面文件动作）来自 client-sdk。
 */
import { h, registerProjectPanel, injectStyle } from "dsh-lab-agent/client-sdk";
import { NmrPanel } from "./nmr-panel.js";
import { nmrCss } from "./nmr.css.js";

export const inject = ["remote"];

export function apply() {
	const disposeStyle = injectStyle("ibm-lab-nmr-style", nmrCss);
	const disposePanel = registerProjectPanel({
		id: "characterization",
		pluginId: "nmr",
		label: "核磁解析",
		render: props => h(NmrPanel, props)
	});
	return () => {
		disposePanel();
		disposeStyle();
	};
}
