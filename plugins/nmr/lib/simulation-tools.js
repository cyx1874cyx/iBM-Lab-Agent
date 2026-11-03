/**
 * 核磁模拟工具（属于核磁插件）。
 *
 * 只通过本插件持有的任务服务工作；插件未启用时这些工具不会注册。
 * 峰模型与证据要求写在工具描述里，避免模型回退到旧自动预测器。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveToolProjectId } from "dsh-lab-agent/project-context";

const serviceOf = (ctx, taskId) => {
	const service = ctx.root?.get?.("labNmrTasks") ?? ctx.get?.("labNmrTasks");
	if (service === undefined || !service.has(taskId)) {
		const error = new Error("核磁任务插件未就绪");
		error.code = "feature-unavailable";
		throw error;
	}
	return service;
};

export function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "lab_nmr_simulation_structure",
		description: "读取已登记结构，返回 SMILES、MOL 和可区分环境，供科研助手依据证据构建模拟峰模型。",
		parameters: { projectId: { type: "string" }, taskId: { type: "string", required: true }, jobId: { type: "string", required: true } },
		timeoutMs: 120000,
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
		async execute(args, exec) {
			try {
				const resolved = resolveToolProjectId(ctx, args, exec);
				if (resolved.error) throw Error(resolved.error);
				const result = await serviceOf(ctx, args.taskId).simulationStructure(resolved.projectId, args.taskId, args.jobId);
				return { ok: true, formula: result.formula, smiles: result.smiles, molfile: result.molfile, environments: result.environments, parameters: result.parameters };
			} catch (error) { return { ok: false, error: error.message }; }
		}
	}));
	ctx.tools.register(defineTool({
		name: "lab_nmr_simulation_run",
		description: "使用科研助手提供且注明依据的峰模型生成合成 FID，并调用 Mnova 标峰、登记到原条目。",
		parameters: { projectId: { type: "string" }, taskId: { type: "string", required: true }, jobId: { type: "string", required: true }, peakModel: { type: "object", required: true, additionalProperties: false, properties: { provenance: { type: "string", required: true }, peaks: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { environmentId: { type: "string", required: true }, ppm: { type: "number", required: true }, multiplicity: { type: "string", required: true }, jHz: { type: "number", required: true }, extraJHz: { type: "number" }, evidence: { type: "string", required: true } } } } } } },
		timeoutMs: 360000,
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
		async execute(args, exec) {
			try {
				const resolved = resolveToolProjectId(ctx, args, exec);
				if (resolved.error) throw Error(resolved.error);
				const result = await serviceOf(ctx, args.taskId).runSimulation(resolved.projectId, args.taskId, args.jobId, args.peakModel);
				return { ok: true, synthetic: true, taskId: args.taskId, artifact: result.mnovaArtifact, syntheticFidArchive: result.syntheticFidArchive, assignmentSummary: result.assignmentSummary, warnings: result.warnings };
			} catch (error) { return { ok: false, error: error.message }; }
		}
	}));
}

export default apply;
