import { z } from "zod";
import { PROFILE_ID_RE } from "./goal-profile.js";
export const taskSchema = z.object({
  id: z.string().regex(PROFILE_ID_RE),
  projectId: z.string().regex(PROFILE_ID_RE),
  kind: z.enum(["nmr", "plot"]),
  title: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputPath: z.string().min(1),
  structurePath: z.string().min(1).optional(),
  structureSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  instructions: z.string().trim().min(1),
  compound: z.object({ name: z.string(), smiles: z.string().optional(), casNumber: z.string().optional() }).optional(),
  nucleus: z.string().optional(),
  deuteratedSolvent: z.string().optional(),
  status: z.enum(["queued", "running", "completed", "failed"]).default("queued"),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  attempt: z.number().int().positive().default(1),
  assessment: z.object({
    verdict: z.enum(["match", "mismatch", "inconclusive"]),
    confidence: z.enum(["high", "medium", "low"]),
    summary: z.string().trim().min(1)
  }).optional(),
  artifacts: z.record(z.string(), z.object({ path: z.string(), fileName: z.string(), sha256: z.string(), byteLength: z.number() })).default({}),
  artifactHistory: z.array(z.object({ revision: z.number().int().positive(), archivedAt: z.string(), artifacts: z.record(z.string(), z.object({ path: z.string(), fileName: z.string(), sha256: z.string(), byteLength: z.number() })), assessment: z.object({ verdict: z.enum(["match", "mismatch", "inconclusive"]), confidence: z.enum(["high", "medium", "low"]), summary: z.string() }).optional() })).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});
export function taskPrompt(task) {
  return `执行${task.kind === "nmr" ? "核磁分析（使用 Mnova）" : "科研绘图（使用 Origin）"}任务。
课题：${task.projectId}
任务 ID：${task.id}；尝试：${task.attempt}
输入：${task.inputPath}
${task.kind === "nmr" ? `结构文件：${task.structurePath || "缺失"}\n结构 SHA-256：${task.structureSha256 || "待计算"}` : ""}
主题：${task.title}
日期：${task.date}
要求：${task.instructions}
化合物：${JSON.stringify(task.compound || {})}
谱核：${task.nucleus || "1H"}；氘代溶剂：${task.deuteratedSolvent || "未提供"}
${task.kind === "nmr" ? "先调用 lab_characterization_preflight(taskId)；采用它确认的 Python、数据形状、厂商元数据、FID 路径和结构文件路径。随后必须调用 mnova_prepare_structure_1d，同时传入 FID 与结构文件；每次 prepare 后只使用本次返回的真实原子索引、multiplet UUID 和谱图证据重建 assignment-plan，禁止复用旧计划。再调用 mnova_apply_assignments_1d 把标峰写入新的 .mnova 文件。不要只处理 FID 或只生成报告。若独立处理轴与 Mnova 不一致，使用多个对应峰做线性回归核验斜率、截距和残差，不要反复试缩放系数，也不要把本次数据拟合出的系数固化为通用规则。" : ""}
再调用 lab_characterization_update(taskId, attempt, status=running)。保留原始数据；科学审核与任务执行状态分离。${task.kind === "nmr" ? "生成 Mnova 可编辑谱图文档 .mnova 和核磁报告 .md 或 .docx；complete 接收 Markdown 时会自动生成 DOCX。保存前目视检查标签位置与颜色，无法查看图像时明确标记 visual QA 未完成。综合目标峰、缺失峰、额外峰、积分、多重性与 Verify 警告，给出 verdict=match/mismatch/inconclusive、confidence=high/medium/low 及一句 summary；这里的 confidence 表示结构判断把握度，不是任务进度。Mnova 返回 SMILES/名称后，在 complete 中传入 compound，以补全归档身份信息。" : "保存可编辑 Origin 项目 .opju（不能只交 PNG、PDF 或脚本）。"}产物可直接传课题目录或 Mnova 工作区内路径，系统会自动归档。结束必须调用 lab_characterization_complete(taskId, attempt, spectrumPath/reportPath 或 originPath)，成功回填后才能报告完成；已完成任务返工后调用 lab_characterization_recomplete 并保留旧版本。若工具返回 ok=false，先按 error 修复，禁止把调用失败当作已登记。失败调用 lab_characterization_update(status=failed, error)，不要伪造产物。`;
}
