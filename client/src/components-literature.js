import React, { useState, useEffect, useCallback, useRef } from "react";
import { h } from "./h.js";
import { downloadState } from "./constants.js";
import { openPdfPreview, downloadVerifiedBinary, webVpnStatusViaShell, webVpnBrowserActionViaShell, iwanStatusViaShell, openWebVpnLoginViaShell, confirmWebVpnLoginViaShell, openWebVpnCaptureViaShell, cancelWebVpnCaptureViaShell } from "./lib.js";
import { FlaskSvg } from "./components-templates.js";
import { sendWebVpnBallQueue } from "./webvpn-bridge.js";
import { setBallTaskCancelHandler, setBallTaskRecreateHandler } from "./lib.js";

// 文献相关组件：FullTextDownloader/useBoundProject/ProjectBadge/ResearchFileUpload
export function FullTextDownloader({ call, notify }) {
			const [identifier, setIdentifier] = useState("");
			const [jobs, setJobs] = useState([]);
			const [busy, setBusy] = useState(false);
			const [stopping, setStopping] = useState("");
			const load = useCallback(async () => {
				try { const result = await call("literature_downloads", { request: { limit: 8 } }); setJobs(result.jobs || []); }
				catch (reason) { notify(reason.message); }
			}, [call, notify]);
			useEffect(() => {
				void load();
			}, [load]);
			const hasActiveJobs = jobs.some((job) => !["completed", "cancelled", "no-access", "verification-required", "failed", "waiting-login"].includes(job.state));
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
			const stop = async (job) => {
				setStopping(job.id);
				try { await call("literature_download_cancel", { request: { id: job.id, reason: "用户在全文获取队列中终止任务" } }); notify("已终止该文献获取任务"); await load(); }
				catch (reason) { notify(reason.message); } finally { setStopping(""); }
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
					) : h(React.Fragment, null,
						["waiting-login", "verification-required", "failed", "no-access"].includes(job.state) ? h("button", { className: "ib-lit-btn", disabled: stopping === job.id, onClick: () => void retry(job) }, "重试") : null,
						job.state !== "cancelled" ? h("button", { className: "ib-lit-btn", "data-danger": true, disabled: stopping === job.id, onClick: () => void stop(job) }, stopping === job.id ? "终止中…" : "终止") : null
					)
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

export function ProjectBadge({ sessionId, call, openWorkspace, openProjectTab, useSessions, toast }) {
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
			// 小球上的"删除队列任务"：真正的取消在插件里做，桌面壳只负责转交。
			useEffect(() => {
				const projectId = bound?.project?.id;
				if (!projectId) return undefined;
				setBallTaskCancelHandler(async (taskId) => {
					await call("manual_capture_cancel", { request: {
						taskId, reason: "用户从捕获小球删除队列任务"
					} }).catch(() => {});
					// 若它正好是浏览器里挂着的那一个，一并关掉载体；否则 Rust 会拒绝。
					await cancelWebVpnCaptureViaShell(taskId).catch(() => {});
				});
				// 小球上的"重建任务"（C19）：失去接管的任务最需要的是重来一次，
				// 而不是只能终止。重建不需要用户重新确认。
				setBallTaskRecreateHandler(async (taskId) => {
					await call("manual_capture_recreate", { request: {
						taskId, reason: "用户从捕获小球重建获取任务"
					} }).catch(() => {});
					await cancelWebVpnCaptureViaShell(taskId).catch(() => {});
				});
				return () => {
					setBallTaskCancelHandler(null);
					setBallTaskRecreateHandler(null);
				};
			}, [bound?.project?.id, call]);
			// AI Tool 在当前对话中排入下载任务后，由始终挂载的课题标识领取。
			// 明文一次性令牌只从本地服务交给桌面 WebVPN 壳，不进入模型上下文。
			useEffect(() => {
				const projectId = bound?.project?.id;
				if (!projectId || typeof window === "undefined" || window.parent === window) return undefined;
				let disposed = false;
				let timer;
				let starting = false;
				// 浏览器动作（observe/click/save-pdf）在独立任务里跑（见下方注释）。
				let runningOperation = false;
				const poll = async () => {
					if (disposed || starting) return;
					let claimedTask;
					starting = true;
					try {
						let shellStatus;
						let iwanStatus;
						try {
							[shellStatus, iwanStatus] = await Promise.all([webVpnStatusViaShell(), iwanStatusViaShell()]);
							await call("manual_capture_desktop_status_update", { request: {
								state: shellStatus?.state,
								authenticated: shellStatus?.authenticated,
								windowOpen: shellStatus?.windowOpen,
								sidebarVisible: shellStatus?.sidebarVisible,
								pendingTaskId: shellStatus?.pendingTaskId,
								automationStage: shellStatus?.automationStage,
								downloadedBytes: shellStatus?.downloadedBytes,
								downloadEventBytes: shellStatus?.downloadEventBytes,
								downloadElapsedMs: shellStatus?.downloadElapsedMs,
								maxCaptureBytes: shellStatus?.maxCaptureBytes,
								// 页面级事实与接管关系（C2/C3）：wait 的指纹与
								// heartbeat-lost/orphaned 判定都靠这两组字段。
								pageUrl: shellStatus?.pageUrl,
								documentType: shellStatus?.documentType,
								httpStatus: shellStatus?.httpStatus,
								readyState: shellStatus?.readyState,
								pageSeq: shellStatus?.pageSeq,
								contentLength: shellStatus?.contentLength,
								pdfPayload: shellStatus?.pdfPayload,
								lastPendingTaskId: shellStatus?.lastPendingTaskId,
								releaseReason: shellStatus?.releaseReason,
								takenOverAt: shellStatus?.takenOverAt,
								// 壳侧的失败原因与"已保住的产物"必须上报，否则调用方
								// 只能靠读日志/读盘反推（2026-09-27 现场 §4）。
								lastError: shellStatus?.lastError,
								lastFailure: shellStatus?.lastFailure,
								iwanInstalled: iwanStatus?.installed,
								iwanConnected: iwanStatus?.connected,
								iwanUsable: iwanStatus?.usable,
								iwanGlobalRoute: iwanStatus?.globalRoute
							} });
							const claimedAction = await call("manual_capture_desktop_action_claim", { request: { projectId } });
							if (claimedAction?.action?.type === "open-login" && !iwanStatus?.usable) {
								shellStatus = await openWebVpnLoginViaShell();
								toast?.("请在右侧 WebVPN 完成登录，然后在对话中选择“我已登录”");
							} else if (claimedAction?.action?.type === "cancel-capture" && claimedAction.action.taskId) {
								await cancelWebVpnCaptureViaShell(claimedAction.action.taskId);
							}
						} catch { /* 桌面壳暂不可达；SI 队列仍可继续尝试领取 */ }
						// Agent 页面观察/点击/保存动作复用同一个桌面桥。操作结果经服务返回，
						// 模型侧只收到有限的候选入口和状态，不接触 WebView2 profile。
						//
						// 这里**绝不能 await 动作本身**：保存原生 PDF 要等字节流落盘 + 归档
						// 上传，可能几十秒。以前是内联 await，于是整个 1.8 秒轮询被卡住 ——
						// 期间队列快照不再上报，小球就停在旧状态上不动（现场「小球没反应」
						// 的直接原因）。动作改到独立任务里跑，轮询继续上报。
						if (!runningOperation && !disposed) {
							try {
								const next = await call("browser_operation_claim", { request: { projectId } });
								if (next?.operation && !disposed) {
									const operation = next.operation;
									runningOperation = true;
									void (async () => {
										try {
											const result = await webVpnBrowserActionViaShell(operation);
											await call("browser_operation_complete", { request: {
												projectId, id: operation.id, result
											} });
										} catch (reason) {
											await call("browser_operation_complete", { request: {
												projectId, id: operation.id, error: String(reason?.message || reason)
											} }).catch(() => {});
										} finally {
											runningOperation = false;
										}
									})();
								}
							} catch { /* 桌面桥暂不可达；操作超时后由服务标记失败 */ }
						}
						// 忙时也必须读取队列：这一步会淘汰过期任务。若浏览器还持有已经
						// 结束的一次性令牌，先清掉它，否则后面的 SI 永远不能接管。
						const listed = await call("manual_capture_list", { request: { projectId } });
						// 每一轮都把队列快照交给小球：用户才能在侧栏看到排队序列并逐条删除。
						sendWebVpnBallQueue(listed?.tasks || []);
						const activeTask = (listed?.tasks || []).find((item) => item.id === shellStatus?.pendingTaskId);
						if (activeTask && (["completed", "expired", "failed", "cancelled"].includes(activeTask.status)
							|| ["error", "expired"].includes(shellStatus?.state))) {
							if (activeTask.status === "armed") {
								await call("manual_capture_cancel", { request: {
									taskId: activeTask.id, reason: shellStatus?.lastError || "文献浏览器任务已中断"
								} }).catch(() => {});
							}
							await cancelWebVpnCaptureViaShell(activeTask.id).catch(() => {});
							return;
						}
						// 单个软件内浏览器只处理一个捕获。上一个任务仍在导航、下载或归档时
						// 不领取下一枚一次性令牌，避免新任务被 busy 错误取消并留在僵尸队列。
						const shellBusy = Boolean(shellStatus?.pendingTaskId)
							|| ["navigating", "waiting-download", "downloading", "uploading"].includes(shellStatus?.state);
						if (shellBusy) return;
						const queued = (listed?.tasks || [])
							.filter((item) => item.requestedBy === "agent" && item.status === "armed")
							.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
						const routeNeedsVpn = (item) => item.kind === "pdf"
							|| !(item.kind === "si" && /(?:doi\.org\/)?10\.(?:1038|1007)(?:%2F|\/)/i.test(item.publisherUrl || ""));
						// WebVPN 未就绪时允许公开 SI 先行；其余场景保持严格 FIFO。
						const task = queued.find((item) => iwanStatus?.usable || !routeNeedsVpn(item) || (shellStatus?.windowOpen && shellStatus?.authenticated))
							|| queued[0];
						if (task && !disposed) {
							const directSpringerSi = task.kind === "si" && /(?:doi\.org\/)?10\.(?:1038|1007)(?:%2F|\/)/i.test(task.publisherUrl || "");
							const taskNeedsVpn = routeNeedsVpn(task);
							// 需要 WebVPN 的任务在领取一次性令牌前再次核验真实桌面状态。
							if (taskNeedsVpn && !iwanStatus?.usable && (!shellStatus?.windowOpen || !shellStatus.authenticated)) {
								if (!task.loginConfirmedByUser || !shellStatus?.windowOpen || shellStatus.state !== "waiting-login") return;
								shellStatus = await confirmWebVpnLoginViaShell();
								await call("manual_capture_desktop_status_update", { request: {
									state: shellStatus?.state,
									authenticated: shellStatus?.authenticated,
									windowOpen: shellStatus?.windowOpen,
									sidebarVisible: shellStatus?.sidebarVisible,
									pendingTaskId: shellStatus?.pendingTaskId
								} });
								if (shellStatus?.state !== "ready") return;
							}
							const claimed = await call("manual_capture_claim_agent", { request: { taskId: task.id } });
							claimedTask = claimed?.task;
							if (!claimedTask?.token || !claimedTask.publisherUrl) throw new Error("AI 文献下载请求缺少有效的捕获入口");
							await openWebVpnCaptureViaShell({
								taskId: claimedTask.id,
								kind: claimedTask.kind,
								targetUrl: claimedTask.publisherUrl,
								token: claimedTask.token,
								directAccess: directSpringerSi,
								// mode=ai（默认）：不发自动点击脚本，页面交给 Agent 自己观察/点击/保存；
								// mode=auto：沿用壳内脚本快路径，失败后 Agent 仍可接管。
								automate: claimedTask.mode === "auto"
							});
							toast?.(claimedTask.mode === "auto"
								? `AI 已发起${claimedTask.kind === "pdf" ? "正文" : "补充材料"}下载，正在通过${iwanStatus?.usable ? " iWAN 直访" : "软件侧栏"}自动处理`
								: `AI 已发起${claimedTask.kind === "pdf" ? "正文" : "补充材料"}下载，页面已打开，由 Agent 直接操作`);
						}
					} catch (error) {
						// 只有已经成功领取令牌、但桌面壳启动失败时才取消任务；并发领取失败
						// 可能表示另一个已挂载界面已经接管，不能误取消它。
						if (claimedTask?.id) {
							await call("manual_capture_cancel", { request: { taskId: claimedTask.id, reason: error.message || "AI 文献下载请求启动失败" } }).catch(() => {});
							toast?.(error.message || "AI 文献下载请求启动失败");
						}
					} finally {
						starting = false;
						if (!disposed) timer = setTimeout(() => void poll(), 1800);
					}
				};
				void poll();
				return () => { disposed = true; clearTimeout(timer); };
			}, [bound?.project?.id, call, toast]);
			if (!bound?.project) return null;
			// 课题徽章就是「打开课题空间」的入口：点击直接在右侧栏开一个该课题的标签页
			// （每课题一标签）。右侧栏不可用时才回落到原来的全屏面板，不让按钮点了没反应。
			return h("button", {
				className: "ib-research-badge",
				title: "在右侧栏打开课题空间",
				"aria-label": `打开课题空间：${bound.project.name}`,
				onClick: () => {
					if (openProjectTab?.(bound.project.id)) return;
					toast?.("右侧栏不可用，已改为全屏打开课题空间");
					openWorkspace(bound.project);
				}
			},
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
