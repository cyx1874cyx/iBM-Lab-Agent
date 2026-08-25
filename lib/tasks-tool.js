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

function summaryPaperId(paper) {
	return String(paper.doi ?? paper.pmid ?? paper.arxivId ?? paper.id ?? paper.landingUrl ?? paper.title ?? "").trim();
}

function parseSummaryText(value) {
	return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
		const match = line.match(/^(.+?)\s*(?:\t|=>|\|)\s*(.+)$/);
		return match ? { paperId: match[1].trim(), summaryZh: match[2].trim() } : { paperId: "", summaryZh: line };
	});
}

export function apply(ctx) {
	// 文献检索登记：执行多源 OA 检索并把结果登记到课题
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_search",
		description:
			"把当前会话的文献检索登记到课题；同一会话的多轮查询自动合并为一个条目和一个 RIS。" +
			"并行检索 OpenAlex、Crossref、PubMed、arXiv，统一字段、去重排序并保存结果。" +
			"用途：完成文献调研/检索后调用，让课题面板可见检索汇总。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			entryTitle: { type: "string", required: true, description: "用一句简短中文概括当前会话累计检索主题，作为面板条目标题；不要直接复制检索式" },
			query: { type: "string", required: true, description: "检索式（英文为宜），如 prodrug polymer drug delivery" },
			limit: { type: "number", description: "返回条数（默认 10）" },
			sort: { type: "string", description: "排序（默认 relevance_score）" },
			yearFrom: { type: "number", description: "起始年份（可选）" },
			oaOnly: { type: "boolean", description: "主题检索是否只返回开放获取文献（默认 true；精确 DOI 查询仍显示关闭状态）" }
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
					title: { type: "string" },
					count: { type: "number" },
					papers: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								paperId: { type: "string" },
								title: { type: "string" },
								abstract: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `检索登记失败：${value.error ?? "未知错误"}` }];
				const ids = (value.papers ?? []).map((paper) => `- ${paper.paperId} | ${paper.title}`).join("\n");
				return [{ type: "text", text: `已更新本会话检索「${value.title}」（${value.count} 条去重文献）。\nrunId: ${value.runId}${ids ? `\n待提炼论文（paperId 可直接使用）：\n${ids}\n请调用 lab_tasks_get_search_summary_inputs 读取摘要，再调用 lab_tasks_update_search_summaries。` : "\n摘要核心内容均已登记。"}` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const run = await ctx.labTasks.searchLiterature({
					projectId: resolved.projectId,
					title: args.entryTitle,
					query: args.query,
					limit: args.limit,
					sort: args.sort,
					yearFrom: args.yearFrom,
					oaOnly: args.oaOnly ?? true,
					sessionId: exec?.agent?.session?.id
				});
				const papers = (run.results ?? []).filter((paper) => paper.shortDescriptionZh === "摘要待提炼").map((paper) => ({
					paperId: summaryPaperId(paper),
					title: paper.title,
					abstract: String(paper.abstract || paper.title).slice(0, 1600)
				}));
				return { ok: true, runId: run.id, status: run.status, title: run.title, count: (run.results ?? []).length, papers };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_get_search_summary_inputs",
		description: "读取一次检索的 runId、公开 paperId、标题和摘要，供 Agent 生成九字内中文摘要概括。runId 可省略，默认读取当前会话最新检索。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			runId: { type: "string", description: "可选：检索 runId；缺省读取当前会话最新检索" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					papers: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								paperId: { type: "string" },
								title: { type: "string" },
								abstract: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `检索摘要输入读取失败：${value.error ?? "未知错误"}` }];
				const blocks = value.papers.map((paper, index) => `${index + 1}. paperId: ${paper.paperId}\n标题: ${paper.title}\n摘要: ${paper.abstract}`).join("\n\n");
				return [{ type: "text", text: `runId: ${value.runId}\n待提炼论文 ${value.papers.length} 篇：\n\n${blocks || "无待提炼论文"}` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const sessionId = exec?.agent?.session?.id;
				const candidates = ctx.labTasks.listSearchRuns(resolved.projectId).filter((run) => !sessionId || run.sessionId === sessionId);
				const run = args.runId ? ctx.labTasks.getSearchRun(args.runId) : candidates.at(-1);
				if (run === undefined || run.projectId !== resolved.projectId) return { ok: false, error: "未找到当前课题的检索条目" };
				const papers = (run.results ?? []).filter((paper) => paper.shortDescriptionZh === "摘要待提炼").map((paper) => ({
					paperId: summaryPaperId(paper), title: paper.title, abstract: String(paper.abstract || paper.title).slice(0, 1600)
				}));
				return { ok: true, runId: run.id, papers };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_update_search_summaries",
		description:
			"根据每篇论文的摘要或标题，为检索条目写入 2–9 个字的中文核心内容概括。" +
			"概括必须说明论文实现、发现或解决了什么，例如“可降解无线传感”“提升肿瘤药物递送”；" +
			"禁止填写“相关研究”“传感器件”“研究方法”“相关综述”等文章类型。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			runId: { type: "string", required: true, description: "lab_tasks_register_search 返回的 runId" },
			summaries: {
				type: "array",
				description: "摘要数组；也可改用 summariesText 文本格式",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						paperId: { type: "string", description: "公开 paperId；接受原始 DOI、DOI URL、OpenAlex URL/W 号、PMID、arXiv ID、结果 id 或完整标题" },
						summaryZh: { type: "string", description: "根据摘要提炼的 2–9 字中文核心内容，不得只是文章类型" },
						summary: { type: "string", description: "summaryZh 的兼容别名" }
					}
				}
			},
			summariesText: { type: "string", description: "可选简化格式：每行 paperId<TAB>summaryZh，也接受 paperId | summaryZh" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					updated: { type: "number" },
					unmatched: { type: "array", items: { type: "string" } },
					rejected: {
						type: "array",
						items: { type: "object", additionalProperties: false, properties: { paperId: { type: "string" }, reason: { type: "string" } } }
					},
					availablePaperIds: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `摘要概括登记失败：${value.error ?? "未知错误"}` }];
				const unmatched = value.unmatched?.length ? `\n未匹配 paperId：${value.unmatched.join("、")}` : "";
				const rejected = value.rejected?.length ? `\n未写入项：${value.rejected.map((item) => `${item.paperId || "(空)"}（${item.reason}）`).join("；")}` : "";
				const available = value.updated === 0 && value.availablePaperIds?.length ? `\n当前可用 paperId：${value.availablePaperIds.join("、")}` : "";
				return [{ type: "text", text: `已为 ${value.updated} 篇文献登记摘要核心内容。有效项会立即保存，不再因单条错误回滚整批。${unmatched}${rejected}${available}` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const run = ctx.labTasks.getSearchRun(args.runId);
				if (run === undefined || run.projectId !== resolved.projectId) return { ok: false, error: "检索条目不存在或不属于当前课题" };
				const summaries = [...(args.summaries ?? []), ...parseSummaryText(args.summariesText)];
				const result = await ctx.labTasks.updateSearchSummaries({ runId: args.runId, summaries });
				return { ok: true, updated: result.updated, unmatched: result.unmatched, rejected: result.rejected, availablePaperIds: result.availablePaperIds };
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
			"登记一份文献精读报告到课题文献条目并自动暂存实际 DOCX。" +
			"基于已登记的原文（bundle）登记阅读笔记 Markdown；如已生成 DOCX 可同时传入，否则系统生成并固化一次。" +
			"登记后立即进入右侧分页预览与人工审阅；自动自查只提供提醒，不是门禁。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			bundleId: { type: "string", required: true, description: "已登记的原文 bundleId（lab_tasks_register_bundle 返回）" },
			paperCardPath: { type: "string", description: "可选：nature-paper-card 产物 Markdown 绝对路径（完成精读后）" },
			docxPath: { type: "string", description: "可选：已生成的实际 .docx 绝对路径；缺省由 Markdown 生成并暂存" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本" },
			noteTemplateId: { type: "string", description: "可选：阅读笔记模板（默认 note-default，可在「模板管理」查看/新建）" },
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" },
			shortCitation: { type: "string", description: "可选：文献短引用；必须使用“期刊 卷, 页码 (年份).”格式，不含作者和题名，例如 Nature 630, 84–90 (2024)." },
			titleZh: { type: "string", description: "可选：中文标题（面板条目标题悬浮提示）" },
			summary: { type: "string", description: "可选：约200字概览卡片正文；缺省自动从 paper card 推导" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" },
					shortCitation: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `精读登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已暂存精读报告（${value.reportId}，${value.status}${value.shortCitation ? `：${value.shortCitation}` : ""}）。请在课题面板「文献资料」条目点击“预览报告”，逐页检查后在右侧预览页人工审核。审核通过前不会开放 DOCX 下载。` }];
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
					goalProfileVersion: args.goalProfileVersion ?? "1",
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion,
					shortCitation: args.shortCitation,
					titleZh: args.titleZh,
					summary: args.summary
				});
				if (args.paperCardPath) {
					const done = await ctx.labTasks.completeReadingReport({
						reportId: report.id,
						paperCardPath: args.paperCardPath,
						docxPath: args.docxPath,
						locatorMode: report.locatorMode,
						shortCitation: args.shortCitation,
						titleZh: args.titleZh,
						summary: args.summary
					});
					return { ok: true, reportId: done.id, status: done.status, shortCitation: done.shortCitation };
				}
				return { ok: true, reportId: report.id, status: report.status, shortCitation: report.shortCitation };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// PPT 登记：创建 + 完成（pptx 路径）
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_presentation",
		description:
			"登记一份文献汇报 PPT 到课题文献条目。" +
			"基于已有暂存报告创建 PPT run，不要求先通过报告审核；模板只作格式参考。" +
			"实际 PPTX 登记后立即进入右侧分页预览与人工审阅；自动版面自查只提供提醒。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省自动从当前会话反查" },
			reportId: { type: "string", required: true, description: "已登记的精读报告 reportId（lab_tasks_register_report 返回）" },
			pptxPath: { type: "string", description: "可选：生成的 .pptx 绝对路径（完成后）" },
			outlinePath: { type: "string", description: "可选：大纲 .md 路径" },
			speechNotesPath: { type: "string", description: "可选：讲稿 .md 路径" },
			templateId: { type: "string", description: "可选：PPT 模板（默认 nature-default）" },
			templateVersion: { type: "string", description: "可选：模板版本" },
			skipAudit: { type: "boolean", description: "历史兼容字段：仅记录请求；自查始终为非阻断提醒，人工审核不可跳过" }
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
				return [{ type: "text", text: `已暂存文献 PPT（${value.runId}，${value.status}）。请在课题面板条目点击“预览PPT”，逐页检查后在右侧预览页人工审核。审核通过前不会开放 PPTX 下载。` }];
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
					templateVersion: args.templateVersion ?? "1",
					skipAudit: args.skipAudit === true
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
