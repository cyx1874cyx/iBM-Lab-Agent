/**
 * 核磁任务自有域：`lab_nmr_tasks`。
 *
 * 注意不要用 `lab_nmr`：那是母包核磁数据集（时域/积分）已占用的域名。
 * 本域只存"任务"（草稿、状态、产物引用），与数据集域并列、互不覆盖。
 */
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { taskSchema } from "dsh-lab-agent/characterization-schema";

export const nmrTaskDomain = defineDomain({
	name: "lab_nmr_tasks",
	version: 0,
	tables: { tasks: domainTable(taskSchema) }
});
