window.__ModuleLoader__.load({ id: "@ibm-lab/polishing", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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

// plugins/polishing/client/src/entry.js
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

// plugins/polishing/client/src/panel.js
function PolishingPanel() {
  return h(
    "section",
    { className: "ib-wb-writing", "aria-label": "论文润色" },
    h("h2", null, "论文润色"),
    h("p", null, "此功能正在规划中，暂不可用。"),
    h("p", null, "规划中的能力：选中文本改写、期刊风格检查、修改前后对照、结果归档到课题工作区。"),
    h("p", null, "当前不会读取或修改你的稿件；已保存的润色草稿仍可在项目「草稿」目录查看。")
  );
}

// plugins/polishing/client/src/entry.js
var inject = ["remote"];
function apply() {
  return registerWorkbenchModule({
    id: "polishing",
    label: "论文润色",
    icon: "pen",
    caption: "功能规划中",
    order: 60,
    override: true,
    render: () => h(PolishingPanel)
  });
}
exports.apply = apply; exports.inject = inject; return module.exports; } });
