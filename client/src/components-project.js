import React from "react";
import ReactDOM from "react-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { h } from "./h.js";
import { when, statusOf, saveRis, downloadVerifiedBinary, downloadOfficeArtifact, openOfficeArtifact, openPdfPreview, openExternalUrl, openInEdgeViaShell, webVpnStatusViaShell, openWebVpnLoginViaShell, openWebVpnCaptureViaShell, cancelWebVpnCaptureViaShell } from "./lib.js";
import { BRAND_ICON } from "./brand-icon.js";
import { DatabaseOverview } from "./components-literature.js";
import { ResearchDesignWorkspace } from "./components-workspace.js";
import { CharacterizationPanel } from "./components-characterization.js";
import { Templates } from "./components-templates.js";
import { BookSvg, SiSvg } from "./components-templates.js";

// WebVPN 会话状态 → 捕获提示文案/色调。桌面壳按 `WebVpnSessionState`
// （kebab-case）返回 state；这里把「加载出版社页 / 等待下载 / 归档中」映射成
// 用户能看懂的过程提示，避免一直停在「已布防」这种没有阶段感的文案。
const capturePhaseOf = (state, lastError) => {
	switch (state) {
		case "opening": return { text: "正在打开 WebVPN 窗口…", tone: "busy" };
		case "waiting-login": return { text: "请在 WebVPN 窗口完成登录，再点击「我已登录」", tone: "waiting" };
		case "ready": return { text: "正在打开出版社页面…", tone: "busy" };
		case "navigating": return { text: "正在加载出版社页面…", tone: "busy" };
		case "waiting-download": return { text: "出版社页面已打开，请点击「下载 PDF / SI」按钮", tone: "waiting" };
		case "downloading": return { text: "正在下载文件…", tone: "busy" };
		case "uploading": return { text: "文件已下载，正在归档到课题…", tone: "busy" };
		case "expired": return { text: "捕获任务已过期，请重新点击文献按钮", tone: "error" };
		case "error": return { text: lastError ? `捕获失败：${lastError}` : "捕获失败，请重试", tone: "error" };
		default: return { text: "正在准备捕获…", tone: "busy" };
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
					if (!defaults.goal || !defaults.template) throw new Error("系统默认配置尚未就绪");
					const result = await call("projects_create", { request: { fields: { ...form, name: form.name.trim(), memoryChangeNote: "创建课题核心记忆", goalProfileId: defaults.goal.id, goalProfileVersion: defaults.goal.version, templateId: defaults.template.id, templateVersion: defaults.template.version } } });
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
					const [projects, goals, templates] = await Promise.all([call("projects_list"), call("goals_list"), call("templates_list")]);
					setState({ loading: false, projects: projects.projects || [], defaults: { goal: goals.goals.find((x) => x.id === "default-prodrug-polymer") || goals.goals[0], template: templates.templates.find((x) => x.id === "nature-default") || templates.templates[0] }, error: "" });
				} catch (reason) { setState({ loading: false, projects: [], defaults: {}, error: reason.message }); }
			}, []);
			useEffect(() => { void load(); }, [load]);
			const launch = async (project, presetId) => {
				setLaunching(project.id);
				try { await onLaunch(project, { presetId }); }
				catch (reason) { setState((previous) => ({ ...previous, error: reason.message })); setLaunching(null); }
			};
			return h("div", null, h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Research Projects"), h("h1", null, "选择一个课题继续"), h("p", null, "每个课题拥有独立的核心记忆、科研 Agent 对话和研究成果。创建课题后会自动打开专属工作区并开始科研 Agent 对话。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", onClick: onOpenTemplates }, "模板管理"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => setCreating(true) }, "+ 新建课题"))), creating ? h(CreateProject, { call, defaults: state.defaults, onCancel: () => setCreating(false), onCreated: (project, presetId) => void launch(project, presetId) }) : null, state.error ? h("div", { className: "ib-error" }, state.error) : null, state.loading ? h("div", { className: "ib-empty" }, "正在读取课题…") : state.projects.length ? h("div", { className: "ib-grid" }, state.projects.map((project) => h("button", { className: "ib-project", key: project.id, disabled: launching === project.id, onClick: () => onOpen(project) }, h("div", { className: "ib-project-icon" }, "PJ"), h("h2", null, project.name), h("p", null, launching === project.id ? "正在创建专属工作区并启动对话…" : "进入课题空间，继续对话、更新记忆或查询研究成果。"), h("div", { className: "ib-project-foot" }, h("span", null, `记忆 v${project.memoryVersion || "1"}`), h("span", null, when(project.updatedAt)))))) : h("div", { className: "ib-empty" }, "还没有课题。点击“新建课题”，先写下研究问题与目标。"));
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

		/** 文献管理两栏：左侧检索记录 + 右侧精读档案。 */
export function LitPanel({ searches, reports, bundles, presentations, call, notify, onOpenSearch, onRequestArtifact, onChanged }) {
			const titleByBundle = bundleIndex(bundles);
			const bundleById = bundleRecordIndex(bundles);
			const presentationByReport = {};
			for (const item of (presentations || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
				if (!(item.reportId in presentationByReport)) presentationByReport[item.reportId] = item;
			}
			const [busy, setBusy] = useState({});
			const [overview, setOverview] = useState({});
			const [expandedSearch, setExpandedSearch] = useState(null);
			const [machineReviews, setMachineReviews] = useState({});
			const [preview, setPreview] = useState(null); // { kind: "report" | "ppt", report, presentation? }
			const [reviewVisible, setReviewVisible] = useState(false);
			const [approval, setApproval] = useState(null); // { stage: "confirm" | "approved", detail }
			// 手工下载文献捕获：{ bundleId, kind, taskId } —— 布防后显示"等待下载"提示。
			const [captureHint, setCaptureHint] = useState(null);
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
							setCaptureHint(null);
							notify("文献捕获完成，文件已归档到课题，按钮已点亮");
							void onChanged();
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
						const status = await webVpnStatusViaShell();
						if (disposed || !status) return;
						setCaptureHint((current) => current?.taskId === taskId
							? { ...current, phase: capturePhaseOf(status.state, status.lastError) }
							: current);
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
			const armCaptureFor = (event, bundle, kind) => {
				event.stopPropagation();
				const doiUrl = bundle.doi ? `https://doi.org/${encodeURIComponent(bundle.doi)}` : undefined;
				const sourcePublisherUrl = (() => {
					if (bundle.sourceType === "wechat" || !bundle.sourceUrl) return undefined;
					try {
						const url = new URL(bundle.sourceUrl);
						return url.protocol === "https:" ? url.href : undefined;
					} catch { return undefined; }
				})();
				const publisherUrl = doiUrl || sourcePublisherUrl;
				if (!publisherUrl) {
					notify("无法启动捕获：该文献未登记 DOI，也没有出版社页面（公众号条目不支持自动捕获）");
					return;
				}
				// Desktop（desktop-edge-handoff）：任务在外部 Edge 中完成。本页面运行在
				// WebView2 的 iframe 内，看不到 __TAURI_INTERNALS__，因此经 postMessage
				// 请求桌面 shell 调起 open_in_edge；shell 校验 loopback 后打开 handoff 页。
				if (desktopEdgeHandoff) {
					void webVpnStatusViaShell()
						.then(async (status) => {
							if (status?.state !== "ready") {
								await openWebVpnLoginViaShell();
								notify("请在 WebVPN 窗口完成登录，再在数据库状态栏点击“我已登录”，然后重新点击文献按钮");
								return null;
							}
							return call("manual_capture_create", { request: { projectId: bundle.projectId, bundleId: bundle.id, kind } });
						})
						.then(async (result) => {
							if (!result) return;
							const task = result?.task;
							const token = task?.token;
							if (!task?.id || !token) throw new Error("创建捕获任务失败：响应缺少一次性令牌，请刷新后重试");
							try {
								await openWebVpnCaptureViaShell({ taskId: task.id, kind: task.kind, targetUrl: publisherUrl, token });
								setCaptureHint({ bundleId: bundle.id, kind: task.kind, taskId: task.id, route: "webvpn" });
								notify(`已通过 WebVPN 打开出版社页面，请点击网页中的${task.kind === "pdf" ? "正文 PDF" : "SI PDF"}下载按钮`);
							} catch (webvpnError) {
								// 命令响应丢失时，Rust 侧可能已经布防成功。先按任务 ID
								// 撤销本地待下载状态，再复用同一服务端任务切到 Edge。
								try { await cancelWebVpnCaptureViaShell(task.id); } catch { /* 尚未布防时无需处理 */ }
								const handoffUrl = `${location.origin}/lab/capture/?taskId=${encodeURIComponent(task.id)}#t=${encodeURIComponent(token)}`;
								await openInEdgeViaShell(handoffUrl);
								setCaptureHint({ bundleId: bundle.id, kind: task.kind, taskId: task.id, route: "edge" });
								notify(`WebVPN 打开失败，已切换到 Microsoft Edge：${webvpnError.message}`);
							}
						})
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
				const openSearchInEdge = (event, kind, url) => {
					event.stopPropagation();
					if (opening[searchOpenKey(kind)]) return;
					setOpening((old) => ({ ...old, [searchOpenKey(kind)]: true }));
					void openPdfPreview(url)
						.catch((reason) => notify(`无法打开${kind === "pdf" ? "正文 PDF" : "SI PDF"}：${reason?.message ?? reason}`))
						.finally(() => setOpening((old) => { const next = { ...old }; delete next[searchOpenKey(kind)]; return next; }));
				};
				return h("article", { className: "ib-search-paper", key: paper.doi || paper.pmid || paper.arxivId || paper.id || paper.title },
					h("div", { className: "ib-search-citation" }, h("i", null, journal), bibliographic, h("span", null, `（${description}）`), target ? h("a", { href: target, target: "_blank", rel: "noopener noreferrer", onClick: (event) => event.stopPropagation() }, paper.pdfUrl ? "PDF" : "原文") : null),
					h("small", { title: paper.title }, paper.title),
					h("div", { className: "ib-search-actions" },
						h("button", { className: "ib-icon-btn", "data-ready": pdfReady ? "true" : "false", "data-opening": opening[searchOpenKey("pdf")] ? "true" : undefined, disabled: !!opening[searchOpenKey("pdf")], title: opening[searchOpenKey("pdf")] ? "正在打开正文 PDF…" : (pdfReady ? "在外部 Microsoft Edge 中打开正文 PDF" : "未提交 PDF · 点击前往 DOI 页面"), onClick: (event) => pdfReady ? openSearchInEdge(event, "pdf", paper.localPdfUrl) : openExternal(event, doiUrl), "aria-label": "PDF 原文" }, h(BookSvg, null)),
						h("button", { className: "ib-icon-btn", "data-ready": siReady ? "true" : "false", "data-opening": opening[searchOpenKey("si")] ? "true" : undefined, disabled: !!opening[searchOpenKey("si")], title: opening[searchOpenKey("si")] ? "正在打开 SI PDF…" : (siReady ? (paper.localSiIsPdf ? "在外部 Microsoft Edge 中打开 SI PDF" : "下载 SI 补充材料") : "未提交 SI · 点击前往 DOI 页面"), onClick: (event) => siReady ? (paper.localSiIsPdf ? openSearchInEdge(event, "si", paper.localSiUrl) : saveFile(event, paper.localSiUrl)) : openExternal(event, doiUrl), "aria-label": "SI 补充材料" }, h(SiSvg, null))
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
				// ── 左：文献检索 ──
				h("section", { className: "ib-lit-col" },
					h("div", { className: "ib-lit-head" }, h("h3", null, "文献检索"), h("small", null, `${searches.length} 条记录`)),
					h("div", { className: "ib-lit-note" }, "每个会话汇总为一个检索条目和一个 RIS；“检索”可展开本会话全部去重文献，点击条目可回到原对话。"),
					searches.length ? h("div", { className: "ib-lit-list" }, searches.slice().reverse().map((search) => h("div", { key: search.id },
						h("div", { className: "ib-lit-row", "data-clickable": search.sessionId ? "true" : undefined, onClick: search.sessionId ? () => onOpenSearch(search.sessionId) : undefined, title: search.sessionId ? "跳转到检索对话" : "该检索未记录会话" },
							h("div", { className: "ib-lit-main" }, h("b", null, search.title || search.query || search.id), h("small", null, `${(search.results || []).length} 篇 · ${(search.queries || [search.query]).filter(Boolean).length} 轮查询 · OA ${(search.results || []).filter((row) => row.isOa === true).length} · ${(search.sources || []).join("/") || "未知来源"}${(search.sourceFailures || []).length ? ` · ${search.sourceFailures.length} 个源降级` : ""} · ${when(search.updatedAt || search.createdAt)}`)),
							h("div", { className: "ib-lit-acts" },
								h("button", { className: "ib-lit-btn ok", disabled: !(search.results || []).length, onClick: (event) => { event.stopPropagation(); setExpandedSearch((value) => value === search.id ? null : search.id); } }, expandedSearch === search.id ? "收起" : "检索"),
								h("button", { className: "ib-lit-btn ok", disabled: busy[`ris:${search.id}`] || !(search.results || []).length, onClick: (event) => { event.stopPropagation(); void risFor(search); } }, busy[`ris:${search.id}`] ? "…" : ".ris")
							)
						),
						expandedSearch === search.id ? h("div", { className: "ib-search-results", role: "list", "aria-label": `${search.title || "检索"}的全部文献` }, (search.results || []).map(paperCitation)) : null
					))) : h("div", { className: "ib-lit-empty" }, "对话中的文献检索结果会按会话整理到这里。")
				),
				// ── 右：文献精读 ──
				h("section", { className: "ib-lit-col" },
					h("div", { className: "ib-lit-head" }, h("h3", null, "文献精读"), h("small", null, `${reports.length} 篇`)),
					h("div", { className: "ib-lit-note" }, "未获取原文时点击灰色 PDF/SI 按钮：自动打开 DOI 出版社页面并布防捕获，下一次下载会归档到本课题（需安装 iBM 文献捕获扩展）；公众号条目仅支持 DOI 出版社页面，不显示公众号链接。"),
					reports.length ? h("div", { className: "ib-lit-list" }, reports.map((report) => {
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
						// 0.1.15：已登记的 SI 一律按 PDF 处理，不再依据路径后缀猜测。
						const bundleSiIsPdf = !!bundle.siPath;
						const openKey = (kind) => `${kind}:${report.id}`;
						/** 正文/SI 交给外部 Edge 打开；期间显示"正在打开"，失败必须 toast，不得静默。 */
						const openEntryInEdge = (event, kind, url) => {
							event.stopPropagation();
							if (opening[openKey(kind)]) return;
							setOpening((old) => ({ ...old, [openKey(kind)]: true }));
							void openPdfPreview(url)
								.catch((reason) => notify(`无法打开${kind === "pdf" ? "正文 PDF" : "SI PDF"}：${reason?.message ?? reason}`))
								.finally(() => setOpening((old) => { const next = { ...old }; delete next[openKey(kind)]; return next; }));
						};
						const downloadBundleFile = (event, url) => { event.stopPropagation(); void downloadVerifiedBinary(url).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message)); };
						const captureActive = captureHint?.bundleId === bundle.id;
						const metadata = [
							(bundle.authors || []).length ? bundle.authors.join(", ") : null,
							bundle.journal,
							bundle.year,
							bundle.doi ? `DOI ${bundle.doi}` : null
						].filter(Boolean).join(" · ");
						const artifactState = awaitingPdf
							? `${metadata || "元数据已登记"} · 待上传 PDF`
							: `${metadata ? `${metadata} · ` : ""}DOCX${report.docxPath ? "已生成" : "待生成"}${presentation ? ` · PPT${presentation.pptxPath ? "已生成" : "生成中"}` : ""}`;
						const paperName = report.titleZh || bundle.title || zhOf(report) || report.id;
						const readingPrompt = `请精读文献「${paperName}」（bundleId: ${report.bundleId || bundle.id || "未登记"}，reportId: ${report.id}）。先读取本课题已归档的 PDF/SI 和当前阅读笔记模板，按模板完成精读报告，并调用 lab_tasks_register_report 登记到该 reportId。`;
						const pptPrompt = `请为文献「${paperName}」（reportId: ${report.id}）制作汇报 PPT。先读取已归档 PDF/SI、已有精读报告和当前 PPT 模板，按模板生成 PPTX，并调用 lab_tasks_register_presentation 登记。`;
						return h("div", { key: report.id, onClick: report.id in overview ? () => setOverview((old) => { const n = { ...old }; delete n[report.id]; return n; }) : undefined },
							h("div", { className: "ib-lit-row", "data-waiting": awaitingPdf ? "true" : undefined },
								h("div", { className: "ib-lit-main" }, h("b", { title: report.titleZh || bundle.title || zhOf(report) }, shortNode(report)), h("small", null, `${artifactState} · ${when(report.createdAt)}`)),
								h("div", { className: "ib-lit-acts" },
									h("button", { className: "ib-icon-btn", "data-ready": bundlePdfUrl ? "true" : "false", "data-opening": opening[openKey("pdf")] ? "true" : undefined, disabled: !!opening[openKey("pdf")], title: opening[openKey("pdf")] ? "正在打开正文 PDF…" : (bundlePdfUrl ? "在外部 Microsoft Edge 中打开正文 PDF" : (publisherUrl ? "尚未获取 PDF · 点击前往论文出版社页面并自动捕获下载" : "尚未获取 PDF · 未登记 DOI/出版社页面")), onClick: (event) => bundlePdfUrl ? openEntryInEdge(event, "pdf", bundlePdfUrl) : armCaptureFor(event, bundle, "pdf"), "aria-label": "PDF 原文" }, h(BookSvg, null)),
									h("button", { className: "ib-icon-btn", "data-ready": bundleSiUrl ? "true" : "false", "data-opening": opening[openKey("si")] ? "true" : undefined, disabled: !!opening[openKey("si")], title: opening[openKey("si")] ? "正在打开 SI PDF…" : (bundleSiUrl ? (bundleSiIsPdf ? "在外部 Microsoft Edge 中打开 SI PDF" : "下载 SI 补充材料") : (publisherUrl ? "尚未获取 SI · 点击前往论文出版社页面并自动捕获下载" : "尚未获取 SI · 未登记 DOI/出版社页面")), onClick: (event) => bundleSiUrl ? (bundleSiIsPdf ? openEntryInEdge(event, "si", bundleSiUrl) : downloadBundleFile(event, bundleSiUrl)) : armCaptureFor(event, bundle, "si"), "aria-label": "SI 补充材料" }, h(SiSvg, null)),
									h("button", { className: "ib-lit-btn ok", disabled: busy[`ov:${report.id}`], onClick: () => void openOverview(report) }, busy[`ov:${report.id}`] ? "…" : (report.id in overview ? "收起概览" : "概览")),
									h("button", { className: `ib-lit-btn${report.docxPath ? " ok" : ""}`, "data-ready": report.docxPath ? "true" : "false", disabled: !!busy[`open-report:${report.id}`], onClick: () => report.docxPath ? openPreview({ kind: "report", report }) : onRequestArtifact(readingPrompt), title: report.docxPath ? "用本机 Office 或 WPS 打开精读报告" : "在当前课题工作区新建对话并预填精读任务" }, busy[`open-report:${report.id}`] ? "打开中…" : (report.docxPath ? "打开精读" : "精读文献")),
									h("button", { className: `ib-lit-btn${presentation?.pptxPath ? " ok" : ""}`, "data-ready": presentation?.pptxPath ? "true" : "false", disabled: !!busy[`open-ppt:${report.id}`], onClick: () => presentation?.pptxPath ? openPreview({ kind: "ppt", report, presentation }) : onRequestArtifact(pptPrompt), title: presentation?.pptxPath ? "用本机 Office 或 WPS 打开 PPT" : "在当前课题工作区新建对话并预填 PPT 任务" }, busy[`open-ppt:${report.id}`] ? "打开中…" : (presentation?.pptxPath ? "打开PPT" : "制作PPT"))
								)
							),
							captureActive ? h("div", { className: "ib-capture-hint", "data-tone": captureHint?.phase?.tone || "waiting" }, captureHint?.phase?.text || `已布防：等待下一次 ${captureHint.kind === "pdf" ? "PDF" : "SI"} 下载…`) : (opening[openKey("pdf")] || opening[openKey("si")]) ? h("div", { className: "ib-capture-hint" }, `正在在外部 Microsoft Edge 中打开${opening[openKey("pdf")] ? "正文 PDF" : "SI PDF"}…`) : null,
							report.id in overview ? h("div", { className: "ib-lit-overview" }, h("b", null, awaitingPdf ? "已提取的元数据摘要" : "文献概览（约 200 字）"), overview[report.id] ?? "加载中…") : null
						);
					})
					) : h("div", { className: "ib-lit-empty" }, "尚无精读条目。可在对话中粘贴微信公众号文献链接先登记元数据，或完成报告生成后登记产物。")
				)
			), previewNode);
		}

export function Project({ call, project, onBack, onDelete, onStartChat, onOpenSearch }) {
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
			const startChat = async () => {
				if (!state.data) return;
				setLaunching(true);
				try { await onStartChat(state.data.project, { memory: state.data.memory, presetId: state.data.presetId }); }
				catch (reason) { setToast(reason.message); setLaunching(false); }
			};
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
			const meta = { literature: ["文献资料", "左侧检索记录 · 右侧精读档案与下载"], planning: ["研究设计", "工作规划、实验方案与合成路线"], characterization: ["表征分析", "NMR 等结构表征和审核结果"] };
			return h("div", null,
				h("div", { className: "ib-project-head" }, h("button", { className: "ib-btn", onClick: () => { onBack(); } }, "← 所有课题"), h("div", { className: "ib-project-copy" }, h("h1", null, data.project.name), h("p", null, `项目编号 ${data.project.id} · 核心记忆 v${data.project.memoryVersion}`)), h("button", { className: "ib-btn", "aria-expanded": memoryOpen, onClick: () => setMemoryOpen(!memoryOpen) }, "核心记忆"), h("button", { className: "ib-btn", "data-danger": true, disabled: deleting || launching, onClick: () => void remove() }, deleting ? "正在删除…" : "删除课题"), h("button", { className: "ib-btn ib-agent", "data-primary": true, disabled: deleting || launching, onClick: () => void startChat() }, h("span", { className: "ib-spark" }, "✦"), launching ? "正在启动…" : "开始科研 Agent 对话")),
				memoryOpen ? h("div", { className: "ib-memory-drawer", role: "dialog", "aria-label": "核心记忆" }, h("button", { className: "ib-btn ib-memory-close", onClick: () => setMemoryOpen(false) }, "收起（保留编辑）"), h("section", { className: "ib-card" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "课题核心记忆.md"), h("span", { className: "ib-chip" }, `当前 v${data.memory?.version || "—"}`)), h("textarea", { value: draft, spellCheck: false, onChange: (event) => { memoryDirty.current = true; setDraft(event.target.value); try { sessionStorage.setItem(`ib-memory-draft:${project.id}`, event.target.value); } catch { /* storage may be disabled */ } } }), h("div", { className: "ib-save" }, h("input", { value: note, placeholder: "本次修改说明，例如：补充第二阶段实验结果", onChange: (event) => setNote(event.target.value) }), h("button", { className: "ib-btn", "data-primary": true, disabled: saving || draft === data.memory?.markdown, onClick: () => void save() }, saving ? "提交中…" : "提交新版本"))), h("aside", { className: "ib-card ib-help" }, h("strong", null, "这份 Markdown 有什么用？"), "它是该课题的长期核心记忆。科研 Agent 会读取已提交的版本。未提交的编辑会保留在当前窗口，返回后可继续修改。", h("div", { className: "ib-history" }, (data.memoryHistory || []).slice(0, 6).map((version) => h("div", { className: "ib-version", key: version.id }, h("span", null, h("b", null, `v${version.version}`), ` · ${version.changeNote}`), h("span", null, when(version.createdAt))))))) : null,
				h("div", { className: "ib-tabs" }, Object.entries(meta).map(([id, copy]) => h("button", { className: "ib-tab", "data-active": tab === id ? "true" : undefined, key: id, onClick: () => setTab(id) }, h("strong", null, copy[0]), h("span", null, copy[1])))),
				h("section", { className: "ib-board" }, h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, meta[tab][0]), h("p", null, meta[tab][1])), h("button", { className: "ib-btn", onClick: () => void load() }, "刷新")), tab === "literature" ? h("div", null, h(DatabaseOverview, { call, notify: setToast }), h(LitPanel, { searches: literature.searches || [], reports: literature.reports || [], bundles: literature.bundles || [], presentations: literature.presentations || [], call, notify: setToast, onOpenSearch, onRequestArtifact: startTaskChat, onChanged: load })) : null, tab === "planning" ? h(ResearchDesignWorkspace, { projectId: data.project.id, routes: planning.routes || [], targets: planning.targets || [], plans: planning.plans || [], call, notify: setToast, onRequestPlan: startTaskChat, onChanged: load }) : null, tab === "characterization" ? h(CharacterizationPanel, { key: data.project.id, projectId: data.project.id, call, nmrRows: characterization.nmr || [], onSubmitTask: (prompt) => startTaskChat(prompt, true) }) : null),
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

export function Panel({ call, onClose, onDeleteProject, onStartChat, onOpenSearch, initial }) {			const [project, setProject] = useState(initial ?? null);
			const [templates, setTemplates] = useState(false);
			return ReactDOM.createPortal(h("div", { className: "ib-overlay" }, h("header", { className: "ib-top" }, h("div", { className: "ib-brand" }, h("div", { className: "ib-logo" }, h("img", { src: BRAND_ICON, alt: "iBM Lab Agent" })), h("div", null, h("strong", null, "iBM Lab Agent"), h("small", null, "Project Research Workspace"))), h("div", { className: "ib-crumb" }, templates ? h("span", null, "模板 ", h("b", null, "管理")) : project ? h("span", null, "课题 / ", h("b", null, project.name)) : h("b", null, "我的科研课题")), h("button", { className: "ib-btn", onClick: onClose }, "返回 Harness")), h("main", { className: "ib-main" }, templates ? h(Templates, { call, onBack: () => setTemplates(false) }) : project ? h(Project, { call, project, onBack: () => setProject(null), onDelete: onDeleteProject, onStartChat, onOpenSearch }) : h(Home, { call, onOpen: setProject, onLaunch: onStartChat, onOpenTemplates: () => setTemplates(true) }))), document.body);
		}
