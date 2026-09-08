window.__ModuleLoader__.load({ id: "dsh-lab-agent", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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

// client/src/entry.js
var entry_exports = {};
__export(entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(entry_exports);

// client/src/theme.js
var themeCss = `
:root,.ib-overlay,body.ib-research-chat {--ib-bg:var(--dsw-alias-bg-base,#fff);--ib-panel:var(--dsw-alias-bg-layer-1,#f7f7f8);--ib-panel2:var(--dsw-alias-bg-layer-2,#eee);--ib-line:var(--dsw-alias-border-l2,#dcdfe5);--ib-text:var(--dsw-alias-label-primary,#202124);--ib-muted:var(--dsw-alias-label-secondary,#616670);--ib-green:var(--dsw-alias-brand-primary,#4d6bfe);--ib-cyan:var(--dsw-alias-brand-text,#4d6bfe);--ib-red:var(--dsw-alias-state-error-primary,#c33)}
@media(prefers-color-scheme:dark){:root,.ib-overlay,body.ib-research-chat{--ib-bg:var(--dsw-alias-bg-base,#18191b);--ib-panel:var(--dsw-alias-bg-layer-1,#232529);--ib-panel2:var(--dsw-alias-bg-layer-2,#303237);--ib-line:var(--dsw-alias-border-l2,#45474c);--ib-text:var(--dsw-alias-label-primary,#eceef1);--ib-muted:var(--dsw-alias-label-secondary,#b3b6bf)}}
.ib-overlay,body.ib-research-chat{font-family:Arial,"Microsoft YaHei","微软雅黑",sans-serif;color:var(--ib-text);background:var(--ib-bg)}
.ib-overlay :is(button,input,textarea,select),body.ib-research-chat :is(button,input,textarea){font-family:Arial,"Microsoft YaHei","微软雅黑",sans-serif!important}
.ib-overlay :is(input,textarea,select){color:var(--ib-text)!important;background:var(--ib-bg)!important;border-color:var(--ib-line)!important;font-size:13px;line-height:1.6}
.ib-overlay :is(button,summary){transition:background-color 160ms ease,border-color 160ms ease,transform 120ms ease;cursor:pointer}
.ib-overlay button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,var(--ib-panel2));border-color:var(--ib-green)}
.ib-overlay button:active:enabled{transform:translateY(1px)}
.ib-overlay :focus-visible{outline:2px solid var(--ib-green);outline-offset:3px}
.ib-overlay .ib-btn[data-primary=true],.ib-overlay .ib-preview-btn[data-primary=true]{box-shadow:none;background:var(--dsw-alias-button-primary-fill,var(--ib-green));color:var(--dsw-alias-label-primary-inverted,#fff);border-color:transparent}
.ib-overlay :is(.ib-error,[data-danger=true]){color:var(--ib-red)}
.ib-overlay :is(small,time,.ib-muted){color:var(--ib-muted)}
.ib-overlay :is(.ib-card,.ib-board){border-color:var(--ib-line);box-shadow:none}
.ib-overlay :is(.ib-empty,.ib-row,.ib-btn){font-size:13px}
.ib-overlay .sw-struct-card img,.ib-overlay .sw-struct-fallback{background:#fff!important;color:#333!important}
.ib-overlay .sw-struct-card{background:var(--ib-panel)}
.sw-step-chem-arrow{min-width:40px;flex:0 0 40px}.sw-step-chem{gap:16px}
.ib-memory-drawer{position:fixed;right:20px;top:90px;bottom:24px;width:min(600px,calc(100vw - 40px));z-index:1100;overflow:auto;background:var(--ib-panel);border:1px solid var(--ib-line);border-radius:14px;padding:16px;box-sizing:border-box;box-shadow:0 16px 50px #0003;animation:ib-panel-enter 160ms ease}
.ib-memory-drawer textarea{box-sizing:border-box;width:100%;min-height:42vh;border:1px solid var(--ib-line);border-radius:10px;padding:14px}.ib-memory-close{float:right;margin-bottom:12px}
.ib-characterization{display:grid;gap:16px}.ib-characterization h3{margin:0;font-size:16px}.ib-characterization-row{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--ib-line);flex-wrap:wrap}.ib-characterization-title{display:grid;gap:5px;flex:1;min-width:160px}.ib-characterization-title b{font-size:14px}.ib-characterization-title time{font-size:12px}.ib-nmr-structure{width:130px}.ib-nmr-structure .sw-struct-card{min-width:0;max-width:130px;border:0;padding:0}.ib-nmr-structure .sw-struct-card img{height:80px}.ib-nmr-structure .sw-struct-name{display:none}.ib-entry-details{font-size:12px}.ib-entry-edit{display:flex;flex-wrap:wrap;gap:8px;padding:10px 0}.ib-task-form{animation:ib-panel-enter 160ms ease}.ib-task-form textarea{width:100%;min-height:90px;box-sizing:border-box}.ib-task-form label{margin:10px 0}
.ib-overlay .ib-tab{background:var(--ib-bg);padding:14px 16px}.ib-overlay .ib-tab strong{font-size:14px}.ib-overlay .ib-tab span{font-size:12px;color:var(--ib-muted)}
.ib-overlay .ib-tab[data-active=true],.ib-overlay .ib-tm-tab[data-active=true]{background:var(--dsw-alias-button-ghost-active-fill,var(--ib-panel2));border-color:var(--dsw-alias-button-ghost-active-border,var(--ib-green));box-shadow:inset 0 -2px var(--ib-green)}
.ib-overlay .ib-project-copy p,.ib-overlay .ib-board-head p{font-size:12px;color:var(--ib-muted)}.ib-overlay .ib-board-head h2{font-size:16px}.ib-overlay .ib-btn{background:var(--ib-bg);box-shadow:none}
@keyframes ib-panel-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@media(max-width:720px){.ib-form-grid{grid-template-columns:1fr}.ib-project-head{flex-wrap:wrap}.ib-characterization-row{gap:8px}.ib-top{padding-inline:12px}.ib-frame{padding-inline:12px}}
@media(prefers-reduced-motion:reduce){.ib-overlay *,.ib-overlay *::before,.ib-overlay *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

// client/src/styles.js
function injectStyles() {
  let css = [
    ":root{--ib-bg:#06110f;--ib-panel:#0c1d19;--ib-panel2:#102720;--ib-line:rgba(129,205,178,.16);--ib-text:#eff9f5;--ib-muted:#88a69b;--ib-green:#51d4a3;--ib-cyan:#73dce6;--ib-red:#ff8989}",
    ".ib-overlay{position:fixed;inset:0;z-index:1000;overflow:auto;background:var(--ib-panel);color:var(--ib-text);font-family:Arial,'Microsoft YaHei','微软雅黑',sans-serif}",
    ".ib-top{height:68px;position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid var(--ib-line);background:var(--ib-panel);backdrop-filter:blur(18px)}",
    ".ib-brand{display:flex;align-items:center;gap:11px;min-width:230px}.ib-logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--ib-panel);color:var(--ib-text);font-weight:900;box-shadow:0 9px 28px var(--ib-line)}.ib-brand strong{font-size:14px}.ib-brand small{display:block;margin-top:2px;color:var(--ib-text);font-size:9px;letter-spacing:.12em;text-transform:uppercase}.ib-crumb{flex:1;color:var(--ib-text);font-size:11px}.ib-crumb b{color:var(--ib-text)}",
    ".ib-main{max-width:1260px;margin:0 auto;padding:36px 28px 70px}.ib-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:26px}.ib-kicker{color:var(--ib-green);font-size:9.5px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.ib-head h1{font-size:30px;line-height:1.16;letter-spacing:-.035em;margin:8px 0}.ib-head p{max-width:690px;color:var(--ib-muted);font-size:12.5px;line-height:1.7;margin:0}",
    ".ib-btn{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:10px;padding:9px 13px;cursor:pointer;font-size:11.5px}.ib-btn:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-btn[data-primary]{border-color:transparent;background:var(--ib-panel);color:var(--ib-text);box-shadow:0 10px 25px var(--ib-line)}.ib-btn[data-danger]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-btn[data-danger]:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-btn:disabled{opacity:.45;cursor:not-allowed}.ib-actions{display:flex;gap:8px;flex-wrap:wrap}",
    ".ib-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.ib-project{position:relative;min-height:190px;border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:17px;padding:19px;cursor:pointer;text-align:left;color:inherit;transition:.18s}.ib-project:hover{transform:translateY(-2px);border-color:var(--ib-line)}.ib-project-icon{width:38px;height:38px;border-radius:12px;background:var(--ib-panel);color:var(--ib-green);display:grid;place-items:center;font-weight:800}.ib-project h2{font-size:16px;margin:24px 0 6px}.ib-project p{font-size:10.5px;color:var(--ib-text);line-height:1.55;margin:0}.ib-project-foot{position:absolute;left:19px;right:19px;bottom:17px;display:flex;justify-content:space-between;color:var(--ib-text);font-size:9.5px}",
    ".ib-card{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:16px;padding:17px}.ib-form{margin-bottom:18px}.ib-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.ib-field{display:grid;gap:6px}.ib-field[data-wide]{grid-column:1/-1}.ib-field label{font-size:10px;color:var(--ib-text)}.ib-field input,.ib-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:10px;padding:10px 11px;font:11.5px inherit;outline:none}.ib-field textarea{min-height:180px;resize:vertical;font-family:Arial,'Microsoft YaHei','微软雅黑',sans-serif;line-height:1.55}.ib-field input:focus,.ib-field textarea:focus{border-color:var(--ib-line)}.ib-form-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.ib-error{color:var(--ib-red);font-size:10.5px;margin:10px 0;white-space:pre-wrap}.ib-empty{border:1px dashed var(--ib-line);border-radius:17px;padding:50px 24px;text-align:center;color:var(--ib-text)}",
    ".ib-project-head{display:flex;align-items:center;gap:13px;margin-bottom:20px}.ib-project-copy{flex:1;min-width:0}.ib-project-copy h1{font-size:24px;margin:0 0 4px;letter-spacing:-.025em}.ib-project-copy p{font-size:10.5px;color:var(--ib-text);margin:0}.ib-agent{display:flex;align-items:center;gap:8px}.ib-spark{width:23px;height:23px;border-radius:8px;display:grid;place-items:center;background:var(--ib-panel)}",
    ".ib-memory{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:14px;margin-bottom:17px}.ib-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.ib-card-title{font-size:12.5px;font-weight:680}.ib-chip{border-radius:999px;background:var(--ib-panel);color:var(--ib-text);padding:3px 8px;font-size:9px}.ib-memory textarea{width:100%;min-height:230px;box-sizing:border-box;resize:vertical;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:11px;padding:13px;font:10.5px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.ib-save{display:flex;gap:8px;margin-top:9px}.ib-save input{flex:1;min-width:0;border:1px solid var(--ib-line);background:var(--ib-panel);color:inherit;border-radius:9px;padding:8px 10px;font-size:10.5px;outline:none}.ib-help{color:var(--ib-text);font-size:10.5px;line-height:1.65}.ib-help strong{display:block;color:var(--ib-text);font-size:11.5px;margin-bottom:7px}.ib-history{margin-top:12px;display:grid;gap:7px}.ib-version{border-top:1px solid var(--ib-line);padding-top:8px;display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:var(--ib-text)}.ib-version b{color:var(--ib-text)}",
    ".ib-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}.ib-tab{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:13px;padding:13px;text-align:left;cursor:pointer}.ib-tab[data-active=true]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-tab strong{display:block;font-size:12px;margin-bottom:4px}.ib-tab span{font-size:9.5px;color:var(--ib-text)}",
    ".ib-board{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:16px;padding:17px}.ib-board-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.ib-board-head h2{font-size:14px;margin:0}.ib-board-head p{font-size:9.5px;color:var(--ib-text);margin:3px 0 0}.ib-artifacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ib-artifact{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:12px;padding:13px;min-height:112px}.ib-artifact-top{display:flex;justify-content:space-between;align-items:center}.ib-artifact h3{font-size:11.5px;margin:0}.ib-count{font-size:19px;font-weight:720;color:var(--ib-green)}.ib-rows{display:grid;gap:6px;margin-top:10px}.ib-row{display:flex;justify-content:space-between;gap:9px;font-size:9.5px;color:var(--ib-text)}.ib-row b{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ib-text);font-weight:520}.ib-row span{flex:none;color:var(--ib-text)}.ib-artifact-empty{margin-top:15px;color:var(--ib-text);font-size:9.5px;line-height:1.55}.ib-toast{position:fixed;z-index:1100;right:24px;bottom:24px;box-sizing:border-box;max-width:min(520px,calc(100vw - 32px));border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:8px;padding:13px 16px;color:var(--ib-text);font-size:13px;font-weight:650;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere;box-shadow:0 12px 35px var(--ib-line)}",
    ".ib-db{margin-bottom:14px;border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:15px;padding:14px}.ib-db-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.ib-db-head h3{font-size:13px;margin:0 0 3px}.ib-db-head p{font-size:9.5px;color:var(--ib-text);margin:0}.ib-db-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ib-db-card{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:11px;padding:10px;min-width:0}.ib-db-name{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-bottom:8px}.ib-db-name b{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-db-tier{font-size:8px;color:var(--ib-text);white-space:nowrap}.ib-db-state{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:8px}.ib-db-pill{border-radius:7px;padding:5px 6px;background:var(--ib-panel);color:var(--ib-text);font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-db-pill[data-ok=true]{color:var(--ib-text);background:var(--ib-panel)}.ib-db-pill[data-warn=true]{color:var(--ib-text);background:var(--ib-panel)}.ib-db-actions{display:flex;gap:5px}.ib-db-actions .ib-btn{flex:1;padding:6px 7px;font-size:9px}.ib-db-empty{padding:12px;text-align:center;color:var(--ib-text);font-size:10px}@media(max-width:900px){.ib-db-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.ib-db-grid{grid-template-columns:1fr}}",
    ".ib-db-toggle-wrap{display:flex;justify-content:flex-end;margin-bottom:10px}.ib-db-toggle{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:10px;padding:8px 12px;cursor:pointer;font-size:10px}.ib-db-toggle:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-db-toggle i{width:7px;height:7px;border-radius:50%;background:var(--ib-panel)}.ib-db-toggle[data-warn=true] i{background:var(--ib-panel)}.ib-db-toggle small{color:var(--ib-text);font-size:8.5px}",
    ".ib-fulltext{margin-bottom:14px;border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:15px;padding:14px}.ib-fulltext-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.ib-fulltext input{min-width:0;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:10px;padding:10px 11px;font:11px inherit;outline:none}.ib-fulltext input:focus{border-color:var(--ib-line)}.ib-fulltext-note{margin:8px 0 0;color:var(--ib-text);font-size:9px;line-height:1.55}.ib-dl-list{display:grid;gap:6px;margin-top:10px}.ib-dl-row{display:flex;align-items:center;gap:9px;border-top:1px solid var(--ib-line);padding-top:8px}.ib-dl-main{flex:1;min-width:0}.ib-dl-main b,.ib-dl-main small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-dl-main b{font-size:10px;color:var(--ib-text)}.ib-dl-main small{font-size:8.5px;color:var(--ib-text);margin-top:2px}.ib-dl-state{flex:none;border-radius:999px;padding:4px 7px;background:var(--ib-panel);font-size:8.5px;color:var(--ib-text)}.ib-dl-state[data-ok=true]{color:var(--ib-text);background:var(--ib-panel)}.ib-dl-state[data-warn=true]{color:var(--ib-text);background:var(--ib-panel)}",
    // ── 文献管理两栏：左检索记录，右精读档案 ─────────────────────────────
    ".ib-lit{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(0,.96fr);gap:12px;align-items:start}",
    ".ib-lit-col{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:12px;padding:13px;min-width:0}.ib-lit-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px}.ib-lit-head h3{font-size:13px;font-weight:700;margin:0;color:var(--ib-text)}.ib-lit-head small{color:var(--ib-text);font-size:9px}.ib-lit-note{color:var(--ib-text);font-size:9.5px;margin:2px 0 10px;line-height:1.5}",
    ".ib-lit-list{display:grid;gap:7px}.ib-lit-row{display:flex;align-items:center;gap:9px;border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:11px;padding:9px 10px}.ib-lit-row[data-waiting=true]{border-color:var(--ib-line);background:var(--ib-panel)}.ib-lit-row[data-clickable]{cursor:pointer}.ib-lit-row[data-clickable]:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-lit-main{flex:1;min-width:0;display:grid;gap:2px}.ib-lit-main b{font-size:11px;color:var(--ib-text);font-weight:560;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-lit-main b i{font-family:Arial,'Microsoft YaHei','微软雅黑',sans-serif;font-weight:560}.ib-lit-main small{display:block;font-size:9px;color:var(--ib-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-lit-acts{flex:none;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px;max-width:58%}.ib-lit-btn{border:1px solid var(--ib-line);border-radius:9px;background:var(--ib-panel);color:var(--ib-text);font-size:10px;padding:7px 10px;cursor:pointer;font-weight:560;line-height:1}.ib-lit-btn:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-lit-btn[data-review=approve]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-lit-btn[data-review=reject]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-lit-btn:disabled{opacity:.4;pointer-events:none}.ib-lit-fmt{border:1px solid var(--ib-line);border-radius:9px;background:var(--ib-panel);color:var(--ib-text);font-size:10px;padding:6px 8px;cursor:pointer;outline:none}.ib-lit-fmt:hover{border-color:var(--ib-line)}.ib-lit-fmt:focus{border-color:var(--ib-line)}.ib-lit-fmt option{background:var(--ib-panel);color:var(--ib-text)}",
    ".ib-lit-empty{border:1px dashed var(--ib-line);border-radius:12px;padding:22px 14px;text-align:center;color:var(--ib-text);font-size:10px;line-height:1.6}.ib-capture-hint{margin-top:7px;border:1px solid var(--ib-line);border-radius:9px;background:var(--ib-panel);padding:7px 10px;font-size:9.5px;color:var(--ib-text)}.ib-lit-overview{margin-top:8px;border:1px solid var(--ib-line);border-radius:10px;background:var(--ib-panel);padding:10px 12px;font-size:10.2px;line-height:1.75;color:var(--ib-text);white-space:pre-wrap}.ib-lit-overview b{display:block;color:var(--ib-text);font-size:10.5px;margin-bottom:4px}.ib-review-detail{margin-top:8px;border:1px solid var(--ib-line);border-radius:10px;background:var(--ib-panel);padding:10px 12px;color:var(--ib-text)}.ib-review-detail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.ib-review-detail-head b{font-size:10.5px;color:var(--ib-text)}.ib-review-detail-head span{font-size:9px;color:var(--ib-text)}.ib-review-findings{display:grid;gap:5px}.ib-review-finding{display:grid;grid-template-columns:44px 1fr;gap:7px;font-size:9.5px;line-height:1.55}.ib-review-finding i{font-style:normal;text-transform:uppercase;font-size:8px;color:var(--ib-text)}.ib-review-finding[data-level=error] i{color:var(--ib-text)}.ib-review-finding[data-level=warning] i{color:var(--ib-text)}.ib-review-finding[data-level=pass] i{color:var(--ib-text)}",
    ".ib-search-results{margin:-1px 4px 4px;border:1px solid var(--ib-line);border-top:0;border-radius:0 0 11px 11px;background:var(--ib-panel);padding:8px;display:grid;gap:6px;max-height:420px;overflow:auto}.ib-search-paper{border-top:1px solid var(--ib-line);padding:7px 5px 2px}.ib-search-paper:first-child{border-top:0}.ib-search-citation{font-size:10.5px;line-height:1.5;color:var(--ib-text)}.ib-search-citation i{font-family:Arial,'Microsoft YaHei','微软雅黑',sans-serif;color:var(--ib-text)}.ib-search-citation span{color:var(--ib-text)}.ib-search-paper small{display:block;margin-top:2px;color:var(--ib-text);font-size:8.8px;line-height:1.4}.ib-search-paper a{color:var(--ib-text);text-decoration:none;margin-left:7px}.ib-search-paper a:hover{text-decoration:underline}.ib-search-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:6px}.ib-icon-btn{display:inline-grid;place-items:center;width:27px;height:27px;padding:0;border:1px solid var(--ib-line);border-radius:8px;background:var(--ib-panel);color:var(--ib-text);cursor:pointer;line-height:1}.ib-icon-btn svg{display:block}.ib-icon-btn[data-ready=false]{opacity:.42;filter:grayscale(.9)}.ib-icon-btn[data-ready=false]:hover{border-color:var(--ib-line);opacity:.72;filter:grayscale(.3)}.ib-icon-btn[data-ready=true]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-icon-btn[data-ready=true]:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-icon-btn[data-opening=true]{cursor:progress;animation:ib-opening-pulse 1.1s ease-in-out infinite}@keyframes ib-opening-pulse{0%,100%{opacity:.45}50%{opacity:1}}",
    ".ib-preview-backdrop{position:fixed;inset:0;z-index:1004;background:var(--ib-panel);backdrop-filter:blur(2px)}.ib-preview-drawer{position:fixed;z-index:1005;top:0;right:0;bottom:0;width:min(760px,68vw);display:flex;flex-direction:column;background:var(--ib-panel);color:var(--ib-text);border-left:1px solid var(--ib-line);box-shadow:-28px 0 70px var(--ib-line)}.ib-preview-head{flex:none;display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--ib-panel);border-bottom:1px solid var(--ib-line)}.ib-preview-title{min-width:0;flex:1}.ib-preview-title b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.ib-preview-title small{display:block;margin-top:3px;color:var(--ib-text);font-size:9.5px}.ib-preview-state{border-radius:999px;padding:4px 8px;background:var(--ib-panel);color:var(--ib-text);font-size:9px}.ib-preview-frame{min-height:0;flex:1;width:100%;border:0;background:var(--ib-panel)}.ib-preview-foot{flex:none;display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--ib-panel);border-top:1px solid var(--ib-line)}.ib-preview-foot-note{min-width:0;flex:1;color:var(--ib-text);font-size:9.5px;line-height:1.45}.ib-preview-btn{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:9px;padding:8px 12px;cursor:pointer;font-size:10px;white-space:nowrap}.ib-preview-btn[data-primary]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-preview-btn[data-danger]{border-color:var(--ib-line);color:var(--ib-text)}.ib-preview-btn:disabled{opacity:.45;cursor:not-allowed}.ib-preview-review{flex:none;max-height:190px;overflow:auto;padding:12px 14px;background:var(--ib-panel);border-top:1px solid var(--ib-line)}.ib-preview-review .ib-review-detail{margin:0;background:var(--ib-panel);color:var(--ib-text)}.ib-preview-review .ib-review-detail-head b{color:var(--ib-text)}.ib-approval-shade{position:absolute;inset:0;z-index:2;display:grid;place-items:center;padding:24px;background:var(--ib-panel);backdrop-filter:blur(3px)}.ib-approval-card{width:min(560px,100%);max-height:min(650px,86vh);overflow:auto;box-sizing:border-box;border:1px solid var(--ib-line);border-radius:17px;background:var(--ib-panel);padding:22px;box-shadow:0 22px 70px var(--ib-line)}.ib-approval-card h3{margin:0 0 7px;font-size:17px}.ib-approval-card>p{margin:0 0 14px;color:var(--ib-text);font-size:10.5px;line-height:1.65}.ib-approval-card .ib-review-detail{margin:0;background:var(--ib-panel);color:var(--ib-text)}.ib-approval-card .ib-review-detail-head b{color:var(--ib-text)}.ib-approval-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.ib-approval-ok{display:grid;place-items:center;text-align:center;padding:18px 8px}.ib-approval-ok strong{font-size:16px}.ib-approval-ok span{margin-top:6px;color:var(--ib-text);font-size:10px}",
    "@media(max-width:880px){.ib-lit{grid-template-columns:1fr}.ib-preview-drawer{width:100vw}}",
    // ── 模板管理：阅读笔记模板 / PPT 模板 ─────────────────────────────
    ".ib-tm-tabs{display:flex;gap:9px;margin-bottom:12px}.ib-tm-tab{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:13px;padding:12px 16px;cursor:pointer;font-size:11.5px}.ib-tm-tab[data-active=true]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-tm-wrap{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ib-card-detail{grid-column:1/-1}.ib-table{border:1px solid var(--ib-line);border-radius:11px;overflow:hidden}.ib-table-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--ib-line)}.ib-table-row:first-child{border-top:0}.ib-table-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--ib-panel);font-size:9.5px;color:var(--ib-text);font-weight:700}.ib-table-head .ib-tm-id,.ib-table-row .ib-tm-id{width:150px;flex:none}.ib-table-head .ib-tm-name,.ib-table-row .ib-tm-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-table-head .ib-tm-status,.ib-table-row .ib-tm-status{width:70px;flex:none}.ib-table-head .ib-tm-actions,.ib-table-row .ib-tm-actions{width:280px;flex:none;display:flex;gap:6px;justify-content:flex-end}",
    ".ib-tm-btn{font-size:9.5px}",
    ".ib-sections{display:grid;gap:6px;margin-top:8px}.ib-section-row{display:grid;grid-template-columns:1fr 2fr 70px 28px;gap:6px;align-items:center}.ib-section-row input[type=checkbox]{accent-color:var(--ib-green)}.ib-section-row input[type=text]{border:1px solid var(--ib-line);border-radius:7px;padding:6px 8px;background:var(--ib-panel);color:var(--ib-text);font-size:10.5px;width:100%;box-sizing:border-box}.ib-section-row .ib-mini{width:100%}",
    ".vertical-stack{display:flex;flex-direction:column;gap:4px}.ib-req{display:grid;gap:4px}.ib-req label{font-size:9.5px;color:var(--ib-text)}.ib-req input,.ib-req textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:7px;padding:7px 9px;font:10.5px inherit;outline:none}.ib-req textarea{min-height:60px;resize:vertical}",
    ".ib-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:999px;padding:5px 11px;font-size:10px;cursor:pointer;line-height:1.4}.ib-badge:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-badge-mark{color:var(--ib-green);font-size:9px;font-weight:800}.ib-badge b{color:var(--ib-text);font-weight:650}.ib-badge small{color:var(--ib-text)}",
    ".ib-hint{display:flex;align-items:center;gap:8px;color:var(--ib-text);font-size:10px;padding:4px 2px;line-height:1.5}.ib-hint b{color:var(--ib-text);font-weight:620}.ib-hint button{margin-left:auto;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:3px 9px;font-size:9.5px;cursor:pointer}.ib-hint button:hover{border-color:var(--ib-line);color:var(--ib-text)}",
    // ── Harness 科研对话：课题上下文、消息流、工具卡与输入区 ──────────
    ".ib-research-badge{min-width:0;display:flex;align-items:center;gap:9px;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--dsw-alias-label-primary,#193a31);border-radius:12px;padding:6px 10px 6px 7px;cursor:pointer;text-align:left;box-shadow:0 6px 22px var(--ib-line)}.ib-research-badge:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-research-badge .ib-badge-icon{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;background:var(--ib-panel);box-shadow:0 5px 14px var(--ib-line)}.ib-research-badge .ib-badge-copy{min-width:0;display:grid;gap:1px}.ib-research-badge small{font-size:8px;line-height:1.1;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#78978c)}.ib-research-badge b{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:1.25;color:var(--dsw-alias-label-primary,#15382e)}.ib-research-badge .ib-badge-version{flex:none;border-radius:999px;padding:2px 6px;background:var(--ib-panel);color:var(--ib-text);font-size:8.5px;font-weight:700}",
    ".ib-file-upload{display:inline-flex;align-items:center}.ib-file-upload>input{display:none}.ib-file-upload-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border:1px solid var(--ib-line);border-radius:9px;background:var(--ib-panel);color:var(--dsw-alias-label-secondary,#58746a);font:inherit;font-size:11px;cursor:pointer}.ib-file-upload-btn:hover{border-color:var(--ib-line);background:var(--ib-panel);color:var(--dsw-alias-label-primary,#18352d)}.ib-file-upload-btn:disabled{opacity:.5;cursor:wait}.ib-file-upload-btn svg{width:14px;height:14px;display:block}.ib-file-drop{position:fixed;z-index:1500;inset:18px;display:grid;place-items:center;border:2px dashed var(--ib-line);border-radius:22px;background:var(--ib-panel);color:var(--ib-text);font-size:15px;font-weight:700;letter-spacing:.02em;box-shadow:0 20px 70px var(--ib-line);pointer-events:none}.ib-file-drop span{border:1px solid var(--ib-line);border-radius:14px;background:var(--ib-panel);padding:18px 24px;box-shadow:0 10px 35px var(--ib-line)}@media(prefers-color-scheme:dark){.ib-file-upload-btn{color:var(--ib-text)}.ib-file-upload-btn:hover{color:var(--ib-text)}.ib-file-drop{background:var(--ib-panel);color:var(--ib-text)}.ib-file-drop span{background:var(--ib-panel)}}",
    "body.ib-research-chat{--ib-chat-ink:var(--dsw-alias-label-primary,#18352d);--ib-chat-muted:var(--dsw-alias-label-secondary,#647d74);--ib-chat-line:rgba(50,142,111,.13)}body.ib-research-chat [class*='_centerCol']{background:var(--ib-panel);color:var(--ib-chat-ink)}body.ib-research-chat [class*='_centerCol'] header{height:84px;box-sizing:border-box;border-bottom:1px solid var(--ib-chat-line);background:var(--ib-panel);backdrop-filter:blur(18px) saturate(1.15);box-shadow:0 8px 28px var(--ib-line)}body.ib-research-chat [class*='_scrollBody']{background-image:linear-gradient(rgba(56,139,111,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(56,139,111,.018) 1px,transparent 1px);background-size:28px 28px}body.ib-research-chat [class*='_scrollBody']:before{content:'RESEARCH LOG';position:fixed;right:24px;top:102px;z-index:0;color:var(--ib-text);font-size:8px;font-weight:800;letter-spacing:.22em;pointer-events:none}body.ib-research-chat [class*='_scrollBody'] [class*='_column']{max-width:820px!important}body.ib-research-chat [class*='_flowItem']{margin-block:8px}body.ib-research-chat [class*='_flowItem']:has([class*='_markdown']){position:relative;border-left:2px solid var(--ib-line);padding-left:18px}body.ib-research-chat [class*='_flowItem']:has([class*='_userRow']){border-left:0;padding-left:0;margin-block:14px}body.ib-research-chat [class*='_userStack']{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:16px 16px 5px 16px;padding:10px 13px;box-shadow:0 7px 22px var(--ib-line)}body.ib-research-chat [class*='_flowItem'] button{border-radius:10px}body.ib-research-chat [class*='_flowItem'] [class*='_card']{border-color:var(--ib-line);background:var(--ib-panel);box-shadow:0 4px 16px var(--ib-line)}body.ib-research-chat [class*='_markdown']{color:var(--ib-chat-ink);font-size:14px;line-height:1.82}body.ib-research-chat [class*='_markdown'] h1,body.ib-research-chat [class*='_markdown'] h2,body.ib-research-chat [class*='_markdown'] h3{color:var(--ib-text);letter-spacing:-.015em}body.ib-research-chat [class*='_markdown'] h2{margin-top:1.6em;padding-bottom:.35em;border-bottom:1px solid var(--ib-line)}body.ib-research-chat [class*='_markdown'] code{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:6px}body.ib-research-chat [class*='_markdown'] blockquote{border-left:3px solid var(--ib-line);background:var(--ib-panel);border-radius:0 10px 10px 0;padding:8px 13px}body.ib-research-chat [class*='_tableScroll']{border:1px solid var(--ib-line);border-radius:12px;box-shadow:0 6px 18px var(--ib-line)}body.ib-research-chat [class*='_composerSeat']{background:var(--ib-panel)}body.ib-research-chat [class*='_composerStack']{gap:8px}body.ib-research-chat [class*='_composerStack'] [class*='_card']{border-color:var(--ib-line);background:var(--ib-panel);border-radius:18px;box-shadow:0 14px 38px var(--ib-line),0 0 0 1px var(--ib-line) inset}body.ib-research-chat [class*='_composerStack'] textarea{color:var(--ib-chat-ink);font-size:13px}body.ib-research-chat [class*='_composerStack'] textarea::placeholder{color:var(--ib-text)}",
    // Harness 用独立 backdrop 绘制输入文字；原生 textarea 只负责光标与输入，保持文字透明可避免双层重影。
    "body.ib-research-chat [class*='_composerStack'] textarea{color:transparent;font-size:inherit;caret-color:var(--ib-chat-ink)}",
    "@media(prefers-color-scheme:dark){body.ib-research-chat [class*='_centerCol']{background:var(--ib-panel)}body.ib-research-chat [class*='_centerCol'] header{background:var(--ib-panel)}body.ib-research-chat [class*='_userStack']{background:var(--ib-panel)}body.ib-research-chat [class*='_flowItem'] [class*='_card']{background:var(--ib-panel)}body.ib-research-chat [class*='_markdown'] h1,body.ib-research-chat [class*='_markdown'] h2,body.ib-research-chat [class*='_markdown'] h3{color:var(--ib-text)}body.ib-research-chat [class*='_composerSeat']{background:var(--ib-panel)}body.ib-research-chat [class*='_composerStack'] [class*='_card']{background:var(--ib-panel)}}",
    "@media(max-width:760px){.ib-research-badge small,.ib-research-badge .ib-badge-version{display:none}body.ib-research-chat [class*='_centerCol'] header{height:auto;min-height:72px}body.ib-research-chat [class*='_scrollBody'] [class*='_column']{max-width:calc(100vw - 24px)!important}}",
    "@media(max-width:900px){.ib-grid{grid-template-columns:repeat(2,1fr)}.ib-memory{grid-template-columns:1fr}.ib-artifacts{grid-template-columns:1fr}}@media(max-width:620px){.ib-top{padding:0 14px}.ib-brand{min-width:auto}.ib-brand div:last-child,.ib-crumb{display:none}.ib-main{padding:25px 14px 55px}.ib-head{align-items:flex-start;flex-direction:column}.ib-grid,.ib-tabs,.ib-form-grid{grid-template-columns:1fr}.ib-head h1{font-size:24px}.ib-project-head{flex-wrap:wrap}.ib-agent{width:100%;justify-content:center}}",
    // ── 课题界面统一主题：以 #023373 为唯一品牌主色，层级色均由该蓝色派生 ──
    ".ib-overlay{--ib-bg:#010f24;--ib-panel:#021d43;--ib-panel2:#022856;--ib-line:rgba(112,157,211,.24);--ib-text:#f4f8ff;--ib-muted:#9bb3d1;--ib-green:#6f9ed6;--ib-cyan:#8cb5e5;background:var(--ib-panel);color:var(--ib-text)}.ib-overlay .ib-top{background:var(--ib-panel);border-color:var(--ib-line)}.ib-overlay .ib-logo,.ib-overlay .ib-btn[data-primary],.ib-overlay .ib-preview-btn[data-primary]{background:var(--ib-panel);border-color:var(--ib-line);color:var(--ib-text);box-shadow:0 10px 28px var(--ib-line)}.ib-overlay .ib-btn:hover,.ib-overlay .ib-project:hover{border-color:var(--ib-line);background:var(--ib-panel)}.ib-overlay .ib-project{background:var(--ib-panel)}.ib-overlay .ib-card,.ib-overlay .ib-board{background:var(--ib-panel)}.ib-overlay input,.ib-overlay textarea,.ib-overlay select,.ib-overlay .ib-search-results,.ib-overlay .ib-lit-fmt,.ib-overlay .ib-section-row input[type=text]{background:var(--ib-panel);color:var(--ib-text);border-color:var(--ib-line)}.ib-overlay input:focus,.ib-overlay textarea:focus,.ib-overlay select:focus{border-color:var(--ib-line)}.ib-overlay .ib-chip,.ib-overlay .ib-badge,.ib-overlay .ib-db-toggle,.ib-overlay .ib-tab[data-active=true],.ib-overlay .ib-tm-tab[data-active=true],.ib-overlay .ib-icon-btn[data-ready=true],.ib-overlay .ib-lit-btn[data-review=approve]{background:var(--ib-panel);border-color:var(--ib-line);color:var(--ib-text)}.ib-overlay .ib-project-icon,.ib-overlay .ib-count,.ib-overlay .ib-kicker,.ib-overlay .ib-badge-mark{color:var(--ib-text)}.ib-overlay .ib-fulltext,.ib-overlay .ib-lit-overview,.ib-overlay .ib-review-detail,.ib-overlay .ib-capture-hint{background:var(--ib-panel);border-color:var(--ib-line)}.ib-overlay .ib-table-head{background:var(--ib-panel)}.ib-overlay .ib-toast{background:var(--ib-panel);border-color:var(--ib-line)}.ib-overlay .ib-preview-backdrop{background:var(--ib-panel)}.ib-overlay .ib-preview-drawer,.ib-overlay .ib-preview-head,.ib-overlay .ib-preview-foot,.ib-overlay .ib-approval-card{background:var(--ib-panel);color:var(--ib-text)}.ib-overlay .ib-preview-state{background:var(--ib-panel);color:var(--ib-text)}",
    // ── 品牌覆盖：展开侧栏使用人像 Logo；折叠栏与会话徽章保留烧瓶 SVG ──
    ".ib-brand-shell{display:flex;align-items:center;gap:10px;min-width:0}.ib-brand-avatar{width:30px;height:30px;border-radius:9px;flex:none;overflow:hidden;background:var(--ib-panel);box-shadow:0 6px 18px var(--ib-line)}.ib-brand-avatar img{width:100%;height:100%;display:block;object-fit:cover}.ib-brand-text{min-width:0}.ib-brand-text b{display:block;color:var(--dsw-alias-label-primary,#eff9f5);font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.1;white-space:nowrap}.ib-brand-text small{display:block;color:var(--dsw-alias-label-tertiary,#88a6c4);font-size:8.5px;letter-spacing:.13em;text-transform:uppercase;margin-top:2px;white-space:nowrap}",
    "[class*='_toggle']{position:relative}.ib-rail-flask{position:absolute;z-index:2;inset:0;margin:auto;width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:var(--ib-panel);box-shadow:0 4px 12px var(--ib-line);pointer-events:none}.ib-rail-flask svg{width:13px;height:13px}",
    ".ib-hero-avatar{display:block;width:68px!important;height:68px!important;max-width:none;flex:none;object-fit:cover;border-radius:14px;box-shadow:0 8px 22px var(--ib-line)}body:not(.ib-research-chat) [class*='_headlineText']{font-size:52px!important;line-height:1!important}body:not(.ib-research-chat) [class*='_fishHitbox']{margin-right:18px!important}.ib-overlay .ib-logo{padding:0;overflow:hidden;background:var(--ib-panel);box-shadow:0 9px 28px var(--ib-line)}.ib-logo img{display:block;width:100%;height:100%;object-fit:cover}",
    // ── 研究设计 / 合成路线工作台（0.3.0，UI-001..004） ─────────────
    ".sw-plan{display:grid;gap:14px}.sw-sec{border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:15px;padding:15px 16px;min-width:0}.sw-sec+.sw-sec{margin-top:0}.sw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.sw-head h3{margin:0;font-size:14px;letter-spacing:.01em}.sw-head p{margin:3px 0 0;color:var(--ib-muted);font-size:9.5px;line-height:1.6;max-width:720px}.sw-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sw-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:11px;padding:10px 12px;border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel)}.sw-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sw-meta-note{font-size:9px;color:var(--ib-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.sw-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--ib-line);border-radius:999px;background:var(--ib-panel);color:var(--ib-text);font-size:9.5px;line-height:1.2}.sw-chip b{font-weight:650}.sw-chip[data-tone=good]{color:var(--ib-text);border-color:var(--ib-line);background:var(--ib-panel)}.sw-chip[data-tone=warn]{color:var(--ib-text);border-color:var(--ib-line);background:var(--ib-panel)}.sw-chip[data-tone=bad]{color:var(--ib-text);border-color:var(--ib-line);background:var(--ib-panel)}.sw-chip[data-tone=dim]{color:var(--ib-text);border-color:var(--ib-line)}.sw-dot{width:7px;height:7px;border-radius:50%;background:var(--ib-panel);box-shadow:0 0 10px var(--sw-lv,var(--ib-line))}.sw-select{background:var(--ib-panel);color:var(--ib-text);border:1px solid var(--ib-line);border-radius:9px;padding:7px 9px;font-size:10.5px;outline:none}.sw-graph{display:flex;align-items:stretch;gap:8px;overflow-x:auto;padding:6px 2px 10px;scrollbar-width:thin}.sw-step{position:relative;flex:none;width:min(280px,86vw);display:grid;gap:8px;align-content:start;border:1px solid var(--ib-line);border-radius:13px;padding:12px 12px 11px;background:var(--ib-panel);cursor:pointer;text-align:left;color:var(--ib-text);transition:.16s;min-height:150px}.sw-step:hover{border-color:var(--ib-line);transform:translateY(-1px)}.sw-step[data-active=true]{border-color:var(--ib-line);background:var(--ib-panel);box-shadow:inset 0 0 0 1px var(--ib-line),0 10px 26px var(--ib-line)}.sw-step-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.sw-step-id{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:var(--ib-panel);border:1px solid var(--ib-line);font-size:9.5px;font-weight:800}.sw-step .sw-step-reaction{font-size:12px;font-weight:680;line-height:1.35;color:var(--ib-text)}.sw-step .sw-step-flow{font-size:10px;color:var(--ib-text);line-height:1.5}.sw-step .sw-step-flow b{color:var(--ib-text);font-weight:560}.sw-step-preview{font-size:10px;color:var(--ib-text);line-height:1.5;border-top:1px dashed var(--ib-line);padding-top:8px;margin-top:auto}.sw-step-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}.sw-bar{flex:1;min-width:0;height:4px;border-radius:999px;background:var(--ib-panel);overflow:hidden}.sw-bar i{display:block;height:100%;border-radius:999px;background:var(--ib-panel)}.sw-step[data-active=true] .sw-bar i{background:var(--ib-panel)}.sw-grid{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(340px,.88fr);gap:14px;align-items:start}.sw-cond{width:100%;border-collapse:collapse;font-size:11px}.sw-cond th,.sw-cond td{border-bottom:1px solid var(--ib-line);padding:8px 9px;text-align:left;vertical-align:top}.sw-cond th{width:96px;color:var(--ib-text);font-weight:620;white-space:nowrap}.sw-cond td{color:var(--ib-text);line-height:1.55;overflow-wrap:anywhere}.sw-cond td[data-missing=true]{color:var(--ib-text);font-style:italic}.sw-cond td[data-missing=true]::after{content:'（文献未提供 / 待确认）'}.sw-cond td[data-legacy=true]{color:var(--ib-text)}.sw-cond .sw-src{display:inline-flex;align-items:center;gap:4px;color:var(--ib-text);text-decoration:none;border-bottom:1px dashed var(--ib-line);font-size:9.5px;cursor:pointer}.sw-cond .sw-src:hover{color:var(--ib-text)}.sw-notes{display:grid;gap:8px;margin-top:12px}.sw-note{display:grid;grid-template-columns:20px 1fr;gap:8px;align-items:flex-start;border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:10px;padding:9px 11px;color:var(--ib-text);font-size:10.5px;line-height:1.6}.sw-note i{font-style:normal;font-weight:800;color:var(--ib-text)}.sw-ev-list{display:grid;gap:9px}.sw-ev{border:1px solid var(--ib-line);border-radius:11px;background:var(--ib-panel);padding:10px 11px}.sw-ev-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.sw-ev-title{font-size:11px;font-weight:680;color:var(--ib-text);line-height:1.4}.sw-ev-meta{font-size:9px;color:var(--ib-text);margin-top:4px;line-height:1.5}.sw-ev-quote{margin-top:8px;padding:8px 10px;border-left:2px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);font-size:10px;line-height:1.6;border-radius:0 8px 8px 0}.sw-ev-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.sw-ev-tag{border-radius:999px;padding:3px 7px;font-size:8.5px;border:1px solid var(--ib-line);color:var(--ib-text);background:var(--ib-panel)}.sw-ev-tag[data-rel=conflicts]{color:var(--ib-text);border-color:var(--ib-line);background:var(--ib-panel)}.sw-ev-tag[data-lv=1]{color:var(--ib-text);border-color:var(--ib-line)}.sw-ev-review{margin-left:auto}.sw-ev-act{display:inline-flex;gap:5px;align-items:center}.sw-ev-act button{border:1px solid var(--ib-line);border-radius:7px;padding:3px 8px;font-size:8.5px;background:var(--ib-panel);color:var(--ib-text);cursor:pointer}.sw-ev-act button[data-ok=true]{border-color:var(--ib-line);color:var(--ib-text)}.sw-ev-act button[data-no=true]{border-color:var(--ib-line);color:var(--ib-text)}.sw-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.sw-metric{border:1px solid var(--ib-line);border-radius:11px;padding:9px 10px;background:var(--ib-panel);min-width:0}.sw-metric small{display:block;color:var(--ib-text);font-size:8.5px;margin-bottom:6px}.sw-metric strong{font-size:11px;display:flex;align-items:center;gap:6px}.sw-metric strong .sw-dot{flex:none}.sw-metric[data-lv=green] strong{color:var(--ib-text)}.sw-metric[data-lv=yellow] strong{color:var(--ib-text)}.sw-metric[data-lv=red] strong{color:var(--ib-text)}.sw-metric[data-lv=unknown] strong{color:var(--ib-text)}.sw-analy{display:grid;gap:7px}.sw-analy-block{border:1px solid var(--ib-line);border-radius:10px;background:var(--ib-panel);padding:9px 11px;color:var(--ib-text);font-size:10px;line-height:1.65}.sw-analy-block b{color:var(--ib-text);font-size:9px;letter-spacing:.08em;display:block;margin-bottom:4px}.sw-analy-block ul{margin:0;padding-left:16px}.sw-plan-empty{border:1px dashed var(--ib-line);border-radius:13px;padding:34px 22px;text-align:center;color:var(--ib-text);font-size:11px;line-height:1.9}.sw-plan-empty b{display:block;color:var(--ib-text);font-size:13px;margin-bottom:6px}.sw-plans{display:grid;gap:6px;margin-top:10px}.sw-plan-row{display:flex;align-items:center;justify-content:space-between;gap:9px;border-top:1px solid var(--ib-line);padding-top:7px;font-size:10px;color:var(--ib-text)}.sw-plan-row b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:560;color:var(--ib-text)}.sw-mini-btn{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:5px 9px;font-size:9.5px;cursor:pointer}.sw-mini-btn:hover{border-color:var(--ib-line);background:var(--ib-panel)}.sw-mini-btn:disabled{opacity:.4;cursor:not-allowed}.sw-mini-btn[data-primary=true]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.sw-mini-btn[data-warn=true]{border-color:var(--ib-line);color:var(--ib-text)}.sw-hint{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--ib-line);background:var(--ib-panel);border-radius:11px;padding:9px 12px;color:var(--ib-text);font-size:10px;line-height:1.7}.sw-hint b{color:var(--ib-text)}.sw-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--ib-line);border-top-color:var(--ib-line);border-radius:50%;animation:sw-rot .8s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes sw-rot{to{transform:rotate(360deg)}}.sw-sec-title{display:flex;align-items:center;gap:8px}@media(max-width:980px){.sw-grid{grid-template-columns:1fr}.sw-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.sw-metrics{grid-template-columns:1fr}.sw-toolbar{align-items:flex-start;flex-direction:column}}",
    // ── 0.3.2 合成路线工作台：结构式(Ketcher)/原文截图/条件编辑 ──
    ".sw-struct{display:flex;flex-wrap:wrap;gap:7px;align-items:stretch;min-width:0}.sw-struct-card{display:flex;flex-direction:column;gap:4px;border:1px solid var(--ib-line);border-radius:10px;background:var(--ib-panel);padding:7px;min-width:96px;max-width:150px;position:relative}.sw-struct-card[data-missing=true]{border-style:dashed;opacity:.72;background:var(--ib-panel)}.sw-struct-card img{display:block;width:100%;height:74px;object-fit:contain;background:var(--ib-panel);border-radius:6px;padding:2px;box-sizing:border-box}.sw-struct-name{font-size:9px;line-height:1.35;color:var(--ib-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sw-struct-name b{color:var(--ib-text);font-weight:650}.sw-struct-card[data-missing=true] .sw-struct-name{color:var(--ib-text);font-style:italic}.sw-struct-src{position:absolute;top:5px;right:5px;font-size:7px;border-radius:99px;padding:1px 5px;background:var(--ib-panel);color:var(--ib-text);border:1px solid var(--ib-line)}.sw-struct-acts{display:flex;gap:4px;margin-top:2px}.sw-struct-acts .sw-mini-btn{flex:1;font-size:8.5px;padding:3px 6px}.sw-struct-edit{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:var(--ib-panel);backdrop-filter:blur(3px);padding:18px}.sw-struct-edit-box{width:min(1080px,96vw);height:min(760px,94vh);display:flex;flex-direction:column;border:1px solid var(--ib-line);border-radius:16px;overflow:hidden;background:var(--ib-panel);box-shadow:0 30px 90px var(--ib-line)}.sw-struct-edit-head{flex:none;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--ib-panel);border-bottom:1px solid var(--ib-line)}.sw-struct-edit-head b{font-size:13px;color:var(--ib-text)}.sw-struct-edit-head small{flex:1;color:var(--ib-text);font-size:10px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sw-struct-edit-head button{border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer}.sw-struct-edit-head button[data-primary=true]{background:var(--ib-panel);border-color:var(--ib-line);color:var(--ib-text)}.sw-struct-edit-head button[data-primary=true]:disabled{opacity:.55;cursor:wait}.sw-struct-edit-frame{flex:1;border:0;width:100%;min-height:0}.sw-struct-loading{display:flex;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--ib-text);font-size:12px}.sw-ev-shot{margin-top:8px;display:grid;gap:6px}.sw-ev-shot img{max-width:100%;border:1px solid var(--ib-line);border-radius:8px;background:var(--ib-panel);display:block}.sw-ev-shot-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sw-ev-shot-note{font-size:9px;color:var(--ib-text);line-height:1.5}.sw-ev-shot-fail{border:1px dashed var(--ib-line);background:var(--ib-panel);border-radius:8px;padding:8px 10px;color:var(--ib-text);font-size:9.5px;line-height:1.55}.sw-edit-form{display:grid;gap:8px}.sw-edit-form textarea{width:100%;box-sizing:border-box;min-height:52px;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:9px;padding:9px 10px;font:10.5px/1.6 ui-monospace,Consolas,monospace;outline:none}.sw-edit-form textarea:focus{border-color:var(--ib-line)}.sw-cond-smiles{display:block;font-family:Arial,'Microsoft YaHei','微软雅黑',sans-serif;font-size:8.6px;color:var(--ib-text);word-break:break-all;line-height:1.5;margin-top:2px}"
  ].join("");
  css += ".sw-plan{display:grid;gap:14px}.sw-graph{min-height:180px}.sw-step{min-width:300px;width:min(540px,86vw);max-width:none}.sw-struct-card{min-width:150px;max-width:210px}.sw-struct-card img{height:120px}.sw-struct-card .sw-struct-fallback{height:120px}.sw-cond-smiles{display:none}.sw04-more{position:absolute;right:0;top:calc(100% + 6px);z-index:40;display:grid;gap:6px;min-width:170px;padding:9px;border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel);box-shadow:0 14px 40px var(--ib-line)}.sw04-more .sw-mini-btn{width:100%;text-align:left;justify-content:flex-start}.sw04-difficulty{margin:10px 0 0;color:var(--ib-text);font-size:12px;line-height:1.7}.sw04-difficulty b{color:var(--ib-text);margin-right:6px}.sw04-reaction{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,.62fr) minmax(0,1fr);gap:18px;align-items:center;margin-top:14px}.sw04-reaction-side{display:grid;gap:8px;min-width:0}.sw04-reaction-side>small{color:var(--ib-text);font-size:10px;letter-spacing:.08em}.sw04-arrow{display:grid;justify-items:center;gap:9px;text-align:center;color:var(--ib-text)}.sw04-arrow>strong{font-size:46px;font-weight:400;line-height:1;color:var(--ib-text)}.sw04-arrow>span{font-size:10px;line-height:1.6;color:var(--ib-text)}.sw04-arrow>em{font-size:9px;font-style:normal;line-height:1.5;color:var(--ib-text)}.sw-ev{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,.85fr);column-gap:12px}.sw-ev-top,.sw-ev-quote{grid-column:1}.sw-ev-shot{grid-column:2;grid-row:1 / span 2;margin-top:0}.sw-ev-shot img{max-height:210px;object-fit:contain}.sw04-form{display:grid;gap:9px;margin-top:12px;padding:12px 13px;border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel)}.sw04-form input,.sw04-form textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:9px;padding:8px 10px;font:10.5px/1.6 ui-monospace,Consolas,monospace;outline:none}.sw04-form input:focus,.sw04-form textarea:focus{border-color:var(--ib-line)}.sw04-form .sw04-form-acts{display:flex;gap:8px;justify-content:flex-end}@media(max-width:780px){.sw04-reaction,.sw-ev{grid-template-columns:1fr}.sw04-arrow{padding:4px 0}.sw04-arrow>strong{transform:rotate(90deg)}.sw-ev-shot{grid-column:1;grid-row:auto;margin-top:8px}}.sw-struct-compact{min-width:120px;max-width:170px;padding:5px;gap:3px;cursor:pointer}.sw-struct-compact img{height:120px}.sw-struct-compact .sw-struct-fallback{height:120px}.sw-struct-compact .sw-struct-acts{display:none}.sw04-cond-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;text-align:left;max-width:340px}.sw04-cond{display:block;font-size:9.5px;line-height:1.5;color:var(--ib-text);word-break:break-word}.sw04-cond i{display:block;color:var(--ib-text);font-size:8px;font-style:normal;letter-spacing:.06em;text-transform:uppercase}.sw-step-chem{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:center;background:var(--ib-panel);border:1px solid var(--ib-line);border-radius:10px;padding:6px 7px}.sw-step-chem-reactants,.sw-step-chem-products{display:grid;min-width:0}.sw-step-chem-flow{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}.sw-step-chem-mid{display:grid;justify-items:center;gap:3px;min-width:0}.sw-step-chem-node{display:grid;gap:1px;min-width:0}.sw-step-chem-node .sw-struct-card{padding:4px;min-width:96px;max-width:120px;background:var(--ib-panel)}.sw-step-chem-node .sw-struct-card img{height:96px;background:var(--ib-panel);padding:1px}.sw-step-chem-node .sw-struct-fallback{height:96px}.sw-step-chem-node .sw-struct-name{font-size:7.5px;color:var(--ib-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}.sw-step-chem-node .sw-struct-name b{color:var(--ib-text)}.sw-step-chem-arrow{flex:none;color:var(--ib-text);font-size:20px;line-height:1}.sw-step-chem-cond{flex:none;max-width:120px;font-size:8px;color:var(--ib-text);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.sw-step-chem-empty{color:var(--ib-text);font-size:8px;padding:6px 4px;font-style:italic}.sw04-fact-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.9fr);gap:12px;align-items:start;margin-top:12px}.sw04-fact-list{display:grid;gap:8px;min-width:0}.sw04-fact-item{border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel);padding:10px 12px;cursor:pointer;text-align:left;color:inherit;transition:.15s}.sw04-fact-item:hover{border-color:var(--ib-line)}.sw04-fact-item[data-active=true]{border-color:var(--ib-line);background:var(--ib-panel);box-shadow:0 0 0 1px var(--ib-line) inset}.sw04-fact-item[data-undecided=true]{border-color:var(--ib-line)}.sw04-fact-shot{min-height:120px;border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel);padding:10px;position:sticky;top:8px}.sw04-fact-shot .sw-ev-shot img{max-height:300px;width:100%;object-fit:contain}.sw04-review-acts{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}.sw04-review-acts .sw-mini-btn{font-size:9px;padding:4px 9px}.sw04-batchbar{margin-top:12px;border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel);padding:10px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sw04-batchbar b{font-size:11px}.sw04-batchbar small{color:var(--ib-text);font-size:9px;line-height:1.5}.sw04-correction{display:grid;gap:7px;margin-top:8px}.sw04-correction textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:7px 9px;font:10px/1.55 ui-monospace,Consolas,monospace;outline:none;min-height:52px;resize:vertical}@media(max-width:900px){.sw04-fact-layout{grid-template-columns:1fr}.sw04-fact-shot{position:static}}.sw04-fact-compact{display:grid;gap:7px;max-height:300px;overflow-y:auto;padding-right:2px}.sw04-fact-row{display:flex;align-items:center;gap:10px;border:1px solid var(--ib-line);border-radius:10px;background:var(--ib-panel);padding:8px 11px;transition:.15s}.sw04-fact-row:hover{border-color:var(--ib-line)}.sw04-fact-row-main{flex:1;min-width:0;display:grid;gap:2px}.sw04-fact-row-title{font-size:10.5px;font-weight:650;color:var(--ib-text);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sw04-fact-row-meta{font-size:8.5px;color:var(--ib-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sw04-fact-row-claim{font-size:10px;color:var(--ib-text);line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sw04-fact-row-status{flex:none}.sw04-fact-review-btn{flex:none;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:6px 12px;font-size:10px;cursor:pointer;white-space:nowrap}.sw04-fact-review-btn:hover{border-color:var(--ib-line);background:var(--ib-panel)}.sw04-fact-review-btn[data-done=true]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.sw04-review-backdrop{position:fixed;inset:0;z-index:3000;background:var(--ib-panel);backdrop-filter:blur(2px)}.sw04-review-drawer{position:fixed;z-index:3001;top:0;right:0;bottom:0;width:50vw;max-width:900px;min-width:640px;display:flex;flex-direction:column;background:var(--ib-panel);color:var(--ib-text);border-left:1px solid var(--ib-line);box-shadow:-28px 0 70px var(--ib-line)}.sw04-review-head{flex:none;display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--ib-panel);border-bottom:1px solid var(--ib-line)}.sw04-review-head-main{flex:1;min-width:0}.sw04-review-head-title{display:block;font-size:13px;font-weight:700;color:var(--ib-text);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sw04-review-head-sub{display:block;margin-top:3px;font-size:9.5px;color:var(--ib-text);line-height:1.5}.sw04-review-close{flex:none;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:5px 11px;font-size:10px;cursor:pointer}.sw04-review-close:hover{border-color:var(--ib-line);color:var(--ib-text)}.sw04-review-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}.sw04-review-field{font-size:10.5px;color:var(--ib-text);line-height:1.6}.sw04-review-field b{color:var(--ib-text);font-weight:700}.sw04-review-shot{border:1px solid var(--ib-line);border-radius:12px;background:var(--ib-panel);padding:10px;min-height:120px}.sw04-review-shot .sw-ev-shot{margin:0}.sw04-review-shot .sw-ev-shot img{max-height:420px;width:100%;object-fit:contain}.sw04-review-hint{margin-top:6px;border:1px solid var(--ib-line);border-radius:9px;background:var(--ib-panel);padding:7px 10px;font-size:9.5px;color:var(--ib-text);line-height:1.5}.sw04-review-foot{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--ib-panel);border-top:1px solid var(--ib-line);flex-wrap:wrap}.sw04-review-foot .sw-mini-btn{font-size:10px;padding:6px 12px}.sw04-review-note{flex:1;min-width:140px;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:7px 10px;font:10.5px/1.5 ui-monospace,Consolas,monospace;outline:none}.sw04-review-note:focus{border-color:var(--ib-line)}.sw04-review-quote{margin-top:8px;padding:8px 10px;border-left:2px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);font-size:10px;line-height:1.6;border-radius:0 8px 8px 0}.sw04-review-quote b{color:var(--ib-text)}.sw04-review-next{align-self:stretch;border:1px solid var(--ib-line);background:var(--ib-panel);color:var(--ib-text);border-radius:8px;padding:6px 12px;font-size:10px;cursor:pointer;white-space:nowrap}.sw04-review-next:disabled{opacity:.4;cursor:not-allowed}@media(max-width:1100px){.sw04-review-drawer{width:65vw;min-width:0}}@media(max-width:850px){.sw04-review-drawer{width:100vw;max-width:none;min-width:0}}";
  css += ".sw-plan{gap:10px}.sw-sec{padding:12px 13px}.sw-head h3{font-size:16px}.sw-head p{font-size:11px}.sw-chip{font-size:10.5px}.sw-graph{align-items:flex-start;gap:10px;padding:4px 0}.sw-step{align-self:flex-start;min-width:420px;width:min(660px,90vw);min-height:0;padding:10px}.sw-step-id{font-size:11px}.sw-step .sw-step-reaction{font-size:14px}.sw-step-chem{gap:10px;padding:8px}.sw-step-chem-flow{gap:7px}.sw-step-chem-node .sw-struct-card{min-width:150px;max-width:180px;padding:6px}.sw-step-chem-node .sw-struct-card img,.sw-step-chem-node .sw-struct-fallback{height:138px}.sw-step-chem-node .sw-struct-name{max-width:180px;font-size:10px;line-height:1.45}.sw-step-chem-arrow{font-size:25px}.sw-step-chem-cond{max-width:150px;font-size:10px;line-height:1.45}.sw-step-chem-empty{font-size:10px}.sw04-detail .sw-struct-card{min-width:190px;max-width:260px;padding:8px}.sw04-detail .sw-struct-card img,.sw04-detail .sw-struct-fallback{height:180px}.sw04-detail .sw-struct-name{font-size:11px}.sw04-reaction{gap:14px;align-items:start;margin-top:10px}.sw04-reaction-side>small{font-size:11px}.sw04-cond{font-size:11px}.sw04-cond i{font-size:9px}.sw04-arrow>span{font-size:11px}.sw04-arrow>em{font-size:10px}.sw04-review-drawer{width:96vw;max-width:none;min-width:0}.sw04-review-head-title{font-size:15px}.sw04-review-head-sub,.sw04-review-field,.sw04-review-quote{font-size:11px}.sw04-review-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:16px;overflow:hidden;padding:12px 14px}.sw04-review-copy,.sw04-review-source{min-width:0;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:3px}.sw04-review-source{height:100%}.sw04-review-source>.sw04-review-shot{min-height:100%;box-sizing:border-box}.sw04-review-source .sw-ev-shot img{width:100%;max-height:none;height:auto;object-fit:contain}.sw04-review-hint{font-size:10.5px}@media(max-width:1100px){.sw04-review-drawer{width:100vw}.sw04-review-body{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}@media(max-width:820px){.sw-step{min-width:340px}.sw04-review-body{grid-template-columns:1fr;overflow-y:auto}.sw04-review-copy,.sw04-review-source{max-height:none;overflow:visible}}";
  css += ".sw-struct-card img{object-fit:scale-down}.sw04-detail .sw-struct-card[data-preview-tier=simple]{width:200px;min-width:200px;max-width:200px}.sw04-detail .sw-struct-card[data-preview-tier=standard]{width:260px;min-width:260px;max-width:260px}.sw04-detail .sw-struct-card[data-preview-tier=complex]{width:320px;min-width:320px;max-width:320px}.sw04-detail .sw-struct-card[data-preview-tier=simple] img,.sw04-detail .sw-struct-card[data-preview-tier=simple] .sw-struct-fallback{height:140px}.sw04-detail .sw-struct-card[data-preview-tier=standard] img,.sw04-detail .sw-struct-card[data-preview-tier=standard] .sw-struct-fallback{height:180px}.sw04-detail .sw-struct-card[data-preview-tier=complex] img,.sw04-detail .sw-struct-card[data-preview-tier=complex] .sw-struct-fallback{height:210px}.sw-step-chem-node .sw-struct-card[data-preview-tier=simple]{width:135px;min-width:135px;max-width:135px}.sw-step-chem-node .sw-struct-card[data-preview-tier=standard]{width:180px;min-width:180px;max-width:180px}.sw-step-chem-node .sw-struct-card[data-preview-tier=complex]{width:220px;min-width:220px;max-width:220px}.sw-step-chem-node .sw-struct-card[data-preview-tier=simple] img,.sw-step-chem-node .sw-struct-card[data-preview-tier=simple] .sw-struct-fallback{height:108px}.sw-step-chem-node .sw-struct-card[data-preview-tier=standard] img,.sw-step-chem-node .sw-struct-card[data-preview-tier=standard] .sw-struct-fallback{height:138px}.sw-step-chem-node .sw-struct-card[data-preview-tier=complex] img,.sw-step-chem-node .sw-struct-card[data-preview-tier=complex] .sw-struct-fallback{height:160px}.sw-mini-btn[data-danger=true]{border-color:var(--ib-line);color:var(--ib-text);background:var(--ib-panel)}.sw-mini-btn[data-danger=true]:hover{border-color:var(--ib-line);background:var(--ib-panel)}@media(max-width:720px){.sw04-detail .sw-struct-card[data-preview-tier=complex]{width:min(320px,82vw);min-width:min(320px,82vw)}}";
  css += ".ib-lit-btn[data-ready=false]{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.ib-lit-btn[data-ready=false]:hover{border-color:var(--ib-line);background:var(--ib-panel);color:var(--ib-text)}.sw04-review-body{display:flex;flex-direction:column;overflow-y:auto;gap:12px}.sw04-review-copy{display:flex;flex-direction:column;gap:10px;min-width:0;max-height:none;overflow:visible;padding:0}.sw04-review-quote{font-size:15px!important;line-height:1.8;padding:14px 16px;margin-top:2px}.sw04-review-field{font-size:12px}.sw04-review-shot{padding:12px}.sw04-plan-preview{width:min(920px,94vw);max-height:88vh;overflow-y:auto;display:grid;gap:14px;padding:18px;border:1px solid var(--ib-line);border-radius:16px;background:var(--ib-panel);color:var(--ib-text);box-shadow:0 28px 80px var(--ib-line)}.sw04-plan-preview-head{display:flex;align-items:flex-start;gap:12px}.sw04-plan-preview-head>div{display:grid;gap:3px;flex:1}.sw04-plan-preview-head b{font-size:16px;color:var(--ib-text)}.sw04-plan-preview-head small{color:var(--ib-text)}.sw04-plan-preview section{border:1px solid var(--ib-line);border-radius:10px;padding:11px 13px}.sw04-plan-preview h4{margin:0 0 7px;color:var(--ib-text)}.sw04-plan-preview p,.sw04-plan-preview li{font-size:11px;line-height:1.7;margin:0}.sw04-plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px}.sw04-plan-grid>div{display:grid;padding:8px;border-radius:8px;background:var(--ib-panel)}.sw04-plan-grid span{font-size:10px;color:var(--ib-text)}";
  css += themeCss;
  if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=dsh-lab-agent]") === null) {
    const style = document.createElement("style");
    style.dataset.pluginCss = "dsh-lab-agent";
    style.textContent = css;
    document.head.appendChild(style);
  }
}

// client/src/apply.js
var import_react_dom2 = __toESM(require("react-dom"), 1);

// client/src/h.js
var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;

// client/src/descriptors.js
function buildDescriptors() {
  const pass = { parse: (value) => value };
  const strict = (symbol) => ({ mode: "strict", typeSymbol: symbol, schema: pass });
  const direct = (method, params = []) => ({ id: `dsh-lab-agent#lab/${method}`, service: "lab", namespace: "lab", method, invocation: { kind: "direct" }, parameters: params.map((wire) => ({ name: wire, wire, source: "json", codec: strict(`dsh-lab-agent#lab/${method}:${wire}`) })), result: strict(`dsh-lab-agent#lab/${method}:result`) });
  const descriptors = [
    ...["synth_compound_resolve_first", "characterization_list", "characterization_submit", "characterization_retry", "characterization_dispatch_failed"].map((name) => direct(name, ["request"])),
    ...["versions_list", "goals_list", "templates_list", "note_templates_list", "nmr_list", "convert_available", "convert_runs", "python_preflight", "cas_policy", "cas_login_entry"].map((name) => direct(name)),
    ...["versions_resolve", "goals_resolve", "goals_create", "goals_update", "goals_copy", "goals_delete", "goals_requirements", "templates_resolve", "templates_preview", "templates_validate", "templates_import", "templates_confirm", "templates_update_meta", "templates_archive", "note_templates_resolve", "note_templates_create", "note_templates_update", "note_templates_copy", "note_templates_delete", "note_templates_requirements", "projects_create", "projects_delete", "projects_get", "projects_ensure_workspace", "projects_bind_workspace", "projects_bind_session", "projects_binding", "projects_by_session", "projects_by_workspace", "projects_by_cwd", "projects_memory", "projects_memory_update", "projects_workspace", "tasks_searches", "tasks_provenance", "literature_status", "literature_configure", "literature_connect", "literature_verify", "literature_download_create", "literature_downloads", "literature_download_retry", "tasks_search_create", "tasks_bundle_create", "tasks_report_create", "tasks_report_complete", "tasks_report_validate", "tasks_report_review", "tasks_presentation_create", "tasks_presentation_complete", "tasks_presentation_validate", "tasks_presentation_review", "tasks_review_details", "tasks_search_ris", "tasks_overview", "tasks_report_download", "tasks_ppt_download", "chem_entities", "chem_entity_create", "chem_properties", "chem_formula", "chem_metrics", "chem_plans", "chem_plan_create", "chem_plan_validate", "chem_plan_status", "nmr_get", "nmr_create", "nmr_integrals", "nmr_approve", "nmr_written_back", "nmr_verify", "nmr_reopen", "nmr_calculate", "synth_targets", "synth_target_create", "synth_routes", "synth_route_create", "synth_route_delete", "synth_route_step", "synth_route_status", "synth_evidence", "synth_route_detail", "synth_route_revision", "synth_route_update_step", "synth_step_review", "synth_evidence_list", "synth_evidence_add", "synth_evidence_review", "synth_step_assess", "synth_route_assess", "synth_step_alternatives", "synth_extraction_capability", "synth_extraction_jobs", "synth_extraction_job_create", "synth_extraction_job_update", "synth_plan_from_route", "cas_prepare_query", "convert_upload", "project_file_upload", "manual_capture_create", "manual_capture_get", "manual_capture_list"].map((name) => direct(name, ["request"])),
    direct("projects_list")
  ];
  descriptors.push(
    // rc.4 review（§5.2）：synth_route_lock 已移出 Remote 网关——
    // 「锁定版本」走专用 loopback user-action 端点（可信 UI 用户动作）。
    direct("synth_compound_resolve_dual", ["request"]),
    direct("synth_review_batch_create", ["request"]),
    direct("synth_review_batch_get", ["request"]),
    direct("synth_review_batch_complete", ["request"]),
    direct("synth_review_uncertain_apply", ["request"]),
    direct("experiment_plan_templates_list"),
    direct("experiment_plan_templates_resolve", ["request"]),
    direct("experiment_plan_templates_create", ["request"]),
    direct("experiment_plan_templates_update", ["request"]),
    direct("experiment_plan_templates_copy", ["request"]),
    direct("experiment_plan_templates_archive", ["request"]),
    direct("plot_records_list", ["request"]),
    direct("plot_records_create", ["request"]),
    direct("plot_records_update", ["request"]),
    direct("plot_records_remove", ["request"])
  );
  return descriptors;
}

// client/src/brand-icon.js
var BRAND_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAFEZSURBVHhenX0HeBXF+v4B0ggllEASEghJKKEloIiIItareC3XXn96sXcFRekQelEURAUChBR6D6EnJCShSO8dRFFUwEMNpJC8/2e+mdmdmd0TvP88z5fdszs7Ozvv+5X5ZvYcT0VFxcmKigpvRXm5t1yI7/0KbzlJuZeuEXKp5Lo3//fj3gm7c73vrJ/rfXTZZG+X+V9726eP8LZNHepTEkiGCRnqTUgbJmS4N5FJOt+yz/K4b5HXDvO2ZZLKRK3TRdKNrSFUR5peR6JZTrRfHmdbRxmrrPrc8tn5ftuZSSRsP1E5xuq6Y+447yNLvve+mzPH+92uXO+mM8e9V0uLNQwkRqpwvDiGUqxz/LqTnvLy8qv4//zb/vdvGLR1JR5c9j1azxqBZulJaJExFK0yhqPt7JFImDUSCXIr9hNnj0KCELbvS9rPGW1J4mwmo5DI9unYGH7cFCo32kf9rAyvl9ch6rau1cvL68162pPwuqx2uQgrx8tIYc8uxSw/EomzdLH6bNZItM0YgVYZw9AiLQlxqYPRZtZwPJz5PYZsW4Ud538zYfnHfxXlFVcZAbz0oaJCSLmyrx+Tf8tP7sMzWVMRN2MgopP7I37mELRLG4Z26cP5VpVULgnqNo2XS0gbXqkkpo/gwva1YyPtc+kjkEBlxL5LPXSdJva1tO9SniSVCW+zJUadVjltn5WTYn62j6vPZd5P9psm1KdD0TZ1KFrOGIyoqX0QO30Anl+RjJU/77eBdeDoxJQToNzrQgCnyL+dZ0/jpVUz0Di5H93YAbZ4OAf4BhHsjnET+5xJAAd41jkJpBNM/Vp3cYBBQPgggAq2W3n6bDyjrzo0QpllbCLI+hyESB1GZIiZNgBNpvXDyytnYM852yJUlDuB58fK6TzD3iYAO1HOCtiF2L78+3ZXLlqmDkH0tP4KG1XglQdRtpIA1sNUCr59XWK6EHFcI4CLBlcuwyxx1z52Tr2/0fmVSWVAy3rN4ya5xP1sAtplb0aAdqlDrf0myX3RMmUwJu5ab5PAJAAJJ4BhAQQBDM33Fhehx5p0NJrSB61mJjmAtzTdAF4KM/f0IKKceV4tx8/bgJtl7HOVmG+j8xNZx6pikcFJENnhVluVjtYAmWkCqot1jUKmm4oPspj39i2MCEMRP2MIIiZ/gdfXpBF2HGjTAkgXUOGbAOzv9JULeHjxJERO6WPfyCcTTUvgBIYexkcZHhcIwvwD0TSY6rW3HeaORof5Y9Bh3mi0ZwEWK5syDB0yRuGWRV/hloVj0YEFhGkjcAsLBlmgmjqUC2vfrBFKh/OOtTSNgT9zKG3peVwAk2Keq1z0fvJ1Pd1faUs71hbZvplD0VZIo8lf4qFFE3H6CsHrSgDdBVgFbPDvmf8NGk/tq5kZXeyOaXsTgLmIh1DKqFaEHtLX9ZbvVc/b1zCLwCLvdtOHoPngD9Cs33toNbYX2k0ZhMSMkUhMHY6Wwz5Gk3deRvSHr6HVuM+ROHMYWo35DG0m9EWHhWN55J42Aq2/7UMjg4SMEfz5WPsIdCmi890AksAYx5jVcCtvi6398j7OMkLYOdkGrV0cfLkfNbkPus37mrDUMK4sCGR/f18vwr8WT0KTqf14pRYBTCIon+WNZSNNAGXkL8ubJPBFIDVgsuoV5awOGYaElCQkzEhC2+/7IbZXD9S/txsC6jVB9UZxqNPhNkS+8B80fu0ZhHbtipDEWxEc2QK1WyeiXreuCOl4G8KfeATx43uj5ahPEftZDzR65WnuZmaNQOsf+tNwTCWALzfgAF7Zl8SwnlUr4zT/Zr3aNRYRFQJoViCJtlFT+uBfiyfa7kDB2REEogIor6jAa6tTyeezmzHwuaig6zelRikE4EC6EICO6w9UqUsxHlqWZ58ZOB0WjEWHRV8hbsgHqHdvN9Ro0pIAZxLcuAUC6zaGf80I+AeFwc8/FAE1whFYOxI1ouMR3Lg5/IMawi8oDIH1msDPvwGCwmMRckcnhP+nO0K73YuaLRMQP7YX4gZ/gBZjeqH93FHU8cyaOAmgaDABpJOE9Y39HEo/KX3CRdd86/mVvpV9Ta7AFwFSkrjMTELEj1/gtdUzCVuOtQ8LwP7G78hB+I9f8Iq0xkpzrxOA+yMDfPOhFI3l501LIupXH9J8aHENI1L7+WNoG9P7TTTs/iBqt2uPoEZx8K8RAf+ajRBQi0tgSBQC6zRGYB22jRKfoxBQOxIBtSLpXAATebxGBJUJYpYjPA5+gZwUTT97HSGd70Crb77ELfPGUuzASNCeuRaWe1DBlvvCRDuJIp9fKI+0eEYZFrCapLJcj9L33BLoIuMARoA2gghhP/bGBDE6cLUA7G/P2d8QN30QWqUMsSpxBV8hgCUKqFaD5WfDZKvnrMZqdSkEkA+bNow0nmXNWo7uibCnH0FQw6aoVi2UNDyAAS+BZmAKUJ2iEMJNQvi1jCSsrH/1cFRv1IyIUO+OLmjW+03EfvkWbl02Hm0m9Uebb/ug/axRSEjhfpkLB0YDR/SZDaYktGEVXQkjzjsIIF2BFP283bdJiJ8xGM1mDNLyBEYQCLy4YgaiWdCnXmxppgKy6XvEea2xDgLYQZsJsEoCjQjic0I614SmH7+GOu07knb7BYZZWkyAS+AVTddBV8U873aNuK5uY25RakYgqH4T1GraGg2ffhRNPvo/1GidiJbjelPQyLKR7eeOpiCSk8FdO9V+ob5RRYJoHlf7VCWAWbfAwTwmSdB4Sh+8uGI6KpivlwRgY0H2IevkfkSZ4MsKZQzg4wb2zd0JoOUINDarDdQJwBrMrm2/YCwFYFHvv0xayHw1104FcGVrHTfNv7VvEsD87OuYsAw1G6F6ZDNU9auHhs89ikb/fR4tx3yGdhkj0Pi9VxA36AM+mrCsgJuyyL5hn10AJdNu96PeZ7K8S72K6H3J+5O5AxbbrRJpY4oB2KwQ+/Bk5lTEJPd3AcMAszJX4IsAggTaKECYf7WxtvAItm3KUMT0fQd1brmNfHtgbQGCAFzdN8FyAKppuAmwaRnMz1wssjGLULcxarVORM1mrdC4x3MIatwc9R9/FG1mDEWbb76kEUmlVsAC0wBSgu7iChz1uInAxK1P28xMQtOp/fH08qmcABUVnADbz/+Gpgx8ETVWTgDeaK1hFjHMY04CWGUdDVSOpSQhccEYxA3/GDVbJ8A/OIIHbg5gnQDdrIxT3MH2JRb56kRxUoZEomqVuqjepDlih36I+g88gKjXnqGEE0tIuRJA9qsBvtZ3bn3sqGMo2qUIkZ8FDmbfMmViW2YFopP7Ycffv9sE6L85i/yDLGSDIW4qGmAy0tFApfEO4mjDPSf48p7UEXNGIbbfOwhp3xGB9aMRECJMvqrFLj77n4DvLONGAPOzu1gWoWYEarVMRFBoEyJs/Pgv0KzPW4j9/A1KTJHrs0YGLiDK55b9KcrR1gK+kmtVAriIiiuzAo2mfIl+P2VxAlwqvu69b/FEtJg+yCpoVuAAUxO1DN8y4lA9Mmg0RGemYXHSR6D5iE9R/4F7ERzTkpt5IVbnu4BfmUhXYV37j1wHHyKqn7U61eutQLERqjeKgb9wEZE9nkFixgi0Z5NaCrC+RFMote9dyv7/iOzj5tMH4p7FE8AW8njW/3rY2zKN+wd38KVw8Bxa77OBKkFMEji1n5GPWQm2jf7oVYTe2w3VI+IQUJuP56mzFSB18JxarJ63yCPAl0M9x/l/KBqZtHONKZdQPbwpYj7vgXbJg9F2Qj+KByQBbJfg7Dd3AvwTccFB1GFiyj4zrJunJiHn1yNez5if1nhjUgbZGuhyczs6dSGALK8EhLwed+13JwCPUJk0G/cZGjzRnbJzTKMsgCRo0iIona6BooBkksA8Zol6ToDqWs64xq0cc1eUjYyIRXBcK0S9/yqNgG6ZPwaJbokbw3xLF6CSgGf8JMgm0D72fYjs76YzBmL01jVez39Xp3mbzeSJH16JuIlZmTHOZ1kqq6ws77hGsQLavtoY6QaS0G7eKET3e5v8KCOACrYqDjAqOa4C5vN6OhepWRjzvONYJUIBKyNvg6aoHhWLup07o/mA99GeLfGyNNypaLIvZRZRHneQxhTZ76r1UPrZTBmzvmaYv7Z6ptfzr4XfeVulK40RDLQ0Wz3u0Hy3h9Cv8SmaBWC+fzhivnwLNZq35Zk9Mdb3CZra4S7HHBqqWBANUPOzmzjIU0mQqLqW2pE8kxjWDJFvvsTTxrJ/rb4z+9GtT92OSWKo2CkjCUsp1aBSXpuE+LSheGDRBK+n85xx3rYZw+0bVQKsBN9msKLVLuW1BgnQzfME/qwRaPrFGwiKbkkZPkeHSktgAOVqGW4CJpWtlAAuLsUkk4g53MgpP9vnGqNW8zZo9PwTaJs8hFY52QRQRXEHN4nq3c5TzkGz0BwX67NRvk36cHScPdrraZ823MuyWHawoAOljgy0yl1MlSWSeabVUDVegp8+HG1ShyL8lScpw0bRtKpFkgAKeFosYILpAobredUiuJxXr5X3cNTnInp8wmOCgJrhqNW8LVqO7IlbFo6zwHLtOyYuAPPjSc5jYrgosVD7W51ZdNyLYZ461Otpm5LECeAyBNRMtMmwm/kmFXghan00x8BWEc8bTUO+atXq0Xja7FAS2amSCBIQlQQmmG6AKYQhYEIi4V87EtXY3ALNK8iywgo4TH/looLPYwoeV7DPfgENaPKq5dheaD9nlMMvW6KBb4DmgxgSCwcmFvhqeUGijBFoM2OIkwBuJLBupBFAtQbsvHEjFwLI+jgBhiFx0TiEP/84qvnx/D4Hkmf81I5Xtd/sdBV4v9qR8FQPg8evPjxV63Lxr49qNRsR0KwO/xAOuCewITz+oSSBtbnVofLV6sLjVw8etnaAzQYykohElINwFlnsmEAji0U4Tja/gFCEvfIU2gsroAPjktUz+7QS4eA7Tb1PSZcEmDnUy5Y+cWCcuQCfBFCExwBOAujRv2KGGPjzxyB24PvwCw6DvwBAaqUJtrVvaSQnC5OqNSPgCQyFp0odVKsZjhbxiXjogQfx8jNP4vUXn8edXe9DcL0m8ATU4+BWq4/qIRFo26YD3njlJXw/oh82LJiKzYuTMXFYH7z16it47OGH0bBxK3g8teEJCkXVWlGcMEyCwijRoxPAtlAmOVVC+NcIR1CjZmg+uhe9NHJzsNyTR25AO7Rf4GntE7GSbDfCLEBKErMAKgGcFsBxE8dw0KnlJC5m3zon5gWi3noRde/uCv+a4Tb4ipnXNN5yA7wMAe9fH7UbxqBt4m3o9e7rWJ3+Hc7vWA6cLADObAV+/wn4ZTMOrV+AlK+HYvq4Iej13ttI+ToJf2xbDvy2RZTbCpzeAvyxFfiN7f+EUwWLMKrPJ/jknR748uN38cRjT+DLj97Bk90fovsSGYK5ldBAV8SyYtLt1GoE/7pRiHznBbSf5zJP4MPEu51XNd7V/BsiVwgRAVg9kgDsn+UCXOIAs1K5mkWuRtECDaH1qplXCUB1ywAxYwRajOpJK29oMYdFAJ0E1HHiONsn8+2pjVr1GqPn2z1wPH8hSg/nAr9v42D+XIjyY/koO7aBpPzYBuDXzcCfO4A/tnOQf9kMnNqEG0fyUHZ0gyWl9DkP5Uc3AKc20jVlxwpw43A2yo/mAn9swy/58zGy/2e49dbbERPXClVrRNhzFSrwqvZbbiMSfkEN0eTtF2nVshrUkYbepP9NsOU5E3zf8YVYJsbuy4JvNwLYF1Qe6HHQXYZ6jiyfQSyxxjBx4VhEvPAf+AU1sEH3Mekjj3sCG9AMXM/XX8Kx9XO4Bv+yCRUM7KMcPCmltLXBLTPAps8CcAcJSHgZRiApjDA4uZEsRvHRHEz7Zjhqs/WELIDU4gIXy8WCwjqR8A9sgLqdu1iLXGR/uimf1t+atvO+9+kKVOWU54hg0gIkoV0GI4AaBBJYNiPtIM/ZGDrvyw0Y5t4mgqhbEKDd7JGI6vECD/4oBrC1nGu93qEsWAuPiEVO6jjg7FbS6hsWsE4gCUxrX5wXJGDHpbYTWY4wwujXWuVNEcdxogDFJzZix4o0RDZuhqrVG2qgW8+hxTCRtDC1euPmiJ/Ul94/MPvJ7GcbC1PjRd/LchJglQTivE0SBV/20ulMigGkBdADQIdpN4IRfhMlCKyEANoxViZjOOInD0CNpvF8rl90jgW80ZFVghqiXoNo7FjyA/DHFg68ofEm+A4wVbAJcCGmZTBFlFfBl8dYrFF+Mh8PPsDiglBr2KcFrebzMDfgVx9Rb75AVlD2jSpqP/O+lkDbGDhHYb7zBG7CCTBUcQHKQhAqJAggzbpZAVUiXIBDxHm5nlCtk/z//DGI/vx1BNTjgREH2tR+Po5mwzcWvc/9ZhDw11YF7H8CvCmmNtvnnBbA/RpOhlyUMmGxx5ltWD93MjwB9eFHz6K7MSuOsUgQCf/gMFriljBvtKYgTgJwxbPNv6GEKgEcQ8jKhL39NFIkgsxhoKxEJYCjArsMAaoSRbMKajm7fLtZI9Hiq88Q3LSltRRbC/qkRQiJpOHdIw89BJzZghssuPufQTflfyUAv8ayFobcOJoH/LIRTz76KLVVjQV07VeSQv4NEPHKUzQUtvpd9CkFaGKfA6+Y8X8M8M2Ev/5GFoAIwM0BF/UmEjBHBWoZPRawxSYQjyMUgrCl3WM/Q/XIFjz7JzpNDQTZ1q92I1QJqI+NC6dSBG6DVgkJKCD0LdL0m8f1Mu7H3AhAroBZgdk/wK96OLcCahxgjQAkKSIREByOmnGt0HbaYAoGuenmwMvRANu3fL1LLkAt4zgnpNJzVh5gphoEOgveTMxYwbYGamAoRFiBxLmj0WLkJ7wzKAOomn8eLZP2V6uLBx/4F0X75ZrpdwKkgWWRgFkMJia47nWowLuRgIsdS0jLwIaeF/dmI65lAjxBDTXwVYtgPSNbYh7eFK2+60vvOViaLcE3NN0E0iSEdt6nldDjA7L6nADcBbCDlRNA8TVqRYrWO8y/tCDyGLtGZAFj+r4Fv8BQSzsod04dpBDAUwtTxw4Czu3kPtcHcJUK5QNsErhH/PY51TWUCgI5y6vxRx4qThbi6sEc3HbbnfAE2MNajQAWEdhbSREIrN+Y1g6ydw9lvzqSNUZQx4HnOJiksETBRx3VmcJdQJLXk0AE4C8+3owA2k1NLTeB9iWMAAvHIuypR1DNL1TTFDsPEEmZvqDa4Ti0bhZl6Tj4vNN9aaoTKOPYEfcyWnmNIJI4uhVRy8qYAn9tR9+P34enSog1pNXSw6oloOFgBOL6vUPvG1Lfq0kaStk6CcDE1H6ncAJpsYUghTbM1y2A+ubrPxQTeNEw1ZU4IltGDpYGzhiB2rd1oiEgN/u2/5fC0q2du3RF2Yl8SsKYZpt8sqKlEiRXgFlSR7nOLu/mHkyx63Wct2KBXOCvHZgyZjA8VWppLo0D70wU+Qc0QMTTj9KLL9RXGgH0WEAVfVzvJnY8wbYcdPUYJxYngEgESRfgEE2bBfMcpl1npAm6ta9ekzEcUR//nxUDcBdgdxYRoFpdfPhWD0rdsg42CeAEUzl2k0CQylO62CCAgyjOrSbMolAgmEtWqmDuDwiq05jS1SrY6hDXGt7WiEDjD/8PCXNHaeCrowBfcnMSqGKAL+ugIFASQMlIVSquvt3WfHOrHVOuSVwwFo0/eAXV/OrrQyUrCGRTs3Xw9cBenACazzU0n0A0CKCCql0jj7sTwJKbEsgWGTfg5wL8unEpIuPaoUr1MMvf60Swn5GlwJv2eQuJLBegEcCl30kq9/2+MrZO8PlnmwBiGOi80L5AM+ECRDXat84bFkA9zq+3CRDZ41n4s9k01VwKK8Cmh6vUCEf2nB9oRk/1/1bHS9AlkGqgp5VzguZGnP9/kQQoxNkdKxHfugMfCRigcxFDXPb+QEQs4sd/jgT2nYqq9lsWQFpc3cq6xQBECpUAPsmgXGMPA1UCONcDuIokgHaMb00CaPXJa9KHI/6H/ghuEu+6CoiBX79RLI5vWECTPTwyNwnAtu5WwCkuyR9f2m+ItBzMPbiTyU4Ln92aidYJnWhRiunzVWHPzNLgbacOoreGZOBn+n0Z9VtaLyaA1H7nw3DFMksslBlbDSd5nUoAlpnjYKnvBpqmQ6ncOGabeCf4GgkkAWaNQPyELxAUFmOt/VeFdWCL+ASc3ZZJmmUOzxxSCZhy6OgGnn2M1e88L6+3LRAD26UMiwGOb4B391q0SbiNZi2t53EhAUt/Vw9rilYT+5AF4H0o+v4fxACmcJBFwk0F34eSklizgYwAxoogx7zA/yDyGjcCWJ/Th6P15AGUCpYjAbvD+Ajgjs5dUXIkl6Z6KQegJF5MAHRxOW+AZsUFMrevAKxfJ4knRPtsl+EWoBDe7SvQseMdtGpId21ifaBCAPZdAy3GspVBzPqKaN3SfnXfEBcFVLVfBogyG2u7a5MAShBoEsCsXFbkswEGyLIc1eliFdqw8+nD0aD7g/wdAGPYxNb0PfzAg6g4yebh+TBL63wTBA14fr4yq6GRSanXIoQQTjx2by4s7y+PW3WLzzdY4HhqE556/Al4qtWxnsVaxaSMBNgz1+7QkfcV6091/C/G8XYyyNnX/1hU92Ccs4JA9s+VAAS4muVzViJFA1i5oQk8SQp/RTlhwVg0fPwR+FEySE8FswzgyH69gD+3ovRwjj37xkztiQKSihMFvNNVUC3gVM12EsAsL+u3P/OFIHSvU4XAr5uA02wV0Ua+//NGhRg2KdgKooxvhhEB/GViS+QA+L4gQGBD1L37LrSbPQJt2TebySDQjQAu/V25KC5EKq4LdlYMoBNA0WAZhFjRvjuTmKjXOQAXfo2vOOIPyV5OTFwwDhEvPYFq/vU081+1RjhCGkTjl/wFwv+zadf1HJDffsKl3atwbucqXD+YzcFh6/7OMGFLvcTqIAUUrqlSW9XkjSnMj+fz+n7fQpbn0p7VOLZhAdZkTMT0r4dg+JcfY+Lwfvh10xIiRNlhnTisjcXH8nFLxzspj8GBt3MbFgGqh6NWy3b8C5xIKQzfL/rKzASqQz0Z/Pke/gkRJLDjAWUYyFLB9nqASgigVaYDzI6bn2VZ9eH0AJMtCRuHxu+9LCyA4v89tfHqC88Bf27jHXw4l7S94kQ+Zk0ahf978Xm88vxz6PXeGxj25ScY1vdTTB8/FGsyJuFQ9hwUMyB/24KK4/l0ranZnBjS1Mtz/B5XDuQgK3UiPv/wbTz+6KO455770On2O9Gp8524485u6HJXN3S+8250f7g78hZMJUJy6yHqZesD/tqB1anfoUpAKF+KbmYC2TA3KAwhnTsTAfgb0VL77aidE8AFUOHf5VffukX65meJh1ZmliCAvh5AFBA31qYiKzHt/Jh74MjXutmvn8tybD4g8r/P8vkAMQMoM4DLpo8njWYdysx86fF8JH3xCW7t2Bn33Hs/7ul2H267/S5ExrahVcE1QqNRMzQaMS0S8Phjj+H7kf3x59ZMlLuSwHYn8hgbwp3Mm4vXX3kRbdt3Qqfb70LXrvfg7q73oEuXrnj4oe546vHH8NoLz+GFZ57CC888TQTJX5SMilNsmGrXRwtKf9lM7WPBrNsowK9qPUS88iTaLx4r8vY2Aazxv9mPKnhCoy0SGKC7EsAQNvTnFkCMAqyT/0PgYRLBLYslCSCB50RIAnsfscX4z1E9qpm1KISN/+tGxOH3LcsIFGb6K37ZhPnfj8LzTz+Jnu+/jff++wo+e/9NDP3yE3w3vC9+HDWAtqP6fIwBH72Jd159Ea8++ySWTxmF8qPrLc2UgZwNlgpaLk4XzMfKaaNxZG0aLu5aget7V+DG4Rzu29lK40PrgKPrcXXPSpzfvhLHc+Zi18p0lBzO4VPVrC5xHzZ7OajXR/B4QpwEYFnA6mGIevsFJM5XsoC+ht0kTlegE0BdMOoUFS+rDrIAypIwx01dwDSzUmrFbtpvn9MJQN8FwD6nDkWNZq3hLxInnoBQ3HLr7eR/ZacWH1qPU3lzcXnvalxn7uBIDl8N7N0NXNwLXNoHXNwDnNsG/L4ROJGDsj3LULRjCYHISKQRQLgVfowv7sSpfODXfOBUHor2rsLxnDn4afEUrJv1HZYlj8PCKV9h4dSvsDzlW6xOm4iCBVOxJyuV4pSLO1cSQWi5+Z/bebB4bgfWzJxAbxhpIxxh5QJqNELcgHeROI/NBCpZQJf+c/Px1jDPsgZO0H0uJJF1MAugLgu3wKrMAqiBIG35DXxpv3VOE4UAc0aiXre76L05Mv9V6+Cxf/+bOvEG0yT2gsdvm4HzO2l7ff8anN64GLtWZWDD/ClYlfYdVqZOxMrUCZQ23rJ0Bg5nz8G5LYtQemA1kQG/beKRO4vgTxbyOtn+H9sItD+2rcDiad8i6bMP8MGbPfDBm6+j5wfvYkifz/DV0P74bsQAJH81DNO+Ho4pXw3DhFFDMGJAb/T+5H30eOUlPPyv7rjz7gfx+isvYdSA3lidMQm/7ViBo+vn0xtJ1WjFEx8N8MmvRjQBFjfoPSSyqWB1HYAJkqrBhIvvMrKckwhOTKicnA7WgkARratugLNMyQUI5qmVadpvWAjbAujWgJGAmcDoD/+PvsdXBoDv9ngVKDpAgP+5fSUWT/0KY4b0x5cfvYvPP3wX/b/4HEP7foavB/fGpDGDMe2bEUgeNxjfjxqAYX0+xZeffIBP3+qBj995Cz3f6YGvh/bFxiUpOJm/EL9vWoJfNmfiQM58LJk2Hq+//BJeeeFFjB7SDyumjsLJvHnchDPSXdoLXNkNXN4FXN0PXNgDnN3Jtfz3LdwKHd+Ac3vX4vMP3oXH4w+PpyaCIuJRo3E7tOrYDfUat0ZQXfYVdRx89uqap1o9+DdphjbTeRpY5gC4G3CCSP1oYSJzBU5AVTEJYOJFZWQQ6HgxxGCaxSxL+/V5AIfZt4aNiijlVCvAkkHNJ/eHp1FT/qJmldp4s0cPpCePx0P3PYCmcW3x8QcfYvnsZBxdPw9FB9fzV7f+2krm+sK2JTi4Lh0b536LQyuScX3HYq7xR9bjj8IFKMj4Gp+89y6q1Ymh9HLt0MaoG9EcnuAIeDzV8Mbrb6PkyDrgxDrgGBtWbkL5obXYPXsspg/riQEfvo4BPd/HxCG9kJ02Hhd/WggcXy/eR8hF0c4lwIHlOJSVjFtvuxP5qaOxdfEUTB09EM888R80iO2AOtHtUCuyNTxV66F6vWjExcQjsksXNEkZzIeB/4QAqviwtOp1Zh1WPeow0terYXqFIhGkJISsxJBLA/i6P1Psm5tWIG7aIHSaPQpvjOqPsAZNUZt9MXPCnfDUiobH48HYgb2BK/v52JyZ7mO59JpW5qTBGNjrQ/znqefgqVYb9aNaommLDnjrv//FvK/6oHjnIhTvXoayPUuAo6twb7f78epTj2Nt2ngUzJmIrCkjcNutXZC9OIMIc23nUgKz6Kf5mD3mC3w1ahTefO8TeDwBaBx/G70g+nKP9/H+W29ixojPUbZvBXA8D1d3LUPZgZU4kbcQ838YDZzZTNPCRMKzO/CvBx+m4WD9qHj06/khDuYuxPWD63D28AYMWjEZ0VP5dzO2mTHEHvapltcFRNpXIn/HOZMAEjM1qceOuxHACahCAlO0G8mAwyCJJIARyDDwW84YQpZm985MoOggUr8ZhuCotnjsP89iTVYGHun+GLLSJwM/5+H6vlUUGBbvWY4hbz2L5598CqfOnMOEH5Lh8VRFQL2mqBLcAGtyC7FiyVJM6vsRLu9ZgbJD2SjduwIf93gF3i0LaYxO8cCF3chKHoe0CSOAs9spGLxxNAerJvbHsB7P4/rliygo2AhPlWB4PEGoGhyKgwcOYGPmPDxz/934ru/7+GPjPKq/jCWpTmwCfvnJnihiweXZnej17pvwePzw5svPAVf2ktsoPZCD0h0rKR55LfN7RCcPQFtJANY/Cg6yXy1RIn91+GeL6p7VIFECr9TFXAARQFkVzIM6XbsdwBsk4BEo+2wPTxjgkgDyxiYBoqYOwIDV04AD2dzsrp1LZpL5euAXrEn/DkvTJvP1AAfXomj7IqyYNAgT+32AX1ZMBc7sxy8HduKRBx9Al9tvx4dv/BfXft2H8sMFKJwyEieyZ5GvvnowF8P7fo6SvVk838+SNT9vwom1qej5/rs4XLAU+Dmfgs7f8ufjQv4sXN62GMWHcrHsxxGYMW4wsmdNQumhbFTsXwUcWoMDS37AkWU/4NquTJ6nOFqgzSPQ5NBfO/Dt0H7weKpgFEtr/7UVFwrnYf/0sVjX+x1cXjcPq7ZnInIKtwKmabcANfpc+/0jCbKrOK+VeJDIPIBcFi5Zo4FlAl6p2DfXCeCslxEgcuoAzPtpEc4vmobtQ3th7XfDaUElC/TYAks2Y3ftEE/jMp97eXsmzm5cAPy6hbSn5MBaGpdTRM+EjRwOrsX1PctRcTQbOLEBf23LxJuvv45RI4ajeO9KMbGURynfS3vWYGD/AWh9azfsXplGaeXyIzm4tnsZrvw0H9d3LgVOb6KMJHsZlE0EsZzA9b0rUbpvJdUh301ki1PUoSUR4I+tmD1xOAWHGZPGAUezcW3HElwoXIDNw3ri6KShOLQrC61SktCaWUOpbKKfnP3LhWf/bk4Asw7VLdP1syUBlFGAykCLELISF0ZZotzU9vlGHCB8j4wBoqYPwLwt83Em9VusfO81HEqfgPa3dMYbr7xI/vPGkfX8TSBK5PDAq+KEnBvIISk5lI2SA2tQvCcLRTuX4erOZbi2ZwVKDqxDxcl8nMxfgIcefxZjR41E0f41qDjOgzemtSz5syh5PEYPGYizPy3DDXaOgXgoB9f2ZOHK9sW4sm0hrm5fQnUX7cpE0Z4sFO9fraV/OeB8yprvi0mr37dg+fTxqBYUiq3zfyCSsuXjl7dmYv/EQfg1ZRyO71pJI4FWggC8j4QIJbL72OkO1K2KmxsJJDZWfZYFMOYCNPBFo3gFylYlg/gsb6zlCVTwlViA3Sdq2kB8k5uKq5nTkNv/A5T8lImXn3sWzzz5JA21mG8tk6aVJXNEp7Nt8YE1lOQhUAic5bi+bzWBRws12bWH19N3BsydOgGF838k7eZTxbweZg1ObZiH09vWkkVh1/Lr2LSv0OxDOUSm4gPrUHIwm59XQOZpZk4AqlekncnNnN6M3HlTUKNhM/ySM5uSRTeO5+PqzpX4edbXKCmcjx3bl6PZtEGWBbBEcaeqcECFeVcwsPreIIFdn0EQQQD+aphPAtgXmw2xiSAr5GJqPJWTwCvC7hOdPAg9Fk8A9qzG4RmjUPrTEgzs9REefPARmt2jDpVLsayOFulbn7N7Mssnsn/HCnBh5woiB5/LV+YEjvL3/Yv2rUPpsUKRJeTXqeacTx+r98izs4lWGxVSSAvw62ZsWjId9cPisCfja+AYI08uSg7k4Fx2KrBzKeZvmEOuUB0C8j5X+t1UODrmtA4O3FTAzc/MBdgEcJkMIrHNkQN8B8iGqTfLag/G78NGAZ0yRuKvgzn4Y843KN+2BOnfjcXtXe6hly1ZUEadzPyryOfbwCjm1prsEfl9C5w8lIgpWgrUrDIKkIwEEkB5H6qDEUGQSN5Pu680+1JU8EWc8etmFCxMRnx8Av7On43ivctRcnAd1XOpcBawdyU+zvwBTaYNdCR3THDN/rcIYLkEJ+gq+OZ5utYkADuhJiK4ubZNvgaqxTj7uE0CF6KoDVDyAVHTByFj41yUZ2fgxs6V2LRwGhISO9JKHeajyeTSyh0GjqKVUtulRZCaqoJzWJDGIgY/ZxKAazTTzvW2xbFE1EfXupxzIaUURoC8OT+g230Po/xwNo1iivet5FZm81z8uW81bp81ivy/Iw3somROQpiBn9MSmMBr9akuwPFiiGrOzVhAI4DaWJ0MdlmjXiUQjJk2CE/M/wqlB9aj4uB6HFuRjMT2nXF2exYlWiytohhABUECbQIjj7Fgjvts2yJIN2KDRGsD2XWsrAwoWSxBgDpBdohlgSShbHKyfEPu3Ml47pnngVMFuLp9EZ+cYgtZ9q1GWv5cRJL2+5gLMJTJXQT4Rsyg1aOIdV4QwAoCHQRQwJKAqa7ABN0hIoqVFsKsV1oA+gmTlCHI27YUOJaHy5vmouud92Df6gxrOliK6Z9Vk8uPyfM8iicgLYDU6yRIysohq971uLZ3JYkDbF/3dlgV2wKsnzMZH7G3m37bhKKdS2noemP/GpQfXo9nFk1AzPRBon8lARQSuIEt96XWa8CbrsME340ALjGAayBoVeICtnJTG2zdRZhkUiVqxiD0yvqBz9Qdz8WLj/2bpl1ZFG2BKn2vA0Sh7eI4+3x9/2rqbBnV22DZ4PHrbG216hZlruzIpOxjySGDdOLelohglFsSUac4xlYLrUv9BqO+/Bj4ORfXdi2j9uDgOmzcuhSxykIQKVp/m4Cq/SzxMDFRtJyXc+JkKbLlArRl4QYJLDbZcYBZoXYzAbx9vS4qubgFGIoWKUPIF3pp2LYF4z97Gz+M7E/TtTYBVJNvg8f3VQ1fj6LdK3B5+zLh97n1kEkcKZI4BD57v5+9gCpWD904UQjv5gW4tpvlE9YKYukk4/dVFpgqwmMWToDsmd9gzvhBwMlcMv1lB9cBR/Lw5rLv0dTSfmEB3PrdTZQ+tKyAekzFRMNFVU72NX3ml0RVRgCrQsU1KDewCKAGfFZ5eyvrVe/DSBA5fRAWb5oPnMzD4VWpmDouibJvllaa4EvfrRwjbT2UjaLdq/BX/jxKutw4yoaCG1ByKIcsjJVYEuCzdYPFR/Lw+4b5OLtlKY3Tyw5n4/TaVBr/M3dSLEigtoWbeicB1M/MBWyZ/yN2LZ9JSSDWNhxejw1blyJGGfdTn6j9avS76nr5Zxt8kwhudVigS5csr2EEcFsQYrHF5ea+RLMMKjksAtifNaKlDqVvCo+ZMRjPLPwG5QfXofxwDjYtnUFDOMvES6BFlG7mAFiUzhI1DGg2tj+9ZibO5c/Ghc3zsSl5GJaO7ImCqcNweWcWLf6kL308WYhzhfORM74Pssb0xoaJ/fFL1mT8vOxHnCtciPITBVQ3swJs+Catje4+nESg84wAP2/E8ewMnN+RhQq2wulwDoqO5KH7vK8RN2OwAZaqWDaAUsy+5vsKAaS7UEjhLi4EsL8fQAJkAuoE3K1BOtCmmKTgIn+UmknU9MFYtnkRBYPXDmSj+LBq5gX4DgKI6P/QestfywmfvzbMxZ/rM3A+fxb+LpxHWn1wzngcmvs1TmROxpGFE3Fi2Y+4uHkhbrBRwP61OF84H1d2reIrii13wTKPa+keGvCaG9K/dYTtM2tzdXcWTWTxL5gsxPjsVDSSkb8GvA2MZoEFEcw+t/pe1GEl4ugalxGFi4i4T305lFfIG6YSwK0R4mfdzR83NsTXcSkSfCYxKUl4bNF4lB7Lp4kWrklOAlAHU+cL8JXxvowDGGjlxwssYXMIbLEHO+7dvBh/bVyMi9uW07pDchUiWcTK8qSRHRzS/Q6v5yRQLJJJBP76me2i2Pb6niw+JDyaB++BdbgtfSRapnDz73C3hljHHX1v96s0+3xrk+ifvORrrQegr4gRBLAaZLFSijGE8CEm+LTkSR4zLYtotCRA/MyhuDV9BM4xfy1e7lA7nMAWHavJISNKV8mgleXfMVR+opAIYccD4pxS3tRwBqh0MdpxKeooQCENmzkk7f95I1LzZtP8h+kGTWAcovWttBp6H9r9r1znur5DdQEOAty8Ya4gu4h9TrcQViPFVrUALBiMnZmEgh2Z9H28rOPsYZwBugqa21DNAtOO/DVCiDK+CGAKn2DKJRLo4Is4xIUAFHiyKeufN2HHrhW4VWh/Zf3rKqQ85jGDBBIfLTh0cwMKAeSqYDMVXGkDDQLwxlVGAP2YKRx8mwixM4bg0flf4Y+DzAowDVUAlB2svPxJBPFFAIsIYvKIrQWgIZp6TH6LWB5KmVjDRZMEPN6gGUG1LWSVdIvBhH1bOQscR65OxntZ39PPxbVggV9lfSvkZuelyBwA9/3uAaC1yssikYsFUBeE+AK/MiBNoO1XltzJYF6vkoFtY6YPxu2zRuKjFT+giA3VpIYancwJwEC2J27sY8zcc5NP5/bloHTnOpRsX4vS3WtRejAHpftzULJ9DUo3r0LZtrUo27seNw7l0lCwnL4DmLsJ6XrIrEuyKRbAJoPdLpwoxKkdmYifMRiNZwxCaxGUyWSP1cf0zM7+rkysLCCJMjfgUtYh1r341/ULArAviPCdCXSbjXIjQGIq/3lUvhU/lcrKyDGodY29r9aluoNmKYMROWMwdu1aYVkCDXhVSxVtv35wLfBLIf/xhwPZKNmchevrFuHaygW4toptF6J4zWIU5yyjY1eWzMKlRem4uCgDFxek4uLCmbiYmYFreYtRsm0Fzm9ejKI9q+yhnmIVbALYQ1J5nLmwzA2zEc0mehwA2ylfK5Ej+0n2OQEq+kgx63Kf/zS9OEfXmgALsbKN6nFxrwzpAoyvirWCNbUxhlZrkjYciUwk8GLfIot8MIM4XPiPT3Ltt10B/YpY8kBMWp/KF2sYboADb4KxHhc2zMaiYV8ipfen2P79t/h9wWwcnZmMo3PTcWhmMg6mTMXhjJk4lDodh2Yk49jcWTi4cC5+Xrsap7LX4mT2OpzfugXTRo1Bq7CmmPDhOyjenYUbxwvsIR7dU+7raWDelg00iumzbBKayPG+4adVkGwNltrMMVD7WOt7UU63sgq4WiAovjPQZVhozwWoowCHpurm310M8NOG81/LVhvoGAHoot5XBoRNpw/GUyw5xIZnggBqR5tCPn3faqweOxKJUc1x9wOP4uRvZ3ClqAil5eUoKSlGSXExSkvLUHz9Om0rABQVF+MGgL8uXcbFshvYumcfBnz6OTK+7I0bu3NQdkwQT6R41XwE137VMuWhgo3/96zE/RkjKc1tEUCO191IIIF19C0XrlTO4/Z1hoKp9UsCmKMCBwFcgGHiuKEw83aEr4PPCSB+DaNS4Y22LI9yjn1uPXMomqUkYc/O5eQGOAFE8KYkg6QFoC17v//Xn1C2ZjEyPv4Q7z31LLIWL8WVq0W4WlKC6+UVKANov6QCBPyZs+dw4dIlXDhzBkeylmP7hK9wcUEGsL+ArxNUxvaWFdC2OgFwvAA5uWmImcF+jzlJ6wdp8i1tVUnggwCyP2nrct4y6bJOww1YU82mFZDLwmkUQASQTFUqFzcwb+ouAvhKCWBrg2woHwXoJCBXQOsGB+GLVVMoqOKLNuwAzE4MCRcgl4kd24CKA7nA5mwULZ2Dv5fOxdnMhfAW5OLyvt24fGAfvAf34fKRQ7i0eyeu7NyGy7nrcGnZPFzLmo+K7EyUb14jVgCp4NoE4CLXE8gyfLEpDq1Dn8XforFl/n31gUoA259LcQDOrKpiWe3rDY1XwXeJ6SyxgkD6okiFAArgvGEqywST1fMmEaihvgjgQoJKrEB8ShJapQ7DsT0rKTmkRuCqOZaAWEQ4vgGle7JRVrgaZeuzULJ2CYpXLcT1lQtxLXMeirLmo2j5fFxbNgfXs+bT+dL1WShdvwKlm1aJBakcVMv8i60VB0jLINvDFoIey8OfW+aja8YIxLNATz6jmhBTRQXEUD5VZHkdfH69BrBh5t0JICyB+/cEKgRQQOf7sqHOBnIxTZQvEujgS7B9aQtbNvbRskl8NGCN7XWzLFcDWSRgwgizLwclBStRwkhAAGehNG8lSvNW8M957NwKlOQsRwk7vnWNHXCKHILqYlTAudhrCdj3FGLvCixfk4wYn89jA+lQNrXvVLNuXGf3qbiHArSb6ODb5RUCmCuClMYq+yqYeoOdQR+JOGY+vKNjXB5UCmuoDAjX5c8i/2oCo84KWkDJxZzSP+/JRumWVSgpXIniDVkoEVKcvxzFm1aidMdaemWLEkISfIVoJgk0gtB9NqB4/1pUbJmHgUsnoAkFf87nYeIKuBTZD4qy6aJmY9XzOhFMwF1FfkeQuR5AI4JgqGys+RDc1PsggCSBL/NnPJjzmCTGUMoQdssYAe/uLCUgNLXRqaEWkGxdwNFcAunKzuW0YOQKkx3LcG3vKn7eGmqaBNCzijb4UvM30NqBS5tm4+Km2Xh83jg0s6J/9fnsz2ofqRZXt7Q++sSlPge4qgWRdZllMkagtfVqWCWJIJ11LgBrYBu5fyNoUevR6quEJLJNkdMHk3ax/DrP0KlWQBV7dGABpwJIM3vriAwsX68BrJQro+lo93Nyn7WDzRJ6N87C1U2zsD93Jj1La+H/ra/McwNNigBKDuckGRzlLKmMIOZxF+BVArglgjQCWDezb6IRQD1mRKkSVGtfitloeY12zr6nHCGwd+iaz0zC5rwUYN8qMZunj8PVfW4lnABqWUUVVFWzrboMi0DC3w5iwl5D8xbOwt8FaSjZmIGsNVNoQsta4iUB0fpUd62apiojAX7O6H95ndRwY6EnE+uz6lqNe0gCKN8W7ssCCDCURpgEUAHXNF4BXG2gQyTwSswgJ4isfdGuqOlD8MHCr1C6eRaKdi8Xwz75Qocw16bZdhNxXgJskcbKLhouQZSh6WAWdB7MxuVti3A+PxV/56fCW5iB8s2z8c3y78hSsf6y+1HtfAVA+fzKecsFsD6z9g1chHJYgaKBg50wMiyEhqv5beG0QJB/gyf/Vi/TEuggOsAnAvBYgKV3JQEkIbSGuIhFGhLZcHW6mLenRUoS7kgfidMFabhUkIrLWxfQC6IsArc119BaFUiDADZxhDUw3YYox6xN0Z6V9PJp0c5MMvkEfkEavAXpJNc3ZmDz3jy0zhiF1mza1xqSOTvf7E/6LHMBMu6SAGvXGaCKcpIsJiZ2OeP+RACxKpj/ZpCYDXTLGzv8ilm5ov0yDWwEh45Gy0apnx3a4bwvrRlISUJ2zjSUbMqwtO/qjqW0lp9Ms1gSxkVOFbvEAwJg7gqk9VDP8WvYGsLLu7Jwek0yAf13fhr+ZltFvAVpuFCYARRdxevrZqHpNPbOv7PTCSxTcWQfimfXwJMWWANQlDHrUgJ2s0953S4EsBaEKAQwC5oguInjxoIE7bSEkF2Po7zJdNVEWtcKNzBjCL7N+g7lm2bBW8gASBOgpOHCTwtQIjTWnib2tV5AOe7iNtgwkq3kubA9E4cWT8C5vBQBuEoAvn8+NxmXD+WD/SUXrkP4hM/ptxHpG8DMjrdAs8GUfeLaLw7ttbXeutYcQWj4yXJGO3QX4Ov7AdwtgH5Mvck/E8fDmi5Haby8h3RLbIbtrXljULp5jiCABCIN5zak4kxuGq7sWc1XFcn1ANbCETcxicHWE+bTSp7fNszFtrRROLt+Bmn/eUE0VfvPb5gB76a5KCm6QgTIy85HcIfOaD2DB1qmO3UFyqV/7L5xKa/WdZMyVE70sXaM2ibXA1RGABKzYe6N/l9IoAl1krORJNZ5HlU3Th6A8QWLcWPbInIBFhDMFBemEwmOLf8ep9aloWjfWv5FkOytI/Et4/y7AsX3BVr7TNiXTBbQUjTv1mXYOe9bbJo+lMC/UGiCL7YbUrj///sMStnMUkUFzpz5E2ERiah1Wxf6NtR26fp3AbuL7Au5r/Svo6zzOq3vfQBuir4gRASBZiHrJm7+RTbYaIDc90UW93p4OVNbVGHH2Zu0iekj8fO533F9q0oAXSsZKCeWT8K29DHYOfcbHFj6I46tnI4Tq1NwfNUMHMlKxqHMKTiUOZXkYOYUKrNj7rfITx6GvB8H4cCC8QQ8I5Wr5udxq3Dt7K8oLQdNNbO/38/8ifpNE1HVLxwRTz6OhAVjHObXFP7MUpPNvnKWV4WDrQaRTgK49qk+DPSRB5C+xQDWDUS3Yz7FeFD7uEtDmQhyxE7tj8eXT8aN8nJcPbAe53OnGVrJhQF2YSN7JyAVR5dNxLa0kSicloS8HwciZ1I/If1Jcn8YgIKpQ7BlxjDsnj0GJzIn4fyGVFzcmKHUaQNPkjsdFzbP5ZovwC8pKSECLF2+Bp7qjRDcsAWCakYj6o0Xxc/E+7YAer+79KnSD3q/qGXsWMByM66BKBduASQBfKwJNEE3xQLTaDDf6rGD4xojALI1QO8UEkGApikD8fbCadTRRWeO6QSw4gFdLm6ahUub5xAh9HNiCFeYQedYOZKNLLHDtf68DPKEELlyp+HSrpUouXqRzD4HvxilggCvvt0TnoAwBIe1RHD9ZqheJw5Ne72J9ot8k0B+R6MvIthlDSVR+1ViJiyBeQ8HeUwCOC2Ay1DDjQCK6CArNzbPCcBd66M22ClgKe0XjkPIhy+id/9h1NGlZTdwcddKTgIGvkEAGzRpwpXzsrwWRNplJfBafXkzyOVcObmT7l1aVm5pPiMA8/+nfjmNkEat4V8vlghQI6wlqtdrRhLT+20kEgmc4MiviFGVT1UUs7wUK3XMRCnnSgCzHkaAGUP03w7WCyvAVGINfBJAPoBonM+yGtMlARRJGUo/Nt1i3Ofw1GiE5KlpggDlKL50npIyf+fP1MFVCOAEszKLYbsRXobnGhjJLu7MwnXvHyitAEpKSvkSMwJfEABAv6Rx8FQL5drfsAXfMqnXjKRpzzfQftE4JKSJflZMtIMAoi84uCaYXBwKKnFTrICVXDKvNTOB2o0V0FSgdPDd5/tVEmjnWd2ux5VzGvD8+4RZENXy694Ijm6DKoFRyC3YzAlQUkL+t+jPEzQUc0vQSAvgDnZlx7m7YMBf2DQHRb/sozWEpTcqDOC5VJSX46+z5xAWewv86sTYwAsrUCM8XriDWB4TLBjDfy5OWS4uk3CcBCaYSj8xsb5O1kkAW/T1h44tfTusWBLm9nawCqKqwfJmcl2gG/iqqOdVEsj78IcSEyiiE+jr5An80Wg24hPUjG4HvxpNULtRKxw7fpIIIDufkeDKqT1GQPgPRQCtH2Nj+xR4mbk/XIjiKxd5oEdarwNP9xe+f/CIb+CpUk8HXiFAjfCWCA5tjqCaTdGw+8P0nO3nj9F+L4CLDa6mlAb4Ekx1BtEGXieAqf2cANqXRBkWQGWfodG26FO/zvPKtQS8OhzUG2M/vPjCpDkjkbB4LJp+8RaCG7akQKpa3RjEtr0Dly5eIo2zQSglgC4f30oZOY0EbhquHmMEEHK+IAPnN8zE33nT6YepZITP/L0Juqb9FeX488+zaMi0P6QpgsO46beAp61OiKDgJqiT2AnNR35Cvx3MsoYqCVyBdxEOrGEdtHP6ViOI9l6AgwCikAUwP24Ca4OvB3qmaA0U4FtfjSIfOo39pvBo+gr52KEfouFjj6B6/eaoXrcZaoTFw1MjCnc//CwqKipQVlqqBWAlpaUUkV8+uoWTQEkQyWyh6Q7sz3y4d54N7bYuxrUzR3mQR+beAJwtKxdar2p/3yFj4KkaSuBq2i8JEMa2UvjxoJAY+gXxel3vQvMRH1Ocw4nAlcB9LuEmwq5RJIGJZglUAqirgpUlYZa5ULTaNtnsnG7W5Xl1qx0T9ckAh/t46e+S6KGZT2z1Y39EvfMiaid2QGBINJlKpv3BzH8yAgSEo8d7n9vmXwy/rH0iQQWuHBOWQMzWSSKoowLrM4v4c6fDu2kOrp7awwFm5p7VpYBuEkGek5F/ncg28Ksbw9trmH/+mbkA9hz2PhP2yyHsF9T9a0bQL6fEDf0ICcwiqD8pr7xJ5CaaeSfgla+dV2YkHfGBFQM4FoU6x+86AWwS2BbAtgLqdZIAakRvabtgfPPhH6HhYw8hqFEcqlati8CajVEjvBWXMA4+WQD/hhg+diInAAOlWGi/pp3cHVz9eTfFBGTSfSRzzrGYIX8mLh/ZhOKrl7i5Z4GeS5DnJlL73+s5gLRfDfzMIJA9A+0L4Lm0QlC9pvAPiYR/rUaoWrUe/ILDyCLEDf4ACXNGIXHuaOULHxQSELAuL3tYBHAjgcBNlEtIF8PADukjjTWBNuCqNtu+RoAtt/Kcpe3KZ0kAYdLYwhOm7W2mD0H0p68hpONtZAYZ8P7BYajeoBlqRLS2OonAJzMaD09QI8xZsFQQwAmIDUwpyiqAot8PUzBH43d1WCj9/J61uH7hT67xzM+7aLomxj3Z34FDR1E9tAUC6se5Au+wAsrzMAJUD42Df+1G4vcFGREiULVaPfgFNUBIp06I7fcO2jELOY+nk4kI0mVasYKqmDYBtF+AUc9LPNKHM0vg9dw572tvm/ThyhhUgE8EUKJ8NwJowo+pY3g6xkg0dxQfy3/TG+HPP0Y/Gs1+L7Cafyj9kDJ7eAI/nIEvtN/qKK49fvXisOmn7doIwCkcRPLTFcD1c7/i4uY5OL9+Ks7nTSetv7BtKa79eYLyCL6Gda6iEIDFIOzv5Tc/hcevoaXlss1OMqgxgP1c7Jk5ARpxSyC3jAh+9VEtIBS129+CmF6vU2zUfsFYtGM5BI0Ahig/QsWJIkCX4AtplTYMt88e4/U8uuRHb3yaYIwAUR32EYAOsA3WqWZeMIwavHAsEmYNR+zA91Dv3rsRUDcKVavUpd/NY/6PPTADP7hBcyf4CgEC6jdDRPOOOHPmD/K7NweNJ2bYX1mRFzjLfoRqO3DuGIqvXRPDOsO/u1gVKw5QpZhr/9btu+BXuykCQ5vr2i3bLc2+IACLZTQLwI41bE7ab5GAflGM/6oY2zLXUM2/PsUJteLbofF7L6Ht9CG8X+ln511IILRe/iaxdk4usk1JQsvUJHRfPMnreWtdhjdu5mBjCZNt/m1frgNvWwwdfDJZC8ai9ZQBiHrrBdRsnYBqgQ1QrRoPdujh5G/p1omijJkNvuojbalSOxq3dXsMZWWluFFW5psAxbZvzsnfipff6YdPB36L71MzMSU9E5u27+cW5KbmXsYYTiKwNrC/J154i3L+ulYb5CVRSCAIYFmL8Fb007L+tVm/CPBDVBII11C7EfxYH1athxrRLRD56tNoM3kgZRXZDz/YINuabweRBkEETnEzh+Cd7Nlez/jt2d6mMwYahRUr4EvjVVPDkhEsqTF3NJqP7omGTzyMoEaxFNhUC2hATDbZHVCHBXvxqBnRRuk4c8uFza499vzrXKPZENAETIAmwc9YuAqBUV3hqXsLPA07wVO/Izx1OiAk9l7s3n9EkMCljn8g7G/9hk2oEtwYQQ3YmN8OVDXXpVgAPSCU7qIVPXtg3Wgy+TYBbNA5GcS+EL+ghmRFgyJiEP70vxH/7RdkERLn6D9CaYs916DiF5MyCBN2rvd6Npw+5mXmQBZSSeA0+Xql7TKG01QnW6sX/fnrqNO5M/xqsqCOR7RkxkTDKdCxhD8c84E1G7VBjTAVeF2L+BAwDB/3HkSdX1rqbq4lOPOWZaNKg9sQGNkFdZrdj5Bm96F23L0IaXYvPKEd0aX765Q8Kr9ReYLHzfyXlbF3i4H7H3sZnoAIG3yt7Xz0orsARRjpw1uR+Wc/I0e/Jq6A789Alz8yqfzYpEoCsgjVw4gIAXUiEfrw/WgxpifFWezHKLXUMuFqE4Bt2Xc0x6cNxcbfj3s9l4uve+9dNAEtprPXmQUB3CJH4TuY0BBlwVjEf98Xjf77DGq0aEMBnRzT6v5MN2ky4iU212xAHaADr+yLjmQ5gG8m8WlgOwnE3/eXW/a3efs+BDe5G4FRdyIk7j6EMOCFEAni7oUnpD0Gj5nCyeQAWXUNRnwgfP/KNetpRFKdJnsUv+5m/mlfBIHifPXQGASGNIJ/zQbwr9nQAF6KDr5lERQCyK1/jXA+imK5hLvvQrOkD2n4yIeQekDI8U1C8+mD8MDS73C1tNjrqaio8PbfvBxRk/vooMtgQlzMM3VjkTBnJJoN/ZBYF9gwmm7O/JPaOJMAfF+aNvvhiMnB9ahDTLPPO5ebTJYFXLRslU0ADZhilJffwHnvRcR3eRZVG3ZCnWYM/PtI+5nmq0QIjr4L1aPuxLZdB6i+m8YDQljsUVFega4PPUMEsHy6RQAXkWa/YXME1WuCgJoN4V8jlIDnJj5KgGz7ezVG0s65KJVFBNaX0vIGNUSdTrcjrv97pKgJ88ZoiTe2bTT5SwzeuoplVTkBtp//DdHJ/dzXrUkzn5KE6E9eQ8gtHcm8s4DEPzjcClqcgIutymgNfO73Aus2ofEwga51Hu/goAbNSbZu340ylqI1YgDp99/+bBQ8tROF5kvwlX1BgDrN7kWVBh1xZ/f/kivgQaUklG8ysL/MFevI9DPt17TcEj2GqRnBx/p+FujMOgolUIH2Bb7VV04C2ODbloMUTxlChtzaEbH93+XD8Dk8u8h+pLLJlH7Y7T1jE4A93JOZkxGT3N/SfpYqZBMVrSb2RWSPZxEc24pMvDp2tx9GNszNVLk9EGd/9dBY0Vl28kfXoHj414tDWGwHnP7td1y7dt0BTEX5DTr+9Jv9USWss675kgQKASQJPMEtkTTmB2EF1Dr17CLbMpKUl5ejy4NPw1M9Utf8mxKBkaCZiPZZn6j95uwbnRBCeVh5BrAA2R4pqGLjIIlAeAWEok6nTmgx4hOy4EzRn8qcSs9NBCgvLycCLD+xF5GTv6QEA2NLm6mDUP/+e0lD2RCOmRazoXZgJxslG6EeVx+Mfw6qH8M7jWX91I7UOo8fqxrSFPG33ourV6/iypUi+n4fDk4JWYPi4mIcPn4Kk1IWIiDyTor0Lf8vwOcugQeCDPxaMd3gqZeIngO/pjpu3KjcCrC/JctXUyxSXUbxJgFUEtC+HRTWjGhNw1028uERPwPUh+bTvgIsHXcDW1E8SQwJviqMCCy7GByOiFeeQuS0/lh1iru/ivJymwDlFRV4LjMZMSkD0TZ5EGrGt0NVDw8uTOBNQB1MVhmpHA+qF00+nXUI65hgETGrWTTdAnD/f+eDT1EC6PLlKyhiX/qkaP/xU6ex4addKPxpF2JueQzVm9ylgC3AJ2vAwQ+JvQee0Fvx7hejsX3fYRw4coI03BkQcvfCyMG0/477n7K03478XcQAX7MGzKWx/L8Eh4I/CaYBqipq7KQct8y/eszY5xaDxQjh9COWD33yIYFvEYD9kwd2nz2N5qlJqN2lC6qxIYYFqA+QfZ4zPzeiB+fAq0kfsTUzZUpnUg7g2R7UPvZlT1euXEVZKTfLFy5eQt7mnThy/BRNEz/31gBUadBJmHmn72fH2FDwqR69cfzn0zhx6jSyC7fhzJ9niUwmAaT2L1y6ims/zfa5aLwibIjHRAdfJ4fqEmzwpPtUiVAJQTSLq17vdBOMPNVqNETVgLrYtIGvqLIIIC0A60D2N2JuBv1qtmSOxjpZqby5Brha3oUA9WNQsxJfrwWAynGaBn73M2rb9WvXiQAM/Btlpdi1/yiOnfwV5WJ8PmL8dHjqtEdI7N0Iie2GkLh7uBVofj/qNr8fVRp2Qpd/v4G9B47y4LG8HL/+9gc279yPoqJrjiQTG11cvVqEDl0fhSc4Sjf3JgEEuJIANglkGTs/wPdb8lGAC+gEmgzqlPPWvjEslKBrxxSs2HH2I9b9h4ziwAusGfYOApQVXce9/3qCfjU7oI4cpug3c22wBN0EXxKgbrRTI0Tk7wt8cgH+DfFZP74SmPlnRgCU38Bvf/yFYz+fpoQOSw6xv1XZhajWsCNqNumMmo1vR83GbL8TQmK7IijqTjTp8BjyNm4jAsl8AiPBL6fP4ODRk0QkcgXFdso3JWOhGPf7ntSRADMLR2K6AMc1rVC9gToPoGuvCa7t420SWARRg0OlDokNsyBMoe/v/iS5MsK6nGPtsACSBGyBY4vWHeHxBFtso0pdghFuouR5F/DF+cA6TZSMnw9RO1R0FpttG/nVJGoXC9iYRjISMM1lIHLAeCLo+xkLUCW0ozD593M3EHs3akTdjlpN78L0OZlEGBr6Ub6f5/zLb5Th1OkzOHvub/L5rF5mba4WXcPd3Z8n369pr9luiwBCWHZTxDlWeeV6FgfZLkAfSZkEsEC2FE26XpsQJgHUcgzD+LadcPbcOQt8ibMWA0gCyJNs8WWT2LYWCTTgVf/iiFhFWbFvPRDL/fvoQEdUTVuRBAoIw4/T0jkBSkpwregavN6LFP1TWpiZ6hs3CKxWd72AgEZdrMhfmv8aTbshom13nPr1DNVjgW9lE/kU759/nce1a9dIbty4gaxV2QS+pf0K2PaWi2362fi/NZGA5fqd8UArGlmx+REOlGlJnSTQgFXdrwMT5RiBXx0xzRNw8udfOOAGxg4XQKIw5OjxE2hJlkDEBLIR8oYEsrJvuQbdAkg2Um7c6AwSlQCWCAIERWDOfGUhSHExisWsnwSP/aUvWA1PaCeEMM0XySBJAEaIgKg7sWHjDl6Py2wiq4+RynvhIi5dukzl7nv0JSvr5ySvkwQaEcgaMBLoQW9Q/VgBMO8n2a986+7bHSRQj6sYKOcZZq3adcKJn08p4Jdr+PoggF6IrXi9n2ICP1QJ5rkA++aGBZAMlGSwLAIXPvWrd5gOui18uMWHgctXrhPAOaN0maTp9p/3UVVJBHEXwIV99tS/FT/MWOCzHjmVfO36dSqTk1dIgZ+V9dPAdiODCxEoJrCPsZSwraXS9CtK4gI4j60UoEW/m4SQ/c4wYlg9+PAT5Mqd2HLxTQCLJeU2Uyoq0Ld/EqoE1IXHU8PRSGmOJIvlMdNcsQ5wBEhqRxpugC2yZGsBGBi+gGN/BVt2wy+iC2rJJJAFvL1lU8I9B37jsx4pjFDs79Hn3oAnMMIA2R3smwl/5nieCFL6y+4bTgZNsy1zr4BsWVoXotRiWl8DVQLqoO+AJJY2cYL/j1yAdAPCCsjC7K9w4xbcdc8j5Fs8VWrBT53Hdmuo5Zd4o/myL7MjzQ62CcB8r1+9WGzcvM0VODkP8GavkfDUY8Hf/VwU8C0L0PB2PPNGXyrvTPqIeECsJNr80w5Uqx1N8/1O3/+/CyMATwDJ/lIso0oGsx9Nc698lscYBh5PLRq1db3nYRRsVMb5LsBXTgAFdGkBrAtsHmDWnAXo1OU+IgG7sScw1Fj0oQonAnv4ICv3b4Bu+n+LAC1oydX2nXvovgSW8PsMRNauv87+jUaJLAPYVZkI0rWfSbWILuj62Ns0ttfeK2DBpBIIsr8XenxE+QetTVq71c9ux3XwafFnLWOa3NBuE1gTdHWfQA+sz/u+Si3c0fVBzJm70AZIxfJmBKgoL79qX/m//eVtKMTb732KmJYd4AkK5Uz0qwNPUANUqxlu5waEj6M5AG14VImEteIaGN4Kh4+eMG9t/aXOWwVPvdssoEOaPYA6zR9ESPMHUac5238AIc0fQGDjrmjb7WWaAazsb9+BIwis3wKB4t6uwp5BPofjeezPFACGxWsTQdIiqvv2MRNwbhVYX7I+9VSrQ31cJSgUcfG34N0PeqGg0Nb4//WPYc9mA0+yWSE2HGSMkFu5r35Wz9M1Qrx/e72rVq/1Dhg0zNv9iee8rRI7e0MjW3gD60R6/WtFcKkZ7g2s29gbHBbvDQ5rKbZS2GchDaW08AbWb+atGdHKe/DwUbpPSUmJJaUlJXTsP6994fWE3uatFXuvtzaTOCb3OaR6467eprc84f3r7Hl6hpKSYq0uWd8bH37p9fiH8XaxdmhtdWu32z6XGmHx3sC60V6/muF2P9xUWFm7POvD+pEtvPEJt3u7P/6cd9CQEd6163K8ly5d0jCoDDPzHAm/7uT/AzaosaevrjqQAAAAAElFTkSuQmCC";

// client/src/branding.js
function applyBranding(onOpen) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  const FLASK_HTML = '<svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><path d="M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16h10l-2.4-3.4h-5.2L7 16Z" fill="#eafff6" opacity="0.9"/><circle cx="12" cy="13.2" r="0.55" fill="#73dce6"/><circle cx="13.6" cy="15" r="0.4" fill="#73dce6"/></svg>';
  const FLASK_RAIL_HTML = FLASK_HTML.replace('width="18"', 'width="13"').replace('height="18"', 'height="13"');
  const entries = /* @__PURE__ */ new Set();
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen();
  };
  const bindEntry = (node) => {
    if (!node || node.dataset.dshLabResearchEntry === "1") return;
    node.dataset.dshLabResearchEntry = "1";
    node.setAttribute("title", "打开科研课题");
    node.addEventListener("click", activate);
    entries.add(node);
  };
  let observer = null;
  const hideNative = () => {
    const styleId = "dsh-lab-agent-brand";
    let style = document.querySelector(`style[data-plugin-css="${styleId}"]`);
    if (style === null) {
      style = document.createElement("style");
      style.dataset.pluginCss = styleId;
      document.head.appendChild(style);
    }
    style.textContent = "[class*='_brand']>:not(.ib-brand-shell),[class*='_brand'] svg,[class*='_railMark'],[class*='_railFish']{display:none!important}";
  };
  const inject2 = () => {
    hideNative();
    let touched = false;
    const heroHeadline = document.querySelector("[class*='_headlineText']");
    if (heroHeadline && heroHeadline.textContent !== "专注源头创新") {
      heroHeadline.textContent = "专注源头创新";
      touched = true;
    }
    document.querySelectorAll("*").forEach((element) => {
      if (element.children.length === 0 && element.textContent?.trim() === "预览版") {
        element.remove();
        touched = true;
      }
    });
    const heroMarkHost = heroHeadline?.parentElement?.querySelector("[class*='_fishHitbox']");
    if (heroMarkHost && !heroMarkHost.querySelector(".ib-hero-avatar")) {
      const avatar = document.createElement("img");
      avatar.src = BRAND_ICON;
      avatar.alt = "";
      avatar.setAttribute("aria-hidden", "true");
      avatar.width = 34;
      avatar.height = 34;
      avatar.className = `${heroMarkHost.firstElementChild?.getAttribute("class") ?? ""} ib-hero-avatar`.trim();
      heroMarkHost.replaceChildren(avatar);
      touched = true;
    }
    const row = document.querySelector("[class*='_logoRow']");
    if (!row) return touched;
    const brand = row.querySelector("[class*='_brand']");
    if (brand && brand.dataset.dshLabResearchEntry !== "1") {
      bindEntry(brand);
      brand.setAttribute("aria-label", "打开科研课题");
      touched = true;
    }
    if (brand && !brand.querySelector(".ib-brand-shell")) {
      const shell = document.createElement("span");
      shell.className = "ib-brand-shell";
      shell.setAttribute("data-dsh-lab-brand", "1");
      shell.innerHTML = `<span class="ib-brand-avatar"><img src="${BRAND_ICON}" alt="" aria-hidden="true"></span><span class="ib-brand-text"><b>iBM Agent</b><small>based on DSH</small></span>`;
      brand.appendChild(shell);
      touched = true;
    }
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
  inject2();
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      inject2();
    });
  };
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    if (observer) observer.disconnect();
    for (const node of entries) node.removeEventListener("click", activate);
    entries.clear();
  };
}

// client/src/components-project.js
var import_react7 = __toESM(require("react"), 1);
var import_react_dom = __toESM(require("react-dom"), 1);
var import_react8 = require("react");

// client/src/lib.js
var when = (value) => value ? new Date(value).toLocaleString() : "—";
var statusOf = (row) => ({ succeeded: "已审核", pending: "待处理", running: "生成中", failed: "已退回", draft: "草稿", "under-review": "已暂存·待审核", approved: "已批准", prepared: "待分析", "approved-written": "已审核", "visually-verified": "已确认" })[row.status] || row.status || "已登记";
function cloneForm(source) {
  if (!source) return {};
  const { id = "", name = "", audience = "课题组组会", language = "zh", length = "", topics = [], tags = [], sections = [], styleRules = [], evidenceRequirements = [], outputRequirements = [], remark = "", version } = source;
  return { id, name, audience, language, length, topics: [...topics], tags: [...tags], sections: sections.map((s) => ({ ...s })), styleRules: [...styleRules], evidenceRequirements: [...evidenceRequirements], outputRequirements: [...outputRequirements], remark, version };
}
function downloadBlob(fileName, mime, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4e3);
}
function saveTextArtifactViaDesktop(fileName, text) {
  if (window.parent === window) return Promise.reject(new Error("RIS 另存为仅支持桌面客户端"));
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-text-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let acknowledged = false;
    const fail = (message, code) => {
      const error = new Error(message);
      error.code = code;
      return error;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(completionTimer);
      window.removeEventListener("message", onResult);
      callback(value);
    };
    const onResult = (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.source !== "ibm-lab-agent-shell" || data.requestId !== requestId) return;
      if (data.type === "SAVE_TEXT_ARTIFACT_ACK") {
        acknowledged = true;
        clearTimeout(readyTimer);
        return;
      }
      if (data.type !== "SAVE_TEXT_ARTIFACT_RESULT") return;
      if (data.payload?.ok) finish(resolve, data.payload.saved);
      else finish(reject, fail(data.payload?.error || "桌面原生文本保存失败", acknowledged ? "DESKTOP_SAVE_FAILED" : "NO_DESKTOP_SHELL"));
    };
    const readyTimer = setTimeout(() => finish(reject, fail("未检测到桌面文件服务", "NO_DESKTOP_SHELL")), 1800);
    const completionTimer = setTimeout(() => finish(reject, fail("桌面原生保存超时（5 分钟）", "DESKTOP_SAVE_FAILED")), 5 * 60 * 1e3);
    window.addEventListener("message", onResult);
    try {
      window.parent.postMessage({ source: "ibm-lab-agent", type: "SAVE_TEXT_ARTIFACT", requestId, payload: { fileName, text } }, "*");
    } catch (reason) {
      finish(reject, reason);
    }
  });
}
async function saveRis(fileName, text) {
  const saved = await saveTextArtifactViaDesktop(fileName, text);
  if (saved?.cancelled) return { cancelled: true, fileName };
  return { ...saved, native: true };
}
async function browserDownloadVerifiedBinary(url) {
  const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(await response.text() || `下载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const expectedBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && blob.size !== expectedBytes) {
    throw new Error(`下载不完整：应为 ${expectedBytes} 字节，实际 ${blob.size} 字节；文件未保存，请重试。`);
  }
  const expectedHash = response.headers.get("x-content-sha256");
  if (expectedHash && globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    const actualHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actualHash !== expectedHash) throw new Error("下载校验失败（SHA-256 不一致）；文件未保存，请重试。");
  }
  const encodedName = response.headers.get("x-file-name") || "artifact.bin";
  let fileName = encodedName;
  try {
    fileName = decodeURIComponent(encodedName);
  } catch {
  }
  downloadBlob(fileName, blob.type || "application/octet-stream", blob);
  return fileName;
}
function saveArtifactViaDesktop(url) {
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let acknowledged = false;
    const fail = (message, code) => {
      const error = new Error(message);
      error.code = code;
      return error;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(completionTimer);
      window.removeEventListener("message", onResult);
      callback(value);
    };
    const onResult = (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.source !== "ibm-lab-agent-shell" || data.requestId !== requestId) return;
      if (data.type === "SAVE_ARTIFACT_ACK") {
        acknowledged = true;
        clearTimeout(readyTimer);
        return;
      }
      if (data.type !== "SAVE_ARTIFACT_RESULT") return;
      if (data.payload?.ok) finish(resolve, data.payload.saved);
      else finish(reject, fail(data.payload?.error || "桌面原生保存失败", acknowledged ? "DESKTOP_SAVE_FAILED" : "NO_DESKTOP_SHELL"));
    };
    const readyTimer = setTimeout(() => finish(reject, fail("未检测到桌面文件服务", "NO_DESKTOP_SHELL")), 1800);
    const completionTimer = setTimeout(() => finish(reject, fail("桌面原生保存超时（5 分钟）", "DESKTOP_SAVE_FAILED")), 5 * 60 * 1e3);
    window.addEventListener("message", onResult);
    try {
      const artifactUrl = new URL(url, location.origin).href;
      window.parent.postMessage({ source: "ibm-lab-agent", type: "SAVE_ARTIFACT", requestId, payload: { artifactUrl } }, "*");
    } catch (reason) {
      finish(reject, reason);
    }
  });
}
async function downloadVerifiedBinary(url) {
  if (window.parent !== window) {
    try {
      const saved = await saveArtifactViaDesktop(url);
      if (saved?.cancelled) throw new Error("已取消保存");
      return saved?.fileName || "artifact";
    } catch (error) {
      if (error?.code !== "NO_DESKTOP_SHELL") throw error;
    }
  }
  return browserDownloadVerifiedBinary(url);
}
async function downloadOfficeArtifact(url) {
  if (window.parent !== window) {
    try {
      const saved = await saveArtifactViaDesktop(url);
      if (saved?.cancelled) throw new Error("已取消保存");
      return { ...saved, native: true };
    } catch (error) {
      if (error?.code !== "NO_DESKTOP_SHELL") throw error;
    }
  }
  const fileName = await browserDownloadVerifiedBinary(url);
  return { fileName, native: false };
}
async function openOfficeArtifact(url, application) {
  if (window.parent !== window) {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-open-artifact-${Date.now()}`;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("message", onResult);
        callback(value);
      };
      const onResult = (event) => {
        const data = event.data;
        if (event.source !== window.parent || !data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_ARTIFACT_RESULT" || data.requestId !== requestId) return;
        data.payload?.ok ? finish(resolve) : finish(reject, new Error(data.payload?.error || "无法打开文件"));
      };
      const timer = setTimeout(() => finish(reject, new Error("桌面客户端打开文件超时")), 12e4);
      window.addEventListener("message", onResult);
      try {
        window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_ARTIFACT", requestId, payload: { artifactUrl: new URL(url, location.origin).href, application } }, "*");
      } catch (reason) {
        finish(reject, reason);
      }
    });
    return { native: true };
  }
  const fileName = await browserDownloadVerifiedBinary(url);
  return { fileName, native: false };
}
async function openPdfPreview(url) {
  const previewUrl = new URL(url, location.origin);
  previewUrl.searchParams.set("preview", "1");
  if (window.parent === window) {
    window.open(previewUrl.href, "_blank", "noopener,noreferrer");
    return;
  }
  const kind = previewUrl.searchParams.get("kind");
  const bundleId = previewUrl.searchParams.get("bundleId");
  if (!bundleId || !["pdf", "si"].includes(kind)) throw new Error("文献阅读地址无效");
  return openArtifactInBrowserViaShell(kind, bundleId);
}
var openInEdgeViaShell = (url) => new Promise((resolve, reject) => {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    window.removeEventListener("message", onResult);
    callback(value);
  };
  const onResult = (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_IN_EDGE_RESULT" || data.requestId !== requestId) return;
    if (data.payload?.ok) finish(resolve, data.payload);
    else finish(reject, new Error(data.payload?.error || "桌面客户端未能在 Edge 中打开页面"));
  };
  const timer = setTimeout(() => finish(reject, new Error("桌面客户端未响应（未收到 open_in_edge 确认）；请检查是否运行在 iBM Lab Agent 桌面版")), 4e3);
  window.addEventListener("message", onResult);
  try {
    window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_IN_EDGE", requestId, url }, "*");
  } catch (reason) {
    finish(reject, reason);
  }
});
var openArtifactInBrowserViaShell = (kind, bundleId) => new Promise((resolve, reject) => {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `artifact-browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    window.removeEventListener("message", onResult);
    callback(value);
  };
  const onResult = (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_ARTIFACT_IN_BROWSER_RESULT" || data.requestId !== requestId) return;
    if (data.payload?.ok) finish(resolve, data.payload);
    else finish(reject, new Error(data.payload?.error || "桌面客户端未能打开文献阅读页"));
  };
  const timer = setTimeout(() => finish(reject, new Error("桌面客户端未响应，无法打开文献阅读页")), 3e4);
  window.addEventListener("message", onResult);
  try {
    window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_ARTIFACT_IN_BROWSER", requestId, payload: { kind, bundleId } }, "*");
  } catch (reason) {
    finish(reject, reason);
  }
});
var openExternalUrl = async (url) => {
  if (!url) return;
  if (window.parent !== window) return openInEdgeViaShell(url);
  window.open(url, "_blank", "noopener,noreferrer");
};

// client/src/components-literature.js
var import_react3 = __toESM(require("react"), 1);

// client/src/constants.js
var ROUTE_ORIGIN_LABEL = { "literature-extracted": "文献提取", "human-edited": "人工修改", "agent-optimized": "Agent 优化", retrosynthesis: "逆向候选" };
var ROUTE_STATUS_LABEL = { draft: "draft·草稿", "under-review": "under-review·待审核", approved: "approved·已批准", rejected: "rejected·已驳回" };
var EVIDENCE_SOURCE_LABEL = { "paper-si": "Supporting Info", "paper-main": "正文/Scheme", "cited-method": "引用方法", "similar-literature": "相似文献", patent: "专利", "reaction-db": "反应数据库", "compound-db": "化合物库", internal: "内部 SOP", "model-inference": "Agent 推断" };
var EVIDENCE_REVIEW_LABEL = { pending: "待审", confirmed: "已确认", edited: "已修订", rejected: "已驳回" };
var STEP_FIELD_DEFS = [
  { key: "reagents", label: "试剂", hints: ["reagents", "试剂"] },
  { key: "catalysts", label: "催化剂", hints: ["catalysts", "催化剂"] },
  { key: "solvents", label: "溶剂", hints: ["solvents", "溶剂"] },
  { key: "temperature", label: "温度", hints: ["temperature", "温度"] },
  { key: "time", label: "时间", hints: ["time", "时间"] },
  { key: "atmosphere", label: "气氛", hints: ["atmosphere", "气氛"] },
  { key: "concentration", label: "浓度", hints: ["concentration", "浓度"] },
  { key: "yield", label: "收率", hints: ["yield", "收率"] },
  { key: "workup", label: "后处理", hints: ["workup", "后处理"] },
  { key: "purification", label: "纯化", hints: ["purification", "纯化"] },
  { key: "monitoring", label: "监测", hints: ["monitoring", "监测"] }
];
var KETCHER_URL = "/api/lab-ketcher/index.html";
var PDF_VIEWER_URL = "/api/lab-pdf-viewer/index.html?v=worker-v2";
var KETCHER_STAGE_LOADING_MS = 25e3;
var KETCHER_STAGE_EXPORT_MS = 3e4;
var KETCHER_OVERALL_MS = 75e3;
var KETCHER_RENDER_PROTOCOL = 1;
var KETCHER_DEFAULT_THEME = "#ffffff";
var normName = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
var STRUCTURE_SOURCE_LABEL = { agent: "登记", pubchem: "PubChem", manual: "Ketcher", entity: "实体库" };
var databaseState = (state) => ({ available: "可用", connected: "已连接", degraded: "受限", "auth-required": "需登录", "waiting-user": "等待登录", "agreement-required": "待勾选协议", "verification-required": "待验证", unavailable: "不可用", "not-supported": "不适用", idle: "未连接", "browser-open": "浏览器已打开", expired: "已过期", error: "异常", unknown: "未知" })[state] || state || "未知";
var databaseStateTone = (state) => ({ "data-ok": ["available", "connected"].includes(state) ? "true" : void 0, "data-warn": ["auth-required", "waiting-user", "agreement-required", "verification-required", "degraded", "browser-open", "idle"].includes(state) ? "true" : void 0 });

// client/src/components-templates.js
var import_react2 = require("react");
function Templates({ call, onBack }) {
  const [tab, setTab] = (0, import_react2.useState)("notes");
  const [notes, setNotes] = (0, import_react2.useState)({ loading: true, list: [], error: "" });
  const [ppt, setPpt] = (0, import_react2.useState)({ loading: true, list: [], error: "" });
  const [exp, setExp] = (0, import_react2.useState)({ loading: true, list: [], error: "" });
  const loadNotes = (0, import_react2.useCallback)(async () => {
    setNotes((s) => ({ ...s, loading: true, error: "" }));
    try {
      const result = await call("note_templates_list");
      setNotes({ loading: false, list: result.templates || [], error: "" });
    } catch (reason) {
      setNotes((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message }));
    }
  }, [call]);
  const loadPpt = (0, import_react2.useCallback)(async () => {
    setPpt((s) => ({ ...s, loading: true, error: "" }));
    try {
      const result = await call("templates_list");
      setPpt({ loading: false, list: result.templates || [], error: "" });
    } catch (reason) {
      setPpt((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message }));
    }
  }, [call]);
  const loadExp = (0, import_react2.useCallback)(async () => {
    setExp((s) => ({ ...s, loading: true, error: "" }));
    try {
      const result = await call("experiment_plan_templates_list");
      setExp({ loading: false, list: result.templates || [], error: "" });
    } catch (reason) {
      setExp((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message }));
    }
  }, [call]);
  (0, import_react2.useEffect)(() => {
    void loadNotes();
    void loadPpt();
    void loadExp();
  }, [loadNotes, loadPpt, loadExp]);
  return h(
    "div",
    null,
    h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Template Library"), h("h1", null, "模板管理"), h("p", null, "管理「阅读笔记模板」「实验计划模板」与「PPT 模板」。科研 Agent 生成对应产物时会按所选模板生成；任务保存版本快照，模板后续修改不影响旧产物。")), h("button", { className: "ib-btn", onClick: onBack }, "← 所有课题")),
    h(
      "div",
      { className: "ib-tm-tabs" },
      h("button", { className: "ib-tm-tab", "data-active": tab === "notes" ? "true" : void 0, onClick: () => setTab("notes") }, "阅读笔记模板"),
      h("button", { className: "ib-tm-tab", "data-active": tab === "exp" ? "true" : void 0, onClick: () => setTab("exp") }, "实验计划模板"),
      h("button", { className: "ib-tm-tab", "data-active": tab === "ppt" ? "true" : void 0, onClick: () => setTab("ppt") }, "PPT 模板")
    ),
    tab === "notes" ? h(NoteTemplates, { call, state: notes, reload: loadNotes }) : tab === "exp" ? h(ExperimentPlanTemplates, { call, state: exp, reload: loadExp }) : h(PptTemplates, { call, state: ppt, reload: loadPpt })
  );
}
function ExperimentPlanTemplates({ call, state, reload }) {
  const [busy, setBusy] = (0, import_react2.useState)({});
  const [toast, setToast] = (0, import_react2.useState)("");
  const [name, setName] = (0, import_react2.useState)("");
  (0, import_react2.useEffect)(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  const withBusy = (key, fn) => {
    if (busy[key]) return;
    setBusy((s) => ({ ...s, [key]: true }));
    return Promise.resolve(fn()).finally(() => setBusy((s) => ({ ...s, [key]: false })));
  };
  const create = () => withBusy("create", async () => {
    const clean = String(name || "").trim();
    if (!clean) {
      setToast("请填写模板名称。");
      return;
    }
    const id = `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await call("experiment_plan_templates_create", { request: { id, fields: { name: clean } } });
    setName("");
    await reload();
  });
  const archive = (row) => withBusy(`arc:${row.id}`, async () => {
    await call("experiment_plan_templates_archive", { request: { id: row.id } });
    await reload();
  });
  return h(
    "div",
    null,
    toast ? h("div", { className: "ib-toast", role: "status" }, toast) : null,
    h(
      "div",
      { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 10 } },
      h("input", { style: { flex: 1, background: "var(--ib-panel)", color: "var(--ib-text)", borderRadius: 8, padding: "7px 10px", border: "1px solid var(--ib-line)" }, value: name, placeholder: "新实验计划模板名称（默认章节骨架会保留）", onChange: (event) => setName(event.target.value) }),
      h("button", { className: "ib-btn", "data-primary": true, disabled: !!busy.create, onClick: () => void create() }, busy.create ? "创建中…" : "新建模板")
    ),
    state.error ? h("div", { className: "ib-error" }, state.error) : null,
    state.loading ? h("div", { className: "ib-empty" }, "加载中…") : null,
    state.list.length ? h("div", { className: "ib-rows" }, state.list.map((row) => h(
      "div",
      { className: "ib-row", key: row.id },
      h("b", { title: row.id }, row.name),
      h("span", null, `v${row.version}${row.applicableTo ? " · " + row.applicableTo : ""} · ${row.sections?.length || 0} 章节`),
      row.status === "archived" ? h("span", { className: "ib-chip" }, "已归档") : h("button", { className: "ib-btn", disabled: !!busy[`arc:${row.id}`], onClick: () => void archive(row) }, "归档")
    ))) : h("div", { className: "ib-empty" }, "尚无实验计划模板；可新建，或使用内置默认模板（生成实验计划草案时自动快照）。")
  );
}
function NoteTemplates({ call, state, reload }) {
  const [mode, setMode] = (0, import_react2.useState)("list");
  const [editing, setEditing] = (0, import_react2.useState)(null);
  const [busy, setBusy] = (0, import_react2.useState)({});
  const [toast, setToast] = (0, import_react2.useState)("");
  const [requirements, setRequirements] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = async (key, work) => {
    if (busy[key]) return;
    setBusy((old) => ({ ...old, [key]: true }));
    try {
      await work();
    } catch (reason) {
      setToast(reason.message || "操作失败");
    } finally {
      setBusy((old) => {
        const n = { ...old };
        delete n[key];
        return n;
      });
    }
  };
  const remove = (row) => run(`del:${row.id}`, async () => {
    if (!window.confirm(`删除阅读笔记模板「${row.name}」？任务快照不受影响，历史版本仍可读。`)) return;
    await call("note_templates_delete", { request: { id: row.id } });
    setToast(`已删除模板「${row.name}」`);
    await reload();
    setMode("list");
  });
  const showRequirements = (row) => run(`req:${row.id}`, async () => {
    if (requirements?.id === row.id) {
      setRequirements(null);
      return;
    }
    const result = await call("note_templates_requirements", { request: { id: row.id, version: row.version } });
    setRequirements({ id: row.id, name: row.name, data: result.requirements });
  });
  const openForm = (row, copy = false) => run("open", async () => {
    if (!row) {
      setEditing(null);
      setMode("form");
      return;
    }
    const result = await call("note_templates_resolve", { request: { id: row.id, version: row.version } });
    setEditing(copy ? { ...result.template, _copy: true } : result.template);
    setMode("form");
  });
  if (mode === "form") return h(NoteTemplateForm, { call, initial: editing, onCancel: () => {
    setMode("list");
    setEditing(null);
  }, onSaved: () => {
    setMode("list");
    setEditing(null);
    void reload();
  } });
  const cards = state.list.map((row) => h(
    "div",
    { className: "ib-tm-card", key: row.id },
    h("div", { className: "ib-tm-title" }, h("b", null, row.name), h("span", null, `v${row.version} · ${when(row.updatedAt)}`)),
    h("div", { className: "ib-tm-sub" }, h("span", { className: "ib-key" }, row.id)),
    h("div", { className: "ib-tm-meta" }, (row.topics || []).slice(0, 3).map((t) => h("span", { className: "ib-tm-chip", key: t }, t)), (row.tags || []).slice(0, 3).map((t) => h("span", { className: "ib-tm-chip", "data-tone": "accent", key: t }, t))),
    h("div", { className: "ib-tm-acts" }, h("button", { className: "ib-lit-btn", onClick: () => openForm(row) }, "编辑"), h("button", { className: "ib-lit-btn", onClick: () => openForm(row, true) }, "复制"), h("button", { className: "ib-lit-btn", onClick: () => showRequirements(row) }, busy[`req:${row.id}`] ? "…" : requirements?.id === row.id ? "收起要求" : "生成要求"), h("button", { className: "ib-lit-btn", onClick: () => remove(row) }, busy[`del:${row.id}`] ? "…" : "删除"))
  ));
  const listBody = state.loading ? h("div", { className: "ib-empty" }, "正在读取模板…") : state.list.length ? h("div", { className: "ib-tm-list" }, cards) : h("div", { className: "ib-empty" }, "还没有阅读笔记模板。点击“新建阅读笔记模板”创建，或直接使用内置默认模板 note-default。");
  const reqPanel = requirements ? h("div", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `「${requirements.name}」参考要求`), h("span", { className: "ib-chip" }, "作为组织与格式参考")), h("pre", { style: { whiteSpace: "pre-wrap", fontSize: 10.5, lineHeight: 1.7, color: "var(--ib-text)", background: "var(--ib-panel)", border: "1px solid var(--ib-line)", borderRadius: 10, padding: 12 } }, JSON.stringify(requirements.data, null, 2))) : null;
  return h(
    "div",
    null,
    h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, "阅读笔记模板"), h("p", null, "Agent 生成阅读笔记时按模板章节与要求生成。这里可新建/复制/修改模板。")), h("button", { className: "ib-btn", "data-primary": true, onClick: () => openForm(null) }, "+ 新建阅读笔记模板")),
    state.error ? h("div", { className: "ib-error" }, state.error) : null,
    listBody,
    reqPanel,
    toast ? h("div", { className: "ib-toast" }, toast) : null
  );
}
function NoteTemplateForm({ call, initial, onCancel, onSaved }) {
  const blank = { id: "", name: "", audience: "课题组组会", language: "zh", length: "单篇 600-1000 字，突出与课题相关的关键内容", topics: [], tags: [], sections: [{ key: "citation", title: "文献信息", required: true, hint: "标题、作者、期刊、年份、DOI 的规范短引用" }, { key: "one-sentence-summary", title: "一句话概述", required: true, hint: "问题、做法、机制、成果各一短句" }], styleRules: [], evidenceRequirements: [], outputRequirements: [], remark: "" };
  const [form, setForm] = (0, import_react2.useState)(() => initial ? cloneForm(initial) : cloneForm(blank));
  const [busy, setBusyTemp] = (0, import_react2.useState)(false);
  const [error, setErrorTemp] = (0, import_react2.useState)("");
  const isCreate = !initial;
  const isCopy = !!initial && initial._copy;
  const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
  const arrayField = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }));
  const listField = (key) => (event) => {
    const value = event.target.value;
    setForm((old) => ({ ...old, [key]: value === "" ? [] : value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }));
  };
  const setSection = (index, patch) => setForm((old) => ({ ...old, sections: (old.sections || []).map((s, i) => i === index ? { ...s, ...patch } : s) }));
  const addSection = () => setForm((old) => ({ ...old, sections: [...old.sections || [], { key: "", title: "", required: true, hint: "" }] }));
  const removeSection = (index) => setForm((old) => ({ ...old, sections: (old.sections || []).filter((_, i) => i !== index) }));
  const fileRef = (0, import_react2.useRef)(null);
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
    setBusyTemp(true);
    setErrorTemp("");
    try {
      if (!form.name.trim()) throw new Error("请填写模板名称");
      if (isCreate && !/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("模板编号请使用小写字母、数字和连字符，例如 lab-note-v2");
      const fields = { ...form, id: void 0 };
      let payload;
      if (isCreate) payload = { id: form.id.trim(), fields };
      else if (isCopy) payload = { id: initial.id, newId: form.id.trim() || form.name + "-copy", name: form.name };
      else payload = { id: form.id, fields };
      const method = isCopy ? "note_templates_copy" : isCreate ? "note_templates_create" : "note_templates_update";
      const result = await call(method, { request: isCopy ? payload : { id: payload.id, fields } });
      onSaved(result.template.name || form.name);
    } catch (reason) {
      setErrorTemp(reason.message);
    } finally {
      setBusyTemp(false);
    }
  };
  return h(
    "section",
    { className: "ib-card ib-form" },
    h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, isCopy ? "复制阅读笔记模板" : isCreate ? "新建阅读笔记模板" : `编辑模板 v${form.version}`), h("span", { className: "ib-chip" }, isCopy ? "origin " + initial.id : isCreate ? "新模板" : `当前 v${form.version}`)),
    h(
      "div",
      { className: "ib-req" },
      h("div", { className: "vertical-stack", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } }, h("button", { className: "ib-btn", onClick: () => fileRef.current && fileRef.current.click() }, "从 .md 文件导入"), h("input", { ref: fileRef, type: "file", accept: ".md,text/markdown,text/plain", style: { display: "none" }, onChange: importFromMd }), h("span", { style: { color: "var(--ib-text)", fontSize: 9.5 } }, "把一份 Markdown 整篇作为该模板的「生成要求」填入；不改变章节结构（按 needs 保留默认章节）。")),
      h(
        "div",
        { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } },
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
      h(
        "div",
        { className: "vertical-stack", style: { marginTop: 8, display: "grid", gap: 8, gridTemplateColumns: "repeat(2,1fr)" } },
        h("div", { className: "ib-req" }, h("label", null, "风格规则（每行一条）"), h("textarea", { value: (form.styleRules || []).join("\n"), onChange: arrayField("styleRules") })),
        h("div", { className: "ib-req" }, h("label", null, "证据与来源要求（每行一条）"), h("textarea", { value: (form.evidenceRequirements || []).join("\n"), onChange: arrayField("evidenceRequirements") })),
        h("div", { className: "ib-req" }, h("label", null, "附加输出要求（每行一条）"), h("textarea", { value: (form.outputRequirements || []).join("\n"), onChange: arrayField("outputRequirements") }))
      ),
      error ? h("div", { className: "ib-error" }, error) : null,
      h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void save() }, busy ? "保存中…" : isCopy ? "保存副本" : "保存"))
    )
  );
}
function PptTemplates({ call, state, reload }) {
  const [mode, setMode] = (0, import_react2.useState)("list");
  const [selected, setSelected] = (0, import_react2.useState)(null);
  const [meta, setMeta] = (0, import_react2.useState)(null);
  const [busy, setBusy] = (0, import_react2.useState)({});
  const [toast, setToast] = (0, import_react2.useState)("");
  const [validation, setValidation] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = async (key, work) => {
    if (busy[key]) return;
    setBusy((old) => ({ ...old, [key]: true }));
    try {
      await work();
    } catch (reason) {
      setToast(reason.message || "操作失败");
    } finally {
      setBusy((old) => {
        const n = { ...old };
        delete n[key];
        return n;
      });
    }
  };
  const archive = (row) => run(`arc:${row.id}`, async () => {
    if (!window.confirm(`归档 PPT 模板「${row.name}」？历史版本仍可读，任务快照不受影响。`)) return;
    await call("templates_archive", { request: { id: row.id } });
    setToast(`已归档「${row.name}」`);
    await reload();
    setSelected(null);
    setValidation(null);
  });
  const preview = (row) => run(`pv:${row.id}`, async () => {
    if (selected?.id === row.id) {
      setSelected(null);
      return;
    }
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
    const result = await call("templates_update_meta", { request: { id: fields.id, fields: { name: fields.name, purpose: fields.purpose, audience: fields.audience, notesRequirement: fields.notesRequirement, maxPages: fields.maxPages ? Number(fields.maxPages) : void 0 } } });
    setToast(`已更新「${result.template.name}」v${result.template.version}`);
    setMeta(null);
    await reload();
  });
  if (mode === "import") return h(PptTemplateImport, { call, onCancel: () => setMode("list"), onDone: (id) => {
    setToast(`已导入模板 ${id}，请确认映射后发布`);
    setMode("list");
    void reload();
  } });
  const statusLabel = (st) => ({ draft: "草稿", ready: "可用", archived: "已归档" })[st] || st;
  return h(
    "div",
    null,
    h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, "PPT 模板"), h("p", null, "模板只提供版式与风格参考；映射检查用于提示兼容性，不作为生成或人工审核门槛。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", "data-primary": true, onClick: () => setMode("import") }, "+ 导入 PPT 模板"))),
    state.error ? h("div", { className: "ib-error" }, state.error) : null,
    state.loading ? h("div", { className: "ib-empty" }, "正在读取模板…") : state.list.length ? h(
      "div",
      { className: "ib-table" },
      h("div", { className: "ib-table-head" }, h("span", { className: "ib-tm-id" }, "ID"), h("span", { className: "ib-tm-name" }, "名称"), h("span", { className: "ib-tm-status" }, "状态"), h("span", { className: "ib-tm-actions" }, "操作")),
      state.list.map((row) => h("div", { className: "ib-table-row", key: row.id }, h("span", { className: "ib-tm-id ib-tm-key" }, row.id), h("span", { className: "ib-tm-name" }, h("b", null, row.name), h("small", { style: { display: "block", color: "var(--ib-text)", fontSize: 9 } }, `v${row.version} · ${row.pageSize?.ratio || "?"} · ${when(row.updatedAt)}`)), h("span", { className: "ib-tm-status" }, h("span", { className: row.status === "ready" ? "ib-tm-chip" : "ib-tm-chip", "data-tone": row.status === "ready" ? "accent" : void 0 }, statusLabel(row.status))), h("span", { className: "ib-tm-actions" }, h("button", { className: "ib-lit-btn", onClick: () => preview(row) }, busy[`pv:${row.id}`] ? "…" : selected?.id === row.id ? "收起" : "预览"), h("button", { className: "ib-lit-btn", onClick: () => doValidate(row) }, busy[`vf:${row.id}`] ? "…" : "验证"), h("button", { className: "ib-lit-btn", onClick: () => openMeta(row) }, "编辑元数据"), h("button", { className: "ib-lit-btn", onClick: () => archive(row) }, busy[`arc:${row.id}`] ? "…" : "归档"))))
    ) : h("div", { className: "ib-empty" }, "还没有 PPT 模板。点击“导入 PPT 模板”上传 .pptx，或使用内置默认模板 nature-default。"),
    validation && validation.id ? h("div", { className: "ib-card ib-form", style: { marginTop: 14, borderColor: validation.v.ok ? "rgba(81,212,163,.4)" : "rgba(224,169,88,.45)" } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `格式参考检查`), h("span", { className: "ib-chip" }, validation.v.ok ? "正常" : "有提醒")), (validation.v.problems || []).length ? h("ul", { style: { color: validation.v.ok ? "#b4d9cc" : "#e9bd7d", fontSize: 10.5, lineHeight: 1.7, margin: 0, paddingLeft: 16 } }, validation.v.problems.map((p) => h("li", { key: p }, p))) : h("div", { className: "ib-sub" }, validation.v.natureDefault ? "内置默认模板（由 nature-paper2ppt 处理版式）" : "模板映射可作为生成时的版式参考。")) : null,
    selected ? h("div", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `角色映射预览`), h("span", { className: "ib-chip" }, `v${selected.version}`)), selected.data.natureDefault ? h("div", { className: "ib-sub" }, "内置默认模板：全部角色交由 nature-paper2ppt 默认流程处理。") : h("div", { className: "ib-table" }, h("div", { className: "ib-table-head" }, h("span", { style: { flex: 1 } }, "角色"), h("span", { style: { flex: 1 } }, "布局"), h("span", { style: { flex: 2 } }, "占位符")), selected.data.roles.map((role) => h("div", { className: "ib-table-row", key: role.role, style: { alignItems: "flex-start" } }, h("span", { className: "ib-tm-key", style: { flex: 1 } }, role.role), h("span", { style: { flex: 1, fontSize: 10 } }, `${role.layoutName || role.layoutId}`), h("span", { style: { flex: 2, fontSize: 9, color: "var(--ib-text)" } }, (role.placeholders || []).map((p) => p.type).join(", ")))))) : null,
    meta ? h(MetaEditor, { call, initial: meta, onCancel: () => setMeta(null), onSaved: saveMeta }) : null,
    toast ? h("div", { className: "ib-toast" }, toast) : null
  );
}
function PptTemplateImport({ call, onCancel, onDone }) {
  const [form, setForm] = (0, import_react2.useState)({ id: "", name: "", audience: "课题组组会", purpose: "", file: null });
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)("");
  const [staged, setStaged] = (0, import_react2.useState)(null);
  const [mapping, setMapping] = (0, import_react2.useState)(null);
  const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
  const readFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setForm((old) => ({ ...old, file }));
  };
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      resolve(text.includes(",") ? text.split(",")[1] : text);
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  const doImport = async () => {
    setBusy(true);
    setError("");
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
      setMapping(initialMapping);
      setStaged({ profile, parsed, suggestions });
      setBusy(false);
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      if (!mapping) throw new Error("版式映射尚未准备完成，请稍后重试");
      const result = await call("templates_confirm", { request: { id: staged.profile.id, version: staged.profile.version, mapping: Object.fromEntries(Object.entries(mapping).map(([role, layoutId]) => [role, { layoutId }])) } });
      if (!result.ok) throw new Error(`模板映射无效：${(result.problems || []).join("；")}`);
      onDone(result.profile?.id || staged.profile.id);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  if (!staged) {
    return h(
      "section",
      { className: "ib-card ib-form" },
      h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "导入 PPT 模板"), h("span", { className: "ib-chip" }, "先解析，再映射")),
      h("div", { className: "ib-req" }, h("div", { className: "ib-req" }, h("label", null, "模板编号（英文小写）"), h("input", { value: form.id, placeholder: "lab-ppt-v3", onChange: field("id") })), h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, placeholder: "课题组组会模板", onChange: field("name") })), h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })), h("div", { className: "ib-req" }, h("label", null, "用途"), h("input", { value: form.purpose, placeholder: "组会汇报 / 论文答辩", onChange: field("purpose") })), h("div", { className: "ib-req" }, h("label", null, ".pptx 文件"), h("input", { type: "file", accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation", onChange: readFile }))),
      error ? h("div", { className: "ib-error" }, error) : null,
      h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || (!form.file || !form.id || !form.name), onClick: () => void doImport() }, busy ? "解析中…" : "解析并生成映射"))
    );
  }
  const roles = staged.profile.layoutRoleMapping ? Object.keys(staged.profile.layoutRoleMapping) : [];
  const roleRows = roles.map((role) => h(
    "div",
    { className: "ib-table-row", key: role },
    h("span", { className: "ib-tm-key", style: { flex: 1 } }, role),
    h("select", { style: { flex: 1, marginRight: 8 }, value: mapping?.[role] || "", onChange: (e) => setMapping((old) => ({ ...old || {}, [role]: e.target.value })) }, (staged.parsed?.layouts || []).map((l) => h("option", { value: l.id, key: l.id }, `${l.name || l.id}（${(l.placeholders || []).map((p) => p.type).join("+") || "空"}）`))),
    h("span", { className: "ib-sub", style: { flex: 1 } }, staged.suggestions && staged.suggestions[role] && staged.suggestions[role].reason || "")
  ));
  return h(
    "section",
    { className: "ib-card ib-form" },
    h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `确认「${staged.profile.name}」角色映射`), h("span", { className: "ib-chip" }, `${staged.parsed?.layoutCount || "?"} 个布局`)),
    h("div", { className: "ib-lit-note" }, "自动映射已按布局占位符特征生成，可逐角色调整；映射无效会明确拒绝并保持草稿状态，不会静默替换为默认模板。"),
    h("div", { className: "ib-table" }, [h("div", { className: "ib-table-head" }, h("span", { style: { flex: 1 } }, "角色"), h("span", { style: { flex: 1 } }, "布局"), h("span", { style: { flex: 1 } }, "说明")), ...roleRows]),
    error ? h("div", { className: "ib-error" }, error) : null,
    h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void confirm() }, busy ? "发布中…" : "确认映射并发布到可用"))
  );
}
function MetaEditor({ call, initial, onCancel, onSaved }) {
  const [form, setFormTemp] = (0, import_react2.useState)({ name: initial.name || "", purpose: initial.purpose || "", audience: initial.audience || "", notesRequirement: initial.notesRequirement || "", maxPages: initial.maxPages ?? "" });
  const [busy, setBusyTemp] = (0, import_react2.useState)(false);
  const [error, setErrorTemp] = (0, import_react2.useState)("");
  const field = (key) => (event) => setFormTemp((old) => ({ ...old, [key]: event.target.value }));
  const save = async () => {
    setBusyTemp(true);
    setErrorTemp("");
    try {
      if (!form.name.trim()) throw new Error("请填写模板名称");
      await onSaved({ id: initial.id, ...form });
    } catch (reason) {
      setErrorTemp(reason.message);
    } finally {
      setBusyTemp(false);
    }
  };
  return h(
    "section",
    { className: "ib-card ib-form", style: { marginTop: 14 } },
    h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `编辑「${initial.id}」元数据`), h("span", { className: "ib-chip" }, `当前 v${initial.version}`)),
    h("div", { className: "ib-req", style: { display: "grid", gap: 8 } }, h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, onChange: field("name") })), h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })), h("div", { className: "ib-req" }, h("label", null, "用途"), h("input", { value: form.purpose, onChange: field("purpose") })), h("div", { className: "ib-req" }, h("label", null, "备注/讲稿要求"), h("input", { value: form.notesRequirement, onChange: field("notesRequirement") })), h("div", { className: "ib-req" }, h("label", null, "最大页数"), h("input", { type: "number", value: form.maxPages, onChange: field("maxPages") }))),
    error ? h("div", { className: "ib-error" }, error) : null,
    h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void save() }, busy ? "保存中…" : "保存"))
  );
}
function FlaskSvg({ width = 18, height = 18 }) {
  return h(
    "svg",
    { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
    h("path", { d: "M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3", stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }),
    h("path", { d: "M7 16h10l-2.4-3.4h-5.2L7 16Z", fill: "#eafff6", opacity: 0.9 }),
    h("circle", { cx: 12, cy: 13.2, r: 0.55, fill: "#73dce6" }),
    h("circle", { cx: 13.6, cy: 15, r: 0.4, fill: "#73dce6" })
  );
}
function BookSvg({ width = 15, height = 15 }) {
  return h(
    "svg",
    { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
    h("path", { d: "M12 6.5C10.2 4.9 7.7 4.2 4 4.2v13.6c3.7 0 6.2.7 8 2.3 1.8-1.6 4.3-2.3 8-2.3V4.2c-3.7 0-6.2.7-8 2.3Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
    h("path", { d: "M12 6.5v13.6", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
  );
}
function SiSvg({ width = 15, height = 15 }) {
  return h(
    "svg",
    { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
    h("path", { d: "M6 3h8l4 4v14H6V3Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
    h("path", { d: "M14 3v4h4", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }),
    h("path", { d: "M12 8.5v6M9 11.5h6", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
  );
}

// client/src/components-literature.js
function DatabaseOverview({ call, notify }) {
  const [snapshot, setSnapshot] = (0, import_react3.useState)({ loading: true, sources: [], checkedAt: "", error: "" });
  const [busy, setBusy] = (0, import_react3.useState)("");
  const [open, setOpen] = (0, import_react3.useState)(false);
  const refresh = (0, import_react3.useCallback)(async (force = false) => {
    try {
      const result = await call("literature_status", { request: { force } });
      setSnapshot({ loading: false, sources: result.sources || [], checkedAt: result.checkedAt || "", browserMode: result.browserMode || "managed-edge", error: "" });
    } catch (reason) {
      setSnapshot((old) => ({ ...old, loading: false, error: reason.message }));
    }
  }, [call]);
  (0, import_react3.useEffect)(() => {
    void refresh(false);
    const timer = setInterval(() => void refresh(false), 6e4);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (kind, source, mode) => {
    if (kind === "connect" && mode === "current") {
      void openExternalUrl(source.institutionEntryUrl || source.entryUrl || "https://lib.ustc.edu.cn/");
    }
    setBusy(`${kind}:${source.id}`);
    try {
      const result = await call(kind === "connect" ? "literature_connect" : "literature_verify", { request: { sourceId: source.id, mode } });
      notify(result.message || result.connection?.message || "状态已更新");
      if (kind === "connect" && mode === "handoff" && result.entryUrl) {
        try {
          await openInEdgeViaShell(result.entryUrl);
        } catch (reason) {
          notify(reason.message);
        }
      }
      await refresh(true);
    } catch (reason) {
      notify(reason.message);
    } finally {
      setBusy("");
    }
  };
  const attention = snapshot.sources.filter((source) => [source.search?.state, source.download?.state, source.connection?.state].some((state) => ["degraded", "auth-required", "waiting-user", "agreement-required", "verification-required", "expired", "error", "unavailable"].includes(state))).length;
  return h(
    import_react3.default.Fragment,
    null,
    h("div", { className: "ib-db-toggle-wrap" }, h("button", { className: "ib-db-toggle", "data-warn": attention > 0 ? "true" : void 0, onClick: () => setOpen((value) => !value), "aria-expanded": open ? "true" : "false" }, h("i", { "aria-hidden": "true" }), open ? "收起数据库状态" : "数据库状态", h("small", null, snapshot.loading ? "验证中" : `${snapshot.sources.length} 个库${attention ? ` · ${attention} 个需处理` : ""}`))),
    open ? h(
      "section",
      { className: "ib-db" },
      h("div", { className: "ib-db-head" }, h("div", null, h("h3", null, "文献数据库实时状态"), h("p", null, snapshot.checkedAt ? `最近验证 ${when(snapshot.checkedAt)} · 每 60 秒自动刷新` : "正在验证检索入口与全文权限状态")), h("button", { className: "ib-btn", disabled: snapshot.loading, onClick: () => void refresh(true) }, snapshot.loading ? "验证中…" : "立即验证")),
      snapshot.error ? h("div", { className: "ib-error" }, snapshot.error) : null,
      snapshot.sources.length ? h("div", { className: "ib-db-grid" }, snapshot.sources.map((source) => {
        const searchTone = databaseStateTone(source.search?.state);
        const downloadTone = databaseStateTone(source.download?.state);
        const connectionTone = databaseStateTone(source.connection?.state);
        return h(
          "article",
          { className: "ib-db-card", key: source.id },
          h("div", { className: "ib-db-name" }, h("b", { title: source.name }, source.name), h("span", { className: "ib-db-tier" }, source.authMode === "institutional" ? "校内授权" : "开放源")),
          h("div", { className: "ib-db-state" }, h("span", { className: "ib-db-pill", title: source.search?.message, ...searchTone }, `检索 · ${databaseState(source.search?.state)}`), h("span", { className: "ib-db-pill", title: source.download?.message, ...downloadTone }, `下载 · ${databaseState(source.download?.state)}`), h("span", { className: "ib-db-pill", title: source.connection?.message, ...connectionTone }, `会话 · ${databaseState(source.connection?.state)}`)),
          source.authMode === "institutional" ? h(
            "div",
            { className: "ib-db-actions" },
            snapshot.browserMode === "desktop-edge-handoff" ? h("button", { className: "ib-btn", title: "在外部 Microsoft Edge 中打开学校数据库；登录与下载由 Edge + 捕获扩展完成，PDF/SI 自动回传", disabled: !!busy, onClick: () => void run("connect", source, "handoff") }, busy === `connect:${source.id}` ? "启动中…" : "外部 Edge") : h("button", { className: "ib-btn", title: "在当前 DSH 浏览器新标签页人工使用；不会把 Cookie 暴露给 DSH", disabled: !!busy, onClick: () => void run("connect", source, "current") }, "当前浏览器"),
            h("button", { className: "ib-btn", title: "启动可见的持久检索浏览器，支持登录状态复用和合法 PDF 捕获", disabled: !!busy || source.restrictedAutomation, onClick: () => void run("connect", source, "managed") }, busy === `connect:${source.id}` ? "启动中…" : "受控检索"),
            h("button", { className: "ib-btn", title: "登录、协议和验证码完成后验证当前会话", disabled: !!busy, onClick: () => void run("verify", source) }, busy === `verify:${source.id}` ? "验证中…" : "验证登录")
          ) : null
        );
      })) : h("div", { className: "ib-db-empty" }, snapshot.loading ? "正在获取数据库状态…" : "暂无状态数据")
    ) : null
  );
}
function useBoundProject(sessionId, call, useSessions) {
  const cwd = useSessions ? useSessions((s) => s.byId[sessionId]?.cwd) : void 0;
  const [bound, setBound] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    if (!sessionId) {
      setBound(null);
      return void 0;
    }
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
      } catch (reason) {
        return null;
      }
    };
    lookup().then((result) => {
      if (alive) setBound(result);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, cwd, call]);
  return bound;
}
function ProjectBadge({ sessionId, call, openWorkspace, useSessions }) {
  const bound = useBoundProject(sessionId, call, useSessions);
  (0, import_react3.useEffect)(() => {
    if (typeof document === "undefined" || !bound?.project?.id) return void 0;
    document.body.classList.add("ib-research-chat");
    document.body.dataset.ibResearchProject = bound.project.id;
    return () => {
      if (document.body.dataset.ibResearchProject === bound.project.id) {
        document.body.classList.remove("ib-research-chat");
        delete document.body.dataset.ibResearchProject;
      }
    };
  }, [bound?.project?.id]);
  if (!bound?.project) return null;
  return h(
    "button",
    { className: "ib-research-badge", title: "打开课题空间", "aria-label": `打开课题空间：${bound.project.name}`, onClick: () => openWorkspace(bound.project) },
    h("span", { className: "ib-badge-icon" }, h(FlaskSvg, { width: 14, height: 14 })),
    h("span", { className: "ib-badge-copy" }, h("small", null, "Research workspace"), h("b", null, bound.project.name)),
    h("span", { className: "ib-badge-version" }, `记忆 v${bound.project.memoryVersion || "1"}`)
  );
}
var NATIVE_IMAGE_MIMES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
var MAX_RESEARCH_UPLOAD_BYTES = 25 * 1024 * 1024;
var MAX_RESEARCH_UPLOAD_FILES = 5;
function isNativeImageFile(file) {
  return NATIVE_IMAGE_MIMES.has(String(file?.type ?? "").toLowerCase());
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error(`无法编码文件：${file.name}`));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
function ResearchFileUpload({ sessionId, input, inputActions, call, useSessions, toast }) {
  const bound = useBoundProject(sessionId, call, useSessions);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [dragging, setDragging] = (0, import_react3.useState)(false);
  const picker = (0, import_react3.useRef)(null);
  const latestInput = (0, import_react3.useRef)(input);
  latestInput.current = input;
  const uploadFiles = (0, import_react3.useCallback)(async (fileList) => {
    const picked = Array.from(fileList ?? []);
    if (!picked.length) return;
    if (!bound?.project?.id) {
      toast("当前会话尚未关联课题，请稍后重试或先从课题面板进入会话。");
      return;
    }
    if (busy) {
      toast("已有文件正在上传，请等待完成后再试。");
      return;
    }
    const files = picked.filter((file) => !isNativeImageFile(file));
    const imageCount = picked.length - files.length;
    if (imageCount) toast(files.length ? "文档正在上传；混合拖入的图片请单独拖入，以保留图片预览。" : "图片请使用输入框原生的图片按钮或单独拖入。");
    if (!files.length) return;
    if (files.length > MAX_RESEARCH_UPLOAD_FILES) {
      toast(`一次最多上传 ${MAX_RESEARCH_UPLOAD_FILES} 个科研文件。`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_RESEARCH_UPLOAD_BYTES);
    if (oversized) {
      toast(`“${oversized.name}”超过 25 MB，请压缩或分批处理。`);
      return;
    }
    setBusy(true);
    toast(`已选择 ${files.length} 个文件，正在读取并上传…`);
    const uploaded = [];
    const failed = [];
    try {
      for (const file of files) {
        try {
          const base64 = await fileToBase64(file);
          const result = await call("project_file_upload", { request: { projectId: bound.project.id, name: file.name, base64 } });
          uploaded.push(result.file);
        } catch (reason) {
          failed.push(`${file.name}：${reason?.message ?? reason}`);
        }
      }
      if (uploaded.length) {
        const references = uploaded.map((file) => [
          `已上传科研文件「${file.fileName}」`,
          `原文件路径：${file.sourcePath}`,
          file.mdPath ? `可读 Markdown：${file.mdPath}` : null
        ].filter(Boolean).join("\n")).join("\n\n");
        const draft = String(latestInput.current?.draft ?? "").trimEnd();
        inputActions.setDraft(`${draft}${draft ? "\n\n" : ""}${references}`);
        const conversionWarnings = uploaded.filter((file) => file.conversion?.status === "failed").length;
        toast(conversionWarnings ? `已上传 ${uploaded.length} 个文件；其中 ${conversionWarnings} 个未能自动转换，原文件仍可使用。` : `已上传 ${uploaded.length} 个科研文件，并加入当前输入。`);
      }
      if (failed.length) toast(`有 ${failed.length} 个文件上传失败：${failed[0]}`);
    } finally {
      setBusy(false);
    }
  }, [bound?.project?.id, busy, call, inputActions, toast]);
  const onPickerChange = (event) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(files).catch((reason) => {
      setBusy(false);
      toast(`文件上传失败：${reason?.message ?? reason}`);
    });
  };
  const uploadRef = (0, import_react3.useRef)(uploadFiles);
  uploadRef.current = uploadFiles;
  (0, import_react3.useEffect)(() => {
    if (!bound?.project?.id || typeof document === "undefined") return void 0;
    const hasNonImage = (transfer) => {
      const items = Array.from(transfer?.items ?? []).filter((item) => item.kind === "file");
      if (items.length) return items.some((item) => !NATIVE_IMAGE_MIMES.has(String(item.type ?? "").toLowerCase()));
      return Array.from(transfer?.files ?? []).some((file) => !isNativeImageFile(file));
    };
    const intercept = (event) => {
      if (!hasNonImage(event.dataTransfer)) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    const onDrag = (event) => {
      if (intercept(event)) setDragging(true);
    };
    const onDrop = (event) => {
      if (!intercept(event)) return;
      setDragging(false);
      void uploadRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    const onLeave = (event) => {
      if (event.relatedTarget == null) setDragging(false);
    };
    document.addEventListener("dragenter", onDrag, true);
    document.addEventListener("dragover", onDrag, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragleave", onLeave, true);
    return () => {
      document.removeEventListener("dragenter", onDrag, true);
      document.removeEventListener("dragover", onDrag, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragleave", onLeave, true);
    };
  }, [bound?.project?.id]);
  if (!bound?.project) return null;
  return h(
    "span",
    { className: "ib-file-upload" },
    h("input", { ref: picker, type: "file", multiple: true, onChange: onPickerChange }),
    h("button", { type: "button", className: "ib-file-upload-btn", disabled: busy, title: "上传 PDF、Office、文本、数据或其他科研文件（单个不超过 25 MB）", "aria-label": "上传科研文件", onClick: () => picker.current?.click() }, busy ? "上传中…" : "上传文件"),
    dragging ? h("div", { className: "ib-file-drop" }, h("span", null, "松开后上传到当前课题")) : null
  );
}

// client/src/components-workspace.js
var import_react5 = require("react");

// client/src/ketcher.js
function ketcherCacheKey(smiles, { width = 560, height = 420, theme = KETCHER_DEFAULT_THEME, format = "png", natural = false } = {}) {
  const sizeKey = natural ? "natural" : `${Number(width) || 560}x${Number(height) || 420}`;
  return `v${KETCHER_RENDER_PROTOCOL}|${normName(smiles)}|${sizeKey}|${String(theme ?? KETCHER_DEFAULT_THEME).replace(/\s+/g, "").toLowerCase() || "w"}|${format === "svg" ? "svg" : "png"}`;
}
function structurePreviewTier(smiles) {
  const text = String(smiles ?? "");
  const atoms = text.replace(/\[[^\]]+\]/g, "C").match(/Br|Cl|Si|Na|Li|Mg|Al|Ca|Fe|Zn|[BCNOPSFIKbcnops]/g) || [];
  const branches = (text.match(/\(/g) || []).length;
  const rings = (text.match(/%\d{2}|\d/g) || []).length / 2;
  const score = atoms.length + Math.min(4, branches * 0.5) + Math.min(4, rings);
  return score <= 7 ? "simple" : score <= 11 ? "standard" : "complex";
}
var ketcherModule = {
  iframe: null,
  ready: false,
  queue: [],
  busy: false,
  seq: 0,
  pending: {},
  // requestId → { key, smiles, resolve, timer, overall }
  // 缓存避免重复渲染同一 (结构,尺寸,主题,协议)：只缓存成功结果，
  // 失败项不缓存以便点击重试（dataURL 可能数 KB~上百 KB，适可而止）
  cache: {}
};
function ensureKetcherHiddenFrame() {
  if (ketcherModule.iframe && document.body.contains(ketcherModule.iframe)) return ketcherModule.iframe;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-9999px;top:0;width:560px;height:420px;border:0;opacity:0.01;pointer-events:none;z-index:-1";
  frame.src = KETCHER_URL;
  ketcherModule.iframe = frame;
  if (!ketcherModule.listenerInstalled) {
    ketcherModule.listenerInstalled = true;
    window.addEventListener("message", (event) => {
      if (!ketcherModule.iframe || event.source !== ketcherModule.iframe.contentWindow) return;
      const data = event.data || {};
      if (data?.type === "ready") {
        ketcherModule.ready = true;
        return;
      }
      if (data?.type === "image" || data?.type === "image:error") {
        const pending = ketcherModule.pending[data.requestId];
        if (pending) {
          if (data.type === "image" && data.dataUrl) ketcherModule.cache[pending.key] = data.dataUrl;
          pending.resolve(data.type === "image" ? data.dataUrl || null : null, data.type === "image:error");
        }
      }
      if (data?.type === "phase") {
        const pending = ketcherModule.pending[data.requestId];
        if (pending && data.phase) {
          clearTimeout(pending.timer);
          const stageMs = data.phase === "loading" ? KETCHER_STAGE_LOADING_MS : KETCHER_STAGE_EXPORT_MS;
          pending.timer = setTimeout(() => {
            const row = ketcherModule.pending[data.requestId];
            if (row) row.resolve(null, true);
          }, stageMs);
        }
      }
    });
  }
  document.body.appendChild(frame);
  return frame;
}
function resetKetcherHiddenFrame() {
  const old = ketcherModule.iframe;
  ketcherModule.iframe = null;
  ketcherModule.ready = false;
  try {
    old?.remove();
  } catch {
  }
  return ensureKetcherHiddenFrame();
}
function ketcherRenderSmiles(smiles, { width = 560, height = 420, theme = KETCHER_DEFAULT_THEME, format = "png", natural = false, timeoutMs = KETCHER_OVERALL_MS, readyTimeoutMs = 2e4 } = {}) {
  const key = ketcherCacheKey(smiles, { width, height, theme, format, natural });
  if (ketcherModule.cache[key]) return Promise.resolve(ketcherModule.cache[key]);
  ensureKetcherHiddenFrame();
  return new Promise((resolve) => {
    const queuedJob = { key, smiles: normName(smiles), width: natural ? void 0 : width, height: natural ? void 0 : height, theme, format, resolve };
    ketcherModule.queue.push(queuedJob);
    const drain = () => {
      if (ketcherModule.busy || !ketcherModule.queue.length) return;
      const job = ketcherModule.queue.shift();
      ketcherModule.busy = true;
      const requestId = `k${++ketcherModule.seq}`;
      const settle = (dataUrl, resetFrame = false) => {
        if (!ketcherModule.pending[requestId]) return;
        if (ketcherModule.pending[requestId]) delete ketcherModule.pending[requestId];
        clearTimeout(stageTimer);
        clearTimeout(overallTimer);
        job.resolve(dataUrl);
        ketcherModule.busy = false;
        if (resetFrame) resetKetcherHiddenFrame();
        else drain();
      };
      const stageTimer = setTimeout(() => settle(null, true), KETCHER_STAGE_LOADING_MS);
      const overallTimer = setTimeout(() => settle(null, true), timeoutMs);
      ketcherModule.pending[requestId] = { key: job.key, smiles: job.smiles, timer: stageTimer, overall: overallTimer, resolve: settle };
      try {
        const activeFrame = ensureKetcherHiddenFrame();
        activeFrame.contentWindow.postMessage({ type: "render", smiles: job.smiles, requestId, width: job.width, height: job.height, theme: job.theme, format: job.format }, location.origin);
      } catch (error) {
        settle(null);
      }
    };
    const deadline = Date.now() + readyTimeoutMs;
    const waitReady = () => {
      if (ketcherModule.ready) {
        drain();
        return;
      }
      if (Date.now() > deadline) {
        const index = ketcherModule.queue.indexOf(queuedJob);
        if (index >= 0) ketcherModule.queue.splice(index, 1);
        queuedJob.resolve(null);
        return;
      }
      setTimeout(waitReady, 300);
    };
    waitReady();
  });
}
function readStepFieldValue(step, def) {
  const procedure = step.procedure || {};
  const raw = procedure[def.key];
  if (raw === void 0) return "";
  if (Array.isArray(raw)) {
    const items = raw.map((row) => {
      if (typeof row === "string") return row;
      if (def.key === "reagents") return [row.name, row.equivalent ? `(${row.equivalent})` : "", row.amount ? row.amount : ""].filter(Boolean).join(" ");
      if (def.key === "catalysts") return [row.name, row.loading ? `(${row.loading})` : ""].filter(Boolean).join(" ");
      if (def.key === "solvents") return [row.name, row.ratio ? `(${row.ratio})` : "", row.volume ? row.volume : ""].filter(Boolean).join(" ");
      if (def.key === "temperature") return [row.value, row.stage ? `(${row.stage})` : ""].filter(Boolean).join(" ");
      return Object.values(row).filter((v) => v !== void 0 && v !== "").join(" ");
    });
    return items.filter(Boolean).join("；");
  }
  if (typeof raw === "object") {
    return [raw.value, raw.unit, raw.type, raw.text].filter((v) => v !== void 0 && v !== "").join(" ");
  }
  return String(raw ?? "");
}
function evidenceLocator(row) {
  const bits = [];
  if (row.page !== void 0 && row.page !== null && row.page !== "") bits.push(`p.${row.page}`);
  if (row.figure) bits.push(`Fig. ${row.figure}`);
  if (row.table) bits.push(`Table ${row.table}`);
  if (row.documentId) bits.push(row.documentId);
  return bits.join(" · ");
}
function evidenceByStep(evidence, step) {
  return (evidence || []).filter((row) => row.stepId === step.id || row.stepId === void 0 && row.stepKey !== void 0 && Number(row.stepKey) === step.step);
}
function routeLevelEvidence(evidence) {
  return (evidence || []).filter((row) => row.stepId === void 0 && row.stepKey === void 0);
}
function stepIsStructured(step) {
  return !!step.procedure && Object.keys(step.procedure).length > 0;
}
function resolveCompoundPreview(entry) {
  if (!entry?.smiles) {
    return { state: "not_found", message: "该化合物尚无结构式，点击在 Ketcher 中补绘" };
  }
  return { state: "resolvable", message: "", smiles: entry.smiles };
}
function stepCompoundsByRole(step, roles) {
  const wanted = new Set(roles);
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const row of step?.structures ?? []) {
    const role = row.role || "unknown";
    if (!wanted.has(role)) continue;
    const key = normName(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// client/src/components-core.js
var import_react4 = __toESM(require("react"), 1);
function StructureCard({ entry, onClick, compact }) {
  const preview = resolveCompoundPreview(entry);
  const [state, setState] = (0, import_react4.useState)(preview.state === "resolvable" ? "loading" : "not_found");
  const [image, setImage] = (0, import_react4.useState)(null);
  const [attempt, setAttempt] = (0, import_react4.useState)(0);
  const requested = (0, import_react4.useRef)(false);
  const previewTier = structurePreviewTier(entry?.smiles);
  (0, import_react4.useEffect)(() => {
    if (!entry?.smiles) {
      setImage(null);
      setState("not_found");
      return void 0;
    }
    setImage(null);
    setState("loading");
    requested.current = true;
    let alive = true;
    ketcherRenderSmiles(entry.smiles, { natural: true }).then((dataUrl) => {
      if (!alive) return;
      if (dataUrl) {
        setImage(dataUrl);
        setState("loaded");
      } else {
        setState("error");
      }
    }).catch(() => {
      if (alive) setState("error");
    });
    return () => {
      alive = false;
    };
  }, [entry?.smiles, attempt]);
  const retry = (event) => {
    event?.stopPropagation?.();
    setState("loading");
    setImage(null);
    requested.current = false;
    setAttempt((value) => value + 1);
  };
  const hasSmiles = !!entry?.smiles;
  const openCard = (event) => {
    event?.stopPropagation?.();
    onClick?.(entry);
  };
  const stop = (event) => event?.stopPropagation?.();
  return h(
    "div",
    { className: compact ? "sw-struct-card sw-struct-compact" : "sw-struct-card", "data-state": state, "data-preview-tier": previewTier, "data-missing": hasSmiles ? void 0 : "true", "data-clickable": onClick ? "true" : void 0, title: hasSmiles ? `SMILES: ${entry.smiles}（点击在 Ketcher 中查看/编辑）` : preview.message, onClick: onClick ? openCard : void 0 },
    hasSmiles && entry.source ? h("span", { className: "sw-struct-src" }, STRUCTURE_SOURCE_LABEL[entry.source] || entry.source) : null,
    hasSmiles ? state === "loaded" ? h("img", { src: image, alt: entry.name, loading: "lazy", decoding: "async" }) : h(
      "div",
      { className: "sw-struct-fallback", style: { display: "grid", placeItems: "center", background: "var(--ib-panel)", borderRadius: 6, color: state === "error" ? "#b76b3f" : "#6b8798", fontSize: 9, padding: 6, textAlign: "center", boxSizing: "border-box" } },
      state === "error" ? h("span", null, "预览渲染失败") : "渲染中…"
    ) : h("div", { className: "sw-struct-fallback", style: { display: "grid", placeItems: "center", background: "var(--ib-panel)", borderRadius: 6, color: "var(--ib-text)", fontSize: 9, padding: 6, textAlign: "center", boxSizing: "border-box" } }, h("span", null, "结构待补绘")),
    state === "error" && !compact ? h(
      "div",
      { className: "sw-struct-acts", onClick: stop },
      h("button", { className: "sw-mini-btn", onClick: retry }, "重试预览"),
      h("button", { className: "sw-mini-btn", onClick: openCard }, "Ketcher 查看")
    ) : null,
    h("span", { className: "sw-struct-name" }, h("b", null, entry.name)),
    h("span", { className: "sw-struct-name", title: entry.casNumber || "CAS 未确认" }, entry.casNumber ? `CAS ${entry.casNumber}` : "CAS 待确认"),
    hasSmiles ? h("span", { className: "sw-cond-smiles" }, entry.smiles) : null,
    compact ? null : h(
      "div",
      { className: "sw-struct-acts", onClick: stop },
      h("button", { className: "sw-mini-btn", onClick: openCard }, hasSmiles ? "查看/编辑" : "Ketcher 补绘")
    )
  );
}
function StepReactionLayout({ step, onStructureClick }) {
  const reactants = stepCompoundsByRole(step, ["reactant"]);
  const products = stepCompoundsByRole(step, ["product"]);
  const conditionRows = stepIsStructured(step) ? STEP_FIELD_DEFS.map((def) => ({ def, value: readStepFieldValue(step, def) })).filter((row) => row.value) : [];
  const renderSide = (label, entries, names) => h(
    "div",
    { className: "sw04-reaction-side" },
    h("small", null, label),
    entries.length ? h("div", { className: "sw-struct" }, entries.map((entry) => h(StructureCard, { key: `${entry.name}-${entry.smiles || "none"}`, entry, onClick: onStructureClick, compact: true }))) : h("span", { className: "sw-hint" }, (names || []).join("、") || "文献未提供 / 待确认")
  );
  const notes = (step?.procedure?.notes || []).filter(Boolean);
  return h(
    "div",
    { className: "sw04-reaction" },
    renderSide("反应物", reactants, step.reactants),
    h(
      "div",
      { className: "sw04-arrow" },
      h("strong", null, "→"),
      conditionRows.length ? h("div", { className: "sw04-cond-grid" }, conditionRows.map((row) => h("span", { className: "sw04-cond", key: row.def.key, title: row.def.label }, h("i", null, row.def.label), row.value))) : h("span", null, step.conditions || "反应条件待人工核验"),
      notes.length ? h("em", null, notes[0]) : h("em", null, "条件与注意事项以原文核验为准")
    ),
    renderSide("产物", products, step.products)
  );
}
function PdfViewerFrame({ row, notify }) {
  const iframeRef = (0, import_react4.useRef)(null);
  const [locateState, setLocateState] = (0, import_react4.useState)("loading");
  const [errorMessage, setErrorMessage] = (0, import_react4.useState)("");
  const pageNumber = (() => {
    const m = /\d+/.exec(String(row?.page ?? ""));
    return m ? Number(m[0]) : 1;
  })();
  const bundleId = row?.bundleId || row?.documentId;
  const quote = row?.excerpt || row?.originalExtract || "";
  const open = !!bundleId;
  const documentKind = row?.sourceKind === "si" || !row?.sourceKind && row?.sourceType === "paper-si" ? "si" : "pdf";
  (0, import_react4.useEffect)(() => {
    if (!open) {
      setLocateState("error");
      setErrorMessage("未绑定已归档原文，无法定位");
      return void 0;
    }
    setLocateState("loading");
    setErrorMessage("");
    let disposed = false;
    const requestId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const postOpen = () => {
      try {
        const computed = getComputedStyle(document.body);
        const theme = {};
        for (const key of ["bg-base", "bg-layer-1", "border-l2", "label-primary", "label-secondary", "state-warn-primary"]) theme[key] = computed.getPropertyValue(`--dsw-alias-${key}`).trim();
        iframeRef.current?.contentWindow?.postMessage({ type: "open", requestId, theme, bundleId, kind: documentKind, page: pageNumber, quote, pageLabel: row?.page }, "*");
      } catch {
      }
    };
    const onMessage = (event) => {
      const data = event.data || {};
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (data?.type === "ready") {
        postOpen();
        return;
      }
      if (data.requestId !== requestId) return;
      if (data?.type === "highlight") {
        if (disposed) return;
        setLocateState(data.status === "matched" ? "matched" : data.status === "candidate" ? "candidate" : data.status === "notfound" ? "notfound" : "noquote");
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
    postOpen();
    return () => {
      disposed = true;
      window.removeEventListener("message", onMessage);
    };
  }, [bundleId, documentKind, pageNumber, quote]);
  if (!open) {
    return h("div", { className: "sw04-review-hint" }, "该项未绑定已归档原文 PDF/SI（bundleId/documentId），无法展示原文定位。请补充原文，或标记「无法确认」交给 Agent 复核。");
  }
  const label = locateState === "candidate" ? "候选段落，请人工核对" : locateState === "matched" ? "已定位原文" : locateState === "notfound" ? "未能自动定位原文，请在本页人工确认" : locateState === "noquote" ? "无可用摘录文本，仅展示原文" : locateState === "error" ? errorMessage : "正在定位原文…";
  const tone = locateState === "matched" ? "#2b7a70" : locateState === "notfound" ? "#8a6d2f" : locateState === "error" ? "#b34a45" : "#718b82";
  return h(
    "div",
    { className: "sw04-review-shot", style: { display: "flex", flexDirection: "column", gap: 8 } },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
      h("span", { style: { fontSize: 10, color: tone, fontWeight: 600 } }, label),
      h("span", { style: { flex: 1 } }),
      quote ? h("span", { style: { fontSize: 9, color: "var(--ib-text)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: quote }, `摘录：${quote}`) : null
    ),
    h("iframe", { ref: iframeRef, title: `原文定位：第 ${pageNumber} 页`, src: PDF_VIEWER_URL, style: { width: "100%", height: "min(68vh, 760px)", minHeight: 520, border: "1px solid var(--ib-line)", borderRadius: 8, background: "var(--ib-panel)" } })
  );
}
function KetcherEditorModal({ entry, onSave, onCancel }) {
  const iframeRef = (0, import_react4.useRef)(null);
  const [status, setStatus] = (0, import_react4.useState)("loading");
  const [fallbackSmiles, setFallbackSmiles] = (0, import_react4.useState)(entry?.smiles || "");
  const fallbackTimer = (0, import_react4.useRef)(null);
  const commitTimer = (0, import_react4.useRef)(null);
  const open = entry != null;
  (0, import_react4.useEffect)(() => {
    if (!open) return void 0;
    setStatus("loading");
    const onMessage = (event) => {
      const data = event.data || {};
      if (!event.source || !iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (data?.type === "ready") {
        if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
        setStatus("ready");
        if (entry?.smiles) {
          try {
            iframeRef.current.contentWindow.postMessage({ type: "setMolecule", smiles: entry.smiles }, "*");
          } catch {
          }
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
    fallbackTimer.current = setTimeout(() => setStatus((current) => current === "loading" ? "timeout" : current), 15e3);
    return () => {
      window.removeEventListener("message", onMessage);
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, [open, entry?.smiles, entry?.name]);
  if (!open) return null;
  const saveFallback = () => {
    onSave(fallbackSmiles.trim());
  };
  return h(
    "div",
    { className: "sw-struct-edit", role: "dialog", "aria-modal": "true", "aria-label": `编辑 ${entry.name} 结构式` },
    h(
      "div",
      { className: "sw-struct-edit-box" },
      h(
        "div",
        { className: "sw-struct-edit-head" },
        h("b", null, `Ketcher · ${entry.name}`),
        h("small", null, status === "ready" ? "在下方编辑器绘制/修正结构，点 Ketcher 顶栏「保存结构」回写；Ketcher 为本地离线编辑器。" : status === "timeout" ? "Ketcher 加载超时，可在下方直接编辑 SMILES 文本。" : "正在加载 Ketcher 离线编辑器（首次约 10–20 秒）…"),
        h("button", { onClick: onCancel }, "关闭")
      ),
      status === "timeout" ? h(
        "div",
        { style: { flex: 1, padding: 16, background: "var(--ib-panel)", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 } },
        h("textarea", { value: fallbackSmiles, onChange: (event) => setFallbackSmiles(event.target.value), placeholder: "SMILES，例如 CC(=O)Oc1ccccc1C(=O)O", style: { flex: 1, minHeight: 0, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12, border: "1px solid var(--ib-line)", borderRadius: 8, padding: 10, boxSizing: "border-box", resize: "none" } }),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
          h("button", { onClick: saveFallback, style: { border: "1px solid var(--ib-line)", background: "var(--ib-panel)", color: "var(--ib-text)", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12 } }, "保存 SMILES")
        )
      ) : h("iframe", { ref: iframeRef, className: "sw-struct-edit-frame", title: `Ketcher 结构编辑器：${entry.name}`, src: KETCHER_URL })
    )
  );
}

// client/src/components-workspace.js
function ResearchDesignWorkspace({ projectId, routes = [], targets = [], plans = [], call, notify, onRequestPlan, onChanged }) {
  const targetById = (id) => targets.find((row) => row.id === id) || null;
  const [routeId, setRouteId] = (0, import_react5.useState)(routes.length ? routes[0].id : null);
  const [tick, setTick] = (0, import_react5.useState)(0);
  const [detail, setDetail] = (0, import_react5.useState)(null);
  const [selectedStepId, setSelectedStepId] = (0, import_react5.useState)(null);
  const [assess, setAssess] = (0, import_react5.useState)(null);
  const [alt, setAlt] = (0, import_react5.useState)(null);
  const [busy, setBusy] = (0, import_react5.useState)({});
  const [error, setError] = (0, import_react5.useState)("");
  const [selectedEvidenceId, setSelectedEvidenceId] = (0, import_react5.useState)(null);
  const [reviewDrawerOpen, setReviewDrawerOpen] = (0, import_react5.useState)(false);
  const [correctionFor, setCorrectionFor] = (0, import_react5.useState)(null);
  const [batchList, setBatchList] = (0, import_react5.useState)([]);
  const [newRouteForm, setNewRouteForm] = (0, import_react5.useState)(null);
  const [moreOpen, setMoreOpen] = (0, import_react5.useState)(false);
  const [lockBlockers, setLockBlockers] = (0, import_react5.useState)([]);
  (0, import_react5.useEffect)(() => {
    if (routes.length && !routes.some((row) => row.id === routeId)) setRouteId(routes[0].id);
    if (!routes.length) {
      setDetail(null);
      setSelectedStepId(null);
    }
  }, [routes]);
  (0, import_react5.useEffect)(() => {
    if (!routeId) return;
    let stale = false;
    setDetail(null);
    setAssess(null);
    setAlt(null);
    setError("");
    setSelectedStepId(null);
    call("synth_route_detail", { request: { id: routeId } }).then((result) => {
      if (stale) return;
      setDetail(result);
      const first = (result.route.steps || [])[0];
      setSelectedStepId(first ? first.id || `s${first.step}` : null);
    }).catch((reason) => {
      if (!stale) setError(reason.message || "加载路线失败");
    }).finally(() => {
      if (!stale) setBusy((old) => {
        const next = { ...old };
        delete next.detail;
        return next;
      });
    });
    return () => {
      stale = true;
    };
  }, [routeId, tick]);
  const route = routeId ? routes.find((row) => row.id === routeId) || null : null;
  const target = route ? targetById(route.targetId) : null;
  const selectedStep = detail ? (detail.route.steps || []).find((step) => step.id === selectedStepId || `s${step.step}` === selectedStepId) : null;
  const stepEvidence = detail && selectedStep ? evidenceByStep(detail.evidence, selectedStep) : [];
  const routeEvidence = detail ? routeLevelEvidence(detail.evidence) : [];
  (0, import_react5.useEffect)(() => {
    if (!routeId || !selectedStepId || !detail) return;
    let stale = false;
    setAssess(null);
    setAlt(null);
    setBusy((old) => ({ ...old, assess: true }));
    call("synth_step_assess", { request: { routeId, stepId: selectedStepId } }).then((result) => {
      if (!stale) setAssess(result.result);
    }).catch((reason) => {
      if (!stale) setError(reason.message || "可行性分析失败");
    }).finally(() => {
      if (!stale) setBusy((old) => {
        const next = { ...old };
        delete next.assess;
        return next;
      });
    });
    return () => {
      stale = true;
    };
  }, [routeId, selectedStepId, !!detail]);
  const withBusy = (key, work) => {
    if (busy[key]) return;
    setBusy((old) => ({ ...old, [key]: true }));
    return Promise.resolve().then(work).catch((reason) => notify(reason.message || "操作失败")).finally(() => setBusy((old) => {
      const next = { ...old };
      delete next[key];
      return next;
    }));
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
      const changeNotes = window.prompt(`把「${route.name}」复制为新版本（draft）？
填写本次修改说明：`, "人工复核修订");
      if (changeNotes === null) return;
      return withBusy("revision", async () => {
        const result = await call("synth_route_revision", { request: { id: routeId, changeNotes, origin: "human-edited" } });
        notify(`已创建新版本 v${result.route.version}（${result.route.id}），原版本未被覆盖。`);
        await onChanged();
        setRouteId(result.route.id);
      });
    }
    if (action === "delete-route") {
      if (!route) return;
      if (route.locked) {
        notify("已锁定路线不能删除；如需清理，请保留锁定版本并删除其未锁定修订版。");
        return;
      }
      const confirmed = window.confirm(`确定删除路线「${route.name}」v${route.version}？
该路线的事实证据和审核批次也会删除，操作不可撤销。`);
      if (!confirmed) return;
      return withBusy("delete-route", async () => {
        const result = await call("synth_route_delete", { request: { id: route.id } });
        const nextRouteId = routes.find((row) => row.id !== route.id)?.id ?? null;
        setMoreOpen(false);
        setDetail(null);
        setSelectedStepId(null);
        setRouteId(nextRouteId);
        await onChanged();
        notify(`已删除路线「${route.name}」；同步清理 ${result.result?.evidenceDeleted ?? 0} 条事实和 ${result.result?.reviewBatchesDeleted ?? 0} 个审核批次。`);
      });
    }
    if (action === "lock") {
      if (!route) return;
      return withBusy("lock", async () => {
        const response = await fetch("/api/lab-user-action/lock-route", {
          method: "POST",
          headers: { "content-type": "application/json", "x-lab-user-action": "lock-route" },
          body: JSON.stringify({ routeId })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
          if (result && Array.isArray(result.blockers) && result.blockers.length) {
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
    if (action === "add-step") {
      if (!route || route.locked) {
        notify(route?.locked ? "路线已锁定；请先复制为新版本。" : "尚未选择路线。");
        return;
      }
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
      return;
    }
    if (action === "edit-step") {
      notify("Step 条件人工编辑：当前版本可在对话中让 Agent 修改，或等待后续版本加入表单编辑（FR-12）。已确认字段不会被静默覆盖。");
      return;
    }
  };
  const submitAddStep = async (fields) => {
    if (!route || route.locked) {
      notify("路线已锁定；请先复制为新版本。");
      return;
    }
    const splitNames = (value) => String(value || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
    const number = Math.max(0, ...(route.steps || []).map((item) => Number(item.step) || 0)) + 1;
    const step = { id: `s${number}`, step: number, reaction: String(fields.reaction || "").trim(), reactants: splitNames(fields.reactants), products: splitNames(fields.products), structures: [], conditions: "待补充" };
    if (!step.reaction) {
      notify("请填写反应名称/简述。");
      return;
    }
    await withBusy("add-step", async () => {
      await call("synth_route_step", { request: { id: routeId, step } });
      notify(`已添加 Step ${number}；路线与步骤默认未锁定。`);
      await onChanged();
      setTick((value) => value + 1);
      setAddStepForm(null);
    });
  };
  const evidenceRequiresShotClient = (row) => {
    if (row?.bundleId || row?.documentId) return false;
    const method = String(row?.extractionMethod ?? "");
    return ["text", "vlm", "search", "model"].includes(method) && row?.excerpt !== void 0 && row?.excerpt !== null && row?.excerpt !== "";
  };
  const evidenceConfirmable = (row) => {
    if (!evidenceRequiresShotClient(row)) return true;
    return false;
  };
  const evidenceShotBlockReason = (row) => {
    return "该自动提取项尚未绑定已归档 PDF/SI，不能作为原文核验完成；请补充原文，或标“无法确认”交给 Agent。";
  };
  const decideEvidence = (row, status) => withBusy(`ev:${row.id}`, async () => {
    if (status === "confirmed" && !evidenceConfirmable(row)) {
      notify(`Evidence ${row.id} 暂不能确认：${evidenceShotBlockReason(row)}`);
      return;
    }
    await call("synth_evidence_review", { request: { id: row.id, status } });
    notify(`Evidence ${row.id} 已标记为“${EVIDENCE_REVIEW_LABEL[status]}”。`);
    const reload = await call("synth_route_detail", { request: { id: routeId } });
    setDetail(reload);
  });
  const saveCorrection = (row, rawValue) => withBusy(`ev:${row.id}`, async () => {
    if (evidenceRequiresShotClient(row) && !evidenceConfirmable(row)) {
      notify(`Evidence ${row.id} 暂不能修正：${evidenceShotBlockReason(row)}`);
      return;
    }
    const correction = String(rawValue ?? "").trim();
    if (!correction) {
      notify("修正值不能为空。");
      return;
    }
    await call("synth_evidence_review", { request: { id: row.id, status: "corrected", correction } });
    notify(row.originalExtract ? `已保存人工修正（原始提取值“${row.originalExtract}”保留在 originalExtract）。` : "已保存人工修正。");
    const reload = await call("synth_route_detail", { request: { id: routeId } });
    setDetail(reload);
    setCorrectionFor(null);
  });
  const loadReviewBatches = (0, import_react5.useCallback)(() => {
    if (!routeId) return Promise.resolve([]);
    return call("synth_review_batch_get", { request: { routeId } }).then((result) => {
      setBatchList(result.batches || []);
      return result.batches || [];
    }).catch(() => {
      setBatchList([]);
      return [];
    });
  }, [routeId, call, tick]);
  const submitReviewBatch = () => withBusy("batch", async () => {
    if (!selectedStep) return;
    const pendingCount = stepEvidence.filter((row) => row.reviewStatus === "pending").length;
    if (pendingCount) {
      notify(`仍有 ${pendingCount} 条事实未完成人工选择（确认/修正/无法确认）；全部完成后才能交给 Agent。`);
      return;
    }
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
  const submitNewRoute = (form) => withBusy("new-route", async () => {
    const name = String(form?.name ?? "").trim();
    const targetId = form?.targetId;
    if (!name) {
      notify("请填写路线名称。");
      return;
    }
    if (!targetId) {
      notify("请选择合成目标。");
      return;
    }
    const id = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const result = await call("synth_route_create", { request: { fields: { id, projectId, targetId, name, origin: "human-edited" } } });
    notify(`已新建路线「${result.route.name}」（draft，未锁定）。`);
    setNewRouteForm(null);
    await onChanged();
    setRouteId(result.route.id);
  });
  const openReviewDrawer = (evidenceId) => {
    setSelectedEvidenceId(evidenceId);
    const row = detail?.evidence?.find((item) => item.id === evidenceId);
    setCorrectionFor(row?.userCorrection ? { id: evidenceId, value: row.userCorrection } : null);
    setReviewDrawerOpen(true);
  };
  const closeReviewDrawer = () => {
    setReviewDrawerOpen(false);
    setCorrectionFor(null);
  };
  (0, import_react5.useEffect)(() => {
    if (!reviewDrawerOpen) return void 0;
    const onKey = (event) => {
      if (event.key === "Escape") setReviewDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewDrawerOpen]);
  const activeEvidence = detail && selectedEvidenceId ? stepEvidence.find((row) => row.id === selectedEvidenceId) || null : null;
  const [ketcherModal, setKetcherModal] = (0, import_react5.useState)(null);
  const [addStepForm, setAddStepForm] = (0, import_react5.useState)(null);
  const [dualPanel, setDualPanel] = (0, import_react5.useState)(null);
  const [planPreview, setPlanPreview] = (0, import_react5.useState)(null);
  const routePlan = route ? plans.find((item) => item.routeId === route.id || item.id === `plan-${route.id}` || item.id.startsWith(`plan-${route.id}-`)) : null;
  const requestExperimentPlan = () => {
    if (!route || !onRequestPlan) return;
    const prompt = `请为合成路线「${route.name}」（routeId: ${route.id}）生成实验计划。先读取路线全部步骤、已归档文献证据和当前实验计划模板；补齐可确认信息，缺失项明确标为待确认，完成后调用 lab_synth_experiment_plan_create 登记到项目面板。`;
    onRequestPlan(prompt);
  };
  const planPreviewNode = !planPreview ? null : h(
    "div",
    { className: "sw-struct-edit", onClick: () => setPlanPreview(null) },
    h(
      "div",
      { className: "sw04-plan-preview", role: "dialog", "aria-modal": "true", "aria-label": "实验计划", onClick: (event) => event.stopPropagation() },
      h(
        "div",
        { className: "sw04-plan-preview-head" },
        h("div", null, h("b", null, planPreview.title), h("small", null, `${planPreview.status} · ${planPreview.templateSnapshot?.name || "实验计划模板"}`)),
        h("button", { className: "sw-mini-btn", onClick: () => setPlanPreview(null) }, "关闭")
      ),
      h("section", null, h("h4", null, "实验目的"), h("p", null, planPreview.objective)),
      h("section", null, h("h4", null, "规模"), h("p", null, planPreview.scale)),
      h(
        "section",
        null,
        h("h4", null, "试剂与用量"),
        h("div", { className: "sw04-plan-grid" }, (planPreview.reagents || []).map((item, index) => h("div", { key: `${item.name}-${index}` }, h("b", null, item.name), h("span", null, `${item.amount}${item.role ? ` · ${item.role}` : ""}`))))
      ),
      h(
        "section",
        null,
        h("h4", null, "操作步骤"),
        h("ol", null, (planPreview.steps || []).map((item, index) => h("li", { key: index }, h("b", null, item.step), `：${item.description}${item.monitoring ? `（监测：${item.monitoring}）` : ""}`)))
      ),
      h(
        "section",
        null,
        h("h4", null, "后处理、纯化与表征"),
        h("p", null, [planPreview.workup, ...planPreview.purification || [], ...planPreview.characterization || []].filter(Boolean).join("；") || "待确认")
      ),
      h(
        "section",
        null,
        h("h4", null, "安全与废弃物"),
        h("ul", null, (planPreview.safety || []).map((item, index) => h("li", { key: index }, item)))
      )
    )
  );
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
    if (!modal || !clean) {
      notify(clean ? "结构式为空，未保存" : "保存失败：未收到结构式");
      return;
    }
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
  (0, import_react5.useEffect)(() => {
    const candidates = detail?.evidence || [];
    const rows = selectedStep ? candidates.filter((row) => row.stepId === selectedStep.id || row.stepId === void 0 && row.stepKey !== void 0 && Number(row.stepKey) === selectedStep.step) : [];
    setSelectedEvidenceId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
  }, [detail, selectedStepId]);
  (0, import_react5.useEffect)(() => {
    if (!routeId) return void 0;
    let stale = false;
    call("synth_review_batch_get", { request: { routeId } }).then((result) => {
      if (!stale) setBatchList(result.batches || []);
    }).catch(() => {
      if (!stale) setBatchList([]);
    });
    return () => {
      stale = true;
    };
  }, [routeId, tick]);
  const runDualResolve = () => withBusy("dual", async () => {
    if (route?.locked) {
      notify("当前路线已锁定；请先复制为新版本。");
      return;
    }
    if (!selectedStep) return;
    const result = await call("synth_step_resolve_dual", { request: { routeId, stepId: selectedStep.id } });
    const r = result.result || {};
    setDualPanel({ results: r.results || [], missingAfter: r.missingAfter || [] });
    if (!(r.results || []).length) notify("该步骤化合物均已具备结构式，无需查询。");
  });
  const registerDualStructure = (item) => withBusy(`dual-save:${item.name}`, async () => {
    if (route?.locked) {
      notify("当前路线已锁定；请先复制为新版本。");
      return;
    }
    if (!selectedStep || !item?.smiles) return;
    const verifiedSources = item.status === "dual-confirmed" ? ["pubchem", "cactus"] : item.sources?.pubchem?.smiles ? ["pubchem"] : ["cactus"];
    try {
      await call("synth_step_set_structure", { request: { routeId, stepId: selectedStep.id, name: item.name, smiles: item.smiles, casNumber: item.casNumber || void 0, inchiKey: item.inchiKey || void 0, verification: { status: item.status, sources: verifiedSources, checkedAt: (/* @__PURE__ */ new Date()).toISOString() } } });
      notify(`已登记「${item.name}」结构（${item.status === "dual-confirmed" ? "PubChem/CACTUS 双源一致" : "单源确认"}）${item.casNumber ? `，CAS ${item.casNumber}` : ""}。`);
      const reload = await call("synth_route_detail", { request: { id: routeId } });
      setDetail(reload);
      if (dualPanel) setDualPanel({ results: dualPanel.results.filter((row) => row.name !== item.name), missingAfter: dualPanel.missingAfter });
    } catch (reason) {
      notify(reason.message || "登记失败");
    }
  });
  const newRouteDialog = newRouteForm ? h("div", { className: "sw-struct-edit" }, h(
    "div",
    { className: "sw04-form", style: { maxWidth: 460, margin: "auto" } },
    h("b", null, "新建路线（draft · 未锁定）"),
    h("label", { style: { fontSize: 10, color: "var(--ib-text)" } }, "合成目标"),
    h(
      "select",
      { value: newRouteForm.targetId, onChange: (event) => setNewRouteForm({ ...newRouteForm, targetId: event.target.value }) },
      targets.map((row) => h("option", { key: row.id, value: row.id }, `${row.name}${row.smiles ? " · " + row.smiles : ""}`))
    ),
    h("label", { style: { fontSize: 10, color: "var(--ib-text)" } }, "路线名称"),
    h("input", { value: newRouteForm.name, placeholder: "例如：目标分子的 3 步合成路线", onChange: (event) => setNewRouteForm({ ...newRouteForm, name: event.target.value }) }),
    h(
      "div",
      { className: "sw04-form-acts" },
      h("button", { className: "sw-mini-btn", onClick: () => setNewRouteForm(null) }, "取消"),
      h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["new-route"], onClick: () => void submitNewRoute(newRouteForm) }, busy["new-route"] ? "创建中…" : "创建路线")
    )
  )) : null;
  if (!routes.length) {
    return h(
      "div",
      { className: "sw-plan" },
      h(
        "section",
        { className: "ib-card" },
        h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "合成路线工作台"), h("span", { className: "ib-chip" }, "空状态")),
        h(
          "div",
          { className: "sw-plan-empty" },
          h("b", null, targets.length ? "已登记合成目标，但还没有合成路线" : "尚未登记合成目标/路线"),
          targets.length ? "可新建路线，或让 Agent 根据文献登记路线与步骤。" : "先在课题中登记合成目标，路线出现后会在这里变成可交互工作台。"
        ),
        targets.length ? h("div", { className: "sw04-form-acts", style: { marginTop: 12, justifyContent: "center" } }, h("button", { className: "sw-mini-btn", "data-primary": true, onClick: () => setNewRouteForm({ name: "", targetId: targets[0]?.id || "" }) }, "新建路线")) : null
      ),
      newRouteDialog
    );
  }
  const originChip = route ? ROUTE_ORIGIN_LABEL[route.origin] || route.origin : "";
  const evidenceCount = detail ? detail.evidence.length : 0;
  return h(
    "div",
    { className: "sw-plan" },
    h(
      "section",
      { className: "sw-sec" },
      h(
        "div",
        { className: "sw-head" },
        h(
          "div",
          null,
          h("h3", null, "合成路线工作台"),
          h("p", null, "路线层：目标、版本、步骤拓扑。点击任一 Step 查看条件、文献来源与可行性；修改请先“复制为新版本”，不会覆盖已审核版本。")
        ),
        h(
          "div",
          { className: "sw-acts" },
          h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["new-route"] || !targets.length, onClick: () => setNewRouteForm({ name: "", targetId: targets[0]?.id || "" }), title: targets.length ? "从目标新建一条未锁定路线" : "需要先在课题登记合成目标" }, busy["new-route"] ? "创建中…" : "新建路线"),
          h("button", { className: "sw-mini-btn", disabled: !!busy["add-step"] || route?.locked, onClick: () => runAction("add-step") }, busy["add-step"] ? "添加中…" : "添加步骤"),
          route?.locked ? h("span", { className: "sw-chip", "data-tone": "good" }, "已锁定") : h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy.lock, onClick: () => runAction("lock") }, busy.lock ? "锁定中…" : "锁定版本"),
          h(
            "div",
            { style: { position: "relative" } },
            h("button", { className: "sw-mini-btn", "data-warn": moreOpen ? "true" : void 0, onClick: () => setMoreOpen((value) => !value), "aria-expanded": moreOpen ? "true" : "false" }, moreOpen ? "收起菜单" : "更多"),
            moreOpen ? h(
              "div",
              { className: "sw04-more" },
              h("button", { className: "sw-mini-btn", onClick: () => {
                setMoreOpen(false);
                runAction("revision");
              } }, "复制为新版本"),
              h("button", { className: "sw-mini-btn", disabled: !!busy.extract, onClick: () => {
                setMoreOpen(false);
                runAction("extract");
              }, title: detail?.capability?.reason || "" }, "从文献提取路线"),
              h("button", { className: "sw-mini-btn", onClick: () => {
                setMoreOpen(false);
                runAction("retro");
              }, title: "需要 RetrosynthesisProvider（0.3.0 未配置）" }, "整体逆向规划"),
              h("button", { className: "sw-mini-btn", onClick: () => {
                setMoreOpen(false);
                setTick((t) => t + 1);
                void onChanged();
              } }, "刷新"),
              h("button", { className: "sw-mini-btn", "data-danger": true, disabled: !!busy["delete-route"] || route?.locked, title: route?.locked ? "锁定版本不能删除" : "删除当前路线及其事实和审核批次", onClick: () => runAction("delete-route") }, busy["delete-route"] ? "删除中…" : "删除当前路线")
            ) : null
          )
        )
      ),
      // rc.4 §7：顶部只保留路线/版本选择 + 锁定/新建/添加/更多动作。
      // 目标/状态/锁定态不放常驻状态墙，压缩为一行弱化路线说明。
      h(
        "div",
        { className: "sw-toolbar" },
        h(
          "select",
          { className: "sw-select", value: routeId || "", onChange: (event) => setRouteId(event.target.value), style: { maxWidth: 340, fontSize: 10.5 }, "aria-label": "选择路线/版本" },
          routes.map((row) => h("option", { key: row.id, value: row.id }, `${row.name} · v${row.version}${row.origin ? ` · ${ROUTE_ORIGIN_LABEL[row.origin] || row.origin}` : ""}`))
        ),
        route ? h("span", { className: "sw-meta-note", style: { flex: 1, minWidth: 0 }, title: `${route.name} · ${ROUTE_STATUS_LABEL[route.status] || route.status}${route.locked ? " · 已锁定" : " · 未锁定"}${target ? ` · 目标 ${target.name}` : ""}` }, [target ? `目标 ${target.name}` : null, route.locked ? "已锁定 · 只读" : "未锁定", ROUTE_STATUS_LABEL[route.status] || route.status].filter(Boolean).join(" · ")) : null
      ),
      error ? h("div", { className: "ib-error", style: { marginTop: 10 } }, error) : null,
      lockBlockers.length ? h(
        "div",
        { className: "ib-error", style: { marginTop: 8, border: "1px solid var(--ib-line)", padding: "10px 12px", borderRadius: 10 } },
        h("b", null, "锁定被阻断："),
        lockBlockers.map((blocker, index) => h(
          "div",
          { key: `${blocker.code}-${index}`, style: { marginTop: 5, lineHeight: 1.6 } },
          `${index + 1}. ${blocker.message}`,
          (blocker.stepIds || []).length ? h("span", { style: { marginLeft: 6, color: "var(--ib-text)" } }, `步骤：${blocker.stepIds.join("、")}`) : null,
          (blocker.evidenceIds || []).length ? h("span", { style: { marginLeft: 6, color: "var(--ib-text)" } }, `事实：${blocker.evidenceIds.join("、")}`) : null
        ))
      ) : null,
      h(
        "div",
        { className: "sw-graph" },
        !detail ? h(
          "div",
          { className: "sw-plan-empty", style: { flex: 1 } },
          h("span", { className: "sw-spin" }),
          h("b", null, error ? "路线加载失败" : "正在加载路线…"),
          error || "正在读取路线、步骤与 Evidence…"
        ) : !detail.route.steps?.length ? h(
          "div",
          { className: "sw-plan-empty", style: { flex: 1 } },
          h("b", null, "该路线还没有任何步骤"),
          "使用“从文献提取路线”，或让 Agent / 人工登记步骤与结构化条件。"
        ) : detail.route.steps.map((step) => {
          const isActive = step.id === selectedStepId;
          const reactantEntries = stepCompoundsByRole(step, ["reactant"]);
          const productEntries = stepCompoundsByRole(step, ["product"]);
          const openOverviewStructure = (targetStep, entry) => {
            if (route?.locked) {
              notify("当前路线已锁定；请先复制为新版本。");
              return;
            }
            const targetKey = targetStep?.id ?? `s${targetStep?.step}`;
            setSelectedStepId(targetKey);
            setMoreOpen(false);
            setKetcherModal({ stepKey: targetKey, name: entry?.name || "", smiles: entry?.smiles || "", role: entry?.role || "unknown" });
          };
          const structureNode = (entry) => h(
            "span",
            { className: "sw-step-chem-node", key: `${entry.name}-${entry.smiles || "none"}`, title: entry.casNumber ? `${entry.name} · CAS ${entry.casNumber}` : entry.name },
            h(StructureCard, { entry, onClick: () => openOverviewStructure(step, entry), compact: true })
          );
          const structureRow = (entries, fallbackNames, dataRole) => entries.length ? h("span", { className: "sw-step-chem-flow", "data-role": dataRole }, entries.map(structureNode)) : h("span", { className: "sw-step-chem-empty", "data-role": dataRole }, (fallbackNames || []).join("、") || "结构待补");
          return h(
            "div",
            { key: step.id, className: "sw-step", "data-active": isActive ? "true" : void 0, role: "button", tabIndex: 0, "aria-label": `${step.id}：${step.label || step.reaction || `Step ${step.step}`}，点击查看步骤详情`, onClick: (event) => {
              setSelectedStepId(step.id);
              setMoreOpen(false);
            }, onKeyDown: (event) => {
              if (["Enter", " "].includes(event.key)) {
                event.preventDefault();
                setSelectedStepId(step.id);
                setMoreOpen(false);
              }
            } },
            h(
              "span",
              { className: "sw-step-top" },
              h("span", { className: "sw-step-id" }, step.id),
              h("span", { className: "sw-chip", "data-tone": structured ? "good" : "warn" }, structured ? "结构化" : "原文摘要")
            ),
            h("span", { className: "sw-step-reaction" }, step.label || step.reaction || `Step ${step.step}`),
            h(
              "span",
              { className: "sw-step-chem" },
              h("span", { className: "sw-step-chem-reactants", "data-role": "reactants" }, structureRow(reactantEntries, step.reactants, "reactants")),
              h(
                "span",
                { className: "sw-step-chem-mid" },
                h("span", { className: "sw-step-chem-arrow", "aria-hidden": "true" }, "→"),
                null
              ),
              h("span", { className: "sw-step-chem-products", "data-role": "products" }, structureRow(productEntries, step.products, "products"))
            )
          );
        })
      )
    ),
    selectedStep && detail ? h(
      "section",
      { className: "sw-sec sw04-detail" },
      h(
        "div",
        { className: "sw-head" },
        h(
          "div",
          null,
          h("h3", null, `${selectedStep.id} · 步骤详情`),
          h("p", null, "横向反应式：左侧反应物 → 中间条件与注意事项 → 右侧产物。字段无来源显示“文献未提供 / 待确认”，系统不自动补默认值；缺结构可解析或 Ketcher 补绘。")
        ),
        h(
          "div",
          { className: "sw-acts" },
          h("button", { className: "sw-mini-btn", disabled: !!busy.dual || route?.locked, onClick: () => void runDualResolve(), title: "PubChem/CACTUS 查询缺结构化合物，首个来源命中即可登记" }, busy.dual ? "查询中…" : "补充结构"),
          h("button", { className: "sw-mini-btn", "data-primary": routePlan ? true : void 0, "data-ready": routePlan ? "true" : "false", disabled: !route?.steps?.length, onClick: () => routePlan ? setPlanPreview(routePlan) : requestExperimentPlan(), title: routePlan ? "查看已登记实验计划" : "在当前课题工作区新建对话并预填实验计划任务" }, routePlan ? "打开实验计划" : "生成实验计划")
        )
      ),
      h(StepReactionLayout, { step: selectedStep, onStructureClick: openStructureEditor }),
      h("p", { className: "sw04-difficulty" }, h("b", null, "步骤难点"), selectedStep.difficultySummary || "缺少足够的结构或条件信息，需先核验。"),
      stepIsStructured(selectedStep) ? h("div", { className: "sw-notes", style: { marginTop: 10 } }, h("div", { className: "sw-note" }, h("i", null, "✓"), h("span", null, "结构化条件已在中栏完整展示；字段级原文来源请到下方「事实核验」面板逐条确认。"))) : h("div", { className: "sw-notes", style: { marginTop: 12 } }, h("div", { className: "sw-note" }, h("i", null, "⚠"), h("span", null, selectedStep.conditions ? `该步骤为原文摘要形态（未结构化）。原文条件摘要：${selectedStep.conditions}` : "该步骤为原文摘要形态（未结构化）。关键字段暂视为“待确认”，可在对话中让 Agent 拆分为结构化条件并补充 Evidence。"))),
      (selectedStep.procedure?.notes || []).length ? h("div", { className: "sw-notes" }, selectedStep.procedure.notes.map((note, index) => h("div", { className: "sw-note", key: index }, h("i", null, "⚠"), h("span", null, note)))) : null
    ) : h("section", { className: "sw-sec" }, h("div", { className: "sw-plan-empty" }, h("b", null, "尚未选择步骤"), "在上方路线总览中点击一个 Step，查看横向反应式、事实核验与实验计划。")),
    selectedStep && detail ? h(
      "section",
      { className: "sw-sec sw04-fact" },
      h(
        "div",
        { className: "sw-head" },
        h(
          "div",
          null,
          h("h3", null, "事实核验"),
          h("p", null, "本步事实以紧凑列表展示；点击「审核」从右侧打开已归档 PDF/SI 原文定位，在抽屉内完成确认 / 修正 / 无法确认。没有归档原文的自动提取项不能计为核验完成。"),
          h(
            "span",
            { className: "sw-chip", "data-tone": stepEvidence.some((row) => row.reviewStatus === "pending") ? "warn" : "good" },
            `待核验 ${stepEvidence.filter((row) => row.reviewStatus === "pending").length} / 已确认 ${stepEvidence.filter((row) => row.reviewStatus === "confirmed").length}`
          )
        )
      ),
      stepEvidence.length ? h("div", { className: "sw04-fact-compact" }, stepEvidence.map((row) => {
        const locked = !!route?.locked;
        const reviewLabel = { pending: "待核验", confirmed: "已确认", corrected: "已修正", rejected: "无法确认", edited: "已修订" }[row.reviewStatus] || row.reviewStatus;
        const reviewTone = row.reviewStatus === "pending" ? "warn" : row.reviewStatus === "rejected" ? "bad" : "good";
        const claim = row.excerpt || row.userCorrection || row.title || row.sourceName || "";
        const fieldLabel = row.supportsField ? String(row.supportsField) : row.title || "核验项";
        return h(
          "div",
          { key: row.id, className: "sw04-fact-row" },
          h(
            "div",
            { className: "sw04-fact-row-main" },
            h("div", { className: "sw04-fact-row-title" }, row.title || row.sourceName || fieldLabel),
            h("div", { className: "sw04-fact-row-meta" }, `${EVIDENCE_SOURCE_LABEL[row.sourceType] || row.sourceType}${evidenceLocator(row) ? " · " + evidenceLocator(row) : ""}${row.supportsField ? " · " + row.supportsField : ""}`),
            claim ? h("div", { className: "sw04-fact-row-claim", title: claim }, claim) : null
          ),
          h(
            "span",
            { className: "sw04-fact-row-status" },
            h("span", { className: "sw-chip", "data-tone": reviewTone }, `第 ${row.reviewRound || 1} 轮 · ${reviewLabel}`)
          ),
          h("button", { className: "sw04-fact-review-btn", "data-done": row.reviewStatus !== "pending" ? "true" : void 0, disabled: locked, onClick: () => openReviewDrawer(row.id), title: locked ? "路线已锁定" : row.reviewStatus !== "pending" ? "重新审核该事实" : "审核该事实（打开右侧原文核对抽屉）" }, row.reviewStatus !== "pending" ? "重新审核" : "审核")
        );
      })) : h("div", { className: "sw-plan-empty", style: { marginTop: 12, padding: "20px 14px" } }, h("b", null, "该步骤暂无字段级 Evidence"), "关键实验字段缺少文献支撑时视为“待确认”；可让 Agent 从 SI/正文提取并绑定到字段。"),
      stepEvidence.length ? h(
        "div",
        { className: "sw04-batchbar" },
        h("b", null, "本轮事实核验"),
        h("small", null, stepEvidence.filter((row) => row.reviewStatus === "pending").length ? `${stepEvidence.filter((row) => row.reviewStatus === "pending").length} 条仍待选择（确认/修正/无法确认）。` : "本步事实已全部人工选择。"),
        h("span", { style: { flex: 1 } }),
        h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy.batch || route?.locked || stepEvidence.some((row) => row.reviewStatus === "pending"), onClick: () => void submitReviewBatch(), title: stepEvidence.some((row) => row.reviewStatus === "pending") ? "全部事实完成后才能提交" : "提交后 Agent 只更新无法确认/缺失/冲突项" }, busy.batch ? "提交中…" : "交给 Agent 更新未确定项")
      ) : null,
      batchList.filter((row) => row.stepId === selectedStep.id).length ? h(
        "div",
        { className: "sw04-batchbar", style: { borderColor: "rgba(112,157,211,.3)", background: "var(--ib-panel)" } },
        h("b", null, "审核批次"),
        h("small", null, batchList.filter((row) => row.stepId === selectedStep.id).slice(0, 3).map((row) => {
          const tone = row.status === "pending" ? "等待 Agent 处理" : row.status === "applied" ? "Agent 已回写 · 进入下一轮" : "已关闭";
          return h("span", { key: row.id, className: "sw-chip", style: { marginRight: 6 } }, `第 ${row.round} 轮 · ${tone} · ${row.id}`);
        })),
        h("span", { style: { flex: 1 } }),
        batchList.some((row) => row.stepId === selectedStep.id && ["pending", "applied"].includes(row.status)) ? h("button", { className: "sw-mini-btn", disabled: !!route?.locked, onClick: () => void completeBatch(batchList.find((row) => row.stepId === selectedStep.id && ["pending", "applied"].includes(row.status))) }, "关闭本步批次") : null
      ) : null
    ) : null,
    addStepForm ? h("div", { className: "sw-struct-edit" }, h(
      "div",
      { className: "sw04-form" },
      h("b", null, `添加步骤（Step ${Math.max(0, ...(route?.steps || []).map((item) => Number(item.step) || 0)) + 1}）`),
      h("input", { value: addStepForm.reaction, placeholder: "反应名称/简述（必填），例如：RAFT 聚合", onChange: (event) => setAddStepForm({ ...addStepForm, reaction: event.target.value }) }),
      h("input", { value: addStepForm.reactants, placeholder: "反应物（顿号或逗号分隔）", onChange: (event) => setAddStepForm({ ...addStepForm, reactants: event.target.value }) }),
      h("input", { value: addStepForm.products, placeholder: "产物（顿号或逗号分隔）", onChange: (event) => setAddStepForm({ ...addStepForm, products: event.target.value }) }),
      h(
        "div",
        { className: "sw04-form-acts" },
        h("button", { className: "sw-mini-btn", onClick: () => setAddStepForm(null) }, "取消"),
        h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["add-step"], onClick: () => void submitAddStep(addStepForm) }, busy["add-step"] ? "添加中…" : "添加")
      )
    )) : null,
    newRouteDialog,
    // 0.4.0：PubChem/CACTUS 双源核验结果面板（四态候选，登记需人工点击）
    dualPanel ? h("div", { className: "sw-struct-edit" }, h(
      "div",
      { style: { width: "min(820px,96vw)", maxHeight: "84vh", overflowY: "auto", display: "grid", gap: 10, background: "var(--ib-panel)", border: "1px solid var(--ib-line)", borderRadius: 14, padding: 16, color: "var(--ib-text)", fontSize: 11, lineHeight: 1.6 } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10 } },
        h("b", { style: { fontSize: 13, color: "var(--ib-text)" } }, "结构查询 · 单源命中即可登记"),
        h("span", { style: { flex: 1 } }, `${dualPanel.results.length} 个化合物缺结构式`),
        h("button", { className: "sw-mini-btn", onClick: () => setDualPanel(null) }, "关闭")
      ),
      h("p", { style: { margin: 0, color: "var(--ib-text)" } }, "采用首个命中的结构与 CAS。可点击登记补充到路线；未命中时可在 Ketcher 中补绘。"),
      dualPanel.results.length ? dualPanel.results.map((item) => {
        const tone = item.status === "dual-confirmed" ? "#a5e8c6" : item.status === "single-source" ? "#ffe1a0" : item.status === "conflict" ? "#ffb3bd" : "#9bb3d1";
        const label = item.status === "dual-confirmed" ? "双源一致" : item.status === "single-source" ? item.sources?.pubchem?.smiles ? "单源 · PubChem" : "单源 · CACTUS" : item.status === "conflict" ? "两源冲突" : "未命中";
        const pub = item.sources?.pubchem || {};
        const cac = item.sources?.cactus || {};
        const pubText = pub.smiles ? "✓ " + String(pub.smiles).slice(0, 40) + (pub.cid ? " · CID " + pub.cid : "") : "✗ " + (pub.error || "未查询");
        const cacText = cac.smiles ? "✓ " + String(cac.smiles).slice(0, 40) : "✗ " + (cac.error || "未查询");
        const canRegister = item.status === "dual-confirmed" || item.status === "single-source";
        const rowStyle = { border: "1px solid var(--ib-line)", borderRadius: 11, background: "var(--ib-panel)", padding: "10px 12px", display: "grid", gap: 6 };
        const headFlex = h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h("b", { style: { color: "var(--ib-text)" } }, item.name),
          h("span", { style: { color: tone, border: "1px solid " + tone + "55", background: tone + "14", borderRadius: 999, padding: "1px 8px", fontSize: 9 } }, label),
          item.casNumber ? h("span", { className: "sw-chip" }, "CAS " + item.casNumber) : null,
          h("span", { style: { flex: 1 } }),
          canRegister ? h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy["dual-save:" + item.name], onClick: () => void registerDualStructure(item) }, busy["dual-save:" + item.name] ? "登记中…" : "登记结构") : null,
          h("button", { className: "sw-mini-btn", disabled: route?.locked, onClick: () => {
            setDualPanel(null);
            openStructureEditor({ name: item.name });
          } }, "Ketcher 补绘")
        );
        const smilesRow = item.smiles ? h("div", { style: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 9.5, color: "var(--ib-text)", wordBreak: "break-all" } }, "SMILES " + item.smiles) : null;
        const srcRow = h(
          "div",
          { style: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 9.5, color: "var(--ib-text)" } },
          h("span", null, "PubChem " + pubText),
          h("span", null, "CACTUS " + cacText)
        );
        return h("div", { key: item.name, style: rowStyle }, headFlex, smilesRow, srcRow);
      }) : h("div", { className: "sw-plan-empty", style: { padding: "16px 14px" } }, "缺结构化合物已完成查询或登记。")
    )) : null,
    planPreviewNode,
    // ── RC1-04/05：右侧审核抽屉（单例，按 activeEvidenceId 动态渲染）──
    reviewDrawerOpen && activeEvidence ? h(
      "div",
      { className: "sw04-review-backdrop", onClick: closeReviewDrawer },
      h(
        "div",
        { className: "sw04-review-drawer", role: "dialog", "aria-modal": "true", "aria-label": "事实核验审核抽屉", onClick: (event) => event.stopPropagation() },
        h(
          "div",
          { className: "sw04-review-head" },
          h(
            "div",
            { className: "sw04-review-head-main" },
            h("span", { className: "sw04-review-head-title" }, activeEvidence.title || activeEvidence.sourceName || "事实核验"),
            h("span", { className: "sw04-review-head-sub" }, `${EVIDENCE_SOURCE_LABEL[activeEvidence.sourceType] || activeEvidence.sourceType}${activeEvidence.doi ? " · DOI " + activeEvidence.doi : ""}${evidenceLocator(activeEvidence) ? " · " + evidenceLocator(activeEvidence) : ""}${activeEvidence.supportsField ? " · 字段 " + activeEvidence.supportsField : ""}`)
          ),
          h("button", { className: "sw04-review-close", onClick: closeReviewDrawer, "aria-label": "关闭审核抽屉" }, "关闭")
        ),
        h(
          "div",
          { className: "sw04-review-body" },
          h(
            "div",
            { className: "sw04-review-copy" },
            h("div", { className: "sw04-review-field" }, h("b", null, "核验字段："), activeEvidence.supportsField || activeEvidence.title || "（未标注字段）"),
            activeEvidence.excerpt ? h("div", { className: "sw04-review-quote" }, h("b", null, "系统提取值："), activeEvidence.excerpt) : null,
            activeEvidence.userCorrection ? h("div", { className: "sw04-review-quote", style: { borderLeftColor: "#d9a441", background: "var(--ib-panel)" } }, h("b", null, "人工修正："), activeEvidence.userCorrection, activeEvidence.originalExtract ? `（原始提取：${activeEvidence.originalExtract}）` : "") : null,
            // 已有 PDF 时直接展示原文定位，不再重复显示服务端截图。
            h(PdfViewerFrame, { row: activeEvidence, notify })
          ),
          h(
            "div",
            { className: "sw04-review-foot" },
            h("input", { className: "sw04-review-note", value: correctionFor?.value ?? "", placeholder: "修正值（确认/无法确认可留空）", onChange: (event) => setCorrectionFor({ id: activeEvidence.id, value: event.target.value }), disabled: !!busy[`ev:${activeEvidence.id}`] || !!route?.locked }),
            h("button", { className: "sw-mini-btn", "data-no": true, disabled: !!busy[`ev:${activeEvidence.id}`] || route?.locked, onClick: () => void decideEvidence(activeEvidence, "rejected") }, busy[`ev:${activeEvidence.id}`] ? "提交中…" : "无法确认"),
            h("button", { className: "sw-mini-btn", disabled: !!busy[`ev:${activeEvidence.id}`] || route?.locked, onClick: () => void saveCorrection(activeEvidence, correctionFor?.value ?? "") }, busy[`ev:${activeEvidence.id}`] ? "提交中…" : "修正"),
            h("button", { className: "sw-mini-btn", "data-primary": true, disabled: !!busy[`ev:${activeEvidence.id}`] || route?.locked, onClick: () => void decideEvidence(activeEvidence, "confirmed") }, busy[`ev:${activeEvidence.id}`] ? "提交中…" : "确认通过"),
            h("button", { className: "sw04-review-next", disabled: !stepEvidence.some((row) => row.reviewStatus === "pending" && row.id !== activeEvidence.id), onClick: () => {
              const next = stepEvidence.find((row) => row.reviewStatus === "pending" && row.id !== activeEvidence.id);
              if (next) {
                setSelectedEvidenceId(next.id);
                setCorrectionFor(null);
              }
            }, title: "跳到下一条待审核事实" }, "下一条待审核")
          )
        )
      )
    ) : null,
    h(KetcherEditorModal, { entry: ketcherModal, onSave: (smiles) => void saveKetcherSmiles(smiles), onCancel: () => setKetcherModal(null) })
  );
}

// client/src/components-characterization.js
var import_react6 = __toESM(require("react"), 1);
var labels = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败" };
var localDate = () => {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function CharacterizationPanel({ projectId, call, onSubmitTask, nmrRows = [] }) {
  const [tasks, setTasks] = (0, import_react6.useState)([]), [plots, setPlots] = (0, import_react6.useState)([]), [form, setForm] = (0, import_react6.useState)(null), [error, setError] = (0, import_react6.useState)(""), [busy, setBusy] = (0, import_react6.useState)(false), [notice, setNotice] = (0, import_react6.useState)("");
  const lock = (0, import_react6.useRef)(false);
  const refresh = async () => {
    const [a, b] = await Promise.all([call("characterization_list", { request: { projectId } }), call("plot_records_list", { request: { projectId } })]);
    setTasks(a.tasks || []);
    setPlots(b.records || []);
  };
  (0, import_react6.useEffect)(() => {
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
    kind === "nmr" ? h(import_react6.default.Fragment, null, fileButton(row, "spectrum", "核磁图", "mnova"), fileButton(row, "report", "报告", "word")) : fileButton(row, "origin", "绘图文件", "origin"),
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
    form ? h("section", { className: "ib-card ib-task-form", role: "dialog", "aria-label": "提交表征任务" }, h("h3", null, form.kind === "nmr" ? "提交核磁任务" : "提交绘图任务"), h("div", { className: "ib-form-grid" }, field("title", form.kind === "nmr" ? "名称" : "绘图主题"), field("date", "日期", "date"), h("label", { className: "ib-field" }, "上传数据文件（FID 目录请先压缩）", h("input", { type: "file", disabled: busy, onChange: upload })), field("inputPath", "课题目录内文件 / FID 目录路径"), form.kind === "nmr" ? h(import_react6.default.Fragment, null, field("compoundName", "化合物名称"), field("smiles", "结构 SMILES"), field("nucleus", "谱核"), field("deuteratedSolvent", "氘代溶剂")) : null), h("label", { className: "ib-field" }, "分析 / 绘图要求", h("textarea", { value: form.instructions, onChange: change("instructions") })), h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", disabled: busy, onClick: () => setForm(null) }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || !form.title.trim() || !form.inputPath.trim() || !form.instructions.trim(), onClick: () => void submit() }, busy ? "提交中…" : "提交任务"))) : null
  );
}
function PlotEdit({ row, call, onChanged, onError }) {
  const [topic, setTopic] = (0, import_react6.useState)(row?.topic || ""), [date, setDate] = (0, import_react6.useState)(row?.date || "");
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

// client/src/components-project.js
function CreateProject({ call, defaults, onCancel, onCreated }) {
  const [form, setForm] = (0, import_react8.useState)({ id: "", name: "", coreMarkdown: "# 核心课题\n\n## 研究问题\n\n## 核心假设\n\n## 预期目标\n\n## 当前进展\n- 项目建立" });
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const [error, setError] = (0, import_react8.useState)("");
  const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("项目编号请使用小写字母、数字和连字符，例如 polymer-prodrug-01");
      if (!form.name.trim()) throw new Error("请填写项目名称");
      if (!defaults.goal || !defaults.template) throw new Error("系统默认配置尚未就绪");
      const result = await call("projects_create", { request: { fields: { ...form, name: form.name.trim(), memoryChangeNote: "创建课题核心记忆", goalProfileId: defaults.goal.id, goalProfileVersion: defaults.goal.version, templateId: defaults.template.id, templateVersion: defaults.template.version } } });
      onCreated(result.project, result.presetId);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "建立新课题"), h("span", { className: "ib-chip" }, "从核心记忆开始")), h("div", { className: "ib-form-grid" }, h("div", { className: "ib-field" }, h("label", null, "项目编号（英文）"), h("input", { value: form.id, placeholder: "polymer-prodrug-01", onChange: field("id") })), h("div", { className: "ib-field" }, h("label", null, "项目名称"), h("input", { value: form.name, placeholder: "聚前药纳米递送课题", onChange: field("name") })), h("div", { className: "ib-field", "data-wide": true }, h("label", null, "核心课题 Markdown"), h("textarea", { value: form.coreMarkdown, onChange: field("coreMarkdown") }))), error ? h("div", { className: "ib-error" }, error) : null, h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void create() }, busy ? "创建中…" : "创建并进入")));
}
function Home({ call, onOpen, onLaunch, onOpenTemplates }) {
  const [state, setState] = (0, import_react8.useState)({ loading: true, projects: [], defaults: {}, error: "" });
  const [creating, setCreating] = (0, import_react8.useState)(false);
  const [launching, setLaunching] = (0, import_react8.useState)(null);
  const load = (0, import_react8.useCallback)(async () => {
    try {
      const [projects, goals, templates] = await Promise.all([call("projects_list"), call("goals_list"), call("templates_list")]);
      setState({ loading: false, projects: projects.projects || [], defaults: { goal: goals.goals.find((x) => x.id === "default-prodrug-polymer") || goals.goals[0], template: templates.templates.find((x) => x.id === "nature-default") || templates.templates[0] }, error: "" });
    } catch (reason) {
      setState({ loading: false, projects: [], defaults: {}, error: reason.message });
    }
  }, []);
  (0, import_react8.useEffect)(() => {
    void load();
  }, [load]);
  const launch = async (project, presetId) => {
    setLaunching(project.id);
    try {
      await onLaunch(project, { presetId });
    } catch (reason) {
      setState((previous) => ({ ...previous, error: reason.message }));
      setLaunching(null);
    }
  };
  return h("div", null, h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Research Projects"), h("h1", null, "选择一个课题继续"), h("p", null, "每个课题拥有独立的核心记忆、科研 Agent 对话和研究成果。创建课题后会自动打开专属工作区并开始科研 Agent 对话。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", onClick: onOpenTemplates }, "模板管理"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => setCreating(true) }, "+ 新建课题"))), creating ? h(CreateProject, { call, defaults: state.defaults, onCancel: () => setCreating(false), onCreated: (project, presetId) => void launch(project, presetId) }) : null, state.error ? h("div", { className: "ib-error" }, state.error) : null, state.loading ? h("div", { className: "ib-empty" }, "正在读取课题…") : state.projects.length ? h("div", { className: "ib-grid" }, state.projects.map((project) => h("button", { className: "ib-project", key: project.id, disabled: launching === project.id, onClick: () => onOpen(project) }, h("div", { className: "ib-project-icon" }, "PJ"), h("h2", null, project.name), h("p", null, launching === project.id ? "正在创建专属工作区并启动对话…" : "进入课题空间，继续对话、更新记忆或查询研究成果。"), h("div", { className: "ib-project-foot" }, h("span", null, `记忆 v${project.memoryVersion || "1"}`), h("span", null, when(project.updatedAt)))))) : h("div", { className: "ib-empty" }, "还没有课题。点击“新建课题”，先写下研究问题与目标。"));
}
function bundleIndex(bundles = []) {
  const index = {};
  for (const bundle of bundles) index[bundle.id] = bundle.title;
  return index;
}
function bundleRecordIndex(bundles = []) {
  const index = {};
  for (const bundle of bundles) index[bundle.id] = bundle;
  return index;
}
function LitPanel({ searches, reports, bundles, presentations, call, notify, onOpenSearch, onRequestArtifact, onChanged }) {
  const titleByBundle = bundleIndex(bundles);
  const bundleById = bundleRecordIndex(bundles);
  const presentationByReport = {};
  for (const item of (presentations || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!(item.reportId in presentationByReport)) presentationByReport[item.reportId] = item;
  }
  const [busy, setBusy] = (0, import_react8.useState)({});
  const [overview, setOverview] = (0, import_react8.useState)({});
  const [expandedSearch, setExpandedSearch] = (0, import_react8.useState)(null);
  const [machineReviews, setMachineReviews] = (0, import_react8.useState)({});
  const [preview, setPreview] = (0, import_react8.useState)(null);
  const [reviewVisible, setReviewVisible] = (0, import_react8.useState)(false);
  const [approval, setApproval] = (0, import_react8.useState)(null);
  const [captureHint, setCaptureHint] = (0, import_react8.useState)(null);
  const [browserMode, setBrowserMode] = (0, import_react8.useState)("managed-edge");
  const [opening, setOpening] = (0, import_react8.useState)({});
  (0, import_react8.useEffect)(() => {
    let alive = true;
    call("literature_status", { request: { force: false } }).then((result) => {
      if (alive && result?.browserMode) setBrowserMode(result.browserMode);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [call]);
  const desktopEdgeHandoff = window.parent !== window || browserMode === "desktop-edge-handoff";
  (0, import_react8.useEffect)(() => {
    const taskId = captureHint?.taskId;
    if (!taskId) return void 0;
    let disposed = false;
    let timer;
    const poll = async () => {
      try {
        const result = await call("manual_capture_get", { request: { taskId } });
        if (disposed) return;
        const task = result?.task;
        if (task?.status === "completed") {
          setCaptureHint(null);
          notify("文献捕获完成，文件已归档到课题，按钮已点亮");
          void onChanged();
          return;
        }
        if (["failed", "expired", "cancelled"].includes(task?.status)) {
          setCaptureHint(null);
          notify(`文献捕获失败：${task?.error || "任务未完成"}`);
          return;
        }
      } catch {
      }
      timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [captureHint?.taskId, call, onChanged]);
  const armCaptureFor = (event, bundle, kind) => {
    event.stopPropagation();
    const doiUrl = bundle.doi ? `https://doi.org/${encodeURIComponent(bundle.doi)}` : void 0;
    const sourcePublisherUrl = (() => {
      if (bundle.sourceType === "wechat" || !bundle.sourceUrl) return void 0;
      try {
        const url = new URL(bundle.sourceUrl);
        return url.protocol === "https:" ? url.href : void 0;
      } catch {
        return void 0;
      }
    })();
    const publisherUrl = doiUrl || sourcePublisherUrl;
    if (!publisherUrl) {
      notify("无法启动捕获：该文献未登记 DOI，也没有出版社页面（公众号条目不支持自动捕获）");
      return;
    }
    if (desktopEdgeHandoff) {
      void call("manual_capture_create", { request: { projectId: bundle.projectId, bundleId: bundle.id, kind } }).then(async (result) => {
        const task = result?.task;
        const token = task?.token;
        if (!task?.id || !token) throw new Error("创建捕获任务失败：响应缺少一次性令牌，请刷新后重试");
        const handoffUrl = `${location.origin}/lab/capture/?taskId=${encodeURIComponent(task.id)}#t=${encodeURIComponent(token)}`;
        await openInEdgeViaShell(handoffUrl);
        setCaptureHint({ bundleId: bundle.id, kind: task.kind, taskId: task.id });
        notify(`已布防捕获：将在 Microsoft Edge 中打开出版社页面，下载 ${task.kind === "pdf" ? "PDF" : "SI"} 后扩展会自动上传并点亮按钮`);
      }).catch((reason) => notify(reason.message || "创建捕获任务失败"));
      return;
    }
    notify("文献自动捕获仅支持 iBM Lab Agent Windows 桌面应用");
  };
  const markBusy = (key, value) => setBusy((old) => ({ ...old, [key]: value }));
  const run = async (key, work) => {
    if (busy[key]) return;
    markBusy(key, true);
    try {
      await work();
    } catch (reason) {
      notify(reason.message || "操作失败");
    } finally {
      markBusy(key, false);
    }
  };
  const risFor = (search) => run(`ris:${search.id}`, async () => {
    const result = await call("tasks_search_ris", { request: { runId: search.id } });
    const saved = await saveRis(result.ris.fileName, result.ris.text);
    if (saved.cancelled) {
      notify("已取消保存 RIS");
      return;
    }
    notify(`${saved.native ? "已保存" : "已开始下载"} ${result.ris.fileName}（${result.ris.count} 条文献）`);
  });
  const openOverview = (report) => run(`ov:${report.id}`, async () => {
    if (!(report.id in overview)) {
      const result = await call("tasks_overview", { request: { reportId: report.id } });
      setOverview((old) => ({ ...old, [report.id]: result.overview.summary }));
    } else {
      setOverview((old) => {
        const n = { ...old };
        delete n[report.id];
        return n;
      });
    }
  });
  const reviewPanel = (detail, title) => {
    if (!detail) return null;
    const findings = detail.findings || [];
    return h(
      "div",
      { className: "ib-review-detail" },
      h("div", { className: "ib-review-detail-head" }, h("b", null, title), h("span", null, detail.ok ? "未发现明显问题" : "提醒项（不阻断审核）")),
      findings.length ? h("div", { className: "ib-review-findings" }, findings.map((finding, index) => h("div", { className: "ib-review-finding", "data-level": finding.level || finding.severity, key: `${finding.code || "item"}-${index}` }, h("i", null, finding.level || finding.severity || "info"), h("span", null, `${finding.code ? `${finding.code}：` : ""}${finding.message || ""}`)))) : h("div", { className: "ib-lit-note" }, detail.summary?.summary || "暂无结构化评审条目。")
    );
  };
  const reviewContext = (target = preview) => target?.kind === "ppt" ? { key: `ppt:${target.presentation.id}`, request: { runId: target.presentation.id }, row: target.presentation } : { key: `report:${target.report.id}`, request: { reportId: target.report.id }, row: target?.report };
  const ensureMachineReview = async (target = preview) => {
    const context = reviewContext(target);
    if (machineReviews[context.key]) return machineReviews[context.key];
    let detail;
    try {
      const result = await call("tasks_review_details", { request: context.request });
      detail = result.review;
    } catch (reason) {
      detail = { ok: false, findings: [{ level: "warning", code: "SELF_CHECK_UNAVAILABLE", message: reason.message || "自动自查详情暂时不可用，请以人工检查为准。" }] };
    }
    setMachineReviews((old) => ({ ...old, [context.key]: detail }));
    return detail;
  };
  const openPreview = (target) => {
    const isPpt = target.kind === "ppt";
    const key = `${isPpt ? "open-ppt" : "open-report"}:${target.report.id}`;
    void run(key, async () => {
      const url = isPpt ? `/api/lab-artifacts?kind=ppt&reportId=${encodeURIComponent(target.report.id)}` : `/api/lab-artifacts?kind=report&format=docx&reportId=${encodeURIComponent(target.report.id)}`;
      const opened = await openOfficeArtifact(url);
      notify(opened.native ? `${isPpt ? "PPT" : "精读报告"} 已交给本机 Office/WPS 打开` : `${isPpt ? "PPT" : "精读报告"} 已下载`);
    });
  };
  const closePreview = () => {
    setPreview(null);
    setReviewVisible(false);
    setApproval(null);
  };
  const toggleMachineReview = () => {
    if (reviewVisible) {
      setReviewVisible(false);
      return;
    }
    const context = reviewContext();
    void run(`mr:${context.key}`, async () => {
      await ensureMachineReview();
      setReviewVisible(true);
    });
  };
  const downloadReport = (report) => run(`rep:${report.id}`, async () => {
    const saved = await downloadOfficeArtifact(`/api/lab-artifacts?kind=report&format=docx&reportId=${encodeURIComponent(report.id)}`);
    notify(saved.native ? `报告下载成功
保存位置：${saved.filePath || saved.fileName}` : `报告下载已开始：${saved.fileName}`);
  });
  const downloadPpt = (report) => run(`ppt:${report.id}`, async () => {
    const saved = await downloadOfficeArtifact(`/api/lab-artifacts?kind=ppt&reportId=${encodeURIComponent(report.id)}`);
    notify(saved.native ? `PPT 下载成功
保存位置：${saved.filePath || saved.fileName}` : `PPT 下载已开始：${saved.fileName}`);
  });
  const rejectArtifact = () => {
    const context = reviewContext();
    void run(`reject:${context.key}`, async () => {
      const note = window.prompt(preview.kind === "ppt" ? "请输入 PPT 退回修改意见（可留空）：" : "请输入报告退回修改意见（可留空）：", "");
      if (note === null) return;
      if (preview.kind === "ppt") await call("tasks_presentation_review", { request: { fields: { runId: preview.presentation.id, decision: "rejected", note } } });
      else await call("tasks_report_review", { request: { fields: { reportId: preview.report.id, decision: "rejected", note } } });
      notify(preview.kind === "ppt" ? "文献 PPT 已退回修改" : "精读报告已退回修改");
      await onChanged();
      closePreview();
    });
  };
  const beginApproval = () => {
    const context = reviewContext();
    void run(`approve-check:${context.key}`, async () => {
      const detail = await ensureMachineReview();
      setReviewVisible(true);
      setApproval({ stage: "confirm", detail });
    });
  };
  const confirmApproval = () => {
    const target = preview;
    const context = reviewContext(target);
    void run(`approve:${context.key}`, async () => {
      let updated;
      if (target.kind === "ppt") {
        const result = await call("tasks_presentation_review", { request: { fields: { runId: target.presentation.id, decision: "approved", note: "已在预览页人工确认自查提醒与分页版式" } } });
        updated = result.run;
        setPreview((old) => old ? { ...old, presentation: updated } : old);
      } else {
        const result = await call("tasks_report_review", { request: { fields: { reportId: target.report.id, decision: "approved", note: "已在预览页人工确认自查提醒与分页版式" } } });
        updated = result.report;
        setPreview((old) => old ? { ...old, report: updated } : old);
      }
      setApproval((old) => ({ ...old, stage: "approved" }));
      notify(target.kind === "ppt" ? "文献 PPT 已人工审阅通过，可立即下载" : "精读报告已人工审阅通过，可立即下载");
      await onChanged();
    });
  };
  const parseJournalCitation = (...values) => {
    const pattern = /\*?([A-Z][A-Za-z.&' -]*?)\*?\s+(\d+[A-Za-z]?)\s*[,：:]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)\s*(?:\((\d{4})\)|,\s*(\d{4}))/g;
    for (const value of values) {
      const matches = [...String(value || "").matchAll(pattern)];
      const match = matches.at(-1);
      if (!match) continue;
      const journal = match[1].trim();
      const pages = match[3].replace(/\s*[-–—]\s*/g, "–");
      const suffix = ` ${match[2]}, ${pages} (${match[4] || match[5]}).`;
      return { journal, suffix, text: `${journal}${suffix}` };
    }
    return null;
  };
  const citationOf = (report) => parseJournalCitation(report.shortCitation, titleByBundle[report.bundleId]);
  const shortOf = (report) => citationOf(report)?.text || report.shortCitation || titleByBundle[report.bundleId] || `精读报告 ${report.id.slice(0, 12)}`;
  const shortNode = (report) => {
    const citation = citationOf(report);
    return citation ? h(import_react7.default.Fragment, null, h("i", null, citation.journal), citation.suffix) : shortOf(report);
  };
  const zhOf = (report) => report.titleZh || shortOf(report);
  const paperCitation = (paper) => {
    const journal = paper.journal || paper.source || (paper.arxivId ? "arXiv" : "未知来源");
    const pages = paper.pages ? String(paper.pages).replace(/(\d)\s*-\s*(\d)/g, "$1–$2") : "";
    const bibliographic = `${paper.volume ? ` ${paper.volume}` : ""}${pages ? `${paper.volume ? ", " : " "}${pages}` : ""}${paper.year ? ` (${paper.year})` : ""}.`;
    const description = String(paper.shortDescriptionZh || "摘要待提炼").replace(/[（）()\s]/g, "").slice(0, 9);
    const target = paper.pdfUrl || paper.landingUrl || (paper.doi ? `https://doi.org/${paper.doi}` : void 0);
    const doiUrl = paper.doi ? `https://doi.org/${encodeURIComponent(paper.doi)}` : paper.landingUrl || paper.pdfUrl || void 0;
    const pdfReady = !!paper.localPdfUrl;
    const siReady = !!paper.localSiUrl;
    const openExternal = (event, url) => {
      event.stopPropagation();
      if (url) void openExternalUrl(url).catch((reason) => notify(reason.message));
    };
    const saveFile = (event, url) => {
      event.stopPropagation();
      void downloadVerifiedBinary(url).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message));
    };
    const searchKey = paper.doi || paper.pmid || paper.arxivId || paper.id || paper.title;
    const searchOpenKey = (kind) => `${kind}:search:${searchKey}`;
    const openSearchInEdge = (event, kind, url) => {
      event.stopPropagation();
      if (opening[searchOpenKey(kind)]) return;
      setOpening((old) => ({ ...old, [searchOpenKey(kind)]: true }));
      void openPdfPreview(url).catch((reason) => notify(`无法打开${kind === "pdf" ? "正文 PDF" : "SI PDF"}：${reason?.message ?? reason}`)).finally(() => setOpening((old) => {
        const next = { ...old };
        delete next[searchOpenKey(kind)];
        return next;
      }));
    };
    return h(
      "article",
      { className: "ib-search-paper", key: paper.doi || paper.pmid || paper.arxivId || paper.id || paper.title },
      h("div", { className: "ib-search-citation" }, h("i", null, journal), bibliographic, h("span", null, `（${description}）`), target ? h("a", { href: target, target: "_blank", rel: "noopener noreferrer", onClick: (event) => event.stopPropagation() }, paper.pdfUrl ? "PDF" : "原文") : null),
      h("small", { title: paper.title }, paper.title),
      h(
        "div",
        { className: "ib-search-actions" },
        h("button", { className: "ib-icon-btn", "data-ready": pdfReady ? "true" : "false", "data-opening": opening[searchOpenKey("pdf")] ? "true" : void 0, disabled: !!opening[searchOpenKey("pdf")], title: opening[searchOpenKey("pdf")] ? "正在打开正文 PDF…" : pdfReady ? "在外部 Microsoft Edge 中打开正文 PDF" : "未提交 PDF · 点击前往 DOI 页面", onClick: (event) => pdfReady ? openSearchInEdge(event, "pdf", paper.localPdfUrl) : openExternal(event, doiUrl), "aria-label": "PDF 原文" }, h(BookSvg, null)),
        h("button", { className: "ib-icon-btn", "data-ready": siReady ? "true" : "false", "data-opening": opening[searchOpenKey("si")] ? "true" : void 0, disabled: !!opening[searchOpenKey("si")], title: opening[searchOpenKey("si")] ? "正在打开 SI PDF…" : siReady ? paper.localSiIsPdf ? "在外部 Microsoft Edge 中打开 SI PDF" : "下载 SI 补充材料" : "未提交 SI · 点击前往 DOI 页面", onClick: (event) => siReady ? paper.localSiIsPdf ? openSearchInEdge(event, "si", paper.localSiUrl) : saveFile(event, paper.localSiUrl) : openExternal(event, doiUrl), "aria-label": "SI 补充材料" }, h(SiSvg, null))
      )
    );
  };
  const previewRow = preview?.kind === "ppt" ? preview?.presentation : preview?.report;
  const previewContext = preview ? reviewContext(preview) : null;
  const previewDetail = previewContext ? machineReviews[previewContext.key] : null;
  const previewApproved = previewRow?.review?.status === "approved";
  const downloadPreviewArtifact = () => preview?.kind === "ppt" ? downloadPpt(preview.report) : downloadReport(preview.report);
  const approvalNode = approval ? h(
    "div",
    { className: "ib-approval-shade" },
    h(
      "section",
      { className: "ib-approval-card", role: approval.stage === "approved" ? "status" : "alertdialog", "aria-label": approval.stage === "approved" ? "审核通过" : "审核通过二次确认" },
      approval.stage === "approved" ? h(
        import_react7.default.Fragment,
        null,
        h("div", { className: "ib-approval-ok" }, h("strong", null, "审核通过"), h("span", null, `${preview?.kind === "ppt" ? "PPTX" : "DOCX"} 已开放下载；你也可以关闭此页面后继续在预览窗口下载。`)),
        h(
          "div",
          { className: "ib-approval-actions" },
          h("button", { className: "ib-preview-btn", onClick: () => setApproval(null) }, "返回预览"),
          h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[preview?.kind === "ppt" ? `ppt:${preview?.report.id}` : `rep:${preview?.report.id}`], onClick: () => void downloadPreviewArtifact() }, preview?.kind === "ppt" ? "下载PPT" : "下载DOCX")
        )
      ) : h(
        import_react7.default.Fragment,
        null,
        h("h3", null, "审核通过前请确认自查提醒"),
        h("p", null, "自动自查仅供参考，不构成通过门限。请结合上方实际分页预览人工判断；点击确认后将锁定当前文件版本并开放下载。"),
        reviewPanel(approval.detail, preview?.kind === "ppt" ? "PPT 自动自查提醒" : "报告自动自查提醒"),
        h(
          "div",
          { className: "ib-approval-actions" },
          h("button", { className: "ib-preview-btn", onClick: () => setApproval(null) }, "返回继续检查"),
          h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[`approve:${previewContext?.key}`], onClick: confirmApproval }, busy[`approve:${previewContext?.key}`] ? "提交中…" : "二次确认并通过")
        )
      )
    )
  ) : null;
  const previewNode = preview ? h(
    import_react7.default.Fragment,
    null,
    h("div", { className: "ib-preview-backdrop", onClick: closePreview }),
    h(
      "aside",
      { className: "ib-preview-drawer", role: "dialog", "aria-modal": "true", "aria-label": preview.kind === "ppt" ? "PPT 人工审核预览" : "DOCX 人工审核预览" },
      h(
        "div",
        { className: "ib-preview-head" },
        h("div", { className: "ib-preview-title" }, h("b", null, preview.kind === "ppt" ? `${shortOf(preview.report)} · 文献汇报 PPT` : `${shortOf(preview.report)} · 精读报告`), h("small", null, preview.kind === "ppt" ? "实际 PPTX 经 LibreOffice 渲染的分页预览" : "实际 DOCX 经 LibreOffice 渲染的分页预览")),
        h("span", { className: "ib-preview-state" }, statusOf(previewRow)),
        h("button", { className: "ib-preview-btn", onClick: closePreview, "aria-label": "关闭预览" }, "关闭")
      ),
      h("iframe", { className: "ib-preview-frame", title: preview.kind === "ppt" ? "PPT 分页预览" : "Word 分页预览", src: `/api/lab-artifacts?preview=1&kind=${preview.kind === "ppt" ? "ppt" : "report"}&format=docx&reportId=${encodeURIComponent(preview.report.id)}&v=${encodeURIComponent(previewRow?.artifactSha256 || previewRow?.updatedAt || "current")}` }),
      reviewVisible ? h("div", { className: "ib-preview-review" }, reviewPanel(previewDetail, preview.kind === "ppt" ? "PPT 自动自查提醒（仅供参考）" : "报告自动自查提醒（仅供参考）")) : null,
      h(
        "div",
        { className: "ib-preview-foot" },
        h("div", { className: "ib-preview-foot-note" }, previewRow?.status === "under-review" ? "请逐页检查内容与版式；审核通过时会先弹出自查提醒供二次确认。" : previewApproved ? "该版本已人工审核通过，可在此直接下载原文件。" : "该版本已退回，Agent 修订并重新暂存后可再次审核。"),
        h("button", { className: "ib-preview-btn", disabled: busy[`mr:${previewContext?.key}`], onClick: toggleMachineReview }, busy[`mr:${previewContext?.key}`] ? "加载中…" : reviewVisible ? "收起提醒" : "自查提醒"),
        h("button", { className: "ib-preview-btn", disabled: !previewApproved || busy[preview.kind === "ppt" ? `ppt:${preview.report.id}` : `rep:${preview.report.id}`], onClick: () => void downloadPreviewArtifact(), title: previewApproved ? "下载已人工审核的原文件" : "人工审核通过后开放下载" }, preview.kind === "ppt" ? "下载PPT" : "下载DOCX"),
        previewRow?.status === "under-review" ? h("button", { className: "ib-preview-btn", "data-danger": true, disabled: busy[`reject:${previewContext?.key}`], onClick: rejectArtifact }, "退回修改") : null,
        previewRow?.status === "under-review" ? h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[`approve-check:${previewContext?.key}`], onClick: beginApproval }, busy[`approve-check:${previewContext?.key}`] ? "读取自查…" : "审核通过") : null
      ),
      approvalNode
    )
  ) : null;
  return h(import_react7.default.Fragment, null, h(
    "div",
    { className: "ib-lit" },
    // ── 左：文献检索 ──
    h(
      "section",
      { className: "ib-lit-col" },
      h("div", { className: "ib-lit-head" }, h("h3", null, "文献检索"), h("small", null, `${searches.length} 条记录`)),
      h("div", { className: "ib-lit-note" }, "每个会话汇总为一个检索条目和一个 RIS；“检索”可展开本会话全部去重文献，点击条目可回到原对话。"),
      searches.length ? h("div", { className: "ib-lit-list" }, searches.slice().reverse().map((search) => h(
        "div",
        { key: search.id },
        h(
          "div",
          { className: "ib-lit-row", "data-clickable": search.sessionId ? "true" : void 0, onClick: search.sessionId ? () => onOpenSearch(search.sessionId) : void 0, title: search.sessionId ? "跳转到检索对话" : "该检索未记录会话" },
          h("div", { className: "ib-lit-main" }, h("b", null, search.title || search.query || search.id), h("small", null, `${(search.results || []).length} 篇 · ${(search.queries || [search.query]).filter(Boolean).length} 轮查询 · OA ${(search.results || []).filter((row) => row.isOa === true).length} · ${(search.sources || []).join("/") || "未知来源"}${(search.sourceFailures || []).length ? ` · ${search.sourceFailures.length} 个源降级` : ""} · ${when(search.updatedAt || search.createdAt)}`)),
          h(
            "div",
            { className: "ib-lit-acts" },
            h("button", { className: "ib-lit-btn ok", disabled: !(search.results || []).length, onClick: (event) => {
              event.stopPropagation();
              setExpandedSearch((value) => value === search.id ? null : search.id);
            } }, expandedSearch === search.id ? "收起" : "检索"),
            h("button", { className: "ib-lit-btn ok", disabled: busy[`ris:${search.id}`] || !(search.results || []).length, onClick: (event) => {
              event.stopPropagation();
              void risFor(search);
            } }, busy[`ris:${search.id}`] ? "…" : ".ris")
          )
        ),
        expandedSearch === search.id ? h("div", { className: "ib-search-results", role: "list", "aria-label": `${search.title || "检索"}的全部文献` }, (search.results || []).map(paperCitation)) : null
      ))) : h("div", { className: "ib-lit-empty" }, "对话中的文献检索结果会按会话整理到这里。")
    ),
    // ── 右：文献精读 ──
    h(
      "section",
      { className: "ib-lit-col" },
      h("div", { className: "ib-lit-head" }, h("h3", null, "文献精读"), h("small", null, `${reports.length} 篇`)),
      h("div", { className: "ib-lit-note" }, "未获取原文时点击灰色 PDF/SI 按钮：自动打开 DOI 出版社页面并布防捕获，下一次下载会归档到本课题（需安装 iBM 文献捕获扩展）；公众号条目仅支持 DOI 出版社页面，不显示公众号链接。"),
      reports.length ? h(
        "div",
        { className: "ib-lit-list" },
        reports.map((report) => {
          const presentation = presentationByReport[report.id];
          const bundle = bundleById[report.bundleId] || {};
          const awaitingPdf = bundle.acquisitionStatus === "awaiting-pdf";
          const publisherUrl = bundle.doi ? `https://doi.org/${encodeURIComponent(bundle.doi)}` : (() => {
            if (bundle.sourceType === "wechat" || !bundle.sourceUrl) return void 0;
            try {
              const url = new URL(bundle.sourceUrl);
              return url.protocol === "https:" ? url.href : void 0;
            } catch {
              return void 0;
            }
          })();
          const bundlePdfUrl = bundle.pdfPath && /\.pdf$/i.test(bundle.pdfPath) ? `/api/lab-artifacts?kind=pdf&bundleId=${encodeURIComponent(bundle.id)}` : void 0;
          const bundleSiUrl = bundle.siPath ? `/api/lab-artifacts?kind=si&bundleId=${encodeURIComponent(bundle.id)}` : void 0;
          const bundleSiIsPdf = !!bundle.siPath;
          const openKey = (kind) => `${kind}:${report.id}`;
          const openEntryInEdge = (event, kind, url) => {
            event.stopPropagation();
            if (opening[openKey(kind)]) return;
            setOpening((old) => ({ ...old, [openKey(kind)]: true }));
            void openPdfPreview(url).catch((reason) => notify(`无法打开${kind === "pdf" ? "正文 PDF" : "SI PDF"}：${reason?.message ?? reason}`)).finally(() => setOpening((old) => {
              const next = { ...old };
              delete next[openKey(kind)];
              return next;
            }));
          };
          const downloadBundleFile = (event, url) => {
            event.stopPropagation();
            void downloadVerifiedBinary(url).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message));
          };
          const captureActive = captureHint?.bundleId === bundle.id;
          const metadata = [
            (bundle.authors || []).length ? bundle.authors.join(", ") : null,
            bundle.journal,
            bundle.year,
            bundle.doi ? `DOI ${bundle.doi}` : null
          ].filter(Boolean).join(" · ");
          const artifactState = awaitingPdf ? `${metadata || "元数据已登记"} · 待上传 PDF` : `${metadata ? `${metadata} · ` : ""}DOCX${report.docxPath ? "已生成" : "待生成"}${presentation ? ` · PPT${presentation.pptxPath ? "已生成" : "生成中"}` : ""}`;
          const paperName = report.titleZh || bundle.title || zhOf(report) || report.id;
          const readingPrompt = `请精读文献「${paperName}」（bundleId: ${report.bundleId || bundle.id || "未登记"}，reportId: ${report.id}）。先读取本课题已归档的 PDF/SI 和当前阅读笔记模板，按模板完成精读报告，并调用 lab_tasks_register_report 登记到该 reportId。`;
          const pptPrompt = `请为文献「${paperName}」（reportId: ${report.id}）制作汇报 PPT。先读取已归档 PDF/SI、已有精读报告和当前 PPT 模板，按模板生成 PPTX，并调用 lab_tasks_register_presentation 登记。`;
          return h(
            "div",
            { key: report.id, onClick: report.id in overview ? () => setOverview((old) => {
              const n = { ...old };
              delete n[report.id];
              return n;
            }) : void 0 },
            h(
              "div",
              { className: "ib-lit-row", "data-waiting": awaitingPdf ? "true" : void 0 },
              h("div", { className: "ib-lit-main" }, h("b", { title: report.titleZh || bundle.title || zhOf(report) }, shortNode(report)), h("small", null, `${artifactState} · ${when(report.createdAt)}`)),
              h(
                "div",
                { className: "ib-lit-acts" },
                h("button", { className: "ib-icon-btn", "data-ready": bundlePdfUrl ? "true" : "false", "data-opening": opening[openKey("pdf")] ? "true" : void 0, disabled: !!opening[openKey("pdf")], title: opening[openKey("pdf")] ? "正在打开正文 PDF…" : bundlePdfUrl ? "在外部 Microsoft Edge 中打开正文 PDF" : publisherUrl ? "尚未获取 PDF · 点击前往论文出版社页面并自动捕获下载" : "尚未获取 PDF · 未登记 DOI/出版社页面", onClick: (event) => bundlePdfUrl ? openEntryInEdge(event, "pdf", bundlePdfUrl) : armCaptureFor(event, bundle, "pdf"), "aria-label": "PDF 原文" }, h(BookSvg, null)),
                h("button", { className: "ib-icon-btn", "data-ready": bundleSiUrl ? "true" : "false", "data-opening": opening[openKey("si")] ? "true" : void 0, disabled: !!opening[openKey("si")], title: opening[openKey("si")] ? "正在打开 SI PDF…" : bundleSiUrl ? bundleSiIsPdf ? "在外部 Microsoft Edge 中打开 SI PDF" : "下载 SI 补充材料" : publisherUrl ? "尚未获取 SI · 点击前往论文出版社页面并自动捕获下载" : "尚未获取 SI · 未登记 DOI/出版社页面", onClick: (event) => bundleSiUrl ? bundleSiIsPdf ? openEntryInEdge(event, "si", bundleSiUrl) : downloadBundleFile(event, bundleSiUrl) : armCaptureFor(event, bundle, "si"), "aria-label": "SI 补充材料" }, h(SiSvg, null)),
                h("button", { className: "ib-lit-btn ok", disabled: busy[`ov:${report.id}`], onClick: () => void openOverview(report) }, busy[`ov:${report.id}`] ? "…" : report.id in overview ? "收起概览" : "概览"),
                h("button", { className: `ib-lit-btn${report.docxPath ? " ok" : ""}`, "data-ready": report.docxPath ? "true" : "false", disabled: !!busy[`open-report:${report.id}`], onClick: () => report.docxPath ? openPreview({ kind: "report", report }) : onRequestArtifact(readingPrompt), title: report.docxPath ? "用本机 Office 或 WPS 打开精读报告" : "在当前课题工作区新建对话并预填精读任务" }, busy[`open-report:${report.id}`] ? "打开中…" : report.docxPath ? "打开精读" : "精读文献"),
                h("button", { className: `ib-lit-btn${presentation?.pptxPath ? " ok" : ""}`, "data-ready": presentation?.pptxPath ? "true" : "false", disabled: !!busy[`open-ppt:${report.id}`], onClick: () => presentation?.pptxPath ? openPreview({ kind: "ppt", report, presentation }) : onRequestArtifact(pptPrompt), title: presentation?.pptxPath ? "用本机 Office 或 WPS 打开 PPT" : "在当前课题工作区新建对话并预填 PPT 任务" }, busy[`open-ppt:${report.id}`] ? "打开中…" : presentation?.pptxPath ? "打开PPT" : "制作PPT")
              )
            ),
            captureActive ? h("div", { className: "ib-capture-hint" }, `已布防：等待下一次 ${captureHint.kind === "pdf" ? "PDF" : "SI"} 下载…`) : opening[openKey("pdf")] || opening[openKey("si")] ? h("div", { className: "ib-capture-hint" }, `正在在外部 Microsoft Edge 中打开${opening[openKey("pdf")] ? "正文 PDF" : "SI PDF"}…`) : null,
            report.id in overview ? h("div", { className: "ib-lit-overview" }, h("b", null, awaitingPdf ? "已提取的元数据摘要" : "文献概览（约 200 字）"), overview[report.id] ?? "加载中…") : null
          );
        })
      ) : h("div", { className: "ib-lit-empty" }, "尚无精读条目。可在对话中粘贴微信公众号文献链接先登记元数据，或完成报告生成后登记产物。")
    )
  ), previewNode);
}
function Project({ call, project, onBack, onDelete, onStartChat, onOpenSearch }) {
  const [state, setState] = (0, import_react8.useState)({ loading: true, data: null, error: "" });
  const [tab, setTab] = (0, import_react8.useState)("literature");
  const [draft, setDraft] = (0, import_react8.useState)("");
  const [memoryOpen, setMemoryOpen] = (0, import_react8.useState)(false);
  const memoryDirty = (0, import_react8.useRef)(false);
  const [note, setNote] = (0, import_react8.useState)("");
  const [saving, setSaving] = (0, import_react8.useState)(false);
  const [launching, setLaunching] = (0, import_react8.useState)(false);
  const [deleting, setDeleting] = (0, import_react8.useState)(false);
  const [toast, setToast] = (0, import_react8.useState)("");
  const load = (0, import_react8.useCallback)(async () => {
    try {
      const data2 = await call("projects_workspace", { request: { projectId: project.id } });
      setState({ loading: false, data: data2, error: "" });
      setDraft((current) => memoryDirty.current ? current : data2.memory?.markdown || "");
    } catch (reason) {
      setState({ loading: false, data: null, error: reason.message });
    }
  }, [project.id]);
  (0, import_react8.useEffect)(() => {
    memoryDirty.current = false;
    try {
      const cached = sessionStorage.getItem(`ib-memory-draft:${project.id}`);
      if (cached !== null) {
        memoryDirty.current = true;
        setDraft(cached);
      }
    } catch {
    }
    setMemoryOpen(false);
    void load();
  }, [load]);
  (0, import_react8.useEffect)(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => setToast(""), 7e3);
    return () => clearTimeout(timer);
  }, [toast]);
  const save = async () => {
    setSaving(true);
    try {
      const result = await call("projects_memory_update", { request: { fields: { projectId: project.id, markdown: draft, changeNote: note } } });
      setToast(`核心记忆已提交为 v${result.memory.version}`);
      setNote("");
      memoryDirty.current = false;
      try {
        sessionStorage.removeItem(`ib-memory-draft:${project.id}`);
      } catch {
      }
      await load();
    } catch (reason) {
      setToast(reason.message);
    } finally {
      setSaving(false);
    }
  };
  const startChat = async () => {
    if (!state.data) return;
    setLaunching(true);
    try {
      await onStartChat(state.data.project, { memory: state.data.memory, presetId: state.data.presetId });
    } catch (reason) {
      setToast(reason.message);
      setLaunching(false);
    }
  };
  const startTaskChat = async (prompt, autoSubmit = false) => {
    if (!state.data || launching) throw new Error("会话正在启动，请稍后重试");
    setLaunching(true);
    try {
      await onStartChat(state.data.project, { memory: state.data.memory, presetId: state.data.presetId, prompt, autoSubmit });
    } catch (reason) {
      setToast(reason.message);
      setLaunching(false);
      throw reason;
    }
  };
  const remove = async () => {
    if (!state.data) return;
    const accepted = window.confirm(`确定彻底删除课题「${state.data.project.name}」吗？

将删除课题记录、关联任务、Harness 工作区注册和工作区目录中的全部文件。此操作不可恢复。`);
    if (!accepted) return;
    setDeleting(true);
    try {
      await onDelete(state.data.project);
      onBack();
    } catch (reason) {
      setToast(`删除失败：${reason?.message ?? reason}`);
      setDeleting(false);
    }
  };
  if (state.loading) return h("div", { className: "ib-empty" }, "正在打开课题空间…");
  if (!state.data) return h("div", { className: "ib-empty" }, state.error, h("div", { style: { marginTop: 12 } }, h("button", { className: "ib-btn", onClick: onBack }, "返回")));
  const data = state.data;
  const literature = data.literature || {};
  const planning = data.planning || {};
  const characterization = data.characterization || {};
  const meta = { literature: ["文献资料", "左侧检索记录 · 右侧精读档案与下载"], planning: ["研究设计", "工作规划、实验方案与合成路线"], characterization: ["表征分析", "NMR 等结构表征和审核结果"] };
  return h(
    "div",
    null,
    h("div", { className: "ib-project-head" }, h("button", { className: "ib-btn", onClick: () => {
      onBack();
    } }, "← 所有课题"), h("div", { className: "ib-project-copy" }, h("h1", null, data.project.name), h("p", null, `项目编号 ${data.project.id} · 核心记忆 v${data.project.memoryVersion}`)), h("button", { className: "ib-btn", "aria-expanded": memoryOpen, onClick: () => setMemoryOpen(!memoryOpen) }, "核心记忆"), h("button", { className: "ib-btn", "data-danger": true, disabled: deleting || launching, onClick: () => void remove() }, deleting ? "正在删除…" : "删除课题"), h("button", { className: "ib-btn ib-agent", "data-primary": true, disabled: deleting || launching, onClick: () => void startChat() }, h("span", { className: "ib-spark" }, "✦"), launching ? "正在启动…" : "开始科研 Agent 对话")),
    memoryOpen ? h("div", { className: "ib-memory-drawer", role: "dialog", "aria-label": "核心记忆" }, h("button", { className: "ib-btn ib-memory-close", onClick: () => setMemoryOpen(false) }, "收起（保留编辑）"), h("section", { className: "ib-card" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "课题核心记忆.md"), h("span", { className: "ib-chip" }, `当前 v${data.memory?.version || "—"}`)), h("textarea", { value: draft, spellCheck: false, onChange: (event) => {
      memoryDirty.current = true;
      setDraft(event.target.value);
      try {
        sessionStorage.setItem(`ib-memory-draft:${project.id}`, event.target.value);
      } catch {
      }
    } }), h("div", { className: "ib-save" }, h("input", { value: note, placeholder: "本次修改说明，例如：补充第二阶段实验结果", onChange: (event) => setNote(event.target.value) }), h("button", { className: "ib-btn", "data-primary": true, disabled: saving || draft === data.memory?.markdown, onClick: () => void save() }, saving ? "提交中…" : "提交新版本"))), h("aside", { className: "ib-card ib-help" }, h("strong", null, "这份 Markdown 有什么用？"), "它是该课题的长期核心记忆。科研 Agent 会读取已提交的版本。未提交的编辑会保留在当前窗口，返回后可继续修改。", h("div", { className: "ib-history" }, (data.memoryHistory || []).slice(0, 6).map((version) => h("div", { className: "ib-version", key: version.id }, h("span", null, h("b", null, `v${version.version}`), ` · ${version.changeNote}`), h("span", null, when(version.createdAt))))))) : null,
    h("div", { className: "ib-tabs" }, Object.entries(meta).map(([id, copy]) => h("button", { className: "ib-tab", "data-active": tab === id ? "true" : void 0, key: id, onClick: () => setTab(id) }, h("strong", null, copy[0]), h("span", null, copy[1])))),
    h("section", { className: "ib-board" }, h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, meta[tab][0]), h("p", null, meta[tab][1])), h("button", { className: "ib-btn", onClick: () => void load() }, "刷新")), tab === "literature" ? h("div", null, h(DatabaseOverview, { call, notify: setToast }), h(LitPanel, { searches: literature.searches || [], reports: literature.reports || [], bundles: literature.bundles || [], presentations: literature.presentations || [], call, notify: setToast, onOpenSearch, onRequestArtifact: startTaskChat, onChanged: load })) : null, tab === "planning" ? h(ResearchDesignWorkspace, { projectId: data.project.id, routes: planning.routes || [], targets: planning.targets || [], plans: planning.plans || [], call, notify: setToast, onRequestPlan: startTaskChat, onChanged: load }) : null, tab === "characterization" ? h(CharacterizationPanel, { key: data.project.id, projectId: data.project.id, call, nmrRows: characterization.nmr || [], onSubmitTask: (prompt) => startTaskChat(prompt, true) }) : null),
    toast ? h("div", { className: "ib-toast", role: "status", "aria-live": "polite" }, toast) : null
  );
}
var OverlayBoundary = class extends (import_react7.default.Component ?? class {
}) {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error && error.message ? error.message : String(error) };
  }
  componentDidCatch(error, info) {
    console.error("[dsh-lab-agent] overlay render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return h("div", { className: "ib-overlay" }, h("section", { className: "ib-card", style: { maxWidth: 620, margin: "16vh auto", padding: 24 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "面板渲染出错"), h("span", { className: "ib-chip" }, "可重试或返回")), h("pre", { style: { whiteSpace: "pre-wrap", color: "var(--ib-text)", background: "var(--ib-panel)", borderRadius: 10, padding: 12, fontSize: 10.5 } }, this.state.error), h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: () => this.props.onClose() }, "关闭"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => this.setState({ error: null }) }, "重试"))));
    }
    return this.props.children;
  }
};
function Panel({ call, onClose, onDeleteProject, onStartChat, onOpenSearch, initial }) {
  const [project, setProject] = (0, import_react8.useState)(initial ?? null);
  const [templates, setTemplates] = (0, import_react8.useState)(false);
  return import_react_dom.default.createPortal(h("div", { className: "ib-overlay" }, h("header", { className: "ib-top" }, h("div", { className: "ib-brand" }, h("div", { className: "ib-logo" }, h("img", { src: BRAND_ICON, alt: "iBM Lab Agent" })), h("div", null, h("strong", null, "iBM Lab Agent"), h("small", null, "Project Research Workspace"))), h("div", { className: "ib-crumb" }, templates ? h("span", null, "模板 ", h("b", null, "管理")) : project ? h("span", null, "课题 / ", h("b", null, project.name)) : h("b", null, "我的科研课题")), h("button", { className: "ib-btn", onClick: onClose }, "返回 Harness")), h("main", { className: "ib-main" }, templates ? h(Templates, { call, onBack: () => setTemplates(false) }) : project ? h(Project, { call, project, onBack: () => setProject(null), onDelete: onDeleteProject, onStartChat, onOpenSearch }) : h(Home, { call, onOpen: setProject, onLaunch: onStartChat, onOpenTemplates: () => setTemplates(true) }))), document.body);
}

// client/src/apply.js
function applyUi(ctx) {
  const syncDesktopTheme = () => {
    if (typeof requestAnimationFrame !== "function") return;
    return requestAnimationFrame(() => {
      if (window.parent === window) return;
      const style = getComputedStyle(document.body), tokens = {};
      for (const name of ["bg-base", "bg-layer-1", "bg-layer-2", "border-l2", "label-primary", "label-secondary", "brand-primary", "state-error-primary"]) {
        tokens[name] = style.getPropertyValue(`--dsw-alias-${name}`).trim();
      }
      window.parent.postMessage({ source: "ibm-lab-agent", type: "SYNC_THEME", requestId: "theme", payload: { tokens, dark: document.body.hasAttribute("data-ds-dark-theme") } }, "*");
    });
  };
  syncDesktopTheme();
  if (typeof MutationObserver === "function") {
    const themeObserver = new MutationObserver(syncDesktopTheme);
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["style", "data-ds-dark-theme"] });
    ctx.effect(() => () => themeObserver.disconnect(), "lab.theme-sync");
  }
  ctx.on?.("theme/change", syncDesktopTheme);
  const call = async (method, args) => {
    const payload = args && typeof args === "object" && Object.keys(args).length === 1 && "request" in args ? args.request : args;
    const result = payload === void 0 ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
    if (!result.ok) throw new Error(result.error?.message || result.error?.code || "remote call failed");
    return result.value;
  };
  let root = null;
  const close = () => {
    if (!root) return;
    const node = root;
    root = null;
    import_react_dom2.default.unmountComponentAtNode(node);
    node.remove();
  };
  const toast = (message) => {
    const node = document.createElement("div");
    node.className = "ib-toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 4500);
  };
  const promptFor = (project, memory) => {
    const fileRef = `课题工作区里的「项目记忆.md」`;
    const lines = [
      `当前课题为「${project.name}」（项目编号：${project.id}）。`,
      `请先读取 ${fileRef}（课题工作区根目录，当前版本 v${memory?.version || project.memoryVersion || "?"}）了解课题背景，再开始工作；后续产物归档到这个项目。如发现信息冲突，先向我确认。`,
      "",
      "开场请简短说明你已读取记忆、理解的课题背景，然后等待我的具体任务。"
    ];
    if (!memory?.markdown && !project.workspacePath) {
      lines.splice(1, 0, "", `<!-- project-memory:${project.id}@${project.memoryVersion} -->`, memory?.markdown || `# ${project.name}`);
    }
    return lines.join("\n");
  };
  const selectResearchPreset = async (sessionId, presetId) => {
    if (!presetId) return "ok（未配置科研预设，沿用会话默认）";
    try {
      const response = await ctx.connection.api.agentPresets.select({ sessionId, agentPreset: presetId });
      const result = response?.result ?? response;
      if (!result.ok) {
        const code = result.error?.code ?? "unknown";
        const detail = result.error?.message ?? "agentPresets.select 未返回 ok";
        if (code === "agent-preset-locked") {
          return `ok（复用已开始的会话，预设已固定，无法切换到 ${presetId}）`;
        }
        return `预设选择失败（${code}）：${detail}`;
      }
      return "ok";
    } catch (reason) {
      return `预设选择调用失败：${reason?.message ?? reason}`;
    }
  };
  const launchProject = async (project, opts = {}) => {
    const presetId = opts.presetId;
    let sessionId;
    let workspaceId;
    let openedNew = false;
    let presetApplied = "ok";
    const ensured = await call("projects_ensure_workspace", { request: { projectId: project.id } });
    project = { ...project, workspacePath: ensured.path };
    const bound = (await call("projects_binding", { request: { projectId: project.id } })).binding ?? null;
    const wsSnapshot = ctx.workspaces.list.getSnapshot();
    const hasWorkspace = (id) => (wsSnapshot.items ?? []).some((item) => item.workspaceId === id);
    if (bound?.workspaceId && hasWorkspace(bound.workspaceId)) {
      workspaceId = bound.workspaceId;
    } else {
      const ws = await ctx.workspaces.create({ path: project.workspacePath });
      workspaceId = ws.workspaceId;
      try {
        await ctx.workspaces.rename(workspaceId, project.name);
      } catch (reason) {
        console.warn("dsh-lab-agent: workspace rename failed", reason);
      }
      await call("projects_bind_workspace", { request: { projectId: project.id, workspaceId } });
    }
    sessionId = await ctx.workspaces.connectWorkspace(workspaceId);
    openedNew = true;
    presetApplied = await selectResearchPreset(sessionId, presetId);
    await call("projects_bind_session", { request: { projectId: project.id, sessionId, workspaceId } });
    ctx.sessions.open(sessionId);
    const actx = ctx.sessions.scope(sessionId);
    if (!actx) throw new Error("科研 Agent 会话尚未就绪，请稍后重试");
    const prompt = String(opts.prompt || "").trim() || promptFor(project, opts.memory);
    if (opts.autoSubmit) await actx.get("conversation").send(prompt);
    else ctx.conversation.input.for(actx).setDraft(prompt);
    close();
    if (presetApplied !== "ok") toast(`⚠️ ${presetApplied}`);
    return { sessionId, workspaceId, openedNew, presetApplied };
  };
  const deleteProject = async (project) => {
    const binding = (await call("projects_binding", { request: { projectId: project.id } })).binding ?? null;
    if (binding?.workspaceId) {
      const registered = (ctx.workspaces.list.getSnapshot().items ?? []).some((item) => item.workspaceId === binding.workspaceId);
      if (registered) await ctx.workspaces.delete(binding.workspaceId);
    }
    return await call("projects_delete", { request: { projectId: project.id } });
  };
  const open = (initial) => {
    if (root) return;
    root = document.createElement("div");
    document.body.appendChild(root);
    try {
      import_react_dom2.default.render(h(OverlayBoundary, { onClose: close }, h(Panel, { call, onClose: close, onDeleteProject: deleteProject, onStartChat: launchProject, onOpenSearch: (sessionId) => {
        close();
        try {
          ctx.sessions.open(sessionId);
        } catch (reason) {
          toast(reason.message || "无法打开该会话");
        }
      }, initial: initial ?? null })), root);
    } catch (reason) {
      console.error("[dsh-lab-agent] overlay mount failed:", reason);
      close();
      toast(`面板加载失败：${reason?.message ?? reason}`);
    }
  };
  const openWorkspace = (project) => open(project);
  const disposeBranding = applyBranding(() => open());
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: "lab-project-badge", order: 10 }, (props) => h(ProjectBadge, { ...props, call, openWorkspace })), "dsh-lab-agent: project badge");
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({ name: "conversation.input.left", id: "lab-project-file-upload", order: 40 }, (props) => h(ResearchFileUpload, { ...props, call, toast })), "dsh-lab-agent: research file upload");
  ctx.on("dispose", () => {
    if (disposeBranding) disposeBranding();
    close();
  });
}
async function apply(ctx) {
  await ctx.remote.$mount({ package: "dsh-lab-agent", descriptors: buildDescriptors() });
  ctx.inject(["remote", "remote.lab", "slots", "sessions", "workspaces", "conversation", "connection"], applyUi);
}

// client/src/entry.js
injectStyles();
var inject = ["remote"];
exports.apply = apply; exports.inject = inject; return module.exports; } });
