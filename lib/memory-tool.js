/**
 * dsh-lab-agent: 课题核心记忆模型工具（lab_project_memory_read / _update）。
 *
 * 让科研 Agent 在对话里直接读写课题核心记忆（版本化数据行，只增不改），
 * 而不是自行发明 PROJECT_MEMORY.md 之类的孤立文件——那不会被系统加载。
 * 工具自动从当前会话反查所属课题（getProjectBySession），无需手传课题编号；
 * 归档/总结任务请用本工具提交，交付对象与「课题核心记忆.md」面板同一份数据。
 * 挂载在 host 平面（与 lab_convert_document 一致），由 lab-research preset
 * 的 persona 引导使用。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "memory-tool";
export const inject = ["tools", "labTasks"];

/** 解析目标课题：优先显式 projectId，否则按当前会话反查。 */
function resolveProjectId(ctx, args, exec) {
	if (args.projectId !== undefined) {
		const project = ctx.labTasks.getProject(args.projectId);
		if (project === undefined) {
			return { error: `课题 '${args.projectId}' 不存在` };
		}
		return { projectId: args.projectId };
	}
	const sessionId = exec?.agent?.session?.id;
	if (!sessionId) {
		return { error: "无法确定当前会话。请从「我的科研课题」进入课题空间启动对话，或显式传入 projectId。" };
	}
	const bound = ctx.labTasks.getProjectBySession(sessionId);
	if (bound === undefined) {
		return { error: "当前会话未归属任何课题。请先从「我的科研课题」选择课题并开始科研 Agent 对话，或显式传入 projectId。" };
	}
	return { projectId: bound.project.id };
}

function historyOf(ctx, projectId) {
	return ctx.labTasks.listProjectMemoryVersions(projectId).map((row) => ({
		version: row.version,
		changeNote: row.changeNote,
		createdAt: row.createdAt
	}));
}

export function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "lab_project_memory_read",
		description:
			"读取当前课题的核心记忆（版本化 Markdown 数据行，只增不改）。" +
			"自动从当前会话反查所属课题；也可显式传 projectId。" +
			"返回当前版本内容、版本号、版本历史与课题信息。" +
			"用途：总结/归档前先读取现有记忆，归档后核对新版本。" +
			"禁止：用本工具之外的路径（如自行创建 PROJECT_MEMORY.md 文件）代替课题核心记忆。",
		parameters: {
			projectId: {
				type: "string",
				description: "可选：目标课题编号（如 dqb-project）；缺省自动从当前会话反查"
			},
			previewChars: {
				type: "number",
				description: "可选：返回记忆预览字符数（默认 2000）。完整内容始终可从课题工作区「项目记忆.md」读取"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					projectId: { type: "string" },
					projectName: { type: "string" },
					version: { type: "string" },
					markdown: { type: "string" },
					workspacePath: { type: "string" },
					history: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								version: { type: "string" },
								changeNote: { type: "string" },
								createdAt: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				// render 契约：返回 ContentBlock[]（{type:"text",text}），不能返回 string
				if (!value.ok) return [{ type: "text", text: `读取课题核心记忆失败：${value.error ?? "未知错误"}` }];
				const limit = Math.max(200, Number(args.previewChars ?? 2000));
				const body = value.markdown.length > limit
					? value.markdown.slice(0, limit) + `\n…（记忆共 ${value.markdown.length} 字符，完整内容见课题工作区「项目记忆.md」）`
					: value.markdown;
				const text = [
					`课题「${value.projectName}」（${value.projectId}）核心记忆 v${value.version}：`,
					``,
					body,
					``,
					value.history.length > 0 ? `版本历史：${value.history.map((h) => `v${h.version}(${h.changeNote})`).join(" → ")}` : "暂无版本历史"
				].join("\n");
				return [{ type: "text", text }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const project = ctx.labTasks.getProject(resolved.projectId);
				const memory = ctx.labTasks.getProjectMemory(resolved.projectId);
				return {
					ok: true,
					projectId: resolved.projectId,
					projectName: project.name,
					version: memory?.version ?? "0",
					markdown: memory?.markdown ?? "",
					workspacePath: project.workspacePath,
					history: historyOf(ctx, resolved.projectId)
				};
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_project_memory_update",
		description:
			"向当前课题的核心记忆提交一个新版本（版本化数据行，只增不改，带 changeNote 与内容哈希）。" +
			"自动从当前会话反查所属课题；也可显式传 projectId。" +
			"提交后该版本会作为后续科研 Agent 对话的默认背景记忆，并在「我的科研课题」面板可见。" +
			"用途：课题总结/进展归档、记忆更新。归档总结类任务请用本工具提交，不要自行创建" +
			"PROJECT_MEMORY.md 之类的孤立文件（不会被系统加载）。markdown 未变化时会报错（不会产生空版本）。",
		parameters: {
			projectId: {
				type: "string",
				description: "可选：目标课题编号（如 dqb-project）；缺省自动从当前会话反查"
			},
			markdown: {
				type: "string",
				required: true,
				description: "新的核心记忆 Markdown 全文（提交的是完整新版本，不是增量）"
			},
			changeNote: {
				type: "string",
				description: "本次修改说明，如：课题设计总结归档（两个课题设想）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					projectId: { type: "string" },
					version: { type: "string" },
					changeNote: { type: "string" },
					history: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								version: { type: "string" },
								changeNote: { type: "string" },
								createdAt: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `提交课题核心记忆失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已提交课题（${value.projectId}）核心记忆 v${value.version}${value.changeNote ? `：${value.changeNote}` : ""}。当前版本历史：${value.history.map((h) => `v${h.version}(${h.changeNote})`).join(" → ")}` }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const markdown = args.markdown?.trim();
				if (!markdown) return { ok: false, error: "markdown 不能为空" };
				const memory = await ctx.labTasks.updateProjectMemory({
					projectId: resolved.projectId,
					markdown,
					changeNote: args.changeNote
				});
				return {
					ok: true,
					projectId: resolved.projectId,
					version: memory.version,
					changeNote: memory.changeNote,
					history: historyOf(ctx, resolved.projectId)
				};
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}

export const Config = undefined;
