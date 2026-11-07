/**
 * 文献页面板（子插件自有实现）。
 *
 * 由母包 components-project.js 抽出：文献列表 / 检索记录 / 精读条目 / 捕获状态。
 * 只依赖 dsh-lab-agent/client-sdk 提供的宿主能力，以及公开导出的纯规则函数。
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { linkIntakePrompt } from './reading-link-upload.js';
import {
	h, useProjectViewValue, useProjectViewScroll, fileToBase64, useReadingInteractions,
	ReadingContextMenu, ReadingLinkUpload, EntryConversationButton, readingConversationId,
	ReadingNoteSvg, OverviewSvg, TranslateSvg, PresentationSvg, SpinSvg, BookSvg, SiSvg, TemplateLibrary,
	saveRis, downloadVerifiedBinary, downloadOfficeArtifact, openOfficeArtifact, openPdfPreview,
	openExternalUrl, openInEdgeViaShell, webVpnStatusViaShell, iwanStatusViaShell,
	openReader,
	openWebVpnLoginViaShell, openWebVpnCaptureViaShell, showWebVpnViaShell,
	cancelWebVpnCaptureViaShell, revealSavedPathViaDesktop, when, statusOf
} from "dsh-lab-agent/client-sdk";
import { translationPrompt } from "./translation-prompt.js";
import { publicationCitation, usableShortCitation } from "dsh-lab-agent/literature/citation";

function NonPaperNotice({notice,onDismiss}) {
 useEffect(()=>{const timer=setTimeout(()=>onDismiss(notice.id),3000);return()=>clearTimeout(timer);},[notice.id,onDismiss]);
 return h('div',{className:'ib-non-paper-notice',role:'alert'},h('b',null,'该文件不是论文或补充材料'),h('div',null,notice.name),notice.reason?h('small',null,notice.reason):null);
}

// 精读条目的文件与产物操作保持可见；删除通过右键菜单提供。

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
export function LitPanel({ projectId, searches, reports, bundles, presentations, call, notify, onRequestArtifact, onOpenConversation, onChanged, headerTarget = null }) {
			const titleByBundle = bundleIndex(bundles);
			const bundleById = bundleRecordIndex(bundles);
			const presentationByReport = {};
			for (const item of (presentations || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
				if (!(item.reportId in presentationByReport)) presentationByReport[item.reportId] = item;
			}
			const [busy, setBusy] = useState({});
			const [overview, setOverview] = useState({});
			const [expandedSearch, setExpandedSearch] = useProjectViewValue(projectId, 'expanded-search', '');
			const [folders,setFolders]=useState([]),[selectedFolder,setSelectedFolder]=useProjectViewValue(projectId,'reading-folder','all'),[importingRis,setImportingRis]=useState(false);
			const [foldersLoaded,setFoldersLoaded]=useState(false);
			const literatureRoot=useRef(null);
            const [entryMenu,setEntryMenu]=useState(null);
            const closeEntryMenu=useCallback(()=>setEntryMenu(null),[]);
            useEffect(()=>setEntryMenu(null),[projectId,selectedFolder]);
            useEffect(()=>{setEntryMenu(menu=>menu&&menu.reportIds.some(id=>!reports.some(report=>report.id===id))?null:menu);},[reports]);
			useProjectViewScroll(literatureRoot,projectId,selectedFolder,foldersLoaded);
			const risPicker=useRef(null),risDragDepth=useRef(0);
			const [risDragging,setRisDragging]=useState(false);
			const pdfPicker=useRef(null),dragDepth=useRef(0);
			const [pdfUploads,setPdfUploads]=useState([]),[pdfDragging,setPdfDragging]=useState(false);
			const [rejectionNotices,setRejectionNotices]=useState([]);
			const seenRejections=useRef(new Set(bundles.filter(row=>row.pdfIntake?.status==='rejected').map(row=>row.id+':'+row.pdfIntake.updatedAt)));
			const dismissRejection=useCallback(id=>setRejectionNotices(previous=>previous.filter(row=>row.id!==id)),[]);
			const showRejection=useCallback(bundle=>{
				seenRejections.current.add(bundle.id+':'+bundle.pdfIntake.updatedAt);
				setRejectionNotices(previous=>[...previous,{id:crypto.randomUUID(),name:bundle.pdfIntake.originalFileName,reason:bundle.pdfIntake.error}]);
			},[]);
			useEffect(()=>{
				for(const bundle of bundles)if(bundle.pdfIntake?.status==='rejected'&&!seenRejections.current.has(bundle.id+':'+bundle.pdfIntake.updatedAt))showRejection(bundle);
			},[bundles,showRejection]);
			const [locateRequest,setLocateRequest]=useState(null);
			const canLocate=!!locateRequest&&reports.some(report=>report.bundleId===locateRequest.bundleId);
			useEffect(()=>{
				if(!locateRequest||!canLocate)return undefined;
				let timer,node;
				const frame=requestAnimationFrame(()=>{
					node=Array.from(literatureRoot.current?.querySelectorAll('[data-bundle-id]')??[]).find(row=>row.dataset.bundleId===locateRequest.bundleId);
					if(!node)return;
					node.scrollIntoView({block:'center',behavior:'smooth'});
					node.removeAttribute('data-located');void node.offsetWidth;node.setAttribute('data-located','true');
					timer=setTimeout(()=>node.removeAttribute('data-located'),2600);
				});
				return()=>{cancelAnimationFrame(frame);clearTimeout(timer);node?.removeAttribute('data-located');};
			},[locateRequest,canLocate,selectedFolder]);
			const uploadPdfs=async files=>{
				const incoming=Array.from(files??[]),valid=incoming.filter(file=>/\.(pdf|docx)$/i.test(file.name));
				if(valid.length!==incoming.length)notify('仅支持 PDF、DOCX 文献，其他文件已跳过');
				const queued=valid.map(file=>({id:crypto.randomUUID(),file}));
				setPdfUploads(previous=>[...previous,...queued.map(({id,file})=>({id,name:file.name}))]);
				for(const {id,file} of queued){let uploadId;try{
					const folderId=!['all','unfiled'].includes(selectedFolder)?selectedFolder:undefined;
					// 分块上传：整份文件不再进单个 base64 请求，也不设大小上限。
					const begin=await call('tasks_reading_pdf_upload_begin',{request:{projectId,name:file.name}});
					uploadId=begin.uploadId;
					const chunkBytes=Math.max(1024*1024,Number(begin.chunkBytes)||4*1024*1024);
					for(let offset=0,index=0;offset<file.size;offset+=chunkBytes,index+=1){
						const slice=file.slice(offset,Math.min(file.size,offset+chunkBytes));
						await call('tasks_reading_pdf_upload_chunk',{request:{projectId,uploadId,index,base64:await fileToBase64(slice)}});
					}
					const result=await call('tasks_reading_pdf_upload_finish',{request:{projectId,uploadId,folderId}});
					uploadId=null;
					if(result.rejected){showRejection(result.bundle);await onChanged?.();continue;}
					setPdfUploads(previous=>previous.map(row=>row.id===id?{...row,bundleId:result.bundle.id}:row));
					await onChanged?.();
					if(result.reused){setSelectedFolder('all');setLocateRequest({bundleId:result.bundle.id,nonce:crypto.randomUUID()});notify('该文件已登记，已定位到原条目');}
				}catch(error){if(uploadId)await call('tasks_reading_pdf_upload_abort',{request:{projectId,uploadId}}).catch(()=>{});notify(file.name+'：'+error.message);}finally{setPdfUploads(previous=>previous.filter(row=>row.id!==id));}}
				if(pdfPicker.current)pdfPicker.current.value='';
			};
			const pdfDragEvent=event=>{if(!Array.from(event.dataTransfer.types??[]).includes('Files'))return false;event.preventDefault();event.stopPropagation();return true;};
			const [folderEditor,setFolderEditor]=useState(null);
			const loadFolders=useCallback(()=>call('tasks_reading_folders',{request:{projectId}}).then(result=>{setFolders(result.folders??[]);setFoldersLoaded(true);}).catch(error=>notify(error.message)),[call,projectId,notify]);
			useEffect(()=>{void loadFolders();},[projectId,reports,loadFolders]);
			useEffect(()=>{if(foldersLoaded&&selectedFolder!=='all'&&selectedFolder!=='unfiled'&&!folders.some(folder=>folder.id===selectedFolder))setSelectedFolder('unfiled');},[foldersLoaded,folders,selectedFolder,setSelectedFolder]);
			const folderAction=async(action,request)=>{try{await call(action,{request:{projectId,...request}});await loadFolders();onChanged?.();return true;}catch(error){notify(error.message);return false;}};
			const createFolder=()=>setFolderEditor({name:''});
			const deleteFolder=async()=>{if(!folderMenu)return;const target=folderMenu;setFolderMenu(null);if(!window.confirm('删除分组「'+target.name+'」？其中的文献会移到「未分类」。'))return;if(await folderAction('tasks_reading_folder_delete',{id:target.id})&&selectedFolder===target.id)setSelectedFolder('unfiled');};
			const submitLink = async (event) => {
				event.preventDefault();
				if (linkBusy) return;
				setLinkBusy(true);
				setLinkError('');
				try {
					const prompt = linkIntakePrompt(projectId, linkUrl);
					await onRequestArtifact(prompt, true);
					setLinkOpen(false);
					setLinkUrl('');
					notify('已启动链接解析，校验并登记后条目会自动显示');
				} catch (reason) {
					setLinkError(reason?.message || '解析任务启动失败，请重试');
				} finally {
					setLinkBusy(false);
				}
			};
			const saveFolderEditor=async()=>{const clean=String(folderEditor?.name??'').trim();if(!clean){notify('请输入分组名称');return;}if(await folderAction('tasks_reading_folder_save',{name:clean})){setFolderEditor(null);notify('已创建分组：'+clean);}};
			const createFolderPrompt=async()=>{const name=window.prompt('新分组名称');const clean=String(name??'').trim();if(!clean)return;if(await folderAction('tasks_reading_folder_save',{name:clean}))notify('已创建分组：'+clean);};
			const importRisFiles=async files=>{const incoming=Array.from(files??[]),valid=incoming.filter(file=>/\.ris$/i.test(file.name));if(valid.length!==incoming.length)notify('检索记录区域仅支持 RIS 文件，其他文件已跳过');if(!valid.length)return;setImportingRis(true);try{for(const file of valid){try{if(file.size>2*1024*1024)throw Error('RIS 文件不能超过 2 MB');const result=await call('tasks_search_import_ris',{request:{projectId,fileName:file.name,base64:await fileToBase64(file)}});notify(`${result.reused?'已登记过此 RIS，复用原记录':'RIS 导入成功'}：${result.run.results.length} 篇，去重 ${result.duplicateCount} 条`);}catch(error){notify(file.name+'：'+error.message);}}await onChanged?.();}finally{setImportingRis(false);if(risPicker.current)risPicker.current.value='';}};
			const readingReports=reports.filter(report=>bundleById[report.bundleId]?.pdfIntake?.status!=='rejected');
			const filteredReports=readingReports.filter(report=>selectedFolder==='all'||(selectedFolder==='unfiled'?!report.folderId:report.folderId===selectedFolder));
			const pendingIntakeReports=filteredReports.filter(report=>['queued','running'].includes(bundleById[report.bundleId]?.pdfIntake?.status));
			const readyFilteredReports=filteredReports.filter(report=>!pendingIntakeReports.some(row=>row.id===report.id));
			const uploadingRows=pdfUploads.filter(row=>!row.bundleId||!reports.some(report=>report.bundleId===row.bundleId));
			const readingInteraction=useReadingInteractions({projectId,reports:readingReports,visibleReports:filteredReports,bundles:bundleById,root:literatureRoot,call,notify,onChanged,onContextMenu:setEntryMenu,setFolder:setSelectedFolder,onLocate:report=>{if(report)setLocateRequest({bundleId:report.bundleId,nonce:crypto.randomUUID()});}});
			const [machineReviews, setMachineReviews] = useState({});
			const [preview, setPreview] = useState(null); // { kind: "report" | "ppt", report, presentation? }
			const [activeLitTab, setActiveLitTab] = useState('reading');
			const [selectedReportId, setSelectedReportId] = useState('');
			const [watchReading, setWatchReading] = useState(false);
			const [watchPpt, setWatchPpt] = useState(false);
			const [metricsByJournal, setMetricsByJournal] = useState({});
			const metricsRequested = useRef(new Set());
			const [folderMenu, setFolderMenu] = useState(null);
			const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
			const [linkOpen, setLinkOpen] = useState(false);
			const [linkUrl, setLinkUrl] = useState('');
			const [linkBusy, setLinkBusy] = useState(false);
			const [linkError, setLinkError] = useState('');
			useEffect(() => {
				if (!uploadMenuOpen) return undefined;
				const close = () => setUploadMenuOpen(false);
				document.addEventListener('mousedown', close);
				return () => document.removeEventListener('mousedown', close);
			}, [uploadMenuOpen]);
			useEffect(() => {
				if (!folderMenu) return undefined;
				const close = () => setFolderMenu(null);
				document.addEventListener('mousedown', close);
				return () => document.removeEventListener('mousedown', close);
			}, [folderMenu]);
			const [templatesOpen, setTemplatesOpen] = useState(false);
			const [noteTemplates,setNoteTemplates]=useState([]);
			const [noteTemplateId,setNoteTemplateId]=useProjectViewValue(projectId,'reading-template','');
			useEffect(()=>{let alive=true;void call('note_templates_list',{request:{kind:'note'}}).then(result=>{if(alive)setNoteTemplates(result.templates??[]);}).catch(()=>{});return()=>{alive=false;};},[call]);
			useEffect(()=>{if(!templatesOpen)return undefined;const onKey=event=>{if(event.key==='Escape')setTemplatesOpen(false);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[templatesOpen]);
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
			const nativeDesktopAvailable = async () => {
				try {
					const status = await call('desktop_status');
					return Boolean(status?.available);
				} catch { return false; }
			};
			const nativeBrowser = async (action, input = {}) => {
				if (!await nativeDesktopAvailable()) return null;
				const targetProject = input.projectId ?? projectId;
				if (!targetProject) throw Error('请先选择一个课题，再打开科研浏览器');
				return call('desktop_browser', { request: { action, projectId: targetProject, ...input } });
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
				notify("文献自动捕获仅支持 iBM Lab Windows 桌面应用");
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
            const deleteReports = ids => {
                if(busy['delete-reading-entries'])return;
                const targets=readingReports.filter(report=>ids.includes(report.id));
                if(!targets.length)return;
                const first=targets[0],bundle=bundleById[first.bundleId]||{};
                const name=first.titleZh||bundle.title||first.shortCitation||first.id;
                const label=targets.length>1?`选中的 ${targets.length} 篇精读条目`:`精读条目“${name}”`;
                if(!window.confirm(`确定删除${label}吗？关联的精读报告、PPT 和本地文献归档也会一并删除。`))return;
                void run('delete-reading-entries',async()=>{
                    try{
                        for(const report of targets){
                            if(captureHint?.bundleId===report.bundleId){
                                if(captureHint.taskId)await cancelWebVpnCaptureViaShell(captureHint.taskId).catch(()=>{});
                                setCaptureHint(null);
                            }
                            if(preview?.report?.id===report.id)setPreview(null);
                            await call('tasks_report_delete',{request:{reportId:report.id,projectId}});
                            setOverview(old=>{const next={...old};delete next[report.id];return next;});
                        }
                        notify('精读条目已删除');
                    }finally{await onChanged();}
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
			const openPreview = (target) => {
				const isPpt = target.kind === "ppt";
				const key = `${isPpt ? "open-ppt" : "open-report"}:${target.report.id}`;
				void run(key, async () => {
					await openReader({projectId:target.report.projectId,bundleId:target.report.bundleId,kind:'pdf',mode:isPpt?'ppt':'report'});
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
			const citationOf = (report) => parseJournalCitation(report.shortCitation) || publicationCitation(bundleById[report.bundleId]) || parseJournalCitation(titleByBundle[report.bundleId]);
			const shortOf = (report) => citationOf(report)?.text || usableShortCitation(report.shortCitation) || titleByBundle[report.bundleId] || report.titleZh || `精读报告 ${report.id.slice(0, 12)}`;
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
						h("button", { className: "ib-icon-btn", "data-ready": siReady ? "true" : "false", "data-opening": opening[searchOpenKey("si")] ? "true" : undefined, disabled: !!opening[searchOpenKey("si")], title: opening[searchOpenKey("si")] ? "正在打开 SI PDF…" : (siReady ? "在侧栏打开 SI 补充材料" : "未提交 SI · 点击前往 DOI 页面"), onClick: (event) => siReady ? openSearchInSidebar(event, "si", paper.localSiUrl) : openExternal(event, doiUrl), "aria-label": "SI 补充材料" }, h(SiSvg, null))
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
			const selectedReport = filteredReports.find((row) => row.id === selectedReportId) || filteredReports[0] || null;
			const selectedBundle = selectedReport ? (bundleById[selectedReport.bundleId] || {}) : null;
			const selectedPdfUrl = selectedBundle?.pdfPath && /\.pdf$/i.test(selectedBundle.pdfPath) ? `/api/lab-artifacts?kind=pdf&bundleId=${encodeURIComponent(selectedBundle.id)}` : undefined;
			const selectedSiUrl = selectedBundle?.siPath ? `/api/lab-artifacts?kind=si&bundleId=${encodeURIComponent(selectedBundle.id)}` : undefined;
			const selectedTranslation = selectedReport ? (selectedBundle.translations ?? []).filter((row) => row.kind === 'pdf' && (!selectedBundle.pdfSha256 || row.sourceSha256 === selectedBundle.pdfSha256)).at(-1) : null;
			const selectedTranslationDone = selectedTranslation?.status === 'completed';
			const selectedTranslationBusy = ['queued', 'running'].includes(selectedTranslation?.status);
			const selectedPresentation = selectedReport ? presentationByReport[selectedReport.id] : null;
			const selectedReadingDone = Boolean(selectedReport?.docxPath);
			const selectedPptDone = Boolean(selectedPresentation?.pptxPath);
			useEffect(() => {
				if (!watchReading) return undefined;
				const timer = setInterval(() => onChanged?.(), 8000);
				const stop = setTimeout(() => setWatchReading(false), 10 * 60 * 1000);
				return () => { clearInterval(timer); clearTimeout(stop); };
			}, [watchReading, onChanged]);
			useEffect(() => {
				if (!watchPpt) return undefined;
				const timer = setInterval(() => onChanged?.(), 8000);
				const stop = setTimeout(() => setWatchPpt(false), 10 * 60 * 1000);
				return () => { clearInterval(timer); clearTimeout(stop); };
			}, [watchPpt, onChanged]);
			useEffect(() => { if (selectedReadingDone) setWatchReading(false); }, [selectedReadingDone]);
			useEffect(() => { if (selectedPptDone) setWatchPpt(false); }, [selectedPptDone]);
			const startReadingNote = () => {
				if (!selectedReport || !selectedPdfUrl) return;
				if (selectedReadingDone) { openPreview({ kind: 'report', report: selectedReport }); return; }
				setWatchReading(true);
				void onRequestArtifact(selectedReadingPrompt, true, undefined, undefined, { reportId: selectedReport.id }).catch(() => {});
			};
			const startPpt = () => {
				if (!selectedReport || !selectedPdfUrl) return;
				if (selectedPptDone) { openPreview({ kind: 'ppt', report: selectedReport, presentation: selectedPresentation }); return; }
				setWatchPpt(true);
				void onRequestArtifact(selectedPptPrompt, true, undefined, undefined, { reportId: selectedReport.id }).catch(() => {});
			};
			const selectedPublisherUrl = selectedBundle?.doi ? `https://doi.org/${encodeURIComponent(selectedBundle.doi)}` : (selectedBundle?.sourceUrl && /^https:/i.test(selectedBundle.sourceUrl) ? selectedBundle.sourceUrl : undefined);
			const citationFor = (report, bundle) => citationOf(report) || publicationCitation(bundle);
			const journalAbbrevOf = (bundle = {}, report = null) => citationFor(report, bundle)?.journal || bundle.journalAbbrev || bundle.journal || 'PREPRINT';
			const citationTextOf = (bundle = {}, report = null) => {
				const citation = citationFor(report, bundle);
				return citation ? citation.text.replace(/\.$/u, '') : [bundle.journal || bundle.journalAbbrev, bundle.year].filter(Boolean).join(' · ');
			};
			const coverOf = (bundle = {}, report = null) => {
				const journal = String(journalAbbrevOf(bundle, report) || 'PREPRINT');
				const token = String(journal.split(/[^\p{L}\p{N}]+/u)[0] || 'PREPRINT').toUpperCase();
				const label = /^NATURE/.test(token) ? 'NAT' : token.slice(0, 6);
				return h('span', { className: 'ib-paper-cover' }, h('b', { style: label.length > 5 ? { fontSize: '18px' } : undefined }, label), h('small', null, 'JOURNAL'));
			};			const metricBox = (label, value, tone) => h('div', { className: 'ib-lit-metric-box', 'data-tone': tone }, h('span', null, label), h('b', null, value));
			const openSelectedPdf = (event) => {
				event.stopPropagation();
				if (!selectedBundle) return;
				if (!selectedPdfUrl) { armCaptureFor(event, selectedBundle, 'pdf'); return; }
				void openReader({ projectId, bundleId: selectedBundle.id, kind: 'pdf' }).catch((reason) => notify('无法打开正文 PDF：' + (reason?.message ?? reason)));
			};
			useEffect(() => {
				const journals = [...new Set(readingReports.map((report) => bundleById[report.bundleId]?.journal).filter(Boolean))];
				for (const journal of journals) {
					if (metricsRequested.current.has(journal)) continue;
					metricsRequested.current.add(journal);
					void call('tasks_journal_metrics', { request: { journal } }).then((value) => {
						setMetricsByJournal((old) => ({ ...old, [journal]: value ?? null }));
						if (value && value.top == null) {
							setTimeout(() => {
								void call('tasks_journal_metrics', { request: { journal } }).then((next) => {
									if (next && next.top != null) setMetricsByJournal((old) => ({ ...old, [journal]: next }));
								}).catch(() => {});
							}, 12000);
						}
					}).catch(() => setMetricsByJournal((old) => ({ ...old, [journal]: null })));
				}			}, [readingReports, bundleById, call]);			const selectedReadingPrompt = selectedReport ? `请精读文献「${selectedReport.titleZh || selectedBundle.title || selectedReport.id}」（bundleId: ${selectedReport.bundleId || selectedBundle.id || "未登记"}，reportId: ${selectedReport.id}）。先读取本课题已归档的 PDF/SI 和当前阅读笔记模板，按模板完成精读报告，并调用 lab_tasks_register_report 登记到该 reportId。` + (noteTemplateId ? `\n使用阅读笔记模板：${noteTemplateId}（调用 lab_tasks_get_reading_inputs 时传 noteTemplateId，登记报告时沿用该模板）。` : '') : '';
			const selectedPptPrompt = selectedReport ? `请为文献「${selectedReport.titleZh || selectedBundle.title || selectedReport.id}」（reportId: ${selectedReport.id}）制作汇报 PPT。先读取已归档 PDF/SI、已有精读报告和当前 PPT 模板，按模板生成 PPTX，并调用 lab_tasks_register_presentation 登记。` : '';
			const translateSelected = async (event) => {
				event.stopPropagation();
				if (!selectedBundle) return;
				let created;
				const req = { projectId, bundleId: selectedBundle.id, kind: 'pdf' };
				try {
					const result = await call('tasks_translation_create', { request: req });
					created = result;
					if (result.translation.status === 'completed') await openReader({ ...req, mode: 'zh' });
					else if (result.readyToCompose) { await call('tasks_translation_finish', { request: { ...req, translationId: result.translation.id } }); await openReader({ ...req, mode: 'zh' }); }
					else if (!result.reused) await onRequestArtifact(translationPrompt(req, result.translation.id), true, { ...req, translationId: result.translation.id });
					else notify('此翻译任务已在进行；打开正文侧栏可查看进度。');
					onChanged?.();
				} catch (error) {
					if (created && !created.reused && !created.readyToCompose) await call('tasks_translation_cancel', { request: { ...req, translationId: created.translation.id } }).catch(() => {});
					notify('翻译启动失败：' + error.message);
				}
			};
			const detailNode = selectedReport ? h('aside', { className: 'ib-lit-detail', 'aria-label': '文献详情' },
				h('div', { className: 'ib-lit-detail-head' }, h('h2', null, '文献详情')),
				h('div', { className: 'ib-lit-detail-lead' },
					h('span', { className: 'ib-paper-cover ib-paper-cover-lg', style: { ...coverOf(selectedBundle, selectedReport).props.style } }, coverOf(selectedBundle, selectedReport).props.children),
					h('div', { className: 'ib-lit-detail-title' },
						h('h3', null, selectedReport.titleZh || selectedBundle.title || selectedReport.id),
						h('div', { className: 'ib-lit-detail-cite' },
							h('span', null, citationTextOf(selectedBundle, selectedReport) || '未登记期刊'),
							selectedPublisherUrl ? h('a', { href: selectedPublisherUrl, target: '_blank', rel: 'noopener noreferrer', title: '打开原文网站', onClick: (event) => event.stopPropagation() }, '↗') : null))),
				h('section', { className: 'ib-lit-detail-intro' },
					h('h4', null, '简介'),
					h('p', null, selectedReport.shortDescriptionZh || selectedReport.summaryZh || selectedBundle.summaryZh || selectedBundle.abstract || '暂无简介；可开始阅读后在阅读器中查看 AI 概览。')),
				h('section', { className: 'ib-lit-detail-section' },
					h('div', { className: 'ib-lit-detail-section-head' }, h('h4', null, '文件'),
						h('button', { type: 'button', className: 'ib-lit-mini-btn', disabled: !selectedBundle || (selectedPdfUrl && selectedSiUrl), title: '自动获取缺失文件', onClick: (event) => { event.stopPropagation(); if (!selectedBundle) return; armCaptureFor(event, selectedBundle, selectedPdfUrl ? 'si' : 'pdf'); } }, '↓ 自动获取')),
					h('div', { className: 'ib-lit-file-row' }, h('span', { className: 'ib-lit-file-icon' }, '▤'), h('div', null, h('b', null, '原文 PDF'), h('small', null, selectedPdfUrl ? '已上传' : '未上传')), h('i', { className: 'ib-lit-dot', 'data-ready': selectedPdfUrl ? 'true' : 'false' }), h('button', { type: 'button', className: 'ib-lit-mini-btn', onClick: openSelectedPdf }, selectedPdfUrl ? '打开' : '上传')),
					h('div', { className: 'ib-lit-file-row' }, h('span', { className: 'ib-lit-file-icon' }, '▤'), h('div', null, h('b', null, '补充材料 (SI)'), h('small', null, selectedSiUrl ? '已上传' : '未上传')), h('i', { className: 'ib-lit-dot', 'data-ready': selectedSiUrl ? 'true' : 'false' }), h('button', { type: 'button', className: 'ib-lit-mini-btn', onClick: (event) => { event.stopPropagation(); if (selectedSiUrl) void openReader({ projectId, bundleId: selectedBundle.id, kind: 'si' }).catch((reason) => notify(reason.message)); else armCaptureFor(event, selectedBundle, 'si'); } }, selectedSiUrl ? '打开' : '上传'))),
				h('section', { className: 'ib-lit-detail-section' },
					h('div', { className: 'ib-lit-detail-section-head' }, h('h4', null, '翻译')),
					h('div', { className: 'ib-lit-file-row' }, h('span', { className: 'ib-lit-file-icon' }, '文'), h('div', null, h('b', null, '全文翻译'), h('small', null, selectedTranslationDone ? '已完成' : selectedTranslationBusy ? '进行中…' : '待翻译')), h('button', { type: 'button', className: 'ib-lit-mini-btn', disabled: !selectedPdfUrl || selectedTranslationBusy, onClick: (event) => selectedTranslationDone ? void openReader({ projectId, bundleId: selectedBundle.id, kind: 'pdf', mode: 'zh' }).catch((reason) => notify(reason.message)) : translateSelected(event) }, selectedTranslationDone ? '查看译文' : selectedTranslationBusy ? '翻译中…' : '开始翻译'))),
				h('div', { className: 'ib-lit-detail-actions' },
					h('button', { type: 'button', className: 'ib-lit-primary', disabled: !selectedPdfUrl, title: selectedPdfUrl ? '开始阅读' : '未获取正文，暂时无法阅读', onClick: openSelectedPdf }, h(BookSvg, null), selectedPdfUrl ? '开始阅读' : '在线浏览'),
					h('button', { type: 'button', className: 'ib-lit-secondary', 'data-done': selectedReadingDone ? 'true' : 'false', disabled: !selectedPdfUrl, onClick: startReadingNote }, h(ReadingNoteSvg, null), selectedReadingDone ? '查看阅读笔记' : '阅读笔记'),
					h('button', { type: 'button', className: 'ib-lit-secondary', 'data-done': selectedPptDone ? 'true' : 'false', disabled: !selectedPdfUrl, onClick: startPpt }, h(PresentationSvg, null), selectedPptDone ? '查看 PPT' : '生成 PPT'))) : h('aside', { className: 'ib-lit-detail ib-lit-detail-empty' }, '选择左侧文献查看详情');
			const toolbarNode = h('div', { className: 'ib-lit-toolbar' },
						h('button', { className: 'ib-act', onClick: () => setTemplatesOpen(true) }, '▤ 模板管理'),
						h('button', { className: 'ib-act', disabled: importingRis, onClick: () => risPicker.current?.click() }, '↑ 上传 RIS'),
						h('div', { className: 'ib-lit-upload-wrap' },
							h('button', { className: 'ib-act ib-act-primary', 'aria-expanded': uploadMenuOpen, onClick: () => setUploadMenuOpen((value) => !value) }, '+ 上传文献'),
							uploadMenuOpen ? h('div', { className: 'ib-lit-upload-menu', onMouseDown: (event) => event.stopPropagation() },
								h('button', { type: 'button', onClick: () => { setUploadMenuOpen(false); setLinkOpen(true); } }, '从链接导入'),
								h('button', { type: 'button', onClick: () => { setUploadMenuOpen(false); pdfPicker.current?.click(); } }, '从本地文件导入')) : null),
						h('input', { type: 'file', accept: '.ris', multiple: true, hidden: true, ref: risPicker, onChange: (event) => void importRisFiles(event.target.files) }),
						h('input', { ref: pdfPicker, type: 'file', accept: '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: true, hidden: true, onChange: (event) => void uploadPdfs(event.target.files) }))

			return h(React.Fragment, null, headerTarget ? createPortal(toolbarNode, headerTarget) : null, h('div', { className: 'ib-lit ib-lit-workbench', 'data-toolbar-in-header': headerTarget ? 'true' : undefined, ref: literatureRoot },
				h('section', { className: 'ib-lit-catalog', 'data-dragging': pdfDragging ? 'true' : undefined,
				'aria-label': '精读文献，支持拖入 PDF、DOCX', onDragEnter: (event) => { if (pdfDragEvent(event)) { dragDepth.current++; setPdfDragging(true); } }, onDragOver: (event) => { if (pdfDragEvent(event)) event.dataTransfer.dropEffect = 'copy'; }, onDragLeave: (event) => { if (pdfDragEvent(event) && --dragDepth.current <= 0) { dragDepth.current = 0; setPdfDragging(false); } }, onDrop: (event) => { if (!pdfDragEvent(event)) return; dragDepth.current = 0; setPdfDragging(false); void uploadPdfs(event.dataTransfer.files); } },
				pdfDragging ? h('div', { className: 'ib-lit-drop-overlay', role: 'status' }, '松开以导入文献（PDF、DOCX）') : null,
					headerTarget ? null : toolbarNode,
					h('div', { className: 'ib-lit-tabs' },
						h('button', { type: 'button', className: 'ib-lit-tab', 'data-active': activeLitTab === 'reading' ? 'true' : undefined, onClick: () => setActiveLitTab('reading') }, '精读文献 ', h('span', null, readingReports.length)),
						h('button', { type: 'button', className: 'ib-lit-tab', 'data-active': activeLitTab === 'search' ? 'true' : undefined, onClick: () => setActiveLitTab('search') }, '检索记录 ', h('span', null, searches.length))),
					activeLitTab === 'reading' ? h(React.Fragment, null,
						h('div', { className: 'ib-lit-folders' }, [{ id: 'all', name: '全部' }, { id: 'unfiled', name: '未分类' }, ...folders].map((folder) => h('button', { key: folder.id, type: 'button', className: 'ib-lit-folder', ...readingInteraction.folderProps(folder), 'data-active': selectedFolder === folder.id ? 'true' : undefined, onClick: () => { readingInteraction.clear(); setSelectedFolder(folder.id); }, onContextMenu: (event) => { if (folder.id === 'all' || folder.id === 'unfiled') return; event.preventDefault(); event.stopPropagation(); setFolderMenu({ x: event.clientX, y: event.clientY, id: folder.id, name: folder.name }); } }, folder.name, h('span', null, reports.filter((row) => folder.id === 'all' || (folder.id === 'unfiled' ? !row.folderId : row.folderId === folder.id)).length))), folderEditor ? h('input', { className: 'ib-lit-folder-input', autoFocus: true, value: folderEditor.name, maxLength: 80, placeholder: '分组名称', onChange: (event) => setFolderEditor({ ...folderEditor, name: event.target.value }), onKeyDown: (event) => { if (event.key === 'Escape') { event.preventDefault(); setFolderEditor(null); } else if (event.key === 'Enter') { event.preventDefault(); void saveFolderEditor(); } } }) : h('button', { type: 'button', className: 'ib-lit-folder ib-lit-folder-add', title: '新建分组', onClick: createFolder }, '+')),
						(uploadingRows.length || pendingIntakeReports.length) ? h('div', { className: 'ib-lit-list ib-lit-cards' }, [...uploadingRows.map((row) => h('div', { key: 'upload-' + row.id, className: 'ib-lit-card ib-lit-card-loading', role: 'status', 'aria-busy': 'true' }, h('span', { className: 'ib-lit-loading-spinner' }, h(SpinSvg, null)), h('div', { className: 'ib-lit-card-copy' }, h('b', { className: 'ib-lit-title' }, row.name), h('div', { className: 'ib-lit-meta' }, '正在上传…')))), ...pendingIntakeReports.map((report) => { const bundle = bundleById[report.bundleId] || {}; return h('div', { key: 'intake-' + report.id, className: 'ib-lit-card ib-lit-card-loading', role: 'status', 'aria-busy': 'true' }, h('span', { className: 'ib-lit-loading-spinner' }, h(SpinSvg, null)), h('div', { className: 'ib-lit-card-copy' }, h('b', { className: 'ib-lit-title' }, bundle.pdfIntake?.originalFileName || report.titleZh || bundle.title || report.id), h('div', { className: 'ib-lit-meta' }, (bundle.pdfIntake?.stage || '正在识别文献') + '…'))); })]) : null,
													h('div', { className: 'ib-lit-list ib-lit-cards', role: 'listbox', 'aria-label': '精读文献条目' }, (readyFilteredReports.length || uploadingRows.length || pendingIntakeReports.length) ? readyFilteredReports.map((report) => {
							const bundle = bundleById[report.bundleId] || {};
							const selected = selectedReport?.id === report.id;
							const metrics = metricsByJournal[bundle.journal];
							return h('div', { key: report.id, ...readingInteraction.rowProps(report), className: 'ib-lit-card' + (selected ? ' ib-lit-card-detail' : ''), onClick: (event) => { if (event.target.closest('button')) return; readingInteraction.rowProps(report).onClick(event); setSelectedReportId(report.id); } },
								coverOf(bundle, report),
								h('div', { className: 'ib-lit-card-copy' },
									h('b', { className: 'ib-lit-title' }, report.titleZh || bundle.title || report.id),
									h('div', { className: 'ib-lit-card-cite' }, h('span', { className: 'ib-lit-cite-text' }, citationTextOf(bundle, report) || '未登记期刊'), metrics?.field || metrics?.subfield ? h('span', { className: 'ib-lit-field-pill' }, metrics.field || metrics.subfield) : null)),
								h('div', { className: 'ib-lit-metrics' }, metricBox('影响因子', metrics === undefined ? '…' : metrics ? metrics.impactFactor : '—', 'if'), metricBox('中科院分区', metrics === undefined ? '…' : metrics?.casTier ? metrics.casTier + '区' : '待核实', 'cas'), metricBox('TOP期刊', metrics === undefined ? '…' : metrics?.top === true ? '是' : metrics?.top === false ? '否' : '待核实', 'top')));
						}) : ((uploadingRows.length || pendingIntakeReports.length) ? null : h('div', { className: 'ib-lit-empty' }, '尚无精读条目。上传或拖入 PDF，或在对话中登记文献。')))) : h('div', { className: 'ib-lit-search-list' }, searches.length ? searches.slice().reverse().map((search) => h('div', { key: search.id, className: 'ib-lit-card ib-lit-search-card' }, h('div', { className: 'ib-lit-card-copy' }, h('b', { className: 'ib-lit-title' }, search.title || search.query || search.id), h('div', { className: 'ib-lit-meta' }, `${(search.results || []).length} 篇 · ${when(search.updatedAt || search.createdAt)}`)), h('button', { type: 'button', className: 'ib-lit-mini-btn', onClick: (event) => { event.stopPropagation(); setExpandedSearch((value) => value === search.id ? '' : search.id); } }, expandedSearch === search.id ? '收起' : '查看'))) : h('div', { className: 'ib-lit-empty' }, '暂无检索记录。'))),
				detailNode), folderMenu ? h('div', { className: 'ib-lit-folder-menu', style: { left: folderMenu.x, top: folderMenu.y }, onMouseDown: (event) => event.stopPropagation() }, h('button', { type: 'button', onClick: () => void deleteFolder() }, '删除分组')) : null,
				linkOpen ? h('div', { className: 'ib-lit-link-modal', onClick: (event) => { if (event.target === event.currentTarget) setLinkOpen(false); } }, h('section', { className: 'ib-lit-link-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '从链接导入文献', onClick: (event) => event.stopPropagation() }, h('header', { className: 'ib-lit-link-head' }, h('span', { className: 'ib-lit-link-icon' }, h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.1 1.1' }), h('path', { d: 'M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1.1-1.1' }))), h('div', { className: 'ib-lit-link-head-copy' }, h('h2', null, '从链接导入'), h('p', null, '支持 DOI、出版商链接或微信公众号文章链接')), h('button', { type: 'button', className: 'ib-lit-link-close', 'aria-label': '关闭', onClick: () => setLinkOpen(false) }, '×')), h('form', { className: 'ib-lit-link-form', onSubmit: submitLink }, h('label', { className: 'ib-lit-link-label', htmlFor: 'ib-lit-link-url' }, '文献链接'), h('div', { className: 'ib-lit-link-field' }, h('input', { id: 'ib-lit-link-url', type: 'text', required: true, autoFocus: true, value: linkUrl, placeholder: '粘贴 DOI 或文章链接', onChange: (event) => setLinkUrl(event.target.value) }), h('span', { className: 'ib-lit-link-divider', 'aria-hidden': 'true' }), h('button', { type: 'button', className: 'ib-lit-link-paste', onClick: async () => { try { const text = await navigator.clipboard.readText(); if (text) setLinkUrl(text.trim()); } catch { notify('无法读取剪贴板，请手动粘贴链接'); } } }, '▤ 粘贴')), h('div', { className: 'ib-lit-link-hint' }, '例如：10.xxxx/xxxxx 或 https://…'), linkError ? h('div', { className: 'ib-lit-link-error', role: 'alert' }, linkError) : null, h('footer', { className: 'ib-lit-link-actions' }, h('button', { type: 'button', className: 'ib-lit-link-cancel', onClick: () => setLinkOpen(false) }, '取消'), h('button', { type: 'submit', className: 'ib-lit-link-submit', disabled: linkBusy || !linkUrl.trim() }, linkBusy ? '正在解析…' : '开始解析 →'))))) : null,
				entryMenu ? h(ReadingContextMenu, { menu: entryMenu, onClose: closeEntryMenu, onDelete: deleteReports }) : null,
				templatesOpen ? h('div', { role: 'presentation', onClick: (event) => { if (event.target === event.currentTarget) setTemplatesOpen(false); }, style: { position: 'fixed', inset: 0, zIndex: 9000, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,0.35)', padding: '24px' } }, h('section', { role: 'dialog', 'aria-modal': 'true', style: { width: 'min(1020px,68vw)', height: '65vh', background: 'var(--ib-bg)', border: '1px solid var(--ib-line)', borderRadius: '14px', overflow: 'hidden' } }, h('div', { style: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid var(--ib-hair)' } }, h('b', null, '模板管理'), h('button', { className: 'ib-btn', style: { marginLeft: 'auto' }, onClick: () => setTemplatesOpen(false) }, '关闭')), h('div', { style: { padding: '16px 20px', overflow: 'auto', height: 'calc(100% - 56px)' } }, h(TemplateLibrary, { call, sections: ['notes', 'reviews', 'ppt'] })))) : null, previewNode);
			return h(React.Fragment, null, h("div", { className: "ib-lit", ref: literatureRoot },
				// ── 分组一：检索记录 ────────────────────────────────────────────────
				// 视觉改版：不再套「文献资料」外层大框与重复标题、不再写布局
				// 说明文字；分组标题 + 条目列表直接铺在内容区，靠留白与细分隔线区分。
				h("section", { className: "ib-lit-group ib-search-drop ib-literature-drop", key: "searches", 'data-dragging':risDragging?'true':undefined, 'aria-label':'检索记录，支持拖入 RIS',
					onDragEnter:event=>{if(pdfDragEvent(event)){risDragDepth.current++;setRisDragging(true);}},
					onDragOver:event=>{if(pdfDragEvent(event))event.dataTransfer.dropEffect='copy';},
					onDragLeave:event=>{if(pdfDragEvent(event)&&--risDragDepth.current<=0){risDragDepth.current=0;setRisDragging(false);}},
					onDrop:event=>{if(!pdfDragEvent(event))return;risDragDepth.current=0;setRisDragging(false);void importRisFiles(event.dataTransfer.files);}
				},
					h("div", { className: "ib-group-head" },
						h("h3", null, "检索记录"),
						h('button',{className:'ib-act',disabled:importingRis,onClick:()=>risPicker.current?.click()},importingRis?'正在导入…':'上传 RIS'),
						h('input',{type:'file',accept:'.ris',multiple:true,hidden:true,ref:risPicker,'aria-label':'上传检索 RIS',onChange:event=>void importRisFiles(event.target.files)}),
						h("span", { className: "ib-group-count" }, `${searches.length} 条`)),
					risDragging?h('div',{className:'ib-literature-drop-label',role:'status'},'松开以导入 RIS'):null,
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
								h("button", { className: "ib-act", "data-kind": "accent", disabled: !resultCount, onClick: (event) => { event.stopPropagation(); setExpandedSearch((value) => value === search.id ? '' : search.id); }, title: "展开本会话的全部去重文献" }, expanded ? "收起文献" : "查看文献"),
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
				h("section", { className: "ib-lit-group ib-reading-drop ib-literature-drop", key: "reports", 'data-dragging':pdfDragging?'true':undefined, 'aria-label':'精读文献，支持拖入 PDF、DOCX',
					onDragEnter:event=>{if(pdfDragEvent(event)){dragDepth.current++;setPdfDragging(true);}},
					onDragOver:event=>{if(pdfDragEvent(event))event.dataTransfer.dropEffect='copy';},
					onDragLeave:event=>{if(pdfDragEvent(event)&&--dragDepth.current<=0){dragDepth.current=0;setPdfDragging(false);}},
					onDrop:event=>{if(!pdfDragEvent(event))return;dragDepth.current=0;setPdfDragging(false);void uploadPdfs(event.dataTransfer.files);}
				},
					h("div", { className: "ib-group-head" },
						h("h3", null, "精读文献"),
						h('button',{className:'ib-act',onClick:()=>pdfPicker.current?.click()},'上传文献'),
						h(ReadingLinkUpload,{projectId,onRequestArtifact,notify,onSubmitted:()=>setSelectedFolder('all')}),
						h('input',{ref:pdfPicker,type:'file',accept:'.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document',multiple:true,hidden:true,'aria-label':'上传精读文献',onChange:event=>void uploadPdfs(event.target.files)}),
						h('button',{className:'ib-act',onClick:createFolder},'+ 文件夹'),
						noteTemplates.length?h('select',{className:'ib-act','aria-label':'精读模板',title:'快速读懂使用的精读模板',value:noteTemplateId,onChange:event=>setNoteTemplateId(event.target.value),style:{maxWidth:190}},h('option',{value:''},'默认精读模板'),noteTemplates.map(row=>h('option',{key:row.id,value:row.id},row.name))):null,
						h('button',{className:'ib-act',onClick:()=>setTemplatesOpen(true),title:'管理文献精读、PPT 制作与综述写作模板'},'模板管理'),
						h("span", { className: "ib-group-count" }, `${readingReports.length} 篇`)),
					rejectionNotices.length?h('div',{className:'ib-non-paper-notices'},rejectionNotices.map(notice=>h(NonPaperNotice,{key:notice.id,notice,onDismiss:dismissRejection}))):null,
					pdfDragging?h('div',{className:'ib-literature-drop-label',role:'status'},'松开以导入文献（PDF、DOCX）'):null,
					pdfUploads.filter(row=>!row.bundleId||!reports.some(report=>report.bundleId===row.bundleId)).map(row=>h('div',{key:row.id,className:'ib-lit-item ib-pdf-processing','data-intake-state':'uploading',role:'status','aria-busy':true},h(SpinSvg,null),h('div',null,h('b',null,row.name),h('div',null,'正在上传文献…')))),
					folderEditor?h('form',{className:'ib-folder-editor',style:{display:'flex',gap:8,marginBottom:12},onSubmit:event=>{event.preventDefault();void folderAction('tasks_reading_folder_save',folderEditor).then(ok=>{if(ok)setFolderEditor(null);});}},h('input',{value:folderEditor.name,maxLength:80,autoFocus:true,'aria-label':'文件夹名称',placeholder:'文件夹名称，例如：核酸递送',onChange:event=>setFolderEditor({...folderEditor,name:event.target.value})}),h('button',{className:'ib-act',type:'submit'},'保存文件夹'),h('button',{className:'ib-act',type:'button',onClick:()=>setFolderEditor(null)},'取消')):null,
					h('div',{className:'ib-reading-folders',style:{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}},[{id:'all',name:'全部'},{id:'unfiled',name:'未分类'},...folders].map(folder=>h('button',{key:folder.id,className:'ib-act',...readingInteraction.folderProps(folder),'data-selected':selectedFolder===folder.id?'true':undefined,style:selectedFolder===folder.id?{background:'var(--ib-accent-soft)',color:'var(--ib-accent-ink)'}:undefined,onClick:()=>{readingInteraction.clear();setSelectedFolder(folder.id);}},`${folder.id==='all'?'':'📁 '}${folder.name} (${reports.filter(row=>folder.id==='all'||(folder.id==='unfiled'?!row.folderId:row.folderId===folder.id)).length})`)),folders.some(row=>row.id===selectedFolder)?h(React.Fragment,null,h('button',{className:'ib-act',onClick:()=>{setFolderEditor({id:selectedFolder,name:folders.find(row=>row.id===selectedFolder).name});}},'重命名'),h('button',{className:'ib-act',onClick:()=>{if(window.confirm('删除该分类文件夹？其中的文献将移到“未分类”，保留报告及归档文件。')){void folderAction('tasks_reading_folder_delete',{id:selectedFolder}).then(ok=>{if(ok)setSelectedFolder('unfiled');});}}},'删除文件夹')):null),
					filteredReports.length ? h("div", { className: "ib-lit-list",role:'listbox','aria-label':'精读文献条目','aria-multiselectable':true }, filteredReports.map((report) => {
						const presentation = presentationByReport[report.id];
						const bundle = bundleById[report.bundleId] || {};
						const intake=bundle.pdfIntake;
						if(['queued','running'].includes(intake?.status))return h('div',{className:'ib-lit-item ib-pdf-processing',key:report.id,'data-intake-state':intake.status,'data-bundle-id':bundle.id,role:'status','aria-busy':true},h(SpinSvg,null),h('div',null,h('b',null,intake.originalFileName),h('div',null,intake.stage+'…')));
						const awaitingPdf = bundle.acquisitionStatus === "awaiting-pdf";
						const hasMainText = !awaitingPdf && /\.(pdf|docx)$/i.test(bundle.pdfPath || '');
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
						// 翻译、精读、PPT 保持固定名称，以完成产物决定按钮颜色。
						const readingDone = Boolean(report.docxPath);
						const translation=(bundle.translations??[]).filter(row=>row.kind==='pdf'&&(!bundle.pdfSha256||row.sourceSha256===bundle.pdfSha256)).at(-1);
						const translationDone = translation?.status === 'completed';
						const translationBusy = ['queued', 'running'].includes(translation?.status);
						const translateEntry=async(event)=>{event.stopPropagation();let created;const request={projectId,bundleId:bundle.id,kind:'pdf'};try{const result=await call('tasks_translation_create',{request});created=result;if(result.translation.status==='completed')await openReader({...request,mode:'zh'});else if(result.readyToCompose){await call('tasks_translation_finish',{request:{...request,translationId:result.translation.id}});await openReader({...request,mode:'zh'});}else if(!result.reused)await onRequestArtifact(translationPrompt(request,result.translation.id),true,{...request,translationId:result.translation.id});else notify('此翻译任务已在进行；打开正文侧栏可查看进度或取消后重试。');onChanged?.();}catch(error){if(created&&!created.reused&&!created.readyToCompose)await call('tasks_translation_cancel',{request:{...request,translationId:created.translation.id}}).catch(()=>{});onChanged?.();notify('翻译启动失败：'+error.message);}};
						const readingBusy = Boolean(busy[`open-report:${report.id}`]);
						const pptDone = Boolean(presentation?.pptxPath);
						const pptBusy = Boolean(busy[`open-ppt:${report.id}`]);
						const paperName = report.titleZh || bundle.title || zhOf(report) || report.id;
						const readingPrompt = `请精读文献「${paperName}」（bundleId: ${report.bundleId || bundle.id || "未登记"}，reportId: ${report.id}）。先读取本课题已归档的 PDF/SI 和当前阅读笔记模板，按模板完成精读报告，并调用 lab_tasks_register_report 登记到该 reportId。`+(noteTemplateId?`\n使用阅读笔记模板：${noteTemplateId}（调用 lab_tasks_get_reading_inputs 时传 noteTemplateId，登记报告时沿用该模板）。`:'');
						const pptPrompt = `请为文献「${paperName}」（reportId: ${report.id}）制作汇报 PPT。先读取已归档 PDF/SI、已有精读报告和当前 PPT 模板，按模板生成 PPTX，并调用 lab_tasks_register_presentation 登记。`;
						return h("div", { className: "ib-lit-item", key: report.id, 'data-intake-state':intake?.status, 'data-bundle-id':bundle.id,...readingInteraction.rowProps(report) },
							// 同尺寸图标保持可见，窄容器将操作区移到标题下方。
							h("div", { className: "ib-lit-row" },
								h("div", { className: "ib-lit-main" },
									h("b", { className: "ib-lit-title ib-citation", title: shortOf(report) }, shortNode(report)),
									zhTitle ? h("div", { className: "ib-lit-zh", title: zhTitle }, zhTitle) : null,
									intake?.status==='failed'?h('div',{className:'ib-pdf-intake-error',role:'alert'},h('span',null,intake.error||'文献信息识别失败'),h('button',{className:'ib-act',disabled:!!busy['pdf-retry:'+bundle.id],onClick:()=>void run('pdf-retry:'+bundle.id,async()=>{await call('tasks_reading_pdf_retry',{request:{projectId,bundleId:bundle.id}});await onChanged?.();})},'重新识别')):null,
								),
								h("div", { className: "ib-lit-acts ib-reading-acts" },
									h("div", { className: "ib-reading-act-row", "data-row": "files" },
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
									// 简介（约 200 字，篇幅要求是给 Agent 的，不写进按钮文案）。
									h("button", { className: "ib-icon-btn", 'aria-label':report.id in overview?'收起简介':'简介', 'aria-expanded':report.id in overview, 'aria-busy':!!busy[`ov:${report.id}`], 'data-active':report.id in overview?'true':undefined, disabled: !!busy[`ov:${report.id}`], onClick: () => void openOverview(report), title: report.id in overview?'收起简介':awaitingPdf ? "展开已提取的元数据摘要" : "展开文献概览" }, busy[`ov:${report.id}`] ? h(SpinSvg,null) : h(OverviewSvg,null))
									),
									h("div", { className: "ib-reading-act-row", "data-row": "artifacts" },
									h('button', {
										className: 'ib-icon-btn', 'aria-label':'翻译', 'data-kind': 'translation', 'data-done': translationDone ? 'true' : 'false', 'data-busy': translationBusy ? 'true' : undefined,
										'aria-busy': translationBusy, disabled: !bundlePdfUrl || translationBusy, onClick: translateEntry,
										title: translationBusy ? '翻译进行中，可在正文侧栏查看进度' : translationDone ? '在侧栏阅读已完成的中文译文' : '全文翻译并在侧栏进行中文/双语对照阅读'
									}, translationBusy ? h(SpinSvg, null) : h(TranslateSvg,null)),
									h("button", {
										className: "ib-icon-btn", "aria-label":"精读", "data-kind": "reading", "data-done": readingDone ? "true" : "false", "data-busy": readingBusy ? "true" : undefined, "aria-busy": readingBusy,
										disabled: !hasMainText || readingBusy,
										onClick: () => readingDone ? openPreview({ kind: "report", report }) : void onRequestArtifact(readingPrompt,true,undefined,undefined,{reportId:report.id}).catch(()=>{}),
										title: !hasMainText ? "请先上传或获取论文正文，再进行精读" : readingDone ? "打开已生成的精读报告" : "立即发送精读任务到科研助手"
									}, readingBusy ? h(SpinSvg, null) : h(ReadingNoteSvg,null)),
									h("button", {
										className: "ib-icon-btn", "aria-label":"PPT", "data-kind": "ppt", "data-done": pptDone ? "true" : "false", "data-busy": pptBusy ? "true" : undefined, "aria-busy": pptBusy,
										disabled: !hasMainText || pptBusy,
										onClick: () => pptDone ? openPreview({ kind: "ppt", report, presentation }) : void onRequestArtifact(pptPrompt,true,undefined,undefined,{reportId:report.id}).catch(()=>{}),
										title: !hasMainText ? "请先上传或获取论文正文，再制作 PPT" : pptDone ? "打开已生成的汇报 PPT" : "立即发送 PPT 任务到科研助手"
									}, pptBusy ? h(SpinSvg, null) : h(PresentationSvg,null)),
									h(EntryConversationButton,{sessionId:readingConversationId(report,bundle),onOpen:sessionId=>onOpenConversation(sessionId,{kind:'reading',reportId:report.id,bundleId:bundle.id}),notify})
									)
								)
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
					})) : !pdfUploads.length?h("div", { className: "ib-lit-empty" }, "尚无精读条目。上传或拖入 PDF，或在对话中登记文献。") : null
				)
			), entryMenu?h(ReadingContextMenu,{menu:entryMenu,onClose:closeEntryMenu,onDelete:deleteReports}):null, templatesOpen?h('div',{role:'presentation',onClick:event=>{if(event.target===event.currentTarget)setTemplatesOpen(false);},style:{position:'fixed',inset:0,zIndex:9000,display:'grid',placeItems:'center',background:'rgba(15,23,42,0.35)',padding:'24px',WebkitAppRegion:'no-drag'}},h('section',{role:'dialog','aria-modal':'true','aria-label':'文献模板管理','data-literature-templates':true,style:{width:'min(1020px,68vw)',height:'65vh',maxHeight:'65vh',display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--ib-bg)',border:'1px solid var(--ib-line)',borderRadius:'14px',padding:0,boxSizing:'border-box',WebkitAppRegion:'no-drag'}},h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'12px 20px',borderBottom:'1px solid var(--ib-hair)',flex:'0 0 auto',WebkitAppRegion:'no-drag'}},h('div',{style:{fontSize:12,color:'rgba(18,60,51,.72)'}},'iBM Lab / 文献阅读 / 模板管理'),h('button',{type:'button',className:'ib-btn','data-primary':true,'aria-label':'关闭','title':'关闭',onPointerDown:event=>{event.preventDefault();event.stopPropagation();setTemplatesOpen(false);},onClick:event=>{event.stopPropagation();setTemplatesOpen(false);},style:{marginLeft:'auto',height:34,padding:'0 18px',borderRadius:8,fontSize:12.5,lineHeight:1,WebkitAppRegion:'no-drag'}},'关闭')),h('div',{style:{flex:1,minHeight:0,overflow:'auto',padding:'16px 20px',WebkitAppRegion:'no-drag'}},h(TemplateLibrary,{call,sections:['notes','reviews','ppt']})))):null, previewNode);
		}
