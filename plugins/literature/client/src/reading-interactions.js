import {useCallback,useEffect,useRef,useState} from 'react';

export const READING_DRAG_TYPE='application/x-ibm-reading-entries';
const controls='button,input,select,textarea,a,[contenteditable=true]';
const internal=event=>!Array.from(event.dataTransfer?.types??[]).includes('Files')&&Array.from(event.dataTransfer?.types??[]).includes(READING_DRAG_TYPE);

export function useReadingInteractions({projectId,reports,visibleReports,bundles,root,call,notify,onChanged,setFolder,onLocate,onContextMenu}){
 const [selected,setSelected]=useState([]),[dragging,setDragging]=useState([]),[target,setTarget]=useState(null),[folderTarget,setFolderTarget]=useState(null),[moving,setMoving]=useState(false);
 const anchor=useRef(null),pointerY=useRef(null);
 const movable=report=>!['queued','running','rejected'].includes(bundles[report.bundleId]?.pdfIntake?.status);
 const visibleIds=visibleReports.filter(movable).map(row=>row.id);
 const clear=useCallback(()=>{setSelected([]);anchor.current=null;},[]);
 useEffect(()=>{const ids=new Set(reports.map(row=>row.id));setSelected(old=>old.every(id=>ids.has(id))?old:old.filter(id=>ids.has(id)));},[reports]);
 useEffect(()=>{
  if(!dragging.length)return undefined;
  let host=root.current?.parentElement;
  while(host&&(!/(auto|scroll)/.test(getComputedStyle(host).overflowY)||host.scrollHeight<=host.clientHeight))host=host.parentElement;
  host??=document.scrollingElement;
  let frame;
  const tick=()=>{
   const rect=host===document.scrollingElement?{top:0,bottom:innerHeight}:host.getBoundingClientRect(),y=pointerY.current;
   if(y!==null){const speed=y<rect.top+65?-16:y>rect.bottom-65?16:0;if(speed)host.scrollTop+=speed;}
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[dragging,root]);
 const resetDrag=()=>{setDragging([]);setTarget(null);setFolderTarget(null);pointerY.current=null;};
 const choose=(event,id)=>{
  if(event.target.closest(controls))return;
  if(event.shiftKey){
   event.preventDefault();
   const start=visibleIds.indexOf(anchor.current),end=visibleIds.indexOf(id),range=start<0?[id]:visibleIds.slice(Math.min(start,end),Math.max(start,end)+1);
   setSelected(old=>event.ctrlKey||event.metaKey?[...new Set([...old,...range])]:range);
   if(start<0)anchor.current=id;
  }else if(event.ctrlKey||event.metaKey){setSelected(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id]);anchor.current=id;}
  else{setSelected([id]);anchor.current=id;}
 };
 const readDrop=event=>{
  try{
   const payload=JSON.parse(event.dataTransfer.getData(READING_DRAG_TYPE));
   if(payload.projectId!==projectId||!Array.isArray(payload.reportIds)||!payload.reportIds.length||payload.reportIds.some(id=>!reports.some(row=>row.id===id&&movable(row))))throw Error('条目不存在、正在识别或不属于当前课题');
   return [...new Set(payload.reportIds)];
  }catch(error){notify(error.message);return [];}
 };
 const drop=async(event,fields)=>{
  if(!internal(event))return;
  event.preventDefault();event.stopPropagation();const ids=readDrop(event);resetDrag();
  if(!ids.length||ids.includes(fields.targetId))return;
  setMoving(true);
  try{
   await call('tasks_reading_move',{request:{projectId,reportIds:ids,...fields}});
   await onChanged?.();
   setSelected(ids);
   if(Object.hasOwn(fields,'folderId'))setFolder(fields.folderId||'unfiled');
   onLocate?.(reports.find(row=>row.id===ids[0]));
  }catch(error){notify(error.message);await onChanged?.();}finally{setMoving(false);}
 };
 const location=(event,id)=>({id,position:event.clientY<event.currentTarget.getBoundingClientRect().top+event.currentTarget.getBoundingClientRect().height/2?'before':'after'});
 const context=(event,report,keyboard=false)=>{
  if(!movable(report)||moving)return;
  event.preventDefault();event.stopPropagation();
  const ids=selected.includes(report.id)?reports.filter(row=>selected.includes(row.id)&&movable(row)).map(row=>row.id):[report.id];
  if(!selected.includes(report.id)){setSelected(ids);anchor.current=report.id;}
  const rect=event.currentTarget.getBoundingClientRect();
  onContextMenu?.({x:keyboard?rect.left+20:event.clientX,y:keyboard?rect.top+20:event.clientY,reportIds:ids});
 };
 const rowProps=report=>({
  'data-report-id':report.id,'data-selected':selected.includes(report.id)?'true':undefined,'data-dragging-entry':dragging.includes(report.id)?'true':undefined,'data-drop-position':target?.id===report.id?target.position:undefined,
  role:'option','aria-selected':selected.includes(report.id),tabIndex:0,draggable:movable(report)&&!moving,
  onClick:event=>{if(movable(report))choose(event,report.id);},
  onContextMenu:event=>context(event,report),
  onKeyDown:event=>{
   if(event.target!==event.currentTarget)return;
   if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))context(event,report,true);
   else if(event.key==='Escape'){event.preventDefault();clear();}
   else if([' ','Enter'].includes(event.key)){event.preventDefault();choose(event,report.id);}
  },
  onDragStart:event=>{
   if(event.target.closest(controls)||!movable(report)||moving){event.preventDefault();return;}
   event.stopPropagation();const ids=selected.includes(report.id)?reports.filter(row=>selected.includes(row.id)&&movable(row)).map(row=>row.id):[report.id];
   if(!selected.includes(report.id)){setSelected(ids);anchor.current=report.id;}
   event.dataTransfer.setData(READING_DRAG_TYPE,JSON.stringify({projectId,reportIds:ids}));event.dataTransfer.effectAllowed='move';pointerY.current=event.clientY;setDragging(ids);
  },
  onDragOver:event=>{if(!internal(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';pointerY.current=event.clientY;const next=location(event,report.id);setTarget(old=>old?.id===next.id&&old.position===next.position?old:next);},
  onDragLeave:event=>{if(!event.currentTarget.contains(event.relatedTarget))setTarget(old=>old?.id===report.id?null:old);},
  onDrop:event=>{const next=location(event,report.id);void drop(event,{targetId:report.id,position:next.position});},onDragEnd:resetDrag
 });
 const folderProps=folder=>folder.id==='all'?{}:{
  'data-folder-id':folder.id,'data-drop-folder':folderTarget===folder.id?'true':undefined,
  onDragOver:event=>{if(!internal(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';pointerY.current=event.clientY;setFolderTarget(folder.id);setTarget(null);},
  onDragLeave:event=>{if(!event.currentTarget.contains(event.relatedTarget))setFolderTarget(old=>old===folder.id?null:old);},
  onDrop:event=>void drop(event,{folderId:folder.id==='unfiled'?null:folder.id})
 };
 return {rowProps,folderProps,selectedCount:selected.length,clear,moving};
}
