/**
 * 试剂管理子插件的前端入口（独立 bundle）。
 *
 * 由 scripts/build-plugin-client.mjs 打包成单文件 `client/index.js`，
 * 契约与 DSH 单文件注入一致：`__ModuleLoader__.load({ id, factory })`，
 * 并导出 apply / inject。注册表登记后，工作台自动出现该模块；
 * override:true 表示插件装上后接管母包里同名的内置页面。
 */
import { h, registerWorkbenchModule } from "dsh-lab-agent/client-sdk";
import { ReagentPanel } from "./panel.js";

export const inject = ["remote"];

/** 注册工作台模块；返回的注销函数由宿主在停用插件时调用。 */
export function apply() {
	return registerWorkbenchModule({
		id: "reagents",
		label: "试剂管理",
		icon: "flask",
		caption: "化学试剂、生物试剂与细胞清单检索",
		order: 30,
		override: true,
		render: ({ call }) => h(ReagentPanel, { call })
	});
}
