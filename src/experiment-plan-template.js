import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";

export const experimentPlanTemplateSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	version: z.string().regex(/^\d+$/),
	name: z.string().min(1),
	applicableTo: z.string().default("通用有机/高分子合成"),
	sections: z.array(z.string().min(1)).default(["实验目的", "试剂与用量", "操作步骤", "后处理与纯化", "表征", "安全与废弃物"]),
	requiredFields: z.array(z.string()).default(["反应物", "试剂", "溶剂", "温度", "时间"]),
	safetyRequirements: z.array(z.string()).default(["标注危险试剂、个人防护和废弃物处置"]),
	notes: z.string().optional(),
	status: z.enum(["active", "archived"]).default("active"),
	createdAt: z.string(),
	updatedAt: z.string()
});

export const experimentPlanTemplateKey = (id, version) => `${id}@${version}`;

export function defaultExperimentPlanTemplate(now = new Date().toISOString()) {
	return experimentPlanTemplateSchema.parse({
		id: "experiment-plan-default", version: "1", name: "课题组实验计划模板（默认）",
		applicableTo: "小分子与高分子合成步骤",
		sections: ["实验目的", "试剂与用量", "反应装置与气氛", "操作步骤", "后处理与纯化", "表征与质控", "安全与废弃物"],
		requiredFields: ["反应物", "试剂/催化剂", "溶剂", "温度", "时间", "后处理", "纯化"],
		safetyRequirements: ["列明易燃、腐蚀、毒性或压强风险", "列明个人防护、通风和废弃物处置"],
		status: "active", createdAt: now, updatedAt: now
	});
}
