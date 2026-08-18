/**
 * dsh-lab-agent: Web client plugin（手写 CJS bundle，兼容 kernel 模块加载器）。
 *
 * - $mount "lab" Remote（调用 host 侧 ctx.lab 聚合服务，ctx.remote.lab.*）；
 * - 侧边栏 sidebar.footer.action 注册"实验室"入口；
 * - 点击打开全屏管理面板（React portal，React 18 legacy render），9 个 tab：
 *   版本登记 / 精读目标 / PPT模板 / 文献任务 / 化学性质 / 实验计划 / NMR / 合成路线 / Python 环境。
 */

window.__ModuleLoader__.load({
	id: "dsh-lab-agent",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let ReactDOM = require("react-dom");
		let { useState, useEffect, useCallback, Fragment } = react;

		// ── styles ──────────────────────────────────────────────────────────
		const css = [
			".dshla-overlay{position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-base,#0f1115);display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#e6e6e6)}",
			".dshla-bar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2d33);flex:none}",
			".dshla-bar h1{font-size:15px;font-weight:600;margin:0;flex:1}",
			".dshla-close{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#2a2d33);background:var(--dsw-alias-bg-layer-1,#16181d);color:inherit;border-radius:8px;padding:5px 12px;font-size:13px}",
			".dshla-body{display:flex;flex:1;min-height:0}",
			".dshla-tabs{width:170px;flex:none;border-right:1px solid var(--dsw-alias-border-l2,#2a2d33);overflow:auto;padding:8px 0}",
			".dshla-tab{display:block;width:100%;text-align:left;border:0;background:none;color:var(--dsw-alias-label-secondary,#a0a4ab);cursor:pointer;padding:8px 14px;font-size:13px}",
			".dshla-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}",
			".dshla-tab[data-active=true]{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));font-weight:600}",
			".dshla-content{flex:1;min-width:0;overflow:auto;padding:16px 20px}",
			".dshla-section{margin-bottom:18px}",
			".dshla-section h2{font-size:14px;font-weight:600;margin:0 0 8px}",
			".dshla-table{width:100%;border-collapse:collapse;font-size:12.5px}",
			".dshla-table th,.dshla-table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#26292f);vertical-align:top}",
			".dshla-table th{color:var(--dsw-alias-label-tertiary,#7c8189);font-weight:500;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em}",
			".dshla-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.03))}",
			".dshla-form{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;align-items:center}",
			".dshla-form input,.dshla-form select,.dshla-form textarea{border:1px solid var(--dsw-alias-border-l2,#2a2d33);background:var(--dsw-alias-bg-layer-1,#16181d);color:inherit;border-radius:7px;padding:6px 9px;font-size:12.5px;font-family:inherit}",
			".dshla-form input{width:150px}.dshla-form input[data-wide]{width:280px}",
			".dshla-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#2a2d33);background:var(--dsw-alias-bg-layer-1,#16181d);color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:7px;padding:5px 11px;font-size:12.5px}",
			".dshla-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}",
			".dshla-btn[data-primary]{background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent}",
			".dshla-err{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;margin:6px 0;white-space:pre-wrap}",
			".dshla-meta{color:var(--dsw-alias-label-tertiary,#7c8189);font-size:11.5px}",
			".dshla-status{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px}",
			".dshla-status[data-s=ok]{background:rgba(34,197,94,.15);color:#22c55e}",
			".dshla-status[data-s=warn]{background:rgba(245,158,11,.15);color:#f59e0b}",
			".dshla-status[data-s=err]{background:rgba(239,68,68,.15);color:#ef4444}",
			".dshla-sidebar-entry{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;padding:7px 10px;font-size:13px;border-radius:8px}",
			".dshla-sidebar-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}",
			".dshla-json{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-secondary,#a0a4ab);white-space:pre-wrap;max-height:160px;overflow:auto}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=dsh-lab-agent]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-lab-agent";
			tag.dataset.pluginCss = "dsh-lab-agent";
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── Remote contribution（namespace "lab"）───────────────────────────
		const passthroughSchema = { parse: (value) => value };
		const strict = (typeSymbol) => ({ mode: "strict", typeSymbol, schema: passthroughSchema });
		const direct = (method, params = []) => ({
			id: `dsh-lab-agent#lab/${method}`,
			service: "lab",
			namespace: "lab",
			method,
			invocation: { kind: "direct" },
			parameters: params.map((wire) => ({
				name: wire,
				wire,
				source: "json",
				codec: strict(`dsh-lab-agent#lab/${method}:${wire}`)
			})),
			result: strict(`dsh-lab-agent#lab/${method}:result`)
		});
		const descriptors = [
			direct("versions_list"), direct("versions_resolve", ["request"]),
			direct("goals_list"), direct("goals_resolve", ["request"]), direct("goals_create", ["request"]),
			direct("goals_update", ["request"]), direct("goals_copy", ["request"]), direct("goals_delete", ["request"]),
			direct("goals_requirements", ["request"]),
			direct("templates_list"), direct("templates_resolve", ["request"]), direct("templates_preview", ["request"]),
			direct("templates_validate", ["request"]),
			direct("projects_list"), direct("projects_create", ["request"]), direct("projects_get", ["request"]),
			direct("tasks_searches", ["request"]), direct("tasks_provenance", ["request"]),
			direct("chem_entities", ["request"]), direct("chem_entity_create", ["request"]), direct("chem_properties", ["request"]),
			direct("chem_formula", ["request"]), direct("chem_metrics", ["request"]),
			direct("chem_plans", ["request"]), direct("chem_plan_create", ["request"]), direct("chem_plan_validate", ["request"]),
			direct("chem_plan_status", ["request"]),
			direct("nmr_list"), direct("nmr_get", ["request"]), direct("nmr_create", ["request"]), direct("nmr_integrals", ["request"]),
			direct("nmr_approve", ["request"]), direct("nmr_written_back", ["request"]), direct("nmr_verify", ["request"]),
			direct("nmr_reopen", ["request"]), direct("nmr_calculate", ["request"]),
			direct("synth_targets", ["request"]), direct("synth_target_create", ["request"]), direct("synth_routes", ["request"]),
			direct("synth_route_create", ["request"]), direct("synth_route_step", ["request"]), direct("synth_route_status", ["request"]),
			direct("synth_evidence", ["request"]), direct("cas_policy"), direct("cas_prepare_query", ["request"]), direct("cas_login_entry"),
			direct("python_preflight")
		];

		// ── helpers ─────────────────────────────────────────────────────────
		const h = react.createElement;
		const fmt = (value) => {
			if (value === undefined || value === null) return "—";
			if (typeof value === "string") return value;
			return JSON.stringify(value);
		};
		const tag = (status) => h("span", { className: "dshla-status", "data-s": status.ok ? "ok" : status.ok === false ? "err" : "warn" }, status.ok ? "OK" : status.ok === false ? "ERR" : "—");

		function Table({ columns, rows, empty = "暂无数据" }) {
			if (!rows || rows.length === 0) return h("p", { className: "dshla-meta" }, empty);
			return h("table", { className: "dshla-table" },
				h("thead", null, h("tr", null, columns.map((c) => h("th", { key: c.key }, c.label)))),
				h("tbody", null, rows.map((row, i) => h("tr", { key: i }, columns.map((c) => h("td", { key: c.key }, c.render ? c.render(row) : fmt(row[c.key]))))))
			);
		}

		function Field({ label, value, onChange, wide, placeholder }) {
			return h("input", { placeholder: placeholder ?? label, "data-wide": wide ? "true" : undefined, value, onChange: (e) => onChange(e.target.value) });
		}

		/** 通用"列表 + 表单 + 操作"面板壳。form/actions 签名：(run, setError)。 */
		function CrudPanel({ title, columns, load, form, actions, empty }) {
			const [rows, setRows] = useState([]);
			const [error, setError] = useState("");
			const [busy, setBusy] = useState(false);
			const run = useCallback(async () => {
				setBusy(true);
				setError("");
				try {
					setRows(await load());
				} catch (e) {
					setError(e.message);
				} finally {
					setBusy(false);
				}
			}, []);
			useEffect(() => { void run(); }, [run]);
			return h("div", null,
				h("div", { className: "dshla-section" },
					h("div", { className: "dshla-form" },
						form ? form(run, setError) : null,
						h("button", { className: "dshla-btn", onClick: () => void run() }, busy ? "加载中…" : "刷新"),
						actions ? actions(run, setError) : null
					),
					error ? h("div", { className: "dshla-err" }, error) : null
				),
				h("div", { className: "dshla-section" },
					h("h2", null, `${title}（${rows.length}）`),
					h(Table, { columns, rows, empty })
				)
			);
		}

		// ── 各 tab ──────────────────────────────────────────────────────────
		function VersionsTab({ call }) {
			return h(CrudPanel, {
				title: "Nature Skill 版本登记",
				load: async () => (await call("versions_list")).rows,
				columns: [
					{ key: "record.skillName", label: "Skill", render: (r) => r.record.skillName },
					{ key: "record.commitSha", label: "Commit", render: (r) => r.record.commitSha.slice(0, 10) },
					{ key: "record.manifestVersion", label: "Manifest" },
					{ key: "record.license", label: "License" },
					{ key: "record.regressionPassedAt", label: "回归通过", render: (r) => r.record.regressionPassedAt ? new Date(r.record.regressionPassedAt).toLocaleDateString() : "—" }
				]
			});
		}

		function GoalsTab({ call }) {
			const [id, setId] = useState("");
			const [name, setName] = useState("");
			return h(CrudPanel, {
				title: "精读目标（ReadingGoalProfile）",
				load: async () => (await call("goals_list")).goals,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "version", label: "版本" },
					{ key: "name", label: "名称" },
					{ key: "topics", label: "课题", render: (r) => (r.topics ?? []).join(", ") },
					{ key: "updatedAt", label: "更新", render: (r) => new Date(r.updatedAt).toLocaleString() }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "id", value: id, onChange: setId }),
					h(Field, { label: "名称", value: name, onChange: setName, wide: true }),
					h("button", { className: "dshla-btn", "data-primary": "true", onClick: async () => {
						try {
							if (!id) throw new Error("id 必填");
							await call("goals_create", { request: { id, fields: { name: name || id, researchQuestions: [] } } });
							setId(""); setName(""); setError("");
							await run();
						} catch (e) { setError(e.message); }
					} }, "创建")
				),
				actions: (run, setError) => h(Fragment, null,
					h("button", { className: "dshla-btn", onClick: async () => {
						const target = prompt("目标 id：");
						if (!target) return;
						const version = prompt("版本（留空=最新）：") || undefined;
						try {
							const r = await call("goals_resolve", { request: { id: target, version } });
							alert(r.goal ? JSON.stringify(r.goal, null, 2) : "未找到");
						} catch (e) { setError(e.message); }
					} }, "查看详情"),
					h("button", { className: "dshla-btn", onClick: async () => {
						const target = prompt("目标 id：");
						if (!target) return;
						try {
							const r = await call("goals_delete", { request: { id: target } });
							alert("已删除（历史版本保留）");
							await run();
						} catch (e) { setError(e.message); }
					} }, "删除")
				)
			});
		}

		function TemplatesTab({ call }) {
			const [id, setId] = useState("");
			return h(CrudPanel, {
				title: "PPT 模板（PptTemplateProfile）",
				load: async () => (await call("templates_list")).templates,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "version", label: "版本" },
					{ key: "name", label: "名称" },
					{ key: "status", label: "状态", render: (r) => tag({ ok: r.status === "ready" }) },
					{ key: "pageSize", label: "比例", render: (r) => r.pageSize?.ratio }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "模板 id", value: id, onChange: setId }),
					h("span", { className: "dshla-meta" }, "（导入 PPTX 需上传文件，见 host 服务 labTemplates.importPptx）")
				),
				actions: (run, setError) => h("button", { className: "dshla-btn", onClick: async () => {
					const target = prompt("模板 id：");
					if (!target) return;
					try {
						const v = await call("templates_validate", { request: { id: target } });
						alert(v.validation.ok ? "校验通过" : `不通过：${v.validation.problems.join("; ")}`);
					} catch (e) { setError(e.message); }
				} }, "校验")
			});
		}

		function TasksTab({ call }) {
			const [projectId, setProjectId] = useState("");
			return h(CrudPanel, {
				title: "文献→PPT 项目（LabProject）",
				load: async () => (await call("projects_list")).projects,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "name", label: "名称" },
					{ key: "goalProfile", label: "目标", render: (r) => `${r.goalProfile?.id}@${r.goalProfile?.version}` },
					{ key: "template", label: "模板", render: (r) => `${r.template?.id}@${r.template?.version}` },
					{ key: "status", label: "状态" }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "project id", value: projectId, onChange: setProjectId }),
					h("button", { className: "dshla-btn", onClick: async () => {
						try {
							if (!projectId) throw new Error("project id 必填");
							const runs = await call("tasks_searches", { request: { projectId } });
							const prov = await call("tasks_provenance", { request: { projectId } });
							alert(`检索记录 ${runs.runs.length} 条\n${runs.runs.map((r) => `  ${r.id} ${r.status} ${r.query}`).join("\n")}\n产物溯源 ${prov.provenance.length} 条`);
						} catch (e) { setError(e.message); }
					} }, "查看检索/溯源")
				)
			});
		}

		function ChemistryTab({ call }) {
			const [formula, setFormula] = useState("");
			const [metricInput, setMetricInput] = useState("");
			return h(CrudPanel, {
				title: "化学实体（ChemicalEntity）",
				load: async () => (await call("chem_entities", { request: {} })).entities,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "kind", label: "类型" },
					{ key: "name", label: "名称" },
					{ key: "formula", label: "分子式" },
					{ key: "linkageType", label: "连接方式", render: (r) => r.linkageType ?? "—" }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "分子式", value: formula, onChange: setFormula }),
					h("button", { className: "dshla-btn", onClick: async () => {
						try {
							if (!formula) throw new Error("分子式必填");
							const r = await call("chem_formula", { request: { formula } });
							alert(`MW = ${r.result.molecularWeight.toFixed(3)} g/mol（${r.result.sourceKind}）`);
						} catch (e) { setError(e.message); }
					} }, "算 MW"),
					h(Field, { label: "Mn/Mw/DP(JSON)", value: metricInput, onChange: setMetricInput, wide: true }),
					h("button", { className: "dshla-btn", onClick: async () => {
						try {
							const input = JSON.parse(metricInput);
							const r = await call("chem_metrics", { request: { input } });
							alert(Object.entries(r.metrics).map(([k, v]) => `${k} = ${v.value} ${v.unit}`).join("\n") || "无可用输入");
						} catch (e) { setError(e.message); }
					} }, "算指标")
				)
			});
		}

		function PlansTab({ call }) {
			const [id, setId] = useState("");
			const [title, setTitle] = useState("");
			return h(CrudPanel, {
				title: "实验计划（ExperimentPlan）",
				load: async () => (await call("chem_plans", { request: {} })).plans,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "title", label: "标题" },
					{ key: "objective", label: "目标" },
					{ key: "status", label: "状态", render: (r) => tag({ ok: r.status === "approved" }) },
					{ key: "safety", label: "安全项", render: (r) => (r.safety ?? []).length }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "id", value: id, onChange: setId }),
					h(Field, { label: "标题", value: title, onChange: setTitle, wide: true }),
					h("button", { className: "dshla-btn", onClick: async () => {
						try {
							if (!id) throw new Error("id 必填");
							const plan = {
								id, title: title || id, objective: "合成示例", scale: "1 g",
								reagents: [{ name: "试剂A", amount: "1 g" }],
								steps: [{ step: "s1", description: "示例步骤" }],
								measurementTable: [{ metric: "转化率", method: "NMR" }],
								safety: ["示例安全项"], characterization: ["NMR"]
							};
							await call("chem_plan_create", { request: { fields: plan } });
							setId(""); setTitle(""); setError("");
							await run();
						} catch (e) { setError(e.message); }
					} }, "创建示例")
				),
				actions: (run, setError) => h("button", { className: "dshla-btn", onClick: async () => {
					const target = prompt("计划 id：");
					if (!target) return;
					const status = prompt("流转到（under-review/approved/rejected）：");
					if (!status) return;
					try {
						const r = await call("chem_plan_status", { request: { id: target, status } });
						alert(`状态 → ${r.plan.status}`);
						await run();
					} catch (e) { setError(e.message); }
				} }, "流转状态")
			});
		}

		function NmrTab({ call }) {
			const [id, setId] = useState("");
			const [name, setName] = useState("");
			return h(CrudPanel, {
				title: "NMR 数据集（NmrDataset）",
				load: async () => (await call("nmr_list")).datasets,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "name", label: "名称" },
					{ key: "nucleus", label: "核" },
					{ key: "status", label: "状态", render: (r) => tag({ ok: r.status === "visually-verified" }) },
					{ key: "approvedIntegrals", label: "已审核积分", render: (r) => (r.approvedIntegrals ?? []).length },
					{ key: "results", label: "计算项", render: (r) => Object.keys(r.results ?? {}).join(", ") || "—" }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "id", value: id, onChange: setId }),
					h(Field, { label: "名称", value: name, onChange: setName, wide: true }),
					h("button", { className: "dshla-btn", "data-primary": "true", onClick: async () => {
						try {
							if (!id) throw new Error("id 必填");
							await call("nmr_create", { request: { fields: { id, name: name || id, fidPath: "(待登记)" } } });
							setId(""); setName(""); setError("");
							await run();
						} catch (e) { setError(e.message); }
					} }, "登记数据集")
				),
				actions: (run, setError) => h(Fragment, null,
					h("button", { className: "dshla-btn", onClick: async () => {
						const target = prompt("数据集 id：");
						if (!target) return;
						try {
							await call("nmr_integrals", { request: { id: target, integrals: [
								{ peak: "3.6", integral: 2, protons: 1, assignment: "O-CH2" },
								{ peak: "1.2", integral: 1, protons: 3, assignment: "end-group" }
							] } });
							alert("积分计划已提交（under-review）");
							await run();
						} catch (e) { setError(e.message); }
					} }, "提交示例积分"),
					h("button", { className: "dshla-btn", onClick: async () => {
						const target = prompt("数据集 id：");
						if (!target) return;
						const action = prompt("操作（approve/written/verify/reopen）：");
						if (!target || !action) return;
						try {
							const method = { approve: "nmr_approve", written: "nmr_written_back", verify: "nmr_verify", reopen: "nmr_reopen" }[action];
							if (!method) throw new Error("未知操作");
							const r = await call(method, { request: { id: target } });
							alert(`状态 → ${r.dataset.status}`);
							await run();
						} catch (e) { setError(e.message); }
					} }, "工作流操作")
				)
			});
		}

		function SynthesisTab({ call }) {
			const [routeId, setRouteId] = useState("");
			return h(CrudPanel, {
				title: "合成路线（SynthesisRoute）",
				load: async () => (await call("synth_routes", { request: {} })).routes,
				columns: [
					{ key: "id", label: "ID" },
					{ key: "name", label: "名称" },
					{ key: "targetId", label: "目标" },
					{ key: "steps", label: "步骤", render: (r) => (r.steps ?? []).length },
					{ key: "status", label: "状态", render: (r) => tag({ ok: r.status === "approved" }) }
				],
				form: (run, setError) => h(Fragment, null,
					h(Field, { label: "route id", value: routeId, onChange: setRouteId }),
					h("button", { className: "dshla-btn", onClick: async () => {
						try {
							const policy = await call("cas_policy");
							alert(`CAS 政策：autoAccess=${policy.policy.policy.autoAccess}, llmIngest=${policy.policy.policy.llmIngest}, 已授权=${policy.policy.authorizationGranted}`);
						} catch (e) { setError(e.message); }
					} }, "CAS 政策")
				),
				actions: (run, setError) => h(Fragment, null,
					h("button", { className: "dshla-btn", onClick: async () => {
						const target = prompt("route id：");
						if (!target) return;
						const status = prompt("流转到（under-review/approved/rejected）：");
						if (!status) return;
						try {
							const r = await call("synth_route_status", { request: { id: target, status } });
							alert(`状态 → ${r.route.status}`);
							await run();
						} catch (e) { setError(e.message); }
					} }, "流转状态"),
					h("button", { className: "dshla-btn", onClick: async () => {
						const target = prompt("route id：");
						if (!target) return;
						try {
							const r = await call("synth_evidence", { request: { id: target, query: target, want: ["compound"] } });
							alert(`开放数据证据 ${r.evidence.length} 条（最近：${r.evidence.slice(-1)[0]?.reference ?? "—"}）`);
						} catch (e) { setError(e.message); }
					} }, "收集证据")
				)
			});
		}

		function PythonTab({ call }) {
			const [state, setState] = useState(null);
			const [error, setError] = useState("");
			return h("div", null,
				h("div", { className: "dshla-section" },
					h("h2", null, "Python 环境（labPython）"),
					h("button", { className: "dshla-btn", onClick: async () => {
						try { setState(await call("python_preflight")); setError(""); } catch (e) { setError(e.message); }
					} }, "预检"),
					state ? h("pre", { className: "dshla-json" }, JSON.stringify(state.preflight, null, 2)) : null,
					error ? h("div", { className: "dshla-err" }, error) : null
				)
			);
		}

		// ── 主面板 ─────────────────────────────────────────────────────────
		const TABS = [
			["versions", "版本登记", VersionsTab],
			["goals", "精读目标", GoalsTab],
			["templates", "PPT模板", TemplatesTab],
			["tasks", "文献任务", TasksTab],
			["chemistry", "化学性质", ChemistryTab],
			["plans", "实验计划", PlansTab],
			["nmr", "NMR", NmrTab],
			["synthesis", "合成路线", SynthesisTab],
			["python", "Python", PythonTab]
		];

		function LabPanel({ call, onClose }) {
			const [tab, setTab] = useState("versions");
			const active = TABS.find(([id]) => id === tab);
			const TabComponent = active ? active[2] : VersionsTab;
			return ReactDOM.createPortal(
				h("div", { className: "dshla-overlay" },
					h("div", { className: "dshla-bar" },
						h("h1", null, "实验室 · dsh-lab-agent"),
						h("button", { className: "dshla-close", onClick: onClose }, "关闭")
					),
					h("div", { className: "dshla-body" },
						h("div", { className: "dshla-tabs" },
							TABS.map(([id, label]) => h("button", { key: id, className: "dshla-tab", "data-active": tab === id ? "true" : undefined, onClick: () => setTab(id) }, label))
						),
						h("div", { className: "dshla-content" }, h(TabComponent, { call }))
					)
				),
				document.body
			);
		}

		function LabEntry({ onOpen, wide }) {
			return h("button", { className: "dshla-sidebar-entry", onClick: onOpen, title: "实验室管理面板" },
				h("span", null, wide ? "实验室" : "🧪")
			);
		}

		// ── plugin body ─────────────────────────────────────────────────────
		function applyUi(ctx) {
			const call = async (method, args) => {
				const result = args === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](args);
				if (!result.ok) throw new Error(result.error?.message ?? result.error?.code ?? "remote call failed");
				return result.value;
			};

			// 面板挂载状态（模块级）
			let panelRoot = null;
			const openPanel = () => {
				if (panelRoot !== null) return;
				const root = document.createElement("div");
				document.body.appendChild(root);
				panelRoot = root;
				ReactDOM.render(h(LabPanel, {
					call,
					onClose: () => {
						ReactDOM.unmountComponentAtNode(root);
						root.remove();
						panelRoot = null;
					}
				}), root);
			};

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "lab-panel",
				order: 5
			}, (props) => h(LabEntry, { wide: props.wide, onOpen: openPanel })), "dsh-lab-agent: sidebar entry");

			ctx.on("dispose", () => {
				if (panelRoot !== null) {
					ReactDOM.unmountComponentAtNode(panelRoot);
					panelRoot.remove();
					panelRoot = null;
				}
			});
		}

		async function apply(ctx) {
			// 先挂载动态 namespace，再在声明了 remote.lab 的子 Fiber 中启动 UI。
			await ctx.remote.$mount({ package: "dsh-lab-agent", descriptors });
			ctx.inject(["remote", "remote.lab", "slots"], applyUi);
		}

		exports.apply = apply;
		exports.inject = ["remote"];
		return module.exports;
	}
});
