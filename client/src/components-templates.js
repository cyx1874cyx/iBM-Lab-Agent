import { useState, useEffect, useCallback, useRef } from "react";
import { h } from "./h.js";
import { when, cloneForm } from "./lib.js";

// 模板管理组件：Templates/ExperimentPlanTemplates/NoteTemplates/NoteTemplateForm/PptTemplates/PptTemplateImport/MetaEditor + SVG 图标
export function Templates({ call, onBack }) {
			const [tab, setTab] = useState("notes");
			const [notes, setNotes] = useState({ loading: true, list: [], error: "" });
			const [ppt, setPpt] = useState({ loading: true, list: [], error: "" });
			const [exp, setExp] = useState({ loading: true, list: [], error: "" });
			const loadNotes = useCallback(async () => {
				setNotes((s) => ({ ...s, loading: true, error: "" }));
				try { const result = await call("note_templates_list"); setNotes({ loading: false, list: result.templates || [], error: "" }); }
				catch (reason) { setNotes((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message })); }
			}, [call]);
			const loadPpt = useCallback(async () => {
				setPpt((s) => ({ ...s, loading: true, error: "" }));
				try { const result = await call("templates_list"); setPpt({ loading: false, list: result.templates || [], error: "" }); }
				catch (reason) { setPpt((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message })); }
			}, [call]);
			const loadExp = useCallback(async () => {
				setExp((s) => ({ ...s, loading: true, error: "" }));
				try { const result = await call("experiment_plan_templates_list"); setExp({ loading: false, list: result.templates || [], error: "" }); }
				catch (reason) { setExp((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message })); }
			}, [call]);
			useEffect(() => { void loadNotes(); void loadPpt(); void loadExp(); }, [loadNotes, loadPpt, loadExp]);
			return h("div", null,
				h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Template Library"), h("h1", null, "模板管理"), h("p", null, "管理「阅读笔记模板」「实验计划模板」与「PPT 模板」。科研 Agent 生成对应产物时会按所选模板生成；任务保存版本快照，模板后续修改不影响旧产物。")), h("button", { className: "ib-btn", onClick: onBack }, "← 所有课题")),
				h("div", { className: "ib-tm-tabs" },
					h("button", { className: "ib-tm-tab", "data-active": tab === "notes" ? "true" : undefined, onClick: () => setTab("notes") }, "阅读笔记模板"),
					h("button", { className: "ib-tm-tab", "data-active": tab === "exp" ? "true" : undefined, onClick: () => setTab("exp") }, "实验计划模板"),
					h("button", { className: "ib-tm-tab", "data-active": tab === "ppt" ? "true" : undefined, onClick: () => setTab("ppt") }, "PPT 模板")),
				tab === "notes" ? h(NoteTemplates, { call, state: notes, reload: loadNotes }) : (tab === "exp" ? h(ExperimentPlanTemplates, { call, state: exp, reload: loadExp }) : h(PptTemplates, { call, state: ppt, reload: loadPpt }))
			);
		}

		/** 0.4.0：实验计划模板管理（列表 + 新建/归档；版本快照不可变由服务端保证）。 */
export function ExperimentPlanTemplates({ call, state, reload }) {
			const [busy, setBusy] = useState({});
			const [toast, setToast] = useState("");
			const [name, setName] = useState("");
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); }, [toast]);
			const withBusy = (key, fn) => { if (busy[key]) return; setBusy((s) => ({ ...s, [key]: true })); return Promise.resolve(fn()).finally(() => setBusy((s) => ({ ...s, [key]: false }))); };
			const create = () => withBusy("create", async () => {
				const clean = String(name || "").trim();
				if (!clean) { setToast("请填写模板名称。"); return; }
				const id = `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
				await call("experiment_plan_templates_create", { request: { id, fields: { name: clean } } });
				setName("");
				await reload();
			});
			const archive = (row) => withBusy(`arc:${row.id}`, async () => {
				await call("experiment_plan_templates_archive", { request: { id: row.id } });
				await reload();
			});
			return h("div", null,
				toast ? h("div", { className: "ib-toast", role: "status" }, toast) : null,
				h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 10 } },
					h("input", { style: { flex: 1, background: "var(--ib-panel)", color: "var(--ib-text)", borderRadius: 8, padding: "7px 10px", border: "1px solid var(--ib-line)" }, value: name, placeholder: "新实验计划模板名称（默认章节骨架会保留）", onChange: (event) => setName(event.target.value) }),
					h("button", { className: "ib-btn", "data-primary": true, disabled: !!busy.create, onClick: () => void create() }, busy.create ? "创建中…" : "新建模板")),
				state.error ? h("div", { className: "ib-error" }, state.error) : null,
				state.loading ? h("div", { className: "ib-empty" }, "加载中…") : null,
				state.list.length
					? h("div", { className: "ib-rows" }, state.list.map((row) => h("div", { className: "ib-row", key: row.id },
						h("b", { title: row.id }, row.name),
						h("span", null, `v${row.version}${row.applicableTo ? " · " + row.applicableTo : ""} · ${row.sections?.length || 0} 章节`),
						row.status === "archived"
							? h("span", { className: "ib-chip" }, "已归档")
							: h("button", { className: "ib-btn", disabled: !!busy[`arc:${row.id}`], onClick: () => void archive(row) }, "归档"))))
					: h("div", { className: "ib-empty" }, "尚无实验计划模板；可新建，或使用内置默认模板（生成实验计划草案时自动快照）。"));
		}

		/** 阅读笔记模板管理：列表 + 新建/编辑/复制/删除 + 查看要求。 */
export function NoteTemplates({ call, state, reload }) {
			const [mode, setMode] = useState("list"); // list | form
			const [editing, setEditing] = useState(null); // template row (null = 新建)
			const [busy, setBusy] = useState({});
			const [toast, setToast] = useState("");
			const [requirements, setRequirements] = useState(null);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
			const run = async (key, work) => {
				if (busy[key]) return;
				setBusy((old) => ({ ...old, [key]: true }));
				try { await work(); }
				catch (reason) { setToast(reason.message || "操作失败"); }
				finally { setBusy((old) => { const n = { ...old }; delete n[key]; return n; }); }
			};
			const remove = (row) => run(`del:${row.id}`, async () => {
				if (!window.confirm(`删除阅读笔记模板「${row.name}」？任务快照不受影响，历史版本仍可读。`)) return;
				await call("note_templates_delete", { request: { id: row.id } });
				setToast(`已删除模板「${row.name}」`); await reload(); setMode("list");
			});
			const showRequirements = (row) => run(`req:${row.id}`, async () => {
				if (requirements?.id === row.id) { setRequirements(null); return; }
				const result = await call("note_templates_requirements", { request: { id: row.id, version: row.version } });
				setRequirements({ id: row.id, name: row.name, data: result.requirements });
			});
			const openForm = (row, copy = false) => run("open", async () => {
				if (!row) { setEditing(null); setMode("form"); return; }
				const result = await call("note_templates_resolve", { request: { id: row.id, version: row.version } });
				setEditing(copy ? { ...result.template, _copy: true } : result.template);
				setMode("form");
			});
			if (mode === "form") return h(NoteTemplateForm, { call, initial: editing, onCancel: () => { setMode("list"); setEditing(null); }, onSaved: () => { setMode("list"); setEditing(null); void reload(); } });
			const cards = state.list.map((row) => h("div", { className: "ib-tm-card", key: row.id },
				h("div", { className: "ib-tm-title" }, h("b", null, row.name), h("span", null, `v${row.version} · ${when(row.updatedAt)}`)),
				h("div", { className: "ib-tm-sub" }, h("span", { className: "ib-key" }, row.id)),
				h("div", { className: "ib-tm-meta" }, (row.topics || []).slice(0, 3).map((t) => h("span", { className: "ib-tm-chip", key: t }, t)), (row.tags || []).slice(0, 3).map((t) => h("span", { className: "ib-tm-chip", "data-tone": "accent", key: t }, t))),
				h("div", { className: "ib-tm-acts" }, h("button", { className: "ib-lit-btn", onClick: () => openForm(row) }, "编辑"), h("button", { className: "ib-lit-btn", onClick: () => openForm(row, true) }, "复制"), h("button", { className: "ib-lit-btn", onClick: () => showRequirements(row) }, busy[`req:${row.id}`] ? "…" : (requirements?.id === row.id ? "收起要求" : "生成要求")), h("button", { className: "ib-lit-btn", onClick: () => remove(row) }, busy[`del:${row.id}`] ? "…" : "删除"))
			));
			const listBody = state.loading ? h("div", { className: "ib-empty" }, "正在读取模板…") : (state.list.length ? h("div", { className: "ib-tm-list" }, cards) : h("div", { className: "ib-empty" }, "还没有阅读笔记模板。点击“新建阅读笔记模板”创建，或直接使用内置默认模板 note-default。"));
			const reqPanel = requirements ? h("div", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `「${requirements.name}」参考要求`), h("span", { className: "ib-chip" }, "作为组织与格式参考")), h("pre", { style: { whiteSpace: "pre-wrap", fontSize: 10.5, lineHeight: 1.7, color: "var(--ib-text)", background: "var(--ib-panel)", border: "1px solid var(--ib-line)", borderRadius: 10, padding: 12 } }, JSON.stringify(requirements.data, null, 2))) : null;
			return h("div", null,
				h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, "阅读笔记模板"), h("p", null, "Agent 生成阅读笔记时按模板章节与要求生成。这里可新建/复制/修改模板。")), h("button", { className: "ib-btn", "data-primary": true, onClick: () => openForm(null) }, "+ 新建阅读笔记模板")),
				state.error ? h("div", { className: "ib-error" }, state.error) : null,
				listBody,
				reqPanel,
				toast ? h("div", { className: "ib-toast" }, toast) : null
			);
		}

		/** 阅读笔记模板表单：新建（无 id）/ 编辑 / 复制（保留原 id 但可改名，复制时允许改 id）。 */
export function NoteTemplateForm({ call, initial, onCancel, onSaved }) {
			const blank = { id: "", name: "", audience: "课题组组会", language: "zh", length: "单篇 600-1000 字，突出与课题相关的关键内容", topics: [], tags: [], sections: [{ key: "citation", title: "文献信息", required: true, hint: "标题、作者、期刊、年份、DOI 的规范短引用" }, { key: "one-sentence-summary", title: "一句话概述", required: true, hint: "问题、做法、机制、成果各一短句" }], styleRules: [], evidenceRequirements: [], outputRequirements: [], remark: "" };
			const [form, setForm] = useState(() => initial ? cloneForm(initial) : cloneForm(blank));
			const [busy, setBusyTemp] = useState(false);
			const [error, setErrorTemp] = useState("");
			const isCreate = !initial;
			const isCopy = !!initial && initial._copy;
			const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
			const arrayField = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }));
			const listField = (key) => (event) => {
				const value = event.target.value;
				setForm((old) => ({ ...old, [key]: value === "" ? [] : value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }));
			};
			const setSection = (index, patch) => setForm((old) => ({ ...old, sections: (old.sections || []).map((s, i) => i === index ? { ...s, ...patch } : s) }));
			const addSection = () => setForm((old) => ({ ...old, sections: [...(old.sections || []), { key: "", title: "", required: true, hint: "" }] }));
			const removeSection = (index) => setForm((old) => ({ ...old, sections: (old.sections || []).filter((_, i) => i !== index) }));
			/** 「从 .md 导入」：整篇 Markdown 作为生成要求写入 outputRequirements，名称回退用文件名。 */
			const fileRef = useRef(null);
			const importFromMd = (event) => {
				const file = event.target.files?.[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					const text = String(reader.result || "");
					const nameFromFile = (file.name || "").replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
					setForm((old) => ({ ...old, name: old.name?.trim() ? old.name : nameFromFile, outputRequirements: text.split(/\r?\n/).map((s) => s.trimEnd()), remark: old.remark || `从文件导入：${file.name || ""}` }));
				};
				reader.onerror = () => setErrorTemp("读取 Markdown 文件失败");
				reader.readAsText(file);
				event.target.value = "";
			};
			const save = async () => {
				setBusyTemp(true); setErrorTemp("");
				try {
					if (!form.name.trim()) throw new Error("请填写模板名称");
					if (isCreate && !/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("模板编号请使用小写字母、数字和连字符，例如 lab-note-v2");
					const fields = { ...form, id: undefined };
					let payload;
					if (isCreate) payload = { id: form.id.trim(), fields };
					else if (isCopy) payload = { id: initial.id, newId: form.id.trim() || (form.name + "-copy"), name: form.name };
					else payload = { id: form.id, fields };
					const method = isCopy ? "note_templates_copy" : (isCreate ? "note_templates_create" : "note_templates_update");
					const result = await call(method, { request: isCopy ? payload : { id: payload.id, fields } });
					onSaved(result.template.name || form.name);
				} catch (reason) { setErrorTemp(reason.message); } finally { setBusyTemp(false); }
			};
			return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, isCopy ? "复制阅读笔记模板" : (isCreate ? "新建阅读笔记模板" : `编辑模板 v${form.version}`)), h("span", { className: "ib-chip" }, isCopy ? "origin " + initial.id : (isCreate ? "新模板" : `当前 v${form.version}`))),
				h("div", { className: "ib-req" },
					h("div", { className: "vertical-stack", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } }, h("button", { className: "ib-btn", onClick: () => fileRef.current && fileRef.current.click() }, "从 .md 文件导入"), h("input", { ref: fileRef, type: "file", accept: ".md,text/markdown,text/plain", style: { display: "none" }, onChange: importFromMd }), h("span", { style: { color: "var(--ib-text)", fontSize: 9.5 } }, "把一份 Markdown 整篇作为该模板的「生成要求」填入；不改变章节结构（按 needs 保留默认章节）。")),
					h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } },
						!isCopy && h("div", { className: "ib-req" }, h("label", null, "模板编号（英文小写）"), h("input", { value: form.id, disabled: !isCreate && !isCopy ? true : false, placeholder: "lab-note-v2", onChange: field("id") })),
						h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, placeholder: "聚前药精读笔记模板", onChange: field("name") })),
						h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })),
						h("div", { className: "ib-req" }, h("label", null, "语言"), h("select", { value: form.language, onChange: field("language") }, ["zh", "en", "zh-en"].map((l) => h("option", { value: l, key: l }, l)))),
						h("div", { className: "ib-req", style: { gridColumn: "1/-1" } }, h("label", null, "篇幅说明"), h("input", { value: form.length, onChange: field("length") })),
						h("div", { className: "ib-req" }, h("label", null, "适用课题（逗号分隔）"), h("input", { value: (form.topics || []).join(", "), onChange: listField("topics") })),
						h("div", { className: "ib-req" }, h("label", null, "标签（逗号分隔）"), h("input", { value: (form.tags || []).join(", "), onChange: listField("tags") }))
					),
					h("label", null, "章节结构（Agent 生成时按此章节组织笔记）"),
					h("div", { className: "ib-sections" }, (form.sections || []).map((s, index) => h("div", { className: "ib-section-row", key: index }, h("input", { type: "text", value: s.key, placeholder: "key", className: "ib-mini", onChange: (e) => setSection(index, { key: e.target.value }) }), h("input", { type: "text", value: s.title, placeholder: "章节标题", className: "ib-mini", onChange: (e) => setSection(index, { title: e.target.value }) }), h("input", { type: "text", value: s.hint, placeholder: "写作要点", className: "ib-mini", onChange: (e) => setSection(index, { hint: e.target.value }) }), h("input", { type: "checkbox", checked: !!s.required, title: "必填", onChange: (e) => setSection(index, { required: e.target.checked }) }), h("button", { className: "ib-mini ib-lit-btn", onClick: () => removeSection(index) }, "×"))), h("button", { className: "ib-mini ib-lit-btn", onClick: addSection }, "+ 加一节")),
					h("div", { className: "vertical-stack", style: { marginTop: 8, display: "grid", gap: 8, gridTemplateColumns: "repeat(2,1fr)" } },
						h("div", { className: "ib-req" }, h("label", null, "风格规则（每行一条）"), h("textarea", { value: (form.styleRules || []).join("\n"), onChange: arrayField("styleRules") })),
						h("div", { className: "ib-req" }, h("label", null, "证据与来源要求（每行一条）"), h("textarea", { value: (form.evidenceRequirements || []).join("\n"), onChange: arrayField("evidenceRequirements") })),
						h("div", { className: "ib-req" }, h("label", null, "附加输出要求（每行一条）"), h("textarea", { value: (form.outputRequirements || []).join("\n"), onChange: arrayField("outputRequirements") }))
					),
					error ? h("div", { className: "ib-error" }, error) : null,
					h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void save() }, busy ? "保存中…" : (isCopy ? "保存副本" : "保存")))
				)
			);
		}

		/** PPT 模板管理：模板用于格式参考，检查结果不参与产物人工审核门禁。 */
export function PptTemplates({ call, state, reload }) {
			const [mode, setMode] = useState("list"); // list | import
			const [selected, setSelected] = useState(null); // preview data
			const [meta, setMeta] = useState(null); // edit-meta form
			const [busy, setBusy] = useState({});
			const [toast, setToast] = useState("");
			const [validation, setValidation] = useState(null);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
			const run = async (key, work) => {
				if (busy[key]) return;
				setBusy((old) => ({ ...old, [key]: true }));
				try { await work(); }
				catch (reason) { setToast(reason.message || "操作失败"); }
				finally { setBusy((old) => { const n = { ...old }; delete n[key]; return n; }); }
			};
			const archive = (row) => run(`arc:${row.id}`, async () => {
				if (!window.confirm(`归档 PPT 模板「${row.name}」？历史版本仍可读，任务快照不受影响。`)) return;
				await call("templates_archive", { request: { id: row.id } });
				setToast(`已归档「${row.name}」`); await reload(); setSelected(null); setValidation(null);
			});
			const preview = (row) => run(`pv:${row.id}`, async () => {
				if (selected?.id === row.id) { setSelected(null); return; }
				const result = await call("templates_preview", { request: { id: row.id, version: row.version } });
				setSelected({ id: row.id, version: row.version, data: result.preview });
			});
			const doValidate = (row) => run(`vf:${row.id}`, async () => {
				const result = await call("templates_validate", { request: { id: row.id, version: row.version } });
				setValidation({ id: row.id, v: result.validation });
				setToast(result.validation.ok ? `模板「${row.name}」参考检查正常` : `模板「${row.name}」有格式提醒，但不阻止生成`);
			});
			const openMeta = (row) => run("meta", async () => {
				const result = await call("templates_resolve", { request: { id: row.id, version: row.version } });
				setMeta({ ...result.template });
			});
			const saveMeta = (fields) => run("save-meta", async () => {
				const result = await call("templates_update_meta", { request: { id: fields.id, fields: { name: fields.name, purpose: fields.purpose, audience: fields.audience, notesRequirement: fields.notesRequirement, maxPages: fields.maxPages ? Number(fields.maxPages) : undefined } } });
				setToast(`已更新「${result.template.name}」v${result.template.version}`); setMeta(null); await reload();
			});
			if (mode === "import") return h(PptTemplateImport, { call, onCancel: () => setMode("list"), onDone: (id) => { setToast(`已导入模板 ${id}，请确认映射后发布`); setMode("list"); void reload(); } });
			const statusLabel = (st) => ({ draft: "草稿", ready: "可用", archived: "已归档" }[st] || st);
			return h("div", null,
				h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, "PPT 模板"), h("p", null, "模板只提供版式与风格参考；映射检查用于提示兼容性，不作为生成或人工审核门槛。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", "data-primary": true, onClick: () => setMode("import") }, "+ 导入 PPT 模板"))),
				state.error ? h("div", { className: "ib-error" }, state.error) : null,
				state.loading ? h("div", { className: "ib-empty" }, "正在读取模板…") : state.list.length ? h("div", { className: "ib-table" },
					h("div", { className: "ib-table-head" }, h("span", { className: "ib-tm-id" }, "ID"), h("span", { className: "ib-tm-name" }, "名称"), h("span", { className: "ib-tm-status" }, "状态"), h("span", { className: "ib-tm-actions" }, "操作")),
					state.list.map((row) => h("div", { className: "ib-table-row", key: row.id }, h("span", { className: "ib-tm-id ib-tm-key" }, row.id), h("span", { className: "ib-tm-name" }, h("b", null, row.name), h("small", { style: { display: "block", color: "var(--ib-text)", fontSize: 9 } }, `v${row.version} · ${row.pageSize?.ratio || "?"} · ${when(row.updatedAt)}`)), h("span", { className: "ib-tm-status" }, h("span", { className: row.status === "ready" ? "ib-tm-chip" : "ib-tm-chip", "data-tone": row.status === "ready" ? "accent" : undefined }, statusLabel(row.status))), h("span", { className: "ib-tm-actions" }, h("button", { className: "ib-lit-btn", onClick: () => preview(row) }, busy[`pv:${row.id}`] ? "…" : (selected?.id === row.id ? "收起" : "预览")), h("button", { className: "ib-lit-btn", onClick: () => doValidate(row) }, busy[`vf:${row.id}`] ? "…" : "验证"), h("button", { className: "ib-lit-btn", onClick: () => openMeta(row) }, "编辑元数据"), h("button", { className: "ib-lit-btn", onClick: () => archive(row) }, busy[`arc:${row.id}`] ? "…" : "归档")))))
					: h("div", { className: "ib-empty" }, "还没有 PPT 模板。点击“导入 PPT 模板”上传 .pptx，或使用内置默认模板 nature-default。"),
				validation && validation.id ? h("div", { className: "ib-card ib-form", style: { marginTop: 14, borderColor: validation.v.ok ? "rgba(81,212,163,.4)" : "rgba(224,169,88,.45)" } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `格式参考检查`), h("span", { className: "ib-chip" }, validation.v.ok ? "正常" : "有提醒")), (validation.v.problems || []).length ? h("ul", { style: { color: validation.v.ok ? "#b4d9cc" : "#e9bd7d", fontSize: 10.5, lineHeight: 1.7, margin: 0, paddingLeft: 16 } }, validation.v.problems.map((p) => h("li", { key: p }, p))) : h("div", { className: "ib-sub" }, validation.v.natureDefault ? "内置默认模板（由 nature-paper2ppt 处理版式）" : "模板映射可作为生成时的版式参考。")) : null,
				selected ? h("div", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `角色映射预览`), h("span", { className: "ib-chip" }, `v${selected.version}`)), selected.data.natureDefault ? h("div", { className: "ib-sub" }, "内置默认模板：全部角色交由 nature-paper2ppt 默认流程处理。") : h("div", { className: "ib-table" }, h("div", { className: "ib-table-head" }, h("span", { style: { flex: 1 } }, "角色"), h("span", { style: { flex: 1 } }, "布局"), h("span", { style: { flex: 2 } }, "占位符")), selected.data.roles.map((role) => h("div", { className: "ib-table-row", key: role.role, style: { alignItems: "flex-start" } }, h("span", { className: "ib-tm-key", style: { flex: 1 } }, role.role), h("span", { style: { flex: 1, fontSize: 10 } }, `${role.layoutName || role.layoutId}`), h("span", { style: { flex: 2, fontSize: 9, color: "var(--ib-text)" } }, (role.placeholders || []).map((p) => p.type).join(", ")))))) : null,
				meta ? h(MetaEditor, { call, initial: meta, onCancel: () => setMeta(null), onSaved: saveMeta }) : null,
				toast ? h("div", { className: "ib-toast" }, toast) : null
			);
		}

		/** 导入 .pptx → 解析 → 确认版式角色映射 → 发布。 */
export function PptTemplateImport({ call, onCancel, onDone }) {
			const [form, setForm] = useState({ id: "", name: "", audience: "课题组组会", purpose: "", file: null });
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState("");
			const [staged, setStaged] = useState(null); // { profile, parsed, suggestions }
			const [mapping, setMapping] = useState(null); // role → layoutId
			const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
			const readFile = (event) => {
				const file = event.target.files?.[0];
				if (!file) return;
				setForm((old) => ({ ...old, file }));
			};
			const toBase64 = (file) => new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => { const text = String(reader.result || ""); resolve(text.includes(",") ? text.split(",")[1] : text); };
				reader.onerror = () => reject(new Error("读取文件失败"));
				reader.readAsDataURL(file);
			});
			const doImport = async () => {
				setBusy(true); setError("");
				try {
					if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("模板编号请使用小写字母、数字和连字符，例如 lab-ppt-v3");
					if (!form.name.trim()) throw new Error("请填写模板名称");
					if (!form.file) throw new Error("请选择 .pptx 文件");
					const base64 = await toBase64(form.file);
					const result = await call("templates_import", { request: { id: form.id.trim(), name: form.name.trim(), base64, meta: { audience: form.audience, purpose: form.purpose } } });
					const profile = result?.profile;
					const parsed = result?.parsed;
					const suggestions = result?.suggestions;
					if (!profile || !parsed || !suggestions || typeof suggestions !== "object") {
						throw new Error("模板解析结果不完整，请确认文件是有效的 .pptx 后重试");
					}
					const initialMapping = Object.fromEntries(Object.entries(suggestions).map(([role, suggestion]) => {
						if (!suggestion?.layoutId) throw new Error(`模板解析结果缺少「${role}」版式映射`);
						return [role, suggestion.layoutId];
					}));
					// React 17 不会批处理异步回调中的连续状态更新。必须先写 mapping，
					// 再切换到 staged 视图，否则首次渲染会读取 null["cover"]。
					setMapping(initialMapping);
					setStaged({ profile, parsed, suggestions });
					setBusy(false);
				} catch (reason) { setError(reason.message); setBusy(false); }
			};
			const confirm = async () => {
				setBusy(true); setError("");
				try {
					if (!mapping) throw new Error("版式映射尚未准备完成，请稍后重试");
					const result = await call("templates_confirm", { request: { id: staged.profile.id, version: staged.profile.version, mapping: Object.fromEntries(Object.entries(mapping).map(([role, layoutId]) => [role, { layoutId }])) } });
					if (!result.ok) throw new Error(`模板映射无效：${(result.problems || []).join("；")}`);
					onDone(result.profile?.id || staged.profile.id);
				} catch (reason) { setError(reason.message); } finally { setBusy(false); }
			};
			if (!staged) {
				// 上传步骤
				return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "导入 PPT 模板"), h("span", { className: "ib-chip" }, "先解析，再映射")),
					h("div", { className: "ib-req" }, h("div", { className: "ib-req" }, h("label", null, "模板编号（英文小写）"), h("input", { value: form.id, placeholder: "lab-ppt-v3", onChange: field("id") })), h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, placeholder: "课题组组会模板", onChange: field("name") })), h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })), h("div", { className: "ib-req" }, h("label", null, "用途"), h("input", { value: form.purpose, placeholder: "组会汇报 / 论文答辩", onChange: field("purpose") })), h("div", { className: "ib-req" }, h("label", null, ".pptx 文件"), h("input", { type: "file", accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation", onChange: readFile }))),
					error ? h("div", { className: "ib-error" }, error) : null,
					h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || (!form.file || !form.id || !form.name), onClick: () => void doImport() }, busy ? "解析中…" : "解析并生成映射")));
			}
			// 已解析：确认每个版式角色 → 布局 → 发布
			const roles = staged.profile.layoutRoleMapping ? Object.keys(staged.profile.layoutRoleMapping) : [];
			const roleRows = roles.map((role) => h("div", { className: "ib-table-row", key: role },
				h("span", { className: "ib-tm-key", style: { flex: 1 } }, role),
				h("select", { style: { flex: 1, marginRight: 8 }, value: mapping?.[role] || "", onChange: (e) => setMapping((old) => ({ ...(old || {}), [role]: e.target.value })) }, (staged.parsed?.layouts || []).map((l) => h("option", { value: l.id, key: l.id }, `${l.name || l.id}（${(l.placeholders || []).map((p) => p.type).join("+") || "空"}）`))),
				h("span", { className: "ib-sub", style: { flex: 1 } }, (staged.suggestions && staged.suggestions[role] && staged.suggestions[role].reason) || "")
			));
			return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `确认「${staged.profile.name}」角色映射`), h("span", { className: "ib-chip" }, `${staged.parsed?.layoutCount || "?"} 个布局`)),
				h("div", { className: "ib-lit-note" }, "自动映射已按布局占位符特征生成，可逐角色调整；映射无效会明确拒绝并保持草稿状态，不会静默替换为默认模板。"),
				h("div", { className: "ib-table" }, [h("div", { className: "ib-table-head" }, h("span", { style: { flex: 1 } }, "角色"), h("span", { style: { flex: 1 } }, "布局"), h("span", { style: { flex: 1 } }, "说明")), ...roleRows]),
				error ? h("div", { className: "ib-error" }, error) : null,
				h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void confirm() }, busy ? "发布中…" : "确认映射并发布到可用")));
		}

		/** PPT 模板元数据编辑（名称/受众/用途/备注要求/最大页数）。 */
export function MetaEditor({ call, initial, onCancel, onSaved }) {
			const [form, setFormTemp] = useState({ name: initial.name || "", purpose: initial.purpose || "", audience: initial.audience || "", notesRequirement: initial.notesRequirement || "", maxPages: initial.maxPages ?? "" });
			const [busy, setBusyTemp] = useState(false);
			const [error, setErrorTemp] = useState("");
			const field = (key) => (event) => setFormTemp((old) => ({ ...old, [key]: event.target.value }));
			const save = async () => {
				setBusyTemp(true); setErrorTemp("");
				try {
					if (!form.name.trim()) throw new Error("请填写模板名称");
					await onSaved({ id: initial.id, ...form });
				} catch (reason) { setErrorTemp(reason.message); } finally { setBusyTemp(false); }
			};
			return h("section", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `编辑「${initial.id}」元数据`), h("span", { className: "ib-chip" }, `当前 v${initial.version}`)),
				h("div", { className: "ib-req", style: { display: "grid", gap: 8 } }, h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, onChange: field("name") })), h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })), h("div", { className: "ib-req" }, h("label", null, "用途"), h("input", { value: form.purpose, onChange: field("purpose") })), h("div", { className: "ib-req" }, h("label", null, "备注/讲稿要求"), h("input", { value: form.notesRequirement, onChange: field("notesRequirement") })), h("div", { className: "ib-req" }, h("label", null, "最大页数"), h("input", { type: "number", value: form.maxPages, onChange: field("maxPages") }))),
				error ? h("div", { className: "ib-error" }, error) : null,
				h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void save() }, busy ? "保存中…" : "保存"))
			);
		}

		/** 实验室烧瓶 SVG（配色与课题面板一致：#023373 主题主体 + 浅蓝气泡）。 */
export function FlaskSvg({ width = 18, height = 18 }) {
			return h("svg", { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
				h("path", { d: "M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3", stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }),
				h("path", { d: "M7 16h10l-2.4-3.4h-5.2L7 16Z", fill: "#eafff6", opacity: 0.9 }),
				h("circle", { cx: 12, cy: 13.2, r: 0.55, fill: "#73dce6" }),
				h("circle", { cx: 13.6, cy: 15, r: 0.4, fill: "#73dce6" })
			);
		}

		/** 图书图标（文献条目 PDF 按钮）：未提交灰色，提交后随按钮点亮。 */
export function BookSvg({ width = 15, height = 15 }) {
			return h("svg", { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
				h("path", { d: "M12 6.5C10.2 4.9 7.7 4.2 4 4.2v13.6c3.7 0 6.2.7 8 2.3 1.8-1.6 4.3-2.3 8-2.3V4.2c-3.7 0-6.2.7-8 2.3Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
				h("path", { d: "M12 6.5v13.6", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
			);
		}

		/** SI 补充材料图标（文献条目 SI 按钮）：文档 + 加号，表示 Supplementary Information。 */
export function SiSvg({ width = 15, height = 15 }) {
			return h("svg", { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
				h("path", { d: "M6 3h8l4 4v14H6V3Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
				h("path", { d: "M14 3v4h4", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
				h("path", { d: "M12 8.5v6M9 11.5h6", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
			);
		}
