/**
 * dsh-lab-agent: PPT 模板化构建工具（lab_ppt_templates_contract /
 * lab_ppt_build_from_template）。
 *
 * 与 templates-tool 分开：本模块依赖 labTasks（写入生成契约、执行 python-pptx
 * 构建），而模板查询工具只需要 labNoteTemplates / labTemplates —— 拆开后，
 * 只读模板的组合不必引入整个任务服务。
 *
 * 链路：lab_ppt_templates_contract 落盘「PPT 生成契约」（模板 source.pptx 路径、
 * 版式角色映射、主题、构建命令）→ Agent 用 read 读取并按契约准备 plan.json →
 * lab_ppt_build_from_template 以模板为起点构建成品并产出符合性报告。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { cleanJson } from "../src/json-boundary.js";
import { resolveToolProjectId } from "./project-context.js";

export const name = "ppt-build-tool";
export const inject = ["tools", "labTemplates", "labTasks"];

export function apply(ctx) {
	// PPT 生成契约：落盘模板源文件/映射/主题/构建命令，供 Agent 用 read 读取。
	ctx.tools.register(defineTool({
		name: "lab_ppt_templates_contract",
		description:
			"为某个精读报告生成「PPT 生成契约」文件（模板 source.pptx 路径、版式角色映射、主题字体/主色、最大页数、必选页与强制构建命令），" +
			"返回 contractPath；必须先用 read 读取该文件，再据此准备 plan.json，**先编译**（node scripts/compile-ppt-plan.mjs … --out compiled.json），再调用 lab_ppt_build_from_template 传 compiled.json 构建。" +
			"手写 plan 直接构建的旧路径已移除（它会绕过编译期的必填槽/容量/选版式校验）。" +
			"nature-default 虚拟模板没有源文件，此时返回错误并提示走 nature-paper2ppt 默认流程。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			reportId: { type: "string", required: true, description: "已登记的精读报告 reportId" },
			templateId: { type: "string", description: "可选：PPT 模板 id（缺省 nature-default）" },
			templateVersion: { type: "string", description: "可选：模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					contractPath: { type: "string" },
					templateId: { type: "string" },
					templateVersion: { type: "string" },
					sourcePath: { type: "string" },
					characters: { type: "number" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `PPT 生成契约失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: [
					`PPT 生成契约已写入：${value.contractPath}`,
					`模板：${value.templateId}@${value.templateVersion}`,
					"下一步：用 read 读取该契约（较长时用 offset/limit 分段读完），按契约准备 plan.json，再调用 lab_ppt_build_from_template 构建成品。"
				].join("\n") }];
			}
		},
		timeoutMs: 20000,
		async execute(args, exec) {
			try {
				const resolved = resolveToolProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const contract = await ctx.labTasks.materializePptContract({
					projectId: resolved.projectId,
					reportId: args.reportId,
					templateId: args.templateId ?? "nature-default",
					templateVersion: args.templateVersion ?? "1"
				});
				if (contract === undefined) {
					return { ok: false, error: "该模板没有 source.pptx（nature-default 虚拟模板）：请改用 nature-paper2ppt 默认流程，或先在「模板管理」导入真实 PPTX 模板" };
				}
				return cleanJson({
					ok: true,
					contractPath: contract.contractPath,
					templateId: contract.templateId,
					templateVersion: contract.templateVersion,
					sourcePath: contract.sourcePath,
					characters: contract.characters
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 以模板为起点构建 PPTX（python-pptx + 模板 source.pptx）。
	ctx.tools.register(defineTool({
		name: "lab_ppt_build_from_template",
		description:
			"用导入的 PPT 模板 source.pptx 构建真实 .pptx：读取**编译产物 compiled.json**（由 node scripts/compile-ppt-plan.mjs 从 plan.json 编译而来，含每页角色/槽位填充指令/图片/讲稿），" +
			"按模板版式角色映射填充母版布局，输出成品与模板符合性报告。构建前必须先用 lab_ppt_templates_contract 取契约并 read。" +
			"手写 plan.json 直接构建的旧路径已移除（它会绕过编译期的必填槽/容量/选版式校验）。" +
			"这是「PPT 格式按模板来」的唯一构建路径；不要自己写 python-pptx 从空白 Presentation() 拼版式。",
		parameters: {
			templateId: { type: "string", required: true, description: "PPT 模板 id（lab_ppt_templates_list 返回）" },
			templateVersion: { type: "string", description: "可选：模板版本" },
			compiledPath: { type: "string", required: true, description: "编译产物 compiled.json 的绝对路径（先跑 node scripts/compile-ppt-plan.mjs 生成；不再接受手写 plan.json）" },
			outPath: { type: "string", required: true, description: "成品 .pptx 绝对路径" },
			reportPath: { type: "string", description: "可选：符合性报告 .json 路径（缺省与成品同目录）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					outPath: { type: "string" },
					conformancePath: { type: "string" },
					conformanceOk: { type: "boolean" },
					slideCount: { type: "number" },
					problems: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) {
					const lines = [`按模板构建 PPT 未通过：${value.error ?? "未知错误"}`];
					if (value.conformancePath) lines.push(`符合性报告：${value.conformancePath}`);
					if (value.outPath) lines.push(`已写出成品（需修正后重建）：${value.outPath}`);
					return [{ type: "text", text: lines.join("\n") }];
				}
				const lines = [
					`已按模板构建 PPTX：${value.outPath}`,
					`模板符合性：${value.conformanceOk ? "通过" : "有问题"}（报告：${value.conformancePath}）；共 ${value.slideCount ?? "?"} 页。`
				];
				if (value.problems?.length) lines.push(`需要修正：\n- ${value.problems.join("\n- ")}`);
				lines.push("下一步：调用 lab_tasks_register_presentation 登记成品，并在参数里传 conformancePath 与 templateId/templateVersion。");
				return [{ type: "text", text: lines.join("\n") }];
			}
		},
		timeoutMs: 300000,
		async execute(args) {
			try {
				const result = await ctx.labTasks.buildPresentationFromTemplate({
					templateId: args.templateId,
					templateVersion: args.templateVersion,
					compiledPath: args.compiledPath,
					outPath: args.outPath,
					reportPath: args.reportPath
				});
				const problems = result.problems
					?? (result.conformance?.findings ?? []).filter((row) => row.level === "error").map((row) => row.message);
				if (result.ok === false) {
					return cleanJson({
						ok: false,
						error: `模板符合性未通过（成品与报告已写出，修正后重建）：${problems.join("；") || "见符合性报告"}`,
						outPath: result.outPath,
						conformancePath: result.conformancePath,
						conformanceOk: false,
						slideCount: result.conformance?.summary?.slideCount,
						problems
					});
				}
				return cleanJson({
					ok: true,
					outPath: result.outPath,
					conformancePath: result.conformancePath,
					conformanceOk: result.conformance?.ok !== false,
					slideCount: result.conformance?.summary?.slideCount,
					problems
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}

export const Config = undefined;
