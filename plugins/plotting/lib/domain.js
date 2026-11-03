/**
 * 绘图任务自有域：`lab_plot_tasks`。
 *
 * 与核磁共用过历史 `lab_characterization.tasks`；拆分后绘图任务只写本域，
 * 旧表中 kind=plot 的行由母插件推送迁移（旧行保留只读）。
 */
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { taskSchema } from "dsh-lab-agent/characterization-schema";

export const plotTaskDomain = defineDomain({
	name: "lab_plot_tasks",
	version: 0,
	tables: { tasks: domainTable(taskSchema) }
});
