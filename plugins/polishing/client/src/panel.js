import { h } from "dsh-lab-agent/client-sdk";

/**
 * 论文润色占位页。
 *
 * 只陈述现状与计划，不提供输入框、不调用任何接口，避免让用户以为功能可用。
 */
export function PolishingPanel() {
	return h("section", { className: "ib-wb-writing", "aria-label": "论文润色" },
		h("h2", null, "论文润色"),
		h("p", null, "此功能正在规划中，暂不可用。"),
		h("p", null, "规划中的能力：选中文本改写、期刊风格检查、修改前后对照、结果归档到课题工作区。"),
		h("p", null, "当前不会读取或修改你的稿件；已保存的润色草稿仍可在项目「草稿」目录查看。"));
}
