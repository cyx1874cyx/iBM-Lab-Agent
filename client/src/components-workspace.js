import { useState, useEffect, useCallback, useRef } from "react";
import { h } from "./h.js";
import { ROUTE_ORIGIN_LABEL, ROUTE_STATUS_LABEL, EVIDENCE_SOURCE_LABEL, EVIDENCE_REVIEW_LABEL, STEP_FIELD_DEFS } from "./constants.js";
import { stepIsStructured, readStepFieldValue, evidenceByStep, routeLevelEvidence, evidenceLocator, stepCompoundsByRole } from "./ketcher.js";
import { EvidenceShot, PdfViewerFrame, KetcherEditorModal, StructureCard, StepReactionLayout } from "./components-core.js";

// 研究设计工作台主组件（合成路线：Route → Step → Evidence → 审核抽屉）
export function ResearchDesignWorkspace({ projectId, routes = [], targets = [], plans = [], call, notify, onChanged }) {
			const targetById = (id) => targets.find((row) => row.id === id) || null;
			const [routeId, setRouteId] = useState(routes.length ? routes[0].id : null);
			const [tick, setTick] = useState(0); // 手动刷新计数：同时重拉 detail
			const [detail, setDetail] = useState(null);
			const [selectedStepId, setSelectedStepId] = useState(null);
			const [assess, setAssess] = useState(null);
			const [alt, setAlt] = useState(null);
			const [busy, setBusy] = useState({});
			const [error, setError] = useState("");
			// ── 0.4.0 事实核验/批次/新建路线/更多菜单/审核抽屉 状态（hooks 无条件执行）──
			// 注意：这些 state 必须声明在任何引用它们的函数之前，否则触发 TDZ
			// （Cannot access 'xxx' before initialization）。
			const [selectedEvidenceId, setSelectedEvidenceId] = useState(null); // 组件三当前选中事实
			const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false); // RC1-04：右侧审核抽屉开关
			const [correctionFor, setCorrectionFor] = useState(null); // { id, value } | null 修正输入
			const [batchList, setBatchList] = useState([]); // 当前 route 的审核批次
			const [newRouteForm, setNewRouteForm] = useState(null); // { name, targetId } | null
			const [moreOpen, setMoreOpen] = useState(false); // 顶部“更多”菜单
			const [lockBlockers, setLockBlockers] = useState([]); // 锁定结构化阻断原因

			useEffect(() => {
				if (routes.length && !routes.some((row) => row.id === routeId)) setRouteId(routes[0].id);
				if (!routes.length) { setDetail(null); setSelectedStepId(null); }
			}, [routes]);

			useEffect(() => {
				if (!routeId) return;
				let stale = false;
				setDetail(null);
				setAssess(null);
				setAlt(null);
				setError("");
				setSelectedStepId(null);
				call("synth_route_detail", { request: { id: routeId } })
					.then((result) => {
						if (stale) return;
						setDetail(result);
						const first = (result.route.steps || [])[0];
						setSelectedStepId(first ? (first.id || `s${first.step}`) : null);
					})
					.catch((reason) => { if (!stale) setError(reason.message || "加载路线失败"); })
					.finally(() => { if (!stale) setBusy((old) => { const next = { ...old }; delete next.detail; return next; }); });
				return () => { stale = true; };
			}, [routeId, tick]);

			const route = routeId ? (routes.find((row) => row.id === routeId) || null) : null;
			const target = route ? targetById(route.targetId) : null;
			const selectedStep = detail ? (detail.route.steps || []).find((step) => step.id === selectedStepId || `s${step.step}` === selectedStepId) : null;
			const stepEvidence = detail && selectedStep ? evidenceByStep(detail.evidence, selectedStep) : [];
			const routeEvidence = detail ? routeLevelEvidence(detail.evidence) : [];

			// 选中步骤变化 → 自动做规则级可行性分析（轻量，无 LLM）
			useEffect(() => {
				if (!routeId || !selectedStepId || !detail) return;
				let stale = false;
				setAssess(null);
				setAlt(null);
				setBusy((old) => ({ ...old, assess: true }));
				call("synth_step_assess", { request: { routeId, stepId: selectedStepId } })
					.then((result) => { if (!stale) setAssess(result.result); })
					.catch((reason) => { if (!stale) setError(reason.message || "可行性分析失败"); })
					.finally(() => { if (!stale) setBusy((old) => { const next = { ...old }; delete next.assess; return next; }); });
				return () => { stale = true; };
			}, [routeId, selectedStepId, !!detail]);

			const withBusy = (key, work) => {
				if (busy[key]) return;
				setBusy((old) => ({ ...old, [key]: true }));
				return Promise.resolve()
					.then(work)
					.catch((reason) => notify(reason.message || "操作失败"))
					.finally(() => setBusy((old) => { const next = { ...old }; delete next[key]; return next; }));
			};

			const runAction = (action) => {
				if (action === "extract") {
					const capability = detail?.capability || { available: false };
					if (!capability.available) {
						notify(`「从文献提取路线」暂不可用：${capability.reason || "未配置多模态提取 Provider"}。可先在对话中让 Agent 人工登记路线与步骤，或人工编辑结构化条件。`);
						return;
					}
					notify("提取管线已配置（当前版本未内置 Provider）。");
					return;
				}
				if (action === "retro") {
					notify("「整体逆向规划」为 Route-level 接口：需要 RetrosynthesisProvider（计划 RETRO-001）。0.3.0 未配置，候选路线不会生成；接口与空状态已预留。");
					return;
				}
				if (action === "revision") {
					if (!route) return;
					const changeNotes = window.prompt(`把「${route.name}」复制为新版本（draft）？\n填写本次修改说明：`, "人工复核修订");
					if (changeNotes === null) return;
					return withBusy("revision", async () => {
						const result = await call("synth_route_revision", { request: { id: routeId, changeNotes, origin: "human-edited" } });
						notify(`已创建新版本 v${result.route.version}（${result.route.id}），原版本未被覆盖。`);
						await onChanged();
						setRouteId(result.route.id);
					});
				}
				if (action === "lock") {
					if (!route) return;
					return withBusy("lock", async () => {
						// rc.4 review（§5.2）：锁定是仅真实 UI 用户动作可执行的操作，
						// 经专用 loopback user-action 端点提交（同源 + 意图 header +
						// 显式 POST），不再经 ctx.remote 网关——服务端要求可信 actor，
						// Agent/缺省/伪造 by 一律拒绝。
						const response = await fetch("/api/lab-user-action/lock-route", {
							method: "POST",
							headers: { "content-type": "application/json", "x-lab-user-action": "lock-route" },
							body: JSON.stringify({ routeId })
						});
						const result = await response.json().catch(() => null);
						if (!response.ok || !result?.ok) {
							if (result && Array.isArray(result.blockers) && result.blockers.length) {
								// 0.4.0 WP4：结构化阻断原因（待审事实 / 运行中批次 / 缺截图核验）
								setLockBlockers(result.blockers);
								notify(`路线暂不能锁定：${result.blockers.map((row) => row.message).join("；")}`);
							} else {
								setLockBlockers([]);
								notify(result?.error ? `路线暂不能锁定：${result.error}` : `锁定失败（HTTP ${response.status}）。`);
							}
							return;
						}
						setLockBlockers([]);
						notify(`路线「${result.route.name}」已锁定；如需修改请复制为新版本。`);
						await onChanged();
						setTick((value) => value + 1);
					});
				}
				if (action === "plan") {
					if (!route) return;
					// 0.4.0：两次点击确认。第一次点击只进入确认态，不发送请求；4 秒内再次点击才发送一次。
					if (!planArmed) {
						setPlanArmed(true);
						if (planArmTimerRef.current) window.clearTimeout(planArmTimerRef.current);
						planArmTimerRef.current = window.setTimeout(() => {
							planArmTimerRef.current = null;
							setPlanArmed(false);
						}, 4000);
						notify("请再次点击「生成实验计划草案」确认发送（避免误触）。");
						return;
					}
					if (planArmTimerRef.current) window.clearTimeout(planArmTimerRef.current);
					planArmTimerRef.current = null;
					setPlanArmed(false);
					return withBusy("plan", async () => {
						const result = await call("synth_plan_from_route", { request: { routeId } });
						notify(`已生成实验计划草案「${result.plan.title}」（requiresReview=true，待人工审核）。`);
						await onChanged();
					});
				}
				if (action === "add-step") {
					if (!route || route.locked) {
						notify(route?.locked ? "路线已锁定；请先复制为新版本。" : "尚未选择路线。");
						return;
					}
					// 0.4.0：页内表单（替代连续 window.prompt）
					setAddStepForm({ open: true, reaction: "", reactants: "", products: "" });
				}
				if (action === "alternatives") {
					if (!selectedStep) return;
					return withBusy("alt", async () => {
						const result = await call("synth_step_alternatives", { request: { routeId, stepId: selectedStep.id } });
						setAlt(result.result);
					});
				}
				if (action === "confirm") {
					if (!selectedStep) return;
					if (route?.locked) {
						notify("当前路线已锁定；请先复制为新版本。");
						return;
					}
					return withBusy("confirm", async () => {
						const result = await call("synth_step_review", { request: { id: routeId, stepKey: selectedStep.id, status: "confirmed" } });
						notify(`已确认 Step ${selectedStep.id}，写入 review.status=confirmed。`);
						const reload = await call("synth_route_detail", { request: { id: routeId } });
						setDetail(reload);
					});
				}
				if (action === "evidence-review") {
					// 由按钮 data 属性驱动，此处不会到达
					return;
				}
				if (action === "edit-step") {
					notify("Step 条件人工编辑：当前版本可在对话中让 Agent 修改，或等待后续版本加入表单编辑（FR-12）。已确认字段不会被静默覆盖。");
					return;
				}
			};

			// 0.4.0：页内"添加步骤"表单提交（表单 state 见 addStepForm）
			const submitAddStep = async (fields) => {
				if (!route || route.locked) { notify("路线已锁定；请先复制为新版本。"); return; }
				const splitNames = (value) => String(value || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
				const number = Math.max(0, ...(route.steps || []).map((item) => Number(item.step) || 0)) + 1;
				const step = { id: `s${number}`, step: number, reaction: String(fields.reaction || "").trim(), reactants: splitNames(fields.reactants), products: splitNames(fields.products), structures: [], conditions: "待补充" };
				if (!step.reaction) { notify("请填写反应名称/简述。"); return; }
				await withBusy("add-step", async () => {
					await call("synth_route_step", { request: { id: routeId, step } });
					notify(`已添加 Step ${number}；路线与步骤默认未锁定。`);
					await onChanged();
					setTick((value) => value + 1);
					setAddStepForm(null);
				});
			};

			// 0.4.0-rc.4（§5.2）：事实列表各条的截图核验状态（由右侧 EvidenceShot
			// 上报；仅“截图真实成功显示（ok）”才允许确认/修正该条事实）
			const [shotReadyById, setShotReadyById] = useState({}); // { [evidenceId]: true | false }
			const markShotReady = (evidenceId, ready) => setShotReadyById((old) => ({ ...old, [String(evidenceId)]: !!ready }));
			/** 前端等价的“需要原文截图依据”（与服务端 evidenceRequiresShot 一致）。 */
			const evidenceRequiresShotClient = (row) => {
				if ((row?.bundleId || row?.documentId) && row?.page !== undefined && row?.page !== null && row?.page !== "") return true;
				const method = String(row?.extractionMethod ?? "");
				return ["text", "vlm", "search", "model"].includes(method) && row?.excerpt !== undefined && row?.excerpt !== null && row?.excerpt !== "";
			};
			/** 该条事实能否确认：本次页面会话中原文截图必须真实显示成功。 */
			const evidenceConfirmable = (row) => {
				if (!evidenceRequiresShotClient(row)) return true;
				return shotReadyById[String(row.id)] === true;
			};
			/** 截图门禁文案（给用户的可行动原因，与审核抽屉截图面板一致）。 */
			const evidenceShotBlockReason = (row) => {
				const ver = row?.shotVerification;
				if (ver?.status === "stale") return "原文截图已失效（原文/页码在核验后变化），请重新打开审核抽屉完成截图核验后再确认。";
				if (ver?.status === "failed") return `原文截图渲染失败（${ver.error || "文件损坏或渲染器不可用"}），不能确认；修复后重试或标“无法确认”交给 Agent。`;
				return "请先在审核抽屉内完成原文截图核验（截图成功显示后再确认/修正）；若原文不可用请标“无法确认”交给 Agent。";
			};

			// 0.4.0-rc.4（§5.2）：确认/修正都先过“截图真实成功显示”门禁
			// （纯人工知识/内部事实无需原文截图，与服务端 evidenceShotGate 一致）。
			const decideEvidence = (row, status) => withBusy(`ev:${row.id}`, async () => {
				if (status === "confirmed" && !evidenceConfirmable(row)) {
					notify(`Evidence ${row.id} 暂不能确认：${evidenceShotBlockReason(row)}（截图核验完成前不得计为已核验；如原文确实不可用，请标“无法确认”交给 Agent 复核。）`);
					return;
				}
				await call("synth_evidence_review", { request: { id: row.id, status } });
				notify(`Evidence ${row.id} 已标记为“${EVIDENCE_REVIEW_LABEL[status]}”。`);
				const reload = await call("synth_route_detail", { request: { id: routeId } });
				setDetail(reload);
			});
			/** 修正：同时保留原始提取值与人工修正值（服务端写 originalExtract + userCorrection）。
			 *  0.4.0-rc.4（§5.2）：需要原文依据的事实，修正也不得绕过首次截图审核。 */
			const saveCorrection = (row, rawValue) => withBusy(`ev:${row.id}`, async () => {
				if (evidenceRequiresShotClient(row) && !evidenceConfirmable(row)) {
					notify(`Evidence ${row.id} 暂不能修正：${evidenceShotBlockReason(row)} 若原文确实不可用，请标“无法确认”交给 Agent 复核，而不是把无截图修正当作完成。`);
					return;
				}
				const correction = String(rawValue ?? "").trim();
				if (!correction) { notify("修正值不能为空。"); return; }
				await call("synth_evidence_review", { request: { id: row.id, status: "corrected", correction } });
				notify(row.originalExtract ? `已保存人工修正（原始提取值“${row.originalExtract}”保留在 originalExtract）。` : "已保存人工修正。");
				const reload = await call("synth_route_detail", { request: { id: routeId } });
				setDetail(reload);
				setCorrectionFor(null);
			});
			/** 提交本轮事实核验批次：全部事实完成人工选择后，Agent 才能处理无法确认项。 */
			const loadReviewBatches = useCallback(() => {
				if (!routeId) return Promise.resolve([]);
				return call("synth_review_batch_get", { request: { routeId } })
					.then((result) => { setBatchList(result.batches || []); return result.batches || []; })
					.catch(() => { setBatchList([]); return []; });
			}, [routeId, call, tick]);
			const submitReviewBatch = () => withBusy("batch", async () => {
				if (!selectedStep) return;
				const pendingCount = stepEvidence.filter((row) => row.reviewStatus === "pending").length;
				if (pendingCount) { notify(`仍有 ${pendingCount} 条事实未完成人工选择（确认/修正/无法确认）；全部完成后才能交给 Agent。`); return; }
				await call("synth_review_batch_create", { request: { fields: { routeId, stepId: selectedStep.id, createdBy: "user" } } });
				notify("本轮事实核验批次已提交：Agent 只能更新“无法确认/缺失/冲突”项，回写内容进入下一轮人工核验。");
				const reload = await call("synth_route_detail", { request: { id: routeId } });
				setDetail(reload);
				void loadReviewBatches();
			});
			const completeBatch = (batch) => withBusy(`batch-c:${batch.id}`, async () => {
				await call("synth_review_batch_complete", { request: { id: batch.id, by: "user" } });
				notify(`审核批次 ${batch.id} 已关闭。`);
				void loadReviewBatches();
			});
			/** 0.4.0：页内“新建路线”表单提交（不再要求先到对话登记）。 */
			const submitNewRoute = (form) => withBusy("new-route", async () => {
				const name = String(form?.name ?? "").trim();
				const targetId = form?.targetId;
				if (!name) { notify("请填写路线名称。"); return; }
				if (!targetId) { notify("请选择合成目标。"); return; }
				const id = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
				const result = await call("synth_route_create", { request: { fields: { id, projectId, targetId, name, origin: "human-edited" } } });
				notify(`已新建路线「${result.route.name}」（draft，未锁定）。`);
				setNewRouteForm(null);
				await onChanged();
				setRouteId(result.route.id);
			});

			// ── RC1-04：右侧审核抽屉 打开/关闭/ESC 关闭 ─────────────────────
			// 抽屉打开时左侧当前步骤仍可见（宽屏）；ESC 或关闭按钮均可关闭；
			// 关闭不清除 activeEvidenceId（selectedEvidenceId），未提交的主页状态不丢失。
			const openReviewDrawer = (evidenceId) => {
				setSelectedEvidenceId(evidenceId);
				// 预填历史修正值（已审核项重新打开时可见 userCorrection，便于续改）
				const row = detail?.evidence?.find((item) => item.id === evidenceId);
				setCorrectionFor(row?.userCorrection ? { id: evidenceId, value: row.userCorrection } : null);
				setReviewDrawerOpen(true);
			};
			const closeReviewDrawer = () => {
				setReviewDrawerOpen(false);
				setCorrectionFor(null);
			};
			useEffect(() => {
				if (!reviewDrawerOpen) return undefined;
				const onKey = (event) => { if (event.key === "Escape") setReviewDrawerOpen(false); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [reviewDrawerOpen]);
			// 抽屉内审核回写后即时刷新主页（复用现有 synth_evidence_review + reload）
			const activeEvidence = detail && selectedEvidenceId
				? stepEvidence.find((row) => row.id === selectedEvidenceId) || null
				: null;

			// 0.3.2：Ketcher 编辑弹层状态（hooks 必须无条件调用）
			const [ketcherModal, setKetcherModal] = useState(null); // { stepKey, name, smiles, role } | null
			// 0.4.0：页内"添加步骤"表单（替代连续 window.prompt）
			const [addStepForm, setAddStepForm] = useState(null); // { open, reaction, reactants, products } | null
			// 0.4.0：产物请求两击确认（idle → 确认 → 发送；首次点击不产生请求）
			const [planArmed, setPlanArmed] = useState(false);
			const planArmTimerRef = useRef(null);
			useEffect(() => {
				setPlanArmed(false);
				if (planArmTimerRef.current) window.clearTimeout(planArmTimerRef.current);
				planArmTimerRef.current = null;
				return () => {
					if (planArmTimerRef.current) window.clearTimeout(planArmTimerRef.current);
				};
			}, [routeId, selectedStepId]);
			// 0.4.0：PubChem/CACTUS 双源核验结果面板（只查不写，候选登记需人工确认）
			const [dualPanel, setDualPanel] = useState(null); // { results: [{name,status,smiles,casNumber,inchiKey,sources}], missingAfter } | null

			// ── 0.3.2 Ketcher 结构编辑状态 ────────────────────────────────────
			const openStructureEditor = (entry) => {
				if (route?.locked) {
					notify("当前路线已锁定；请先复制为新版本。");
					return;
				}
				if (!selectedStep) return;
				setKetcherModal({ stepKey: selectedStep.id, name: entry?.name || "", smiles: entry?.smiles || "", role: entry?.role || "unknown" });
			};
			const saveKetcherSmiles = (smiles) => withBusy(`struct:${ketcherModal?.name}`, async () => {
				const modal = ketcherModal;
				const clean = String(smiles ?? "").trim();
				if (!modal || !clean) { notify(clean ? "结构式为空，未保存" : "保存失败：未收到结构式"); return; }
				try {
					await call("synth_step_set_structure", { request: { routeId, stepId: modal.stepKey, name: modal.name, smiles: clean } });
					notify(`已用 Ketcher 结果更新「${modal.name}」结构式（source=manual）。`);
					const reload = await call("synth_route_detail", { request: { id: routeId } });
					setDetail(reload);
					setKetcherModal(null);
				} catch (reason) {
					notify(reason.message || "结构式保存失败");
				}
			});
			// 组件三选中事实与当前步骤同步；旧选中失效时回落到第一条
			useEffect(() => {
				const candidates = detail?.evidence || [];
				const rows = selectedStep ? candidates.filter((row) => row.stepId === selectedStep.id || (row.stepId === undefined && row.stepKey !== undefined && Number(row.stepKey) === selectedStep.step)) : [];
				setSelectedEvidenceId((current) => (current && rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? null)));
			}, [detail, selectedStepId]);
			// 审核批次列表跟随 route/刷新
			useEffect(() => {
				if (!routeId) return undefined;
				let stale = false;
				call("synth_review_batch_get", { request: { routeId } })
					.then((result) => { if (!stale) setBatchList(result.batches || []); })
					.catch(() => { if (!stale) setBatchList([]); });
				return () => { stale = true; };
			}, [routeId, tick]);
			// 0.4.0：双源核验（PubChem/CACTUS 只查不写；候选登记需逐条人工确认）
			const runDualResolve = () => withBusy("dual", async () => {
				if (route?.locked) {
					notify("当前路线已锁定；请先复制为新版本。");
					return;
				}
				if (!selectedStep) return;
				const result = await call("synth_step_resolve_dual", { request: { routeId, stepId: selectedStep.id } });
				const r = result.result || {};
				setDualPanel({ results: r.results || [], missingAfter: r.missingAfter || [] });
				if (!(r.results || []).length) notify("该步骤化合物均已具备结构式，无需双源核验。");
			});
			const registerDualStructure = (item) => withBusy(`dual-save:${item.name}`, async () => {
				if (route?.locked) {
					notify("当前路线已锁定；请先复制为新版本。");
					return;
				}
				if (!selectedStep || !item?.smiles) return;
				const verifiedSources = item.status === "dual-confirmed"
					? ["pubchem", "cactus"]
					: (item.sources?.pubchem?.smiles ? ["pubchem"] : ["cactus"]);
				try {
					// 0.4.0 WP3：登记同时持久化 CAS / InChIKey / 来源（可追溯 provenance）
					await call("synth_step_set_structure", { request: { routeId, stepId: selectedStep.id, name: item.name, smiles: item.smiles, casNumber: item.casNumber || undefined, inchiKey: item.inchiKey || undefined, verification: { status: item.status, sources: verifiedSources, checkedAt: new Date().toISOString() } } });
					notify(`已登记「${item.name}」结构（${item.status === "dual-confirmed" ? "PubChem/CACTUS 双源一致" : "单源确认"}）${item.casNumber ? `，CAS ${item.casNumber}` : ""}。`);
					const reload = await call("synth_route_detail", { request: { id: routeId } });
					setDetail(reload);
					if (dualPanel) setDualPanel({ results: dualPanel.results.filter((row) => row.name !== item.name), missingAfter: dualPanel.missingAfter });
				} catch (reason) {
					notify(reason.message || "登记失败");
				}
			});

			if (!routes.length) {
				return h("section", { className: "ib-card" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "合成路线工作台"), h("span", { className: "ib-chip" }, "空状态")),
					h("div", { className: "sw-plan-empty" }, h("b", null, targets.length ? "已登记合成目标，但还没有合成路线" : "尚未登记合成目标/路线"),
						targets.length ? "可新建路线，或让 Agent 根据文献登记路线与步骤。" : "先在课题中登记合成目标，路线出现后会在这里变成可交互工作台。"),
					targets.length ? h("div", { className: "sw04-form-acts", style: { marginTop: 12, justifyContent: "center" } }, h("button", { className: "sw-mini-btn", "data-primary": true, onClick: () => setNewRouteForm({ name: "", targetId: targets[0]?.id || "" }) }, "新建路线")) : null);
			}

			const originChip = route ? (ROUTE_ORIGIN_LABEL[route.origin] || route.origin) : "";
			const evidenceCount = detail ? detail.evidence.length : 0;

return h("div", { className: "sw-plan" },
			h("section", { className: "sw-sec" },
				h("div", { className: "sw-head" },
					h("div", null,
						h("h3", null, "合成路线工作台"),
						h("p", null, "路线层：目标、版本、步骤拓扑。点击任一 Step 查看条件、文献来源与可行性；修改请先“复制为新版本”，不会覆盖已审核版本。")),
				h("div", { className: "sw-acts" },
					h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["new-route"] || !targets.length, onClick: () => setNewRouteForm({ name: "", targetId: targets[0]?.id || "" }), title: targets.length ? "从目标新建一条未锁定路线" : "需要先在课题登记合成目标" }, busy["new-route"] ? "创建中…" : "新建路线"),
					h("button", { className: "sw-mini-btn", disabled: !!busy["add-step"] || route?.locked, onClick: () => runAction("add-step") }, busy["add-step"] ? "添加中…" : "添加步骤"),
					route?.locked ? h("span", { className: "sw-chip", "data-tone": "good" }, "已锁定") : h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy.lock, onClick: () => runAction("lock") }, busy.lock ? "锁定中…" : "锁定版本"),
					h("div", { style: { position: "relative" } },
						h("button", { className: "sw-mini-btn", "data-warn": moreOpen ? "true" : undefined, onClick: () => setMoreOpen((value) => !value), "aria-expanded": moreOpen ? "true" : "false" }, moreOpen ? "收起菜单" : "更多"),
						moreOpen
							? h("div", { className: "sw04-more" },
								h("button", { className: "sw-mini-btn", onClick: () => { setMoreOpen(false); runAction("revision"); } }, "复制为新版本"),
								h("button", { className: "sw-mini-btn", disabled: !!busy.extract, onClick: () => { setMoreOpen(false); runAction("extract"); }, title: detail?.capability?.reason || "" }, "从文献提取路线"),
								h("button", { className: "sw-mini-btn", onClick: () => { setMoreOpen(false); runAction("retro"); }, title: "需要 RetrosynthesisProvider（0.3.0 未配置）" }, "整体逆向规划"),
								h("button", { className: "sw-mini-btn", onClick: () => { setMoreOpen(false); setTick((t) => t + 1); void onChanged(); } }, "刷新"))
							: null))),
				// rc.4 §7：顶部只保留路线/版本选择 + 锁定/新建/添加/更多动作。
				// 目标/状态/锁定态不放常驻状态墙，压缩为一行弱化路线说明。
				h("div", { className: "sw-toolbar" },
					h("select", { className: "sw-select", value: routeId || "", onChange: (event) => setRouteId(event.target.value), style: { maxWidth: 340, fontSize: 10.5 }, "aria-label": "选择路线/版本" },
						routes.map((row) => h("option", { key: row.id, value: row.id }, `${row.name} · v${row.version}${row.origin ? ` · ${ROUTE_ORIGIN_LABEL[row.origin] || row.origin}` : ""}`))),
					route ? h("span", { className: "sw-meta-note", style: { flex: 1, minWidth: 0 }, title: `${route.name} · ${ROUTE_STATUS_LABEL[route.status] || route.status}${route.locked ? " · 已锁定" : " · 未锁定"}${target ? ` · 目标 ${target.name}` : ""}` }, [target ? `目标 ${target.name}` : null, route.locked ? "已锁定 · 只读" : "未锁定", ROUTE_STATUS_LABEL[route.status] || route.status].filter(Boolean).join(" · ")) : null),
				error ? h("div", { className: "ib-error", style: { marginTop: 10 } }, error) : null,
				lockBlockers.length ? h("div", { className: "ib-error", style: { marginTop: 8, border: "1px solid rgba(255,137,137,.4)", padding: "10px 12px", borderRadius: 10 } },
					h("b", null, "锁定被阻断："),
					lockBlockers.map((blocker, index) => h("div", { key: `${blocker.code}-${index}`, style: { marginTop: 5, lineHeight: 1.6 } },
						`${index + 1}. ${blocker.message}`,
						(blocker.stepIds || []).length ? h("span", { style: { marginLeft: 6, color: "#8aa7c6" } }, `步骤：${blocker.stepIds.join("、")}`) : null,
						(blocker.evidenceIds || []).length ? h("span", { style: { marginLeft: 6, color: "#8aa7c6" } }, `事实：${blocker.evidenceIds.join("、")}`) : null))) : null,
				h("div", { className: "sw-graph" },
					!detail
						? h("div", { className: "sw-plan-empty", style: { flex: 1 } },
							h("span", { className: "sw-spin" }),
							h("b", null, error ? "路线加载失败" : "正在加载路线…"),
							error || "正在读取路线、步骤与 Evidence…")
						: !detail.route.steps?.length
							? h("div", { className: "sw-plan-empty", style: { flex: 1 } },
								h("b", null, "该路线还没有任何步骤"),
								"使用“从文献提取路线”，或让 Agent / 人工登记步骤与结构化条件。")
							: detail.route.steps.map((step) => {
								const isActive = step.id === selectedStepId;
								const structured = stepIsStructured(step);
								const preview = structured
									? [step.procedure.reagents?.length ? step.procedure.reagents.map((r) => r.name).join(" + ") : "", step.procedure.solvents?.length ? step.procedure.solvents.map((s) => s.name).join("/") : "", readStepFieldValue(step, STEP_FIELD_DEFS.find((row) => row.key === "temperature")), readStepFieldValue(step, STEP_FIELD_DEFS.find((row) => row.key === "time"))].filter(Boolean).join(" / ") || "条件待补全"
									: (step.conditions ? String(step.conditions).slice(0, 80) : "仅方向，无原文条件");
								const reactantEntries = stepCompoundsByRole(step, ["reactant"]);
								const productEntries = stepCompoundsByRole(step, ["product"]);
								// rc.4 §3.1：总览点结构图 → 先选中该步骤再用该步骤 id 打开
								// 对应化合物（避免把结构写进错误步骤）；卡片空白区才负责切换。
								const openOverviewStructure = (targetStep, entry) => {
									if (route?.locked) { notify("当前路线已锁定；请先复制为新版本。"); return; }
									const targetKey = targetStep?.id ?? `s${targetStep?.step}`;
									setSelectedStepId(targetKey);
									setMoreOpen(false);
									setKetcherModal({ stepKey: targetKey, name: entry?.name || "", smiles: entry?.smiles || "", role: entry?.role || "unknown" });
								};
								// 0.4.0 WP2 + rc.4 §3.1：路线总览以 Ketcher 结构图为主体，且
								// 反应物与产物都必须在总览中渲染（产物结构不可被截掉）。
								// 点击结构图只打开该化合物（StructureCard 内 stopPropagation），
								// 点击卡片空白/标题区域才切换步骤。
								const structureNode = (entry) => h("span", { className: "sw-step-chem-node", key: `${entry.name}-${entry.smiles || "none"}`, title: entry.casNumber ? `${entry.name} · CAS ${entry.casNumber}` : entry.name },
									h(StructureCard, { entry, onClick: () => openOverviewStructure(step, entry), compact: true }));
								const structureRow = (entries, fallbackNames, dataRole) => (entries.length
									? h("span", { className: "sw-step-chem-flow", "data-role": dataRole }, entries.map(structureNode))
									: h("span", { className: "sw-step-chem-empty", "data-role": dataRole }, (fallbackNames || []).join("、") || "结构待补"));
								// rc.4：卡片本身为可聚焦 div（避免 button 内嵌可点击结构节点）；
								// 点击卡片空白/标题区域切换步骤，点击结构图打开对应化合物。
								return h("div", { key: step.id, className: "sw-step", "data-active": isActive ? "true" : undefined, role: "button", tabIndex: 0, "aria-label": `${step.id}：${step.label || step.reaction || `Step ${step.step}`}，点击查看步骤详情`, onClick: (event) => { setSelectedStepId(step.id); setMoreOpen(false); }, onKeyDown: (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelectedStepId(step.id); setMoreOpen(false); } } },
									h("span", { className: "sw-step-top" },
										h("span", { className: "sw-step-id" }, step.id),
										h("span", { className: "sw-chip", "data-tone": structured ? "good" : "warn" }, structured ? "结构化" : "原文摘要")),
									h("span", { className: "sw-step-reaction" }, step.label || step.reaction || `Step ${step.step}`),
									h("span", { className: "sw-step-chem" },
										h("span", { className: "sw-step-chem-reactants", "data-role": "reactants" }, structureRow(reactantEntries, step.reactants, "reactants")),
										h("span", { className: "sw-step-chem-mid" },
											h("span", { className: "sw-step-chem-arrow", "aria-hidden": "true" }, "→"),
											h("span", { className: "sw-step-chem-cond" }, preview)),
										h("span", { className: "sw-step-chem-products", "data-role": "products" }, structureRow(productEntries, step.products, "products"))))
							}))),
			selectedStep && detail
				? h("section", { className: "sw-sec sw04-detail" },
					h("div", { className: "sw-head" },
						h("div", null,
							h("h3", null, `${selectedStep.id} · 步骤详情`),
							h("p", null, "横向反应式：左侧反应物 → 中间条件与注意事项 → 右侧产物。字段无来源显示“文献未提供 / 待确认”，系统不自动补默认值；缺结构可解析或 Ketcher 补绘。")),
						h("div", { className: "sw-acts" },
							h("button", { className: "sw-mini-btn", disabled: !!busy.dual || route?.locked, onClick: () => void runDualResolve(), title: "PubChem/CACTUS 双源核验缺结构化合物；冲突只展示候选不自动写入" }, busy.dual ? "核验中…" : "双源核验"),
							h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy.plan || !route?.steps?.length || route?.locked, onClick: () => runAction("plan") }, busy.plan ? "生成中…" : (planArmed ? "再次点击确认生成" : "生成实验计划草案")))),
					h(StepReactionLayout, { step: selectedStep, onStructureClick: openStructureEditor }),
					h("p", { className: "sw04-difficulty" }, h("b", null, "步骤难点"), selectedStep.difficultySummary || "缺少足够的结构或条件信息，需先核验。"),
					stepIsStructured(selectedStep)
						? h("div", { className: "sw-notes", style: { marginTop: 10 } }, h("div", { className: "sw-note" }, h("i", null, "✓"), h("span", null, "结构化条件已在中栏完整展示；字段级原文来源请到下方「事实核验」面板逐条确认。")))
						: h("div", { className: "sw-notes", style: { marginTop: 12 } }, h("div", { className: "sw-note" }, h("i", null, "⚠"), h("span", null, selectedStep.conditions ? `该步骤为原文摘要形态（未结构化）。原文条件摘要：${selectedStep.conditions}` : "该步骤为原文摘要形态（未结构化）。关键字段暂视为“待确认”，可在对话中让 Agent 拆分为结构化条件并补充 Evidence。"))),
					(selectedStep.procedure?.notes || []).length ? h("div", { className: "sw-notes" }, selectedStep.procedure.notes.map((note, index) => h("div", { className: "sw-note", key: index }, h("i", null, "⚠"), h("span", null, note)))) : null)
				: h("section", { className: "sw-sec" }, h("div", { className: "sw-plan-empty" }, h("b", null, "尚未选择步骤"), "在上方路线总览中点击一个 Step，查看横向反应式、事实核验与实验计划。")),
			selectedStep && detail
				? h("section", { className: "sw-sec sw04-fact" },
					h("div", { className: "sw-head" },
						h("div", null,
							h("h3", null, "事实核验"),
							h("p", null, "本步事实以紧凑列表展示；点击「审核」从右侧打开原文核对抽屉，在抽屉内完成确认 / 修正 / 无法确认。无已捕获原文或无页码的事实不能计为截图核验完成。"),
						h("span", { className: "sw-chip", "data-tone": stepEvidence.some((row) => row.reviewStatus === "pending") ? "warn" : "good" },
							`待核验 ${stepEvidence.filter((row) => row.reviewStatus === "pending").length} / 已确认 ${stepEvidence.filter((row) => row.reviewStatus === "confirmed").length}`))),
					stepEvidence.length
						? h("div", { className: "sw04-fact-compact" }, stepEvidence.map((row) => {
							const locked = !!route?.locked;
							const reviewLabel = ({ pending: "待核验", confirmed: "已确认", corrected: "已修正", rejected: "无法确认", edited: "已修订" })[row.reviewStatus] || row.reviewStatus;
							const reviewTone = row.reviewStatus === "pending" ? "warn" : (row.reviewStatus === "rejected" ? "bad" : "good");
							const claim = row.excerpt || row.userCorrection || row.title || row.sourceName || "";
							const fieldLabel = row.supportsField ? String(row.supportsField) : (row.title || "核验项");
							return h("div", { key: row.id, className: "sw04-fact-row" },
								h("div", { className: "sw04-fact-row-main" },
									h("div", { className: "sw04-fact-row-title" }, row.title || row.sourceName || fieldLabel),
									h("div", { className: "sw04-fact-row-meta" }, `${EVIDENCE_SOURCE_LABEL[row.sourceType] || row.sourceType}${evidenceLocator(row) ? " · " + evidenceLocator(row) : ""}${row.supportsField ? " · " + row.supportsField : ""}`),
									claim ? h("div", { className: "sw04-fact-row-claim", title: claim }, claim) : null),
								h("span", { className: "sw04-fact-row-status" },
									h("span", { className: "sw-chip", "data-tone": reviewTone }, `第 ${row.reviewRound || 1} 轮 · ${reviewLabel}`)),
								h("button", { className: "sw04-fact-review-btn", "data-done": row.reviewStatus !== "pending" ? "true" : undefined, disabled: locked, onClick: () => openReviewDrawer(row.id), title: locked ? "路线已锁定" : (row.reviewStatus !== "pending" ? "重新审核该事实" : "审核该事实（打开右侧原文核对抽屉）") }, row.reviewStatus !== "pending" ? "重新审核" : "审核"));
						}))
						: h("div", { className: "sw-plan-empty", style: { marginTop: 12, padding: "20px 14px" } }, h("b", null, "该步骤暂无字段级 Evidence"), "关键实验字段缺少文献支撑时视为“待确认”；可让 Agent 从 SI/正文提取并绑定到字段。"),
					stepEvidence.length
						? h("div", { className: "sw04-batchbar" },
							h("b", null, "本轮事实核验"),
							h("small", null, stepEvidence.filter((row) => row.reviewStatus === "pending").length
								? `${stepEvidence.filter((row) => row.reviewStatus === "pending").length} 条仍待选择（确认/修正/无法确认）。`
								: "本步事实已全部人工选择。"),
							h("span", { style: { flex: 1 } }),
							h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy.batch || route?.locked || stepEvidence.some((row) => row.reviewStatus === "pending"), onClick: () => void submitReviewBatch(), title: stepEvidence.some((row) => row.reviewStatus === "pending") ? "全部事实完成后才能提交" : "提交后 Agent 只更新无法确认/缺失/冲突项" }, busy.batch ? "提交中…" : "交给 Agent 更新未确定项"))
						: null,
					batchList.filter((row) => row.stepId === selectedStep.id).length
						? h("div", { className: "sw04-batchbar", style: { borderColor: "rgba(112,157,211,.3)", background: "rgba(1,20,45,.4)" } },
							h("b", null, "审核批次"),
							h("small", null, batchList.filter((row) => row.stepId === selectedStep.id).slice(0, 3).map((row) => {
								const tone = row.status === "pending" ? "等待 Agent 处理" : (row.status === "applied" ? "Agent 已回写 · 进入下一轮" : "已关闭");
								return h("span", { key: row.id, className: "sw-chip", style: { marginRight: 6 } }, `第 ${row.round} 轮 · ${tone} · ${row.id}`);
							})),
							h("span", { style: { flex: 1 } }),
							batchList.some((row) => row.stepId === selectedStep.id && ["pending", "applied"].includes(row.status))
								? h("button", { className: "sw-mini-btn", disabled: !!route?.locked, onClick: () => void completeBatch(batchList.find((row) => row.stepId === selectedStep.id && ["pending", "applied"].includes(row.status))) }, "关闭本步批次")
								: null)
						: null)
				: null,
			addStepForm
				? h("div", { className: "sw-struct-edit" }, h("div", { className: "sw04-form" },
					h("b", null, `添加步骤（Step ${Math.max(0, ...(route?.steps || []).map((item) => Number(item.step) || 0)) + 1}）`),
					h("input", { value: addStepForm.reaction, placeholder: "反应名称/简述（必填），例如：RAFT 聚合", onChange: (event) => setAddStepForm({ ...addStepForm, reaction: event.target.value }) }),
					h("input", { value: addStepForm.reactants, placeholder: "反应物（顿号或逗号分隔）", onChange: (event) => setAddStepForm({ ...addStepForm, reactants: event.target.value }) }),
					h("input", { value: addStepForm.products, placeholder: "产物（顿号或逗号分隔）", onChange: (event) => setAddStepForm({ ...addStepForm, products: event.target.value }) }),
					h("div", { className: "sw04-form-acts" },
						h("button", { className: "sw-mini-btn", onClick: () => setAddStepForm(null) }, "取消"),
						h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["add-step"], onClick: () => void submitAddStep(addStepForm) }, busy["add-step"] ? "添加中…" : "添加"))))
				: null,
			newRouteForm
				? h("div", { className: "sw-struct-edit" }, h("div", { className: "sw04-form", style: { maxWidth: 460, margin: "auto" } },
					h("b", null, "新建路线（draft · 未锁定）"),
					h("label", { style: { fontSize: 10, color: "#8aa7c6" } }, "合成目标"),
					h("select", { value: newRouteForm.targetId, onChange: (event) => setNewRouteForm({ ...newRouteForm, targetId: event.target.value }) },
						targets.map((row) => h("option", { key: row.id, value: row.id }, `${row.name}${row.smiles ? " · " + row.smiles : ""}`))),
					h("label", { style: { fontSize: 10, color: "#8aa7c6" } }, "路线名称"),
					h("input", { value: newRouteForm.name, placeholder: "例如：目标分子的 3 步合成路线", onChange: (event) => setNewRouteForm({ ...newRouteForm, name: event.target.value }) }),
					h("div", { className: "sw04-form-acts" },
						h("button", { className: "sw-mini-btn", onClick: () => setNewRouteForm(null) }, "取消"),
						h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["new-route"], onClick: () => void submitNewRoute(newRouteForm) }, busy["new-route"] ? "创建中…" : "创建路线"))))
				: null,
			// 0.4.0：PubChem/CACTUS 双源核验结果面板（四态候选，登记需人工点击）
			dualPanel
				? h("div", { className: "sw-struct-edit" }, h("div", { style: { width: "min(820px,96vw)", maxHeight: "84vh", overflowY: "auto", display: "grid", gap: 10, background: "#011e3f", border: "1px solid rgba(140,181,229,.42)", borderRadius: 14, padding: 16, color: "#cfe4fb", fontSize: 11, lineHeight: 1.6 } },
					h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
						h("b", { style: { fontSize: 13, color: "#eaf4ff" } }, "双源核验 · PubChem / CACTUS"),
						h("span", { style: { flex: 1 } }, `${dualPanel.results.length} 个化合物缺结构式`),
						h("button", { className: "sw-mini-btn", onClick: () => setDualPanel(null) }, "关闭")),
					h("p", { style: { margin: 0, color: "#8aa7c6" } }, "只读核验：两源一致才可直接登记；单源需确认来源；冲突与未命中不自动写入，可 Ketcher 人工补绘。"),
					dualPanel.results.length
						? dualPanel.results.map((item) => {
							const tone = item.status === "dual-confirmed" ? "#a5e8c6" : (item.status === "single-source" ? "#ffe1a0" : (item.status === "conflict" ? "#ffb3bd" : "#9bb3d1"));
							const label = item.status === "dual-confirmed" ? "双源一致" : (item.status === "single-source" ? (item.sources?.pubchem?.smiles ? "单源 · PubChem" : "单源 · CACTUS") : (item.status === "conflict" ? "两源冲突" : "双源未命中"));
							const pub = item.sources?.pubchem || {};
							const cac = item.sources?.cactus || {};
							const pubText = pub.smiles ? "✓ " + String(pub.smiles).slice(0, 40) + (pub.cid ? " · CID " + pub.cid : "") : "✗ " + (pub.error || "未查询");
							const cacText = cac.smiles ? "✓ " + String(cac.smiles).slice(0, 40) : "✗ " + (cac.error || "未查询");
							const canRegister = item.status === "dual-confirmed" || item.status === "single-source";
							const rowStyle = { border: "1px solid rgba(112,157,211,.25)", borderRadius: 11, background: "rgba(2,51,115,.16)", padding: "10px 12px", display: "grid", gap: 6 };
							const headFlex = h("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
								h("b", { style: { color: "#eaf4ff" } }, item.name),
								h("span", { style: { color: tone, border: "1px solid " + tone + "55", background: tone + "14", borderRadius: 999, padding: "1px 8px", fontSize: 9 } }, label),
								item.casNumber ? h("span", { className: "sw-chip" }, "CAS " + item.casNumber) : null,
								h("span", { style: { flex: 1 } }),
								canRegister ? h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["dual-save:" + item.name], onClick: () => void registerDualStructure(item) }, busy["dual-save:" + item.name] ? "登记中…" : "登记结构") : null,
								h("button", { className: "sw-mini-btn", disabled: route?.locked, onClick: () => { setDualPanel(null); openStructureEditor({ name: item.name }); } }, "Ketcher 补绘"));
							const smilesRow = item.smiles ? h("div", { style: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 9.5, color: "#8cb5e5", wordBreak: "break-all" } }, "SMILES " + item.smiles) : null;
							const srcRow = h("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 9.5, color: "#9db8d6" } },
								h("span", null, "PubChem " + pubText),
								h("span", null, "CACTUS " + cacText));
							return h("div", { key: item.name, style: rowStyle }, headFlex, smilesRow, srcRow);
						})
						: h("div", { className: "sw-plan-empty", style: { padding: "16px 14px" } }, "缺结构化合物已完成双源核验或登记。")))
				: null,
			// ── RC1-04/05：右侧审核抽屉（单例，按 activeEvidenceId 动态渲染）──
			reviewDrawerOpen && activeEvidence
				? h("div", { className: "sw04-review-backdrop", onClick: closeReviewDrawer },
					h("div", { className: "sw04-review-drawer", role: "dialog", "aria-modal": "true", "aria-label": "事实核验审核抽屉", onClick: (event) => event.stopPropagation() },
						h("div", { className: "sw04-review-head" },
							h("div", { className: "sw04-review-head-main" },
								h("span", { className: "sw04-review-head-title" }, activeEvidence.title || activeEvidence.sourceName || "事实核验"),
								h("span", { className: "sw04-review-head-sub" }, `${EVIDENCE_SOURCE_LABEL[activeEvidence.sourceType] || activeEvidence.sourceType}${activeEvidence.doi ? " · DOI " + activeEvidence.doi : ""}${evidenceLocator(activeEvidence) ? " · " + evidenceLocator(activeEvidence) : ""}${activeEvidence.supportsField ? " · 字段 " + activeEvidence.supportsField : ""}`)),
							h("button", { className: "sw04-review-close", onClick: closeReviewDrawer, "aria-label": "关闭审核抽屉" }, "关闭")),
					h("div", { className: "sw04-review-body" },
						h("div", { className: "sw04-review-copy" },
							h("div", { className: "sw04-review-field" }, h("b", null, "核验字段："), activeEvidence.supportsField || activeEvidence.title || "（未标注字段）"),
							activeEvidence.excerpt ? h("div", { className: "sw04-review-quote" }, h("b", null, "系统提取值："), activeEvidence.excerpt) : null,
							activeEvidence.userCorrection ? h("div", { className: "sw04-review-quote", style: { borderLeftColor: "#d9a441", background: "#fbf5e6" } }, h("b", null, "人工修正："), activeEvidence.userCorrection, activeEvidence.originalExtract ? `（原始提取：${activeEvidence.originalExtract}）` : "") : null,
							// PDF 定位器与提取内容同列，右半屏完整留给截图核验。
							h(PdfViewerFrame, { row: activeEvidence, notify })),
						h("div", { className: "sw04-review-source" },
							activeEvidence.bundleId || activeEvidence.documentId
								? h("div", { className: "sw04-review-shot" },
									h(EvidenceShot, { routeId, row: activeEvidence, notify, onReady: (evidenceId) => markShotReady(evidenceId, true), onFailed: (evidenceId) => markShotReady(evidenceId, false) }),
									h("div", { className: "sw04-review-hint" }, "原文截图由服务端按已捕获原文 + 页码渲染（截图核验门禁依据）；可点击「打开原文」在 PDF 阅读器中查看完整文献。"))
								: h("div", { className: "sw04-review-hint" }, "该事实尚未绑定可截图的原文。"))),
						h("div", { className: "sw04-review-foot" },
							h("input", { className: "sw04-review-note", value: correctionFor?.value ?? "", placeholder: "修正值（确认/无法确认可留空）", onChange: (event) => setCorrectionFor({ id: activeEvidence.id, value: event.target.value }), disabled: !!busy[`ev:${activeEvidence.id}`] || !!route?.locked }),
							h("button", { className: "sw-mini-btn", "data-no": true, disabled: !!busy[`ev:${activeEvidence.id}`] || route?.locked, onClick: () => void decideEvidence(activeEvidence, "rejected") }, busy[`ev:${activeEvidence.id}`] ? "提交中…" : "无法确认"),
							h("button", { className: "sw-mini-btn", disabled: !!busy[`ev:${activeEvidence.id}`] || route?.locked, onClick: () => void saveCorrection(activeEvidence, correctionFor?.value ?? "") }, busy[`ev:${activeEvidence.id}`] ? "提交中…" : "修正"),
							h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy[`ev:${activeEvidence.id}`] || route?.locked, onClick: () => void decideEvidence(activeEvidence, "confirmed") }, busy[`ev:${activeEvidence.id}`] ? "提交中…" : "确认通过"),
							h("button", { className: "sw04-review-next", disabled: !stepEvidence.some((row) => row.reviewStatus === "pending" && row.id !== activeEvidence.id), onClick: () => { const next = stepEvidence.find((row) => row.reviewStatus === "pending" && row.id !== activeEvidence.id); if (next) { setSelectedEvidenceId(next.id); setCorrectionFor(null); } }, title: "跳到下一条待审核事实" }, "下一条待审核"))))
				: null,
			h(KetcherEditorModal, { entry: ketcherModal, onSave: (smiles) => void saveKetcherSmiles(smiles), onCancel: () => setKetcherModal(null) }));
		}
