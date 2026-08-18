/**
 * dsh-lab-agent: NMR 数据集模型（纯逻辑层）。
 *
 * 计划 §五：保留"准备—人工审核—写回—视觉质检"两阶段流程；
 * 原始 FID、结构和已审核积分计划不得覆盖（不可变保护）。
 *
 * 状态机：prepared → under-review → approved-written → visually-verified
 *   prepared        登记原始 FID/结构（此后路径不可变）
 *   under-review    草稿积分计划待人工审核
 *   approved-written 积分计划审核通过并冻结（不可覆盖）；写回 Mnova
 *   visually-verified 人工视觉质检完成
 * 审核通过后的积分计划（approvedIntegrals）不可变；修正走新版本行（新 dataset）
 * 或显式 reopenReview（拒绝覆盖既有已审核计划）。
 */

import { z } from "zod";
import { PROFILE_ID_RE } from "../goal-profile.js";

export const NMR_STATUSES = ["prepared", "under-review", "approved-written", "visually-verified"];
export const NMR_TRANSITIONS = {
	prepared: ["under-review"],
	"under-review": ["prepared", "approved-written"], // 打回修正 → prepared（积分计划重拟）
	"approved-written": ["visually-verified", "prepared"], // 视觉质检 / 打回重积分
	"visually-verified": ["prepared"] // 复核发现问题 → 打回重积分
};

export function canTransitNmr(from, to) {
	return (NMR_TRANSITIONS[from] ?? []).includes(to);
}

/** 一条已审核积分：峰位、质子数、归属与来源。 */
export const integralSchema = z.object({
	peak: z.string().min(1), // 峰标识（ppm 或 label）
	ppm: z.number().optional(),
	integral: z.number().positive(),
	protons: z.number().positive(),
	assignment: z.string().min(1),
	notes: z.string().optional()
});

export const nmrDatasetSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	/** 所属课题；旧数据可不关联。 */
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	name: z.string().min(1),
	/** 原始 FID/谱图路径（登记后不可变）。 */
	fidPath: z.string().min(1),
	/** 结构文件路径（登记后不可变）。 */
	structurePath: z.string().optional(),
	/** 谱类型（1H/13C/2D...）。 */
	nucleus: z.string().default("1H"),
	/** 溶剂。 */
	solvent: z.string().optional(),
	/** 待审核积分计划（under-review 阶段可修改）。 */
	draftIntegrals: z.array(integralSchema).default([]),
	/** 已审核积分计划（审核通过后冻结，不可覆盖）。 */
	approvedIntegrals: z.array(integralSchema).default([]),
	/** 计算结果（composition/conversion/DP/DS/DL 等）。 */
	results: z.record(z.string(), z.unknown()).default({}),
	/** 写回 Mnova 的记录。 */
	writeBack: z
		.object({ at: z.string().optional(), note: z.string().optional() })
		.default({}),
	/** 视觉质检记录。 */
	visualCheck: z
		.object({ at: z.string().optional(), note: z.string().optional() })
		.default({}),
	status: z.enum(NMR_STATUSES).default("prepared"),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 不可变字段：登记后不得修改（原始 FID/结构）。 */
export const IMMUTABLE_FIELDS = ["fidPath", "structurePath", "createdAt"];
