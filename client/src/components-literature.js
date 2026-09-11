import React, { useState, useEffect, useCallback, useRef } from "react";
import { h } from "./h.js";
import { databaseState, databaseStateTone, downloadState } from "./constants.js";
import { when, openPdfPreview, downloadVerifiedBinary, openExternalUrl, openInEdgeViaShell, webVpnStatusViaShell, openWebVpnLoginViaShell, confirmWebVpnLoginViaShell, clearWebVpnSessionViaShell } from "./lib.js";
import { FlaskSvg } from "./components-templates.js";

// 文献相关组件：DatabaseOverview/FullTextDownloader/useBoundProject/ProjectBadge/ResearchFileUpload
export function DatabaseOverview({ call, notify }) {
			const [snapshot, setSnapshot] = useState({ loading: true, sources: [], checkedAt: "", error: "" });
			const [busy, setBusy] = useState("");
			const [open, setOpen] = useState(false);
			const [webvpn, setWebvpn] = useState(null);
			const refreshWebvpn = useCallback(async () => {
				if (window.parent === window) return;
				try { setWebvpn(await webVpnStatusViaShell()); }
				catch { setWebvpn(null); }
			}, []);
			const refresh = useCallback(async (force = false) => {
				try {
					const result = await call("literature_status", { request: { force } });
					setSnapshot({ loading: false, sources: result.sources || [], checkedAt: result.checkedAt || "", browserMode: result.browserMode || "managed-edge", error: "" });
				} catch (reason) { setSnapshot((old) => ({ ...old, loading: false, error: reason.message })); }
			}, [call]);
			useEffect(() => {
				void refresh(false);
				void refreshWebvpn();
				const timer = setInterval(() => void refresh(false), 60000);
				const webvpnTimer = setInterval(() => void refreshWebvpn(), 5000);
				return () => { clearInterval(timer); clearInterval(webvpnTimer); };
			}, [refresh, refreshWebvpn]);
			const openWebvpn = async () => {
				try { setWebvpn(await openWebVpnLoginViaShell()); notify("WebVPN 已打开，请完成登录后点击“我已登录”"); }
				catch (reason) { notify(reason.message); }
			};
			const confirmWebvpn = async () => {
				try { setWebvpn(await confirmWebVpnLoginViaShell()); notify("WebVPN 登录状态已确认"); }
				catch (reason) { notify(reason.message); }
			};
			const clearWebvpn = async () => {
				try { setWebvpn(await clearWebVpnSessionViaShell()); notify("WebVPN 登录状态已清除"); }
				catch (reason) { notify(reason.message); }
			};
			const run = async (kind, source, mode) => {
				if (kind === "connect" && mode === "current") {
					void openExternalUrl(source.institutionEntryUrl || source.entryUrl || "https://lib.ustc.edu.cn/");
				}
				setBusy(`${kind}:${source.id}`);
				try {
					const result = await call(kind === "connect" ? "literature_connect" : "literature_verify", { request: { sourceId: source.id, mode } });
					notify(result.message || result.connection?.message || "状态已更新");
					// desktop-edge-handoff：connect 只登记会话，实际打开机构入口
					// 由 Desktop URL Router 在外部 Edge 中完成。
					if (kind === "connect" && mode === "handoff" && result.entryUrl) {
						try { await openInEdgeViaShell(result.entryUrl); }
						catch (reason) { notify(reason.message); }
					}
					await refresh(true);
				} catch (reason) { notify(reason.message); } finally { setBusy(""); }
			};
			const attention = snapshot.sources.filter((source) => [source.search?.state, source.download?.state, source.connection?.state].some((state) => ["degraded", "auth-required", "waiting-user", "agreement-required", "verification-required", "expired", "error", "unavailable"].includes(state))).length;
			return h(React.Fragment, null,
				h("div", { className: "ib-db-toggle-wrap" },
					h("button", { className: "ib-db-toggle", "data-warn": attention > 0 ? "true" : undefined, onClick: () => setOpen((value) => !value), "aria-expanded": open ? "true" : "false" }, h("i", { "aria-hidden": "true" }), open ? "收起数据库状态" : "数据库状态", h("small", null, snapshot.loading ? "验证中" : `${snapshot.sources.length} 个库${attention ? ` · ${attention} 个需处理` : ""}`)),
					window.parent !== window ? h("button", { className: "ib-btn", onClick: () => void openWebvpn() }, webvpn?.windowOpen ? "返回 WebVPN" : "打开 WebVPN") : null,
					window.parent !== window && webvpn?.state === "waiting-login" ? h("button", { className: "ib-btn", "data-primary": true, onClick: () => void confirmWebvpn() }, "我已登录") : null
				),
				open ? h("section", { className: "ib-db" },
				h("div", { className: "ib-db-head" }, h("div", null, h("h3", null, "文献数据库实时状态"), h("p", null, snapshot.checkedAt ? `最近验证 ${when(snapshot.checkedAt)} · 每 60 秒自动刷新` : "正在验证检索入口与全文权限状态")), h("button", { className: "ib-btn", disabled: snapshot.loading, onClick: () => void refresh(true) }, snapshot.loading ? "验证中…" : "立即验证")),
				webvpn ? h("article", { className: "ib-db-card" }, h("div", { className: "ib-db-name" }, h("b", null, "中国科大 WebVPN"), h("span", { className: "ib-db-tier" }, webvpn.state === "ready" ? "已登录" : webvpn.state)), h("p", null, webvpn.pendingTaskId ? `正在等待 ${webvpn.pendingKind === "si" ? "SI" : "PDF"} 下载` : "登录一次后，本次及后续文献可复用同一会话"), h("div", { className: "ib-db-actions" }, h("button", { className: "ib-btn", onClick: () => void openWebvpn() }, "打开窗口"), h("button", { className: "ib-btn", onClick: () => void clearWebvpn() }, "清除登录状态"))) : null,
				snapshot.error ? h("div", { className: "ib-error" }, snapshot.error) : null,
				snapshot.sources.length ? h("div", { className: "ib-db-grid" }, snapshot.sources.map((source) => {
					const searchTone = databaseStateTone(source.search?.state);
					const downloadTone = databaseStateTone(source.download?.state);
					const connectionTone = databaseStateTone(source.connection?.state);
					return h("article", { className: "ib-db-card", key: source.id },
						h("div", { className: "ib-db-name" }, h("b", { title: source.name }, source.name), h("span", { className: "ib-db-tier" }, source.authMode === "institutional" ? "校内授权" : "开放源")),
						h("div", { className: "ib-db-state" }, h("span", { className: "ib-db-pill", title: source.search?.message, ...searchTone }, `检索 · ${databaseState(source.search?.state)}`), h("span", { className: "ib-db-pill", title: source.download?.message, ...downloadTone }, `下载 · ${databaseState(source.download?.state)}`), h("span", { className: "ib-db-pill", title: source.connection?.message, ...connectionTone }, `会话 · ${databaseState(source.connection?.state)}`)),
						source.authMode === "institutional" ? h("div", { className: "ib-db-actions" },
							snapshot.browserMode === "desktop-edge-handoff"
								? h("button", { className: "ib-btn", title: "在外部 Microsoft Edge 中打开学校数据库；登录与下载由 Edge + 捕获扩展完成，PDF/SI 自动回传", disabled: !!busy, onClick: () => void run("connect", source, "handoff") }, busy === `connect:${source.id}` ? "启动中…" : "外部 Edge")
								: h("button", { className: "ib-btn", title: "在当前 DSH 浏览器新标签页人工使用；不会把 Cookie 暴露给 DSH", disabled: !!busy, onClick: () => void run("connect", source, "current") }, "当前浏览器"),
							h("button", { className: "ib-btn", title: "启动可见的持久检索浏览器，支持登录状态复用和合法 PDF 捕获", disabled: !!busy || source.restrictedAutomation, onClick: () => void run("connect", source, "managed") }, busy === `connect:${source.id}` ? "启动中…" : "受控检索"),
							h("button", { className: "ib-btn", title: "登录、协议和验证码完成后验证当前会话", disabled: !!busy, onClick: () => void run("verify", source) }, busy === `verify:${source.id}` ? "验证中…" : "验证登录")
						) : null
					);
				})) : h("div", { className: "ib-db-empty" }, snapshot.loading ? "正在获取数据库状态…" : "暂无状态数据")
				) : null
			);
		}

export function FullTextDownloader({ call, notify }) {
			const [identifier, setIdentifier] = useState("");
			const [jobs, setJobs] = useState([]);
			const [busy, setBusy] = useState(false);
			const load = useCallback(async () => {
				try { const result = await call("literature_downloads", { request: { limit: 8 } }); setJobs(result.jobs || []); }
				catch (reason) { notify(reason.message); }
			}, [call, notify]);
			useEffect(() => {
				void load();
			}, [load]);
			const hasActiveJobs = jobs.some((job) => !["completed", "no-access", "verification-required", "failed", "waiting-login"].includes(job.state));
			useEffect(() => {
				const timer = setInterval(() => void load(), hasActiveJobs ? 2000 : 7000);
				return () => clearInterval(timer);
			}, [load, hasActiveJobs]);
			const create = async () => {
				setBusy(true);
				try {
					await call("literature_download_create", { request: { identifier } });
					setIdentifier(""); notify("全文任务已创建：先查开放获取，再走中科大机构权限"); await load();
				} catch (reason) { notify(reason.message); } finally { setBusy(false); }
			};
			const retry = async (job) => {
				try { await call("literature_download_retry", { request: { id: job.id } }); notify("已复用当前受控浏览器会话重试"); await load(); }
				catch (reason) { notify(reason.message); }
			};
			return h("section", { className: "ib-fulltext" },
				h("div", { className: "ib-db-head" }, h("div", null, h("h3", null, "全文获取队列"), h("p", null, "开放获取优先 · 中科大授权后备 · 可见浏览器人工登录"))),
				h("div", { className: "ib-fulltext-form" }, h("input", { value: identifier, placeholder: "粘贴 DOI、论文落地页或 PDF 链接", onChange: (event) => setIdentifier(event.target.value), onKeyDown: (event) => { if (event.key === "Enter" && identifier.trim() && !busy) void create(); } }), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || !identifier.trim(), onClick: () => void create() }, busy ? "创建中…" : "查找并下载")),
				h("p", { className: "ib-fulltext-note" }, "登录、统一认证、勾选协议、验证码均由你在可见窗口中完成；系统不导出 Cookie。若任务显示“等待登录”，启动对应数据库的受控检索浏览器后点击重试。"),
				jobs.length ? h("div", { className: "ib-dl-list" }, jobs.map((job) => h("div", { className: "ib-dl-row", key: job.id },
					h("div", { className: "ib-dl-main" }, h("b", { title: job.title || job.identifier }, job.title || job.identifier), h("small", { title: job.message }, `${job.message}${job.route ? ` · ${job.route === "open-access" ? "开放获取" : "学校授权"}` : ""}${job.pageEstimate ? ` · 约 ${job.pageEstimate} 页` : ""}`)),
					h("span", { className: "ib-dl-state", "data-ok": job.state === "completed" ? "true" : undefined, "data-warn": ["waiting-login", "verification-required", "no-access"].includes(job.state) ? "true" : undefined }, downloadState(job.state)),
					job.state === "completed" ? h(React.Fragment, null,
						h("button", { className: "ib-lit-btn", onClick: () => openPdfPreview(job.downloadUrl) }, "网页预览"),
						h("button", { className: "ib-lit-btn", onClick: () => void downloadVerifiedBinary(job.downloadUrl).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message)) }, "下载 PDF")
					) : ["waiting-login", "verification-required", "failed"].includes(job.state) ? h("button", { className: "ib-lit-btn", onClick: () => void retry(job) }, "重试") : null
				))) : null
			);
		}

export function useBoundProject(sessionId, call, useSessions) {
			const cwd = useSessions ? useSessions((s) => s.byId[sessionId]?.cwd) : undefined;
			const [bound, setBound] = useState(null);
			useEffect(() => {
				if (!sessionId) { setBound(null); return undefined; }
				let alive = true;
				const lookup = async () => {
					try {
						const bySession = await call("projects_by_session", { request: { sessionId } });
						if (bySession.bound) return bySession.bound;
						if (cwd) {
							const byCwd = await call("projects_by_cwd", { request: { path: cwd } });
							if (byCwd.bound) return byCwd.bound;
						}
						return null;
					} catch (reason) { return null; }
				};
				lookup().then((result) => { if (alive) setBound(result); });
				return () => { alive = false; };
			}, [sessionId, cwd, call]);
			return bound;
		}

export function ProjectBadge({ sessionId, call, openWorkspace, useSessions }) {
			const bound = useBoundProject(sessionId, call, useSessions);
			useEffect(() => {
				if (typeof document === "undefined" || !bound?.project?.id) return undefined;
				document.body.classList.add("ib-research-chat");
				document.body.dataset.ibResearchProject = bound.project.id;
				return () => {
					if (document.body.dataset.ibResearchProject === bound.project.id) {
						document.body.classList.remove("ib-research-chat");
						delete document.body.dataset.ibResearchProject;
					}
				};
			}, [bound?.project?.id]);
			if (!bound?.project) return null;
			return h("button", { className: "ib-research-badge", title: "打开课题空间", "aria-label": `打开课题空间：${bound.project.name}`, onClick: () => openWorkspace(bound.project) },
				h("span", { className: "ib-badge-icon" }, h(FlaskSvg, { width: 14, height: 14 })),
				h("span", { className: "ib-badge-copy" }, h("small", null, "Research workspace"), h("b", null, bound.project.name)),
				h("span", { className: "ib-badge-version" }, `记忆 v${bound.project.memoryVersion || "1"}`)
			);
		}

export const NATIVE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_RESEARCH_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_RESEARCH_UPLOAD_FILES = 5;

export function isNativeImageFile(file) {
			return NATIVE_IMAGE_MIMES.has(String(file?.type ?? "").toLowerCase());
		}

export function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
				reader.onload = () => {
					const value = String(reader.result ?? "");
					const comma = value.indexOf(",");
					if (comma < 0) reject(new Error(`无法编码文件：${file.name}`));
					else resolve(value.slice(comma + 1));
				};
				reader.readAsDataURL(file);
			});
		}

export function ResearchFileUpload({ sessionId, input, inputActions, call, useSessions, toast }) {
			const bound = useBoundProject(sessionId, call, useSessions);
			const [busy, setBusy] = useState(false);
			const [dragging, setDragging] = useState(false);
			const picker = useRef(null);
			const latestInput = useRef(input);
			latestInput.current = input;

			const uploadFiles = useCallback(async (fileList) => {
				const picked = Array.from(fileList ?? []);
				if (!picked.length) return;
				if (!bound?.project?.id) {
					toast("当前会话尚未关联课题，请稍后重试或先从课题面板进入会话。");
					return;
				}
				if (busy) {
					toast("已有文件正在上传，请等待完成后再试。");
					return;
				}
				const files = picked.filter((file) => !isNativeImageFile(file));
				const imageCount = picked.length - files.length;
				if (imageCount) toast(files.length ? "文档正在上传；混合拖入的图片请单独拖入，以保留图片预览。" : "图片请使用输入框原生的图片按钮或单独拖入。");
				if (!files.length) return;
				if (files.length > MAX_RESEARCH_UPLOAD_FILES) {
					toast(`一次最多上传 ${MAX_RESEARCH_UPLOAD_FILES} 个科研文件。`);
					return;
				}
				const oversized = files.find((file) => file.size > MAX_RESEARCH_UPLOAD_BYTES);
				if (oversized) {
					toast(`“${oversized.name}”超过 25 MB，请压缩或分批处理。`);
					return;
				}
				setBusy(true);
				toast(`已选择 ${files.length} 个文件，正在读取并上传…`);
				const uploaded = [];
				const failed = [];
				try {
					for (const file of files) {
						try {
							const base64 = await fileToBase64(file);
							const result = await call("project_file_upload", { request: { projectId: bound.project.id, name: file.name, base64 } });
							uploaded.push(result.file);
						} catch (reason) {
							failed.push(`${file.name}：${reason?.message ?? reason}`);
						}
					}
					if (uploaded.length) {
						const references = uploaded.map((file) => [
							`已上传科研文件「${file.fileName}」`,
							`原文件路径：${file.sourcePath}`,
							file.mdPath ? `可读 Markdown：${file.mdPath}` : null
						].filter(Boolean).join("\n")).join("\n\n");
						const draft = String(latestInput.current?.draft ?? "").trimEnd();
						inputActions.setDraft(`${draft}${draft ? "\n\n" : ""}${references}`);
						const conversionWarnings = uploaded.filter((file) => file.conversion?.status === "failed").length;
						toast(conversionWarnings
							? `已上传 ${uploaded.length} 个文件；其中 ${conversionWarnings} 个未能自动转换，原文件仍可使用。`
							: `已上传 ${uploaded.length} 个科研文件，并加入当前输入。`);
					}
					if (failed.length) toast(`有 ${failed.length} 个文件上传失败：${failed[0]}`);
				} finally {
					setBusy(false);
				}
			}, [bound?.project?.id, busy, call, inputActions, toast]);

			const onPickerChange = (event) => {
				// FileList 由浏览器事件持有；先转成普通数组再清空 input，避免异步阶段
				// 遇到已失效或已被清空的列表，也允许用户立即重新选择同一个文件。
				const files = Array.from(event.currentTarget.files ?? []);
				event.currentTarget.value = "";
				void uploadFiles(files).catch((reason) => {
					setBusy(false);
					toast(`文件上传失败：${reason?.message ?? reason}`);
				});
			};

			const uploadRef = useRef(uploadFiles);
			uploadRef.current = uploadFiles;
			useEffect(() => {
				if (!bound?.project?.id || typeof document === "undefined") return undefined;
				const hasNonImage = (transfer) => {
					const items = Array.from(transfer?.items ?? []).filter((item) => item.kind === "file");
					if (items.length) return items.some((item) => !NATIVE_IMAGE_MIMES.has(String(item.type ?? "").toLowerCase()));
					return Array.from(transfer?.files ?? []).some((file) => !isNativeImageFile(file));
				};
				const intercept = (event) => {
					if (!hasNonImage(event.dataTransfer)) return false;
					event.preventDefault();
					event.stopPropagation();
					return true;
				};
				const onDrag = (event) => { if (intercept(event)) setDragging(true); };
				const onDrop = (event) => {
					if (!intercept(event)) return;
					setDragging(false);
					void uploadRef.current(Array.from(event.dataTransfer?.files ?? []));
				};
				const onLeave = (event) => { if (event.relatedTarget == null) setDragging(false); };
				document.addEventListener("dragenter", onDrag, true);
				document.addEventListener("dragover", onDrag, true);
				document.addEventListener("drop", onDrop, true);
				document.addEventListener("dragleave", onLeave, true);
				return () => {
					document.removeEventListener("dragenter", onDrag, true);
					document.removeEventListener("dragover", onDrag, true);
					document.removeEventListener("drop", onDrop, true);
					document.removeEventListener("dragleave", onLeave, true);
				};
			}, [bound?.project?.id]);

			if (!bound?.project) return null;
			return h("span", { className: "ib-file-upload" },
				h("input", { ref: picker, type: "file", multiple: true, onChange: onPickerChange }),
				h("button", { type: "button", className: "ib-file-upload-btn", disabled: busy, title: "上传 PDF、Office、文本、数据或其他科研文件（单个不超过 25 MB）", "aria-label": "上传科研文件", onClick: () => picker.current?.click() }, busy ? "上传中…" : "上传文件"),
				dragging ? h("div", { className: "ib-file-drop" }, h("span", null, "松开后上传到当前课题")) : null
			);
		}
