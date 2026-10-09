import { useEffect, useState } from "react";
import { h } from "./h.js";
import { Templates } from "./components-templates.js";
import { normalizePetQuotes } from "../../src/runtime/pet-quotes.js";

const providers = { core: "课题与记忆", runtime: "科研运行时", documents: "文档与模板", literature: "文献工作流", design: "实验设计", analysis: "科研分析", experimentTemplates: "实验计划模板", scientificDesktop: "科研浏览器与文件操作" };

function Diagnostics({ call }) {
 const [report, setReport] = useState(null);
 const [busy, setBusy] = useState(false);
 const refresh = async () => {
  setBusy(true);
  try {
   const methods = ["capabilities", "runtime_environment", "convert_available", "desktop_status", "versions_list"];
   const results = await Promise.allSettled(methods.map(method => call(method)));
   setReport({ checkedAt: new Date().toISOString(), checks: Object.fromEntries(results.map((result, i) => [methods[i], result.status === "fulfilled" ? { ok: true, value: result.value } : { ok: false, error: result.reason?.message ?? String(result.reason) }])) });
  } finally { setBusy(false); }
 };
 useEffect(() => { void refresh(); }, [call]);
 const checks = report?.checks;
 const runtime = checks?.runtime_environment?.value;
 const exportReport = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `ibm-plugin-diagnostics-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
 };
 return h("div", { "data-ibm-diagnostics": true },
  h("p", null, "检查已启用的服务与本机运行环境。单项失败不影响其余检查；报告包含软件版本和本机路径。"),
  h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", disabled: busy, onClick: refresh }, busy ? "检查中…" : "重新检查"), h("button", { className: "ib-btn", disabled: busy || !report, onClick: exportReport }, "导出插件诊断")),
  report ? h("small", null, `检查时间：${new Date(report.checkedAt).toLocaleString()}`) : null,
  checks?.capabilities?.ok ? h("div", { className: "ib-card" }, h("h3", null, "服务状态"), Object.entries(providers).map(([key, label]) => h("div", { className: "ib-row", key }, h("b", null, label), h("span", null, checks.capabilities.value[key] ? "已启用" : "未启用")))) : null,
  runtime ? h("div", { className: "ib-card" }, h("h3", null, "运行环境"), ["python", "node", "soffice"].map(key => h("div", { key, className: "ib-settings-runtime" }, h("b", null, key === "soffice" ? "Office PDF 渲染（LibreOffice）" : key === "python" ? "Python" : "Node.js"), h("span", null, runtime[key]?.available ? `可用 ${runtime[key].version ?? ""}` : "不可用"), h("small", null, runtime[key]?.command || runtime[key]?.hint || "未找到可执行文件"))), ...(runtime.warnings ?? []).map((text, i) => h("p", { key: i }, text))) : null,
  checks?.convert_available?.ok ? h("div", { className: "ib-card" }, h("h3", null, "文档转换"), h("span", null, checks.convert_available.value.available ? "MarkItDown 可用" : "MarkItDown 不可用")) : null,
  Object.entries(checks ?? {}).filter(([, row]) => !row.ok).map(([key, row]) => h("div", { className: "ib-error", key, role: "alert" }, `${key}：${row.error}`)),
  report ? h("details", null, h("summary", null, "查看诊断详情与版本登记"), h("pre", null, JSON.stringify(report, null, 2))) : null);
}

function DesktopPetSettings({call}) {
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [quoteText,setQuoteText]=useState(''),[message,setMessage]=useState('');
 const change=async(input={},syncQuotes=false)=>{
  setBusy(true);setError('');setMessage('');
  try{
   const value=await call('desktop_pet',input);setState(value);
   if(syncQuotes)setQuoteText((value.quotes??[]).join('\n'));
   if(input.quotes)setMessage(`已保存 ${value.quotes.length} 条语录`);
  }catch(reason){setError(reason.message);}finally{setBusy(false);}
 };
 useEffect(()=>{void change({},true);},[call]);
 return h('div',{'data-ibm-pet-settings':true},
  h('h3',null,'科研桌面宠物'),
  h('p',null,'使用 iBM 人像 Logo 显示当前任务阶段。单击头像随机显示语录，拖动头像调整位置。'),
  h('button',{className:'ib-btn',disabled:busy||!state,onClick:()=>void change({visible:!state.visible})},state?.visible?'隐藏桌面宠物':'显示桌面宠物'),
  h('div',{className:'ib-card'},
   h('h3',null,'宠物语录'),
   h('div',{className:'ib-field'},
    h('label',{htmlFor:'ibm-pet-quotes'},'语录内容（每行一条）'),
    h('textarea',{id:'ibm-pet-quotes',rows:6,value:quoteText,disabled:busy||!state,placeholder:'在这里添加语录，每行一条',onChange:event=>{setQuoteText(event.target.value);setMessage('');}})),
   h('p',null,'保存后立即生效。空行和重复语录会自动忽略；清空后保存可移除全部语录。'),
   h('button',{className:'ib-btn','data-primary':true,disabled:busy||!state,onClick:()=>void change({quotes:normalizePetQuotes(quoteText.split(/\r\n|\r|\n/))},true)},busy?'处理中…':'保存语录'),
   message?h('p',{role:'status'},message):null),
  error?h('p',{role:'alert',className:'ib-error'},error):null,
  h('p',null,'支持微信文献元数据、正文/SI 捕获、文献精读、PPT 制作、合成路线登记、核磁标峰与 Origin 绘图。只显示正在执行的任务；等待开始、等待确认及已结束的任务不显示。'));
}
function PluginSettings({ call }) {
 const [tab, setTab] = useState("templates");
 return h("section", { className: "ib-settings", "data-ibm-plugin-settings": true },
  h("h2", null, "iBM 插件设置"), h("p", null, "管理全局模板、运行诊断与桌面宠物。模板设置适用于所有课题。"),
  h("div", { className: "ib-tm-tabs" }, [ ["templates", "模板管理"], ["diagnostics", "诊断与版本"],["pet","桌面宠物"] ].map(([key, text]) => h("button", { key, className: "ib-tm-tab", "data-active": tab === key, onClick: () => setTab(key) }, text))),
  tab === "templates" ? h(Templates, { call }) : tab==='pet'?h(DesktopPetSettings,{call}):h(Diagnostics, { call }));
}

export function registerPluginSettings(ctx) {
 ctx.effect(() => ctx.locale.register("ibm-plugin-settings", { zh: { title: "iBM 插件设置" }, en: { title: "iBM plugin settings" } }), "iBM settings labels");
 const t = ctx.locale.bind("ibm-plugin-settings");
 const call = async (method, args) => {
  const payload = args?.request ?? args;
  const result = payload === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
  if (!result.ok) throw Error(result.error?.message ?? result.error ?? "请求失败");
  return result.value;
 };
 ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "ibm-plugin", order: 110, locale: "ibm-plugin-settings", label: () => t("title"), inject: () => ({ call }) }, PluginSettings));
}
