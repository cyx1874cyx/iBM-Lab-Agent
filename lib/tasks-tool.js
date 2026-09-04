/**
 * dsh-lab-agent: 文献产物登记模型工具（lab_tasks_register_search / _register_bundle /
 * _register_report / _register_presentation）。
 *
 * 让科研 Agent 在对话中完成文献检索/原文整理/精读/PPT 后，把产物登记到
 * 课题的 lab_tasks 域——这样课题面板「文献资料」四个板块（检索汇总/原文
 * 整理/精读报告/PPT 汇报）才会显示，而不是恒为空。
 * 优先按会话绑定反查所属课题，并以会话 cwd 匹配课题工作区作为回退；
 * 也可显式传 projectId。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveToolProjectId } from "./project-context.js";
import { cleanJson } from "../src/json-boundary.js";

export const name = "tasks-tool";
export const inject = ["tools", "labTasks"];

/** 解析目标课题：显式 projectId → 会话绑定 → 会话 cwd。 */
function resolveProjectId(ctx, args, exec) {
	return resolveToolProjectId(ctx, args, exec);
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
			"用途：完成文献调研/检索后调用，让课题面板可见检索汇总。" +
			"确认单篇文献时（用户给出 DOI/PMID/arXiv 或精确题名）：把 query 直接写成该标识" +
			"（如 10.1021/ja409686x 或 https://doi.org/10.1021/ja409686x），系统走精确命中分支并" +
			"置顶返回该条（不受 OA 过滤）；不要用标题关键词检索后再从多条噪声里人工挑。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
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
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
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
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
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

	// 微信公众号正文读取：仅允许 mp.weixin.qq.com/s，返回可见文字供 AI 提取。
	ctx.tools.register(defineTool({
		name: "lab_tasks_fetch_wechat_article",
		description:
			"读取用户明确提供的微信公众号正文链接，返回页面标题、公众号名称、公众号推送时间和可见正文，供 AI 提取论文元数据。" +
			"严格只接受 https://mp.weixin.qq.com/s...；不下载 PDF。公众号推送时间不是论文发表时间。",
		parameters: {
			sourceUrl: { type: "string", required: true, description: "用户粘贴的 https://mp.weixin.qq.com/s... 正文链接" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					sourceUrl: { type: "string" },
					pageTitle: { type: "string" },
					description: { type: "string" },
					accountName: { type: "string" },
					wechatPublishedAt: { type: "string" },
					content: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `微信公众号正文读取失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: [
					`来源链接：${value.sourceUrl}`,
					value.pageTitle ? `公众号文章标题：${value.pageTitle}` : null,
					value.accountName ? `公众号：${value.accountName}` : null,
					value.wechatPublishedAt ? `公众号推送时间（不是论文发表时间）：${value.wechatPublishedAt}` : null,
					value.description ? `页面描述：${value.description}` : null,
					"\n公众号正文可见内容：\n" + value.content,
					"\n请只提取正文明确展示的论文元数据；未知字段省略，不要把公众号推送时间当作论文发表时间。"
				].filter(Boolean).join("\n") }];
			}
		},
		timeoutMs: 35000,
		async execute(args) {
			try {
				return { ok: true, ...await ctx.labTasks.fetchWechatArticle({ sourceUrl: args.sourceUrl }) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 微信公众号 DOI 检索校验：把 AI 提取的论文元数据拿去 OpenAlex/Crossref 校验，
	// 返回带置信度的 DOI 候选，供登记时补全权威 DOI（公众号页面常不展示 DOI）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_resolve_wechat_doi",
		description:
			"把从微信公众号文章中提取的论文题名（可带作者/年份）提交 OpenAlex 与 Crossref 检索校验，返回带置信度分级的 DOI 候选。" +
			"用于公众号页面未展示 DOI 时补全权威 DOI；页面已明确展示 DOI 时跳过本步、直接登记。" +
			"候选按置信度（high/medium/low）与标题相似度排序，confidence=high 才可直接采用，medium 需谨慎，low 不建议采用。" +
			"检索不可用时调用方可降级为只登记页面字段（lab_tasks_register_wechat_paper 的 doi 缺省省略，禁止猜测）。" +
			"仅用于 https://mp.weixin.qq.com/s... 正文链接场景，配合 lab_tasks_fetch_wechat_article 使用。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查（仅供留痕，缺省不影响检索）" },
			title: { type: "string", required: true, description: "论文原始题名；只能填写公众号页面明确展示的题名" },
			authors: { type: "array", items: { type: "string" }, description: "作者列表，保持页面展示顺序；用于作者姓氏匹配校验" },
			journal: { type: "string", description: "期刊名；页面未展示时省略" },
			year: { type: "number", description: "四位发表年份；页面未展示时省略" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					title: { type: "string" },
					candidates: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								doi: { type: "string" },
								title: { type: "string" },
								authors: { type: "array", items: { type: "string" } },
								journal: { type: "string" },
								year: { type: "number" },
								volume: { type: "string" },
								issue: { type: "string" },
								pages: { type: "string" },
								publicationDate: { type: "string" },
								confidence: { type: "string" },
								titleScore: { type: "number" },
								matchedAuthors: { type: "array", items: { type: "string" } },
								yearMatch: { type: "number" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `DOI 检索校验失败：${value.error ?? "未知错误"}` }];
				const lines = value.candidates.map((candidate, index) => {
					const reasons = [`标题相似度 ${candidate.titleScore}`];
					if (candidate.matchedAuthors?.length) reasons.push(`作者重合 ${candidate.matchedAuthors.join("、")}`);
					if (candidate.yearMatch === 0) reasons.push("年份吻合");
					else if (candidate.yearMatch === 1) reasons.push(`年份差 ${candidate.yearMatch}`);
					return `${index + 1}. [${candidate.confidence}] ${candidate.doi}\n   ${candidate.title}（${candidate.journal ?? "期刊未知"}${candidate.year ? `, ${candidate.year}` : ""}）\n   依据：${reasons.join("；")}`;
				});
				return [{ type: "text", text: `「${value.title}」检索到 ${value.candidates.length} 个 DOI 候选：\n\n${lines.join("\n")}\n\n请采用 confidence=high 的候选；medium 需再与用户确认；low 不建议采用。确定后调用 lab_tasks_register_wechat_paper 提交（doi 传选定的值）。` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				const result = await ctx.labTasks.resolveWechatPaperDoi({
					projectId: resolved.error ? undefined : resolved.projectId,
					title: args.title,
					authors: args.authors,
					journal: args.journal,
					year: args.year
				});
				return { ok: true, title: result.title, candidates: result.candidates };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 微信公众号文献入口：AI 提取可核验元数据后先入精读队列，不下载 PDF。
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_wechat_paper",
		description:
			"把 AI 从微信公众号文章中提取的论文元数据提交到当前课题的「文献精读」板块。" +
			"只登记页面中可核验的字段，不下载 PDF；条目会显示为“待上传 PDF”，后续人工上传原文时复用返回的 bundleId。" +
			"仅用于 https://mp.weixin.qq.com/s... 正文链接。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			sourceUrl: { type: "string", required: true, description: "用户提供的微信公众号文章链接，必须以 https://mp.weixin.qq.com/s 开头" },
			title: { type: "string", required: true, description: "论文原始题名；只能填写公众号页面明确展示的题名" },
			authors: { type: "array", items: { type: "string" }, description: "作者列表，保持页面展示顺序" },
			doi: { type: "string", description: "论文 DOI；页面未展示时省略，禁止猜测" },
			journal: { type: "string", description: "期刊名；页面未展示时省略" },
			year: { type: "number", description: "四位发表年份；页面未展示时省略" },
			publicationDate: { type: "string", description: "页面展示的发表日期" },
			volume: { type: "string", description: "卷号" },
			issue: { type: "string", description: "期号" },
			pages: { type: "string", description: "页码或文章号" },
			abstract: { type: "string", description: "论文摘要；仅在公众号页面明确提供时填写" },
			keywords: { type: "array", items: { type: "string" }, description: "关键词；仅在页面明确提供时填写" },
			shortCitation: { type: "string", description: "可选：期刊 卷, 页码 (年份).；元数据不完整时省略" },
			titleZh: { type: "string", description: "可选：页面明确给出的中文译题" },
			summary: { type: "string", description: "可选：根据公众号正文形成的简短内容说明；不要冒充全文精读结论" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本（默认 1）" },
			noteTemplateId: { type: "string", description: "可选：后续精读使用的阅读笔记模板" },
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" },
					created: { type: "boolean" },
					title: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `微信公众号文献登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `${value.created ? "已新建" : "已更新"}文献精读条目「${value.title}」，当前状态：待上传 PDF。\nbundleId: ${value.bundleId}\nreportId: ${value.reportId}\n无需下载 PDF；后续用户手工上传原文时，用 lab_tasks_register_bundle 传入此 bundleId，再继续全文精读。` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await ctx.labTasks.registerWechatPaper({
					projectId: resolved.projectId,
					sourceUrl: args.sourceUrl,
					title: args.title,
					authors: args.authors,
					doi: args.doi,
					journal: args.journal,
					year: args.year,
					publicationDate: args.publicationDate,
					volume: args.volume,
					issue: args.issue,
					pages: args.pages,
					abstract: args.abstract,
					keywords: args.keywords,
					shortCitation: args.shortCitation,
					titleZh: args.titleZh,
					summary: args.summary,
					goalProfileId: args.goalProfileId,
					goalProfileVersion: args.goalProfileVersion,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion
				});
				return { ok: true, bundleId: result.bundle.id, reportId: result.report.id, status: result.report.status, created: result.created, title: result.bundle.title };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 通用文献元数据入口（非公众号）：DOI/publisher 页面或用户给出的题名元数据
	// → 先入精读队列“待上传 PDF”，不下载 PDF；后续原文经 lab_tasks_register_bundle 补齐。
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_paper_meta",
		description:
			"把论文元数据（DOI/publisher 页面/用户提供的题名+作者等）提交到当前课题的「文献精读」板块，无需 PDF 或微信公众号链接。" +
			"条目会显示为“待上传 PDF”，后续用户上传原文时调用 lab_tasks_register_bundle 传回返回的 bundleId（或按 DOI/题名自动匹配）即可继续全文精读。" +
			"sourceType 取值：publisher（出版方/摘要页，默认）、doi（DOI 直达页）、wechat（公众号链接，必须传 mp.weixin.qq.com/s 的 sourceUrl）。" +
			"只登记可核验字段；title 必填，DOI 若给出必须合法；重复登记同一 DOI/链接会更新原条目（幂等）。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			sourceType: { type: "string", description: "可选：publisher（默认）| doi | wechat" },
			sourceUrl: { type: "string", description: "可选：来源页面 http(s) 链接；wechat 类型时必填且须为 https://mp.weixin.qq.com/s... " },
			title: { type: "string", required: true, description: "论文原始题名（必填）" },
			authors: { type: "array", items: { type: "string" }, description: "作者列表，保持页面展示顺序" },
			doi: { type: "string", description: "论文 DOI；未确认时省略，禁止猜测" },
			journal: { type: "string", description: "期刊名" },
			year: { type: "number", description: "四位发表年份" },
			publicationDate: { type: "string", description: "发表日期" },
			volume: { type: "string", description: "卷号" },
			issue: { type: "string", description: "期号" },
			pages: { type: "string", description: "页码或文章号" },
			abstract: { type: "string", description: "论文摘要" },
			keywords: { type: "array", items: { type: "string" }, description: "关键词" },
			shortCitation: { type: "string", description: "可选：期刊 卷, 页码 (年份).；元数据不完整时省略" },
			titleZh: { type: "string", description: "可选：中文译题" },
			summary: { type: "string", description: "可选：简短内容说明；不要冒充全文精读结论" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本（默认 1）" },
			noteTemplateId: { type: "string", description: "可选：后续精读使用的阅读笔记模板" },
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" },
					created: { type: "boolean" },
					title: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `文献登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `${value.created ? "已新建" : "已更新"}文献精读条目「${value.title}」（${args.sourceType ?? "publisher"} 元数据），当前状态：待上传 PDF。\nbundleId: ${value.bundleId}\nreportId: ${value.reportId}\n无需 PDF 即可登记；后续用户上传原文时，用 lab_tasks_register_bundle 传回此 bundleId，再继续全文精读。` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await ctx.labTasks.registerPaperMeta({
					projectId: resolved.projectId,
					sourceType: args.sourceType,
					sourceUrl: args.sourceUrl,
					title: args.title,
					authors: args.authors,
					doi: args.doi,
					journal: args.journal,
					year: args.year,
					publicationDate: args.publicationDate,
					volume: args.volume,
					issue: args.issue,
					pages: args.pages,
					abstract: args.abstract,
					keywords: args.keywords,
					shortCitation: args.shortCitation,
					titleZh: args.titleZh,
					summary: args.summary,
					goalProfileId: args.goalProfileId,
					goalProfileVersion: args.goalProfileVersion,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion
				});
				return { ok: true, bundleId: result.bundle.id, reportId: result.report.id, status: result.report.status, created: result.created, title: result.bundle.title };
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
			"输入 PDF 路径或 nature-reader 生成的 source-map JSON，登记后课题面板可见原文；" +
			"如果是此前由公众号元数据创建的待上传条目，请传回其 bundleId，系统会在原条目上补齐原文。" +
			"用途：精读/建卡前先登记原文。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", description: "可选：待补齐原文的既有 bundleId（公众号元数据登记工具返回）；缺省时按 DOI 或题名自动匹配" },
			pdfPath: { type: "string", description: "可选：PDF 绝对路径（与 sourceMapPath 二选一）" },
			sourceMapPath: { type: "string", description: "可选：nature-reader 的 source-map JSON 路径（与 pdfPath 二选一）" },
			doi: { type: "string", description: "可选：论文 DOI（如 10.1000/xyz.1）。填写后课题面板文献条目中的 PDF/SI 按钮会按 DOI 点亮为可下载" },
			siPath: { type: "string", description: "可选：SI（Supplementary Information 补充材料）文件绝对路径，随 PDF 一并登记；面板条目 SI 按钮据此点亮" },
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
					bundleId: args.bundleId,
					pdfPath: args.pdfPath,
					sourceMapPath: args.sourceMapPath,
					doi: args.doi,
					siPath: args.siPath,
					title: args.title,
					renderDir: args.renderDir
				});
				return { ok: true, bundleId: bundle.id, status: bundle.status, title: bundle.title };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 精读前强制盘点：先看现有正文/SI，再按阅读笔记模板生成。
	ctx.tools.register(defineTool({
		name: "lab_tasks_get_reading_inputs",
		description:
			"生成任何文献精读报告前必须先调用。盘点该文献当前已有的正文 PDF、SI 和 source-map，并返回本次报告格式要求。" +
			"必须逐个读取 available=true 的资源；PDF/Office 先用 lab_convert_document 转为 Markdown。" +
			"只要存在阅读笔记模板，就严格按模板章节生成；Nature paper-card 仅在没有可用模板时回退，不得覆盖模板。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", description: "文献 bundleId；与 reportId 至少提供一个" },
			reportId: { type: "string", description: "既有待精读 reportId；与 bundleId 至少提供一个" },
			noteTemplateId: { type: "string", description: "可选：本次准备采用的阅读笔记模板；缺省使用报告已快照模板或 note-default" },
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					reportId: { type: "string" },
					title: { type: "string" },
					formatSource: { type: "string" },
					templateId: { type: "string" },
					templateVersion: { type: "string" },
					templateName: { type: "string" },
					resourcesJson: { type: "string" },
					requirementsJson: { type: "string" },
					instructions: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `精读输入盘点失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: [
					`精读前资源盘点：${value.title || value.bundleId}`,
					`bundleId: ${value.bundleId}${value.reportId ? `\nreportId: ${value.reportId}` : ""}`,
					`报告格式来源：${value.formatSource}${value.templateId ? `（${value.templateId}@${value.templateVersion} ${value.templateName || ""}）` : ""}`,
					`现有资源：\n${value.resourcesJson}`,
					`生成要求：\n${value.requirementsJson}`,
					`强制顺序：\n- ${value.instructions.join("\n- ")}`
				].join("\n\n") }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const inputs = await ctx.labTasks.readingReportInputs({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					reportId: args.reportId,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion
				});
				// 返回前过 cleanJson：去除 undefined 自有字段、归一 NaN/Infinity，
				// 保证跨 Typert/工具 JSON 边界无损（P0 修复 #2）。
				return cleanJson({
					ok: true,
					bundleId: inputs.bundleId,
					reportId: inputs.reportId,
					title: inputs.title,
					formatSource: inputs.formatSource,
					templateId: inputs.templateId,
					templateVersion: inputs.templateVersion,
					templateName: inputs.templateName,
					resourcesJson: JSON.stringify(inputs.resources, null, 2),
					requirementsJson: JSON.stringify(inputs.generationRequirements, null, 2),
					instructions: inputs.instructions
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 精读报告登记：创建 + 完成（兼容字段仍名为 paperCardPath，内容模板优先）
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_report",
		description:
			"登记一份文献精读报告到课题文献条目并自动暂存实际 DOCX。" +
			"调用前必须先用 lab_tasks_get_reading_inputs 盘点并读取正文/SI；基于全部已有资源登记阅读笔记 Markdown。" +
			"报告优先采用阅读笔记模板，只有没有可用模板时才使用 Nature paper-card。" +
			"如已生成 DOCX 可同时传入，否则系统生成并固化一次。" +
			"登记后立即进入右侧分页预览与人工审阅；自动自查只提供提醒，不是门禁。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", description: "已登记的原文 bundleId（lab_tasks_register_bundle 返回）；与 reportId 至少提供一个" },
			reportId: { type: "string", description: "可选：复用既有待精读条目（公众号元数据登记工具返回），避免重复创建" },
			paperCardPath: { type: "string", description: "可选：按阅读笔记模板生成的精读报告 Markdown 绝对路径；仅无可用模板时可传 nature-paper-card 产物" },
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
				if (value.status === "pending") return [{ type: "text", text: `已登记待精读条目（${value.reportId}${value.shortCitation ? `：${value.shortCitation}` : ""}），等待 PDF/原文与精读报告。` }];
				return [{ type: "text", text: `已暂存精读报告（${value.reportId}，${value.status}${value.shortCitation ? `：${value.shortCitation}` : ""}）。请在课题面板「文献资料」条目点击“预览报告”，逐页检查后在右侧预览页人工审核。审核通过前不会开放 DOCX 下载。` }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				let report;
				if (args.reportId) {
					report = ctx.labTasks.getReadingReport(args.reportId);
					if (report === undefined || report.projectId !== resolved.projectId) return { ok: false, error: "精读条目不存在或不属于当前课题" };
					if (args.bundleId && report.bundleId !== args.bundleId) return { ok: false, error: "reportId 与 bundleId 不属于同一文献" };
				} else {
					if (!args.bundleId) return { ok: false, error: "bundleId 与 reportId 至少提供一个" };
					report = ctx.labTasks.listReadingReports(resolved.projectId).find((row) => row.bundleId === args.bundleId && !row.paperCardPath);
					if (report === undefined) report = await ctx.labTasks.createReadingReport({
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
				}
				if (args.noteTemplateId || args.noteTemplateVersion) report = await ctx.labTasks.selectReadingReportTemplate({
					reportId: report.id,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion
				});
				if (args.paperCardPath) {
					const bundle = ctx.labTasks.getBundle(report.bundleId);
					const done = await ctx.labTasks.completeReadingReport({
						reportId: report.id,
						paperCardPath: args.paperCardPath,
						docxPath: args.docxPath,
						locatorMode: bundle?.locatorMode ?? report.locatorMode,
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
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
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
