import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { h } from "dsh-lab-agent/client-sdk";
import { JournalCover } from "./journal-cover.js";

const emptyTask = () => ({ id: "", title: "", requirement: "", rounds: [], candidates: [], messages: [], createdAt: "", updatedAt: "", status: "draft" });
function SearchMetrics({ journal, call }) {
	const storageKey = journal ? `ib-lit-journal-metrics:${journal}` : "";
	const read = () => { try { const raw = localStorage.getItem(storageKey); const value = raw ? JSON.parse(raw) : null; return value && Number(value.impactFactor) > 0 ? value : undefined; } catch { return undefined; } };
	const [data, setData] = useState(read);
	useEffect(() => {
		if (!journal) return undefined;
		const cached = read();
		if (cached) { setData(cached); return undefined; }
		let active = true;
		void call("tasks_journal_metrics", { request: { journal } }).then((value) => {
			if (!active || !value) return;
			setData(value);
			try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* ignore */ }
		}).catch(() => {});
		return () => { active = false; };
	}, [journal, call]);
	return h("div", { className: "ib-lit-metrics ib-st-metrics" },
		h("div", { className: "ib-lit-metric-box", "data-tone": "if" }, h("span", null, "影响因子"), h("b", null, data ? data.impactFactor : "…")),
		h("div", { className: "ib-lit-metric-box", "data-tone": "cas" }, h("span", null, "中科院分区"), h("b", null, data?.casTier ? data.casTier + "区" : "待核实")),
		h("div", { className: "ib-lit-metric-box", "data-tone": "top" }, h("span", null, "TOP期刊"), h("b", null, data?.top === true ? "是" : data?.top === false ? "否" : "待核实")));
}
const DETAIL_LABELS = ["研究对象", "场景", "材料与方法", "必须条件", "排除条件", "时间范围", "文献类型", "排序偏好"];
function requirementSections(text) {
	const value = String(text || "").trim();
	if (!value) return [];
	const expression = new RegExp(`(${DETAIL_LABELS.join("|")})[：:]`, "g");
	const matches = [...value.matchAll(expression)];
	if (!matches.length) return [{ label: "研究需求", value }];
	return matches.map((match, index) => ({
		label: match[1],
		value: value.slice(match.index + match[0].length, matches[index + 1]?.index ?? value.length).trim().replace(/^[；;，,\s]+|[；;，,\s]+$/g, "")
	})).filter((section) => section.value);
}
function SearchTaskDetail({ task, lastRound }) {
	if (!task) return h("div", { className: "ib-st-empty big" }, "选择或新建检索任务");
	const formulas = (task.rounds || []).filter((round) => round.query);
	return h("div", { className: "ib-st-task-detail" },
		h("div", { className: "ib-st-task-stats" }, `第${task.rounds?.length || 0}轮 · 候选 ${task.candidates?.length || 0} 篇${lastRound ? ` · 本轮新增 ${lastRound.newCount || 0}` : ""}`),
		h("section", { className: "ib-st-detail-section" },
			h("h4", null, "检索式"),
			formulas.length ? formulas.map((round) => h("div", { key: round.id || round.query, className: "ib-st-formula" }, h("b", null, round.label || `第${round.index || ""}轮`), h("code", null, round.query))) : h("p", null, task.query || "尚未生成检索式。")
		),
		requirementSections(task.requirement).map((section) => h("section", { key: section.label, className: "ib-st-detail-section" }, h("h4", null, section.label), h("p", null, section.value)))
	);
}const basisLabel = (value) => value === "fulltext" ? "全文方法" : value === "abstract" ? "摘要" : "标题";
const recLabel = (value) => value === "priority" ? "优先阅读" : value === "support" ? "补充参考" : "";

function reasonsFor(paper) {
	const raw = paper?.reasons ?? paper?.matchReason ?? "";
	const list = Array.isArray(raw) ? raw : String(raw).split(/\n|[；;]/).map((item) => item.trim()).filter(Boolean);
	return [0, 1, 2].map((index) => list[index] || "暂无补充");
}
function createRisText(task, candidates) {
	const lines = [];
	for (const paper of candidates) {
		lines.push("TY  - JOUR");
		for (const author of paper.authors || []) lines.push(`AU  - ${author}`);
		if (paper.title) lines.push(`TI  - ${paper.title}`);
		if (paper.journal) lines.push(`JO  - ${paper.journal}`);
		if (paper.year) lines.push(`PY  - ${paper.year}`);
		if (paper.doi) lines.push(`DO  - ${paper.doi}`);
		if (paper.abstract) lines.push(`AB  - ${paper.abstract}`);
		lines.push("ER  -", "");
	}
	return lines.join("\n");
}

export function SearchTasksPanel({ projectId, call, notify, onRequestArtifact, onChanged, onCount, onShowChat, onStartSearchChat }) {
	const [tasks, setTasks] = useState([]);
	const [activeId, setActiveId] = useState("");
	const [taskQuery, setTaskQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState("");
	const [filterOpen, setFilterOpen] = useState(false);
	const [onlyNew, setOnlyNew] = useState(false);
	const [expanded, setExpanded] = useState("");
	const [selectedPaperId, setSelectedPaperId] = useState('');
	const [showOriginalTitle, setShowOriginalTitle] = useState(false);
	const [detailLang, setDetailLang] = useState("zh");
	const [composer, setComposer] = useState("");
	const [newTask, setNewTask] = useState(null);
	const [message, setMessage] = useState("");
	const [scopusState, setScopusState] = useState(null);

	const active = tasks.find((task) => task.id === activeId) || tasks[0] || null;
	const candidates = active?.candidates || [];
	const selected = useMemo(() => new Set(candidates.filter((paper) => paper.selected).map((paper) => paper.id)), [candidates]);
	const lastRound = active?.rounds?.at(-1);
	const visible = useMemo(() => {
		const filtered = candidates.filter((paper) => !onlyNew || lastRound?.candidateIds?.includes(paper.id));
		return filtered.slice().sort((a, b) => {
			const rank = { priority: 0, support: 1, "": 2 };
			return (rank[a.recommendation] ?? 2) - (rank[b.recommendation] ?? 2);
		});
	}, [candidates, onlyNew, lastRound]);

	const syncedCovers = useRef("");
	const selectedPaper = candidates.find((paper) => paper.id === selectedPaperId) || null;
	const detailTitle = selectedPaper ? (detailLang === "en" ? selectedPaper.title : selectedPaper.titleZh || selectedPaper.title) : "";
	const detailAbstract = selectedPaper ? (detailLang === "en" ? selectedPaper.abstract : selectedPaper.summaryZh || selectedPaper.abstract) : "";
	const load = useCallback(async (preserve = "", quiet = false) => {
		if (!quiet) setLoading(true);
		try {
			const result = await call("search_tasks_list", { request: { projectId } });
			const rows = result?.tasks || [];
			setTasks(rows);
			setActiveId(preserve || result?.activeTaskId || rows[0]?.id || "");
			onCount?.(rows.length);
		} catch (error) { notify?.(error.message); }
		finally { setLoading(false); }
	}, [call, projectId, notify]);

	useEffect(() => { void load(); }, [load]);

	useEffect(() => { if (active) setComposer(active.requirement || ""); setSelectedPaperId(""); }, [active?.id]);

	const save = async (task, quiet = false) => {
		const result = await call("search_tasks_save", { request: { projectId, task } });
		const saved = result?.task;
		if (saved) {
			setTasks((old) => [saved, ...old.filter((row) => row.id !== saved.id)]);
			setActiveId(saved.id);
			if (!quiet) notify?.("检索任务已保存");
		}
		return saved;
	};

	const createTask = async () => {
		const title = String(newTask?.title || "").trim();
		const requirement = String(newTask?.requirement || "").trim();
		if (!title) { setMessage("请填写任务标题"); return; }
		try {
			const task = await save({ ...emptyTask(), id: `search-${Date.now().toString(36)}`, title, requirement }, true);
			setNewTask(null);
			setMessage("");
			notify?.("已创建检索任务");
			onShowChat?.();
			if (onRequestArtifact) {
				const prompt = `我刚在文献检索中创建了任务「${title}」（taskId: ${task.id}，projectId: ${projectId}）。当前需求：${requirement || "尚未填写"}。请先在科研助手里帮我细化检索需求：确认研究对象、材料/方法、必须条件、排除条件、时间范围、期望文献类型和排序偏好；一次只问最关键的问题，不要现在就开始检索。等我确认细化后的需求，再翻译成英文 Scopus 术语并调用 lab_search_task_scopus 检索，然后用 lab_search_task_update_candidates 回写中文标题、摘要总结、匹配理由和推荐级别。`;
				if (onStartSearchChat) await onStartSearchChat(prompt, true, { taskId: task.id });
				else await onRequestArtifact(prompt, true);
			}
		} catch (error) { setMessage(error.message); }
	};
	const runSearch = async (withPrompt = false) => {
		if (!active) return;
		const prompt = withPrompt ? String(composer || "").trim() : active.requirement || active.title;
		if (!prompt) { setMessage("请先填写研究需求或检索式"); return; }
		setBusy("search");
		setMessage("");
		try {
			const result = await call("search_tasks_scopus_search", { request: { projectId, taskId: active.id, query: prompt, limit: 25 } });
			if (result?.task) {
				setTasks((old) => [result.task, ...old.filter((row) => row.id !== result.task.id)]);
				setActiveId(result.task.id);
			}
			notify?.(`Scopus 返回 ${result?.fetched || 0} 篇，新增 ${result?.added || 0} 篇`);
		} catch (error) {
			setMessage(error.message);
			notify?.(error.message);
		} finally { setBusy(""); }
	};

	const retryFromMessages = async () => {
		if (!active) return;
		const prompt = String(composer || "").trim();
		if (!prompt) { setMessage("请补充本轮需求"); return; }
		const next = { ...active, requirement: prompt, messages: [...(active.messages || []), { role: "user", text: prompt, at: new Date().toISOString() }] };
		await save(next, true);
		await runSearch(true);
	};

	const toggle = async (paper) => {
		const nextSelected = !paper.selected;
		const next = { ...active, candidates: candidates.map((row) => row.id === paper.id ? { ...row, selected: nextSelected } : row) };
		setTasks((old) => [next, ...old.filter((row) => row.id !== next.id)]);
		await save(next, true).catch((error) => notify?.(error.message));
	};

	const setFeedback = async (paper, feedback) => {
		const next = { ...active, candidates: candidates.map((row) => row.id === paper.id ? { ...row, feedback: row.feedback === feedback ? "" : feedback } : row) };
		setTasks((old) => [next, ...old.filter((row) => row.id !== next.id)]);
		await save(next, true).catch((error) => notify?.(error.message));
	};

	const clearSelection = async () => {
		const next = { ...active, candidates: candidates.map((row) => ({ ...row, selected: false })) };
		setTasks((old) => [next, ...old.filter((row) => row.id !== next.id)]);
		await save(next, true);
	};

	const exportRis = async () => {
		const ids = [...selected];
		const result = await call("search_tasks_export_ris", { request: { projectId, taskId: active.id, candidateIds: ids.length ? ids : visible.map((row) => row.id) } });
		const blob = new Blob([result.text || ""], { type: "application/x-research-info-systems" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = result.fileName || "search.ris";
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	};

	const addToReading = async () => {
		if (!active || selected.size === 0) return;
		setBusy("reading");
		try {
			const result = await call("search_tasks_add_to_reading", { request: { projectId, taskId: active.id, candidateIds: [...selected] } });
			notify?.(`已加入精读 ${result?.succeeded || 0} 篇${result?.failed ? `，失败 ${result.failed} 篇` : ""}`);
			await load(active.id);
			onChanged?.();
		} catch (error) { notify?.(error.message); }
		finally { setBusy(""); }
	};

	const importRisToTask = async (file) => {
		if (!file) return;
		const text = await file.text();
		try {
			const result = await call("search_tasks_import_ris", { request: { projectId, taskId: active?.id, fileName: file.name, text } });
			if (result?.task) {
				setTasks((old) => [result.task, ...old.filter((row) => row.id !== result.task.id)]);
				setActiveId(result.task.id);
			}
			notify?.(`RIS 导入 ${result?.imported || 0} 条，新增 ${result?.added || 0} 条`);
			await load(result?.task?.id);
		} catch (error) { notify?.(error.message); }
	};

	const testScopus = async () => {
		setBusy("test");
		try {
			const result = await call("search_tasks_scopus_test", { request: { projectId } });
			setScopusState(result);
			notify?.(result?.message || (result?.ok ? "Scopus 连接正常" : "Scopus 连接失败"));
		} catch (error) { setScopusState({ ok: false, message: error.message }); }
		finally { setBusy(""); }
	};

	const paperNode = (paper, index) => {
		const detail = expanded === paper.id ? h("div", { className: "ib-st-detail" },
			paper.abstract ? h("p", null, paper.abstract) : h("p", { className: "muted" }, "该记录未返回摘要。"),
			h("div", null, paper.authors?.join(", ") || "作者未获取"),
			h("div", null, paper.doi ? h("a", { href: `https://doi.org/${paper.doi}`, target: "_blank", rel: "noreferrer" }, `DOI: ${paper.doi}`) : "无 DOI"),
			paper.sourceUrl ? h("a", { href: paper.sourceUrl, target: "_blank", rel: "noreferrer" }, "来源链接") : null
		) : null;
		return h("article", { key: paper.id, role: "button", tabIndex: 0, className: "ib-st-paper", "data-added": paper.addedToReading ? "true" : undefined, onClick: (event) => { if (event.target.closest("button,input,label,a")) return; setSelectedPaperId(paper.id); }, onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPaperId(paper.id); } } },
			h("label", { className: "ib-st-check" }, h("input", { type: "checkbox", checked: Boolean(paper.selected), onChange: () => void toggle(paper) }), h("span", null, String(index + 1).padStart(2, "0"))),
			h(JournalCover, { journal: paper.journal, call, fallback: String((paper.journal || "PREPRINT").split(/\s+/)[0] || "PREPRINT").slice(0, 6) }),
			h("div", { className: "ib-st-paper-copy" },
				h("button", { type: "button", className: "ib-st-title", onClick: () => setSelectedPaperId(paper.id) }, showOriginalTitle ? (paper.title || "未命名文献") : (paper.titleZh || paper.title || "未命名文献")),
				h("div", { className: "ib-st-meta" }, [paper.journal, paper.year].filter(Boolean).join(" · ") || "来源未知", paper.addedToReading ? h("span", { className: "ib-st-added" }, "已加入精读") : null),
				h("ul", { className: "ib-st-reasons" }, h("li", null, reasonsFor(paper)[0])),
				detail
			),
			h("div", { className: "ib-st-paper-side" },
				recLabel(paper.recommendation) ? h("span", { className: "ib-st-rec", "data-kind": paper.recommendation }, `★ ${recLabel(paper.recommendation)}`) : null,
				h(SearchMetrics, { journal: paper.journal, call })
			)
		);
	useEffect(() => {
		if (!active || !candidates.length) return;
		const journals = [...new Set(candidates.map((paper) => paper.journal).filter(Boolean))];
		if (!journals.length) return;
		const signature = active.id + ":" + journals.sort().join("|");
		if (syncedCovers.current === signature) return;
		syncedCovers.current = signature;
		void call("journal_covers_sync", { request: { journals } }).catch(() => {});
	}, [active?.id, candidates.length, call]);

	};const filteredTasks = tasks.filter((task) => !taskQuery || task.title.toLowerCase().includes(taskQuery.toLowerCase()));
	useEffect(() => {
		if (!active?.id) return undefined;
		const timer = setInterval(() => { if (!busy) void load(active.id, true); }, 5000);
		return () => clearInterval(timer);
	}, [active?.id, busy, load]);

	const activeRoundCount = active?.rounds?.length || 0;

	return h("div", { className: "ib-st" },
		h("aside", { className: "ib-st-tasks" },
			h("header", { className: "ib-st-tasks-head" }, h("b", null, "检索任务"), h("button", { type: "button", className: "ib-st-add", title: "新建任务", onClick: () => setNewTask({ title: "", requirement: "" }) }, "+")),
			h("label", { className: "ib-st-search" }, h("span", { "aria-hidden": "true" }, "⌕"), h("input", { value: taskQuery, placeholder: "搜索任务", onChange: (event) => setTaskQuery(event.target.value) })),
			h("div", { className: "ib-st-task-list" }, loading ? h("div", { className: "ib-st-empty" }, "加载中…") : filteredTasks.length === 0 ? h("div", { className: "ib-st-empty" }, "暂无检索任务") : filteredTasks.map((task) => h("button", {
				key: task.id, type: "button", className: "ib-st-task", "data-active": task.id === active?.id ? "true" : undefined,
				onClick: () => { setActiveId(task.id); setExpanded(""); }, onContextMenu: async (event) => { event.preventDefault(); event.stopPropagation(); if (!window.confirm(`删除检索任务「${task.title || "未命名任务"}」？`)) return; try { await call("search_tasks_delete", { request: { projectId, taskId: task.id } }); notify?.("已删除检索任务"); await load(); } catch (error) { notify?.(error.message); } }
			}, h("span", { className: "ib-st-task-icon" }, "▤"), h("span", { className: "ib-st-task-copy" }, h("b", null, task.title || "未命名任务"), h("small", null, `第${task.rounds?.length || 0}轮 · ${task.candidates?.length || 0}篇`)), h("span", { className: "ib-st-task-more" }, "⋯")))),
			h("footer", { className: "ib-st-savehint" }, "⛁ 任务自动保存"),
			h("label", { className: "ib-st-import" }, "导入 RIS", h("input", { type: "file", accept: ".ris", hidden: true, onChange: (event) => void importRisToTask(event.target.files?.[0]) }))
		),
		h("main", { className: "ib-st-main" },
			active ? h(React.Fragment, null,
				h("header", { className: "ib-st-head" }, h("div", null, h("h2", null, active.title || "未命名检索任务"), null),
					h("button", { type: "button", className: "ib-st-link", onClick: () => setFilterOpen((value) => !value) }, "检索策略")),
				h("div", { className: "ib-st-rounds" }, (active.rounds || []).slice(-4).map((round, index) => h("button", { key: round.id, type: "button", className: "ib-st-round", "data-active": index === (active.rounds || []).length - 1 ? "true" : undefined }, `第${round.index || index + 1}轮`)), lastRound ? h("span", { className: "ib-st-round-new" }, `本轮新增 ${lastRound.newCount || 0} 篇 · 保留 ${lastRound.totalAfter || candidates.length} 篇`) : null),
				filterOpen ? h("div", { className: "ib-st-filter" }, h("label", null, h("input", { type: "checkbox", checked: onlyNew, onChange: (event) => setOnlyNew(event.target.checked) }), "只看本轮新增"), h("button", { type: "button", onClick: async () => { const key = window.prompt("Scopus API Key（仅保存在本机后端配置）"); if (!key) return; await call("search_tasks_save_key", { request: { projectId, apiKey: key.trim() } }); notify?.("Scopus Key 已保存"); }, disabled: busy === "test" }, "配置 Scopus Key"), h("button", { type: "button", onClick: testScopus, disabled: busy === "test" }, busy === "test" ? "测试中…" : "测试 Scopus 连接"), scopusState ? h("span", { "data-ok": scopusState.ok ? "true" : "false" }, scopusState.message) : null) : null,
				h("div", { className: "ib-st-listhead" }, h("b", null, `候选文献 ${visible.length}`), h("span", null, `已选 ${selected.size}`), h("div", { className: "ib-st-listtools" }, h("button", { type: "button", className: "ib-st-chip", "data-active": onlyNew ? "true" : undefined, onClick: () => setOnlyNew((value) => !value) }, "筛选"), h("button", { type: "button", className: "ib-st-chip", "data-active": !showOriginalTitle ? "true" : undefined, onClick: () => setShowOriginalTitle((value) => !value) }, showOriginalTitle ? "显示译文" : "翻译标题"), h("span", { className: "ib-st-hint" }, "Scopus 实时结果"))),
				h("div", { className: "ib-st-candidates" }, visible.length === 0 ? h("div", { className: "ib-st-empty big" }, active.requirement ? "尚无候选文献，点击右侧「继续检索」。" : "先补充研究需求，再开始检索。") : visible.map(paperNode)),
				h("footer", { className: "ib-st-batch" }, h("span", null, `已选 ${selected.size} 篇`), h("button", { type: "button", className: "ib-st-link", onClick: () => void clearSelection(), disabled: selected.size === 0 }, "清空"), h("span", { className: "ib-st-spacer" }), h("button", { type: "button", className: "ib-st-secondary", onClick: () => void exportRis() }, "导出 RIS"), h("button", { type: "button", className: "ib-st-primary", onClick: () => void addToReading(), disabled: selected.size === 0 || busy === "reading" }, busy === "reading" ? "加入中…" : `加入精读 (${selected.size})`))
			) : h("div", { className: "ib-st-empty big" }, "选择或新建检索任务"),
			message ? h("div", { className: "ib-st-error" }, message) : null
		),
		h("aside", { className: "ib-st-detail-pane" },
			selectedPaper ? h(React.Fragment, null,
				h("div", { className: "ib-st-detail-head" },
					h(JournalCover, { journal: selectedPaper.journal, call, fallback: String((selectedPaper.journal || "PREPRINT").split(/\s+/)[0] || "PREPRINT").slice(0, 6), large: true }),
					h("div", { className: "ib-st-detail-copy" }, h("div", { className: "ib-st-detail-title-row" }, h("h3", null, detailTitle || "未命名文献"), h("button", { type: "button", className: "ib-st-lang", onClick: () => setDetailLang((value) => value === "zh" ? "en" : "zh") }, detailLang === "zh" ? "EN" : "中文")), h("p", null, [selectedPaper.journal, selectedPaper.year].filter(Boolean).join(" · ") || "来源未知"))
				),
				h("section", { className: "ib-st-detail-section" }, h("h4", null, "摘要"), h("p", null, detailAbstract || "该记录未返回摘要。")),
				h("section", { className: "ib-st-detail-section" }, h("h4", null, "作者"), h("p", null, selectedPaper.authors?.join(", ") || "作者未获取")),
				h("section", { className: "ib-st-detail-section" }, h("h4", null, "来源"), h("p", null, selectedPaper.doi ? h("a", { href: `https://doi.org/${selectedPaper.doi}`, target: "_blank", rel: "noreferrer" }, `DOI: ${selectedPaper.doi}`) : "无 DOI"), selectedPaper.sourceUrl ? h("a", { href: selectedPaper.sourceUrl, target: "_blank", rel: "noreferrer" }, "打开来源链接") : null),
			 ) : h(SearchTaskDetail, { task: active, lastRound })
		),
		newTask ? h("div", { className: "ib-st-modal", onClick: (event) => { if (event.target === event.currentTarget) setNewTask(null); } }, h("section", { className: "ib-st-dialog" }, h("h3", null, "新建检索任务"), h("label", null, "任务标题", h("input", { autoFocus: true, value: newTask.title, placeholder: "例如：不同成分血栓的体外制备", onChange: (event) => setNewTask({ ...newTask, title: event.target.value }) })), h("label", null, "研究需求", h("textarea", { value: newTask.requirement, placeholder: "描述研究对象、材料、方法、必须条件和排除条件…", onChange: (event) => setNewTask({ ...newTask, requirement: event.target.value }) })), h("div", { className: "ib-st-dialog-actions" }, h("button", { type: "button", className: "ib-st-link", onClick: () => setNewTask(null) }, "取消"), h("button", { type: "button", className: "ib-st-primary", onClick: () => void createTask() }, "创建任务")))) : null
	);
}
