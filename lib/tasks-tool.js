/**
 * dsh-lab-agent: 文献产物登记模型工具（lab_tasks_register_search / _register_bundle /
 * _register_report / _register_presentation）。
 *
 * 让科研 Agent 在对话中完成文献检索/原文整理/精读/PPT 后，把产物登记到
 * 课题的 lab_tasks 域——这样课题面板「文献资料」四个板块（检索汇总/原文
 * 整理/精读报告/PPT 汇报）才会显示，而不是恒为空。
 * 自动从当前会话反查所属课题（getProjectBySession），也可显式传 projectId。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "tasks-tool";
export const inject = ["tools", "labTasks"];

/** 解析目标课题：优先显式 projectId，否则按当前会话反查。 */
function resolveProjectId(ctx, args, exec) {
	if (args.projectId !== undefined) {
		const project = ctx.labTasks.getProject(args.projectId);
		if (project === undefined) return { error: `课题 '${args.projectId}' 不存在` };
		return { projectId: args.projectId };
	}
	const sessionId = exec?.agent?.session?.id;
	if (!sessionId) return { error: "无法确定当前会话。请从「我的科研课题」进入课题空间启动对话，或显式传入 projectId。" };
	const bound = ctx.labTasks.getProjectBySession(sessionId);
	if (bound === undefined) return { error: "当前会话未归属任何课题。请先从「我的科研课题」选择课题并开始科研 Agent 对话，或显式传入 projectId。" };
	return { projectId: bound.project.id };
}

export function apply(ctx) {
	// 文献检索登记：执行 OpenAlex 检索并把结果登记到课题
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_search",
		description:
			"登记一次文献检索到课题（写入课题面板「文献资料 → 文献检索汇总」）。" +
			"执行 OpenAlex 检索（学术文献，无 key）并保存结果。返回检索 run 与结果条数。" +
			"用途：完成文献调研/检索后调用，让课题面板可见检索汇总。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			query: { type: "string", required: true, description: "检索式（英文为宜），如 prodrug polymer drug delivery" },
			limit: { type: "number", description: "返回条数（默认 10）" },
			sort: { type: "string", description: "排序（默认 relevance_score）" },
			yearFrom: { type: "number", description: "起始年份（可选）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					status: { type: "string" },
					count: { type: "number" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `检索登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记文献检索（${value.runId}，${value.status}，${value.count} 条结果）。可在课题面板「文献资料 → 文献检索汇总」查看。` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const run = await ctx.labTasks.searchLiterature({
					projectId: resolved.projectId,
					query: args.query,
					limit: args.limit,
					sort: args.sort,
					yearFrom: args.yearFrom
				});
				return { ok: true, runId: run.id, status: run.status, count: (run.results ?? []).length };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 原文整理登记：登记 PDF/source-map 的原文 bundle
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_bundle",
		description:
			"登记一篇论文原文到课题（写入课题面板「文献资料 → 文献原文整理」）。" +
			"输入 PDF 路径或 nature-reader 生成的 source-map JSON，登记后课题面板可见原文。" +
			"用途：精读/建卡前先登记原文。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			pdfPath: { type: "string", description: "可选：PDF 绝对路径（与 sourceMapPath 二选一）" },
			sourceMapPath: { type: "string", description: "可选：nature-reader 的 source-map JSON 路径（与 pdfPath 二选一）" },
			title: { type: "string", description: "可选：论文标题" },
			renderDir: { type: "string", description: "可选：页面渲染输出目录（PPT 配图用）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					status: { type: "string" },
					title: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `原文登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记原文（${value.bundleId}，${value.status}${value.title ? `：${value.title}` : ""}）。可在课题面板「文献资料 → 文献原文整理」查看。` }];
			}
		},
		timeoutMs: 180000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				if (!args.pdfPath && !args.sourceMapPath) return { ok: false, error: "pdfPath 与 sourceMapPath 至少提供一个" };
				const bundle = await ctx.labTasks.preparePaper({
					projectId: resolved.projectId,
					pdfPath: args.pdfPath,
					sourceMapPath: args.sourceMapPath,
					title: args.title,
					renderDir: args.renderDir
				});
				return { ok: true, bundleId: bundle.id, status: bundle.status, title: bundle.title };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 精读报告登记：创建 + 完成（paper-card 路径）
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_report",
		description:
			"登记一份文献精读报告到课题（写入课题面板「文献资料 → 文献精读报告」）。" +
			"基于已登记的原文（bundle）创建精读报告，登记 nature-paper-card 产物路径。" +
			"用途：完成 paper card 精读后调用，让课题面板可见精读报告。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			bundleId: { type: "string", required: true, description: "已登记的原文 bundleId（lab_tasks_register_bundle 返回）" },
			paperCardPath: { type: "string", description: "可选：nature-paper-card 产物 Markdown 绝对路径（完成精读后）" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `精读登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记精读报告（${value.reportId}，${value.status}）。可在课题面板「文献资料 → 文献精读报告」查看。` }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const report = await ctx.labTasks.createReadingReport({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					goalProfileId: args.goalProfileId ?? "default-prodrug-polymer",
					goalProfileVersion: args.goalProfileVersion ?? "1"
				});
				if (args.paperCardPath) {
					const done = await ctx.labTasks.completeReadingReport({
						reportId: report.id,
						paperCardPath: args.paperCardPath,
						locatorMode: report.locatorMode
					});
					return { ok: true, reportId: done.id, status: done.status };
				}
				return { ok: true, reportId: report.id, status: report.status };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// PPT 登记：创建 + 完成（pptx 路径）
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_presentation",
		description:
			"登记一份文献汇报 PPT 到课题（写入课题面板「文献资料 → 文献 PPT 汇报」）。" +
			"基于已通过审计的精读报告（report）创建 PPT run，登记 nature-paper2ppt 产物路径。" +
			"用途：完成 PPT 生成后调用，让课题面板可见 PPT 汇报。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			reportId: { type: "string", required: true, description: "已登记的精读报告 reportId（lab_tasks_register_report 返回）" },
			pptxPath: { type: "string", description: "可选：生成的 .pptx 绝对路径（完成后）" },
			outlinePath: { type: "string", description: "可选：大纲 .md 路径" },
			speechNotesPath: { type: "string", description: "可选：讲稿 .md 路径" },
			templateId: { type: "string", description: "可选：PPT 模板（默认 nature-default）" },
			templateVersion: { type: "string", description: "可选：模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					status: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `PPT 登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记文献 PPT（${value.runId}，${value.status}）。可在课题面板「文献资料 → 文献 PPT 汇报」查看。` }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const run = await ctx.labTasks.createPresentation({
					projectId: resolved.projectId,
					reportId: args.reportId,
					templateId: args.templateId ?? "nature-default",
					templateVersion: args.templateVersion ?? "1"
				});
				if (args.pptxPath) {
					const done = await ctx.labTasks.completePresentation({
						runId: run.id,
						pptxPath: args.pptxPath,
						outlinePath: args.outlinePath,
						speechNotesPath: args.speechNotesPath
					});
					return { ok: true, runId: done.id, status: done.status };
				}
				return { ok: true, runId: run.id, status: run.status };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}

export const Config = undefined;
