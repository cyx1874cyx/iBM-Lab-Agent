/**
 * 宿主任务工具入口（兼容壳）。
 *
 * 文献领域工具已迁入 `@ibm-lab/literature`（plugins/literature/lib/tools.js）；
 * 这里只保留两项跨模块能力：
 *   - `lab_research_read`：只读查询各业务模块，属于宿主；
 *   - 知识库问答助手装配：按 labKnowledge 是否存在决定是否生效。
 */
import { registerResearchReadTool } from "./research-read.js";
import { installKnowledgeAssistant } from "./knowledge-assistant.js";

export const name = "tasks-tool";
export const inject = ["tools", "ibmCore"];

export function apply(ctx) {
	registerResearchReadTool(ctx);
	installKnowledgeAssistant(ctx);
}
