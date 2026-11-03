import {useState,useEffect,useCallback,useRef} from 'react';
import {createPortal} from 'react-dom';
import {h} from 'dsh-lab-agent/client-sdk';
import {KetcherEditorModal} from 'dsh-lab-agent/client-sdk';
import {ketcherRenderSmiles} from 'dsh-lab-agent/client-sdk';
import {SpinSvg} from 'dsh-lab-agent/client-sdk';
import {ReadingNoteSvg} from 'dsh-lab-agent/client-sdk';
import {EntryConversationButton} from 'dsh-lab-agent/client-sdk';
import {ReadingContextMenu} from 'dsh-lab-agent/client-sdk';
import {NmrInputZone} from './nmr-input-zone.js';
import {NmrSimulationSettings} from './nmr-simulation-settings.js';
import {NmrDeleteDialog} from './nmr-delete-dialog.js';
import {fileToBase64} from 'dsh-lab-agent/client-sdk';
import {nativeArtifact} from 'dsh-lab-agent/client-sdk';
import {isNmrData,isNmrStructure,nmrDropFiles} from './nmr-files.js';

const dataDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
const artifactUrl=(projectId,row,slot)=>`/api/lab-artifacts?kind=characterization&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(row.id)}&slot=${slot}`;
const entryDate=row=>String(row.date||row.createdAt||'').slice(0,10);
const miniIcon=kind=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
 kind==='simulation'?h('path',{d:'M3 19h18M5 17h3l2-9 2 9h2l1-5 1 5h3M17 3v4M15 5h4'}):kind==='structure'?h('path',{d:'m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 3 5 3v6l-5 3-5-3V9l5-3Z'}):kind==='folder'?h('path',{d:'M3 7V5h6l2 2h10v12H3V7Zm0 3h18'}):
 h('path',{d:kind==='raw'?'M3 4v16h18M6 15h3l2-8 3 10 2-6h4':'M3 4v16h18M6 15h3l2-8 3 10 2-6h4M15 4l2 2 4-4'}));

function NmrStructure({row,projectId,call,large=false}){
 const [preview,setPreview]=useState({loading:true});
 useEffect(()=>{
  let alive=true;setPreview({loading:true});
  const work=async()=>{
   const source=await call('characterization_nmr_structure',{request:{projectId,taskId:row.id}});
   if(!source.source){if(alive)setPreview({message:source.message||'结构待补充'});return;}
   const image=await ketcherRenderSmiles(source.source,{natural:true,preserveFormat:true});
   if(alive)setPreview(image?{image}:{message:'结构预览失败，可重新打开或补充 MOL / SMILES'});
  };
  void work().catch(error=>{if(alive)setPreview({message:error.message});});
  return()=>{alive=false;};
 },[call,projectId,row.id,row.structurePath,row.structureSha256,row.compound?.smiles]);
 return h('div',{className:'ib-nmr-molecule','data-large':large||undefined,'data-state':preview.loading?'loading':preview.image?'loaded':'missing'},preview.image?h('img',{src:preview.image,alt:row.compound?.name||row.title||'输入结构式'}):preview.loading?h(SpinSvg,null):h('span',null,preview.message));
}

export function NmrPanel({projectId,call,onSubmitTask,onOpenConversation,nmrRows=[]}){
 const [simulation,setSimulation]=useState(false);
 const [deleteRow,setDeleteRow]=useState(null);
 const [deleteMode,setDeleteMode]=useState('all');
 const [tasks,setTasks]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true);
 const [form,setForm]=useState(null),[preview,setPreview]=useState(null),[drawing,setDrawing]=useState(false),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false),[menu,setMenu]=useState(null);
 const lock=useRef(false),dragDepth=useRef(0);
 const closeMenu=useCallback(()=>setMenu(null),[]);
 const refresh=useCallback(async()=>{const result=await call('characterization_list',{request:{projectId}});setTasks((result.tasks||[]).filter(row=>row.kind==='nmr'));setLoading(false);},[call,projectId]);
 useEffect(()=>{
  let alive=true,timer;
  const poll=async()=>{try{const result=await call('characterization_list',{request:{projectId}});if(alive){setTasks((result.tasks||[]).filter(row=>row.kind==='nmr'));setLoading(false);}}catch(reason){if(alive){setError(reason.message);setLoading(false);}}finally{if(alive)timer=setTimeout(poll,1500);}};
  void poll();return()=>{alive=false;clearTimeout(timer);};
 },[projectId,call]);
 useEffect(()=>{setForm(null);setPreview(null);setMenu(null);setDeleteRow(null);},[projectId]);
 const run=async work=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(reason){setError(reason.message);}finally{lock.current=false;setBusy(false);}};
 const upload=async file=>{
  if(!file.size||file.size>25*1024*1024)throw Error('文件为空或超过 25 MB');
  const result=await call('project_file_upload',{request:{projectId,name:file.name,base64:await fileToBase64(file)}});
  const path=result.file?.sourcePath||result.file?.path;if(!path)throw Error('上传结果未返回文件路径');return path;
 };
 const newForm=row=>({id:row?.id||'nmr-'+crypto.randomUUID(),existing:!!row,dataFile:null,structureFile:null,title:row?.compound?.name||row?.title||'',inputPath:row?.inputPath||'',structurePath:row?.structurePath||'',compoundName:row?.compound?.name||'',smiles:row?.compound?.smiles||'',formula:row?.compound?.formula||'',casNumber:row?.compound?.casNumber||'',nucleus:row?.nucleus||'1H',deuteratedSolvent:row?.deuteratedSolvent||'',instructions:row?.instructions||'按输入结构完成 Mnova 核磁标峰，保存标峰后的可编辑核磁文件与分析报告。'});
 const save=async value=>call('characterization_nmr_save',{request:{projectId,taskId:value.id,title:value.title||value.compoundName,inputPath:value.inputPath||undefined,structurePath:value.structurePath||undefined,compound:{name:value.compoundName||value.title,smiles:value.smiles,formula:value.formula,casNumber:value.casNumber},nucleus:value.nucleus,deuteratedSolvent:value.deuteratedSolvent,instructions:value.instructions}});
 const start=async row=>{
  const result=await call('characterization_nmr_start',{request:{projectId,taskId:row.id}});
  await refresh();
  try{await onSubmitTask(result.prompt,{taskId:row.id,attempt:result.task.attempt});}
  catch(reason){await call('characterization_dispatch_failed',{request:{projectId,taskId:row.id,attempt:result.task.attempt,error:reason.message}});await refresh();throw reason;}
 };
 const startSimulation=async(row,parameters)=>{
  setSimulation(false);
  await run(async()=>{
   const result=await call('characterization_nmr_simulation_start',{request:{projectId,taskId:row.id,parameters}});
   await refresh();
   try{await onSubmitTask(result.prompt);}
   catch(reason){await call('characterization_nmr_simulation_dispatch_failed',{request:{projectId,taskId:row.id,jobId:result.job.id,error:reason.message}});await refresh();throw reason;}
  });
 };
 const ingest=(filesPromise,target,slot)=>{if(lock.current){void Promise.resolve(filesPromise).catch(()=>{});return;}return run(async()=>{
  const files=Array.from(await filesPromise),data=files.filter(file=>isNmrData(file.name)),structures=files.filter(file=>isNmrStructure(file.name));
  if(!files.length)return;
  if(slot==='data'&&(files.length!==1||data.length!==1))throw Error('核磁原始数据区域请选择一个 FID ZIP、Mnova、JCAMP 文件或拖入完整 FID 文件夹');
  if(slot==='structure'&&(files.length!==1||structures.length!==1))throw Error('分子结构式区域请选择一个 MOL、SDF、CDXML 等结构文件，或点击绘制');
  if(data.length+structures.length!==files.length)throw Error('请拖入 FID 目录/ZIP、Mnova、JCAMP 或机器可读结构文件');
  if(data.length>1||structures.length>1)throw Error('一次导入一组核磁数据与对应结构；请分别导入多组数据，避免结构配错');
  const value=target?.compoundName!==undefined?{...target}:newForm(target);
  value.title||=(data[0]||structures[0]).name.replace(/\.[^.]+$/,'');
  if(data[0]){value.dataFile=data[0];value.inputPath='';}
  if(structures[0]){value.structureFile=structures[0];value.structurePath='';value.smiles='';}
  setForm(value);
 });};
 const field=(key,label)=>h('label',{className:'ib-field'},h('span',null,label),h('input',{value:form[key],disabled:busy,onChange:event=>setForm(old=>({...old,[key]:event.target.value}))}));
 const dataReady=!!(form?.dataFile||form?.inputPath),structureReady=!!(form?.structureFile||form?.structurePath||form?.smiles.trim());
 const saveForm=()=>run(async()=>{
  if(!structureReady)throw Error('请先选择分子结构式');
  const value={...form};
  if(value.dataFile)value.inputPath=await upload(value.dataFile);
  if(value.structureFile)value.structurePath=await upload(value.structureFile);
  await save(value);setForm(null);await refresh();
 });
 const selectedName=(file,path)=>file?.name||path?.split(/[\\/]/).at(-1)||'';
 const openMnova=(row,slot)=>run(async()=>{
  const result=await nativeArtifact('openMnova',{url:artifactUrl(projectId,row,slot)});
  if(!result)throw Error('请在 iBM Lab 桌面版中使用 Mnova 打开核磁文件');
  setNotice('已在 Mnova 中打开'+(slot==='raw'?'输入核磁文件':'标峰后的核磁文件'));
 });
 const openFolder=row=>run(async()=>{
  const result=await nativeArtifact('openNmrFolder',{url:artifactUrl(projectId,row,'folder')});
  if(!result)throw Error('请在 iBM Lab 桌面版中打开条目文件夹');
 });
 const remove=(ids,mode='all')=>{const row=rows.find(row=>row.id===ids[0]);if(row){setDeleteMode(mode);setDeleteRow(row);}};
 const confirmRemove=deleteFiles=>void run(async()=>{
  const result=await call('characterization_remove',{request:{projectId,taskId:deleteRow.id,kind:'nmr',deleteFiles,mode:deleteMode}});
  setDeleteRow(null);await refresh();
  setNotice((deleteMode==='outputs'?'所选产出文件已删除，条目已保留。':'条目及其登记文件已删除。')+(result.removed?.missingFiles?.length?` ${result.removed.missingFiles.length} 个文件原本不存在。`:''));
 });
 const rows=[...tasks,...nmrRows.filter(row=>!tasks.some(task=>task.id===row.id)).map(row=>({...row,status:row.status==='prepared'?'completed':row.status,artifacts:{spectrum:row.spectrumPath?{path:row.spectrumPath}:undefined,report:row.reportPath?{path:row.reportPath}:undefined}}))];
 const openStructure=row=>{if(!row.structurePath&&!row.compound?.smiles&&row.status==='draft')setForm(newForm(row));else setPreview({row,kind:'structure'});};
 const iconButton=(label,icon,ready,onClick,disabled=false)=>h('button',{className:'ib-icon-btn','aria-label':label,title:label,'data-ready':ready?'true':'false',disabled:disabled||busy,onClick},icon);
 return h('section',{className:'ib-nmr-panel ib-literature-drop','data-dragging':dragging?'true':undefined,'aria-label':'核磁解析，支持拖入核磁数据与结构文件',
  onDragEnter:event=>{if(dataDrag(event)){event.preventDefault();event.stopPropagation();dragDepth.current++;setDragging(true);}},
  onDragOver:event=>{if(dataDrag(event)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';}},
  onDragLeave:event=>{if(dataDrag(event)){event.preventDefault();event.stopPropagation();if(--dragDepth.current<=0){dragDepth.current=0;setDragging(false);}}},
  onDrop:event=>{if(!dataDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth.current=0;setDragging(false);const target=tasks.find(row=>row.id===event.target.closest?.('[data-nmr-id]')?.dataset.nmrId&&row.status==='draft');const files=nmrDropFiles(event.dataTransfer);void ingest(files,target);}
 },h('div',{className:'ib-group-head'},h('h3',null,'核磁解析'),h('button',{className:'ib-act',disabled:busy,onClick:()=>setForm(newForm())},'+ 新建条目'),h('span',{className:'ib-group-count'},`${rows.length} 条`)),
 simulation?h(NmrSimulationSettings,{key:simulation.id,row:simulation,onClose:()=>setSimulation(false),onGenerate:parameters=>void startSimulation(simulation,parameters)}):null,
 deleteRow?h(NmrDeleteDialog,{row:deleteRow,mode:deleteMode,busy,error,onCancel:()=>{setDeleteRow(null);setError('');},onDelete:confirmRemove}):null,
 error?h('div',{className:'ib-error',role:'alert'},error):null,notice?h('p',{className:'ib-muted',role:'status'},notice):null,
 dragging?h('div',{className:'ib-literature-drop-label',role:'status'},'松开以选择核磁输入文件'):null,
 busy?h('div',{className:'ib-nmr-working',role:'status'},h(SpinSvg,null),'正在处理…'):null,
 rows.length?h('div',{className:'ib-nmr-list'},rows.map(row=>h('article',{key:row.id,className:'ib-nmr-entry','data-nmr-id':row.id,'data-status':row.status,tabIndex:0,title:row.status==='draft'?'双击编辑输入':undefined,
  onDoubleClick:event=>{if(!event.target.closest('button')&&row.status==='draft')setForm(newForm(row));},onKeyDown:event=>{if(event.target===event.currentTarget&&event.key==='Enter'&&row.status==='draft')setForm(newForm(row));},
  onContextMenu:event=>{event.preventDefault();setMenu({x:event.clientX,y:event.clientY,reportIds:[row.id]});}
 },h(NmrStructure,{row,projectId,call}),h('div',{className:'ib-nmr-identity'},h('b',null,row.compound?.name||row.title||row.name),row.compound?.formula?h('span',null,row.compound.formula):null,row.compound?.casNumber?h('span',null,'CAS '+row.compound.casNumber):null,
 ['draft','failed','queued','running'].includes(row.status)?h('button',{className:'ib-nmr-analysis','data-active':['queued','running'].includes(row.status)?'true':'false',disabled:busy,
  title:['queued','running'].includes(row.status)?'单击终止分析':'开始分析',
  onClick:()=>void run(async()=>{
   if(['queued','running'].includes(row.status)){await call('characterization_nmr_cancel',{request:{projectId,taskId:row.id,attempt:row.attempt}});await refresh();}
   else if(!row.inputPath||!row.structurePath&&!row.compound?.smiles)setForm(newForm(row));
   else await start(row);
  })},['queued','running'].includes(row.status)?h(SpinSvg,null):null,['queued','running'].includes(row.status)?'正在分析':'开始分析'):h('small',null,row.status==='completed'?'已完成':row.status),
 h('time',{className:'ib-nmr-date',dateTime:entryDate(row)||undefined},entryDate(row)?'日期：'+entryDate(row):'日期未记录'),
 row.error?h('span',{className:'ib-error'},row.error):null,row.simulationJob?.status==='failed'?h('span',{className:'ib-error'},'模拟失败：'+row.simulationJob.error):null,row.simulationJob?.status==='completed'&&(row.simulationJob.assignmentSummary?.unresolved||row.simulationJob.assignmentSummary?.unmatched)?h('span',{className:'ib-muted'},`模拟谱部分标注：${row.simulationJob.assignmentSummary.assigned} 处已标，${row.simulationJob.assignmentSummary.unresolved} 个峰及 ${row.simulationJob.assignmentSummary.unmatched} 个环境待确认`):null),
 h('div',{className:'ib-nmr-actions'},
  iconButton(['queued','running'].includes(row.simulationJob?.status)?'模拟中':'模拟谱 · Mnova',['queued','running'].includes(row.simulationJob?.status)?h(SpinSvg,null):miniIcon('simulation'),!!row.simulationArtifact,()=>row.simulationArtifact?void openMnova(row,'simulation'):setSimulation(row),!row.structurePath&&!row.compound?.smiles||['queued','running'].includes(row.simulationJob?.status)),
  iconButton('输入结构式',miniIcon('structure'),!!row.structurePath||!!row.compound?.smiles,()=>openStructure(row)),
  iconButton('核磁原始文件 · Mnova',miniIcon('raw'),!!row.inputPath||!!row.fidPath,()=>row.inputPath||row.fidPath?void openMnova(row,'raw'):setForm(newForm(row))),
  iconButton('标峰后核磁文件 · Mnova',miniIcon('spectrum'),!!row.artifacts?.spectrum,()=>void openMnova(row,'spectrum'),!row.artifacts?.spectrum),
  iconButton('标峰报告 · 软件内预览',h(ReadingNoteSvg,null),!!row.artifacts?.report,()=>setPreview({row,kind:'report'}),!row.artifacts?.report),
  iconButton('打开条目文件夹',miniIcon('folder'),true,()=>void openFolder(row)),
  h(EntryConversationButton,{sessionId:row.sessionId||row.conversationSessionId,onOpen:onOpenConversation,notify:setError})
 )))):h('div',{className:'ib-lit-empty'},loading?'正在读取核磁条目…':'点击新建条目，选择核磁原始数据和分子结构式。'),
 form?createPortal(h('div',{className:'ib-overlay ib-nmr-modal-backdrop'},h('section',{className:'ib-nmr-form',role:'dialog','aria-modal':true,'aria-label':'核磁条目输入',onDragOver:event=>{if(dataDrag(event)){event.preventDefault();event.stopPropagation();}},onDrop:event=>{if(dataDrag(event)){event.preventDefault();event.stopPropagation();void ingest(nmrDropFiles(event.dataTransfer),form);}}},
 h('h3',null,form.existing?'补全核磁输入':'新建核磁条目'),
 h('div',{className:'ib-nmr-input-zones'},
  h(NmrInputZone,{kind:'data',name:selectedName(form.dataFile,form.inputPath),busy,onFiles:files=>void ingest(files,form,'data')}),
  h(NmrInputZone,{kind:'structure',name:selectedName(form.structureFile,form.structurePath),drawn:!!form.smiles.trim(),busy,onFiles:files=>void ingest(files,form,'structure'),onDraw:()=>setDrawing(true)})),
 h('div',{className:'ib-form-grid'},field('compoundName','化合物名称（可选）'),field('nucleus','谱核')),
 h('details',{className:'ib-nmr-more-inputs'},h('summary',null,'更多信息'),h('div',{className:'ib-form-grid'},field('formula','分子式（可选）'),field('casNumber','CAS 号（若有）'),field('deuteratedSolvent','氘代溶剂'),field('smiles','结构 SMILES')),h('label',{className:'ib-field'},'分析要求',h('textarea',{value:form.instructions,disabled:busy,onChange:event=>setForm(old=>({...old,instructions:event.target.value}))}))),
 error?h('div',{className:'ib-error',role:'alert'},error):null,
 h('div',{className:'ib-form-foot'},h('span',{className:'ib-nmr-input-progress',role:'status'},`已选择 ${Number(dataReady)+Number(structureReady)} / 2 项（结构必选）`),h('button',{className:'ib-act',disabled:busy,onClick:()=>{setForm(null);setError('');}},'取消'),h('button',{className:'ib-act','data-kind':'accent',disabled:busy||!structureReady,onClick:()=>void saveForm()},busy?'正在创建…':form.existing?'保存输入':'新建条目')))),document.body):null,
 drawing&&form?createPortal(h('div',{className:'ib-overlay ib-nmr-drawing'},h(KetcherEditorModal,{entry:{name:form.compoundName||form.title||'目标结构',smiles:form.smiles},onSave:smiles=>{if(!smiles?.trim()){setError('请先绘制分子结构');return;}setForm(old=>({...old,smiles,structurePath:'',structureFile:null}));setDrawing(false);setError('');},onCancel:()=>setDrawing(false)})),document.body):null,
 preview?createPortal(h('div',{className:'ib-overlay ib-nmr-modal-backdrop',onClick:event=>{if(event.target===event.currentTarget)setPreview(null);}},h('section',{className:'ib-nmr-preview',role:'dialog','aria-modal':true,'aria-label':preview.kind==='structure'?'输入结构式预览':'标峰报告预览'},h('header',null,h('b',null,preview.row.compound?.name||preview.row.title),h('button',{className:'ib-act',onClick:()=>setPreview(null)},'关闭')),preview.kind==='structure'?h(NmrStructure,{row:preview.row,projectId,call,large:true}):h('iframe',{title:'核磁标峰报告',src:artifactUrl(projectId,preview.row,'report')+'&preview=1&v='+encodeURIComponent(preview.row.updatedAt||'current')}))),document.body):null,
 menu?h(ReadingContextMenu,{menu,onClose:closeMenu,onDelete:ids=>remove(ids,'all'),onDeleteOutputs:ids=>remove(ids,'outputs'),label:'核磁条目操作'}):null
 );
}
