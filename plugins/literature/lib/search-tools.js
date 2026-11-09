import { defineTool } from "@deepseek-ai/dsh-tools";
import { deleteSearchTask, importRisTask, listSearchTasks, patchTaskCandidate, runScopusSearch, scopusTest, upsertSearchTask } from "./search-tasks-core.js";

function coreOf(ctx) { return ctx.get("ibmCore"); }
function taskBrief(task, { limit = 10, offset = 0 } = {}) {
	if (!task) return null;
	const candidates = task.candidates || [];
	const start = Math.max(0, Number(offset) || 0);
	const size = Math.min(30, Math.max(1, Number(limit) || 10));
	return {
		taskId: task.id,
		title: task.title,
		requirement: String(task.requirement || "").slice(0, 1500),
		candidateCount: candidates.length,
		roundCount: (task.rounds || []).length,
		rounds: (task.rounds || []).slice(-3).map((round) => ({ id: round.id, index: round.index, query: round.query, total: round.totalAvailable, fetched: round.fetched, added: round.newCount })),
		candidates: candidates.slice(start, start + size).map((row) => ({ id: row.id, title: row.title, titleZh: row.titleZh, journal: row.journal, year: row.year, doi: row.doi, recommendation: row.recommendation, abstractStatus: row.abstractStatus, addedToReading: row.addedToReading })),
		pagination: { offset: start, limit: size, total: candidates.length, hasMore: start + size < candidates.length }
	};
}

async function syncTaskCovers(ctx, projectId, taskId) {
	try {
		const store = await listSearchTasks(coreOf(ctx), projectId);
		const task = store.tasks.find((row) => row.id === taskId);
		const journals = [...new Set((task?.candidates || []).map((row) => row.journal).filter(Boolean))];
		const remote = ctx.get("labRemote");
		if (remote?.journal_covers_sync) await remote.journal_covers_sync({ journals });
		return { queued: journals.length };
	} catch (error) { return { queued: 0, error: error.message }; }
}
export function registerSearchTaskTools(ctx) {
	ctx.tools.register(defineTool({
		name: "lab_search_task_create",
		description: "创建或更新一个文献检索任务。用户提出新的文献检索需求时先调用此工具保存任务标题和完整研究需求。",
		parameters: {
			projectId: { type: "string", description: "课题编号" },
			taskId: { type: "string", description: "已有任务编号；新建时省略" },
			title: { type: "string", required: true, description: "简洁中文任务标题" },
			requirement: { type: "string", required: true, description: "从用户自然语言中整理出的研究对象、材料、方法、必须条件和排除条件" }
		},
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId, title, requirement }) {
			const core = coreOf(ctx);
			const store = await listSearchTasks(core, projectId);
			const prior = store.tasks.find((row) => row.id === taskId);
			const task = await upsertSearchTask(core, projectId, {
				...(prior || { id: `search-${Date.now().toString(36)}`, rounds: [], candidates: [], messages: [] }),
				title, requirement, updatedAt: new Date().toISOString()
			});
			return { taskId: task.id, task };
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_scopus",
		description: "对检索任务执行真实 Scopus 检索。query 必须是英文 Scopus 检索式（可用 TITLE-ABS-KEY(...)，也接受英文关键词）；中文需求先由你翻译成英文术语再调用。每调用一次生成一轮结果。",
		parameters: {
			projectId: { type: "string", description: "课题编号" },
			taskId: { type: "string", required: true, description: "检索任务编号" },
			query: { type: "string", required: true, description: "英文 Scopus 检索式" },
			limit: { type: "number", description: "本轮获取数量，默认 25" }
		},
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId, query, limit }) {
			const result = await runScopusSearch(coreOf(ctx), projectId, { taskId, query, limit: limit || 25 });
			await syncTaskCovers(ctx, projectId, taskId);
			return { taskId, round: result.round, total: result.total, fetched: result.fetched, added: result.added, candidateIds: result.task.candidates.map((row) => row.id), candidates: result.task.candidates.slice(-Math.max(1, result.added)) };
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_list",
		description: "读取当前课题的检索任务与候选文献，用于回答用户关于本轮结果、勾选、历史轮次的问题。",
		parameters: { projectId: { type: "string", description: "课题编号" }, taskId: { type: "string", description: "可选任务编号" }, limit: { type: "number", description: "返回候选数，默认10，最多30" }, offset: { type: "number", description: "候选分页起点" } },
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId, limit, offset }) {
			const store = await listSearchTasks(coreOf(ctx), projectId);
			const task = taskId ? store.tasks.find((row) => row.id === taskId) : store.tasks[0];
			return task || null;
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_update_candidates",
		description: "由科研助手把候选文献的中文标题、中文摘要总结、匹配理由、推荐级别和依据回写到检索任务。只能引用真实候选 id，不能编造文献。",
		parameters: {
			projectId: { type: "string", description: "课题编号" },
			taskId: { type: "string", required: true, description: "检索任务编号" },
			updates: { type: "array", required: true, description: "更新数组", items: { type: "object", additionalProperties: false, properties: { candidateId: { type: "string" }, titleZh: { type: "string" }, summaryZh: { type: "string" }, matchReason: { type: "string" }, recommendation: { type: "string", enum: ["priority", "support", ""] }, reasonBasis: { type: "string", enum: ["title", "abstract", "fulltext"] } } } }
		},
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId, updates }) {
			const results = [];
			for (const item of updates || []) {
				if (!item?.candidateId) continue;
				try {
					const result = await patchTaskCandidate(coreOf(ctx), projectId, { taskId, candidateId: item.candidateId, patch: { titleZh: item.titleZh, summaryZh: item.summaryZh, matchReason: item.matchReason, recommendation: item.recommendation, reasonBasis: item.reasonBasis } });
					results.push({ candidateId: item.candidateId, ok: true });
				} catch (error) { results.push({ candidateId: item.candidateId, ok: false, error: error.message }); }
			}
			return { updated: results.filter((row) => row.ok).length, results };
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_wos",
		description: "对检索任务执行真实 Web of Science Starter 检索。query 使用 WoS 语法（如 TS=(thrombus AND hydrogel) 或 PY=2016-2026）；每调用一次生成一轮 WoS 结果，并与 Scopus 候选合并去重。",
		parameters: {
			projectId: { type: "string", description: "课题编号" },
			taskId: { type: "string", required: true, description: "检索任务编号" },
			query: { type: "string", required: true, description: "WoS 检索式" },
			limit: { type: "number", description: "本轮获取数量，默认 25，最大 50" }
		},
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId, query, limit }) {
			const result = await runWosSearch(coreOf(ctx), projectId, { taskId, query, limit: limit || 25 });
			await syncTaskCovers(ctx, projectId, taskId);
			return { taskId, round: result.round, total: result.total, fetched: result.fetched, added: result.added, candidateIds: result.task.candidates.map((row) => row.id), candidates: result.task.candidates.slice(-Math.max(1, result.added)) };
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_wos_test",
		description: "测试 Web of Science Starter API Key 是否有效。",
		parameters: { projectId: { type: "string" } },
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
		async execute({ projectId }) { return wosTest(coreOf(ctx), projectId); }
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_scopus_test",
		description: "测试 Scopus 数据库连接与 Key 是否有效。",
		parameters: { projectId: { type: "string", description: "课题编号" } },
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId }) { return scopusTest(coreOf(ctx), projectId); }
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_import_ris",
		description: "把用户提供的 RIS 文本导入当前检索任务或新建任务。",
		parameters: { projectId: { type: "string" }, taskId: { type: "string" }, fileName: { type: "string" }, text: { type: "string", required: true } },
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId, fileName, text }) { return importRisTask(coreOf(ctx), projectId, { taskId, fileName, text }); }
	}));

	ctx.tools.register(defineTool({
		name: "lab_search_task_delete",
		description: "删除一个检索任务。",
		parameters: { projectId: { type: "string" }, taskId: { type: "string", required: true } },
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId }) { return deleteSearchTask(coreOf(ctx), projectId, taskId); }
	}));
	ctx.tools.register(defineTool({
		name: "lab_search_task_sync_covers",
		description: "低速扩充本地期刊封面库：提取该检索任务中所有尚无本地封面的期刊，排入串行队列逐个匹配 LetPub 封面并缓存。检索登记到列表后自动调用，也可手动调用。",
		parameters: { projectId: { type: "string" }, taskId: { type: "string", required: true } },
		output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
		async execute({ projectId, taskId }) { return syncTaskCovers(ctx, projectId, taskId); }
	}));
}
