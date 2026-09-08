import React, { useState, useEffect, useRef } from "react";
import { h } from "./h.js";
import { StructureCard } from "./components-core.js";
import { openOfficeArtifact } from "./lib.js";
const labels = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败" };
const localDate = () => {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function CharacterizationPanel({ projectId, call, onSubmitTask, nmrRows = [] }) {
  const [tasks, setTasks] = useState([]), [plots, setPlots] = useState([]), [form, setForm] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const lock = useRef(false);
  const refresh = async () => {
    const [a, b] = await Promise.all([call("characterization_list", { request: { projectId } }), call("plot_records_list", { request: { projectId } })]);
    setTasks(a.tasks || []);
    setPlots(b.records || []);
  };
  useEffect(() => {
    let alive = true, timer;
    const poll = async () => {
      try {
        const [a, b] = await Promise.all([call("characterization_list", { request: { projectId } }), call("plot_records_list", { request: { projectId } })]);
        if (alive) {
          setTasks(a.tasks || []);
          setPlots(b.records || []);
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) timer = setTimeout(poll, 3e3);
      }
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, call]);
  const start = (kind) => {
    setError("");
    setForm({ id: `${kind}-${crypto.randomUUID()}`, kind, title: "", date: localDate(), inputPath: "", instructions: "", compoundName: "", smiles: "", nucleus: "1H", deuteratedSolvent: "" });
  };
  const change = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error("文件超过 40 MB，请先放入课题目录再填写路径");
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = () => rej(new Error("文件读取失败"));
        r.readAsDataURL(file);
      });
      const result = await call("project_file_upload", { request: { projectId, name: file.name, base64 } });
      const path = result.file?.sourcePath || result.file?.path;
      if (!path) throw new Error("上传结果未返回文件路径");
      setForm((old) => ({ ...old, inputPath: path }));
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  };
  const dispatch = async (result) => {
    try {
      await onSubmitTask(result.prompt);
    } catch (e) {
      await call("characterization_dispatch_failed", { request: { taskId: result.task.id, projectId, attempt: result.task.attempt, error: e.message } });
      throw e;
    }
  };
  const submit = async () => {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { compoundName, smiles, ...fields } = form;
      const result = await call("characterization_submit", { request: { ...fields, projectId, compound: compoundName ? { name: compoundName, smiles: smiles || void 0 } : void 0 } });
      if (result.task.status === "failed") throw new Error("任务提交失败，请在条目中点击重试");
      if (result.task.status === "queued") await dispatch(result);
      setForm(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const retry = async (row) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await call("characterization_retry", { request: { taskId: row.id, projectId } });
      await dispatch(result);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const open = async (row, slot, application) => {
    try {
      setNotice("正在打开…");
      const result = await openOfficeArtifact(`/api/lab-artifacts?kind=characterization&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(row.id)}&slot=${slot}`, application);
      setNotice(result.native ? `已请求 ${application === "word" ? "Word" : application === "mnova" ? "Mnova" : "Origin"} 打开文件` : "已下载文件；请在桌面版使用指定软件打开");
    } catch (e) {
      setError(e.message);
      setNotice("");
    }
  };
  const fileButton = (row, slot, text, app) => h("button", { className: "ib-btn", disabled: !row.artifacts?.[slot], title: row.artifacts?.[slot] ? `使用 ${app} 打开` : "任务完成后可打开", onClick: () => void open(row, slot, app) }, text);
  const renderRow = (row, kind) => h(
    "article",
    { className: "ib-characterization-row", key: row.id },
    kind === "nmr" ? h("div", { className: "ib-nmr-structure" }, row.compound?.smiles ? h(StructureCard, { entry: row.compound, compact: true }) : h("span", null, "结构待补充")) : null,
    h("div", { className: "ib-characterization-title" }, h("b", null, row.title || row.topic || row.compound?.name || row.name), h("time", null, row.date || row.createdAt?.slice(0, 10) || "日期待补充"), row.status && row.status !== "completed" ? h("small", null, labels[row.status] || "") : null),
    kind === "nmr" ? h(React.Fragment, null, fileButton(row, "spectrum", "核磁图", "mnova"), fileButton(row, "report", "报告", "word")) : fileButton(row, "origin", "绘图文件", "origin"),
    row.status === "failed" ? h("button", { className: "ib-btn", disabled: busy, onClick: () => void retry(row) }, "重试") : null,
    h("details", { className: "ib-entry-details" }, h("summary", null, "详情"), h("p", null, row.error || row.instructions || ""), kind === "nmr" ? h("p", null, `CAS ${row.compound?.casNumber || "待补充"} · ${row.nucleus || "1H"} · ${row.deuteratedSolvent || row.solvent || "氘代溶剂待补充"}`) : null, kind === "plot" ? h(PlotEdit, { row: plots.find((p) => p.id === row.id), call, onChanged: refresh, onError: setError }) : null)
  );
  const field = (key, label, type = "text") => h("label", { className: "ib-field" }, h("span", null, label), h("input", { type, value: form[key], onChange: change(key) }));
  return h(
    "div",
    { className: "ib-characterization" },
    error ? h("div", { className: "ib-error", role: "alert" }, error) : null,
    notice ? h("p", { role: "status" }, notice) : null,
    ...["nmr", "plot"].map((kind) => {
      const rows = tasks.filter((t) => t.kind === kind).map((t) => {
        const p = plots.find((p2) => p2.id === t.id);
        return kind === "plot" && p ? { ...t, title: p.topic, date: p.date } : t;
      });
      const legacy = (kind === "nmr" ? nmrRows : plots).filter((r) => !tasks.some((t) => t.id === r.id)).map((r) => ({ ...r, artifacts: kind === "nmr" ? { spectrum: r.spectrumPath, report: r.reportPath } : { origin: r.artifactPath } }));
      return h("section", { className: "ib-card", key: kind }, h("div", { className: "ib-card-head" }, h("h3", null, kind === "nmr" ? "核磁分析" : "科研绘图"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => start(kind) }, kind === "nmr" ? "提交核磁任务" : "提交绘图任务")), rows.length || legacy.length ? h("div", null, ...rows.map((r) => renderRow(r, kind)), ...legacy.map((r) => renderRow(r, kind))) : h("p", { className: "ib-muted" }, "任务完成后，文件会自动回填到这里。"));
    }),
    form ? h("section", { className: "ib-card ib-task-form", role: "dialog", "aria-label": "提交表征任务" }, h("h3", null, form.kind === "nmr" ? "提交核磁任务" : "提交绘图任务"), h("div", { className: "ib-form-grid" }, field("title", form.kind === "nmr" ? "名称" : "绘图主题"), field("date", "日期", "date"), h("label", { className: "ib-field" }, "上传数据文件（FID 目录请先压缩）", h("input", { type: "file", disabled: busy, onChange: upload })), field("inputPath", "课题目录内文件 / FID 目录路径"), form.kind === "nmr" ? h(React.Fragment, null, field("compoundName", "化合物名称"), field("smiles", "结构 SMILES"), field("nucleus", "谱核"), field("deuteratedSolvent", "氘代溶剂")) : null), h("label", { className: "ib-field" }, "分析 / 绘图要求", h("textarea", { value: form.instructions, onChange: change("instructions") })), h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", disabled: busy, onClick: () => setForm(null) }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || !form.title.trim() || !form.inputPath.trim() || !form.instructions.trim(), onClick: () => void submit() }, busy ? "提交中…" : "提交任务"))) : null
  );
}
function PlotEdit({ row, call, onChanged, onError }) {
  const [topic, setTopic] = useState(row?.topic || ""), [date, setDate] = useState(row?.date || "");
  if (!row) return null;
  return h("div", { className: "ib-entry-edit" }, h("input", { "aria-label": "绘图主题", value: topic, onChange: (e) => setTopic(e.target.value) }), h("input", { "aria-label": "绘图日期", type: "date", value: date, onChange: (e) => setDate(e.target.value) }), h("button", { className: "ib-btn", onClick: async () => {
    try {
      await call("plot_records_update", { request: { id: row.id, patch: { topic, date } } });
      await onChanged();
    } catch (e) {
      onError(e.message);
    }
  } }, "保存"));
}
