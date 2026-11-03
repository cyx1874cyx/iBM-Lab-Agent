/**
 * RAG 知识库子插件的前端入口（独立 bundle）。
 *
 * 页面、样式、交互全部在本包内；母包只负责提供工作台容器与
 * openChat / conversation / headerTarget 这类宿主插槽。
 */
import { h, registerWorkbenchModule, injectStyle } from "dsh-lab-agent/client-sdk";
import { KnowledgePanel } from "./panel.js";
import { knowledgeCss } from "./knowledge.css.js";

export const inject = ["remote"];

export function apply() {
	const disposeStyle = injectStyle("ibm-lab-knowledge-style", knowledgeCss);
	const disposeModule = registerWorkbenchModule({
		id: "knowledge",
		label: "RAG 知识库",
		icon: "layers",
		caption: "基于知识库资料回答，支持连续追问与来源核对",
		order: 20,
		override: true,
		render: props => h(KnowledgePanel, props)
	});
	return () => {
		disposeModule();
		disposeStyle();
	};
}
