import React,{useEffect,useLayoutEffect,useRef,useState,useCallback} from 'react';
import ReactDOM from 'react-dom';
import {h} from './h.js';
import {downloadVerifiedBinary,downloadOfficeArtifact} from './lib.js';
import {readerIdentity,readerRuntime,readerPreferredMode,loadPdf,pdfTypes,readerWorker,pdfResources,makeRange} from './reader-tab.js';
import {PdfFlow} from './reader-pdf-flow.js';
import {createPdfScrollSync} from './reader-scroll-sync.js';
import {PdfMaterial} from './reader-material.js';
import pdfViewerStyles from '../vendor/pdfjs/web/pdf_viewer.css';
const decode=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const spinner=()=>h('span',{className:'ib-reader-spinner','aria-hidden':true});
const loading=label=>h('div',{className:'ib-reader-loading',role:'status'},spinner(),label);
const icons={minus:'M5 12h14',plus:'M5 12h14M12 5v14',hand:'M8 13V7a2 2 0 0 1 4 0v5V5a2 2 0 0 1 4 0v7V8a2 2 0 0 1 4 0v7c0 4-3 6-6 6h-2c-2 0-3-1-4-3l-4-5a2 2 0 0 1 3-2l1 2',text:'M5 5h14M12 5v14M8 19h8',download:'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',previous:'m14 6-6 6 6 6',next:'m10 6 6 6-6 6'};
const icon=name=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:icons[name]}));

export function ReaderBody({useTabInfo,renderFactorySlot,sessionId}){
 const {tab}=useTabInfo(),request=readerIdentity(tab?.contentId),key=tab?.contentId;
 const [state,setState]=useState({loading:true}),[doc,setDoc]=useState(null),[zhDoc,setZhDoc]=useState(null),[mode,setMode]=useState('original');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0);
 const [linked,setLinked]=useState(true),[stacked,setStacked]=useState(false),[hand,setHand]=useState(false);
 const [zoom,setZoom]=useState({original:1,zh:1}),[pages,setPages]=useState({original:1,zh:1}),[viewLoading,setViewLoading]=useState({original:true,zh:false});
 const [wantTranslation,setWantTranslation]=useState(false),[translationAttempt,setTranslationAttempt]=useState(0),[zhError,setZhError]=useState('');
 const [materials,setMaterials]=useState([]),[choices,setChoices]=useState({original:'pdf',zh:''}),[materialDocs,setMaterialDocs]=useState({});
 const onDocument=useCallback((side,pdf)=>setMaterialDocs(old=>({...old,[side]:pdf})),[]);
 const [host]=useState(()=>{const el=document.createElement('div');el.className='ib-reader-host';return el;});
 const slot=useRef(),left=useRef(),right=useRef(),fullscreen=useRef(),extraDocs=useRef(new Set()),leases=useRef(new Set()),ownsFullscreen=useRef(false);
 const preferences=useRef();preferences.current={mode,linked,pdfLinked:!materials.some(row=>Object.values(choices).includes(row.id)&&row.format!=='pdf')};
 const scroll=useRef();if(!scroll.current)scroll.current=createPdfScrollSync({flowFor:side=>side==='zh'?right.current:left.current,linked:()=>preferences.current.mode==='dual'&&preferences.current.linked&&preferences.current.pdfLinked,
  onPosition:positions=>setPages(old=>old.original===positions.original.page&&old.zh===positions.zh.page?old:{original:positions.original.page,zh:positions.zh.page})});
 const runtime=readerRuntime(),call=(method,args)=>runtime.call(method,{request:args}),onError=useCallback(error=>setError(error.message??String(error)),[]);
 const onScroll=useCallback((side,flow)=>scroll.current.onScroll(side,flow),[]),onLayout=useCallback(side=>scroll.current.restore(side),[]);
 const onLoading=useCallback((side,value)=>setViewLoading(old=>old[side]===value?old:{...old,[side]:value}),[]);
 useEffect(()=>()=>{scroll.current.dispose();host.remove();},[host]);
 // A stable portal host moves between sidebar and body; React keeps both panes alive.
 useLayoutEffect(()=>{
  host.dataset.fullscreen=String(mode==='dual');const destination=mode==='dual'?document.body:slot.current;if(destination&&host.parentElement!==destination)destination.append(host);
  if(mode==='dual'){scroll.current.restore('original');scroll.current.restore('zh');}else scroll.current.restore(mode==='zh'?'zh':'original');
  if(mode==='dual'&&fullscreen.current?.requestFullscreen&&!document.fullscreenElement){void fullscreen.current.requestFullscreen().then(()=>{
   if(preferences.current.mode==='dual'&&host.isConnected)ownsFullscreen.current=true;
   else if(document.fullscreenElement===fullscreen.current)void document.exitFullscreen().catch(()=>{});
  }).catch(()=>{});}
 },[mode,host]);
 useEffect(()=>{const opened=event=>{if(event.detail.address===key)setRefresh(value=>value+1);};window.addEventListener('ibm-reader-open',opened);return()=>window.removeEventListener('ibm-reader-open',opened);},[key]);
 useEffect(()=>{let alive=true;setMaterials([]);setMaterialDocs({});void call('tasks_reader_materials',request).then(result=>{if(!alive)return;const list=result.materials??[];setMaterials(list);setChoices({original:list.find(row=>row.id===(request.kind??'pdf'))?.id??list[0]?.id??'pdf',zh:list.find(row=>row.translationId&&row.kind===request.kind)?.id??list.find(row=>row.id!==(request.kind??'pdf'))?.id??request.kind??'pdf'});}).catch(onError);return()=>{alive=false;};},[key,refresh,state.translation?.status]);
 useEffect(()=>{
  let alive=true,task,port,range,opened;scroll.current.reset();setState({loading:true});setDoc(null);setZhDoc(null);setMode(readerPreferredMode(key));setError('');setZhError('');setWantTranslation(false);setTranslationAttempt(0);setPages({original:1,zh:1});setZoom({original:1,zh:1});
  void(async()=>{
   await loadPdf();if(!alive)return;const {getDocument,PDFWorker,GlobalWorkerOptions}=pdfTypes(),workerUrl=readerWorker();GlobalWorkerOptions.workerSrc=workerUrl;
   opened=await call('tasks_reader_open',request);if(!alive){if(opened.lease)await call('tasks_reader_close',{...request,lease:opened.lease});return;}
   setState({...opened,sourceFormat:opened.format,archiveName:opened.fileName,loading:false});
   const preferred=readerPreferredMode(key);if(['report','ppt'].includes(preferred)||opened.translation?.status==='completed'){setMode(preferred);setWantTranslation(['zh','dual'].includes(preferred));}
   if(opened.format!=='pdf')return;
   port=new Worker(workerUrl,{type:'module'});range=makeRange(request,opened,runtime.call);range.onError=error=>{if(alive){onError(error);void task?.destroy();}};
   task=getDocument({range,rangeChunkSize:262144,disableAutoFetch:true,disableStream:true,worker:new PDFWorker({port}),...pdfResources(call)});
   const pdf=await task.promise;if(alive)setDoc(pdf);else await pdf.destroy();
  })().catch(error=>{if(alive)setState({loading:false,error:error.message});});
  return()=>{
   alive=false;range?.abort();void task?.destroy();port?.terminate();for(const pdf of extraDocs.current)void pdf.destroy().catch(()=>{});extraDocs.current.clear();
   if(readerRuntime()){for(const lease of leases.current)void call('tasks_reader_close',{...request,lease}).catch(()=>{});leases.current.clear();if(opened?.lease)void call('tasks_reader_close',{...request,lease:opened.lease}).catch(()=>{});}
   const owned=ownsFullscreen.current;ownsFullscreen.current=false;if(owned&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{});
  };
 },[key,refresh]);
 const translation=state.translation,tid=translation?.id,readable=translation?.status==='completed'?translation:state.completedTranslation,readingId=readable?.id;
 useEffect(()=>{if(!tid)return;let alive=true,timer;const poll=async()=>{try{const result=await call('tasks_translation_read',{...request,translationId:tid,limit:1});if(!alive)return;setState(old=>({...old,translation:result.translation}));if(result.translation.status==='completed')return;}catch{/* Retry transient polling failures while this reader remains open. */}if(alive)timer=setTimeout(poll,1500);};void poll();return()=>{alive=false;clearTimeout(timer);};},[key,tid]);
 useEffect(()=>{
  if(state.loading||!wantTranslation||!readingId)return;
  let alive=true,task,range,opened,loaded=false;setError('');setZhError('');setZhDoc(null);
  void(async()=>{
   opened=await call('tasks_reader_open',{...request,translationId:readingId});if(!alive){await call('tasks_reader_close',{...request,lease:opened.lease});return;}
   leases.current.add(opened.lease);setState(old=>({...old,completedTranslation:opened.translation,translation:old.translation?.id===readingId?opened.translation:old.translation}));
   range=makeRange(request,opened,runtime.call);range.onError=error=>{if(alive){onError(error);setZhError(error.message);void task?.destroy();}};
   task=pdfTypes().getDocument({range,rangeChunkSize:262144,disableAutoFetch:true,disableStream:true,...pdfResources(call)});
   const pdf=await task.promise;if(alive){loaded=true;extraDocs.current.add(pdf);setZhDoc(pdf);}else await pdf.destroy();
  })().catch(error=>{if(alive){setZhError(error.message??String(error));onError(error);}});
  // Changing display mode no longer aborts an in-flight translation PDF load.
  return()=>{alive=false;if(!loaded){range?.abort();if(task)void task.destroy();if(opened?.lease&&leases.current.delete(opened.lease))void call('tasks_reader_close',{...request,lease:opened.lease}).catch(()=>{});}};
 },[key,refresh,readingId,wantTranslation,state.loading,translationAttempt]);
 const changeMode=next=>{
  if(next==='zh'||next==='dual'){setWantTranslation(true);if(zhError)setTranslationAttempt(value=>value+1);}
  if(next===preferences.current.mode)return;
  const previous=preferences.current.mode,side=previous==='dual'?scroll.current.lastSide:previous==='zh'?'zh':'original',anchor=scroll.current.capture(side);
  if(linked){const target=next==='zh'?'zh':'original';scroll.current.move(target,anchor,next==='dual');}
  if(['report','ppt'].includes(next)){setPages(old=>({...old,original:1}));scroll.current.move('original',{page:1,fraction:0});}preferences.current.mode=next;setViewLoading(old=>({...old,...(next==='dual'?{original:true,zh:true}:{[next==='zh'?'zh':'original']:true})}));setMode(next);
  if(next!=='dual'){const owned=ownsFullscreen.current;ownsFullscreen.current=false;if(owned&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{});}
 };
 const exitDual=()=>changeMode('zh');
 useEffect(()=>{if(mode!=='dual')return;const keydown=event=>{if(event.key==='Escape')exitDual();};const exited=()=>{if(ownsFullscreen.current&&!document.fullscreenElement){ownsFullscreen.current=false;changeMode('zh');}};window.addEventListener('keydown',keydown);document.addEventListener('fullscreenchange',exited);return()=>{window.removeEventListener('keydown',keydown);document.removeEventListener('fullscreenchange',exited);};},[mode,linked,zhError]);
 const translate=async(improve=false)=>{setBusy(true);let created;try{created=await call('tasks_translation_create',{...request,improve:improve===true});setState(old=>({...old,completedTranslation:old.translation?.status==='completed'?old.translation:old.completedTranslation,translation:created.translation}));if(created.translation.status==='completed')changeMode('zh');else if(!created.reused)await runtime.translate(request,created.translation.id);else setError('任务正在进行，请查看翻译对话。');}catch(error){if(created&&!created.reused)await call('tasks_translation_cancel',{...request,translationId:created.translation.id}).catch(()=>{});onError(error);}finally{setBusy(false);}};
 const zoomTo=(side,value)=>{scroll.current.move(side,scroll.current.capture(side));setZoom(old=>linked?{original:value,zh:value}:{...old,[side]:value});};
 const navigate=(side,number)=>{const d=panePdf(side),n=Math.max(1,Math.min(d?.numPages??1,number||1));scroll.current.move(side,{page:n,fraction:0});};
 const save=async side=>{const material=selected(side),kind=material?.kind??request.kind,translationId=material?.translationId??(side==='zh'&&!material?readingId:null);
  if(material?.officeKind)return downloadOfficeArtifact(`/api/lab-artifacts?kind=${material.officeKind==='docx'?'report&format=docx':'ppt'}&reportId=${encodeURIComponent(material.reportId)}`);
  return downloadVerifiedBinary(translationId?`/api/lab-artifacts?kind=translation&material=${kind}&projectId=${encodeURIComponent(request.projectId)}&bundleId=${encodeURIComponent(request.bundleId)}&translationId=${encodeURIComponent(translationId)}`:`/api/lab-artifacts?kind=${kind}&bundleId=${encodeURIComponent(request.bundleId)}`);};
 const search=async()=>{const side=mode==='dual'?scroll.current.lastSide:mode==='zh'?'zh':'original',pdf=panePdf(side);if(!pdf||!query.trim())return;for(let i=0;i<pdf.numPages;i++){const n=(pages[side]+i-1)%pdf.numPages+1,content=await(await pdf.getPage(n)).getTextContent();if(content.items.map(x=>x.str??'').join(' ').toLowerCase().includes(query.toLowerCase())){navigate(side,n);return;}}setError('没有找到该文本');};
 const button=(label,onClick,disabled=false,active=false,title=label)=>h('button',{type:'button',className:'ib-act','data-active':active||undefined,onClick,disabled,title,'aria-label':typeof title==='string'?title:undefined},label);
 const selected=side=>mode==='dual'?materials.find(row=>row.id===choices[side]):side==='original'&&['report','ppt'].includes(mode)?materials.find(row=>row.officeKind===(mode==='ppt'?'pptx':'docx')):null;
 const builtin=side=>{const material=selected(side);return !material||(side==='original'?material.id===(request.kind??'pdf'):material.translationId===readingId&&material.kind===request.kind);};
 const panePdf=side=>builtin(side)?side==='zh'?zhDoc:doc:materialDocs[side];
 const office=side=>selected(side)&&selected(side).format!=='pdf';
 const modeLoading=mode==='dual'?viewLoading.original||viewLoading.zh:viewLoading[mode==='zh'?'zh':'original'];
 const modeButton=(label,next,disabled=false)=>h('button',{type:'button',className:'ib-act','data-active':mode===next||undefined,'aria-busy':mode===next&&modeLoading||undefined,onClick:()=>changeMode(next),disabled},mode===next&&modeLoading?spinner():null,label);
 const toolbar=side=>{
  const pdf=panePdf(side),material=selected(side);
  const selector=mode==='dual'?h('select',{className:'ib-material-select','aria-label':side+' 阅读材料',value:choices[side],onChange:event=>{const id=event.target.value;setChoices(old=>({...old,[side]:id}));setPages(old=>({...old,[side]:1}));scroll.current.move(side,{page:1,fraction:0});setViewLoading(old=>({...old,[side]:true}));}},materials.map(row=>h('option',{key:row.id,value:row.id},row.label))):h('span',{className:'ib-pdf-language'},material?.label??(side==='zh'?'中文 PDF':'原文 PDF'));
  return h('div',{className:'ib-pdf-toolbar',role:'toolbar','aria-label':(material?.label??side)+' 阅读工具'},
   selector,
   h('div',{className:'ib-toolbar-group'},button(icon('minus'),()=>zoomTo(side,Math.max(.5,zoom[side]-.25)),zoom[side]<=.5,false,'缩小'),h('select',{'aria-label':side+' 缩放',value:zoom[side],onChange:event=>zoomTo(side,Number(event.target.value))},Array.from({length:11},(_,i)=>.5+i*.25).map(n=>h('option',{key:n,value:n},n===1?'适合宽度':Math.round(n*100)+'%'))),button(icon('plus'),()=>zoomTo(side,Math.min(3,zoom[side]+.25)),zoom[side]>=3,false,'放大')),
   h('div',{className:'ib-toolbar-group ib-toolbar-modes'},button(icon('hand'),()=>setHand(true),false,hand,'抓手拖动'),button(icon('text'),()=>setHand(false),false,!hand,'选择文字')),
   h('div',{className:'ib-toolbar-group ib-toolbar-pages'},button(icon('previous'),()=>navigate(side,pages[side]-1),!pdf||pages[side]<=1,false,'上一页'),h('input',{'aria-label':side+' PDF 页码',type:'number',min:1,max:pdf?.numPages??1,value:pages[side],onChange:event=>navigate(side,Number(event.target.value))}),h('small',null,'/ '+(pdf?.numPages??'…')),button(icon('next'),()=>navigate(side,pages[side]+1),!pdf||pages[side]>=pdf.numPages,false,'下一页')),
   button(icon('download'),()=>void save(side).catch(onError),!pdf&&!material?.officeKind,false,'下载 '+(material?.officeKind==='docx'?'精读报告（.docx）':material?.officeKind==='pptx'?'PPT（.pptx）':material?.label??(side==='zh'?'中文 PDF':'原文 PDF'))));
 };
 const pane=side=>{const active=mode==='dual'||mode===side||side==='original'&&['report','ppt'].includes(mode),material=selected(side),props={side,zoom:zoom[side],active,scrollRef:side==='zh'?right:left,onScroll,onError,hand,onLayout,onLoading};return h('section',{className:'ib-pdf-pane',key:side,hidden:!active,'aria-busy':active&&viewLoading[side]},toolbar(side),builtin(side)?h(PdfFlow,{...props,doc:side==='zh'?zhDoc:doc,failed:side==='zh'&&!!zhError}):h(PdfMaterial,{key:material.id,material,request,onDocument,...props}),h('span',{className:'ib-pdf-page-indicator'},pages[side]+' / '+(panePdf(side)?.numPages??'…')));};
 const content=h('div',{ref:fullscreen,className:'ib-reader'+(mode==='dual'?' ib-reader-fullscreen':''),'data-reader-mode':mode},
  state.loading?loading('正在读取已归档文献…'):state.error&&!['report','ppt'].includes(mode)?h('div',{className:'ib-reader-error',role:'alert'},'无法打开文献：'+state.error):h(React.Fragment,null,
   h('header',{className:'ib-reader-header'},h('span',{title:state.title},state.title),mode==='dual'?button('退出全屏',exitDual):null),
   h('nav',{className:'ib-reader-controls'},modeButton('原文','original'),modeButton('中文','zh',!readingId),modeButton('精读','report',!materials.some(row=>row.officeKind==='docx')),modeButton('PPT','ppt',!materials.some(row=>row.officeKind==='pptx')),modeButton('全屏对照','dual',!materials.length),translation?.status!=='completed'?button(['queued','running'].includes(translation?.status)?'翻译中…':'翻译',()=>void translate(),busy||state.sourceFormat!=='pdf'||['queued','running'].includes(translation?.status)):null,['queued','running'].includes(translation?.status)?button('取消翻译',async()=>{try{const result=await call('tasks_translation_cancel',{...request,translationId:tid});setState(old=>({...old,translation:result.translation}));}catch(error){onError(error);}}):null,mode==='dual'?h(React.Fragment,null,h('label',null,h('input',{type:'checkbox',checked:linked,disabled:office('original')||office('zh'),onChange:e=>{const value=e.target.checked;preferences.current.linked=value;setLinked(value);if(value)scroll.current.move(scroll.current.lastSide,scroll.current.capture());}}),'双屏关联'),h('label',null,h('input',{type:'checkbox',checked:stacked,onChange:e=>{scroll.current.capture();setStacked(e.target.checked);}}),'上下视图')):null,h('input',{'aria-label':'查找 PDF 文本',placeholder:'查找文本',value:query,onChange:e=>setQuery(e.target.value),onKeyDown:e=>{if(e.key==='Enter')void search().catch(onError);}}),button('查找',()=>void search().catch(onError),!panePdf(mode==='dual'?scroll.current.lastSide:mode==='zh'?'zh':'original'))),
   error?h('div',{className:'ib-reader-error',role:'alert'},error):null,
   translation&&translation.status!=='completed'?h('small',{className:'ib-reader-status'},translation.stage+(translation.totalBlocks?` · ${translation.completedBlocks??0}/${translation.totalBlocks} 段`:'')+(translation.error?' · '+translation.error:'')):null,
   state.format==='pdf'||mode==='dual'||['report','ppt'].includes(mode)?h('div',{className:'ib-pdf-panes','data-stacked':stacked&&mode==='dual'||undefined},pane('original'),pane('zh'),modeLoading?h('div',{className:'ib-reader-view-status',role:'status','aria-live':'polite'},spinner(),'正在加载'+(mode==='dual'?'对照视图':mode==='zh'?'译文':mode==='report'?'精读':mode==='ppt'?'PPT':'原文')+'…'):null):null,
   state.format==='zip'&&mode!=='dual'&&!['report','ppt'].includes(mode)?h('div',{className:'ib-reader-files'},button('保存 SI',()=>void save('original').catch(onError)),h('p',null,'SI 文件列表'),(state.entries??[]).map(entry=>h('div',{key:entry.index},entry.name,' · '+Math.round(entry.bytes/1024)+' KB',entry.pdf?button('阅读 PDF',async()=>{try{const file=await call('tasks_reader_zip_pdf',{...request,index:entry.index}),pdf=await pdfTypes().getDocument({data:decode(file.base64),...pdfResources(call)}).promise;extraDocs.current.add(pdf);setDoc(pdf);setState(old=>({...old,format:'pdf',fileName:file.name}));}catch(error){onError(error);}}):null))):null,
   state.sourceFormat==='zip'&&state.format==='pdf'?button('返回 SI 文件列表',()=>{setDoc(null);void doc?.destroy().catch(()=>{});extraDocs.current.delete(doc);setState(old=>({...old,format:'zip'}));}):null,
   state.format==='unsupported'&&mode!=='dual'&&!['report','ppt'].includes(mode)?h('p',null,'此格式请保存后使用对应软件打开。',button('保存材料',()=>void save('original').catch(onError))):null));
 return h(React.Fragment,null,h('div',{className:'ib-reader-mount'},h('div',{ref:slot,className:'ib-reader-slot',hidden:mode==='dual'}),mode==='dual'?h('div',{className:'ib-reader'},'材料对照已全屏打开',button('返回侧栏',exitDual)):null),ReactDOM.createPortal(content,host));
}

export const readerStyles=pdfViewerStyles+`
.ib-reader-mount,.ib-reader-slot,.ib-reader-host{height:100%;min-height:0;min-width:0}.ib-reader-slot[hidden]{display:none}.ib-reader-host[data-fullscreen=true]{position:fixed;inset:0;z-index:2147483000}
.ib-reader{font-family:system-ui,Segoe UI,Microsoft YaHei,sans-serif;font-size:12px;display:flex;flex-direction:column;height:100%;min-height:0;background:#fff;color:#303744;overflow:hidden}
.ib-reader-fullscreen{position:fixed;inset:0;z-index:2147483000;width:100vw;height:100vh}
.ib-reader-header{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #e1e5eb;gap:8px;min-height:30px;box-sizing:border-box}.ib-reader-header>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.ib-reader-controls,.ib-pdf-toolbar{display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:4px 6px;border-bottom:1px solid #e1e5eb;flex:none;background:#fff;min-height:30px;box-sizing:border-box}
.ib-reader-controls label{display:flex;align-items:center;gap:3px;white-space:nowrap}.ib-reader .ib-act{font:inherit;border:1px solid transparent;border-radius:3px;background:transparent;color:inherit;padding:3px 7px;cursor:pointer;white-space:nowrap}.ib-reader .ib-act:hover{background:#eef1f5}.ib-reader .ib-act[data-active=true]{background:#dde5ee;color:#21455e}.ib-reader button:disabled{opacity:.4;cursor:default}
.ib-reader input,.ib-reader select{font:inherit;background:#fff;color:inherit;border:1px solid #dce1e8;border-radius:3px;padding:3px;min-width:0}.ib-reader input[type=number]{width:42px}.ib-reader input[aria-label="查找 PDF 文本"]{width:85px}.ib-pdf-toolbar select{width:85px}.ib-pdf-language{font-weight:500;color:#6a7380;white-space:nowrap}.ib-pdf-toolbar small{white-space:nowrap}
.ib-office-material,.ib-office-sidebar{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}.ib-pdf-panes[hidden]{display:none}.ib-pdf-toolbar .ib-material-select{width:150px;max-width:100%}.ib-pdf-panes{position:relative;display:flex;flex:1;min-height:0;min-width:0}.ib-pdf-panes[data-stacked=true]{flex-direction:column}.ib-pdf-pane{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;flex:1;border-right:1px solid #dce1e8}.ib-pdf-pane[hidden]{display:none}.ib-pdf-flow{position:relative;overflow:auto;flex:1;min-height:0;background:#f0f2f5;overscroll-behavior:contain;scrollbar-gutter:stable;scroll-behavior:auto;padding:12px;box-sizing:border-box;overflow-anchor:none}.ib-pdf-flow[data-hand=true]{cursor:grab;user-select:none}.ib-pdf-flow[data-hand=true]:active{cursor:grabbing}.ib-pdf-flow[data-hand=true] .ib-reader-text-layer{pointer-events:none}
.ib-pdf-page{position:relative;background:#fff;box-shadow:0 0 0 1px #e0e3e7,0 2px 5px #0000000b;margin:0 auto 14px;flex:none}.ib-pdf-page canvas{display:block;width:100%;height:100%}.ib-page-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:#73808e;background:#ffffffb3;pointer-events:none}.ib-pdf-page-indicator{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:4px;background:#56616bd9;color:white;pointer-events:none}.ib-reader-status,.ib-reader-error{padding:5px 10px}.ib-reader-error{color:#af3333;background:#fff0ee}.ib-reader-files{overflow:auto;padding:10px}.ib-reader-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:30px;text-align:center;color:#73808e}
.ib-reader-spinner{display:inline-block;width:12px;height:12px;flex:none;box-sizing:border-box;border:2px solid #b6c6d3;border-top-color:#34718e;border-radius:50%;animation:ib-reader-spin .8s linear infinite}.ib-act .ib-reader-spinner{margin-right:5px;vertical-align:-2px}.ib-reader-view-status{position:absolute;top:45px;right:20px;display:flex;align-items:center;gap:7px;padding:7px 10px;background:#fffffff0;border:1px solid #dce1e8;border-radius:5px;color:#597081;box-shadow:0 2px 8px #0000000c;pointer-events:none;z-index:2}@keyframes ib-reader-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ib-reader-spinner{animation:none}}
.ib-pdf-toolbar{gap:8px;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;min-height:48px}.ib-pdf-toolbar .ib-act{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;color:#526277;flex:none}.ib-pdf-toolbar .ib-act:hover{background:#e7edf3;color:#1f5164}.ib-pdf-toolbar .ib-act[data-active=true]{background:#e0f1ef;color:#137c72;box-shadow:inset 0 0 0 1px #c2e2df}.ib-toolbar-group{display:flex;align-items:center;gap:3px;padding-right:8px;border-right:1px solid #dfe6ed;flex:none}.ib-toolbar-pages{border-right:0;padding-right:0;margin-left:auto;gap:5px}.ib-pdf-toolbar select{height:30px;border-radius:7px;background:#fff;padding:3px 7px;border-color:#dce4ec;cursor:pointer}.ib-pdf-toolbar .ib-material-select{width:128px}.ib-pdf-toolbar input[type=number]{height:28px;box-sizing:border-box;text-align:center;border-radius:7px;width:42px;appearance:textfield;-moz-appearance:textfield}.ib-pdf-toolbar input[type=number]::-webkit-inner-spin-button{appearance:none}.ib-pdf-toolbar small{color:#7a8796;min-width:24px}.ib-pdf-language{color:#33465b;font-weight:600;padding-right:4px;max-width:140px;overflow:hidden;text-overflow:ellipsis}.ib-pdf-toolbar .ib-act:focus-visible,.ib-pdf-toolbar select:focus-visible,.ib-pdf-toolbar input:focus-visible{outline:2px solid #278c85;outline-offset:2px}@media(max-width:650px){.ib-pdf-toolbar{gap:5px;padding:6px}.ib-toolbar-group{padding-right:4px}.ib-pdf-toolbar .ib-act{width:27px}.ib-pdf-toolbar .ib-material-select{width:112px}.ib-toolbar-pages{margin-left:0}}
.ib-pdf-viewport{position:relative;flex:1;min-height:0;min-width:0}.ib-reader .ib-pdf-flow{position:absolute;inset:0;padding:0}.ib-reader .pdfViewer{padding:12px;box-sizing:border-box}.ib-reader .pdfViewer .page{margin:0 auto 14px;border:0;background:#fff;box-shadow:0 0 0 1px #e0e3e7,0 2px 5px #0000000b}.ib-reader{--loading-icon-delay:0s;color-scheme:light}
`;
