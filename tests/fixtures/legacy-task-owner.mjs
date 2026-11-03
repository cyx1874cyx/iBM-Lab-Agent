/**
 * 测试夹具：模拟"历史任务所有者"（旧 characterization 服务）。
 *
 * 只暴露插件迁移所需的公开能力 `allTasks()`，用来验证两个插件
 * 各自认领自己 kind 的行，而不把测试绑在旧服务的存储实现上。
 */
import { Service } from "@deepseek-ai/cordis";

export const PROJECT_ID = "compose-project";

const BASE = {
	projectId: PROJECT_ID,
	date: "2026-11-01",
	instructions: "装配验收",
	inputPath: "legacy-input.nmova",
	attempt: 1,
	artifacts: {},
	artifactHistory: [],
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z"
};

export const LEGACY_ROWS = [
	{ ...BASE, id: "legacy-nmr-c", kind: "nmr", title: "历史核磁", status: "failed" },
	{ ...BASE, id: "legacy-plot-c", kind: "plot", title: "历史绘图", status: "failed" }
];

export class LegacyTaskOwner extends Service {
	constructor(ctx) {
		super(ctx, "labCharacterization");
	}

	allTasks() {
		return LEGACY_ROWS.map(row => ({ ...row }));
	}
}

export default LegacyTaskOwner;
