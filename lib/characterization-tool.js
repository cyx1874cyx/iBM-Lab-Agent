import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveToolProjectId } from "./project-context.js";
import { cleanJson } from "../src/json-boundary.js";
export const name = "characterization-tool";
export const inject = ["tools", "labTasks", "labCharacterization"];
export function apply(ctx) {
  for (const action of ["update", "complete"]) {
    ctx.tools.register(defineTool({
      name: `lab_characterization_${action}`,
      description: action === "complete" ? "核磁/Mnova 或 Origin 绘图任务完成后必须调用：验证真实产物并自动回填课题条目，点亮 Mnova/Word/Origin 文件按钮。" : "更新核磁/绘图任务状态为 running 或 failed；失败必须记录原因。",
      parameters: { projectId: { type: "string" }, taskId: { type: "string", required: true }, attempt: { type: "number", required: true }, status: { type: "string" }, error: { type: "string" }, spectrumPath: { type: "string" }, reportPath: { type: "string" }, originPath: { type: "string" } },
      output: { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true }, error: { type: "string" }, taskId: { type: "string" }, status: { type: "string" } } } },
      async execute(args, exec) {
        try {
          const resolved = resolveToolProjectId(ctx, args, exec);
          if (resolved.error) throw new Error(resolved.error);
          const task = await ctx.labCharacterization[action](args.taskId, resolved.projectId, { ...args, sessionId: exec?.agent?.session?.id });
          return cleanJson({ ok: true, taskId: task.id, status: task.status });
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    }));
  }
}
