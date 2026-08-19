/** iBM Lab Agent — project-first Harness client. */
window.__ModuleLoader__.load({
	id: "dsh-lab-agent",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");
		const { useState, useEffect, useCallback } = React;
		const h = React.createElement;

		const css = [
			":root{--ib-bg:#06110f;--ib-panel:#0c1d19;--ib-panel2:#102720;--ib-line:rgba(129,205,178,.16);--ib-text:#eff9f5;--ib-muted:#88a69b;--ib-green:#51d4a3;--ib-cyan:#73dce6;--ib-red:#ff8989}",
			".ib-overlay{position:fixed;inset:0;z-index:1000;overflow:auto;background:radial-gradient(circle at 80% -10%,rgba(64,182,145,.18),transparent 32%),var(--ib-bg);color:var(--ib-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
			".ib-top{height:68px;position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid var(--ib-line);background:rgba(6,17,15,.9);backdrop-filter:blur(18px)}",
			".ib-brand{display:flex;align-items:center;gap:11px;min-width:230px}.ib-logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,var(--ib-green),#238e72);color:#062018;font-weight:900;box-shadow:0 9px 28px rgba(81,212,163,.18)}.ib-brand strong{font-size:14px}.ib-brand small{display:block;margin-top:2px;color:#78978c;font-size:9px;letter-spacing:.12em;text-transform:uppercase}.ib-crumb{flex:1;color:#8ea99f;font-size:11px}.ib-crumb b{color:#e8f7f1}",
			".ib-main{max-width:1260px;margin:0 auto;padding:36px 28px 70px}.ib-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:26px}.ib-kicker{color:var(--ib-green);font-size:9.5px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.ib-head h1{font-size:30px;line-height:1.16;letter-spacing:-.035em;margin:8px 0}.ib-head p{max-width:690px;color:var(--ib-muted);font-size:12.5px;line-height:1.7;margin:0}",
			".ib-btn{border:1px solid var(--ib-line);background:rgba(255,255,255,.035);color:#d5e9e1;border-radius:10px;padding:9px 13px;cursor:pointer;font-size:11.5px}.ib-btn:hover{border-color:rgba(81,212,163,.36);background:rgba(81,212,163,.07)}.ib-btn[data-primary]{border-color:transparent;background:linear-gradient(135deg,#41c797,#27866d);color:white;box-shadow:0 10px 25px rgba(36,151,113,.19)}.ib-btn:disabled{opacity:.45;cursor:not-allowed}.ib-actions{display:flex;gap:8px;flex-wrap:wrap}",
			".ib-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.ib-project{position:relative;min-height:190px;border:1px solid var(--ib-line);background:linear-gradient(145deg,rgba(15,38,32,.94),rgba(9,25,21,.88));border-radius:17px;padding:19px;cursor:pointer;text-align:left;color:inherit;transition:.18s}.ib-project:hover{transform:translateY(-2px);border-color:rgba(81,212,163,.38)}.ib-project-icon{width:38px;height:38px;border-radius:12px;background:rgba(81,212,163,.12);color:var(--ib-green);display:grid;place-items:center;font-weight:800}.ib-project h2{font-size:16px;margin:24px 0 6px}.ib-project p{font-size:10.5px;color:#76948a;line-height:1.55;margin:0}.ib-project-foot{position:absolute;left:19px;right:19px;bottom:17px;display:flex;justify-content:space-between;color:#648279;font-size:9.5px}",
			".ib-card{border:1px solid var(--ib-line);background:rgba(11,29,24,.83);border-radius:16px;padding:17px}.ib-form{margin-bottom:18px}.ib-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.ib-field{display:grid;gap:6px}.ib-field[data-wide]{grid-column:1/-1}.ib-field label{font-size:10px;color:#78958b}.ib-field input,.ib-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:#071611;color:var(--ib-text);border-radius:10px;padding:10px 11px;font:11.5px inherit;outline:none}.ib-field textarea{min-height:180px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.55}.ib-field input:focus,.ib-field textarea:focus{border-color:rgba(81,212,163,.48)}.ib-form-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.ib-error{color:var(--ib-red);font-size:10.5px;margin:10px 0;white-space:pre-wrap}.ib-empty{border:1px dashed rgba(129,205,178,.23);border-radius:17px;padding:50px 24px;text-align:center;color:#739087}",
			".ib-project-head{display:flex;align-items:center;gap:13px;margin-bottom:20px}.ib-project-copy{flex:1;min-width:0}.ib-project-copy h1{font-size:24px;margin:0 0 4px;letter-spacing:-.025em}.ib-project-copy p{font-size:10.5px;color:#78978c;margin:0}.ib-agent{display:flex;align-items:center;gap:8px}.ib-spark{width:23px;height:23px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.15)}",
			".ib-memory{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:14px;margin-bottom:17px}.ib-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.ib-card-title{font-size:12.5px;font-weight:680}.ib-chip{border-radius:999px;background:rgba(81,212,163,.1);color:#6ee3b5;padding:3px 8px;font-size:9px}.ib-memory textarea{width:100%;min-height:230px;box-sizing:border-box;resize:vertical;border:1px solid rgba(129,205,178,.12);background:#071611;color:#cfe3db;border-radius:11px;padding:13px;font:10.5px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.ib-save{display:flex;gap:8px;margin-top:9px}.ib-save input{flex:1;min-width:0;border:1px solid var(--ib-line);background:#071611;color:inherit;border-radius:9px;padding:8px 10px;font-size:10.5px;outline:none}.ib-help{color:#78958b;font-size:10.5px;line-height:1.65}.ib-help strong{display:block;color:#d6e9e2;font-size:11.5px;margin-bottom:7px}.ib-history{margin-top:12px;display:grid;gap:7px}.ib-version{border-top:1px solid rgba(129,205,178,.1);padding-top:8px;display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:#78958b}.ib-version b{color:#bed5cc}",
			".ib-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}.ib-tab{border:1px solid var(--ib-line);background:rgba(255,255,255,.02);color:#9db8ae;border-radius:13px;padding:13px;text-align:left;cursor:pointer}.ib-tab[data-active=true]{border-color:rgba(81,212,163,.4);background:linear-gradient(125deg,rgba(81,212,163,.13),rgba(115,220,230,.04));color:white}.ib-tab strong{display:block;font-size:12px;margin-bottom:4px}.ib-tab span{font-size:9.5px;color:#718f85}",
			".ib-board{border:1px solid var(--ib-line);background:rgba(10,26,22,.7);border-radius:16px;padding:17px}.ib-board-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.ib-board-head h2{font-size:14px;margin:0}.ib-board-head p{font-size:9.5px;color:#6f8d83;margin:3px 0 0}.ib-artifacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ib-artifact{border:1px solid rgba(129,205,178,.11);background:rgba(255,255,255,.018);border-radius:12px;padding:13px;min-height:112px}.ib-artifact-top{display:flex;justify-content:space-between;align-items:center}.ib-artifact h3{font-size:11.5px;margin:0}.ib-count{font-size:19px;font-weight:720;color:var(--ib-green)}.ib-rows{display:grid;gap:6px;margin-top:10px}.ib-row{display:flex;justify-content:space-between;gap:9px;font-size:9.5px;color:#8ba69c}.ib-row b{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c8ddd5;font-weight:520}.ib-row span{flex:none;color:#78978c}.ib-artifact-empty{margin-top:15px;color:#627f75;font-size:9.5px;line-height:1.55}.ib-toast{position:fixed;right:24px;bottom:24px;border:1px solid rgba(81,212,163,.27);background:#102a22;border-radius:12px;padding:11px 14px;font-size:10.5px;box-shadow:0 12px 35px rgba(0,0,0,.3)}",
			".ib-sidebar{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;padding:7px 10px;font-size:13px;border-radius:8px}.ib-sidebar:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}.ib-sidebar-logo{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:linear-gradient(145deg,#55d6a4,#26876d);color:#052019;font-size:9px;font-weight:900}",
			".ib-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(129,205,178,.22);background:rgba(81,212,163,.09);color:#bde6d6;border-radius:999px;padding:5px 11px;font-size:10px;cursor:pointer;line-height:1.4}.ib-badge:hover{border-color:rgba(81,212,163,.45);background:rgba(81,212,163,.15)}.ib-badge-mark{color:var(--ib-green);font-size:9px;font-weight:800}.ib-badge b{color:#e6f7f0;font-weight:650}.ib-badge small{color:#7fa396}",
			".ib-hint{display:flex;align-items:center;gap:8px;color:#86a79b;font-size:10px;padding:4px 2px;line-height:1.5}.ib-hint b{color:#cfe5dc;font-weight:620}.ib-hint button{margin-left:auto;border:1px solid rgba(129,205,178,.2);background:rgba(255,255,255,.03);color:#a9c8bd;border-radius:8px;padding:3px 9px;font-size:9.5px;cursor:pointer}.ib-hint button:hover{border-color:rgba(81,212,163,.4);color:#e0f2ea}",
			"@media(max-width:900px){.ib-grid{grid-template-columns:repeat(2,1fr)}.ib-memory{grid-template-columns:1fr}.ib-artifacts{grid-template-columns:1fr}}@media(max-width:620px){.ib-top{padding:0 14px}.ib-brand{min-width:auto}.ib-brand div:last-child,.ib-crumb{display:none}.ib-main{padding:25px 14px 55px}.ib-head{align-items:flex-start;flex-direction:column}.ib-grid,.ib-tabs,.ib-form-grid{grid-template-columns:1fr}.ib-head h1{font-size:24px}.ib-project-head{flex-wrap:wrap}.ib-agent{width:100%;justify-content:center}}",
			// ── 品牌覆盖：左上角 iBM Agent（烧瓶 + based on DSH，配色与课题面板一致）──
			".ib-brand-shell{display:flex;align-items:center;gap:10px;min-width:0}.ib-brand-flask{width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;background:linear-gradient(145deg,#51d4a3,#238e72);box-shadow:0 6px 18px rgba(81,212,163,.2)}.ib-brand-flask svg{width:18px;height:18px}.ib-brand-text{min-width:0}.ib-brand-text b{display:block;color:var(--dsw-alias-label-primary,#eff9f5);font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.1;white-space:nowrap}.ib-brand-text small{display:block;color:var(--dsw-alias-label-tertiary,#88a69b);font-size:8.5px;letter-spacing:.13em;text-transform:uppercase;margin-top:2px;white-space:nowrap}",
			"[class*='_toggle']{position:relative}.ib-rail-flask{position:absolute;inset:0;margin:auto;width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:linear-gradient(145deg,#51d4a3,#238e72);box-shadow:0 4px 12px rgba(81,212,163,.18)}.ib-rail-flask svg{width:13px;height:13px}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=dsh-lab-agent]") === null) {
			const style = document.createElement("style");
			style.dataset.pluginCss = "dsh-lab-agent";
			style.textContent = css;
			document.head.appendChild(style);
		}

		const pass = { parse: (value) => value };
		const strict = (symbol) => ({ mode: "strict", typeSymbol: symbol, schema: pass });
		const direct = (method, params = []) => ({ id: `dsh-lab-agent#lab/${method}`, service: "lab", namespace: "lab", method, invocation: { kind: "direct" }, parameters: params.map((wire) => ({ name: wire, wire, source: "json", codec: strict(`dsh-lab-agent#lab/${method}:${wire}`) })), result: strict(`dsh-lab-agent#lab/${method}:result`) });
		const descriptors = [
			...["versions_list", "goals_list", "templates_list", "nmr_list", "convert_available", "convert_runs", "python_preflight", "cas_policy", "cas_login_entry"].map((name) => direct(name)),
			...["versions_resolve", "goals_resolve", "goals_create", "goals_update", "goals_copy", "goals_delete", "goals_requirements", "templates_resolve", "templates_preview", "templates_validate", "projects_create", "projects_get", "projects_bind_workspace", "projects_bind_session", "projects_binding", "projects_by_session", "projects_by_workspace", "projects_by_cwd", "projects_memory", "projects_memory_update", "projects_workspace", "tasks_searches", "tasks_provenance", "chem_entities", "chem_entity_create", "chem_properties", "chem_formula", "chem_metrics", "chem_plans", "chem_plan_create", "chem_plan_validate", "chem_plan_status", "nmr_get", "nmr_create", "nmr_integrals", "nmr_approve", "nmr_written_back", "nmr_verify", "nmr_reopen", "nmr_calculate", "synth_targets", "synth_target_create", "synth_routes", "synth_route_create", "synth_route_step", "synth_route_status", "synth_evidence", "cas_prepare_query", "convert_upload"].map((name) => direct(name, ["request"])),
			direct("projects_list")
		];

		const when = (value) => value ? new Date(value).toLocaleString() : "—";
		const titleOf = (row) => row.title || row.name || row.query || row.id;
		const statusOf = (row) => ({ succeeded: "已完成", pending: "待处理", running: "进行中", failed: "失败", draft: "草稿", "under-review": "待审核", approved: "已批准", prepared: "待分析", "approved-written": "已审核", "visually-verified": "已确认" })[row.status] || row.status || "已登记";

		function Artifact({ title, rows = [], empty }) {
			return h("section", { className: "ib-artifact" }, h("div", { className: "ib-artifact-top" }, h("h3", null, title), h("span", { className: "ib-count" }, rows.length)), rows.length ? h("div", { className: "ib-rows" }, rows.slice(0, 4).map((row, index) => h("div", { className: "ib-row", key: row.id || index }, h("b", { title: titleOf(row) }, titleOf(row)), h("span", null, statusOf(row))))) : h("div", { className: "ib-artifact-empty" }, empty));
		}

		/** 会话 → 课题归属查询（对话界面徽章/提示条共用）。
		 *  优先按会话绑定（launch 记录），否则按会话工作目录（cwd）匹配课题
		 *  workspacePath——同一课题空间内手动新建的每个对话都能识别课题。 */
		function useBoundProject(sessionId, call, useSessions) {
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

		/** 会话头部课题徽章：显示当前课题与记忆版本，点击回到课题空间。 */
		function ProjectBadge({ sessionId, call, openWorkspace, useSessions }) {
			const bound = useBoundProject(sessionId, call, useSessions);
			if (!bound?.project) return null;
			return h("button", { className: "ib-badge", title: "打开课题空间", onClick: () => openWorkspace(bound.project) },
				h("span", { className: "ib-badge-mark" }, "◆"),
				h("b", null, bound.project.name),
				h("small", null, `记忆 v${bound.project.memoryVersion || "1"}`)
			);
		}

		/** 输入框上方的课题记忆提示条。 */
		function MemoryHint({ sessionId, call, openWorkspace, useSessions }) {
			const bound = useBoundProject(sessionId, call, useSessions);
			if (!bound?.project) return null;
			return h("div", { className: "ib-hint" },
				h("span", null, "课题背景"),
				h("b", null, bound.project.name),
				h("span", null, `核心记忆 v${bound.project.memoryVersion || "1"} 已作为对话背景`),
				h("button", { onClick: () => openWorkspace(bound.project) }, "课题空间")
			);
		}

		function CreateProject({ call, defaults, onCancel, onCreated }) {
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

		function Home({ call, onOpen, onLaunch }) {
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
			return h("div", null, h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Research Projects"), h("h1", null, "选择一个课题继续"), h("p", null, "每个课题拥有独立的核心记忆、科研 Agent 对话和研究成果。创建课题后会自动打开专属工作区并开始科研 Agent 对话。")), h("button", { className: "ib-btn", "data-primary": true, onClick: () => setCreating(true) }, "+ 新建课题")), creating ? h(CreateProject, { call, defaults: state.defaults, onCancel: () => setCreating(false), onCreated: (project, presetId) => void launch(project, presetId) }) : null, state.error ? h("div", { className: "ib-error" }, state.error) : null, state.loading ? h("div", { className: "ib-empty" }, "正在读取课题…") : state.projects.length ? h("div", { className: "ib-grid" }, state.projects.map((project) => h("button", { className: "ib-project", key: project.id, disabled: launching === project.id, onClick: () => onOpen(project) }, h("div", { className: "ib-project-icon" }, "PJ"), h("h2", null, project.name), h("p", null, launching === project.id ? "正在创建专属工作区并启动对话…" : "进入课题空间，继续对话、更新记忆或查询研究成果。"), h("div", { className: "ib-project-foot" }, h("span", null, `记忆 v${project.memoryVersion || "1"}`), h("span", null, when(project.updatedAt)))))) : h("div", { className: "ib-empty" }, "还没有课题。点击“新建课题”，先写下研究问题与目标。"));
		}

		function Project({ call, project, onBack, onStartChat }) {
			const [state, setState] = useState({ loading: true, data: null, error: "" });
			const [tab, setTab] = useState("literature");
			const [draft, setDraft] = useState("");
			const [note, setNote] = useState("");
			const [saving, setSaving] = useState(false);
			const [launching, setLaunching] = useState(false);
			const [toast, setToast] = useState("");
			const load = useCallback(async () => {
				try { const data = await call("projects_workspace", { request: { projectId: project.id } }); setState({ loading: false, data, error: "" }); setDraft(data.memory?.markdown || ""); }
				catch (reason) { setState({ loading: false, data: null, error: reason.message }); }
			}, [project.id]);
			useEffect(() => { void load(); }, [load]);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
			const save = async () => {
				setSaving(true);
				try { const result = await call("projects_memory_update", { request: { fields: { projectId: project.id, markdown: draft, changeNote: note } } }); setToast(`核心记忆已提交为 v${result.memory.version}`); setNote(""); await load(); }
				catch (reason) { setToast(reason.message); } finally { setSaving(false); }
			};
			const startChat = async () => {
				if (!state.data) return;
				setLaunching(true);
				try { await onStartChat(state.data.project, { memory: state.data.memory }); }
				catch (reason) { setToast(reason.message); setLaunching(false); }
			};
			if (state.loading) return h("div", { className: "ib-empty" }, "正在打开课题空间…");
			if (!state.data) return h("div", { className: "ib-empty" }, state.error, h("div", { style: { marginTop: 12 } }, h("button", { className: "ib-btn", onClick: onBack }, "返回")));
			const data = state.data;
			const literature = data.literature || {};
			const planning = data.planning || {};
			const characterization = data.characterization || {};
			const meta = { literature: ["文献资料", "检索汇总、精读报告和文献 PPT"], planning: ["研究设计", "工作规划、实验方案与合成路线"], characterization: ["表征分析", "NMR 等结构表征和审核结果"] };
			return h("div", null,
				h("div", { className: "ib-project-head" }, h("button", { className: "ib-btn", onClick: onBack }, "← 所有课题"), h("div", { className: "ib-project-copy" }, h("h1", null, data.project.name), h("p", null, `项目编号 ${data.project.id} · 核心记忆 v${data.project.memoryVersion}`)), h("button", { className: "ib-btn ib-agent", "data-primary": true, disabled: launching, onClick: () => void startChat() }, h("span", { className: "ib-spark" }, "✦"), launching ? "正在启动…" : "开始科研 Agent 对话")),
				h("div", { className: "ib-memory" }, h("section", { className: "ib-card" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "课题核心记忆.md"), h("span", { className: "ib-chip" }, `当前 v${data.memory?.version || "—"}`)), h("textarea", { value: draft, spellCheck: false, onChange: (event) => setDraft(event.target.value) }), h("div", { className: "ib-save" }, h("input", { value: note, placeholder: "本次修改说明，例如：补充第二阶段实验结果", onChange: (event) => setNote(event.target.value) }), h("button", { className: "ib-btn", "data-primary": true, disabled: saving || draft === data.memory?.markdown, onClick: () => void save() }, saving ? "提交中…" : "提交新版本"))), h("aside", { className: "ib-card ib-help" }, h("strong", null, "这份 Markdown 有什么用？"), "它是该课题的长期核心记忆。开始科研 Agent 对话时，当前版本会自动放入 Harness 输入框。", h("div", { className: "ib-history" }, (data.memoryHistory || []).slice(0, 6).map((version) => h("div", { className: "ib-version", key: version.id }, h("span", null, h("b", null, `v${version.version}`), ` · ${version.changeNote}`), h("span", null, when(version.createdAt))))))),
				h("div", { className: "ib-tabs" }, Object.entries(meta).map(([id, copy]) => h("button", { className: "ib-tab", "data-active": tab === id ? "true" : undefined, key: id, onClick: () => setTab(id) }, h("strong", null, copy[0]), h("span", null, copy[1])))),
				h("section", { className: "ib-board" }, h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, meta[tab][0]), h("p", null, meta[tab][1])), h("button", { className: "ib-btn", onClick: () => void load() }, "刷新")), tab === "literature" ? h("div", { className: "ib-artifacts" }, h(Artifact, { title: "文献检索汇总", rows: literature.searches, empty: "对话中的文献检索结果会整理到这里。" }), h(Artifact, { title: "文献原文整理", rows: literature.bundles, empty: "尚未登记论文原文。" }), h(Artifact, { title: "文献精读报告", rows: literature.reports, empty: "尚未生成精读报告。" }), h(Artifact, { title: "文献 PPT 汇报", rows: literature.presentations, empty: "尚未生成文献汇报 PPT。" })) : null, tab === "planning" ? h("div", { className: "ib-artifacts" }, h(Artifact, { title: "课题工作规划 / 实验方案", rows: planning.plans, empty: "让 Agent 制定阶段工作规划或实验方案。" }), h(Artifact, { title: "合成目标", rows: planning.targets, empty: "尚未登记合成目标。" }), h(Artifact, { title: "合成路线设计", rows: planning.routes, empty: "尚未形成合成路线。" })) : null, tab === "characterization" ? h("div", { className: "ib-artifacts" }, h(Artifact, { title: "NMR / 结构分析", rows: characterization.nmr, empty: "导入 NMR 或结构表征任务后会归档到这里。" }), h(Artifact, { title: "已审核结果", rows: (characterization.nmr || []).filter((row) => ["approved-written", "visually-verified"].includes(row.status)), empty: "尚无完成人工审核的表征结果。" })) : null),
				toast ? h("div", { className: "ib-toast" }, toast) : null
			);
		}

		function Panel({ call, onClose, onStartChat, initial }) {
			const [project, setProject] = useState(initial ?? null);
			return ReactDOM.createPortal(h("div", { className: "ib-overlay" }, h("header", { className: "ib-top" }, h("div", { className: "ib-brand" }, h("div", { className: "ib-logo" }, "iB"), h("div", null, h("strong", null, "iBM Lab Agent"), h("small", null, "Project Research Workspace"))), h("div", { className: "ib-crumb" }, project ? h("span", null, "课题 / ", h("b", null, project.name)) : h("b", null, "我的科研课题")), h("button", { className: "ib-btn", onClick: onClose }, "返回 Harness")), h("main", { className: "ib-main" }, project ? h(Project, { call, project, onBack: () => setProject(null), onStartChat }) : h(Home, { call, onOpen: setProject, onLaunch: onStartChat }))), document.body);
		}

		function Entry({ onOpen, wide }) { return h("button", { className: "ib-sidebar", onClick: onOpen, title: "打开课题工作台" }, h("span", { className: "ib-sidebar-logo" }, "iB"), wide ? h("span", null, "我的科研课题") : null); }

		/** 实验室烧瓶 SVG（配色与课题面板一致：绿色渐变主体 + 青色气泡）。 */
		function FlaskSvg({ width = 18, height = 18 }) {
			return h("svg", { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
				h("path", { d: "M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3", stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }),
				h("path", { d: "M7 16h10l-2.4-3.4h-5.2L7 16Z", fill: "#eafff6", opacity: 0.9 }),
				h("circle", { cx: 12, cy: 13.2, r: 0.55, fill: "#73dce6" }),
				h("circle", { cx: 13.6, cy: 15, r: 0.4, fill: "#73dce6" })
			);
		}

		/**
		 * 品牌覆盖：sidebar 顶部原「DeepSeek HARNESS」wordmark 与鲸鱼 logo 由
		 * dsh-client-ui-sidebar 硬编码渲染，无 slot/配置可替换——这里用 CSS
		 * 隐藏原品牌，再注入自定义「烧瓶 + iBM Agent / based on DSH」元素。
		 * CSS modules 本地类名后缀（_logoRow/_brand/_railFish）在 sidebar 包内
		 * 稳定，升级后需复核。保留原按钮的"新建会话"点击行为。
		 */
		function applyBranding() {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
			const FLASK_HTML = '<svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><path d="M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16h10l-2.4-3.4h-5.2L7 16Z" fill="#eafff6" opacity="0.9"/><circle cx="12" cy="13.2" r="0.55" fill="#73dce6"/><circle cx="13.6" cy="15" r="0.4" fill="#73dce6"/></svg>';
			const FLASK_RAIL_HTML = FLASK_HTML.replace('width="18"', 'width="13"').replace('height="18"', 'height="13"');
			let observer = null;
			const hideNative = () => {
				const styleId = "dsh-lab-agent-brand";
				if (document.querySelector(`style[data-plugin-css="${styleId}"]`) !== null) return;
				const style = document.createElement("style");
				style.dataset.pluginCss = styleId;
				style.textContent = "[class*='_brand'] svg,[class*='_railFish']{display:none!important}";
				document.head.appendChild(style);
			};
			const inject = () => {
				hideNative();
				const row = document.querySelector("[class*='_logoRow']");
				if (!row) return false;
				let touched = false;
				// 宽栏：品牌按钮（_brand）内替换为 烧瓶 + iBM Agent
				const brand = row.querySelector("[class*='_brand']");
				if (brand && !brand.querySelector(".ib-brand-shell")) {
					const shell = document.createElement("span");
					shell.className = "ib-brand-shell";
					shell.setAttribute("data-dsh-lab-brand", "1");
					shell.innerHTML = `<span class="ib-brand-flask">${FLASK_HTML}</span><span class="ib-brand-text"><b>iBM Agent</b><small>based on DSH</small></span>`;
					brand.appendChild(shell);
					touched = true;
				}
				// 折叠栏：toggle 按钮内的鲸鱼（_railFish 兄弟）替换为 小烧瓶
				const toggle = row.querySelector("[class*='_toggle']");
				if (toggle && !toggle.querySelector(".ib-rail-flask")) {
					const flask = document.createElement("span");
					flask.className = "ib-rail-flask";
					flask.setAttribute("data-dsh-lab-brand", "1");
					flask.innerHTML = FLASK_RAIL_HTML;
					toggle.appendChild(flask);
					touched = true;
				}
				return touched;
			};
			// sidebar 由 React 渲染：注入一次成功后仍保持观察（折叠/展开会重渲染，
			// React 可能清掉注入元素），幂等补注；dispose 时统一断开。
			inject();
			let scheduled = false;
			const schedule = () => {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(() => { scheduled = false; inject(); });
			};
			observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true });
			return () => { if (observer) observer.disconnect(); };
		}

		function applyUi(ctx) {
			const call = async (method, args) => {
				const payload = args && typeof args === "object" && Object.keys(args).length === 1 && "request" in args ? args.request : args;
				const result = payload === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
				if (!result.ok) throw new Error(result.error?.message || result.error?.code || "remote call failed");
				return result.value;
			};
			let root = null;
			const close = () => { if (!root) return; const node = root; root = null; ReactDOM.unmountComponentAtNode(node); node.remove(); };
			const toast = (message) => {
				const node = document.createElement("div");
				node.className = "ib-toast";
				node.textContent = message;
				document.body.appendChild(node);
				setTimeout(() => node.remove(), 4500);
			};
			const promptFor = (project, memory) => [`进入科研 Agent 模式，当前课题为「${project.name}」（项目编号：${project.id}）。`, "以下是该项目当前版本的核心记忆。请以它作为本次对话背景，并把后续产物归档到这个项目；如发现信息冲突，先向我确认。", "", `<!-- project-memory:${project.id}@${memory?.version || project.memoryVersion} -->`, memory?.markdown || `# ${project.name}`, "", "请先简短确认你已理解课题背景，然后等待我的具体任务。"].join("\n");
			/**
			 * 为空白新会话选择科研 Agent 预设。wire 层返回 { result: { ok, error } }，
			 * **不会 throw**——必须检查 result.ok，否则预设切换失败会被静默吞掉
			 * （会话停留在默认 standard 模式，正是此前"进入科研 Agent 模式"失效的
			 * 直接原因）。返回 "ok" 或失败说明。
			 */
			const selectResearchPreset = async (sessionId, presetId) => {
				if (!presetId) return "跳过：未配置科研预设";
				try {
					const response = await ctx.connection.api.agentPresets.select({ sessionId, agentPreset: presetId });
					const result = response?.result ?? response;
					if (!result.ok) {
						const code = result.error?.code ?? "unknown";
						const detail = result.error?.message ?? "agentPresets.select 未返回 ok";
						return code === "agent-preset-locked" ? `预设切换被拒绝（会话已开始，预设已固定：${detail}）` : `预设选择失败（${code}）：${detail}`;
					}
					return "ok";
				} catch (reason) {
					return `预设选择调用失败：${reason?.message ?? reason}`;
				}
			};
			/**
			 * 课题 launch：绑定是**工作区级**的——一个课题一个专属 workspace，
			 * 空间内所有对话共享课题标识与核心记忆。流程：复用或创建专属
			 * 工作区 → 复用最近绑定会话或开空白新会话 → 选择科研 Agent 预设
			 * （agentPresets.select，仅对空白会话有效）→ 记录会话绑定 → 打开
			 * 会话 → 把当前版本核心记忆预填进输入框。旧项目（无工作区路径）
			 * 回退到当前会话，仅预填记忆。
			 */
			const launchProject = async (project, opts = {}) => {
				const presetId = opts.presetId;
				let sessionId;
				let workspaceId;
				let openedNew = false;
				let presetApplied = "ok";
				const bound = (await call("projects_binding", { request: { projectId: project.id } })).binding ?? null;
				if (bound?.workspaceId) {
					// 已有课题工作区：复用最近一次启动的会话（空间内所有对话共享记忆）
					workspaceId = bound.workspaceId;
					const boundSessions = bound.sessionIds ?? [];
					sessionId = boundSessions.length > 0 ? boundSessions[boundSessions.length - 1] : undefined;
					if (sessionId === undefined) {
						sessionId = await ctx.sessions.create({ workspaceId });
						openedNew = true;
						presetApplied = await selectResearchPreset(sessionId, presetId);
						await call("projects_bind_session", { request: { projectId: project.id, sessionId, workspaceId } });
					}
				} else if (project.workspacePath) {
					// 首次启动：建工作区（并按课题名重命名）→ 空白新会话 → 预设 → 绑定
					const ws = await ctx.workspaces.manager.create({ path: project.workspacePath });
					if (!ws.ok) throw new Error(ws.error?.message || "创建课题工作区失败");
					workspaceId = ws.value.workspace.workspaceId;
					await call("projects_bind_workspace", { request: { projectId: project.id, workspaceId } });
					try { await ctx.workspaces.manager.rename(workspaceId, project.name); } catch (reason) { console.warn("dsh-lab-agent: workspace rename failed", reason); }
					sessionId = await ctx.sessions.create({ workspaceId });
					openedNew = true;
					presetApplied = await selectResearchPreset(sessionId, presetId);
					await call("projects_bind_session", { request: { projectId: project.id, sessionId, workspaceId } });
				} else {
					// 升级前已存在的项目：没有专属工作区，沿用当前会话。
					sessionId = ctx.sessions.list.getSnapshot().current;
					if (sessionId === undefined) {
						const workspaces = ctx.workspaces.list.getSnapshot();
						const workspaceId0 = workspaces.recentWorkspaceId || workspaces.items[0]?.workspaceId;
						if (workspaceId0 === undefined) throw new Error("请先在 Harness 中选择一个工作目录");
						sessionId = await ctx.workspaces.connectWorkspace(workspaceId0);
						ctx.sessions.open(sessionId);
					}
				}
				ctx.sessions.open(sessionId);
				const actx = ctx.sessions.scope(sessionId);
				if (!actx) throw new Error("科研 Agent 会话尚未就绪，请稍后重试");
				const prompt = promptFor(project, opts.memory);
				ctx.conversation.input.for(actx).setDraft(prompt);
				close();
				if (presetApplied !== "ok") toast(`⚠️ ${presetApplied}`);
				return { sessionId, workspaceId, openedNew, presetApplied };
			};
			const open = (initial) => { if (root) return; root = document.createElement("div"); document.body.appendChild(root); ReactDOM.render(h(Panel, { call, onClose: close, onStartChat: launchProject, initial: initial ?? null }), root); };
			const openWorkspace = (project) => open(project);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "lab-panel", order: 5 }, (props) => h(Entry, { wide: props.wide, onOpen: () => open() })), "dsh-lab-agent: project entry");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: "lab-project-badge", order: 10 }, (props) => h(ProjectBadge, { ...props, call, openWorkspace })), "dsh-lab-agent: project badge");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "lab-memory-hint", order: 10 }, (props) => h(MemoryHint, { ...props, call, openWorkspace })), "dsh-lab-agent: memory hint");
			ctx.on("dispose", close);
		}

		async function apply(ctx) {
			await ctx.remote.$mount({ package: "dsh-lab-agent", descriptors });
			applyBranding();
			ctx.inject(["remote", "remote.lab", "slots", "sessions", "workspaces", "conversation", "connection"], applyUi);
		}
		exports.apply = apply;
		exports.inject = ["remote"];
		return module.exports;
	}
});
