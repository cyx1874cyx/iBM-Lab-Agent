import { h, registerProjectPanel } from "dsh-lab-agent/client-sdk";
import { LitPanel } from "./lit-panel.js";
import { registerReaderTab } from "./reader/reader-tab.js";

// 阅读器需要右侧栏与服务插槽；不声明 inject 时访问 ctx 服务会直接抛错。
export const inject = ["remote", "sidebarRightTabs", "slots"];

export function apply(ctx) {
	const disposePanel = registerProjectPanel({
		id: "literature",
		label: "文献资料",
		render: props => h(LitPanel, props)
	});
	try {
		registerReaderTab(ctx);
	} catch (error) {
		console.error("[iBM Lab] reader tab registration failed", error);
	}
	return () => disposePanel();
}
