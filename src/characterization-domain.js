/**
 * 历史 `lab_characterization` 域定义（核磁与绘图共用的旧任务表）。
 *
 * 放在 src/ 是为了让核磁、绘图两个子插件都能以**公开导出**打开同一份旧域做一次性迁移，
 * 而不必 import 母包的 characterization 服务实现。
 *
 * 新数据不再写入这张表：核磁进 `lab_nmr.tasks`，绘图进 `lab_plot.tasks`。
 * 旧表在迁移完成后保留只读一版，便于回滚与历史查看。
 */
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { taskSchema } from "./characterization.js";

export const characterizationDomain = defineDomain({
	name: "lab_characterization",
	version: 0,
	tables: { tasks: domainTable(taskSchema) }
});
