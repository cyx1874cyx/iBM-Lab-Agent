import { useCallback, useEffect, useRef, useState } from 'react';
import { h } from './h.js';
import { Project, OverlayBoundary } from './components-project.js';
import { Templates } from './components-templates.js';
import { useProjectViewValue } from './project-view-state.js';
import { currentDesktopSessionId } from './desktop-client.js';
import { BRAND_ICON } from './brand-icon.js';
import { ProjectFileHome, chooseProjectFile } from './project-file-home.js';
import { addConversationDrop, isFileDrag } from './workbench-file-drop.js';
import {ReagentPanel} from './components-reagents.js';
import {KnowledgePanel} from './components-knowledge.js';
import {taskEntryIdentity} from './project-task-session.js';
import {listWorkbenchModules, subscribeWorkbenchModules} from './module-registry.js';
import {subscribePluginSwitches, isPluginEnabled, hydratePluginSwitches, setPluginEnabled} from './plugin-switches.js';

export const WORKBENCH_MODULES = [
 { id: 'literature', label: '文献阅读', icon: 'book', caption: '检索、阅读与整理研究文献' },
 { id: 'knowledge', label: 'RAG 知识库', icon: 'layers', caption: '基于知识库资料回答，支持连续追问与来源核对' },
 { id: 'reagents', label: '试剂管理', icon: 'flask', caption: '化学试剂、生物试剂与细胞清单检索' },
 { id: 'characterization', label: '核磁解析', icon: 'wave', caption: '核磁数据、结构与谱图解析' },
 { id: 'plotting', label: '科研绘图', icon: 'chart', caption: '科研数据可视化、Origin 绘图与产物归档' },
 { id: 'polishing', label: '论文润色', icon: 'pen', caption: '功能规划中' },
];
const paths = {
 book: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2',
 layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
 flask: 'M9 3h6M10 3v6L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8',
 file: 'M14 3H5v18h14V8l-5-5Zm0 0v6h5M8 13h8M8 17h6',
 wave: 'M2 13h4l2-8 3 15 3-17 3 12h5',
 chart: 'M4 3v17h17M7 15l4-5 4 3 5-8',
 route: 'M5 3v10a4 4 0 0 0 4 4h10M15 13l4 4-4 4M5 9h14M15 5l4 4-4 4',
 pen: 'm4 16 12-12 4 4L8 20l-5 1 1-5ZM13 7l4 4',
};
function Icon({ name }) {
 return h('svg', { viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.file }));
}

// This controller is also the destination of existing project/desktop entry points.
// UI state stays in React; the host's conversation and resource slots stay resident.
export function createWorkbenchController() {
 let project = null;
 const storageKey = 'ib-workbench:last-project';
 try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && typeof saved.id === 'string' && typeof saved.name === 'string') project = saved;
 } catch { /* Storage is optional; the real project is loaded by its id. */ }
 const listeners = new Set();
 const chatListeners = new Set();
 return {
  get: () => project,
  open(value) {
   project = value;
   try { if (value) localStorage.setItem(storageKey, JSON.stringify({ id: value.id, name: value.name || value.id })); else localStorage.removeItem(storageKey); } catch { /* Keep the in-memory selection. */ }
   for (const listener of listeners) listener(project);
  },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  showChat() { for(const listener of chatListeners)listener(); },
  onShowChat(listener) { chatListeners.add(listener);return()=>chatListeners.delete(listener); },
 };
}

function PolishingPlaceholder() {
 return h('section', { className: 'ib-wb-writing' },
  h('h2', null, '论文润色'),
  h('p', null, '此功能正在规划中，暂不可用。'));
}

/**
 * 设置类弹窗：模板管理、插件设置共用。
 * 点击遮罩或 Esc 关闭，避免把工作台整页顶掉。
 */
function SettingsModal({ title, onClose, children }) {
 useEffect(() => {
  const onKey = event => { if (event.key === 'Escape') onClose(); };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
 }, [onClose]);
 return h('div', { role: 'presentation', onClick: event => { if (event.target === event.currentTarget) onClose(); }, style: { position: 'fixed', inset: 0, zIndex: 9000, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,0.35)', padding: '24px' } },
  h('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-settings-modal': title, style: { width: 'min(1080px,92vw)', maxHeight: 'calc(100vh - 48px)', overflow: 'auto', background: 'var(--ib-bg)', border: '1px solid var(--ib-line)', borderRadius: '14px', padding: '16px 20px', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' } },
   h('header', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' } }, h('h2', { style: { margin: 0 } }, title), h('button', { className: 'ib-btn', 'data-modal-close': true, onClick: onClose }, '关闭')),
   h('div', { 'data-plugin-settings-page': title === '插件设置' ? true : undefined }, children)));
}

/**
 * 可选功能：左侧研究工具底部的「+」打开。
 * 右栏是未添加功能，点击加入左侧；左栏点击移回右侧，拖动可调整顺序。
 * 所有变更都是硬启停（改写 profile 装配），关闭时询问是否立即重启。
 */
function OptionalFeatures({ call, onClose, onChange }) {
 const [data, setData] = useState(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const [dirty, setDirty] = useState(false);
 const [askRestart, setAskRestart] = useState(false);
 const [restarting, setRestarting] = useState(false);
 const [dragId, setDragId] = useState(null);
 useEffect(() => {
  let alive = true;
  Promise.resolve(call('plugins_list')).then(value => { if (alive) setData(value); }).catch(reason => { if (alive) setError(reason.message); });
  return () => { alive = false; };
 }, [call]);
 const added = data?.plugins.filter(row => row.enabled) ?? [];
 const optional = data?.plugins.filter(row => !row.enabled) ?? [];
 const mutate = async (method, payload) => {
  setBusy(true); setError('');
  try { const value = await call(method, payload); setData(value); onChange?.(value); setDirty(true); }
  catch (reason) { setError(reason.message); }
  finally { setBusy(false); }
 };
 const close = () => { if (dirty) setAskRestart(true); else onClose(); };
 const restart = async () => {
  setRestarting(true);
  try { if (globalThis.desktopNext?.command) { await globalThis.desktopNext.command({ type: 'restart' }); return; } } catch { /* fall through */ }
  globalThis.location.reload();
 };
 const reorderBefore = targetId => {
  const ids = added.map(row => row.id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return undefined;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return ids;
 };
 const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 14px', border: '1px solid var(--ib-line)', borderRadius: '10px', background: 'var(--ib-panel)', cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--ib-text)', font: 'inherit' };
 return h('div', { role: 'presentation', onClick: event => { if (event.target === event.currentTarget) close(); }, style: { position: 'fixed', inset: 0, zIndex: 9000, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,0.35)', padding: '24px' } },
  h('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '可选功能', 'data-optional-features-modal': true, style: { width: 'min(900px,94vw)', maxHeight: 'calc(100vh - 48px)', overflow: 'auto', background: 'var(--ib-bg)', border: '1px solid var(--ib-line)', borderRadius: '14px', padding: '16px 20px', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' } },
   h('header', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' } }, h('h2', { style: { margin: 0 } }, '可选功能'), h('button', { className: 'ib-btn', 'data-modal-close': true, disabled: busy, onClick: close }, '完成')),
   h('p', { style: { margin: '0 0 14px', color: 'var(--ib-soft)', fontSize: '14px' } }, '点击右侧功能添加到左侧；点击左侧移回右侧；拖动左侧条目可调整顺序。所有更改在重启应用后生效。'),
   error ? h('p', { role: 'alert', className: 'ib-error' }, error) : null,
   h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '18px' } },
    h('div', null,
     h('h3', { style: { margin: '0 0 10px', fontSize: '15px' } }, `已添加（${added.length}）`),
     h('div', { style: { display: 'grid', gap: '8px' } }, added.length === 0 ? h('p', { style: { color: 'var(--ib-soft)' } }, '还没有添加功能') : added.map(row => h('div', {
      key: row.id, draggable: true, 'data-added': row.id,
      onDragStart: () => setDragId(row.id),
      onDragOver: event => event.preventDefault(),
      onDrop: event => { event.preventDefault(); const order = reorderBefore(row.id); if (order) void mutate('plugins_set_order', { order }); setDragId(null); },
      onDragEnd: () => setDragId(null),
      onClick: () => void mutate('plugins_set_enabled', { id: row.id, enabled: false }),
      style: { ...rowStyle, opacity: dragId === row.id ? 0.5 : 1, cursor: 'grab' }
     }, h('span', null, h('b', null, row.name), h('small', { style: { display: 'block', color: 'var(--ib-soft)' } }, row.detail)), h('span', { style: { color: 'var(--ib-soft)', fontSize: '13px' } }, '移除'))))),
    h('div', null,
     h('h3', { style: { margin: '0 0 10px', fontSize: '15px' } }, `可选功能（${optional.length}）`),
     h('div', { style: { display: 'grid', gap: '8px' } }, optional.length === 0 ? h('p', { style: { color: 'var(--ib-soft)' } }, '全部功能都已添加') : optional.map(row => h('button', {
      key: row.id, type: 'button', 'data-optional': row.id, disabled: busy,
      onClick: () => void mutate('plugins_set_enabled', { id: row.id, enabled: true }),
      style: rowStyle
     }, h('span', null, h('b', null, row.name), h('small', { style: { display: 'block', color: 'var(--ib-soft)' } }, row.detail)), h('span', { style: { color: 'var(--ib-accent-ink)' } }, '添加')))))),
   askRestart ? h('div', { role: 'presentation', style: { position: 'fixed', inset: 0, zIndex: 9100, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,0.45)', padding: '24px' } },
    h('section', { role: 'alertdialog', 'aria-label': '是否立即重启', 'data-restart-prompt': true, style: { width: 'min(420px,92vw)', background: 'var(--ib-bg)', borderRadius: '12px', padding: '20px', border: '1px solid var(--ib-line)', boxShadow: '0 16px 40px rgba(0,0,0,0.3)' } },
     h('h3', { style: { marginTop: 0 } }, '可选功能已更新'),
     h('p', null, '更改需要重启应用后生效。是否立即重启？'),
     h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
      h('button', { className: 'ib-btn', disabled: restarting, onClick: () => { setAskRestart(false); onClose(); } }, '稍后'),
      h('button', { className: 'ib-btn', 'data-primary': true, disabled: restarting, onClick: () => void restart() }, restarting ? '正在重启…' : '立即重启')))) : null));
}

export function Workbench({ renderSlot, usePanelInfo, runtime }) {
 const { controller, call, ctx, layout, sidebarRight, launchProject, deleteProject } = runtime;
 const [project, setProject] = useState(controller.get);
 const [moduleId, setModuleId] = useProjectViewValue(project?.id || '_home', 'workbench-module', 'literature');
 // 插件自带模块（由各自 client bundle 通过注册表登记）。
 // 默认内置优先；插件声明 override:true 时接管同名内置页面（迁移期语义）。
 const [pluginModules, setPluginModules] = useState(() => listWorkbenchModules());
 const [pluginOrder, setPluginOrder] = useState([]);
 useEffect(() => subscribeWorkbenchModules(() => setPluginModules(listWorkbenchModules())), []);
 // 软启停：切换后立即重算可见模块（隐藏/恢复入口）。
 useEffect(() => subscribePluginSwitches(() => setPluginModules(listWorkbenchModules())), []);
 // 可选功能（子插件）的启用状态与顺序来自宿主；首屏缓存只用于避免闪烁。
 useEffect(() => {
  let alive = true;
  Promise.resolve(call('plugins_list')).then(value => {
   if (!alive || !value) return;
   hydratePluginSwitches(value.plugins);
   setPluginOrder(Array.isArray(value.order) ? value.order : []);
  }).catch(() => {});
  return () => { alive = false; };
 }, [call]);
 const pluginById = new Map(pluginModules.map(item => [item.id, item]));
 // 软停用的插件连同其接管的内置页面一起隐藏（避免"停用后仍是旧版页面"的错觉）。
 const MODULE_PLUGINS = { literature: 'literature', knowledge: 'knowledge', reagents: 'reagents', characterization: 'nmr', plotting: 'plotting', polishing: 'polishing' };
 const allModules = [
  ...WORKBENCH_MODULES.map(builtin => pluginById.get(builtin.id)?.override === true ? pluginById.get(builtin.id) : builtin),
  ...pluginModules.filter(item => !WORKBENCH_MODULES.some(builtin => builtin.id === item.id))
 ].filter(item => !MODULE_PLUGINS[item.id] || isPluginEnabled(MODULE_PLUGINS[item.id]))
  .sort((left, right) => {
   const indexOf = item => { const id = MODULE_PLUGINS[item.id] ?? item.id; const index = pluginOrder.indexOf(id); return index < 0 ? 999 : index; };
   return indexOf(left) - indexOf(right);
  });
 const module = allModules.find(item => item.id === moduleId) || allModules[0] || WORKBENCH_MODULES[0];
 const pluginPanel = pluginModules.find(item => item.id === module.id && typeof item.render === 'function' && (item.override === true || !WORKBENCH_MODULES.some(builtin => builtin.id === item.id)));
 const pageTitle = project ? module.label : '科研项目';
 const [historyOpen, setHistoryOpen] = useState(false);
 const [chatHidden, setChatHidden] = useProjectViewValue('_layout', 'chat-hidden', false);
 const [chatWidth, setChatWidth] = useProjectViewValue('_layout', 'chat-width', 380);
 const [templates, setTemplates] = useState(false);
 const [optionalOpen, setOptionalOpen] = useState(false);
 const [openingProject, setOpeningProject] = useState(false);
 const [chatDragging, setChatDragging] = useState(false);
 const [resourceWidth, setResourceWidth] = useState(800);
 const [error, setError] = useState('');
 const [selection, setSelection] = useState('');
 const [knowledgeHeaderTarget,setKnowledgeHeaderTarget]=useState(null);
 const [plottingHeaderTarget,setPlottingHeaderTarget]=useState(null);
 const centerRef = useRef(null);
 const activePanel = usePanelInfo(info => info.activePanelId);
 const knowledgeActive=Boolean(project&&module.id==='knowledge'&&!templates&&!activePanel);
 const [activeSessionId,setActiveSessionId]=useState(()=>currentDesktopSessionId(ctx.sessions));
 useEffect(()=>ctx.sessions.list.subscribe(()=>setActiveSessionId(currentDesktopSessionId(ctx.sessions))),[ctx]);
 const currentProject = useRef(project);
 currentProject.current = project;
 useEffect(() => controller.subscribe(setProject), [controller]);
 useEffect(() => controller.onShowChat(()=>setChatHidden(false)), [controller,setChatHidden]);
 useEffect(() => {
  document.title = 'iBM Lab';
  let revision = 0;
  let lastSession;
  let initialized = false;
  const resolveProject = async () => {
   if (!currentProject.current) return;
   const sessionId = currentDesktopSessionId(ctx.sessions);
   if (initialized && sessionId === lastSession) return;
   initialized = true; lastSession = sessionId;
   const current = ++revision;
   if (!sessionId) return;
   try {
    const result = await call('projects_by_session', { request: { sessionId } });
    if (current !== revision || !currentProject.current) return;
    if (result.project?.id && result.project.id !== currentProject.current?.id) controller.open(result.project);
   } catch { /* An unbound conversation must remain usable. */ }
  };
  void resolveProject();
  const unsubscribe = ctx.sessions.list.subscribe(() => { void resolveProject(); });
  return () => { revision++; unsubscribe(); };
 }, [controller, ctx, call]);
 useEffect(() => {
  const element = centerRef.current;
  const observer = new ResizeObserver(entries => setResourceWidth(Math.round(entries[0].contentRect.width)));
  observer.observe(element);
  return () => observer.disconnect();
 }, []);
 useEffect(() => { setSelection(''); }, [project?.id, module.id]);
 useEffect(() => { setHistoryOpen(false); }, [activePanel]);
 const closeResources = useCallback(() => {
  if (sidebarRight.isExpanded()) sidebarRight.toggleExpanded();
 }, [sidebarRight]);
 const navigate = id => {
  layout.selectPanel(null); closeResources(); setTemplates(false); setModuleId(id); setHistoryOpen(false); setError('');
 };
 const onTask = async (target, options = {}) => {
  setChatHidden(false); setError('');
  const context = `当前课题：${target.name || target.id}（${target.id}）。当前工作区：${module.label}。\n`;
  return launchProject(target, { ...options, freshSession: !taskEntryIdentity(options), prompt: context + (options.prompt || '请先读取课题工作区中的「项目记忆.md」，协助我继续当前工作。') });
 };
 const openKnowledgeChat=async(settings,{fresh=false}={})=>{
  if(!fresh){
   const saved=await call('knowledge_chat_state',{request:{projectId:project.id}});
   if(saved.sessionId){
    try{return await ctx.sessions.using(saved.sessionId,{source:'controllerOperation'},async()=>{ctx.uiWorkspace.openSession(saved.sessionId);return saved;});}
    catch { /* A deleted conversation is replaced with a new knowledge session. */ }
   }
  }
  const created=await launchProject(project,{freshSession:true,preserveDraft:true,knowledge:settings});
  return call('knowledge_chat_state',{request:{projectId:project.id,sessionId:created.sessionId}});
 };
 const openProject = async target => {
  layout.selectPanel(null); closeResources(); setTemplates(false); setHistoryOpen(false); setError(''); setOpeningProject(true);
  try { await launchProject(target, { reuseCurrent: true, preserveDraft: true }); }
  catch (reason) { setError(reason.message); }
  finally { setOpeningProject(false); }
 };
 const resize = event => {
  if (event.button !== 0) return;
  event.preventDefault();
  const element = event.currentTarget, start = event.clientX, width = Math.max(320, Math.min(chatWidth, window.innerWidth * .5));
  element.setPointerCapture(event.pointerId);
  const move = next => setChatWidth(Math.round(Math.max(320, Math.min(620, window.innerWidth * .5, width + start - next.clientX))));
  const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('lostpointercapture', end); };
  element.addEventListener('pointermove', move); element.addEventListener('lostpointercapture', end, { once: true });
 };
 const quoteSelection = () => {
  if (project && selection) void onTask(project, { prompt: `请结合当前课题解释以下选中的内容：\n\n${selection}` }).catch(reason => setError(reason.message));
 };
 const [projectTab, setProjectTab] = useProjectViewValue(project?.id || '_home', 'workbench-project-tab', 'literature');
 useEffect(() => { if (['literature', 'characterization', 'plotting'].includes(module.id)) setProjectTab(module.id); }, [module.id, setProjectTab]);
 // The host listens on document for drops. Claim chat files during capture and
 // stop unclaimed workbench files during bubble, after module drop handlers ran.
 const chatDrag = event => {
  if (!isFileDrag(event)) return;
  const inChat = Boolean(event.target.closest?.('.ib-wb-chat'));
  setChatDragging(inChat); event.preventDefault();
  if (inChat) { event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; }
 };
 const chatDrop = event => {
  if (!isFileDrag(event)) return;
  setChatDragging(false);
  if (!event.target.closest?.('.ib-wb-chat')) return;
  event.preventDefault(); event.stopPropagation();
  try { addConversationDrop(ctx, event.dataTransfer.files); setError(''); }
  catch (reason) { setError(reason.message); }
 };
 const stopUnclaimedDrop = event => { if (isFileDrag(event)) { event.preventDefault(); event.stopPropagation(); } };
 // 插件面板的宿主插槽：项目页需要的会话、页头操作区与问答入口都由母包提供，
 // 插件只负责自己的业务视图（不 import 母包内部组件）。
 const pluginProps = {
  call, project, ctx, activeSessionId,
  headerTarget: module.id === 'knowledge' ? knowledgeHeaderTarget : module.id === 'plotting' ? plottingHeaderTarget : null,
  conversation: knowledgeActive ? renderSlot('main', {}, { entryKey: 'conversation' }) : null,
  openChat: module.id === 'knowledge' ? openKnowledgeChat : undefined
 };
 return h('div', { className: 'ib-wb', 'data-welcome': !project || undefined,'data-knowledge':knowledgeActive||undefined, 'data-chat-hidden': chatHidden || knowledgeActive || undefined, style: { '--ib-wb-chat-width': `${Math.max(320, Math.min(chatWidth, 620))}px` },
  onDragEnterCapture:chatDrag,onDragOverCapture:chatDrag,onDropCapture:chatDrop,
  onDragLeaveCapture:event=>{if(isFileDrag(event)&&!event.relatedTarget?.closest?.('.ib-wb-chat'))setChatDragging(false);},
  onDragEnter:stopUnclaimedDrop,onDragOver:stopUnclaimedDrop,onDragLeave:stopUnclaimedDrop,onDrop:stopUnclaimedDrop
 },
  h('div', { className:'ib-wb-titlebar','aria-hidden':true }),
  h('header', { className: 'ib-wb-top' },
   h('button', { className: 'ib-wb-brand', onClick: () => { controller.open(null); layout.selectPanel(null); closeResources(); setTemplates(false); } }, h('span', { className: 'ib-wb-brand-mark' }, h('img', { src: BRAND_ICON, alt: '', 'aria-hidden': true })), 'iBM Lab'),
   project ? h('span', { className: 'ib-wb-top-divider' }) : null,
   project ? h('div', { className: 'ib-wb-current-project', title: project.name, 'aria-label': '当前课题' }, h('span', null, '当前课题'), h('strong', null, project.name)) : null,
   h('span', { className: 'ib-wb-top-spacer' }),
   project ? h('button', { className: 'ib-wb-tool', disabled: openingProject, onClick: () => void chooseProjectFile(call, openProject).catch(reason => setError(reason.message)) }, '打开项目…') : null,
   project ? h('button', { className: 'ib-wb-tool', onClick: () => { controller.open(null); layout.selectPanel(null); closeResources(); setTemplates(false); setHistoryOpen(false); } }, '关闭课题') : null,
   h('button', { className: 'ib-wb-tool', 'aria-expanded': historyOpen, onClick: () => setHistoryOpen(value => !value) }, project ? '会话与设置' : '设置'),
   project&&!knowledgeActive ? h('button', { className: 'ib-wb-tool', 'aria-expanded': !chatHidden, onClick: () => setChatHidden(value => !value) }, chatHidden ? '展开对话' : '收起对话') : null),
  h('aside', { className: 'ib-wb-nav', 'aria-label': '科研功能', hidden: !project },
   h('div', { className: 'ib-wb-nav-label' }, '研究工具'),
   h('nav', null, allModules.map(item => h('button', { key: item.id, className: 'ib-wb-nav-item', 'data-module': item.id, 'aria-current': module.id === item.id && !templates ? 'page' : undefined, title: item.label, onClick: () => navigate(item.id) }, h(Icon, { name: item.icon }), h('span', null, item.label))),
    h('button', { className: 'ib-wb-nav-item', 'data-optional-features': true, title: '添加可选功能', onClick: () => setOptionalOpen(true) }, h('span', { style: { fontSize: '22px', lineHeight: 1, width: '19px', textAlign: 'center' }, 'aria-hidden': true }, '+'), h('span', null, '添加可选功能'))),
   h('div', { className: 'ib-wb-nav-bottom' }, h('button', { className: 'ib-wb-nav-item', onClick: () => { layout.selectPanel(null); closeResources(); setTemplates(true); } }, h(Icon, { name: 'file' }), h('span', null, '模板管理')), h('small', null, 'iBM Lab · 科研工作台'))),
  h('main', { className: 'ib-wb-center', ref: centerRef, 'aria-label': project ? '业务工作区' : '欢迎页', onMouseUp: () => { const selected = window.getSelection(); if (selected && centerRef.current?.contains(selected.anchorNode)) setSelection(String(selected).trim().slice(0, 6000)); } },
   h('div', { className: 'ib-wb-page-head', hidden: !project }, h('div', null, h('div', { className: 'ib-wb-breadcrumb' }, '工作台', h('span', null, '/'), pageTitle), h('h1', null, pageTitle), h('p', null, project ? module.caption : '创建或打开工程文件，继续你的研究工作')),knowledgeActive?h('div',{className:'ib-wb-page-actions',ref:setKnowledgeHeaderTarget}):null,module.id==='plotting'&&!templates&&!activePanel?h('div',{className:'ib-wb-page-actions',ref:setPlottingHeaderTarget}):null, project && selection ? h('button', { className: 'ib-btn', onClick: quoteSelection, onMouseDown: event => event.preventDefault() }, '引用选中文本 →') : null),
   error ? h('div', { className: 'ib-wb-alert', role: 'alert' }, error) : null,
   openingProject ? h('div', { className: 'ib-wb-alert', role: 'status' }, '正在打开课题工作区与对话…') : null,
   !project ? h('div', { className: 'ib-wb-content ib-wb-welcome ib-overlay ib-wb-business' }, h(ProjectFileHome, { call, onOpen: openProject, welcome: true })) : null,
   h('div', { className: 'ib-wb-content ib-overlay ib-wb-business', hidden: !project || Boolean(activePanel) },
    project ? h('div', { className: 'ib-wb-project-holder' },
     h('div', { className: 'ib-wb-project-seat', hidden: !['literature', 'characterization', 'plotting'].includes(module.id) }, h(Project, { key: project.id, project, call, activeTab: projectTab, workbench: true, plottingHeaderTarget, onBack: () => controller.open(null), onDelete: deleteProject, onStartChat: onTask })),
     pluginPanel ? h(pluginPanel.render, { key: pluginPanel.id, ...pluginProps }) : module.id === 'polishing' ? h(PolishingPlaceholder) : module.id==='reagents'?h(ReagentPanel,{call}):null,
     module.id==='knowledge' ? h(KnowledgePanel,{key:project.id,project,call,openChat:openKnowledgeChat,activeSessionId,headerTarget:knowledgeHeaderTarget,conversation:knowledgeActive?renderSlot('main',{}, {entryKey:'conversation'}):null}) : null) : null),
   project && templates ? h(SettingsModal, { title: '模板管理', onClose: () => setTemplates(false) }, h(Templates, { call, onBack: () => setTemplates(false) })) : null,
   project && optionalOpen ? h(OptionalFeatures, { call, onClose: () => setOptionalOpen(false), onChange: value => { hydratePluginSwitches(value.plugins); setPluginOrder(Array.isArray(value.order) ? value.order : []); setPluginModules(listWorkbenchModules()); } }) : null,
   project && activePanel ? h('div', { className: 'ib-wb-global' }, h('button', { className: 'ib-wb-back ib-btn', onClick: () => layout.selectPanel(null) }, '← 返回工作区'), renderSlot('main', {}, { entryKey: activePanel })) : null,
   h('div', { className: 'ib-wb-resources', 'data-rightbar-col': true, hidden: !project }, renderSlot('rightbar', { width: resourceWidth, viewportWidth: Math.max(800, window.innerWidth), canShow: Boolean(project) }))),
  h('div', { className: 'ib-wb-resize', hidden: !project, role: 'separator', 'aria-label': '调整对话宽度', 'aria-orientation': 'vertical', tabIndex: 0, onPointerDown: resize, onPointerUp: event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }, onKeyDown: event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setChatWidth(width => Math.max(320, Math.min(620, width + (event.key === 'ArrowLeft' ? 24 : -24)))); } } }),
  h('aside', { className: 'ib-wb-chat', 'aria-label': 'LLM 对话', 'data-dragging':chatDragging?'true':undefined, hidden: !project || chatHidden || knowledgeActive },
   h('div', { className: 'ib-wb-chat-title' }, h('span', { className: 'ib-wb-online-dot' }), h('strong', null, '科研助手'), h('span', null, 'LLM')),
   h('div', { className: 'ib-wb-context', title: project?.name || '未选择课题' }, h('span', null, '当前工作区'), h('b', null, project ? `${project.name} · ${module.label}` : '选择课题后开始协作')),
   h('div', { className: 'ib-wb-chat-empty', hidden: Boolean(project) }, '打开或新建项目后，在这里与科研助手协作。'),
   h('div', { className: 'ib-wb-conversation', hidden: !project },knowledgeActive?null:renderSlot('main', {}, { entryKey: 'conversation' }))),
  h('div', { className: 'ib-wb-history', hidden: !historyOpen }, h('button', { className: 'ib-wb-history-dismiss', 'aria-label': '关闭会话与设置', onClick: () => setHistoryOpen(false) }), h('section', { className: 'ib-wb-history-panel', 'aria-label': '会话与设置' }, h('div', { className: 'ib-wb-history-heading' }, '会话与设置', h('button', { className: 'ib-wb-tool', onClick: () => setHistoryOpen(false) }, '关闭')), renderSlot('sidebar', { collapsed: false, width: 280 }))),
  h('div', { className: 'ib-wb-overlays', 'data-shell-overlay': true }, renderSlot('shell.overlay', {})),
  h('div', { className: 'ib-wb-leading' }, renderSlot('shell.leading', {})));
}

export function registerWorkbench(ctx, runtime) {
 return ctx.slots.register({
  name: 'lab.workbench',
 }, ({ frame }) => h(OverlayBoundary, { onClose: () => runtime.controller.open(null) }, h(Workbench, { ...frame, runtime })));
}
