window.__ModuleLoader__.load({ id: "@ibm-lab/knowledge", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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

// plugins/knowledge/client/src/entry.js
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

// client/src/sdk.js
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取文件：${file?.name ?? "未命名"}`));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error(`无法编码文件：${file?.name ?? "未命名"}`));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
function injectStyle(id, css) {
  if (typeof document === "undefined" || document.head === void 0) return () => {
  };
  const previous = document.getElementById(id);
  if (previous !== null) previous.remove();
  const style = document.createElement("style");
  style.id = id;
  style.textContent = String(css ?? "");
  document.head.appendChild(style);
  return () => {
    if (style.parentNode !== null) style.remove();
  };
}

// plugins/knowledge/client/src/panel.js
var import_react9 = require("react");
var import_react_dom2 = require("react-dom");
var roles = { original: "论文正文", reading_note: "精读笔记", metadata_note: "题录资料", supplement: "补充材料", thesis: "学位论文" };
function knowledgeLocator(loc) {
  if (!loc) return "原文件";
  if (loc.kind === "pdf") return `PDF 第 ${loc.page} 页`;
  if (loc.kind === "text") return `第 ${loc.lineStart}–${loc.lineEnd} 行`;
  if (loc.kind === "docx") return `第 ${loc.paragraphStart}–${loc.paragraphEnd} 段`;
  if (loc.kind === "pptx") return `第 ${loc.slide} 张幻灯片`;
  return "原文件";
}
function KnowledgePanel({ project, call, openChat, conversation, activeSessionId, headerTarget }) {
  const [keys, setKeys] = useProjectViewValue(project.id, "knowledge-keys", null), [role, setRole] = useProjectViewValue(project.id, "knowledge-role", "");
  const [state2, setState] = (0, import_react9.useState)(null), [sessionId, setSessionId] = (0, import_react9.useState)(null), [chat, setChat] = (0, import_react9.useState)(null);
  const [settingsOpen, setSettingsOpen] = (0, import_react9.useState)(false), [sourcesOpen, setSourcesOpen] = (0, import_react9.useState)(false), [sourceTurn, setSourceTurn] = (0, import_react9.useState)(null);
  const [error, setError] = (0, import_react9.useState)(""), [notice, setNotice] = (0, import_react9.useState)(""), [busy, setBusy] = (0, import_react9.useState)(false), [opening, setOpening] = (0, import_react9.useState)(true), [dragging, setDragging] = (0, import_react9.useState)(false);
  const [yearFrom, setYearFrom] = (0, import_react9.useState)(""), [yearTo, setYearTo] = (0, import_react9.useState)("");
  const input = (0, import_react9.useRef)(null), alive = (0, import_react9.useRef)(true), selectionRevision = (0, import_react9.useRef)(0), selection = (0, import_react9.useRef)(null);
  selection.current = { keys: keys ?? state2?.libraries.filter((item) => item.scope === "project").map((item) => item.key) ?? [], role, yearFrom, yearTo };
  (0, import_react9.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load2 = async () => {
    const data = await call("knowledge_state", { request: { projectId: project.id } });
    if (alive.current) setState(data);
    return data;
  };
  const start = async (fresh = false) => {
    setOpening(true);
    setError("");
    try {
      const data = state2 ?? await load2(), settings = { ...selection.current, keys: keys ?? data.libraries.filter((item) => item.scope === "project").map((item) => item.key) };
      const result2 = await openChat(settings, { fresh });
      if (!alive.current) return;
      setSessionId(result2.sessionId);
      setChat(result2.chat ?? null);
      setSourceTurn(null);
      if (result2.chat?.settings) {
        setKeys(result2.chat.settings.keys);
        setRole(result2.chat.settings.role || "");
        setYearFrom(result2.chat.settings.yearFrom || "");
        setYearTo(result2.chat.settings.yearTo || "");
      }
    } catch (reason) {
      if (alive.current) setError(reason.message);
    } finally {
      if (alive.current) setOpening(false);
    }
  };
  (0, import_react9.useEffect)(() => {
    void start(false);
  }, [project.id]);
  (0, import_react9.useEffect)(() => {
    let active = true, inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [data, status] = await Promise.all([call("knowledge_state", { request: { projectId: project.id } }), sessionId ? call("knowledge_chat_state", { request: { projectId: project.id, sessionId } }) : Promise.resolve(null)]);
        if (active) {
          setState(data);
          if (status) setChat(status.chat);
        }
      } catch (reason) {
        if (active) setError(reason.message);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(refresh, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [call, project.id, sessionId]);
  const selected = selection.current.keys, libraries = state2?.libraries ?? [], connected = Boolean(sessionId && sessionId === activeSessionId);
  const update = async (next) => {
    const revision = ++selectionRevision.current;
    setError("");
    if (!sessionId) return;
    try {
      await call("knowledge_chat_bind", { request: { projectId: project.id, sessionId, ...selection.current, ...next } });
      if (alive.current && revision === selectionRevision.current) setNotice("问答范围已更新，下一条消息将使用新的资料范围。");
    } catch (reason) {
      if (alive.current && revision === selectionRevision.current) setError(reason.message);
    }
  };
  const mutate = async (method, message) => {
    setBusy(true);
    setError("");
    try {
      const value = await call(method, { request: { projectId: project.id } });
      if (!value.cancelled) {
        await load2();
        if (alive.current) setNotice(message);
      }
    } catch (reason) {
      if (alive.current) setError(reason.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const upload = async (files) => {
    setDragging(false);
    if (busy) return;
    setBusy(true);
    setError("");
    let count = 0;
    const errors = [];
    for (const file of Array.from(files ?? [])) {
      try {
        if (!/\.(pdf|docx|pptx|md|markdown|txt)$/i.test(file.name)) throw Error("支持 PDF、DOCX、PPTX、Markdown、TXT");
        if (file.size > 25 * 1024 * 1024) throw Error("单个文件超过 25 MB");
        await call("knowledge_upload", { request: { projectId: project.id, fileName: file.name, base64: await fileToBase64(file) } });
        count++;
      } catch (reason) {
        errors.push(file.name + "：" + reason.message);
      }
    }
    try {
      await load2();
    } catch (reason) {
      errors.push(reason.message);
    }
    if (alive.current) {
      setNotice(count ? `已导入 ${count} 份资料，正在更新索引。` : "");
      setError(errors.join("\n"));
      setBusy(false);
    }
  };
  const open = async (source, action) => {
    try {
      await call("knowledge_open_source", { request: { projectId: project.id, libraryKey: source.libraryKey, sourceId: source.sourceId, page: source.locator?.kind === "pdf" ? source.locator.page : void 0, action } });
    } catch (reason) {
      setError(reason.message);
    }
  };
  const fileDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const drag = (event) => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    event.dataTransfer.dropEffect = "copy";
  };
  const result = sourceTurn === null ? chat?.retrieval : chat?.retrievals?.find((item) => item.turn === sourceTurn)?.result;
  const cite = (event) => {
    const link = event.target.closest?.("a");
    if (!link) return;
    const match = /#ibm-rag-(\d+)-(S\d+)$/.exec(link.getAttribute("href") ?? "");
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    setSourceTurn(Number(match[1]));
    setSourcesOpen(true);
  };
  const controls = h("div", { className: "ib-knowledge-actions", "aria-label": "知识库问答操作" }, h("button", { className: "ib-act", disabled: opening, onClick: () => void start(true) }, "新建问答"), h("button", { className: "ib-act", "aria-expanded": sourcesOpen, onClick: () => {
    setSourceTurn(null);
    setSourcesOpen((value) => !value);
  } }, "回答来源"), h("button", { className: "ib-act", "aria-expanded": settingsOpen, onClick: () => setSettingsOpen((value) => !value) }, "知识库设置"));
  return h(
    "section",
    { className: "ib-knowledge ib-knowledge-qa", "aria-label": "知识库问答", onDragEnter: drag, onDragOver: drag, onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
    }, onDrop: (event) => {
      if (fileDrag(event)) {
        event.preventDefault();
        event.stopPropagation();
        void upload(event.dataTransfer.files);
      }
    } },
    headerTarget ? (0, import_react_dom2.createPortal)(controls, headerTarget) : controls,
    error ? h("div", { className: "ib-error", role: "alert" }, error) : null,
    notice ? h("div", { className: "ib-knowledge-notice", role: "status" }, notice, h("button", { "aria-label": "关闭提示", onClick: () => setNotice("") }, "×")) : null,
    settingsOpen ? h(
      "div",
      { className: "ib-knowledge-settings", "aria-label": "知识库设置" },
      h("div", { className: "ib-knowledge-toolbar" }, h("b", null, "选择问答资料"), h("div", null, h("button", { className: "ib-act", disabled: busy, onClick: () => input.current?.click() }, "上传资料"), h("button", { className: "ib-act", disabled: busy, onClick: () => void mutate("knowledge_sync", "正在后台更新课题索引。") }, "更新课题索引"), h("button", { className: "ib-act", disabled: busy, onClick: () => void mutate("knowledge_attach", "已关联知识库，请勾选后提问。") }, "关联已有知识库"))),
      h("div", { className: "ib-knowledge-libraries" }, libraries.map((base) => h("label", { className: "ib-knowledge-base", key: base.key, "data-selected": selected.includes(base.key) || void 0 }, h("input", { type: "checkbox", disabled: base.unavailable, checked: selected.includes(base.key), onChange: (event) => {
        const next = event.target.checked ? [...selected, base.key] : selected.filter((key) => key !== base.key);
        setKeys(next);
        void update({ keys: next });
      } }), h("div", null, h("b", null, base.name), h("small", null, `${base.label} · ${base.documentCount ?? 0} 个文档`), base.syncStatus?.state === "running" ? h("span", { className: "ib-knowledge-progress" }, `正在索引 ${base.syncStatus.completedFiles}/${base.syncStatus.totalFiles}`) : null, base.error ? h("small", { className: "ib-error" }, base.error) : null)))),
      h("div", { className: "ib-knowledge-filters" }, h("select", { "aria-label": "资料类型", value: role, onChange: (event) => {
        setRole(event.target.value);
        void update({ role: event.target.value });
      } }, h("option", { value: "" }, "全部资料类型"), Object.entries(roles).map(([value, label]) => h("option", { value, key: value }, label))), h("input", { type: "number", "aria-label": "起始年份", placeholder: "起始年份", value: yearFrom, onChange: (event) => setYearFrom(event.target.value), onBlur: () => void update({ yearFrom }) }), h("span", null, "–"), h("input", { type: "number", "aria-label": "结束年份", placeholder: "结束年份", value: yearTo, onChange: (event) => setYearTo(event.target.value), onBlur: () => void update({ yearTo }) })),
      h("small", null, "每次提问都会检索所选资料。可拖入文档，单个文件不超过 25 MB。")
    ) : null,
    h("input", { ref: input, type: "file", multiple: true, accept: ".pdf,.docx,.pptx,.md,.markdown,.txt", hidden: true, "aria-label": "上传知识库资料", onChange: (event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void upload(files);
    } }),
    h(
      "div",
      { className: "ib-knowledge-chat-body", "data-sources": sourcesOpen || void 0 },
      h("div", { className: "ib-knowledge-chat-main" }, opening ? h("div", { className: "ib-knowledge-empty" }, "正在打开知识库问答…") : !connected ? h("div", { className: "ib-knowledge-empty" }, h("p", null, "继续基于知识库提问，并保留本次问答上下文。"), h("button", { className: "ib-act", onClick: () => void start(false) }, "进入知识库问答")) : h("div", { className: "ib-wb-conversation ib-knowledge-conversation", onClickCapture: cite }, conversation)),
      sourcesOpen ? h("aside", { className: "ib-knowledge-evidence", "aria-label": "回答来源" }, h("header", null, h("b", null, sourceTurn === null ? "最近一轮来源" : `第 ${sourceTurn} 轮来源`), h("button", { className: "ib-act", onClick: () => setSourcesOpen(false), "aria-label": "关闭回答来源" }, "×")), chat?.retrievalStatus === "searching" && sourceTurn === null ? h("p", { role: "status" }, "正在检索知识库…") : null, chat?.retrievalError ? h("div", { className: "ib-error" }, chat.retrievalError) : null, !result?.sources?.length ? h("p", { className: "ib-knowledge-help" }, "提问后会显示本轮检索的证据。没有相关资料时，助手会说明依据不足。") : null, (result?.sources ?? []).map((source) => h("article", { className: "ib-knowledge-source", key: source.libraryKey + ":" + source.chunkId }, h("header", null, h("span", { className: "ib-knowledge-citation" }, `[${source.citationId}]`), h("h3", null, source.literature?.title || source.fileName)), h("div", { className: "ib-knowledge-source-meta" }, h("span", null, source.knowledgeBaseName), h("span", null, knowledgeLocator(source.locator))), h("p", { className: "ib-knowledge-snippet" }, source.snippet), h("footer", null, source.locator?.kind === "pdf" ? h("button", { className: "ib-act", onClick: () => void open(source, "preview") }, "预览原文") : null, h("button", { className: "ib-act", onClick: () => void open(source, "reveal") }, "定位文件"))))) : null
    ),
    dragging ? h("div", { className: "ib-knowledge-drop", role: "status" }, "松开以加入当前课题知识库") : null
  );
}

// plugins/knowledge/client/src/knowledge.css.js
var knowledgeCss = `
.ib-wb[data-knowledge] .ib-wb-content.ib-overlay{overflow:hidden;padding-top:12px}.ib-wb[data-knowledge] .ib-wb-project-holder{height:100%}
.ib-overlay .ib-knowledge-qa{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ib-knowledge-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:none}.ib-wb .ib-knowledge-actions .ib-act{font:16px/1.4 Arial,'Microsoft YaHei',sans-serif;min-height:38px;padding:8px 12px;border:1px solid var(--ib-line);border-radius:8px;color:var(--ib-text);background:var(--ib-panel);cursor:pointer}.ib-wb .ib-knowledge-actions .ib-act:hover{border-color:var(--ib-accent);background:var(--ib-accent-soft)}.ib-wb .ib-knowledge-actions .ib-act:disabled{opacity:.5;cursor:default}.ib-wb .ib-knowledge-actions .ib-act:focus-visible{outline:2px solid var(--ib-accent);outline-offset:2px}.ib-wb[data-knowledge] .ib-wb-page-head{flex-wrap:wrap}.ib-wb-page-actions{margin-left:auto;align-self:center}
.ib-knowledge-conversation [class*="_header"]:has([data-conversation-header-corner]),.ib-knowledge-conversation [data-conversation-tabs]{display:none!important}
.ib-knowledge-conversation button[title^="选择新任务使用"],.ib-knowledge-conversation button[aria-label^="访问模式"]{display:none!important}
.ib-overlay .ib-knowledge-settings{flex:none;max-height:45%;overflow:auto;padding:16px;border-bottom:1px solid var(--ib-line);background:var(--ib-panel)}.ib-overlay .ib-knowledge-settings .ib-knowledge-toolbar{margin-bottom:12px}.ib-overlay .ib-knowledge-settings .ib-knowledge-libraries{display:flex;flex-wrap:wrap;gap:10px}.ib-overlay .ib-knowledge-settings .ib-knowledge-base{min-width:180px;margin:0;flex:1}.ib-overlay .ib-knowledge-settings>small{display:block;margin-top:10px;color:var(--ib-muted);font-size:13px}
.ib-overlay .ib-knowledge-chat-body{position:relative;display:grid;grid-template-columns:minmax(0,1fr);flex:1;min-height:0;overflow:hidden}.ib-overlay .ib-knowledge-chat-body[data-sources]{grid-template-columns:minmax(0,1fr) 330px}.ib-overlay .ib-knowledge-chat-main{min-width:0;min-height:0;display:flex;flex-direction:column}.ib-overlay .ib-knowledge-conversation{height:100%;flex:1;min-height:0;--dsh-conversation-max-width:860px;--dsh-composer-card-max-width:860px}
.ib-overlay .ib-knowledge-evidence{min-width:0;overflow:auto;padding:16px;border-left:1px solid var(--ib-line);background:var(--ib-panel)}.ib-overlay .ib-knowledge-evidence>header{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-16px;padding:10px 0;background:var(--ib-panel);z-index:1}.ib-overlay .ib-knowledge-evidence .ib-knowledge-source h3{font-size:15px}.ib-overlay .ib-knowledge-evidence .ib-knowledge-snippet{font-size:14px}.ib-overlay .ib-knowledge-evidence footer{justify-content:flex-start}
.ib-overlay .ib-knowledge-notice{display:flex;justify-content:space-between;align-items:center;gap:12px;flex:none}.ib-overlay .ib-knowledge-notice button{border:0;background:transparent;color:inherit;font-size:20px}.ib-overlay .ib-knowledge-qa>.ib-error{flex:none;margin:8px 0}.ib-overlay .ib-knowledge-chat-main>.ib-knowledge-empty{margin:auto 20px}.ib-overlay .ib-knowledge-qa .ib-wb-conversation .ib-hero-avatar{width:56px;height:56px}
@container(max-width:850px){.ib-overlay .ib-knowledge-chat-body[data-sources]{grid-template-columns:minmax(0,1fr)}.ib-overlay .ib-knowledge-evidence{position:absolute;right:0;top:0;bottom:0;width:min(360px,85%);box-sizing:border-box;z-index:8;box-shadow:-10px 0 30px #0001}}
.ib-overlay .ib-knowledge{position:relative;min-height:100%;font-size:15px;container-type:inline-size;box-sizing:border-box}
.ib-overlay .ib-knowledge-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.ib-overlay .ib-knowledge-toolbar>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ib-overlay .ib-knowledge-toolbar span{color:var(--ib-muted);font-size:13px}
.ib-overlay .ib-knowledge-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px}.ib-overlay .ib-knowledge-main{min-width:0}
.ib-overlay .ib-knowledge-libraries h2{font-size:16px;margin:0 0 12px}.ib-overlay .ib-knowledge-base{display:flex;align-items:flex-start;gap:10px;padding:14px 12px;border:1px solid var(--ib-line);border-radius:10px;margin-bottom:10px;cursor:pointer;overflow-wrap:anywhere}.ib-overlay .ib-knowledge-base[data-selected]{border-color:var(--ib-accent);background:var(--ib-accent-soft)}
.ib-overlay .ib-knowledge-base input{accent-color:var(--ib-accent);margin-top:4px}.ib-overlay .ib-knowledge-base b,.ib-overlay .ib-knowledge-base span,.ib-overlay .ib-knowledge-base small{display:block}.ib-overlay .ib-knowledge-base b{font-size:15px}.ib-overlay .ib-knowledge-base small,.ib-overlay .ib-knowledge-base span{font-size:13px;margin-top:5px;color:var(--ib-muted)}.ib-overlay .ib-knowledge-base .ib-knowledge-progress{color:var(--ib-accent-ink)}
.ib-overlay .ib-knowledge-help{font-size:13px;line-height:1.8;color:var(--ib-muted)}.ib-overlay .ib-knowledge-search label{display:block;font-weight:650;margin-bottom:10px}.ib-overlay .ib-knowledge-query-line{display:flex;gap:8px}.ib-overlay .ib-knowledge-query-line input{flex:1;min-width:0}
.ib-overlay .ib-knowledge input:not([type=checkbox]):not([type=file]),.ib-overlay .ib-knowledge select{background:var(--ib-panel);color:var(--ib-text);border:1px solid var(--ib-line);border-radius:8px;padding:10px 12px;font:inherit;box-sizing:border-box}.ib-overlay .ib-knowledge-query-line input:focus{outline:2px solid var(--ib-accent);outline-offset:1px}
.ib-overlay .ib-knowledge-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.ib-overlay .ib-knowledge-filters input{width:115px}.ib-overlay .ib-knowledge-filters select{max-width:100%}
.ib-overlay .ib-knowledge-results-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 12px;flex-wrap:wrap}.ib-overlay .ib-knowledge-results-head [data-primary=true]{background:var(--ib-accent);color:white;border-color:var(--ib-accent)}
.ib-overlay .ib-knowledge-empty{padding:45px 20px;border:1px dashed var(--ib-line);border-radius:12px;color:var(--ib-muted);line-height:1.8;text-align:center}.ib-overlay .ib-knowledge-source{padding:18px 0;border-bottom:1px solid var(--ib-line)}.ib-overlay .ib-knowledge-source header{display:flex;align-items:baseline;gap:10px}.ib-overlay .ib-knowledge-source h3{font-size:17px;line-height:1.55;margin:0;overflow-wrap:anywhere}.ib-overlay .ib-knowledge-citation{flex-shrink:0;color:var(--ib-accent-ink);font-weight:700}
.ib-overlay .ib-knowledge-source-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--ib-muted);font-size:13px;margin:9px 0}.ib-overlay .ib-knowledge-snippet{font-size:15px;white-space:pre-wrap;line-height:1.85;overflow-wrap:anywhere;margin:12px 0}.ib-overlay .ib-knowledge-source footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.ib-overlay .ib-knowledge-source footer small{font-size:12px;color:var(--ib-muted);overflow-wrap:anywhere;flex:1;min-width:120px}.ib-overlay .ib-knowledge-source footer>div{display:flex;gap:8px}
.ib-overlay .ib-knowledge-notice{padding:12px 16px;margin-bottom:16px;border-radius:8px;background:var(--ib-accent-soft);color:var(--ib-accent-ink);font-size:14px}.ib-overlay .ib-knowledge .ib-error{font-size:14px}.ib-overlay .ib-knowledge-drop{position:absolute;inset:0;z-index:6;border:2px dashed var(--ib-accent);border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ib-panel) 94%,var(--ib-accent));color:var(--ib-accent-ink);font-size:20px;pointer-events:none}
@container(max-width:760px){.ib-overlay .ib-knowledge-layout{grid-template-columns:minmax(0,1fr);gap:16px}.ib-overlay .ib-knowledge-libraries{display:flex;align-items:stretch;flex-wrap:wrap;gap:10px}.ib-overlay .ib-knowledge-libraries h2{width:100%;margin-bottom:0}.ib-overlay .ib-knowledge-base{flex:1;min-width:180px;margin:0}.ib-overlay .ib-knowledge-help{width:100%;margin:0}.ib-overlay .ib-knowledge-toolbar{margin-bottom:16px}}
`;

// plugins/knowledge/client/src/entry.js
var inject = ["remote"];
function apply() {
  const disposeStyle = injectStyle("ibm-lab-knowledge-style", knowledgeCss);
  const disposeModule = registerWorkbenchModule({
    id: "knowledge",
    label: "RAG 知识库",
    icon: "layers",
    caption: "基于知识库资料回答，支持连续追问与来源核对",
    order: 20,
    override: true,
    render: (props) => h(KnowledgePanel, props)
  });
  return () => {
    disposeModule();
    disposeStyle();
  };
}
exports.apply = apply; exports.inject = inject; return module.exports; } });
