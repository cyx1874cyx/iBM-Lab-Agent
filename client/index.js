/**
 * dsh-lab-agent: Web client plugin（手写 CJS bundle，兼容 kernel 模块加载器）。
 *
 * - $mount "lab" Remote（调用 host 侧 ctx.lab 聚合服务，ctx.remote.lab.*）；
 * - 侧边栏 sidebar.footer.action 注册"实验室"入口；
 * - 点击打开 iBM Research Workspace（React portal，React 18 legacy render）；
 * - 项目化总览 + 文献/实验/数据/成果/系统分组导航，保留全部既有管理能力。
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
			":root{--dshla-bg:#07110f;--dshla-panel:#0d1a17;--dshla-panel-2:#11231f;--dshla-line:rgba(151,202,185,.14);--dshla-text:#eef8f4;--dshla-muted:#8ca79e;--dshla-green:#55d6a4;--dshla-cyan:#63d8e8;--dshla-amber:#f2c66d}",
			".dshla-overlay{position:fixed;inset:0;z-index:1000;background:radial-gradient(circle at 72% -12%,rgba(49,164,136,.18),transparent 34%),var(--dshla-bg);display:grid;grid-template-columns:244px minmax(0,1fr);color:var(--dshla-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
			".dshla-rail{min-height:0;border-right:1px solid var(--dshla-line);background:linear-gradient(180deg,rgba(13,31,27,.96),rgba(7,17,15,.98));display:flex;flex-direction:column;padding:22px 14px 14px}",
			".dshla-brand{display:flex;align-items:center;gap:11px;padding:0 8px 22px}",
			".dshla-mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,var(--dshla-green),#228f73);color:#052019;font-weight:900;box-shadow:0 10px 30px rgba(85,214,164,.2)}",
			".dshla-brand-name{font-size:14px;font-weight:750;letter-spacing:.01em}.dshla-brand-sub{color:var(--dshla-muted);font-size:10px;margin-top:2px;letter-spacing:.08em;text-transform:uppercase}",
			".dshla-nav{overflow:auto;padding-right:2px}.dshla-nav-group{margin:2px 0 17px}.dshla-nav-label{padding:0 10px 6px;color:#617d74;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}",
			".dshla-tab{display:flex;width:100%;align-items:center;gap:10px;text-align:left;border:0;background:none;color:#9bb4ac;cursor:pointer;padding:9px 10px;font-size:12.5px;border-radius:9px;margin:1px 0;transition:background .16s,color .16s,transform .16s}",
			".dshla-tab:hover{background:rgba(112,207,176,.07);color:#d8ebe4;transform:translateX(1px)}",
			".dshla-tab[data-active=true]{color:#f4fffb;background:linear-gradient(90deg,rgba(85,214,164,.17),rgba(85,214,164,.06));box-shadow:inset 2px 0 var(--dshla-green)}",
			".dshla-nav-icon{width:21px;height:21px;border-radius:7px;background:rgba(255,255,255,.045);display:grid;place-items:center;font-size:10px;color:#87b6a7}.dshla-tab[data-active=true] .dshla-nav-icon{background:rgba(85,214,164,.16);color:var(--dshla-green)}",
			".dshla-rail-footer{margin-top:auto;border:1px solid var(--dshla-line);background:rgba(255,255,255,.025);border-radius:12px;padding:11px}.dshla-rail-status{display:flex;align-items:center;gap:7px;font-size:11px}.dshla-dot{width:7px;height:7px;border-radius:50%;background:var(--dshla-green);box-shadow:0 0 12px rgba(85,214,164,.7)}.dshla-rail-note{color:#718d84;font-size:9.5px;line-height:1.5;margin-top:6px}",
			".dshla-shell{min-width:0;min-height:0;display:flex;flex-direction:column}.dshla-topbar{height:66px;flex:none;border-bottom:1px solid var(--dshla-line);display:flex;align-items:center;gap:14px;padding:0 25px;background:rgba(7,17,15,.72);backdrop-filter:blur(18px)}",
			".dshla-breadcrumb{min-width:0;flex:1}.dshla-breadcrumb-over{font-size:9.5px;color:#67837a;letter-spacing:.12em;text-transform:uppercase}.dshla-breadcrumb-title{font-size:14px;font-weight:650;margin-top:2px}",
			".dshla-trust{display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--dshla-line);border-radius:999px;color:#91afa5;font-size:10.5px;background:rgba(255,255,255,.025)}.dshla-trust strong{color:#d7eee6;font-weight:600}",
			".dshla-close{cursor:pointer;border:1px solid var(--dshla-line);background:rgba(255,255,255,.035);color:#bdd2cb;border-radius:9px;padding:7px 11px;font-size:11px}.dshla-close:hover{border-color:rgba(85,214,164,.35);color:white}",
			".dshla-content{flex:1;min-width:0;min-height:0;overflow:auto;padding:25px 28px 40px}.dshla-content-inner{max-width:1340px;margin:0 auto}",
			".dshla-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:0 0 20px}.dshla-page-kicker{color:var(--dshla-green);font-size:9.5px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}.dshla-page-head h1{font-size:24px;letter-spacing:-.025em;margin:5px 0 4px}.dshla-page-head p{color:var(--dshla-muted);font-size:12px;margin:0;max-width:660px;line-height:1.6}",
			".dshla-hero{position:relative;overflow:hidden;border:1px solid var(--dshla-line);border-radius:18px;background:linear-gradient(125deg,rgba(21,52,44,.94),rgba(12,29,25,.86));padding:25px 27px;margin-bottom:16px}.dshla-hero:after{content:'';position:absolute;width:240px;height:240px;border-radius:50%;right:-60px;top:-120px;background:radial-gradient(circle,rgba(99,216,232,.18),transparent 68%)}",
			".dshla-hero-eyebrow{font-size:9.5px;color:var(--dshla-cyan);font-weight:750;letter-spacing:.14em;text-transform:uppercase}.dshla-hero h2{font-size:24px;max-width:620px;line-height:1.2;letter-spacing:-.03em;margin:9px 0 8px}.dshla-hero p{position:relative;z-index:1;color:#99b9ae;font-size:12px;line-height:1.65;max-width:690px;margin:0}.dshla-hero-actions{display:flex;gap:8px;margin-top:18px}",
			".dshla-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin:0 0 16px}.dshla-metric{border:1px solid var(--dshla-line);background:rgba(13,28,24,.76);border-radius:14px;padding:15px 16px}.dshla-metric-label{font-size:10px;color:#718f85}.dshla-metric-value{font-size:25px;font-weight:720;letter-spacing:-.03em;margin:5px 0 2px}.dshla-metric-detail{font-size:9.5px;color:#5f7e74}.dshla-metric-detail[data-tone=warn]{color:var(--dshla-amber)}",
			".dshla-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,.8fr);gap:14px}.dshla-card{border:1px solid var(--dshla-line);background:rgba(11,25,22,.78);border-radius:15px;padding:17px}.dshla-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.dshla-card-title{font-size:12.5px;font-weight:650}.dshla-card-note{font-size:9.5px;color:#638078}",
			".dshla-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.dshla-flow-step{position:relative;border:1px solid rgba(151,202,185,.1);border-radius:12px;background:rgba(255,255,255,.02);padding:12px;min-height:92px}.dshla-flow-num{color:var(--dshla-green);font-size:9px;font-weight:800}.dshla-flow-name{font-size:11.5px;font-weight:620;margin:8px 0 4px}.dshla-flow-desc{font-size:9.5px;color:#6f8b82;line-height:1.45}",
			".dshla-quick{display:grid;gap:7px}.dshla-quick button{width:100%;display:flex;align-items:center;justify-content:space-between;text-align:left;border:1px solid rgba(151,202,185,.1);border-radius:10px;background:rgba(255,255,255,.02);color:#b7cec6;padding:10px 11px;cursor:pointer;font-size:10.5px}.dshla-quick button:hover{border-color:rgba(85,214,164,.3);background:rgba(85,214,164,.06)}",
			".dshla-section{margin-bottom:18px}.dshla-section h2{font-size:13px;font-weight:650;margin:0 0 9px}.dshla-table-wrap{border:1px solid var(--dshla-line);border-radius:13px;overflow:auto;background:rgba(11,25,22,.6)}",
			".dshla-table{width:100%;border-collapse:collapse;font-size:11.5px}.dshla-table th,.dshla-table td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(151,202,185,.09);vertical-align:top}.dshla-table tr:last-child td{border-bottom:0}.dshla-table th{color:#69857c;font-weight:650;font-size:9px;text-transform:uppercase;letter-spacing:.08em;background:rgba(255,255,255,.018)}.dshla-table tr:hover td{background:rgba(85,214,164,.025)}",
			".dshla-form{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;align-items:center}.dshla-form input,.dshla-form select,.dshla-form textarea{border:1px solid var(--dshla-line);background:#0c1b17;color:inherit;border-radius:9px;padding:7px 10px;font-size:11.5px;font-family:inherit;outline:none}.dshla-form input:focus,.dshla-form textarea:focus{border-color:rgba(85,214,164,.45)}.dshla-form input{width:150px}.dshla-form input[data-wide]{width:280px}",
			".dshla-btn{cursor:pointer;border:1px solid var(--dshla-line);background:rgba(255,255,255,.035);color:#d1e5de;border-radius:9px;padding:7px 11px;font-size:11.5px}.dshla-btn:hover{background:rgba(85,214,164,.08);border-color:rgba(85,214,164,.28)}.dshla-btn[data-primary]{background:linear-gradient(135deg,#3abf91,#267f69);border-color:transparent;color:#f4fffb;box-shadow:0 8px 22px rgba(42,164,126,.16)}",
			".dshla-err{color:#ff8585;font-size:11px;margin:7px 0;white-space:pre-wrap}.dshla-meta{color:#6f8b82;font-size:10.5px}.dshla-status{display:inline-block;border-radius:999px;padding:2px 8px;font-size:9.5px}.dshla-status[data-s=ok]{background:rgba(85,214,164,.12);color:#6ee3b6}.dshla-status[data-s=warn]{background:rgba(242,198,109,.12);color:#f2c66d}.dshla-status[data-s=err]{background:rgba(255,104,104,.12);color:#ff8585}",
			".dshla-sidebar-entry{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;padding:7px 10px;font-size:13px;border-radius:8px}.dshla-sidebar-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}.dshla-sidebar-glyph{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:linear-gradient(145deg,#55d6a4,#26876d);color:#052019;font-size:9px;font-weight:900}",
			".dshla-json{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10.5px;color:#91aaa2;white-space:pre-wrap;max-height:240px;overflow:auto}.dshla-empty{padding:22px;text-align:center;color:#648078;font-size:10.5px}",
			"@media(max-width:980px){.dshla-overlay{grid-template-columns:190px minmax(0,1fr)}.dshla-metrics{grid-template-columns:repeat(2,1fr)}.dshla-grid{grid-template-columns:1fr}.dshla-flow{grid-template-columns:repeat(2,1fr)}.dshla-trust{display:none}}",
			"@media(max-width:680px){.dshla-overlay{grid-template-columns:66px minmax(0,1fr)}.dshla-brand-copy,.dshla-nav-label,.dshla-tab-label,.dshla-rail-footer{display:none}.dshla-brand{padding-left:0;padding-right:0;justify-content:center}.dshla-tab{justify-content:center;padding:9px}.dshla-content{padding:18px 14px}.dshla-topbar{padding:0 14px}.dshla-metrics{grid-template-columns:1fr 1fr}.dshla-flow{grid-template-columns:1fr}.dshla-page-head h1,.dshla-hero h2{font-size:20px}}"
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
			direct("convert_upload", ["request"]), direct("convert_available"), direct("convert_runs"),
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
			if (!rows || rows.length === 0) return h("div", { className: "dshla-empty" }, empty);
			return h("div", { className: "dshla-table-wrap" },
				h("table", { className: "dshla-table" },
					h("thead", null, h("tr", null, columns.map((c) => h("th", { key: c.key }, c.label)))),
					h("tbody", null, rows.map((row, i) => h("tr", { key: row.id ?? i }, columns.map((c) => h("td", { key: c.key }, c.render ? c.render(row) : fmt(row[c.key]))))))
				)
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

		function ConvertTab({ call }) {
			const [file, setFile] = useState(null);
			const [text, setText] = useState("");
			const [error, setError] = useState("");
			const [available, setAvailable] = useState(null);
			const [busy, setBusy] = useState(false);
			useEffect(() => {
				call("convert_available").then((r) => setAvailable(r.available)).catch(() => setAvailable(null));
			}, []);
			const onConvert = async () => {
				if (!file) { setError("请先选择文件"); return; }
				setBusy(true); setError("");
				try {
					const base64 = await new Promise((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(String(reader.result).split(",")[1]);
						reader.onerror = reject;
						reader.readAsDataURL(file);
					});
					const r = await call("convert_upload", { request: { name: file.name, base64 } });
					setText(r.result.text);
				} catch (e) { setError(e.message); } finally { setBusy(false); }
			};
			return h("div", null,
				h("div", { className: "dshla-section" },
					h("h2", null, "文档转 Markdown（markitdown）"),
					h("div", { className: "dshla-form" },
						h("input", { type: "file", accept: ".docx,.pptx,.xlsx,.pdf,.md,.txt,.html,.jpg,.png", onChange: (e) => { setFile(e.target.files[0] || null); setText(""); } }),
						h("button", { className: "dshla-btn", "data-primary": "true", onClick: onConvert, disabled: busy }, busy ? "转换中…" : "转换"),
						available === false ? h("span", { className: "dshla-meta" }, "（markitdown 未安装：python -m pip install markitdown）") : null
					),
					error ? h("div", { className: "dshla-err" }, error) : null
				),
				text ? h("div", { className: "dshla-section" },
					h("h2", null, "Markdown 输出"),
					h("pre", { className: "dshla-json", style: { maxHeight: "50vh" } }, text)
				) : null
			);
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

		// ── 品牌化科研工作台 ────────────────────────────────────────────────
		const badge = (label, tone = "warn") => h("span", { className: "dshla-status", "data-s": tone }, label);
		const settledValue = (result, fallback) => result?.status === "fulfilled" ? result.value : fallback;

		function OverviewTab({ call, onNavigate }) {
			const [state, setState] = useState({ loading: true, error: "", data: {} });
			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: "" }));
				const results = await Promise.allSettled([
					call("projects_list"),
					call("chem_entities", { request: {} }),
					call("chem_plans", { request: {} }),
					call("nmr_list"),
					call("synth_routes", { request: {} }),
					call("versions_list"),
					call("convert_available")
				]);
				const failed = results.filter((result) => result.status === "rejected");
				setState({
					loading: false,
					error: failed.length === results.length ? "工作台数据暂时不可用，请检查实验室服务。" : "",
					data: {
						projects: settledValue(results[0], { projects: [] }).projects ?? [],
						entities: settledValue(results[1], { entities: [] }).entities ?? [],
						plans: settledValue(results[2], { plans: [] }).plans ?? [],
						nmr: settledValue(results[3], { datasets: [] }).datasets ?? [],
						routes: settledValue(results[4], { routes: [] }).routes ?? [],
						versions: settledValue(results[5], { rows: [] }).rows ?? [],
						convertAvailable: settledValue(results[6], { available: false }).available === true
					}
				});
			}, []);
			useEffect(() => { void load(); }, [load]);

			const data = state.data;
			const projects = data.projects ?? [];
			const activeProjects = projects.filter((item) => item.status === "active");
			const reviewCount = (data.plans ?? []).filter((item) => item.status === "under-review").length
				+ (data.nmr ?? []).filter((item) => item.status === "under-review").length
				+ (data.routes ?? []).filter((item) => item.status === "under-review").length;
			const researchAssets = (data.entities ?? []).length + (data.nmr ?? []).length;
			const recentProjects = [...projects].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, 5);
			const metrics = [
				["活跃项目", state.loading ? "…" : activeProjects.length, `${projects.length} 个项目已登记`, ""],
				["研究数据资产", state.loading ? "…" : researchAssets, `${(data.entities ?? []).length} 个化学实体 · ${(data.nmr ?? []).length} 组 NMR`, ""],
				["待人工审核", state.loading ? "…" : reviewCount, reviewCount > 0 ? "需要研究人员确认" : "当前没有待办", reviewCount > 0 ? "warn" : ""],
				["能力版本", state.loading ? "…" : (data.versions ?? []).length, data.convertAvailable ? "文档转换可用" : "核心 Skill 已固定", ""]
			];

			return h("div", null,
				h("div", { className: "dshla-hero" },
					h("div", { className: "dshla-hero-eyebrow" }, "iBM Research Copilot"),
					h("h2", null, activeProjects[0]?.name ? `继续推进：${activeProjects[0].name}` : "把科研过程变成可追溯的工作流"),
					h("p", null, "从文献证据到实验方案、表征数据与组会汇报，每一步保留来源、版本和人工审核状态。Agent 负责整理和执行，关键科研判断始终由研究人员确认。"),
					h("div", { className: "dshla-hero-actions" },
						h("button", { className: "dshla-btn", "data-primary": "true", onClick: () => onNavigate("tasks") }, "进入文献项目"),
						h("button", { className: "dshla-btn", onClick: () => onNavigate("goals") }, "配置精读目标")
					)
				),
				state.error ? h("div", { className: "dshla-err" }, state.error) : null,
				h("div", { className: "dshla-metrics" }, metrics.map(([label, value, detail, tone]) =>
					h("div", { className: "dshla-metric", key: label },
						h("div", { className: "dshla-metric-label" }, label),
						h("div", { className: "dshla-metric-value" }, value),
						h("div", { className: "dshla-metric-detail", "data-tone": tone || undefined }, detail)
					)
				)),
				h("div", { className: "dshla-grid" },
					h("div", { className: "dshla-card" },
						h("div", { className: "dshla-card-head" },
							h("div", { className: "dshla-card-title" }, "科研交付流程"),
							h("div", { className: "dshla-card-note" }, "证据与审核贯穿全流程")
						),
						h("div", { className: "dshla-flow" }, [
							["01", "检索与筛选", "多源文献检索、去重与来源登记"],
							["02", "精读与审计", "结构化 Paper Card 与原文定位"],
							["03", "实验与表征", "方案、性质、NMR 和人工门禁"],
							["04", "汇报与归档", "模板化 PPT、质量检查与溯源"]
						].map(([num, name, desc]) => h("div", { className: "dshla-flow-step", key: num },
							h("div", { className: "dshla-flow-num" }, num),
							h("div", { className: "dshla-flow-name" }, name),
							h("div", { className: "dshla-flow-desc" }, desc)
						)))
					),
					h("div", { className: "dshla-card" },
						h("div", { className: "dshla-card-head" }, h("div", { className: "dshla-card-title" }, "快速入口")),
						h("div", { className: "dshla-quick" }, [
							["文档转 Markdown", "convert"], ["化学性质计算", "chemistry"], ["NMR 工作流", "nmr"], ["实验方案审核", "plans"]
						].map(([label, target]) => h("button", { key: target, onClick: () => onNavigate(target) }, h("span", null, label), h("span", null, "→"))))
					)
				),
				h("div", { className: "dshla-card", style: { marginTop: "14px" } },
					h("div", { className: "dshla-card-head" },
						h("div", { className: "dshla-card-title" }, "最近项目"),
						h("button", { className: "dshla-btn", onClick: () => void load() }, state.loading ? "同步中…" : "同步数据")
					),
					h(Table, {
						rows: recentProjects,
						empty: "尚未创建项目。先配置精读目标和 PPT 模板，再建立第一个研究项目。",
						columns: [
							{ key: "name", label: "项目" },
							{ key: "goal", label: "精读目标", render: (row) => `${row.goalProfile?.id ?? "—"}@${row.goalProfile?.version ?? "—"}` },
							{ key: "template", label: "汇报模板", render: (row) => row.template?.id ?? "—" },
							{ key: "updatedAt", label: "最近更新", render: (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—" },
							{ key: "status", label: "状态", render: (row) => badge(row.status === "active" ? "进行中" : "已归档", row.status === "active" ? "ok" : "warn") }
						]
					})
				)
			);
		}

		const NAV_GROUPS = [
			{ label: "Research", items: [
				{ id: "overview", label: "工作台总览", icon: "OV", component: OverviewTab, description: "项目状态、待审核任务和研究资产概览" },
				{ id: "tasks", label: "文献项目", icon: "LI", component: TasksTab, description: "管理从检索、精读到汇报的研究项目" },
				{ id: "goals", label: "精读目标", icon: "GO", component: GoalsTab, description: "配置不同课题所关注的问题与证据要求" }
			] },
			{ label: "Experiment & Data", items: [
				{ id: "chemistry", label: "化学性质", icon: "CH", component: ChemistryTab, description: "化学实体、来源化性质和聚合物指标计算" },
				{ id: "plans", label: "实验计划", icon: "EX", component: PlansTab, description: "生成并人工审核实验方案、安全项和表征要求" },
				{ id: "nmr", label: "NMR 分析", icon: "NM", component: NmrTab, description: "积分方案、人工确认和聚合物指标计算" },
				{ id: "synthesis", label: "合成路线", icon: "SY", component: SynthesisTab, description: "开放证据支持的合成路线与审核状态" }
			] },
			{ label: "Outputs", items: [
				{ id: "templates", label: "汇报模板", icon: "PT", component: TemplatesTab, description: "课题组 PPT 模板、版式角色和质量校验" },
				{ id: "convert", label: "文档处理", icon: "MD", component: ConvertTab, description: "将论文和 Office 文件转换为可分析的 Markdown" }
			] },
			{ label: "System", items: [
				{ id: "versions", label: "能力版本", icon: "VS", component: VersionsTab, description: "固定并核验 Nature Skills 版本与回归状态" },
				{ id: "python", label: "运行环境", icon: "PY", component: PythonTab, description: "检查本地 Python 与科研工具运行环境" }
			] }
		];
		const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

		function LabPanel({ call, onClose }) {
			const [tab, setTab] = useState("overview");
			const active = NAV_ITEMS.find((item) => item.id === tab) ?? NAV_ITEMS[0];
			const TabComponent = active.component;
			return ReactDOM.createPortal(
				h("div", { className: "dshla-overlay", role: "dialog", "aria-label": "iBM Research Workspace" },
					h("aside", { className: "dshla-rail" },
						h("div", { className: "dshla-brand" },
							h("div", { className: "dshla-mark" }, "iB"),
							h("div", { className: "dshla-brand-copy" },
								h("div", { className: "dshla-brand-name" }, "iBM Lab Agent"),
								h("div", { className: "dshla-brand-sub" }, "Research Workspace")
							)
						),
						h("nav", { className: "dshla-nav", "aria-label": "科研工作台导航" }, NAV_GROUPS.map((group) =>
							h("div", { className: "dshla-nav-group", key: group.label },
								h("div", { className: "dshla-nav-label" }, group.label),
								group.items.map((item) => h("button", {
									key: item.id,
									className: "dshla-tab",
									"data-active": tab === item.id ? "true" : undefined,
									onClick: () => setTab(item.id),
									title: item.label
								}, h("span", { className: "dshla-nav-icon" }, item.icon), h("span", { className: "dshla-tab-label" }, item.label)))
							)
						)),
						h("div", { className: "dshla-rail-footer" },
							h("div", { className: "dshla-rail-status" }, h("span", { className: "dshla-dot" }), h("span", null, "本地服务已连接")),
							h("div", { className: "dshla-rail-note" }, "原始文件默认保存在本机；关键科研结果需人工审核。")
						)
					),
					h("main", { className: "dshla-shell" },
						h("header", { className: "dshla-topbar" },
							h("div", { className: "dshla-breadcrumb" }, h("div", { className: "dshla-breadcrumb-over" }, "iBM / Workspace"), h("div", { className: "dshla-breadcrumb-title" }, active.label)),
							h("div", { className: "dshla-trust" }, h("span", { className: "dshla-dot" }), h("span", null, "数据边界"), h("strong", null, "本地优先")),
							h("div", { className: "dshla-trust" }, h("span", null, "✓"), h("strong", null, "人工审核门禁")),
							h("button", { className: "dshla-close", onClick: onClose, "aria-label": "关闭科研工作台" }, "返回 Harness")
						),
						h("div", { className: "dshla-content" }, h("div", { className: "dshla-content-inner" },
							tab === "overview" ? null : h("div", { className: "dshla-page-head" }, h("div", null,
								h("div", { className: "dshla-page-kicker" }, "Research Module"),
								h("h1", null, active.label),
								h("p", null, active.description)
							)),
							h(TabComponent, { call, onNavigate: setTab })
						))
					)
				),
				document.body
			);
		}

		function LabEntry({ onOpen, wide }) {
			return h("button", { className: "dshla-sidebar-entry", onClick: onOpen, title: "打开 iBM Research Workspace" },
				h("span", { className: "dshla-sidebar-glyph" }, "iB"),
				wide ? h("span", null, "iBM 科研工作台") : null
			);
		}

		// ── plugin body ─────────────────────────────────────────────────────
		function applyUi(ctx) {
			const call = async (method, args) => {
				// 兼容两种调用形式：裸参数 {name, base64} 或历史包装 {request: {...}}
				const payload = args !== undefined && args !== null && typeof args === "object" && !Array.isArray(args)
					&& Object.keys(args).length === 1 && "request" in args ? args.request : args;
				const result = payload === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
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
