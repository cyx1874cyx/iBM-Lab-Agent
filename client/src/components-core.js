import React, { useState, useEffect, useRef } from "react";
import { h } from "./h.js";
import { STRUCTURE_SOURCE_LABEL, KETCHER_URL, PDF_VIEWER_URL, STEP_FIELD_DEFS } from "./constants.js";
import { ketcherRenderSmiles, resolveCompoundPreview, stepIsStructured, readStepFieldValue, stepCompoundsByRole, structurePreviewTier } from "./ketcher.js";
import { openPdfPreview, statusOf, titleOf } from "./lib.js";

// 核心组件：Artifact/NmrRegistry/PlotRegistry/StructureCard/StepReactionLayout/EvidenceShot/PdfViewerFrame/KetcherEditorModal
export function Artifact({ title, rows = [], empty }) {
			return h("section", { className: "ib-artifact" }, h("div", { className: "ib-artifact-top" }, h("h3", null, title), h("span", { className: "ib-count" }, rows.length)), rows.length ? h("div", { className: "ib-rows" }, rows.slice(0, 4).map((row, index) => h("div", { className: "ib-row", key: row.id || index }, h("b", { title: titleOf(row) }, titleOf(row)), h("span", null, statusOf(row))))) : h("div", { className: "ib-artifact-empty" }, empty));
		}

		/** 0.4.0：核磁登记以化合物结构、名称、CAS 与氘代试剂为主，而非文件路径。 */
export function NmrRegistry({ rows = [] }) {
			if (!rows.length) return h("div", { className: "ib-empty" }, "导入 NMR 或结构表征任务后会归档到这里。");
			return h("div", { className: "sw-struct" }, rows.map((row) => {
				const compound = row.compound || { name: row.name, smiles: undefined };
				return h("article", { className: "sw-struct-card", key: row.id, style: { minWidth: 190 } },
					compound.smiles ? h(StructureCard, { entry: compound, onClick: () => {} }) : h("div", { style: { height: 84, display: "grid", placeItems: "center", color: "#8aa7c6" } }, "结构待补充"),
					h("span", { className: "sw-struct-name" }, h("b", null, compound.name || row.name)),
					h("span", { className: "sw-struct-name" }, compound.casNumber ? `CAS ${compound.casNumber}` : "CAS 待确认"),
					h("span", { className: "sw-struct-name" }, `氘代试剂：${row.deuteratedSolvent || row.solvent || "待补充"}`),
					h("span", { className: "sw-struct-name" }, `${row.nucleus || "1H"} NMR`));
			}));
		}

		/** 0.4.0：课题绘图登记（主题/日期可编辑并持久化）。 */
export function PlotRegistry({ projectId, call }) {
			const [state, setState] = useState({ loading: true, list: [], error: "" });
			const [newTopic, setNewTopic] = useState("");
			const [newDate, setNewDate] = useState("");
			const [editId, setEditId] = useState(null);
			const [editTopic, setEditTopic] = useState("");
			const [editDate, setEditDate] = useState("");
			const [busy, setBusy] = useState({});
			const [toast, setToast] = useState("");
			useEffect(() => {
				setState((s) => ({ ...s, loading: true, error: "" }));
				call("plot_records_list", { request: { projectId } })
					.then((result) => setState({ loading: false, list: result.records || [], error: "" }))
					.catch((reason) => setState((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message })));
			}, [call, projectId]);
			const withBusy = (key, fn) => { if (busy[key]) return; setBusy((s) => ({ ...s, [key]: true })); return Promise.resolve(fn()).finally(() => setBusy((s) => ({ ...s, [key]: false }))); };
			const add = () => withBusy("add", async () => {
				const topic = String(newTopic || "").trim();
				if (!topic) { setToast("请填写绘图主题。"); return; }
				await call("plot_records_create", { request: { id: `plot-${Date.now().toString(36)}`, projectId, topic, date: newDate || undefined, source: "manual" } });
				setNewTopic(""); setNewDate("");
				await call("plot_records_list", { request: { projectId } }).then((result) => setState({ loading: false, list: result.records || [], error: "" }));
			});
			const saveEdit = (row) => withBusy(`upd:${row.id}`, async () => {
				await call("plot_records_update", { request: { id: row.id, patch: { topic: editTopic, date: editDate || row.date } } });
				setEditId(null);
				await call("plot_records_list", { request: { projectId } }).then((result) => setState((s) => ({ ...s, list: result.records || [] })));
			});
			const remove = (row) => withBusy(`rm:${row.id}`, async () => {
				await call("plot_records_remove", { request: { id: row.id } });
				await call("plot_records_list", { request: { projectId } }).then((result) => setState((s) => ({ ...s, list: result.records || [] })));
			});
			return h("div", { className: "ib-card", style: { marginTop: 14 } },
				h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "绘图登记"), h("span", { className: "ib-chip" }, `${state.list.length} 条`)),
				toast ? h("div", { className: "ib-toast", role: "status" }, toast) : null,
				h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" } },
					h("input", { style: { flex: "1 1 220px", background: "#fff", color: "#16384c", borderRadius: 8, padding: "6px 9px", border: "1px solid #c3d5e0" }, value: newTopic, placeholder: "绘图主题（如：GPC 重均分子量曲线）", onChange: (event) => setNewTopic(event.target.value) }),
					h("input", { style: { background: "#fff", color: "#16384c", borderRadius: 8, padding: "6px 9px", border: "1px solid #c3d5e0" }, value: newDate, placeholder: "YYYY-MM-DD（默认今天）", onChange: (event) => setNewDate(event.target.value) }),
					h("button", { className: "ib-btn", "data-primary": true, disabled: !!busy.add, onClick: () => void add() }, busy.add ? "添加中…" : "登记绘图")),
				state.error ? h("div", { className: "ib-error" }, state.error) : null,
				state.loading ? h("div", { className: "ib-empty" }, "加载中…") : null,
				state.list.length
					? h("div", { className: "ib-rows" }, state.list.map((row) => editId === row.id
						? h("div", { className: "ib-row", key: row.id, style: { gap: 8 } },
							h("input", { style: { flex: "1 1 200px", background: "#fff", color: "#16384c", borderRadius: 6, padding: "5px 8px", border: "1px solid #c3d5e0" }, value: editTopic, onChange: (event) => setEditTopic(event.target.value) }),
							h("input", { style: { width: 130, background: "#fff", color: "#16384c", borderRadius: 6, padding: "5px 8px", border: "1px solid #c3d5e0" }, value: editDate, onChange: (event) => setEditDate(event.target.value) }),
							h("button", { className: "ib-btn", "data-primary": true, disabled: !!busy[`upd:${row.id}`], onClick: () => void saveEdit(row) }, "保存"),
							h("button", { className: "ib-btn", onClick: () => setEditId(null) }, "取消"))
						: h("div", { className: "ib-row", key: row.id },
							h("b", { title: row.id }, row.topic),
							h("span", null, `${row.date}${row.source ? " · " + row.source : ""}`),
							h("button", { className: "ib-btn", onClick: () => { setEditId(row.id); setEditTopic(row.topic); setEditDate(row.date); } }, "编辑"),
							h("button", { className: "ib-btn", disabled: !!busy[`rm:${row.id}`], onClick: () => void remove(row) }, "删除"))))
					: h("div", { className: "ib-empty" }, "尚无绘图登记；填写主题与日期后点“登记绘图”。"));
		}

export function StructureCard({ entry, onClick, compact }) {
			const preview = resolveCompoundPreview(entry);
			// RC1-01：四态 —— not_found（无 SMILES）/ loading / loaded / error
			const [state, setState] = useState(preview.state === "resolvable" ? "loading" : "not_found"); // not_found | loading | loaded | error
			const [image, setImage] = useState(null);
			const [attempt, setAttempt] = useState(0);
			const requested = useRef(false);
			const previewTier = structurePreviewTier(entry?.smiles);
			useEffect(() => {
				if (!entry?.smiles || requested.current) return undefined;
				requested.current = true;
				let alive = true;
				// 使用 Ketcher 自然输出，保持键长/原子字号一致；CSS 只在卡片容不下时缩小。
				ketcherRenderSmiles(entry.smiles, { natural: true })
					.then((dataUrl) => {
						if (!alive) return;
						if (dataUrl) { setImage(dataUrl); setState("loaded"); } else { setState("error"); }
					})
					.catch(() => { if (alive) setState("error"); });
				return () => { alive = false; };
			}, [entry?.smiles, attempt]);
			const retry = (event) => { event?.stopPropagation?.(); setState("loading"); setImage(null); requested.current = false; setAttempt((value) => value + 1); };
			const hasSmiles = !!entry?.smiles;
			const openCard = (event) => { event?.stopPropagation?.(); onClick?.(entry); };
			const stop = (event) => event?.stopPropagation?.();
			return h("div", { className: compact ? "sw-struct-card sw-struct-compact" : "sw-struct-card", "data-state": state, "data-preview-tier": previewTier, "data-missing": hasSmiles ? undefined : "true", "data-clickable": onClick ? "true" : undefined, title: hasSmiles ? `SMILES: ${entry.smiles}（点击在 Ketcher 中查看/编辑）` : preview.message, onClick: onClick ? openCard : undefined },
				hasSmiles && entry.source ? h("span", { className: "sw-struct-src" }, STRUCTURE_SOURCE_LABEL[entry.source] || entry.source) : null,
				hasSmiles
					? (state === "loaded"
						? h("img", { src: image, alt: entry.name, loading: "lazy", decoding: "async" })
						: h("div", { className: "sw-struct-fallback", style: { display: "grid", placeItems: "center", background: "#fff", borderRadius: 6, color: state === "error" ? "#b76b3f" : "#6b8798", fontSize: 9, padding: 6, textAlign: "center", boxSizing: "border-box" } },
							state === "error" ? h("span", null, "预览渲染失败") : "渲染中…"))
					: h("div", { className: "sw-struct-fallback", style: { display: "grid", placeItems: "center", background: "#f2f6fa", borderRadius: 6, color: "#7d97b5", fontSize: 9, padding: 6, textAlign: "center", boxSizing: "border-box" } }, h("span", null, "结构待补绘")),
				state === "error" && !compact
					? h("div", { className: "sw-struct-acts", onClick: stop },
						h("button", { className: "sw-mini-btn", onClick: retry }, "重试预览"),
						h("button", { className: "sw-mini-btn", onClick: openCard }, "Ketcher 查看"))
					: null,
				h("span", { className: "sw-struct-name" }, h("b", null, entry.name)),
				h("span", { className: "sw-struct-name", title: entry.casNumber || "CAS 未确认" }, entry.casNumber ? `CAS ${entry.casNumber}` : "CAS 待确认"),
				hasSmiles ? h("span", { className: "sw-cond-smiles" }, entry.smiles) : null,
				compact ? null : h("div", { className: "sw-struct-acts", onClick: stop },
					h("button", { className: "sw-mini-btn", onClick: openCard }, hasSmiles ? "查看/编辑" : "Ketcher 补绘"))
			);
		}


export function StepReactionLayout({ step, onStructureClick }) {
			const reactants = stepCompoundsByRole(step, ["reactant"]);
			const products = stepCompoundsByRole(step, ["product"]);
			const conditionRows = stepIsStructured(step)
				? STEP_FIELD_DEFS.map((def) => ({ def, value: readStepFieldValue(step, def) })).filter((row) => row.value)
				: [];
			const renderSide = (label, entries, names) => h("div", { className: "sw04-reaction-side" },
				h("small", null, label),
				entries.length ? h("div", { className: "sw-struct" }, entries.map((entry) => h(StructureCard, { key: `${entry.name}-${entry.smiles || "none"}`, entry, onClick: onStructureClick, compact: true }))) : h("span", { className: "sw-hint" }, (names || []).join("、") || "文献未提供 / 待确认"));
			const notes = (step?.procedure?.notes || []).filter(Boolean);
			return h("div", { className: "sw04-reaction" },
				renderSide("反应物", reactants, step.reactants),
				h("div", { className: "sw04-arrow" },
					h("strong", null, "→"),
					conditionRows.length
						? h("div", { className: "sw04-cond-grid" }, conditionRows.map((row) => h("span", { className: "sw04-cond", key: row.def.key, title: row.def.label }, h("i", null, row.def.label), row.value)))
						: h("span", null, (step.conditions || "反应条件待人工核验")),
					notes.length ? h("em", null, notes[0]) : h("em", null, "条件与注意事项以原文核验为准")),
				renderSide("产物", products, step.products));
		}

export function EvidenceShot({ routeId, row, notify, onReady, onFailed }) {
			const localPageNumber = (value) => {
				if (value === undefined || value === null || value === "") return undefined;
				const match = /\d+/.exec(String(value));
				return match ? Number(match[0]) : undefined;
			};
			const shotable = (row?.bundleId || row?.documentId) && localPageNumber(row?.page) !== undefined;
			const [state, setState] = useState(shotable ? "loading" : "off"); // off | loading | ok | error
			const [src, setSrc] = useState("");
			const [message, setMessage] = useState("");
			const reported = useRef(false); // 是否已向父级上报 ready/failed（同一展示周期只报一次）
			const objectUrlRef = useRef(null); // 当前展示中的 Object URL：替换/卸载时才释放（ref 避免 cleanup 捕获旧 src）
			const abortRef = useRef(null); // 在途 fetch 的 AbortController
			const loadSeqRef = useRef(0); // 请求序号：Evidence 快速切换时旧请求不得覆盖新状态
			const documentKind = row?.sourceKind === "si" || (!row?.sourceKind && row?.sourceType === "paper-si") ? "si" : "pdf";
			const bboxKey = JSON.stringify(row?.bbox ?? null);
			const shotUrl = () => `/api/lab-evidence-shot?routeId=${encodeURIComponent(routeId)}&evidenceId=${encodeURIComponent(row.id)}&kind=${documentKind}&v=${encodeURIComponent(row.updatedAt || row.id)}`;
			const releaseCurrentUrl = () => {
				const current = objectUrlRef.current;
				objectUrlRef.current = null;
				if (current) URL.revokeObjectURL(current);
			};
			const abortInFlight = () => {
				if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
			};
			const load = () => {
				if (!shotable) {
					loadSeqRef.current += 1;
					abortInFlight();
					releaseCurrentUrl();
					setSrc("");
					setState("off");
					setMessage("");
					if (!reported.current) {
						reported.current = true;
						onFailed?.(row.id, "未绑定已捕获原文（bundleId/documentId）且无页码，无法截图核验");
					}
					return;
				}
				const seq = ++loadSeqRef.current;
				abortInFlight();
				releaseCurrentUrl();
				setSrc("");
				setState("loading");
				setMessage("");
				reported.current = false;
				const controller = new AbortController();
				abortRef.current = controller;
				fetch(shotUrl(), { signal: controller.signal })
					.then(async (response) => {
						if (!response.ok) {
							const text = await response.text().catch(() => "");
							throw new Error((text && text.trim()) || `截图不可用（HTTP ${response.status}）：可能原文未捕获、页码错误或渲染服务不可用`);
						}
						return response.blob();
					})
					.then((blob) => {
						const objectUrl = URL.createObjectURL(blob);
						// 仅用隐藏 probe 做「正文确实是图片」的类型解码探测（拦截 200 伪装的 HTML 错误页）。
						// rc.4 review（§3）：此处成功**不得** revoke（同一 URL 要交给实际展示 <img>），
						// 也**不得**触发 onReady——放行必须等实际展示 <img> 的 onLoad（见 handleImageLoad）。
						return new Promise((resolve, reject) => {
							const probe = new Image();
							probe.onload = () => resolve(objectUrl);
							probe.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("服务端返回的不是有效图片，无法核验")); };
							probe.src = objectUrl;
						});
					})
					.then((objectUrl) => {
						// 旧请求晚回（seq 已过期）或 Evidence 已切换：丢弃并释放，禁止覆盖新状态
						if (seq !== loadSeqRef.current) { URL.revokeObjectURL(objectUrl); return; }
						if (objectUrlRef.current && objectUrlRef.current !== objectUrl) URL.revokeObjectURL(objectUrlRef.current);
						objectUrlRef.current = objectUrl;
						abortRef.current = null;
						setSrc(objectUrl); // 交给实际展示 <img>；onReady 由 <img>.onLoad 触发
					})
					.catch((reason) => {
						if (reason?.name === "AbortError" || seq !== loadSeqRef.current) return; // 主动取消/过期：不改变 UI
						setState("error");
						setMessage(reason?.message || "截图不可用：可能原文未捕获、无页码或渲染服务不可用");
						releaseCurrentUrl();
						setSrc("");
						if (!reported.current) { reported.current = true; onFailed?.(row.id, reason?.message || ""); }
					});
			};
			// 「用户实际看到」的仲裁点：仅实际展示 <img> 成功解码渲染才放行确认/修正。
			const handleImageLoad = () => {
				setState("ok");
				if (!reported.current) { reported.current = true; onReady?.(row.id); }
			};
			// 展示 <img> 失败（即便 probe 曾成功，例如 URL 被提前释放/资源损坏）：撤销 ready。
			const handleImageError = () => {
				setState("error");
				setMessage("截图实际显示失败（图片加载错误），请重试或重新渲染");
				releaseCurrentUrl();
				setSrc("");
				if (!reported.current) { reported.current = true; onFailed?.(row.id, "截图实际显示失败：图片加载错误"); }
			};
			useEffect(() => {
				reported.current = false;
				load();
				return () => {
					// 组件卸载 / Evidence 切换 / 重新加载：取消在途 fetch、释放当前展示 URL
					loadSeqRef.current += 1; // 使任何在途响应过期
					abortInFlight();
					releaseCurrentUrl();
				};
			}, [routeId, row.id, row.updatedAt, row.bundleId, row.documentId, row.page, bboxKey, row.sourceKind, row.sourceType]);
			if (state === "off") {
				return null;
			}
			const openOriginal = (event) => {
				event.stopPropagation();
				const bundleId = row.bundleId || row.documentId;
				if (!bundleId) { notify("该证据未绑定已捕获原文（bundleId）"); return; }
				const url = `/api/lab-artifacts?kind=${documentKind}&bundleId=${encodeURIComponent(bundleId)}`;
				void openPdfPreview(url).catch((reason) => notify(reason?.message || "无法打开原文"));
			};
			const caption = row.page !== undefined && row.page !== "" ? `原文截图 · p.${row.page}${row.bbox ? "（定位区域）" : ""}` : "原文截图";
			return h("div", { className: "sw-ev-shot" },
				state === "ok" || (state === "loading" && src)
					? h(React.Fragment, null,
						h("img", { src, alt: caption, title: caption, onLoad: handleImageLoad, onError: handleImageError }),
						state === "ok"
							? h("div", { className: "sw-ev-shot-bar" },
								h("span", { className: "sw-ev-shot-note" }, caption, " · 服务端按已捕获原文渲染，供人工与摘录核对"),
								h("button", { className: "sw-mini-btn", onClick: openOriginal, title: "在 PDF 阅读器中打开原文对应条目" }, "打开原文"))
							: h("div", { className: "sw-ev-shot-note" }, "正在加载截图…"))
					: state === "loading"
						? h("div", { className: "sw-ev-shot-note" }, "正在渲染原文截图…")
						: h("div", { className: "sw-ev-shot-fail" },
							h("b", null, "截图核验不可用："),
							message,
							row.bundleId || row.documentId ? h("button", { className: "sw-mini-btn", style: { marginLeft: 8 }, onClick: openOriginal }, documentKind === "si" ? "打开 SI" : "打开原文 PDF") : null,
							h("button", { className: "sw-mini-btn", style: { marginLeft: 6 }, onClick: load }, "重试")));
	}

export function PdfViewerFrame({ row, notify }) {
			const iframeRef = useRef(null);
			const [locateState, setLocateState] = useState("loading"); // loading | matched | notfound | noquote | error
			const [errorMessage, setErrorMessage] = useState("");
			const pageNumber = (() => { const m = /\d+/.exec(String(row?.page ?? "")); return m ? Number(m[0]) : undefined; })();
			const bundleId = row?.bundleId || row?.documentId;
			const quote = row?.excerpt || row?.userCorrection || row?.originalExtract || "";
			const open = !!(bundleId && pageNumber);
			const documentKind = row?.sourceKind === "si" || (!row?.sourceKind && row?.sourceType === "paper-si") ? "si" : "pdf";

			useEffect(() => {
				if (!open) { setLocateState("error"); setErrorMessage("未绑定已捕获原文或页码，无法定位"); return undefined; }
				setLocateState("loading");
				setErrorMessage("");
				let disposed = false;
				const postOpen = () => {
					try { iframeRef.current?.contentWindow?.postMessage({ type: "open", bundleId, kind: documentKind, page: pageNumber, quote }, "*"); } catch { /* ignore */ }
				};
				const onMessage = (event) => {
					const data = event.data || {};
					if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
					if (data?.type === "ready") {
						// viewer 就绪后下发打开指令（避免 ready 与 open 竞态）
						postOpen();
						return;
					}
					if (data?.type === "highlight") {
						if (disposed) return;
						setLocateState(data.status === "matched" ? "matched" : data.status === "notfound" ? "notfound" : "noquote");
						if (data.status === "notfound" && notify) notify("未能自动定位原文，请在本页人工确认");
						return;
					}
					if (data?.type === "error") {
						if (disposed) return;
						setLocateState("error");
						setErrorMessage(data.message || "PDF 加载失败");
					}
				};
				window.addEventListener("message", onMessage);
				// 已加载的 iframe 不会再次发送 ready；属性切换时主动下发，首次加载则由 ready 重发。
				postOpen();
				return () => {
					disposed = true;
					window.removeEventListener("message", onMessage);
				};
			}, [bundleId, documentKind, pageNumber, quote]);

			if (!open) {
				return h("div", { className: "sw04-review-hint" }, "该项未绑定已捕获原文 PDF/SI（bundleId/documentId）或无页码，无法展示原文定位。可基于提取值人工确认 / 修正，或标记「无法确认」交给 Agent 复核。");
			}
			const label = locateState === "matched" ? "已定位原文" : locateState === "notfound" ? "未能自动定位原文，请在本页人工确认" : locateState === "noquote" ? "无可用摘录文本，仅展示原文" : locateState === "error" ? errorMessage : "正在定位原文…";
			const tone = locateState === "matched" ? "#2b7a70" : locateState === "notfound" ? "#8a6d2f" : locateState === "error" ? "#b34a45" : "#718b82";
			return h("div", { className: "sw04-review-shot", style: { display: "flex", flexDirection: "column", gap: 8 } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
					h("span", { style: { fontSize: 10, color: tone, fontWeight: 600 } }, label),
					h("span", { style: { flex: 1 } }),
					quote ? h("span", { style: { fontSize: 9, color: "#718b82", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: quote }, `摘录：${quote}`) : null),
				h("iframe", { ref: iframeRef, title: `原文定位：第 ${pageNumber} 页`, src: PDF_VIEWER_URL, style: { width: "100%", height: "min(54vh, 620px)", minHeight: 440, border: "1px solid rgba(45,130,101,.18)", borderRadius: 8, background: "#fff" } }));
		}

export function KetcherEditorModal({ entry, onSave, onCancel }) {
			const iframeRef = useRef(null);
			const [status, setStatus] = useState("loading"); // loading | ready | timeout
			const [fallbackSmiles, setFallbackSmiles] = useState(entry?.smiles || "");
			const fallbackTimer = useRef(null);
			const commitTimer = useRef(null);

			const open = entry != null;
			// 每次打开重建 iframe，避免 Ketcher 内部残留上一条分子。
			useEffect(() => {
				if (!open) return undefined;
				setStatus("loading");
				const onMessage = (event) => {
					const data = event.data || {};
					if (!event.source || !iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
					if (data?.type === "ready") {
						if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
						setStatus("ready");
						// Ketcher 就绪后再载入分子，避免 onInit 与 setMolecule 竞态
						if (entry?.smiles) {
							try { iframeRef.current.contentWindow.postMessage({ type: "setMolecule", smiles: entry.smiles }, "*"); } catch { /* ignore */ }
						}
						return;
					}
					if (data?.type === "molecule") {
						if (commitTimer.current) clearTimeout(commitTimer.current);
						onSave(data.smiles);
						return;
					}
					if (data?.type === "cancel") {
						if (commitTimer.current) clearTimeout(commitTimer.current);
						onCancel();
					}
				};
				window.addEventListener("message", onMessage);
				// 兜底：Ketcher 大包加载慢/失败时给用户一个 SMILES 文本通道
				fallbackTimer.current = setTimeout(() => setStatus((current) => (current === "loading" ? "timeout" : current)), 15000);
				return () => {
					window.removeEventListener("message", onMessage);
					if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
					if (commitTimer.current) clearTimeout(commitTimer.current);
				};
			}, [open, entry?.smiles, entry?.name]);

			if (!open) return null;
			const saveFallback = () => { onSave(fallbackSmiles.trim()); };
			return h("div", { className: "sw-struct-edit", role: "dialog", "aria-modal": "true", "aria-label": `编辑 ${entry.name} 结构式` },
				h("div", { className: "sw-struct-edit-box" },
					h("div", { className: "sw-struct-edit-head" },
						h("b", null, `Ketcher · ${entry.name}`),
						h("small", null, status === "ready" ? "在下方编辑器绘制/修正结构，点 Ketcher 顶栏「保存结构」回写；Ketcher 为本地离线编辑器。" : (status === "timeout" ? "Ketcher 加载超时，可在下方直接编辑 SMILES 文本。" : "正在加载 Ketcher 离线编辑器（首次约 10–20 秒）…")),
						h("button", { onClick: onCancel }, "关闭")),
					status === "timeout"
						? h("div", { style: { flex: 1, padding: 16, background: "#fff", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 } },
							h("textarea", { value: fallbackSmiles, onChange: (event) => setFallbackSmiles(event.target.value), placeholder: "SMILES，例如 CC(=O)Oc1ccccc1C(=O)O", style: { flex: 1, minHeight: 0, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12, border: "1px solid #bcd0dc", borderRadius: 8, padding: 10, boxSizing: "border-box", resize: "none" } }),
							h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
								h("button", { onClick: saveFallback, style: { border: "1px solid #0e7a4f", background: "#0e7a4f", color: "#fff", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12 } }, "保存 SMILES")))
						: h("iframe", { ref: iframeRef, className: "sw-struct-edit-frame", title: `Ketcher 结构编辑器：${entry.name}`, src: KETCHER_URL }))
			);
		}
