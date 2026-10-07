import { nativeBrowser, nativeDesktopAvailable, setDesktopProject } from "./desktop-client.js";
import { ScientificBrowser } from "./scientific-browser.js";
import React from "react";
import ReactDOM from "react-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { h } from "./h.js";
import { when, statusOf, saveRis, downloadVerifiedBinary, downloadOfficeArtifact, openOfficeArtifact, openPdfPreview, openExternalUrl, openInEdgeViaShell, webVpnStatusViaShell, iwanStatusViaShell, openWebVpnLoginViaShell, openWebVpnCaptureViaShell, showWebVpnViaShell, cancelWebVpnCaptureViaShell, revealSavedPathViaDesktop } from "./lib.js";
import {openReader,translationPrompt} from './reader-tab.js';

import { ResearchDesignWorkspace } from "./components-workspace.js";
import { CharacterizationPanel } from "./components-characterization.js";
import { Templates } from "./components-templates.js";
import { BookSvg, SiSvg, SpinSvg } from "./components-templates.js";
import {fileToBase64} from './components-literature.js';

// 条目操作按钮一律**平铺在条目右侧**（与改版前一致）：次级原文按钮 + 简介 + 精读 +
// PPT + 删除。试过把这些低频操作收进 `···` 下拉，但在 DSH 的滚动容器里菜单会被裁切、
// 跑到屏幕外，等于把「200 字简介」「删除条目」这些原有功能藏没了。所以不再有下拉菜单，
// 任何操作都不藏在弹层里。

// WebVPN 会话状态 → 捕获提示文案/色调。桌面壳按 `WebVpnSessionState`
// （kebab-case）返回 state；这里把「加载出版社页 / 等待下载 / 归档中」映射成
// 用户能看懂的过程提示，避免一直停在「已布防」这种没有阶段感的文案。
const formatCaptureBytes = (bytes) => {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatCaptureElapsed = (milliseconds) => {
	const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
	return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

export const capturePhaseOf = (state, lastError, downloadedBytes, downloadElapsedMs, automationStage, extra = {}) => {
	switch (state) {
		case "opening": return { text: "正在打开文献浏览侧栏…", tone: "waiting" };
		case "waiting-login": return { text: "正在自动核验 WebVPN 会话；若出现登录页，请在侧栏完成登录", tone: "waiting" };
		case "ready": return { text: "机构访问通道可用，正在打开出版社页面…", tone: "waiting" };
		case "navigating": return { text: "正在打开出版社页面…", tone: "waiting" };
		case "waiting-download":
			if (automationStage === "searching") return { text: "正在查找出版社下载入口…", tone: "waiting" };
			if (automationStage === "clicked") return { text: "已点击下载入口，等待浏览器确认文件下载…", tone: "waiting" };
			if (automationStage === "verification") return { text: "出版社页面验证中；通过后自动继续查找下载入口", tone: "waiting" };
			if (automationStage === "manual") {
				if (extra.documentType === "application/pdf") return { text: "原生 PDF 已打开，可用查看器下载并归档", tone: "waiting", actionable: true };
				return {
					text: extra.alternateEntry
						? `请观察页面下载入口，或使用备用入口（${extra.alternateEntry}）`
						: "请观察页面并点击实际 Download PDF 入口",
					tone: "waiting",
					actionable: true
				};
			}
			return { text: "正在等待出版社页面加载…", tone: "waiting" };
		case "downloading":
			// C17：长期没有字节增长不能再显示「正在保存」。
			if (extra.stalled) {
				return { text: `下载已 ${Math.round((extra.stalledMs || 0) / 1000)} 秒没有进度，任务疑似卡住`, tone: "error", actionable: true };
			}
			return { text: `正在下载 PDF · 已写入 ${formatCaptureBytes(downloadedBytes)}${extra.downloadTotalBytes ? ` / ${formatCaptureBytes(extra.downloadTotalBytes)}` : "（总量未知）"} · 用时 ${formatCaptureElapsed(downloadElapsedMs)}`, tone: "busy", progress: true };
		case "uploading": return { text: `文件已下载（${formatCaptureBytes(downloadedBytes)}），正在归档到课题…`, tone: "busy", progress: true };
		// C6/C17：失去接管不是「排队」，必须如实显示成终态并给出可执行动作。
		case "heartbeat-lost": return { text: "与文献浏览器失去心跳，任务已中断；可重建或终止", tone: "error", actionable: true };
		case "orphaned": return { text: "文献浏览器已释放该任务，任务已中断；可重建或终止", tone: "error", actionable: true };
		case "stalled": return { text: `任务已 ${Math.round((extra.stalledMs || 0) / 1000)} 秒没有进度，疑似卡住；可重建或终止`, tone: "error", actionable: true };
		case "expired": return { text: "捕获任务已过期，请重新点击文献按钮", tone: "error" };
		case "error": return { text: lastError ? `捕获失败：${lastError}` : "捕获失败，请重试", tone: "error" };
		case "completed": return { text: `下载并归档完成 · ${formatCaptureBytes(downloadedBytes)}`, tone: "complete", progress: true, complete: true };
		default: return { text: "正在准备捕获…", tone: "waiting" };
	}
};

// 项目/文献/面板组件：CreateProject/Home/bundleIndex/bundleRecordIndex/LitPanel/Project/OverlayBoundary/Panel
export function CreateProject({ call, defaults, onCancel, onCreated }) {
			const [form, setForm] = useState({ id: "", name: "", coreMarkdown: "# 核心课题\n\n## 研究问题\n\n## 核心假设\n\n## 预期目标\n\n## 当前进展\n- 项目建立" });
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState("");
			const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
			const create = async () => {
				setBusy(true); setError("");
				try {
					if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("项目编号请使用小写字母、数字和连字符，例如 polymer-prodrug-01");
					if (!form.name.trim()) throw new Error("请填写项目名称");
					const profileFields = defaults.goal && defaults.template ? { goalProfileId: defaults.goal.id, goalProfileVersion: defaults.goal.version, templateId: defaults.template.id, templateVersion: defaults.template.version } : {};
					const result = await call("projects_create", { request: { fields: { ...form, name: form.name.trim(), memoryChangeNote: "创建课题核心记忆", ...profileFields } } });
					onCreated(result.project, result.presetId);
				} catch (reason) { setError(reason.message); } finally { setBusy(false); }
			};
			return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "建立新课题"), h("span", { className: "ib-chip" }, "从核心记忆开始")), h("div", { className: "ib-form-grid" }, h("div", { className: "ib-field" }, h("label", null, "项目编号（英文）"), h("input", { value: form.id, placeholder: "polymer-prodrug-01", onChange: field("id") })), h("div", { className: "ib-field" }, h("label", null, "项目名称"), h("input", { value: form.name, placeholder: "聚前药纳米递送课题", onChange: field("name") })), h("div", { className: "ib-field", "data-wide": true }, h("label", null, "核心课题 Markdown"), h("textarea", { value: form.coreMarkdown, onChange: field("coreMarkdown") }))), error ? h("div", { className: "ib-error" }, error) : null, h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void create() }, busy ? "创建中…" : "创建并进入")));
		}

export function Home({ call, onOpen, onLaunch, onOpenTemplates }) {
			const [state, setState] = useState({ loading: true, projects: [], defaults: {}, error: "" });
			const [creating, setCreating] = useState(false);
			const [launching, setLaunching] = useState(null);
			const load = useCallback(async () => {
				try {
					const capabilities = await call("capabilities");
                    const [projects, goals, templates] = await Promise.all([call("projects_list"), capabilities.literature ? call("goals_list") : { goals: [] }, capabilities.documents ? call("templates_list") : { templates: [] }]);
					setState({ loading: false, projects: projects.projects || [], defaults: { capabilities, goal: goals.goals.find((x) => x.id === "default-prodrug-polymer") || goals.goals[0], template: templates.templates.find((x) => x.id === "nature-default") || templates.templates[0] }, error: "" });
				} catch (reason) { setState({ loading: false, projects: [], defaults: {}, error: reason.message }); }
			}, []);
			useEffect(() => { void load(); }, [load]);
			const launch = async (project, presetId) => {
				setLaunching(project.id);
				try { await onLaunch(project, { presetId }); }
				catch (reason) { setState((previous) => ({ ...previous, error: reason.message })); setLaunching(null); }
			};
			return h("div", null, h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Research Projects"), h("h1", null, "选择一个课题继续"), h("p", null, "每个课题拥有独立的核心记忆、科研 Agent 对话和研究成果。创建课题后会自动打开专属工作区并开始科研 Agent 对话。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", disabled: !state.defaults.capabilities?.documents && !state.defaults.capabilities?.experimentTemplates, onClick: onOpenTemplates }, "模板管理"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => setCreating(true) }, "+ 新建课题"))), creating ? h(CreateProject, { call, defaults: state.defaults, onCancel: () => setCreating(false), onCreated: (project, presetId) => void launch(project, presetId) }) : null, state.error ? h("div", { className: "ib-error" }, state.error) : null, state.loading ? h("div", { className: "ib-empty" }, "正在读取课题…") : state.projects.length ? h("div", { className: "ib-grid" }, state.projects.map((project) => h("button", { className: "ib-project", key: project.id, disabled: launching === project.id, onClick: () => onOpen(project) }, h("div", { className: "ib-project-icon" }, "PJ"), h("h2", null, project.name), h("p", null, launching === project.id ? "正在创建专属工作区并启动对话…" : "进入课题空间，继续对话、更新记忆或查询研究成果。"), h("div", { className: "ib-project-foot" }, h("span", null, `记忆 v${project.memoryVersion || "1"}`), h("span", null, when(project.updatedAt)))))) : h("div", { className: "ib-empty" }, "还没有课题。点击“新建课题”，先写下研究问题与目标。"));
		}

		/** bundle id → title 索引（精读条目缺省标题回退）。 */
export function bundleIndex(bundles = []) {
			const index = {};
			for (const bundle of bundles) index[bundle.id] = bundle.title;
			return index;
		}
export function bundleRecordIndex(bundles = []) {
			const index = {};
			for (const bundle of bundles) index[bundle.id] = bundle;
			return index;
		}

function captureRouteForBundle(bundle, kind) {
	const doi = String(bundle?.doi || "").trim();
	const publisher = /^10\.1038\//i.test(doi) ? "nature"
		: /^10\.1007\//i.test(doi) ? "springer"
			: /^10\.1126\//i.test(doi) ? "science"
				: /^10\.1016\//i.test(doi) ? "elsevier"
					: /^10\.1021\//i.test(doi) ? "acs"
						: /^10\.1039\//i.test(doi) ? "rsc"
							: /^10\.1109\//i.test(doi) ? "ieee"
								: /^10\.(?:1002|1111)\//i.test(doi) ? "wiley" : "other";
	const directSpringerSi = kind === "si" && ["nature", "springer"].includes(publisher);
	const doiUrl = bundle?.doi ? `https://doi.org/${encodeURIComponent(bundle.doi)}` : undefined;
	const sourcePublisherUrl = (() => {
		if (bundle?.sourceType === "wechat" || !bundle?.sourceUrl) return undefined;
		try {
			const url = new URL(bundle.sourceUrl);
			return url.protocol === "https:" ? url.href : undefined;
		} catch { return undefined; }
	})();
	return { publisher, directSpringerSi, publisherUrl: doiUrl || sourcePublisherUrl };
}

		/** 文献管理两栏：左侧检索记录 + 右侧精读档案。 */
export function LitPanel({ projectId, searches, reports, bundles, presentations, call, notify, onRequestArtifact, onChanged }) {
			const titleByBundle = bundleIndex(bundles);
			const bundleById = bundleRecordIndex(bundles);
			const presentationByReport = {};
			for (const item of (presentations || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
				if (!(item.reportId in presentationByReport)) presentationByReport[item.reportId] = item;
			}
			const [busy, setBusy] = useState({});
			const [overview, setOverview] = useState({});
			const [expandedSearch, setExpandedSearch] = useState(null);
			const [folders,setFolders]=useState([]),[selectedFolder,setSelectedFolder]=useState('all'),[organizing,setOrganizing]=useState(false),[importingRis,setImportingRis]=useState(false);
			const risPicker=useRef(null);
			const [folderEditor,setFolderEditor]=useState(null);
			const loadFolders=useCallback(()=>call('tasks_reading_folders',{request:{projectId}}).then(result=>setFolders(result.folders??[])).catch(error=>notify(error.message)),[call,projectId,notify]);
			useEffect(()=>{void loadFolders();},[projectId,reports,loadFolders]);
			const folderAction=async(action,request)=>{try{await call(action,{request:{projectId,...request}});await loadFolders();onChanged?.();return true;}catch(error){notify(error.message);return false;}};
			const createFolder=()=>setFolderEditor({name:''});
			const importRis=async file=>{if(!file)return;setImportingRis(true);try{if(file.size>2*1024*1024)throw Error('RIS 文件不能超过 2 MB');const result=await call('tasks_search_import_ris',{request:{projectId,fileName:file.name,base64:await fileToBase64(file)}});notify(`${result.reused?'已登记过此 RIS，复用原记录':'RIS 导入成功'}：${result.run.results.length} 篇，去重 ${result.duplicateCount} 条`);onChanged?.();}catch(error){notify(error.message);}finally{setImportingRis(false);if(risPicker.current)risPicker.current.value='';}};
			const autoOrganize=async()=>{setOrganizing(true);try{await onRequestArtifact?.('请整理当前课题全部已完成精读的文献：先调用 lab_tasks_list_reading_folders，逐份读取其中报告 Markdown；根据报告的研究主题、材料体系和机制选择简洁的中文文件夹名，优先复用已有同主题文件夹；逐条调用 lab_tasks_classify_reading_report 登记，reason 必须包含报告内容依据。未完成精读的条目保留未分类。',true);}catch(error){notify(error.message);}finally{setOrganizing(false);}};
			const filteredReports=reports.filter(report=>selectedFolder==='all'||(selectedFolder==='unfiled'?!report.folderId:report.folderId===selectedFolder));
			const [machineReviews, setMachineReviews] = useState({});
			const [preview, setPreview] = useState(null); // { kind: "report" | "ppt", report, presentation? }
			const [reviewVisible, setReviewVisible] = useState(false);
			const [approval, setApproval] = useState(null); // { stage: "confirm" | "approved", detail }
			// 文献捕获：{ bundleId, kind, taskId } —— Nature 自动点击，其他出版社等待人工点击。
			const [captureHint, setCaptureHint] = useState(null);
			const [captureStopping, setCaptureStopping] = useState(false);
			// 浏览器模式（web-current / managed-edge / desktop-edge-handoff）：
			// desktop 下 WebView2 不是扩展宿主，捕获必须经外部 Edge handoff。
			const [browserMode, setBrowserMode] = useState("managed-edge");
			// 正文/SI 正在交给外部 Edge 打开（key: `${kind}:${report.id}`）。
			const [opening, setOpening] = useState({});
			useEffect(() => {
				let alive = true;
				call("literature_status", { request: { force: false } })
					.then((result) => { if (alive && result?.browserMode) setBrowserMode(result.browserMode); })
					.catch(() => { /* 状态面板会重试，静默即可 */ });
				return () => { alive = false; };
			}, [call]);
			const desktopEdgeHandoff = window.parent !== window || browserMode === "desktop-edge-handoff";
			// 桌面模式不在普通 iBM 页面注入扩展。服务端是捕获状态的唯一事实来源，
			// 布防后轮询任务，完成时刷新当前课题的文件状态。
			useEffect(() => {
				const taskId = captureHint?.taskId;
				if (!taskId) return undefined;
				let disposed = false;
				let timer;
				const poll = async () => {
					try {
						const result = await call("manual_capture_get", { request: { taskId } });
						if (disposed) return;
						const task = result?.task;
						if (task?.status === "completed") {
							setCaptureHint((current) => current?.taskId === taskId
								? { ...current, route: "complete", phase: capturePhaseOf("completed", null, task.size, 0) }
								: current);
							notify("文献捕获完成，文件已归档到课题，按钮已点亮");
							void onChanged();
							timer = setTimeout(() => setCaptureHint((current) => current?.taskId === taskId ? null : current), 5000);
							return;
						}
						if (["failed", "expired", "cancelled"].includes(task?.status)) {
							void cancelWebVpnCaptureViaShell(taskId).catch(() => {});
							setCaptureHint(null);
							notify(`文献捕获失败：${task?.error || "任务未完成"}`);
							return;
						}
					} catch { /* 临时查询失败时继续等待，服务端恢复后会再次检查 */ }
					timer = setTimeout(() => void poll(), 1500);
				};
				void poll();
				return () => { disposed = true; clearTimeout(timer); };
			}, [captureHint?.taskId, call, onChanged]);
			// 捕获期间轮询 WebVPN 会话状态，把「加载出版社页 / 等待下载 / 归档中」的
			// 过程提示反映到捕获提示条上。服务端任务状态只在完成/失败时才变化，中间
			// 阶段必须靠这条轮询补上，否则用户点完按钮后没有任何进度反馈。
			useEffect(() => {
				const taskId = captureHint?.taskId;
				if (!taskId || captureHint?.route !== "webvpn") return undefined;
				let disposed = false;
				let timer;
				const poll = async () => {
					try {
						const [status, taskResult] = await Promise.all([
							webVpnStatusViaShell(),
							call("manual_capture_get", { request: { taskId } }).catch(() => null)
						]);
						if (disposed || !status) return;
						// C20：插件的 view 是「同一份真相」，能拿到就直接用它 ——
						// 前端不再按 shell state 自己猜一遍，双源矛盾就没有来源了。
						const view = taskResult?.view;
						if (view) {
							setCaptureHint((current) => current?.taskId === taskId
								? {
									...current,
									phase: {
										text: view.message,
										tone: view.ball?.tone === "complete" ? "complete" : view.ball?.tone === "error" ? "error" : view.ball?.tone === "busy" ? "busy" : "waiting",
										progress: ["busy", "complete"].includes(view.ball?.tone),
										complete: view.ball?.tone === "complete",
										actionable: view.requiresUserAction || view.ball?.stalled
									},
									canRecreate: Boolean(view.ball?.canRecreate),
									canCancel: Boolean(view.ball?.canCancel)
								}
								: current);
							if (view.phase === "completed") { timer = setTimeout(() => void poll(), 1200); return; }
							if (view.requiresUserAction && view.phase !== "cancelled") {
								// 终态：不再空转轮询，交给提示条上的「重建 / 终止」。
								return;
							}
						} else if (status.state === "error") {
							const message = status.lastError || "页面自动下载失败，请重试";
							await call("manual_capture_cancel", { request: { taskId, reason: message } }).catch(() => {});
							if (disposed) return;
							setCaptureHint(null);
							notify(message);
							return;
						} else {
							setCaptureHint((current) => current?.taskId === taskId
					? { ...current, phase: capturePhaseOf(status.state, status.lastError, status.downloadEventBytes ?? 0, status.downloadElapsedMs, status.automationStage, {
									stalled: status.stalled,
									stalledMs: status.stalledMs,
									documentType: status.documentType,
									downloadTotalBytes: status.downloadTotalBytes,
									alternateEntry: status.alternateEntry
								}) }
								: current);
						}
					} catch { /* shell 暂不可达时静默，下一轮重试 */ }
					timer = setTimeout(() => void poll(), 1200);
				};
				void poll();
				return () => { disposed = true; clearTimeout(timer); };
			}, [captureHint?.taskId, captureHint?.route]);
			/**
			 * 点击未获取的 PDF/SI：Windows 桌面应用创建一次性任务，把本机 handoff
			 * 页面交给外部 Edge；扩展只在 handoff 页面完成布防。普通 Web 宿主不再
			 * 直接与扩展通信。
			 */
			/**
			 * C19：用同一篇文献重建获取任务。旧任务被作废并写明原因，新任务立刻排队；
			 * 重建不需要用户再次确认（AI 已获授权），这是现场最需要的一步。
			 */
			const recreateCapture = async (event) => {
				event?.stopPropagation?.();
				const taskId = captureHint?.taskId;
				if (!taskId || captureStopping) return;
				setCaptureStopping(true);
				try {
					if (captureHint.route === "scientific") {
						const rebuilt = await nativeBrowser("capture", { projectId, bundleId: captureHint.bundleId, kind: captureHint.kind });
						setCaptureHint((current) => current?.taskId === taskId ? { ...current, taskId: rebuilt.task.id, canRecreate: false, phase: null } : current);
						notify("捕获任务已重建，请在科研浏览器中重新点击下载。");
						return;
					}
					const rebuilt = await call("manual_capture_recreate", { request: { taskId, reason: "用户从提示条重建文献获取" } });
					await cancelWebVpnCaptureViaShell(taskId).catch(() => {});
					setCaptureHint((current) => current?.taskId === taskId
						? { ...current, taskId: rebuilt?.task?.id || taskId, canRecreate: false, route: "webvpn", phase: { text: "已重建获取任务，正在重新接管…", tone: "waiting" } }
						: current);
					notify("已用同一篇文献重建获取任务");
				} catch (reason) {
					notify(reason?.message || "重建获取任务失败，请重试");
				} finally {
					setCaptureStopping(false);
				}
			};
			const cancelCapture = async (event) => {
				event?.stopPropagation?.();
				const taskId = captureHint?.taskId;
				if (!taskId || captureStopping) return;
				const pendingHint = captureHint;
				setCaptureStopping(true);
				// 先卸载轮询，避免服务端返回 cancelled 时又弹一条“捕获失败”。
				setCaptureHint(null);
				try {
					const [shellResult, taskResult] = await Promise.allSettled([
						cancelWebVpnCaptureViaShell(taskId),
						call("manual_capture_cancel", { request: { taskId, reason: "用户手动终止文献下载" } })
					]);
					if (shellResult.status === "rejected" && taskResult.status === "rejected") {
						setCaptureHint(pendingHint);
						throw shellResult.reason || taskResult.reason;
					}
					notify(pendingHint.route === "scientific" ? "已终止下载；科研窗口保留，可重新点击正文或 SI。" : "已终止下载并关闭文献浏览器；可重新点击正文或 SI 进入");
				} catch (reason) {
					notify(reason?.message || "终止下载失败，请重试");
				} finally {
					setCaptureStopping(false);
				}
			};
			const armCaptureFor = (event, bundle, kind) => {
 event.stopPropagation();
 void (async () => {
  try {
   if (!await nativeDesktopAvailable()) { legacyArmCaptureFor(event, bundle, kind); return; }
   const created = await nativeBrowser("capture", { projectId, bundleId: bundle.id, kind });
   setCaptureHint({ bundleId: bundle.id, kind, taskId: created.task.id, route: "scientific" });
   notify("捕获已准备好，请在科研浏览器中点击正文或补充材料下载。");
  } catch (error) { notify(error.message); }
 })();
};
const legacyArmCaptureFor = (event, bundle, kind) => {
				event.stopPropagation();
				// Nature Portfolio / SpringerLink 的 SI 托管在公开的 Springer 静态附件域名。
				// 经学校 WebVPN 转发大文件可能返回 502，因此这两类 DOI 的 SI
				// 在同一个受控侧栏里走直连；正文仍使用 WebVPN 授权链路。
				const { publisher, directSpringerSi, publisherUrl } = captureRouteForBundle(bundle, kind);
				if (!publisherUrl) {
					// 未登记 DOI/出版社页面：不再只弹一句提示。用户点的是「尚未获取」，
					// 意图是去把它找来——直接把软件内浏览器打开到 WebVPN 门户
					// （初始页由配置的 portal_url 决定，默认中国科大），可自行检索。
					void (async () => {
						try {
							await openWebVpnLoginViaShell();
							notify("该文献未登记 DOI/出版社页面；已在侧栏打开 WebVPN 门户，可手动检索后下载");
						} catch (reason) {
							notify(`无法打开文献浏览器：${reason?.message || "该文献未登记 DOI，也没有出版社页面"}`);
						}
					})();
					return;
				}
				// Desktop（desktop-edge-handoff）：任务在外部 Edge 中完成。本页面运行在
				// WebView2 的 iframe 内，看不到 __TAURI_INTERNALS__，因此经 postMessage
				// 请求桌面 shell 调起 open_in_edge；shell 校验 loopback 后打开 handoff 页。
				if (desktopEdgeHandoff) {
					void (async () => {
						const iwan = await iwanStatusViaShell().catch(() => null);
						const active = await webVpnStatusViaShell().catch(() => null);
						// 只有「确实在捕获中」才不重新导航。早期版本在这里对同一篇直接
						// 早退、只把浏览器带回前台：WebVPN 登录会把目标页顶成门户首页，
						// 登录后再点同一篇就永远停在门户上（2026-09-23 反馈）。现在空闲
						// （ready / waiting-login / error）一律重新建任务并导航到目标页。
						const captureInProgress = Boolean(active?.pendingTaskId)
							|| ["navigating", "waiting-download", "downloading", "uploading"].includes(active?.state);
						if (captureInProgress) {
							// 已有任务在处理时也必须把浏览器带回前台：否则用户点了「尚未获取」
							// 却什么都没发生，只能靠顶部的「打开 WebVPN」自救。
							if (active?.windowOpen) {
								try { await showWebVpnViaShell(); } catch { /* 显示失败时下面的提示仍会给出出路 */ }
							}
							notify(captureHint?.bundleId === bundle.id && captureHint?.kind === kind
								? `已返回当前${kind === "pdf" ? "正文" : "SI"}下载页面`
								: `已有${active.pendingKind === "si" ? "补充材料" : "正文"}正在处理；可点状态条上的“终止下载”后再启动另一项`);
							return;
						}
						const result = await call("manual_capture_create", { request: { projectId: bundle.projectId, bundleId: bundle.id, kind } });
							if (!result) return;
							const task = result?.task;
							const token = task?.token;
							if (!task?.id || !token) throw new Error("创建捕获任务失败：响应缺少一次性令牌，请刷新后重试");
							try {
								await openWebVpnCaptureViaShell({ taskId: task.id, kind: task.kind, targetUrl: publisherUrl, token, directAccess: directSpringerSi });
								setCaptureHint({ bundleId: bundle.id, kind: task.kind, taskId: task.id, route: "webvpn" });
								notify(iwan?.usable
									? `iWAN 全部路由可用，已直访出版社页面，请手动点击${task.kind === "pdf" ? "正文及预览器保存" : "补充材料"}下载入口`
									: directSpringerSi
										? "Nature/Springer SI 为公开附件，已在软件侧栏中直连打开，请手动点击下载入口"
										: `已在 WebVPN 侧栏打开出版社页面，请手动点击${task.kind === "pdf" ? "正文及预览器保存" : "补充材料"}下载入口`);
							} catch (webvpnError) {
								// 命令响应丢失时，Rust 侧可能已经布防成功。先按任务 ID
								// 撤销本地待下载状态。已适配出版社固定在软件内，失败时不再切到 Edge。
								try { await cancelWebVpnCaptureViaShell(task.id); } catch { /* 尚未布防时无需处理 */ }
								if (["nature", "springer", "science", "elsevier", "acs", "rsc", "ieee", "wiley"].includes(publisher)) {
									setCaptureHint(null);
									throw new Error(`${publisher} ${kind === "si" && directSpringerSi ? "SI 直连" : "WebVPN"}打开失败：${webvpnError.message}`);
								}
								const handoffUrl = `${location.origin}/lab/capture/?taskId=${encodeURIComponent(task.id)}#t=${encodeURIComponent(token)}`;
								await openInEdgeViaShell(handoffUrl);
								setCaptureHint({ bundleId: bundle.id, kind: task.kind, taskId: task.id, route: "edge" });
								notify(`WebVPN 打开失败，已切换到 Microsoft Edge：${webvpnError.message}`);
							}
						})()
						.catch((reason) => notify(reason.message || "创建捕获任务失败"));
					return;
				}
				notify("文献自动捕获仅支持 iBM Lab Agent Windows 桌面应用");
			};
			const markBusy = (key, value) => setBusy((old) => ({ ...old, [key]: value }));
			const run = async (key, work) => {
				if (busy[key]) return;
				markBusy(key, true);
				try { await work(); }
				catch (reason) { notify(reason.message || "操作失败"); }
				finally { markBusy(key, false); }
			};
			const risFor = (search) => run(`ris:${search.id}`, async () => {
				const result = await call("tasks_search_ris", { request: { runId: search.id } });
				const saved = await saveRis(result.ris.fileName, result.ris.text);
				if (saved.cancelled) { notify("已取消保存 RIS"); return; }
				notify(`${saved.native ? "已保存" : "已开始下载"} ${result.ris.fileName}（${result.ris.count} 条文献）`);
			});
			// 综述：把「写综述」变成一次带完整指令的任务对话，产物由 Agent 用
			// lab_tasks_register_review / lab_tasks_register_review_presentation 落到检索条目。
			const reviewArtifactUrl = (search, variant) => `/api/lab-artifacts?kind=${variant === "ppt" ? "review-ppt" : "review"}&runId=${encodeURIComponent(search.id)}`;
			const writeReview = (search) => run(`review:${search.id}`, async () => {
				const inputs = await call("tasks_review_inputs", { request: { runId: search.id, projectId: search.projectId } });
				const prompt = [
					`请对文献检索条目「${inputs.title || search.title || search.query || search.id}」撰写一篇文献综述。`,
					`第一步：调用 lab_tasks_get_review_inputs（runId=${search.id}），它返回 contractPath=${inputs.contractPath}；用 read 把这份「综述生成契约」完整读完（较长时用 offset/limit 分段）。`,
					`第二步：严格按契约的章节骨架写综述；按主题归类组织，禁止逐篇罗列摘要；每个论断标注来源文献。`,
					`第三步：只允许引用本次检索到的 ${inputs.resultCount} 条文献（契约中有清单），不得引入未检索到的内容。`,
					`第四步：写完后调用 lab_tasks_register_review（runId=${search.id}）登记；若需要汇报 PPT，再按 PPT 模板构建并调用 lab_tasks_register_review_presentation 登记。`
				].join("\n");
				onRequestArtifact(prompt);
			});
			const openReview = (search, variant) => {
				const url = reviewArtifactUrl(search, variant);
				const opened = window.open(url, "_blank");
				if (!opened) notify("浏览器拦截了综述窗口，请允许弹出窗口后重试");
			};
			const deleteSearch = (search) => {
				if (!window.confirm(`确定删除检索记录“${search.title || search.query || search.id}”吗？`)) return;
				void run(`delete-search:${search.id}`, async () => {
					await call("tasks_search_delete", { request: { runId: search.id, projectId: search.projectId } });
					if (expandedSearch === search.id) setExpandedSearch(null);
					notify("检索记录已删除");
					await onChanged();
				});
			};
			const deleteReport = (report, bundle) => {
				const name = report.titleZh || bundle.title || report.shortCitation || report.id;
				if (!window.confirm(`确定删除精读条目“${name}”吗？关联的精读报告、PPT 和本地文献归档也会一并删除。`)) return;
				void run(`delete-report:${report.id}`, async () => {
					if (captureHint?.bundleId === bundle.id) {
						if (captureHint.taskId) await cancelWebVpnCaptureViaShell(captureHint.taskId).catch(() => {});
						setCaptureHint(null);
					}
					if (preview?.report?.id === report.id) setPreview(null);
					await call("tasks_report_delete", { request: { reportId: report.id, projectId: report.projectId } });
					setOverview((old) => { const next = { ...old }; delete next[report.id]; return next; });
					notify("精读条目已删除");
					await onChanged();
				});
			};
			const openOverview = (report) => run(`ov:${report.id}`, async () => {
				if (!(report.id in overview)) {
					const result = await call("tasks_overview", { request: { reportId: report.id } });
					setOverview((old) => ({ ...old, [report.id]: result.overview.summary }));
				} else {
					setOverview((old) => { const n = { ...old }; delete n[report.id]; return n; });
				}
			});
			const reviewPanel = (detail, title) => {
				if (!detail) return null;
				const findings = detail.findings || [];
				return h("div", { className: "ib-review-detail" },
					h("div", { className: "ib-review-detail-head" }, h("b", null, title), h("span", null, detail.ok ? "未发现明显问题" : "提醒项（不阻断审核）")),
					findings.length ? h("div", { className: "ib-review-findings" }, findings.map((finding, index) => h("div", { className: "ib-review-finding", "data-level": finding.level || finding.severity, key: `${finding.code || "item"}-${index}` }, h("i", null, finding.level || finding.severity || "info"), h("span", null, `${finding.code ? `${finding.code}：` : ""}${finding.message || ""}`)))) : h("div", { className: "ib-lit-note" }, detail.summary?.summary || "暂无结构化评审条目。")
				);
			};
			const reviewContext = (target = preview) => target?.kind === "ppt"
				? { key: `ppt:${target.presentation.id}`, request: { runId: target.presentation.id }, row: target.presentation }
				: { key: `report:${target.report.id}`, request: { reportId: target.report.id }, row: target?.report };
			const ensureMachineReview = async (target = preview) => {
				const context = reviewContext(target);
				if (machineReviews[context.key]) return machineReviews[context.key];
				let detail;
				try {
					const result = await call("tasks_review_details", { request: context.request });
					detail = result.review;
				} catch (reason) {
					// 自查不可用也不能变成人审门禁；把失败本身作为提醒展示。
					detail = { ok: false, findings: [{ level: "warning", code: "SELF_CHECK_UNAVAILABLE", message: reason.message || "自动自查详情暂时不可用，请以人工检查为准。" }] };
				}
				setMachineReviews((old) => ({ ...old, [context.key]: detail }));
				return detail;
			};
			// Desktop does not use an in-app Office preview or a review gate: save the
			// actual DOCX/PPTX and let the user's default Office/WPS association open it.
			const openPreview = (target) => {
				const isPpt = target.kind === "ppt";
				const key = `${isPpt ? "open-ppt" : "open-report"}:${target.report.id}`;
				void run(key, async () => {
					const url = isPpt
						? `/api/lab-artifacts?kind=ppt&reportId=${encodeURIComponent(target.report.id)}`
						: `/api/lab-artifacts?kind=report&format=docx&reportId=${encodeURIComponent(target.report.id)}`;
					const opened = await openOfficeArtifact(url);
					notify(opened.native ? `${isPpt ? "PPT" : "精读报告"} 已交给本机 Office/WPS 打开` : `${isPpt ? "PPT" : "精读报告"} 已下载`);
				});
			};
			const closePreview = () => { setPreview(null); setReviewVisible(false); setApproval(null); };
			const toggleMachineReview = () => {
				if (reviewVisible) { setReviewVisible(false); return; }
				const context = reviewContext();
				void run(`mr:${context.key}`, async () => { await ensureMachineReview(); setReviewVisible(true); });
			};
			const downloadReport = (report) => run(`rep:${report.id}`, async () => {
				const saved = await downloadOfficeArtifact(`/api/lab-artifacts?kind=report&format=docx&reportId=${encodeURIComponent(report.id)}`);
				notify(saved.native ? `报告下载成功\n保存位置：${saved.filePath || saved.fileName}` : `报告下载已开始：${saved.fileName}`);
			});
			const downloadPpt = (report) => run(`ppt:${report.id}`, async () => {
				const saved = await downloadOfficeArtifact(`/api/lab-artifacts?kind=ppt&reportId=${encodeURIComponent(report.id)}`);
				notify(saved.native ? `PPT 下载成功\n保存位置：${saved.filePath || saved.fileName}` : `PPT 下载已开始：${saved.fileName}`);
			});
			const rejectArtifact = () => {
				const context = reviewContext();
				void run(`reject:${context.key}`, async () => {
					const note = window.prompt(preview.kind === "ppt" ? "请输入 PPT 退回修改意见（可留空）：" : "请输入报告退回修改意见（可留空）：", "");
					if (note === null) return;
					if (preview.kind === "ppt") await call("tasks_presentation_review", { request: { fields: { runId: preview.presentation.id, decision: "rejected", note } } });
					else await call("tasks_report_review", { request: { fields: { reportId: preview.report.id, decision: "rejected", note } } });
					notify(preview.kind === "ppt" ? "文献 PPT 已退回修改" : "精读报告已退回修改");
					await onChanged();
					closePreview();
				});
			};
			const beginApproval = () => {
				const context = reviewContext();
				void run(`approve-check:${context.key}`, async () => {
					const detail = await ensureMachineReview();
					setReviewVisible(true);
					setApproval({ stage: "confirm", detail });
				});
			};
			const confirmApproval = () => {
				const target = preview;
				const context = reviewContext(target);
				void run(`approve:${context.key}`, async () => {
					let updated;
					if (target.kind === "ppt") {
						const result = await call("tasks_presentation_review", { request: { fields: { runId: target.presentation.id, decision: "approved", note: "已在预览页人工确认自查提醒与分页版式" } } });
						updated = result.run;
						setPreview((old) => old ? { ...old, presentation: updated } : old);
					} else {
						const result = await call("tasks_report_review", { request: { fields: { reportId: target.report.id, decision: "approved", note: "已在预览页人工确认自查提醒与分页版式" } } });
						updated = result.report;
						setPreview((old) => old ? { ...old, report: updated } : old);
					}
					setApproval((old) => ({ ...old, stage: "approved" }));
					notify(target.kind === "ppt" ? "文献 PPT 已人工审阅通过，可立即下载" : "精读报告已人工审阅通过，可立即下载");
					await onChanged();
				});
			};
			const parseJournalCitation = (...values) => {
				const pattern = /\*?([A-Z][A-Za-z.&' -]*?)\*?\s+(\d+[A-Za-z]?)\s*[,：:]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)\s*(?:\((\d{4})\)|,\s*(\d{4}))/g;
				for (const value of values) {
					const matches = [...String(value || "").matchAll(pattern)];
					const match = matches.at(-1);
					if (!match) continue;
					const journal = match[1].trim();
					const pages = match[3].replace(/\s*[-–—]\s*/g, "–");
					const suffix = ` ${match[2]}, ${pages} (${match[4] || match[5]}).`;
					return { journal, suffix, text: `${journal}${suffix}` };
				}
				return null;
			};
			const citationOf = (report) => parseJournalCitation(report.shortCitation, titleByBundle[report.bundleId]);
			const shortOf = (report) => citationOf(report)?.text || report.shortCitation || titleByBundle[report.bundleId] || `精读报告 ${report.id.slice(0, 12)}`;
			const shortNode = (report) => {
				const citation = citationOf(report);
				return citation ? h(React.Fragment, null, h("i", null, citation.journal), citation.suffix) : shortOf(report);
			};
			const zhOf = (report) => report.titleZh || shortOf(report);
			const paperCitation = (paper) => {
				const journal = paper.journal || paper.source || (paper.arxivId ? "arXiv" : "未知来源");
				const pages = paper.pages ? String(paper.pages).replace(/(\d)\s*-\s*(\d)/g, "$1–$2") : "";
				const bibliographic = `${paper.volume ? ` ${paper.volume}` : ""}${pages ? `${paper.volume ? ", " : " "}${pages}` : ""}${paper.year ? ` (${paper.year})` : ""}.`;
				const description = String(paper.shortDescriptionZh || "摘要待提炼").replace(/[（）()\s]/g, "").slice(0, 9);
				const target = paper.pdfUrl || paper.landingUrl || (paper.doi ? `https://doi.org/${paper.doi}` : undefined);
				// PDF / SI 按钮：已登记本地文件（bundle 或全文下载队列）→ 可下载；否则跳转 DOI 页面。
				const doiUrl = paper.doi ? `https://doi.org/${encodeURIComponent(paper.doi)}` : (paper.landingUrl || paper.pdfUrl || undefined);
				const pdfReady = !!paper.localPdfUrl;
				const siReady = !!paper.localSiUrl;
				const openExternal = (event, url) => { event.stopPropagation(); if (url) void openExternalUrl(url).catch((reason) => notify(reason.message)); };
				const saveFile = (event, url) => { event.stopPropagation(); void downloadVerifiedBinary(url).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message)); };
				// 与精读条目一致：检索条目交给外部 Edge 时也显示"正在打开"，失败必须 toast。
				const searchKey = paper.doi || paper.pmid || paper.arxivId || paper.id || paper.title;
				const searchOpenKey = (kind) => `${kind}:search:${searchKey}`;
				const openSearchInSidebar = (event, kind, url) => {
					event.stopPropagation();
					if (opening[searchOpenKey(kind)]) return;
					setOpening((old) => ({ ...old, [searchOpenKey(kind)]: true }));
					void openReader({projectId,bundleId:new URL(url,location.origin).searchParams.get('bundleId'),kind})
						.catch((reason) => notify(`无法打开${kind === "pdf" ? "正文 PDF" : "SI PDF"}：${reason?.message ?? reason}`))
						.finally(() => setOpening((old) => { const next = { ...old }; delete next[searchOpenKey(kind)]; return next; }));
				};
				return h("article", { className: "ib-search-paper", key: paper.doi || paper.pmid || paper.arxivId || paper.id || paper.title },
					h("div", { className: "ib-search-citation" }, h("i", null, journal), bibliographic, h("span", null, `（${description}）`), target ? h("a", { href: target, target: "_blank", rel: "noopener noreferrer", onClick: (event) => event.stopPropagation() }, paper.pdfUrl ? "PDF" : "原文") : null),
					h("small", { title: paper.title }, paper.title),
					h("div", { className: "ib-search-actions" },
						h("button", { className: "ib-icon-btn", "data-ready": pdfReady ? "true" : "false", "data-opening": opening[searchOpenKey("pdf")] ? "true" : undefined, disabled: !!opening[searchOpenKey("pdf")], title: opening[searchOpenKey("pdf")] ? "正在打开正文 PDF…" : (pdfReady ? "在侧栏阅读正文 PDF" : "未提交 PDF · 点击前往 DOI 页面"), onClick: (event) => pdfReady ? openSearchInSidebar(event, "pdf", paper.localPdfUrl) : openExternal(event, doiUrl), "aria-label": "PDF 原文" }, h(BookSvg, null)),
						h("button", { className: "ib-icon-btn", "data-ready": siReady ? "true" : "false", "data-opening": opening[searchOpenKey("si")] ? "true" : undefined, disabled: !!opening[searchOpenKey("si")], title: opening[searchOpenKey("si")] ? "正在打开 SI PDF…" : (siReady ? (paper.localSiIsPdf ? "在外部 Microsoft Edge 中打开 SI PDF" : "下载 SI 补充材料") : "未提交 SI · 点击前往 DOI 页面"), onClick: (event) => siReady ? (paper.localSiIsPdf ? openSearchInSidebar(event, "si", paper.localSiUrl) : saveFile(event, paper.localSiUrl)) : openExternal(event, doiUrl), "aria-label": "SI 补充材料" }, h(SiSvg, null))
					)
				);
			};
			const previewRow = preview?.kind === "ppt" ? preview?.presentation : preview?.report;
			const previewContext = preview ? reviewContext(preview) : null;
			const previewDetail = previewContext ? machineReviews[previewContext.key] : null;
			const previewApproved = previewRow?.review?.status === "approved";
			const downloadPreviewArtifact = () => preview?.kind === "ppt" ? downloadPpt(preview.report) : downloadReport(preview.report);
			const approvalNode = approval ? h("div", { className: "ib-approval-shade" },
				h("section", { className: "ib-approval-card", role: approval.stage === "approved" ? "status" : "alertdialog", "aria-label": approval.stage === "approved" ? "审核通过" : "审核通过二次确认" },
					approval.stage === "approved" ? h(React.Fragment, null,
						h("div", { className: "ib-approval-ok" }, h("strong", null, "审核通过"), h("span", null, `${preview?.kind === "ppt" ? "PPTX" : "DOCX"} 已开放下载；你也可以关闭此页面后继续在预览窗口下载。`)),
						h("div", { className: "ib-approval-actions" },
							h("button", { className: "ib-preview-btn", onClick: () => setApproval(null) }, "返回预览"),
							h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[preview?.kind === "ppt" ? `ppt:${preview?.report.id}` : `rep:${preview?.report.id}`], onClick: () => void downloadPreviewArtifact() }, preview?.kind === "ppt" ? "下载PPT" : "下载DOCX")
						)
					) : h(React.Fragment, null,
						h("h3", null, "审核通过前请确认自查提醒"),
						h("p", null, "自动自查仅供参考，不构成通过门限。请结合上方实际分页预览人工判断；点击确认后将锁定当前文件版本并开放下载。"),
						reviewPanel(approval.detail, preview?.kind === "ppt" ? "PPT 自动自查提醒" : "报告自动自查提醒"),
						h("div", { className: "ib-approval-actions" },
							h("button", { className: "ib-preview-btn", onClick: () => setApproval(null) }, "返回继续检查"),
							h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[`approve:${previewContext?.key}`], onClick: confirmApproval }, busy[`approve:${previewContext?.key}`] ? "提交中…" : "二次确认并通过")
						)
					)
				)
			) : null;
			const previewNode = preview ? h(React.Fragment, null,
				h("div", { className: "ib-preview-backdrop", onClick: closePreview }),
				h("aside", { className: "ib-preview-drawer", role: "dialog", "aria-modal": "true", "aria-label": preview.kind === "ppt" ? "PPT 人工审核预览" : "DOCX 人工审核预览" },
					h("div", { className: "ib-preview-head" },
						h("div", { className: "ib-preview-title" }, h("b", null, preview.kind === "ppt" ? `${shortOf(preview.report)} · 文献汇报 PPT` : `${shortOf(preview.report)} · 精读报告`), h("small", null, preview.kind === "ppt" ? "实际 PPTX 经 LibreOffice 渲染的分页预览" : "实际 DOCX 经 LibreOffice 渲染的分页预览")),
						h("span", { className: "ib-preview-state" }, statusOf(previewRow)),
						h("button", { className: "ib-preview-btn", onClick: closePreview, "aria-label": "关闭预览" }, "关闭")
					),
					h("iframe", { className: "ib-preview-frame", title: preview.kind === "ppt" ? "PPT 分页预览" : "Word 分页预览", src: `/api/lab-artifacts?preview=1&kind=${preview.kind === "ppt" ? "ppt" : "report"}&format=docx&reportId=${encodeURIComponent(preview.report.id)}&v=${encodeURIComponent(previewRow?.artifactSha256 || previewRow?.updatedAt || "current")}` }),
					reviewVisible ? h("div", { className: "ib-preview-review" }, reviewPanel(previewDetail, preview.kind === "ppt" ? "PPT 自动自查提醒（仅供参考）" : "报告自动自查提醒（仅供参考）")) : null,
					h("div", { className: "ib-preview-foot" },
						h("div", { className: "ib-preview-foot-note" }, previewRow?.status === "under-review" ? "请逐页检查内容与版式；审核通过时会先弹出自查提醒供二次确认。" : (previewApproved ? "该版本已人工审核通过，可在此直接下载原文件。" : "该版本已退回，Agent 修订并重新暂存后可再次审核。")),
						h("button", { className: "ib-preview-btn", disabled: busy[`mr:${previewContext?.key}`], onClick: toggleMachineReview }, busy[`mr:${previewContext?.key}`] ? "加载中…" : (reviewVisible ? "收起提醒" : "自查提醒")),
						h("button", { className: "ib-preview-btn", disabled: !previewApproved || busy[preview.kind === "ppt" ? `ppt:${preview.report.id}` : `rep:${preview.report.id}`], onClick: () => void downloadPreviewArtifact(), title: previewApproved ? "下载已人工审核的原文件" : "人工审核通过后开放下载" }, preview.kind === "ppt" ? "下载PPT" : "下载DOCX"),
						previewRow?.status === "under-review" ? h("button", { className: "ib-preview-btn", "data-danger": true, disabled: busy[`reject:${previewContext?.key}`], onClick: rejectArtifact }, "退回修改") : null,
						previewRow?.status === "under-review" ? h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[`approve-check:${previewContext?.key}`], onClick: beginApproval }, busy[`approve-check:${previewContext?.key}`] ? "读取自查…" : "审核通过") : null
					),
					approvalNode
				)
			) : null;
			return h(React.Fragment, null, h("div", { className: "ib-lit" },
				// ── 分组一：检索记录 ────────────────────────────────────────────────
				// 视觉改版：不再套「文献资料」外层大框与重复标题、不再写布局
				// 说明文字；分组标题 + 条目列表直接铺在内容区，靠留白与细分隔线区分。
				h("section", { className: "ib-lit-group", key: "searches" },
					h("div", { className: "ib-group-head" },
						h("h3", null, "检索记录"),
						h('button',{className:'ib-act',disabled:importingRis,onClick:()=>risPicker.current?.click()},importingRis?'正在导入…':'上传 RIS'),
						h('input',{type:'file',accept:'.ris',hidden:true,ref:risPicker,onChange:event=>void importRis(event.target.files?.[0])}),
						h("span", { className: "ib-group-count" }, `${searches.length} 条`)),
					searches.length ? h("div", { className: "ib-lit-list" }, searches.slice().reverse().map((search) => {
						const resultCount = (search.results || []).length;
						const expanded = expandedSearch === search.id;
						return h("div", { className: "ib-lit-item", key: search.id },
						// 人工审核要求：点击检索条目不得跳转到对应对话，因此整行不再是可点区域。
						h("div", { className: "ib-lit-row" },
							h("div", { className: "ib-lit-main" },
								h("b", { className: "ib-lit-title" }, search.title || search.query || search.id),
								h("div", { className: "ib-lit-meta" }, `${resultCount} 篇 · ${search.importedRis ? "人工 RIS 导入 · " : ""}${(search.queries || [search.query]).filter(Boolean).length} 轮查询 · OA ${(search.results || []).filter((row) => row.isOa === true).length} · ${(search.sources || []).join("/") || "未知来源"}${(search.sourceFailures || []).length ? ` · ${search.sourceFailures.length} 个源降级` : ""} · ${when(search.updatedAt || search.createdAt)}`)),
							h("div", { className: "ib-lit-acts" },
								// 主入口只有一个：查看文献（= 展开本会话全部去重文献）
								h("button", { className: "ib-act", "data-kind": "accent", disabled: !resultCount, onClick: (event) => { event.stopPropagation(); setExpandedSearch((value) => value === search.id ? null : search.id); }, title: "展开本会话的全部去重文献" }, expanded ? "收起文献" : "查看文献"),
								// 写综述 / 打开综述 / 导出 RIS / 删除全部平铺在右侧，不收起、不弹层。
								h("button", { className: "ib-act", "data-ready": search.review?.status === "ready" ? "true" : undefined, disabled: !!busy[`review:${search.id}`] || !resultCount, onClick: (event) => { event.stopPropagation(); void writeReview(search); }, title: search.review?.status === "ready" ? "已有综述：重新生成或覆盖提交" : "在当前课题工作区新建对话，按综述模板写这篇综述" }, busy[`review:${search.id}`] ? "…" : (search.review?.status === "ready" ? "重写综述" : "写综述")),
								search.review?.status === "ready" ? h("button", { className: "ib-act", "data-kind": "reading", "data-done": "true", onClick: (event) => { event.stopPropagation(); openReview(search, "report"); }, title: "打开综述报告（Markdown）" }, "打开综述") : null,
								search.reviewPresentation?.status === "ready" ? h("button", { className: "ib-act", "data-kind": "ppt", "data-done": "true", onClick: (event) => { event.stopPropagation(); openReview(search, "ppt"); }, title: "打开综述汇报 PPT" }, "打开综述 PPT") : null,
								h("button", { className: "ib-act", disabled: !!busy[`ris:${search.id}`] || !resultCount, onClick: (event) => { event.stopPropagation(); void risFor(search); }, title: "导出本会话去重文献的 RIS 并写入磁盘" }, busy[`ris:${search.id}`] ? "…" : "导出 RIS"),
								h("button", { className: "ib-act ib-act-danger", disabled: !!busy[`delete-search:${search.id}`], onClick: (event) => { event.stopPropagation(); deleteSearch(search); }, title: "删除这条检索记录" }, busy[`delete-search:${search.id}`] ? "…" : "删除"))
						),
						expanded ? h("div", { className: "ib-search-results", role: "list", "aria-label": `${search.title || "检索"}的全部文献` }, (search.results || []).map(paperCitation)) : null
					); })) : h("div", { className: "ib-lit-empty" }, "对话中的文献检索结果会按会话整理到这里。")
				),
				// ── 分组二：精读文献 ────────────────────────────────────────────────
				h("section", { className: "ib-lit-group", key: "reports" },
					h("div", { className: "ib-group-head" },
						h("h3", null, "精读文献"),
						h('button',{className:'ib-act',onClick:createFolder},'+ 文件夹'),
						h('button',{className:'ib-act',disabled:organizing||!reports.some(row=>row.paperCardPath),onClick:()=>void autoOrganize()},'Agent 自动分类'),
						h("span", { className: "ib-group-count" }, `${reports.length} 篇`)),
					folderEditor?h('form',{className:'ib-folder-editor',style:{display:'flex',gap:8,marginBottom:12},onSubmit:event=>{event.preventDefault();void folderAction('tasks_reading_folder_save',folderEditor).then(ok=>{if(ok)setFolderEditor(null);});}},h('input',{value:folderEditor.name,maxLength:80,autoFocus:true,'aria-label':'文件夹名称',placeholder:'文件夹名称，例如：核酸递送',onChange:event=>setFolderEditor({...folderEditor,name:event.target.value})}),h('button',{className:'ib-act',type:'submit'},'保存文件夹'),h('button',{className:'ib-act',type:'button',onClick:()=>setFolderEditor(null)},'取消')):null,
					h('div',{className:'ib-reading-folders',style:{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}},[{id:'all',name:'全部'},{id:'unfiled',name:'未分类'},...folders].map(folder=>h('button',{key:folder.id,className:'ib-act','data-selected':selectedFolder===folder.id?'true':undefined,style:selectedFolder===folder.id?{background:'#e4f2e9',color:'#23613b'}:undefined,onClick:()=>setSelectedFolder(folder.id)},`${folder.id==='all'?'':'📁 '}${folder.name} (${reports.filter(row=>folder.id==='all'||(folder.id==='unfiled'?!row.folderId:row.folderId===folder.id)).length})`)),folders.some(row=>row.id===selectedFolder)?h(React.Fragment,null,h('button',{className:'ib-act',onClick:()=>{setFolderEditor({id:selectedFolder,name:folders.find(row=>row.id===selectedFolder).name});}},'重命名'),h('button',{className:'ib-act',onClick:()=>{if(window.confirm('删除该分类文件夹？其中的文献将移到“未分类”，保留报告及归档文件。')){void folderAction('tasks_reading_folder_delete',{id:selectedFolder});setSelectedFolder('unfiled');}}},'删除文件夹')):null),
					filteredReports.length ? h("div", { className: "ib-lit-list" }, filteredReports.map((report) => {
						const presentation = presentationByReport[report.id];
						const bundle = bundleById[report.bundleId] || {};
						const awaitingPdf = bundle.acquisitionStatus === "awaiting-pdf";
						const publisherUrl = bundle.doi
							? `https://doi.org/${encodeURIComponent(bundle.doi)}`
							: (() => {
								if (bundle.sourceType === "wechat" || !bundle.sourceUrl) return undefined;
								try {
									const url = new URL(bundle.sourceUrl);
									return url.protocol === "https:" ? url.href : undefined;
								} catch { return undefined; }
							})();
						// legacy source-map-only 行把 JSON 存在 pdfPath：不当作可下载 PDF。
						const bundlePdfUrl = bundle.pdfPath && /\.pdf$/i.test(bundle.pdfPath) ? `/api/lab-artifacts?kind=pdf&bundleId=${encodeURIComponent(bundle.id)}` : undefined;
						const bundleSiUrl = bundle.siPath ? `/api/lab-artifacts?kind=si&bundleId=${encodeURIComponent(bundle.id)}` : undefined;
						const bundleSiIsPdf = /\.pdf$/i.test(bundle.siPath || "");
						const bundleSiIsZip = /\.zip$/i.test(bundle.siPath || "");
						const openKey = (kind) => `${kind}:${report.id}`;
						/** 正文/SI 在侧栏阅读；期间显示"正在打开"，失败必须 toast，不得静默。 */
						const openEntryInSidebar = (event, kind, url) => {
							event.stopPropagation();
							if (opening[openKey(kind)]) return;
							setOpening((old) => ({ ...old, [openKey(kind)]: true }));
							void openReader({projectId,bundleId:bundle.id,kind})
								.catch((reason) => notify(`无法打开${kind === "pdf" ? "正文 PDF" : "SI PDF"}：${reason?.message ?? reason}`))
								.finally(() => setOpening((old) => { const next = { ...old }; delete next[openKey(kind)]; return next; }));
						};
						const downloadBundleFile = (event, url) => { event.stopPropagation(); void downloadVerifiedBinary(url).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message)); };
						const revealBundleFile = (event, path) => { event.stopPropagation(); void revealSavedPathViaDesktop(path).catch((reason) => notify(reason.message)); };
						const captureActive = captureHint?.bundleId === bundle.id;
						// 作者/期刊/年份/DOI 只放进详情，不再作为常驻状态行显示。
						const metadata = [
							(bundle.authors || []).length ? bundle.authors.join(", ") : null,
							bundle.journal,
							bundle.year,
							bundle.doi ? `DOI ${bundle.doi}` : null
						].filter(Boolean).join(" · ");
						// 中文副标题：没有译文时保留可识别的原标题，绝不编造译名。
						const zhTitle = report.titleZh || bundle.title || null;
						// 精读 / PPT 的完成状态只用按钮填充色 + 完成图标表达。
						const readingDone = Boolean(report.docxPath);
						const translation=(bundle.translations??[]).filter(row=>row.kind==='pdf'&&(!bundle.pdfSha256||row.sourceSha256===bundle.pdfSha256)).at(-1);
						const translateEntry=async(event)=>{event.stopPropagation();try{const request={projectId,bundleId:bundle.id,kind:'pdf'};const result=await call('tasks_translation_create',{request});if(result.translation.status==='completed')await openReader({...request,mode:'zh'});else if(!result.reused)await onRequestArtifact(translationPrompt(request,result.translation.id),true);else notify('此翻译任务已在进行；打开正文侧栏可查看进度或取消后重试。');onChanged?.();}catch(error){notify('翻译启动失败：'+error.message);}};
						const readingBusy = Boolean(busy[`open-report:${report.id}`]);
						const pptDone = Boolean(presentation?.pptxPath);
						const pptBusy = Boolean(busy[`open-ppt:${report.id}`]);
						const paperName = report.titleZh || bundle.title || zhOf(report) || report.id;
						const readingPrompt = `请精读文献「${paperName}」（bundleId: ${report.bundleId || bundle.id || "未登记"}，reportId: ${report.id}）。先读取本课题已归档的 PDF/SI 和当前阅读笔记模板，按模板完成精读报告，并调用 lab_tasks_register_report 登记到该 reportId。完成精读后根据报告内容判断主题文件夹，先查看已有精读文件夹，优先复用；登记报告时提供 folderName 与 classificationReason 自动归类。`;
						const pptPrompt = `请为文献「${paperName}」（reportId: ${report.id}）制作汇报 PPT。先读取已归档 PDF/SI、已有精读报告和当前 PPT 模板，按模板生成 PPTX，并调用 lab_tasks_register_presentation 登记。`;
						return h("div", { className: "ib-lit-item", key: report.id },
							// 一行布局（与改版前一致）：左边标题区，右边操作区。操作区把
							// 次级原文按钮、200 字简介、精读、PPT、删除**全部平铺**出来，
							// 不再有任何下拉菜单。
							h("div", { className: "ib-lit-row" },
								h("div", { className: "ib-lit-main" },
									h("b", { className: "ib-lit-title ib-citation", title: shortOf(report) }, shortNode(report)),
									zhTitle ? h("div", { className: "ib-lit-zh", title: zhTitle }, zhTitle) : null,
									awaitingPdf ? h("div", null, h("span", { className: "ib-lit-flag" }, "原文待归档")) : null),
								h("div", { className: "ib-lit-acts" },
									// 次级操作：PDF / SI 一律是图标按钮——已归档点亮、未归档灰着，
									// 点灰的就去出版社页面布防捕获。不写字（原来的样式）。
									h("button", {
										className: "ib-icon-btn", "data-ready": bundlePdfUrl ? "true" : "false", "data-opening": opening[openKey("pdf")] ? "true" : undefined,
										disabled: !!opening[openKey("pdf")],
										title: opening[openKey("pdf")] ? "正在打开正文 PDF…" : (bundlePdfUrl
											? "在侧栏阅读正文 PDF"
											: (publisherUrl ? "尚未获取原文 · 点击前往出版社页面并布防捕获下载" : "尚未获取原文 · 未登记 DOI/出版社页面")),
										onClick: (event) => bundlePdfUrl ? openEntryInSidebar(event, "pdf", bundlePdfUrl) : armCaptureFor(event, bundle, "pdf"), "aria-label": "正文 PDF / 获取原文"
									}, h(BookSvg, null)),
									h("button", {
										className: "ib-icon-btn", "data-ready": bundleSiUrl ? "true" : "false", "data-opening": opening[openKey("si")] ? "true" : undefined,
										disabled: !!opening[openKey("si")],
										title: opening[openKey("si")] ? "正在打开 SI…" : (bundleSiUrl
											? "在侧栏打开 SI 补充材料"
											: (publisherUrl ? "尚未获取 SI · 点击前往出版社页面并布防捕获下载" : "尚未获取 SI · 未登记 DOI/出版社页面")),
										onClick: (event) => bundleSiUrl ? openEntryInSidebar(event, "si", bundleSiUrl) : armCaptureFor(event, bundle, "si"), "aria-label": "SI 补充材料 / 获取 SI"
									}, h(SiSvg, null)),
									h('button',{className:'ib-act',disabled:!bundlePdfUrl,onClick:translateEntry,title:'全文翻译并在侧栏进行中文/双语对照阅读'},translation?.status==='completed'?'阅读译文':['queued','running'].includes(translation?.status)?'翻译中…':'翻译'),
									// 简介（约 200 字，篇幅要求是给 Agent 的，不写进按钮文案）。
									h("button", { className: "ib-act", disabled: !!busy[`ov:${report.id}`], onClick: () => void openOverview(report), title: awaitingPdf ? "展开已提取的元数据摘要" : "展开文献概览" }, busy[`ov:${report.id}`] ? "…" : (report.id in overview ? "收起简介" : "简介")),
									h("button", {
										className: "ib-act", "data-kind": "reading", "data-done": readingDone ? "true" : undefined, "data-busy": readingBusy ? "true" : undefined,
										disabled: readingBusy,
										onClick: () => readingDone ? openPreview({ kind: "report", report }) : onRequestArtifact(readingPrompt),
										title: readingDone ? "打开已生成的精读报告" : "在当前课题工作区新建对话并预填精读任务"
									}, readingBusy ? h(SpinSvg, null) : null, readingBusy ? "打开中…" : (readingDone ? "打开精读" : "开始精读")),
									h("button", {
										className: "ib-act", "data-kind": "ppt", "data-done": pptDone ? "true" : undefined, "data-busy": pptBusy ? "true" : undefined,
										disabled: pptBusy,
										onClick: () => pptDone ? openPreview({ kind: "ppt", report, presentation }) : onRequestArtifact(pptPrompt),
										title: pptDone ? "打开已生成的汇报 PPT" : "在当前课题工作区新建对话并预填 PPT 任务"
									}, pptBusy ? h(SpinSvg, null) : null, pptBusy ? "打开中…" : (pptDone ? "打开 PPT" : "制作 PPT")),
									h('select',{value:report.folderId??'',title:report.classification?.reason??'调整精读文件夹',onChange:event=>void folderAction('tasks_reading_classify',{reportId:report.id,folderId:event.target.value})},h('option',{value:''},'未分类'),folders.map(folder=>h('option',{key:folder.id,value:folder.id},folder.name))),
									h("button", { className: "ib-act ib-act-danger", disabled: !!busy[`delete-report:${report.id}`], onClick: () => deleteReport(report, bundle), title: "删除这条精读条目（关联报告、PPT 与本地归档一并删除）" }, busy[`delete-report:${report.id}`] ? "…" : "删除"))
							),
							captureActive ? h("div", { className: "ib-capture-hint", "data-tone": captureHint?.phase?.tone || "waiting" },
								h("div", { className: "ib-capture-head" },
									h("div", { className: "ib-capture-label" }, captureHint?.phase?.text || `已布防：等待下一次 ${captureHint.kind === "pdf" ? "PDF" : "SI"} 下载…`),
									// C19：失去接管/停滞时最需要的是「重来一次」，所以给重建按钮，
									// 而不是只留一个「终止下载」。
									captureHint?.canRecreate ? h("button", { className: "ib-capture-stop", disabled: captureStopping, onClick: (event) => void recreateCapture(event) }, "重建任务") : null,
									!captureHint?.phase?.complete ? h("button", { className: "ib-capture-stop", disabled: captureStopping, onClick: (event) => void cancelCapture(event) }, captureStopping ? "终止中…" : "终止下载") : null
								),
								captureHint?.phase?.progress ? h("div", { className: "ib-capture-progress", "data-complete": captureHint.phase.complete ? "true" : undefined, role: "progressbar", "aria-label": "文献下载进度", "aria-valuenow": captureHint.phase.complete ? 100 : undefined, "aria-valuetext": captureHint.phase.text }, h("i", null)) : null
							) : (opening[openKey("pdf")] || opening[openKey("si")]) ? h("div", { className: "ib-capture-hint" }, `正在在外部 Microsoft Edge 中打开${opening[openKey("pdf")] ? "正文 PDF" : "SI PDF"}…`) : null,
							// 详情：作者/期刊/年份/DOI + 概览，全部按需展开，不占常驻空间。
							report.id in overview ? h("div", { className: "ib-lit-overview" },
								metadata ? h("small", { className: "ib-lit-overview-meta" }, metadata) : null,
								h("b", null, awaitingPdf ? "已提取的元数据摘要" : "文献概览（约 200 字）"),
								overview[report.id] ?? "加载中…",
								h("small", { className: "ib-lit-overview-time" }, `登记于 ${when(report.createdAt)}`)) : null
						);
					})) : h("div", { className: "ib-lit-empty" }, "尚无精读条目。可在对话中粘贴微信公众号文献链接先登记元数据，或完成报告生成后登记产物。")
				)
			), previewNode);
		}

export function Project({ call, project, onBack, onDelete, onStartChat }) {
 useEffect(() => { setDesktopProject(project.id); return () => setDesktopProject(null); }, [project.id]);
			const [state, setState] = useState({ loading: true, data: null, error: "" });
			const [tab, setTab] = useState("literature");
			const [draft, setDraft] = useState("");
			const [memoryOpen, setMemoryOpen] = useState(false);
			const memoryDirty = useRef(false);
			const [note, setNote] = useState("");
			const [saving, setSaving] = useState(false);
			const [launching, setLaunching] = useState(false);
			const [deleting, setDeleting] = useState(false);
			const [toast, setToast] = useState("");
			const load = useCallback(async () => {
				try { const data = await call("projects_workspace", { request: { projectId: project.id } }); setState({ loading: false, data, error: "" }); setDraft((current) => memoryDirty.current ? current : (data.memory?.markdown || "")); }
				catch (reason) { setState({ loading: false, data: null, error: reason.message }); }
			}, [project.id]);
			useEffect(() => {
                memoryDirty.current = false;
                try { const cached = sessionStorage.getItem(`ib-memory-draft:${project.id}`); if (cached !== null) { memoryDirty.current = true; setDraft(cached); } } catch { /* storage may be disabled */ }
                setMemoryOpen(false); void load();
            }, [load]);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 7000); return () => clearTimeout(timer); }, [toast]);
			const save = async () => {
				setSaving(true);
				try { const result = await call("projects_memory_update", { request: { fields: { projectId: project.id, markdown: draft, changeNote: note } } }); setToast(`核心记忆已提交为 v${result.memory.version}`); setNote(""); memoryDirty.current = false; try { sessionStorage.removeItem(`ib-memory-draft:${project.id}`); } catch { /* storage may be disabled */ } await load(); }
				catch (reason) { setToast(reason.message); } finally { setSaving(false); }
			};
			// 人工审核要求去掉课题页右上角的「开始科研 Agent 对话」按钮：
			// 起会话改由具体任务按钮（登记产物、路线方案、表征提交）按需触发，
			// 这里只保留 startTaskChat 那条路径。
			const startTaskChat = async (prompt, autoSubmit = false) => {
				if (!state.data || launching) throw new Error("会话正在启动，请稍后重试");
				setLaunching(true);
				try { await onStartChat(state.data.project, { memory: state.data.memory, presetId: state.data.presetId, prompt, autoSubmit }); }
				catch (reason) { setToast(reason.message); setLaunching(false); throw reason; }
			};
			const remove = async () => {
				if (!state.data) return;
				const accepted = window.confirm(`确定彻底删除课题「${state.data.project.name}」吗？\n\n将删除课题记录、关联任务、Harness 工作区注册和工作区目录中的全部文件。此操作不可恢复。`);
				if (!accepted) return;
				setDeleting(true);
				try {
					await onDelete(state.data.project);
					onBack();
				} catch (reason) {
					setToast(`删除失败：${reason?.message ?? reason}`);
					setDeleting(false);
				}
			};
			if (state.loading) return h("div", { className: "ib-empty" }, "正在打开课题空间…");
			if (!state.data) return h("div", { className: "ib-empty" }, state.error, h("div", { style: { marginTop: 12 } }, h("button", { className: "ib-btn", onClick: onBack }, "返回")));
			const data = state.data;
			const literature = data.literature || {};
			const planning = data.planning || {};
			const characterization = data.characterization || {};
			// 视觉改版：分类导航只保留单行标签，删除解释性副标题。
			const available = { literature: data.capabilities?.literature ?? true, planning: data.capabilities?.design ?? true, characterization: data.capabilities?.analysis ?? true };
            const activeTab = available[tab] ? tab : Object.keys(available).find(id => available[id]);
            const tabs = [["literature", "文献资料"], ["planning", "研究设计"], ["characterization", "表征分析"]];
			return h("div", null,
				h("div", { className: "ib-project-head" },
					h("button", { className: "ib-btn", onClick: () => { onBack(); } }, "← 所有课题"),
					h("div", { className: "ib-project-copy" }, h("h1", null, data.project.name), h("p", null, `项目编号 ${data.project.id} · 核心记忆 v${data.project.memoryVersion}`)),
					h("button", { className: "ib-btn", "aria-expanded": memoryOpen, onClick: () => setMemoryOpen(!memoryOpen) }, "核心记忆"),
					h("button", { className: "ib-btn", "data-danger": true, disabled: deleting || launching, onClick: () => void remove() }, deleting ? "正在删除…" : "删除课题")),
				memoryOpen ? h("div", { className: "ib-memory-drawer", role: "dialog", "aria-label": "核心记忆" }, h("button", { className: "ib-btn ib-memory-close", onClick: () => setMemoryOpen(false) }, "收起（保留编辑）"), h("section", { className: "ib-card" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "课题核心记忆.md"), h("span", { className: "ib-chip" }, `当前 v${data.memory?.version || "—"}`)), h("textarea", { value: draft, spellCheck: false, onChange: (event) => { memoryDirty.current = true; setDraft(event.target.value); try { sessionStorage.setItem(`ib-memory-draft:${project.id}`, event.target.value); } catch { /* storage may be disabled */ } } }), h("div", { className: "ib-save" }, h("input", { value: note, placeholder: "本次修改说明，例如：补充第二阶段实验结果", onChange: (event) => setNote(event.target.value) }), h("button", { className: "ib-btn", "data-primary": true, disabled: saving || draft === data.memory?.markdown, onClick: () => void save() }, saving ? "提交中…" : "提交新版本"))), h("aside", { className: "ib-card ib-help" }, h("strong", null, "这份 Markdown 有什么用？"), "它是该课题的长期核心记忆。科研 Agent 会读取已提交的版本。未提交的编辑会保留在当前窗口，返回后可继续修改。", h("div", { className: "ib-history" }, (data.memoryHistory || []).slice(0, 6).map((version) => h("div", { className: "ib-version", key: version.id }, h("span", null, h("b", null, `v${version.version}`), ` · ${version.changeNote}`), h("span", null, when(version.createdAt))))))) : null,
				// 单行标签页（选中态用下划线表达），右侧只留一个刷新入口。
				h("div", { className: "ib-tabs" },
					tabs.map(([id, label]) => h("button", { className: "ib-tab", "data-active": activeTab === id ? "true" : undefined, disabled: !available[id], title: available[id] ? undefined : "此功能未启用", key: id, onClick: () => setTab(id) }, label)),
					h("button", { className: "ib-btn ib-tab-refresh", onClick: () => void load() }, "刷新")),
				// 不再外包 ib-board 大框与重复标题：内容区直接就是分组标题 + 条目列表。
				activeTab === "literature" ? h("div", { className: "ib-tab-panel" }, h(ScientificBrowser, { call, projectId: data.project.id }), h(LitPanel, { projectId: data.project.id, searches: literature.searches || [], reports: literature.reports || [], bundles: literature.bundles || [], presentations: literature.presentations || [], call, notify: setToast, onRequestArtifact: startTaskChat, onChanged: load })) : null,
				activeTab === "planning" ? h("div", { className: "ib-tab-panel" }, h(ResearchDesignWorkspace, { projectId: data.project.id, routes: planning.routes || [], targets: planning.targets || [], plans: planning.plans || [], call, notify: setToast, onRequestPlan: startTaskChat, onChanged: load })) : null,
				activeTab === "characterization" ? h("div", { className: "ib-tab-panel" }, h(CharacterizationPanel, { key: data.project.id, projectId: data.project.id, call, nmrRows: characterization.nmr || [], onSubmitTask: (prompt) => startTaskChat(prompt, true) })) : null,
				!activeTab ? h("div", { className: "ib-empty" }, "科研功能尚未启用，您仍可查看和更新核心记忆。") : null,
                toast ? h("div", { className: "ib-toast", role: "status", "aria-live": "polite" }, toast) : null
			);
		}

		/** 错误边界：overlay 内任何渲染期异常不卸载整棵根，而是显示错误提示并允许关闭/重试。 */
export class OverlayBoundary extends (React.Component ?? class {}) {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error: error && error.message ? error.message : String(error) };
			}
			componentDidCatch(error, info) {
				console.error("[dsh-lab-agent] overlay render error:", error, info);
			}
			render() {
				if (this.state.error) {
					return h("div", { className: "ib-overlay" }, h("section", { className: "ib-card", style: { maxWidth: 620, margin: "16vh auto", padding: 24 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "面板渲染出错"), h("span", { className: "ib-chip" }, "可重试或返回")), h("pre", { style: { whiteSpace: "pre-wrap", color: "var(--ib-text)", background: "var(--ib-panel)", borderRadius: 10, padding: 12, fontSize: 10.5 } }, this.state.error), h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: () => this.props.onClose() }, "关闭"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => this.setState({ error: null }) }, "重试"))));
				}
				return this.props.children;
			}
		}

export function Panel({ call, onClose, onDeleteProject, onStartChat, initial }) {			const [project, setProject] = useState(initial ?? null);
			const [templates, setTemplates] = useState(false);
			// 品牌去重：产品名只在左侧栏保留一处，面板顶栏只做面包屑与返回，
			// 不再重复渲染 Logo +「iBM Lab Agent / Project Research Workspace」。
			return ReactDOM.createPortal(h("div", { className: "ib-overlay" }, h("header", { className: "ib-top" }, h("div", { className: "ib-crumb" }, templates ? h("span", null, "模板 ", h("b", null, "管理")) : project ? h("span", null, "课题 / ", h("b", null, project.name)) : h("b", null, "我的科研课题")), h("button", { className: "ib-btn", onClick: onClose }, "返回 Harness")), h("main", { className: "ib-main" }, templates ? h(Templates, { call, onBack: () => setTemplates(false) }) : project ? h(Project, { call, project, onBack: () => setProject(null), onDelete: onDeleteProject, onStartChat }) : h(Home, { call, onOpen: setProject, onLaunch: onStartChat, onOpenTemplates: () => setTemplates(true) }))), document.body);
		}
