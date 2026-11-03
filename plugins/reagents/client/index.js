window.__ModuleLoader__.load({ id: "@ibm-lab/reagents", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/reagents/client/src/entry.js
var entry_exports = {};
__export(entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(entry_exports);

// client/src/h.js
var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;

// client/src/project-view-state.js
var import_react2 = require("react");
var cache = /* @__PURE__ */ new Map();
var viewKey = (projectId, field) => `ib-project-view:${encodeURIComponent(projectId)}:${field}`;
function readValue(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const value = JSON.parse(raw);
      if (typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value) && value >= 0)) {
        cache.set(key, value);
        return value;
      }
    }
  } catch {
  }
  return cache.has(key) ? cache.get(key) : fallback;
}
function writeValue(key, value) {
  cache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function useProjectViewValue(projectId, field, fallback) {
  const key = viewKey(projectId, field);
  const [state2, setState] = (0, import_react2.useState)(() => ({ key, value: readValue(key, fallback) }));
  const value = state2.key === key ? state2.value : readValue(key, fallback);
  if (state2.key !== key) setState({ key, value });
  const update = (0, import_react2.useCallback)((next) => {
    const value2 = typeof next === "function" ? next(readValue(key, fallback)) : next;
    writeValue(key, value2);
    setState({ key, value: value2 });
  }, [key, fallback]);
  return [value, update];
}

// client/src/plugin-switches.js
var STORAGE_KEY = "ibm-lab:plugin-soft";
function load() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
var state = load();

// client/src/module-registry.js
var REGISTRY_KEY = Symbol.for("ibm.lab.workbench");
function store() {
  const existing = globalThis[REGISTRY_KEY];
  if (existing !== void 0) return existing;
  const created = { modules: /* @__PURE__ */ new Map(), listeners: /* @__PURE__ */ new Set() };
  globalThis[REGISTRY_KEY] = created;
  return created;
}
function notify(state2) {
  for (const listener of [...state2.listeners]) {
    try {
      listener();
    } catch {
    }
  }
}
function registerWorkbenchModule(module2) {
  if (module2 === null || typeof module2 !== "object") throw new TypeError("工作台模块必须是对象");
  if (typeof module2.id !== "string" || module2.id.length === 0) throw new TypeError("工作台模块缺少 id");
  if (typeof module2.label !== "string" || module2.label.length === 0) throw new TypeError(`工作台模块 ${module2.id} 缺少 label`);
  if (typeof module2.render !== "function") throw new TypeError(`工作台模块 ${module2.id} 缺少 render 组件`);
  const state2 = store();
  const row = Object.freeze({ caption: "", icon: "file", order: 100, override: false, ...module2 });
  state2.modules.set(row.id, row);
  notify(state2);
  return () => {
    if (state2.modules.get(module2.id)?.label === row.label && state2.modules.get(module2.id)?.render === row.render) {
      state2.modules.delete(module2.id);
      notify(state2);
    }
  };
}

// client/src/panel-registry.js
var REGISTRY_KEY2 = Symbol.for("ibm.lab.project-panels");

// client/src/components-core.js
var import_react3 = __toESM(require("react"), 1);

// client/src/components-templates.js
var import_react4 = require("react");

// client/src/entry-conversation.js
var import_react5 = require("react");

// client/src/reading-context-menu.js
var import_react6 = require("react");
var import_react_dom = require("react-dom");

// client/src/reading-interactions.js
var import_react7 = require("react");

// client/src/reading-link-upload.js
var import_react8 = require("react");

// client/src/reader-host.js
var HOST_KEY = Symbol.for("ibm.lab.reader-host");

// plugins/reagents/client/src/panel.js
var import_react9 = require("react");
var import_react_dom2 = require("react-dom");
var kinds = { chemical: "化学试剂", biological: "生物试剂", cells: "细胞" };
var sourceTime = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "";
function ReagentPanel({ call }) {
  const [query, setQuery] = useProjectViewValue("_lab", "reagents-query", "");
  const [kind, setKind] = useProjectViewValue("_lab", "reagents-kind", "all");
  const [location2, setLocation] = (0, import_react9.useState)(""), [status, setStatus] = (0, import_react9.useState)("all"), [offset, setOffset] = (0, import_react9.useState)(0);
  const [data, setData] = (0, import_react9.useState)(null), [loading, setLoading] = (0, import_react9.useState)(true), [error, setError] = (0, import_react9.useState)(""), [busy, setBusy] = (0, import_react9.useState)(false), [revision, setRevision] = (0, import_react9.useState)(0), [selected, setSelected] = (0, import_react9.useState)(null);
  const force = (0, import_react9.useRef)(false);
  (0, import_react9.useEffect)(() => {
    let active = true, sequence = 0;
    const load2 = async () => {
      const id = ++sequence;
      setLoading(true);
      const refresh2 = force.current;
      force.current = false;
      try {
        const result = await call("reagents_search", { request: { query, kind, location: location2, status, offset, limit: 50, refresh: refresh2 } });
        if (active && id === sequence) {
          setData(result);
          setError("");
        }
      } catch (reason) {
        if (active && id === sequence) setError(reason.message);
      } finally {
        if (active && id === sequence) setLoading(false);
      }
    };
    const initial = setTimeout(load2, 180), timer = setInterval(load2, 2e4);
    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [call, query, kind, location2, status, offset, revision]);
  (0, import_react9.useEffect)(() => {
    if (!selected) return;
    const escape = (event) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selected]);
  const refresh = () => {
    force.current = true;
    setRevision((old) => old + 1);
  };
  const sourceAction = async (method, id) => {
    setBusy(true);
    setError("");
    try {
      const result = await call(method, { request: { id } });
      if (method === "reagents_choose_source" && !result.cancelled) {
        setOffset(0);
        refresh();
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const sources = data?.sources || Object.entries(kinds).map(([id, label]) => ({ id, label, configured: false, count: 0 }));
  const warnings = sources.filter((source) => source.error);
  return h(
    "section",
    { className: "ib-reagents", "aria-label": "试剂管理" },
    h(
      "div",
      { className: "ib-reagent-search" },
      h("label", { className: "ib-reagent-search-label", htmlFor: "ib-reagent-query" }, "检索清单"),
      h("div", { className: "ib-reagent-search-line" }, h("input", { id: "ib-reagent-query", type: "search", value: query, placeholder: "名称、CAS、货号、品牌或存放位置", onChange: (event) => {
        setQuery(event.target.value);
        setOffset(0);
      } }), h("button", { className: "ib-act", disabled: busy || loading, onClick: refresh }, "刷新清单"))
    ),
    h(
      "div",
      { className: "ib-reagent-filters" },
      h("div", { className: "ib-reagent-kinds", role: "group", "aria-label": "清单类型" }, [["all", "全部"], ...Object.entries(kinds)].map(([id, label]) => h("button", { key: id, className: "ib-act", "aria-pressed": kind === id, onClick: () => {
        setKind(id);
        setLocation("");
        setOffset(0);
      } }, label, h("span", null, String(data?.counts?.[id] ?? 0))))),
      h("label", null, h("span", null, "存放位置"), h("select", { "aria-label": "存放位置", value: location2, onChange: (event) => {
        setLocation(event.target.value);
        setOffset(0);
      } }, h("option", { value: "" }, "全部位置"), (data?.locations || []).map((value) => h("option", { value, key: value }, value)))),
      h("label", null, h("span", null, "清单标记"), h("select", { "aria-label": "清单标记", value: status, onChange: (event) => {
        setStatus(event.target.value);
        setOffset(0);
      } }, h("option", { value: "all" }, "全部标记"), h("option", { value: "unmarked" }, "未标记用完"), h("option", { value: "used" }, "已标记用完")))
    ),
    error ? h("div", { className: "ib-error", role: "alert" }, error) : null,
    warnings.map((source) => h("div", { className: "ib-reagent-source-warning", role: "status", key: source.id }, `${source.label}：${source.error}${source.stale ? "，当前显示上次读取的数据。" : "。"}`)),
    h(
      "details",
      { className: "ib-reagent-sources" },
      h("summary", null, "数据来源", h("span", null, `${sources.filter((s) => s.configured).length} 份清单 · 保存 Excel 后自动同步`)),
      sources.map((source) => h("div", { className: "ib-reagent-source", key: source.id }, h("div", null, h("b", null, source.label), h("span", { title: source.path }, source.fileName || "尚未关联清单"), h("small", null, source.configured ? `${source.count} 条${source.modifiedAt ? " · 文件更新 " + sourceTime(source.modifiedAt) : ""}` : "选择本机 Excel 文件"), (source.warnings || []).map((text) => h("small", { key: text }, text))), h("div", null, h("button", { className: "ib-act", disabled: busy || !source.configured, onClick: () => void sourceAction("reagents_open_source", source.id) }, "打开清单"), h("button", { className: "ib-act", disabled: busy, onClick: () => void sourceAction("reagents_choose_source", source.id) }, source.configured ? "更换清单" : "关联清单"))))
    ),
    h("div", { className: "ib-reagent-results-head", role: "status" }, h("b", null, loading ? "正在检索…" : `找到 ${data?.total || 0} 条`), h("span", null, "数量与用完标记按原表显示")),
    h("div", { className: "ib-reagent-results", "aria-busy": loading }, (data?.records || []).map((row) => h(
      "article",
      { className: "ib-reagent-row", key: row.id, "data-reagent-id": row.id },
      h("div", { className: "ib-reagent-main" }, h("button", { className: "ib-reagent-name", onClick: () => setSelected(row) }, row.name), h("div", { className: "ib-reagent-identifiers" }, row.cas ? h("span", null, (row.casAsDate ? "CAS 原表为日期：" : "CAS ") + row.cas) : null, row.catalogNumber ? h("span", null, "货号 " + row.catalogNumber) : null), h("small", null, `${kinds[row.kind]} · ${row.sheet} · 第 ${row.row} 行`)),
      h("div", { className: "ib-reagent-spec" }, h("span", null, row.spec || "规格未填写"), h("small", null, row.brand || "品牌未填写")),
      h("div", { className: "ib-reagent-place" }, h("small", null, "存放位置"), h("span", null, row.location)),
      h("div", { className: "ib-reagent-stock" }, h("span", null, row.quantity ? `${row.quantity}${row.unit && !row.quantity.includes(row.unit) ? " " + row.unit : ""}` : "数量未填写"), row.used ? h("small", { "data-used": true }, "已标记用完") : null),
      h("button", { className: "ib-act", onClick: () => setSelected(row), "aria-label": `查看 ${row.name} 详情` }, "详情")
    ))),
    !loading && !data?.records?.length ? h("div", { className: "ib-lit-empty" }, sources.every((s) => !s.configured) ? "请先展开“数据来源”，关联试剂清单。" : "没有匹配的条目，试试其他名称、CAS 或货号。") : null,
    data?.total > data?.limit ? h("div", { className: "ib-reagent-pagination" }, h("span", null, `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} / ${data.total}`), h("button", { className: "ib-act", disabled: loading || data.offset === 0, onClick: () => setOffset(Math.max(0, data.offset - data.limit)) }, "上一页"), h("button", { className: "ib-act", disabled: loading || data.offset + data.limit >= data.total, onClick: () => setOffset(data.offset + data.limit) }, "下一页")) : null,
    selected ? (0, import_react_dom2.createPortal)(h("div", { className: "ib-overlay ib-reagent-modal", onClick: (event) => {
      if (event.target === event.currentTarget) setSelected(null);
    } }, h("section", { className: "ib-reagent-detail", role: "dialog", "aria-modal": true, "aria-label": "试剂条目详情" }, h("header", null, h("h2", null, selected.name), h("button", { className: "ib-act", autoFocus: true, onClick: () => setSelected(null) }, "关闭")), h("p", null, `${selected.fileName} / ${selected.sheet} / 第 ${selected.row} 行`), h("dl", null, h("div", null, h("dt", null, "存放位置"), h("dd", null, selected.location)), selected.fields.map((field, index) => h("div", { key: index }, h("dt", null, field.label), h("dd", null, field.value, field.note ? h("small", null, field.note) : null)))), h("footer", null, h("button", { className: "ib-act", disabled: busy, onClick: () => void sourceAction("reagents_open_source", selected.sourceId) }, "打开原始清单")))), document.body) : null
  );
}

// plugins/reagents/client/src/entry.js
var inject = ["remote"];
function apply() {
  return registerWorkbenchModule({
    id: "reagents",
    label: "试剂管理",
    icon: "flask",
    caption: "化学试剂、生物试剂与细胞清单检索",
    order: 30,
    override: true,
    render: ({ call }) => h(ReagentPanel, { call })
  });
}
exports.apply = apply; exports.inject = inject; return module.exports; } });
