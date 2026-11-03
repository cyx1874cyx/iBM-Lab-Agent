import {useState,useEffect,useCallback,useRef} from 'react';
import {createPortal} from 'react-dom';
import {h} from 'dsh-lab-agent/client-sdk';
import {fileToBase64} from 'dsh-lab-agent/client-sdk';
import {openOfficeArtifact,downloadVerifiedBinary} from 'dsh-lab-agent/client-sdk';
import {chartCatalog,plotSpecSchema,materializeNumericAxes,validatePlotSelection,manualChartChoices,eligibleCharts} from 'dsh-lab-agent/plot/workspace';
import {BufferedEditorProperties} from './plot-editor-controls.js';
import {LivePlotPreview} from './plot-live-preview.js';
import {NativeSceneOverlay} from './plot-native-scene.js';
import {ReadingContextMenu} from 'dsh-lab-agent/client-sdk';
import {ImageEntryEditor,imageArtifact} from './plot-image-editor.js';
import {LayoutPicker,LayoutEditor,layoutArtifact} from './plot-layout-editor.js';

const busyStatus=new Set(['analyzing','recommending','generating','saving']);
const artifact=(projectId,row,slot)=>`/api/lab-artifacts?kind=plotting&projectId=${encodeURIComponent(projectId)}&recordId=${encodeURIComponent(row.id)}&slot=${slot}&v=${encodeURIComponent(['quick-preview','quick-scene'].includes(slot)?row.workflow?.quickPreview?.sha256||'':slot==='working-preview'?row.workflow?.workingPreview?.sha256||'':slot.startsWith('draft-')?row.workflow?.draft?.preview.sha256||'':row.workflow?.saved?.preview.sha256||'')}${['quick-preview','quick-scene'].includes(slot)?'&r='+encodeURIComponent(row.workflow?.quickPreview?.renderId||''):''}`;
const chartName=kind=>chartCatalog.find(row=>row.id===kind)?.name||'科研绘图';
const dateText=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未保存';
const typeName={number:'数值',category:'类别',date:'日期',empty:'空列'};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const button=(label,click,disabled=false,primary=false,extra={})=>h('button',{type:'button',className:'ib-btn',onClick:click,disabled,'data-primary':primary||undefined,...extra},label);

export function ChartGlyph({kind}){
 const points='16,49 29,39 42,43 55,23 70,17';
 return h('svg',{viewBox:'0 0 86 64',width:86,height:64,fill:'none',stroke:'currentColor',strokeWidth:2,'aria-hidden':true},
  h('path',{d:'M11 8v47h66',opacity:.35}),
  ['line','line_symbol'].includes(kind)?h('polyline',{points,strokeWidth:2.5}):null,
  ['scatter','line_symbol'].includes(kind)?[[16,49],[29,39],[42,43],[55,23],[70,17]].map(([cx,cy],i)=>h('circle',{key:i,cx,cy,r:3,fill:'currentColor',stroke:'none'})):null,
  ['column','histogram'].includes(kind)?[23,37,46,32,18].map((height,i)=>h('rect',{key:i,x:16+i*11,y:54-height,width:kind==='histogram'?10:7,height,fill:'currentColor',stroke:'none',opacity:.5+i*.1})):null,
  kind==='bar'?[36,52,28,45].map((width,i)=>h('rect',{key:i,x:12,y:13+i*10,width,height:6,fill:'currentColor',stroke:'none',opacity:.55+i*.1})):null,
  kind==='box'?[23,42,61].map((x,i)=>h('g',{key:i},h('path',{d:`M${x} 12v36m-5-36h10m-10 36h10`}),h('rect',{x:x-6,y:22+i*2,width:12,height:15,fill:'var(--ib-panel)'}),h('path',{d:`M${x-6} 29h12`}))):null);
}

export function OriginConnection({projectId,call}){
 const [status,setStatus]=useState(null),[checking,setChecking]=useState(false),[details,setDetails]=useState(false),probe=useRef(null);
 useEffect(()=>{
  let alive=true,timer,pending=false;
  const check=async(force=false)=>{
   if(pending)return;pending=true;if(alive)setChecking(true);
   try{const result=await call('plot_origin_connection',{request:{projectId,force}});if(alive)setStatus(typeof result.connected==='boolean'||result.busy?result:{connected:false,error:'连接诊断未返回状态'});}
   catch(error){if(alive)setStatus({connected:false,error:error.message,checkedAt:new Date().toISOString()});}
   finally{pending=false;if(alive)setChecking(false);}
  };
  probe.current=check;setStatus(null);
  const poll=async()=>{if(document.visibilityState!=='hidden')await check();if(alive)timer=setTimeout(poll,5000);};void poll();
  return()=>{alive=false;clearTimeout(timer);if(probe.current===check)probe.current=null;};
 },[projectId,call]);
 const label=!status?'检查中':status.connected?'已连接':status.busy?'忙碌，等待响应':'未连接';
 return h('div',{className:'ib-plot-origin-connection','data-connected':status?.connected,'aria-label':'Origin 连接状态'},
  button('Origin '+label,()=>setDetails(v=>!v),false,false,{'aria-expanded':details,title:'Origin 连接诊断，每 5 秒检查'}),
  details?h('div',{className:'ib-plot-origin-details',role:'status'},h('b',null,'Origin 连接诊断'),
   h('p',null,'连接：'+label+(status?.bridgeVersion?' · 桥接 '+status.bridgeVersion:'')),
   status?.checkedAt?h('p',null,'检查时间：'+new Date(status.checkedAt).toLocaleTimeString()+' · 响应 '+status.latencyMs+' ms'):null,
   status?.busy?h('p',null,'绘图任务正在执行，响应可能延后。'):null,
   status?.error?h('p',{className:'ib-error'},status.error):null,
   status?.connected===false?h('p',null,'请确认 Origin 已打开且 GUI 桥接服务已启动，再重新检查。'):null,
   button(checking?'检查中…':'立即检查',()=>void probe.current?.(true),checking)):null);
}

export function PlottingPanel({projectId,call,onRefineConversation,headerTarget=null}){
 const [rows,setRows]=useState([]),[legacy,setLegacy]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [layoutPicker,setLayoutPicker]=useState(false),[layoutOnly,setLayoutOnly]=useState(false),[openId,setOpenId]=useState(null),[previewId,setPreviewId]=useState(null),[newPlot,setNewPlot]=useState(false),[uploading,setUploading]=useState(false),[drag,setDrag]=useState(false);
 const [entryMenu,setEntryMenu]=useState(null),deleteLock=useRef(false);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3000);return()=>clearTimeout(timer);},[notice]);
 const fileInput=useRef(null),uploadLock=useRef(false),depth=useRef(0),finalizing=useRef(null),projectRef=useRef(projectId);
 projectRef.current=projectId;
 const refresh=useCallback(async()=>{
  const [plots,tasks]=await Promise.all([call('plot_records_list',{request:{projectId}}),call('characterization_list',{request:{projectId}})]);
  if(projectRef.current!==projectId)return;
  setRows(plots.records||[]);setLegacy((tasks.tasks||[]).filter(row=>row.kind==='plot'&&!(plots.records||[]).some(item=>item.id===row.id)));setLoading(false);
 },[call,projectId]);
 useEffect(()=>{
  let alive=true,timer;
  const poll=async()=>{try{if(alive)await refresh();}catch(reason){if(alive){setError(reason.message);setLoading(false);}}finally{if(alive)timer=setTimeout(poll,1600);}};
  void poll();return()=>{alive=false;clearTimeout(timer);};
 },[refresh]);
 useEffect(()=>{setRows([]);setLegacy([]);setLoading(true);setLayoutPicker(false);setLayoutOnly(false);setOpenId(null);setPreviewId(null);setNewPlot(false);setEntryMenu(null);setError('');setNotice('');finalizing.current=null;},[projectId]);
 useEffect(()=>{
  const pending=finalizing.current;if(!pending)return;
  const row=rows.find(row=>row.id===pending.id);
  if(row?.workflow?.operation===pending.operation&&row.workflow.status==='completed'){
   finalizing.current=null;setOpenId(null);setLayoutOnly(false);setNotice('绘图已保存，原始数据、图片预览与 Origin 工程已归入条目。');
  }
  else if(row?.workflow?.operation===pending.operation&&row.workflow.status==='editing'&&row.workflow.error){finalizing.current=null;setNotice('检测到文字重叠或裁切，正式工程未替换；请调整画布并重新生成。');}
  else if(row?.workflow?.operation===pending.operation&&row.workflow.status==='failed'){finalizing.current=null;setError('保存失败：'+(row.workflow.error||'Origin 未能完成保存，请重试。'));}
 },[rows]);
 const run=async work=>{setError('');try{await work();}catch(reason){setError(reason.message);}};
 const remove=async ids=>{
  const id=ids[0],row=[...rows,...legacy].find(item=>item.id===id);if(!row||deleteLock.current)return;
  if(!window.confirm(`确认删除绘图条目“${row.topic||row.title||id}”？\n\n课题目录中的原始数据、已归档工程和关联对话会保留。`))return;
  deleteLock.current=true;const target=projectId;setError('');
  try{
   await call('characterization_remove',{request:{taskId:id,projectId,kind:'plot'}});
   if(projectRef.current!==target)return;
   setRows(old=>old.filter(item=>item.id!==id));setLegacy(old=>old.filter(item=>item.id!==id));
   if(openId===id)setOpenId(null);if(previewId===id)setPreviewId(null);if(finalizing.current?.id===id)finalizing.current=null;
   setNotice('绘图条目已删除；原始数据、已归档工程和关联对话已保留。');await refresh();
  }catch(reason){if(projectRef.current===target)setError(reason.message);}finally{deleteLock.current=false;}
 };
 const upload=async files=>{
  if(uploadLock.current)return;
  if(!files.length||files.length>20){setError('每次请选择 1–20 个文件，每个文件生成一个条目。');return;}
  for(const file of files){if(!/\.(csv|tsv|txt|xlsx|xls|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(file.name)){setError('请选择 CSV、Excel 或 PNG、JPEG、WebP、TIFF、BMP、GIF 图片');return;}if(!file.size||file.size>25*1024*1024){setError(file.name+'：文件为空或超过 25 MB');return;}}
  uploadLock.current=true;setUploading(true);setError('');const target=projectId;
  try{
   const failures=[];let latest;
   for(const file of files){if(projectRef.current!==target)break;try{
    const result=await call('plot_workspace_upload',{request:{projectId,name:file.name,base64:await fileToBase64(file),inspectOnly:true}});
    if(projectRef.current!==target)return;latest=result.record;setRows(old=>[result.record,...old.filter(row=>row.id!==result.record.id)]);
   }catch(reason){failures.push(file.name+'：'+reason.message);}}
   if(projectRef.current!==target)return;
   if(latest){setNewPlot(false);if(files.length===1)setOpenId(latest.id);else setNotice('已导入文件，每个文件已生成独立条目。');await refresh();}
   if(failures.length)setError(failures.join('；'));
  }catch(reason){if(projectRef.current===target)setError(reason.message);}finally{uploadLock.current=false;setUploading(false);}
 };
 const queue=async(id,spec,save=false,localPreviewBase64,confirmRefinement=false)=>{
  const row=rows.find(row=>row.id===id),result=await call('plot_workspace_render',{request:{projectId,id,spec,revision:row.workflow.revision,save,...(localPreviewBase64?{localPreviewBase64}:{}),...(confirmRefinement?{confirmRefinement:true}:{})}});
  setRows(old=>old.map(item=>item.id===id?result.record:item));
  if(save)finalizing.current={id,operation:result.record.workflow.operation};
  return result;
 };
 const modify=row=>{setLayoutOnly(false);setOpenId(row.id);};
 const autoLayout=async(row,spec)=>{if(!onRefineConversation)throw Error('科研助手对话不可用');const result=await call('plot_workspace_auto_layout',{request:{projectId,id:row.id,spec,revision:row.workflow.revision}});setRows(old=>old.map(item=>item.id===row.id?result.record:item));await onRefineConversation(result.record,{autoLayout:true,prompt:result.prompt});setOpenId(null);};
 const list=[...rows,...legacy].sort((a,b)=>(b.layout?.savedAt||b.image?.savedAt||b.workflow?.savedAt||b.createdAt||'').localeCompare(a.layout?.savedAt||a.image?.savedAt||a.workflow?.savedAt||a.createdAt||''));
 const current=rows.find(row=>row.id===openId),hasFiles=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
 const createLayout=async(ids,name)=>{const result=await call('plot_layout_create',{request:{projectId,ids,name}});if(!result.record?.layout)throw Error('未返回有效版面');setRows(old=>[result.record,...old.filter(r=>r.id!==result.record.id)]);setLayoutPicker(false);setOpenId(result.record.id);};
 const actions=h('span',{className:'ib-plot-main-actions'},h(OriginConnection,{projectId,call}),button('多面板排版',()=>setLayoutPicker(true),uploading),button(uploading?'正在导入…':'＋ 新建绘图',()=>{setError('');setNewPlot(true);},uploading,true));
 return h('section',{className:'ib-plotting','data-task-kind':'plot','data-dragging':drag||undefined,
  onDragEnter:e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();depth.current++;setDrag(true);},
  onDragOver:e=>{if(hasFiles(e)){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';}},
  onDragLeave:e=>{if(!hasFiles(e)&&!drag)return;e.preventDefault();e.stopPropagation();if(--depth.current<=0){depth.current=0;setDrag(false);}},
  onDrop:e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();depth.current=0;setDrag(false);void upload(Array.from(e.dataTransfer.files||[]));}},
  headerTarget?createPortal(actions,headerTarget):h('div',{className:'ib-plot-toolbar'},h('div',null,h('h2',null,'科研绘图'),h('p',null,'导入数据生成 Origin 图，或拖入图片进行裁剪、旋转与归档。')),actions),
  error?h('div',{className:'ib-error',role:'alert'},error):null,notice?h('p',{className:'ib-plot-notice',role:'status'},notice):null,
  h('input',{ref:fileInput,type:'file',hidden:true,multiple:true,accept:'.csv,.tsv,.txt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.gif',onChange:e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void upload(files);}}),
  loading?h('p',{className:'ib-muted'},'正在读取绘图条目…'):!list.length?h('button',{className:'ib-plot-empty',onClick:()=>setNewPlot(true)},h(ChartGlyph,{kind:'line_symbol'}),h('b',null,'创建第一张科研图'),h('span',null,'拖入 CSV / Excel 或图片，也可点击选择文件')):
   h('div',{className:'ib-plot-list'},...list.map(row=>{
    const w=row.workflow,processing=busyStatus.has(w?.status),saved=!!w?.saved;
    const legacyUrl=`/api/lab-artifacts?kind=characterization&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(row.id)}&slot=origin`;
    return h('article',{className:'ib-plot-entry',key:row.id,onContextMenu:e=>{e.preventDefault();e.stopPropagation();setEntryMenu({x:e.clientX,y:e.clientY,reportIds:[row.id]});}},h('button',{className:'ib-plot-thumb',onClick:()=>row.image||row.layout?modify(row):w?(w.saved||w.draft?setPreviewId(row.id):setOpenId(row.id)):void run(()=>openOfficeArtifact(legacyUrl,'origin')),'aria-label':'查看绘图 '+(row.topic||row.title)},row.layout?h('img',{src:layoutArtifact(projectId,row,'preview'),alt:row.topic,loading:'lazy'}):row.image?h('img',{src:imageArtifact(projectId,row,'preview'),alt:row.topic,loading:'lazy'}):w?.saved?.preview||w?.draft?.preview?h('img',{src:artifact(projectId,row,w.saved?'preview':'draft-preview'),alt:row.topic||'Origin 图预览',loading:'lazy'}):w?.spec&&w?.profile?h(LivePlotPreview,{url:artifact(projectId,row,'data'),spec:w.spec,profile:w.profile,selected:'',onSelect:()=>{},change:()=>{},disabled:true}):h(ChartGlyph,{kind:'line_symbol'})),
     h('div',{className:'ib-plot-entry-info'},h('button',{className:'ib-plot-entry-name',onClick:()=>w||row.image||row.layout?modify(row):void run(()=>openOfficeArtifact(legacyUrl,'origin'))},row.topic||row.title),
      h('time',null,row.layout?'修改时间 '+dateText(row.layout.savedAt):row.image?'修改时间 '+dateText(row.image.savedAt):w?.savedAt?'绘制时间 '+dateText(w.savedAt):'创建时间 '+dateText(row.createdAt)),
      h('small',{'data-failed':w?.status==='failed'||undefined},row.layout?`组合版面 · ${row.layout.doc.objects.filter(o=>o.type==='panel').length} 张图片`:row.image?`${row.image.format} 图片 · ${row.image.saved.width} × ${row.image.saved.height} px`:w?.status==='failed'?w.error:w?.stage||'历史绘图条目'),w?.refinement?h('small',null,w.refinement.scope+'；位置偏差 '+w.refinement.before.toFixed(3)+' → '+w.refinement.after.toFixed(3)):null,processing?h('span',{className:'ib-plot-progress',role:'status'},'处理中…'):null),
     row.layout?h('div',{className:'ib-plot-entry-files'},button('下载 PNG',()=>void run(()=>downloadVerifiedBinary(layoutArtifact(projectId,row,'layout-png'),{silentCancel:true}))),button('下载 PDF',()=>void run(()=>downloadVerifiedBinary(layoutArtifact(projectId,row,'pdf'),{silentCancel:true}))),button('修改排版',()=>modify(row))):row.image?h('div',{className:'ib-plot-entry-files'},button('原始图片',()=>void run(()=>downloadVerifiedBinary(imageArtifact(projectId,row,'raw'),{silentCancel:true}))),button('下载图片',()=>void run(()=>downloadVerifiedBinary(imageArtifact(projectId,row,'image-export'),{silentCancel:true}))),button('修改图片',()=>modify(row))):h('div',{className:'ib-plot-entry-files'},button('原始数据',()=>void run(()=>downloadVerifiedBinary(artifact(projectId,row,'raw'),{silentCancel:true})),!w?.raw,false,{'aria-label':'原始数据 '+(row.topic||row.title)}),
      button('Origin 工程',()=>void run(()=>openOfficeArtifact(w?artifact(projectId,row,saved?'origin':w.draft?'draft-origin':'data-origin'):legacyUrl,'origin')),w?!saved&&!w.draft&&!w.originData:!row.artifactPath&&!row.artifacts?.origin,false,{'aria-label':'Origin 工程 '+(row.topic||row.title)}),
      button('修改图片',()=>void modify(row),!w||processing,false,{'aria-label':'修改图片 '+(row.topic||row.title)})));
   })),
  entryMenu?h(ReadingContextMenu,{menu:entryMenu,label:'绘图条目操作',onClose:()=>setEntryMenu(null),onDelete:ids=>void remove(ids)}):null,
  drag?h('div',{className:'ib-plot-drop-hint'},'松开以导入文件并创建条目'):null,
  newPlot?createPortal(h('div',{className:'ib-plot-backdrop'},h('section',{className:'ib-plot-import',role:'dialog','aria-modal':true,'aria-label':'新建绘图'},h('header',null,h('h3',null,'新建绘图'),button('关闭',()=>setNewPlot(false),uploading)),h('ol',{className:'ib-plot-import-steps'},h('li',null,'1  导入数据或图片'),h('li',null,'2  数据选图 / 图片编辑'),h('li',null,'3  调整图片 · 保存与导出')),h('button',{className:'ib-plot-upload-zone',disabled:uploading,onClick:()=>fileInput.current?.click()},h(ChartGlyph,{kind:'line_symbol'}),h('strong',null,uploading?'正在导入文件…':'拖入数据文件，或点击选择'),h('span',null,'CSV、Excel、PNG、JPEG、WebP、TIFF、BMP、GIF · 单文件不超过 25 MB')),error?h('p',{role:'alert',className:'ib-error'},error):null,h('p',{className:'ib-muted'},'数据文件可选择工作表及表头行；图片直接进入裁剪、旋转编辑。每个文件生成一个条目，原文件保留。'))),document.body):null,
  previewId&&rows.some(row=>row.id===previewId)?createPortal(h(PlotImagePreview,{row:rows.find(row=>row.id===previewId),projectId,onClose:()=>setPreviewId(null),onEdit:()=>{setPreviewId(null);setLayoutOnly(false);setOpenId(previewId);}}),document.body):null,
  layoutPicker?createPortal(h(LayoutPicker,{rows,projectId,onClose:()=>setLayoutPicker(false),onChoose:createLayout}),document.body):null,
  current?createPortal(current.layout?h(LayoutEditor,{key:projectId+current.id,row:current,rows,projectId,call,onClose:()=>setOpenId(null),onSaved:record=>setRows(old=>old.map(item=>item.id===record.id?record:item))}):current.image?h(ImageEntryEditor,{key:projectId+current.id,row:current,projectId,call,onClose:()=>setOpenId(null),onSaved:record=>{setRows(old=>old.map(item=>item.id===record.id?record:item));setOpenId(null);setNotice('图片已保存。');}}):h(PlotWizard,{key:projectId+current.id+layoutOnly,layoutOnly,row:current,projectId,call,onAutoLayout:spec=>autoLayout(current,spec),onClose:()=>{setOpenId(null);setLayoutOnly(false);},onRefresh:refresh,onRender:spec=>queue(current.id,spec),onSave:(spec,localPreviewBase64,confirmRefinement)=>queue(current.id,spec,true,localPreviewBase64,confirmRefinement)}),document.body):null);
}

function PlotImagePreview({row,projectId,onClose,onEdit}){
 const [error,setError]=useState('');
 useEffect(()=>{const key=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[onClose]);
 const download=slot=>{setError('');void downloadVerifiedBinary(artifact(projectId,row,slot),{silentCancel:true}).catch(error=>setError(error.message));};
 return h('div',{className:'ib-plot-backdrop'},h('section',{className:'ib-plot-wizard ib-plot-image-preview',role:'dialog','aria-modal':true,'aria-label':'绘图图片预览'},h('header',{className:'ib-plot-wizard-head'},h('div',null,h('b',null,row.topic),h('small',null,row.workflow.savedAt?'绘制时间 '+dateText(row.workflow.savedAt):'初版预览，尚未确认保存')),button('关闭',onClose)),error?h('p',{className:'ib-error',role:'alert'},error):null,h('div',{className:'ib-plot-image-scroll'},row.workflow.saved||row.workflow.draft?h('img',{src:artifact(projectId,row,row.workflow.saved?'preview':'draft-preview'),alt:row.topic}):h('div',{className:'ib-plot-local-full'},h('p',null,'本地草图，非验收图'),h(LivePlotPreview,{url:artifact(projectId,row,'data'),spec:row.workflow.spec,profile:row.workflow.profile,selected:'',onSelect:()=>{},change:()=>{},disabled:true}))),h('footer',{className:'ib-plot-editor-foot'},h('span',null,row.workflow.saved||row.workflow.draft?'Origin 原生图':'本地草图，非验收图'),button('下载 PNG',()=>download('preview'),!row.workflow.saved),button('下载 PDF',()=>download('pdf'),!row.workflow.saved),button('编辑画布',onEdit,false,true))));
}

function PlotWizard({row,layoutOnly=false,projectId,call,onAutoLayout,onClose,onRefresh,onRender,onSave}){
 const w=row.workflow,profile=w.profile,busy=busyStatus.has(w.status);
 const [step,setStep]=useState(w.spec?3:profile&&w.status!=='inspected'?2:1),[selected,setSelected]=useState(null),[sheet,setSheet]=useState(w.sheet||''),[header,setHeader]=useState(w.headerRow+1),[intent,setIntent]=useState(''),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false);
 const [topic,setTopic]=useState(row.topic);
 useEffect(()=>{if(w.spec)setStep(3);else if(profile)setStep(w.status==='inspected'?1:2);},[w.spec?.kind,profile?.normalizedPath,w.status==='inspected']);
 useEffect(()=>{if(profile)setSheet(profile.sheet);},[profile?.sheet]);
 const choices=profile?manualChartChoices(profile,w.recommendations):[],recommendationsKey=JSON.stringify(choices);
 useEffect(()=>{setSelected(choices[0]?{...choices[0]}:null);},[recommendationsKey]);
 const lock=useRef(false);
 const run=async work=>{if(lock.current)return;lock.current=true;setSubmitting(true);setError('');try{await work();}catch(reason){setError(reason.message);}finally{lock.current=false;setSubmitting(false);}};
 const disabled=busy||submitting;
 const recommend=(inspectOnly=false)=>void run(async()=>{setSelected(null);await call('plot_workspace_recommend',{request:{projectId,id:row.id,sheet:sheet||undefined,headerRow:Number(header)-1,intent,inspectOnly}});await onRefresh();});
 const defaultSpec=choice=>{
  const x=choice.xCol!==undefined?profile.columns[choice.xCol]?.name:'',y=choice.yCols.length===1?profile.columns[choice.yCols[0]]?.name:'Value';
  return plotSpecSchema.parse({kind:choice.kind,xCol:choice.xCol,yCols:choice.yCols,title:topic,xLabel:choice.kind==='bar'?y:choice.kind==='histogram'?profile.columns[choice.yCols[0]]?.name:x,yLabel:choice.kind==='bar'?x:choice.kind==='histogram'?'Frequency':y,showLegend:choice.yCols.length>1});
 };
 const begin=()=>void run(async()=>{
  await call('plot_records_update',{request:{id:row.id,patch:{topic:topic.trim()||row.topic}}});
  if(w.draft){await call('plot_workspace_edit',{request:{projectId,id:row.id,spec:defaultSpec(selected),revision:w.revision}});await onRefresh();}else await onRender(defaultSpec(selected));setStep(3);
 });
 const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const escape=e=>{if(e.key==='Escape'){e.stopPropagation();closeRef.current();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[]);
 return h('div',{className:'ib-plot-backdrop'},h('section',{className:'ib-plot-wizard',role:'dialog','aria-modal':true,'aria-label':'科研绘图向导'},
  h('header',{className:'ib-plot-wizard-head'},h('div',null,h('b',null,layoutOnly?'多面板排版 · '+row.topic:row.topic),h('small',null,w.raw.fileName)),button(busy?'稍后查看':'关闭',onClose)),
  !layoutOnly?h('nav',{className:'ib-plot-steps','aria-label':'绘图步骤'},...['导入数据与推荐','选择图样式','编辑画布与保存'].map((label,i)=>h('button',{key:i,'data-active':step===i+1,disabled:i===2&&!w.spec,onClick:()=>setStep(i+1)},h('span',null,i+1),label))):null,
  w.recommendationWarning?h('div',{className:'ib-plot-native-warning',role:'status'},w.recommendationWarning):null,
  (error||w.error)?h('div',{className:'ib-error',role:'alert'},error||w.error):null,
  busy?h('div',{className:'ib-plot-job',role:'status'},h('span',{className:'ib-plot-spinner'}),w.stage,w.status==='recommending'?button('跳过 AI，手动选图',()=>void run(async()=>{await call('plot_workspace_recommend',{request:{projectId,id:row.id,manualOnly:true}});await onRefresh();setStep(2);}),submitting):null):null,
  step===1?h('div',{className:'ib-plot-data'},h('h3',null,'原始数据'),h('div',{className:'ib-plot-data-file'},h('b',null,w.raw.fileName),h('span',null,(w.raw.byteLength/1024).toFixed(1)+' KB'),button('下载原始数据',()=>void run(()=>downloadVerifiedBinary(artifact(projectId,row,'raw'),{silentCancel:true})))),
   h('div',{className:'ib-plot-form-grid'},h('label',null,'绘图名称',h('input',{value:topic,onChange:e=>setTopic(e.target.value),disabled})),
    h('label',null,'工作表',h('select',{value:sheet,disabled:disabled||!!w.draft,onChange:e=>setSheet(e.target.value)},...(profile?.sheets||[sheet||'读取中']).map(name=>h('option',{key:name,value:name},name)))),
    h('label',null,'表头所在行（0 表示无表头）',h('input',{type:'number',min:0,max:101,value:header,disabled:disabled||!!w.draft,onChange:e=>setHeader(e.target.value)}))),
   h('label',{className:'ib-plot-intent'},'绘图目的（可选）',h('textarea',{value:intent,onChange:e=>setIntent(e.target.value),disabled:disabled||!!w.draft,placeholder:'例如：比较各样本的分布，或观察随时间的变化趋势'})),
   profile?h(DataProfile,{profile}):null,
   h('footer',null,button('预览所选数据',()=>recommend(true),disabled||!!w.draft),button('AI 推荐（可选）',()=>recommend(false),disabled||!!w.draft||!choices.length||sheet!==profile?.sheet||Number(header)-1!==w.headerRow),button('查看图样式',()=>setStep(2),disabled||!choices.length||sheet!==profile?.sheet||Number(header)-1!==w.headerRow,true))):null,
  step===2?h('div',{className:'ib-plot-choose'},h('div',{className:'ib-plot-choose-head'},h('h3',null,'全部适用图型（AI 仅作排序参考）'),h('p',null,profile?`${profile.rows} 行 · ${profile.columns.length} 列 · ${profile.sheet}，${w.recommendationSource==='ai'?'AI 排序供参考，全部适用图型均可选择':'可直接手动选择，无需 AI'}`:'正在读取数据结构…')),
   choices.length?h('div',{className:'ib-plot-recommendations'},...choices.map((choice,i)=>h('button',{key:choice.kind,className:'ib-plot-choice','data-selected':selected?.kind===choice.kind,disabled,onClick:()=>setSelected({...choice}),'aria-pressed':selected?.kind===choice.kind},h('span',{className:'ib-plot-rank'},String(i+1).padStart(2,'0')),h(ChartGlyph,{kind:choice.kind}),h('div',null,h('b',null,chartName(choice.kind)),w.recommendations.some(c=>c.kind===choice.kind)&&w.recommendationSource==='ai'?h('em',null,'AI 推荐'):null,h('p',null,choice.reason)),h('small',null,'样式示意')))):!busy?h('div',{className:'ib-plot-empty'},h('p',null,'未找到适用图型，请返回检查工作表、表头和数值列。')):null,
   selected&&profile?h('div',{className:'ib-plot-mapping'},h('h4',null,'确认数据列'),h(ColumnMapping,{profile,spec:selected,disabled,onChange:patch=>setSelected(old=>({...old,...patch}))}),h('p',{className:'ib-muted'},'保留输入行顺序与缺失值。此操作不执行平滑、拟合或统计检验。')):null,
   h('footer',null,button('返回数据',()=>setStep(1)),button(w.draft?'使用此样式设计':'生成 Origin 初稿',begin,disabled||!selected,true))):null,
  step===3?h(PlotCanvas,{row,layoutOnly,projectId,call,onAutoLayout:spec=>run(()=>onAutoLayout(spec)),onRender:spec=>run(()=>onRender(spec)),onSave:(spec,localPreviewBase64,confirmRefinement)=>run(()=>onSave(spec,localPreviewBase64,confirmRefinement)),disabled:submitting||w.status==='saving',renderDisabled:disabled,onRestore:(index,mode)=>run(async()=>{await call('plot_workspace_restore',{request:{projectId,id:row.id,index,mode,revision:w.revision}});await onRefresh();}),onDiscard:()=>run(async()=>{await call('plot_workspace_discard',{request:{projectId,id:row.id,revision:w.revision}});await onRefresh();setSelected(null);setStep(w.saved?3:2);})}):null));
}

function DataProfile({profile}){
 return h('div',{className:'ib-plot-profile'},h('p',null,`${profile.rows} 行 · ${profile.columns.length} 列`),h('div',{className:'ib-plot-table-scroll'},h('table',null,h('thead',null,h('tr',null,...profile.columns.map(col=>h('th',{key:col.index},col.name,h('small',null,typeName[col.type]))))),h('tbody',null,...profile.sample.map((row,i)=>h('tr',{key:i},...row.map((value,j)=>h('td',{key:j},value===null?'—':String(value)))))))),profile.warnings.length?h('details',null,h('summary',null,`数据提示（${profile.warnings.length}）`),...profile.warnings.map((text,i)=>h('p',{key:i},text))):null);
}

function ColumnMapping({profile,spec,onChange,disabled}){
 const numeric=profile.columns.filter(col=>col.type==='number'&&col.count>0),distribution=['box','histogram'].includes(spec.kind),allowedX=['line','line_symbol','scatter'].includes(spec.kind)?numeric:profile.columns.filter(col=>col.count>0);
 return h('div',{className:'ib-plot-column-map'},!distribution?h('label',null,'X 数据列',h('select',{'aria-label':'X 数据列',value:spec.xCol??'',disabled,onChange:e=>onChange({xCol:Number(e.target.value),yCols:spec.yCols.filter(i=>i!==Number(e.target.value))})},h('option',{value:'',disabled:true},'选择 X'),...allowedX.map(col=>h('option',{key:col.index,value:col.index},col.name)))):null,
  h('fieldset',{disabled},h('legend',null,spec.kind==='histogram'?'数据列（单选）':'Y 数据列'),...numeric.filter(col=>distribution||col.index!==spec.xCol).map(col=>h('label',{key:col.index},h('input',{type:spec.kind==='histogram'?'radio':'checkbox',name:'plot-y',checked:spec.yCols.includes(col.index),onChange:e=>onChange({yCols:spec.kind==='histogram'?[col.index]:e.target.checked?[...spec.yCols,col.index]:spec.yCols.filter(i=>i!==col.index)})}),col.name))),spec.yCols.length>1?h('div',{'aria-label':'绘图系列顺序'},h('b',null,'绘图顺序'),...spec.yCols.map((col,index)=>h('div',{key:col},h('span',null,profile.columns[col]?.name),button('↑',()=>{const next=[...spec.yCols];[next[index-1],next[index]]=[next[index],next[index-1]];onChange({yCols:next});},disabled||index===0),button('↓',()=>{const next=[...spec.yCols];[next[index+1],next[index]]=[next[index],next[index+1]];onChange({yCols:next});},disabled||index===spec.yCols.length-1)))):null);
}

function PlotCanvas({row,layoutOnly=false,projectId,call,onAutoLayout,onRender,onSave,onDiscard,onRestore,disabled,renderDisabled}){
 const w=row.workflow;
 const draftKey='ibm-plot-local:'+projectId+':'+row.id;
 const [spec,setSpec]=useState(()=>{try{const local=JSON.parse(localStorage.getItem(draftKey)||'null');if(local?.revision===w.revision)return plotSpecSchema.parse(local.spec);}catch{/* An invalid local draft falls back to the archived spec. */}return plotSpecSchema.parse(w.spec||w.savedSpec||{kind:'line',xCol:0,yCols:[1]});}),[selected,setSelected]=useState(layoutOnly?'layout':'canvas'),[zoom,setZoom]=useState(0),[history,setHistory]=useState([]),[future,setFuture]=useState([]),[error,setError]=useState('');
 const viewport=useRef(null),[imageRatio]=useState(1),[fitWidth,setFitWidth]=useState(450);
 const [autoBusy,setAutoBusy]=useState(false),[previewBusy,setPreviewBusy]=useState(false),editLock=useRef(false),expectedPreview=useRef(null);
 disabled=disabled||autoBusy;renderDisabled=renderDisabled||autoBusy;
 const lockPreview=()=>{editLock.current=true;expectedPreview.current=null;previewRequest.current.seq++;previewRequest.current.edited=true;previewRequest.current.lastHash='';setQuickError('');setPreviewBusy(true);};
 const unlockPreview=()=>{editLock.current=false;expectedPreview.current=null;setPreviewBusy(false);};
 const [version,setVersion]=useState(''),[specHash,setSpecHash]=useState(null),[nativePixels,setNativePixels]=useState(false),[imageWidth,setImageWidth]=useState(1800),[retryPreview,setRetryPreview]=useState(0);
 const previewRequest=useRef({clientId:crypto.randomUUID(),seq:0,edited:false,lastHash:''}),[quickError,setQuickError]=useState(''),[cachedPreview,setCachedPreview]=useState(null),currentHash=useRef(null);currentHash.current=specHash;
 let specText;try{specText=JSON.stringify(materializeNumericAxes(validatePlotSelection(plotSpecSchema.parse(spec),w.profile),w.profile));}catch{specText=JSON.stringify(spec);}
 useEffect(()=>{let active=true;setSpecHash(null);if(globalThis.crypto?.subtle)void crypto.subtle.digest('SHA-256',new TextEncoder().encode(specText)).then(bytes=>{if(active)setSpecHash([...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''));});return()=>{active=false;};},[specText]);
 useEffect(()=>{
  const request=previewRequest.current;
  if(!request.edited||!specHash||w.pendingRefinement||w.status==='saving'||request.lastHash===specHash)return;
  const timer=setTimeout(()=>{
   const parsed=plotSpecSchema.safeParse(spec);if(!parsed.success){setQuickError('请完成有效参数后重试');unlockPreview();return;}
   request.lastHash=specHash;const seq=++request.seq;let deadline;
   const work=call('plot_workspace_preview',{request:{projectId,id:row.id,spec:parsed.data,clientId:request.clientId,requestSeq:seq,wait:true}});
   void Promise.race([work,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('预览更新超时，可继续编辑或重试')),30000);})]).then(result=>{
    if(request.seq!==seq||currentHash.current!==specHash)return;
    setQuickError('');if(result.preview){expectedPreview.current=result.preview.renderId;setCachedPreview(result.preview);}
    else{unlockPreview();setQuickError(result.stale?'预览已被更新，请重试':'Origin 未返回预览图片');}
   }).catch(error=>{if(request.seq===seq&&currentHash.current===specHash){request.lastHash='';setQuickError(error.message);unlockPreview();}}).finally(()=>clearTimeout(deadline));
  },120);return()=>clearTimeout(timer);
 },[call,projectId,row.id,specText,specHash,w.pendingRefinement,w.status,retryPreview]);
 useEffect(()=>{const node=viewport.current;if(!node)return;const fit=()=>setFitWidth(Math.max(100,Math.min(node.clientWidth-40,(node.clientHeight-56)*imageRatio)));fit();const observer=new ResizeObserver(fit);observer.observe(node);return()=>observer.disconnect();},[imageRatio]);
 const baseline=useRef(w.revision),serverSpec=useRef(w.spec),specRef=useRef(spec);specRef.current=spec;
 useEffect(()=>{if(baseline.current!==w.revision||!same(serverSpec.current,w.spec)){baseline.current=w.revision;serverSpec.current=w.spec;previewRequest.current.seq++;previewRequest.current.edited=false;previewRequest.current.lastHash='';setCachedPreview(null);unlockPreview();if(w.spec){setSpec(plotSpecSchema.parse(w.spec));setHistory([]);setFuture([]);}}},[w.revision,w.spec]);
 useEffect(()=>{try{if(same(spec,w.spec))localStorage.removeItem(draftKey);else localStorage.setItem(draftKey,JSON.stringify({revision:w.revision,spec}));}catch{/* Storage quota/privacy settings must not interrupt editing. */}},[spec,w.revision,w.spec,draftKey]);
 const change=patch=>{if(disabled||same({...specRef.current,...patch},specRef.current))return;lockPreview();setNativePixels(false);setHistory(old=>[...old,specRef.current].slice(-50));setFuture([]);setSpec(old=>({...old,...patch}));};
 const execute=async(save,confirmRefinement=false)=>{
  try{const parsed=plotSpecSchema.parse(spec);if(!parsed.yCols.length)throw Error('至少选择一个 Y 数据列');setError('');await (save?onSave(parsed,undefined,confirmRefinement):onRender(parsed));}
  catch(reason){setError(reason.issues?.[0]?.message||reason.message);}
 };
 const image=w.draft||w.saved,meta=image?.previewMeta,fresh=!!w.draft&&(meta?!!specHash&&meta.specHash===specHash:same(spec,plotSpecSchema.parse(w.renderedSpec||w.savedSpec||w.spec))),progress=w.workingPreview&&specHash===w.workingPreview.specHash?w.workingPreview:null,currentQuick=!w.pendingRefinement?(cachedPreview?.specHash===specHash?cachedPreview:w.quickPreview?.specHash===specHash?w.quickPreview:null):null;
 // Keep the last completed render on screen while the next edit is pending.
 // A preview for the current spec still takes precedence over the final image.
 const quick=currentQuick||(!fresh&&!w.pendingRefinement?(cachedPreview||w.quickPreview):null),quickRow=quick?{...row,workflow:{...w,quickPreview:quick}}:row;
 const objectName=selected.startsWith('axis-title:')?selected.slice(11).toUpperCase()+' 坐标轴标题':selected.startsWith('ticks:')?selected.slice(6).toUpperCase()+' 轴数字刻度':selected.startsWith('series')?'数据系列':selected.startsWith('note:')?'标注':{canvas:'画布',x:'X 坐标轴',y:'Y 坐标轴',title:'图标题',legend:'图例',annotations:'文字与标注',layout:'多面板排版'}[selected];
 return h('div',{className:'ib-plot-editor','data-native-pixels':nativePixels||undefined,'aria-busy':previewBusy},h('div',{className:'ib-plot-canvas-toolbar'},
  h(OriginConnection,{projectId,call}),
  button('撤销',()=>{lockPreview();previewRequest.current.edited=true;const previous=history.at(-1);setFuture(old=>[spec,...old]);setSpec(previous);setHistory(old=>old.slice(0,-1));},disabled||!history.length),
  button('重做',()=>{lockPreview();previewRequest.current.edited=true;setHistory(old=>[...old,spec]);setSpec(future[0]);setFuture(old=>old.slice(1));},disabled||!future.length),
  w.history?.length?h('label',null,'历史版本 ',h('select',{'aria-label':'已保存的绘图版本',value:version,onChange:e=>setVersion(e.target.value)},h('option',{value:''},'选择版本'),...w.history.map((row,index)=>h('option',{key:index,value:String(index)},dateText(row.savedAt))))):null,
  w.history?.length?button('恢复原图',()=>onRestore(Number(version),'original'),renderDisabled||version===''):null,
  w.history?.length?button('按旧配置重绘',()=>onRestore(Number(version),'redraw'),renderDisabled||version===''):null,
  h('label',null,'缩放 ',h('select',{'aria-label':'画布缩放',value:zoom,onChange:e=>setZoom(Number(e.target.value))},h('option',{value:0},'适合画布'),...[75,100,125,150,200].map(value=>h('option',{key:value,value},value+'%')))),
  h('span',{className:'ib-plot-render-state'},previewBusy?'旧图待更新，可继续编辑…':progress?'Origin 正在生成图片':fresh||currentQuick?'Origin 图片已更新':'旧图待更新'),button('原始像素',()=>setNativePixels(value=>!value),!image&&!quick),button('刷新图片',()=>execute(false),renderDisabled,true),button(autoBusy?'Auto…':'Auto',async()=>{setAutoBusy(true);try{await onAutoLayout(plotSpecSchema.parse(spec));}catch(reason){setError(reason.message);}finally{setAutoBusy(false);}},renderDisabled||!!w.pendingRefinement||!image,false,{title:'按课题组作图规范自动排版现有元素'})),
  nativePixels?h('p',{className:'ib-muted'},'按图片像素宽度显示；浏览器缩放和设备像素比可能影响屏幕截图，逐像素验证应比较导出文件。'):null,
  error?h('p',{className:'ib-error',role:'alert'},error):null,
  quickError||w.quickStatus?.error?h('p',{className:'ib-plot-native-warning',role:'status'},'快速预览不可用：'+(quickError||w.quickStatus.error)+'；保留上次图片。',button('重试预览',()=>{lockPreview();setRetryPreview(value=>value+1);},disabled)):null,
  image?.pixelVerification?.equal===false?h('p',{className:'ib-plot-native-warning',role:'status'},'本次进度图与最终图的像素不同；请以最终导出图为准。'):null,
  image?.readback?.layoutFallback?h('p',{className:'ib-plot-native-warning',role:'status'},image.readback.layoutFallback):null,
  w.pendingRefinement?h('p',{className:'ib-plot-native-warning',role:'status'},'精修候选尚未保存。请核对文字是否重叠、裁切以及整体可读性；位置分数不能证明视觉效果改善。'):null,
  image?.readback?.collision?.status==='detected'?h('p',{className:'ib-plot-native-warning',role:'alert'},'估算检测到坐标轴文字重叠或裁切，不能保存此图，请调整并重新生成。'):null,


  h('div',{className:'ib-plot-editor-body'},h('div',{className:'ib-plot-object-tree','aria-label':'图形对象'},h('b',null,'图形对象'),...(layoutOnly?[["layout","多面板排版"]]:[["canvas","画布"],["title","图标题"],["x","X 坐标轴"],["y","Y 坐标轴"],["series","数据系列"],...spec.yCols.map(col=>['series:'+col,w.profile?.columns[col]?.name||'系列 '+col]),["legend","图例"],["annotations","文字与标注"]]).map(([id,name])=>h('button',{key:id,'data-selected':selected===id||(['x','y'].includes(id)&&[id,'ticks:'+id,'axis-title:'+id].includes(selected)),onClick:()=>setSelected(id)},name))),
   h('div',{className:'ib-plot-canvas-scroll',ref:viewport},h('div',{className:'ib-plot-paper',style:{width:nativePixels?imageWidth+'px':zoom?zoom+'%':fitWidth+'px'}},(image||progress||quick)?h('figure',null,h('div',{className:'ib-plot-native-frame',style:{filter:previewBusy?'grayscale(1)':undefined,opacity:previewBusy?.45:1,pointerEvents:undefined},'aria-busy':previewBusy},h('img',{src:artifact(projectId,quick?quickRow:row,progress?'working-preview':quick?'quick-preview':w.draft?'draft-preview':'preview'),alt:'Origin 绘图',draggable:false,onLoad:e=>{setImageWidth(e.currentTarget.naturalWidth||1800);if(expectedPreview.current&&new URL(e.currentTarget.src).searchParams.get('r')===expectedPreview.current)unlockPreview();},onError:()=>{if(editLock.current){setQuickError('Origin 图片加载失败，请重试');unlockPreview();}},style:{width:'100%',height:'auto'}}),!nativePixels&&!progress&&!w.pendingRefinement&&(quick?.scene||image?.scene)?.layers?.length?h(NativeSceneOverlay,{url:artifact(projectId,quick?quickRow:row,quick?.svg?'quick-scene':w.draft?'draft-scene':'scene'),scene:quick?.scene||image.scene,canvas:quick?.canvas||(!quick?image.canvas:undefined),spec,selected,onSelect:layoutOnly?()=>{}:setSelected,change,disabled,panelEditing:layoutOnly}):null)):h('p',{role:'status'},'Origin 正在生成图片…'))),
   h('aside',{className:'ib-plot-properties'},h('h4',null,objectName),h(BufferedEditorProperties,{selected,spec,change,profile:w.profile,disabled,scene:image?.scene,onSelect:setSelected}),
   )),
  h('footer',{className:'ib-plot-editor-foot'},w.status==='failed'&&w.error?h('span',{className:'ib-error',role:'alert'},'保存 / 绘图失败：'+w.error):null,h('span',null,w.savedAt?'上次保存 '+dateText(w.savedAt):'初版尚未确认保存'),button(w.saved?'放弃本次修改':'重新选择图样式',onDiscard,renderDisabled),w.pendingRefinement&&fresh?button('确认精修候选并保存',()=>execute(true,true),renderDisabled,true):button('保存 Origin 工程',()=>execute(true),renderDisabled,true)));
}

