import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";
export const taskSchema = z.object({
  id: z.string().regex(PROFILE_ID_RE),
  projectId: z.string().regex(PROFILE_ID_RE),
  kind: z.enum(["nmr", "plot"]),
  title: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputPath: z.string().min(1),
  instructions: z.string().trim().min(1),
  compound: z.object({ name: z.string(), smiles: z.string().optional(), casNumber: z.string().optional() }).optional(),
  nucleus: z.string().optional(),
  deuteratedSolvent: z.string().optional(),
  status: z.enum(["queued", "running", "completed", "failed"]).default("queued"),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  attempt: z.number().int().positive().default(1),
  artifacts: z.record(z.string(), z.object({ path: z.string(), fileName: z.string(), sha256: z.string(), byteLength: z.number() })).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
});
export function taskPrompt(task) {
  return `执行${task.kind === "nmr" ? "核磁分析（使用 Mnova）" : "科研绘图（使用 Origin）"}任务。
课题：${task.projectId}
任务 ID：${task.id}；尝试：${task.attempt}
输入：${task.inputPath}
主题：${task.title}
日期：${task.date}
要求：${task.instructions}
化合物：${JSON.stringify(task.compound || {})}
谱核：${task.nucleus || "1H"}；氘代溶剂：${task.deuteratedSolvent || "未提供"}
先调用 lab_characterization_update(taskId, attempt, status=running)。保留原始数据；科学审核与任务执行状态分离。${task.kind === "nmr" ? "生成 Mnova 可编辑谱图文档 .mnova 和 Word 报告 .docx。" : "保存可编辑 Origin 项目 .opju（不能只交 PNG、PDF 或脚本）。"}产物存入本课题工作目录。结束必须调用 lab_characterization_complete(taskId, attempt, spectrumPath/reportPath 或 originPath)，成功回填后才能报告完成。失败调用 lab_characterization_update(status=failed, error)，不要伪造产物。`;
}
