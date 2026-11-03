/**
 * 论文润色子插件（占位实现）。
 *
 * 本轮只提供"可安装、可停用、可解释"的占位能力：不注册任何润色执行工具，
 * 不读写草稿，不产生虚假结果。真实能力落地时替换 status() 与页面即可。
 */
import { Service } from "@deepseek-ai/cordis";

export const POLISHING_STATUS = Object.freeze({
	implemented: false,
	label: "论文润色",
	reason: "论文润色尚未实现；当前只提供入口占位。",
	planned: [
		"选中文本 → 学术表达改写（保留原意与引用）",
		"按期刊风格检查术语与时态",
		"修改前后对照与逐句采纳",
		"结果写入课题工作区「润色」目录并登记产物"
	]
});

/** 纯函数，便于独立测试与宿主诊断。 */
export function polishingStatus() {
	return { ...POLISHING_STATUS, planned: [...POLISHING_STATUS.planned] };
}

export class LabPolishingService extends Service {
	static inject = [];

	constructor(ctx, config = {}) {
		super(ctx, "labPolishing");
		this.config = config ?? {};
	}

	status() {
		return polishingStatus();
	}
}

export default LabPolishingService;
