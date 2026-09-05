import { z } from "zod";
import { PROFILE_ID_RE } from "../goal-profile.js";

/** 绘图登记（0.4.0）：课题内成图/表征图的登记簿。 */
export const plotRecordSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	projectId: z.string().regex(PROFILE_ID_RE).optional(),
	/** 主题：默认可从文件/任务推导，允许手工修改。 */
	topic: z.string().min(1),
	/** 日期：默认本地创建日期，允许修改为实验或成图日期（YYYY-MM-DD）。 */
	date: z.string().min(1),
	artifactPath: z.string().optional(),
	source: z.string().default("manual"),
	notes: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

export function todayLocal() {
	return new Date().toISOString().slice(0, 10);
}
