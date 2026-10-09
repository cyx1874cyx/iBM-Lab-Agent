import React,{useEffect,useMemo,useState} from 'react';
import {h} from './h.js';
import {readerRuntime,loadPdf,pdfTypes,pdfResources,makeRange} from './reader-tab.js';
import {PdfFlow} from './reader-pdf-flow.js';

// Office belongs to DSH's renderer slot: conversion, caching, cancellation,
// pagination and text selection stay owned by the shipped document preview.
export function OfficeMaterial({material,request,sessionId,useTabInfo,renderFactorySlot,side='sidebar'}){
 const [result,setResult]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const controller=useMemo(()=>new AbortController(),[material.id,side]);
 const parent=useTabInfo();
 const info=useMemo(()=>({...parent,tab:{...parent.tab,id:parent.tab.id+':'+side+':'+material.id,signal:controller.signal}}),[parent,controller,side,material.id]);
 const hook=useMemo(()=>()=>info,[info]);
 useEffect(()=>()=>controller.abort(),[controller]);
 useEffect(()=>{let alive=true;setResult(null);setError('');void readerRuntime().call('tasks_reader_materials',{request:{...request,select:material.id}}).then(value=>{if(alive)setResult(value.material);}).catch(error=>{if(alive)setError(error.message);});return()=>{alive=false;};},[material.id,revision]);
 const content=useMemo(()=>({kind:'renderer',revision,loaded:()=>{},failed:()=>{},reload:()=>setRevision(n=>n+1)}),[revision]);
 if(error)return h('div',{className:'ib-reader-error',role:'alert'},error,h('button',{onClick:()=>setRevision(n=>n+1)},'重试'));
 if(!result)return h('div',{className:'ib-reader-loading',role:'status'},h('span',{className:'ib-reader-spinner'}),'正在加载'+material.label+'…');
 if(!sessionId||!renderFactorySlot)return h('div',{className:'ib-reader-error',role:'alert'},'DSH 文档预览尚未就绪，请重新打开文献。');
 const encode=segment=>encodeURIComponent(segment).replace(/%3A/gi,':');
 const address='dsh-resource://file/session/'+encode(sessionId)+'/'+result.path.replaceAll('\\','/').split('/').map(encode).join('/');
 return h('div',{className:'ib-office-material','data-office-material':material.format},renderFactorySlot('ibm.office.preview',{
  resourceAddress:address,content,wrap:false,scrollportRef:()=>{},addResource:()=>{},setResources:()=>{},useTabInfo:hook
 }));
}

export function PdfMaterial({material,request,onDocument,...props}){
 const [doc,setDoc]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let alive=true,opened,range,task;const runtime=readerRuntime(),identity={...request,kind:material.kind??request.kind,translationId:material.translationId,materialId:material.officeKind?material.id:undefined};
  setDoc(null);setError('');onDocument(props.side,null);props.onLoading(props.side,true);
  void(async()=>{
   await loadPdf();opened=await runtime.call('tasks_reader_open',{request:identity});if(!alive)return;
   if(opened.format!=='pdf')throw Error('该材料无法作为 PDF 预览');
   range=makeRange(identity,opened,runtime.call);range.onError=error=>{if(alive){setError(error.message);props.onLoading(props.side,false);void task?.destroy();}};
   task=pdfTypes().getDocument({range,rangeChunkSize:262144,disableAutoFetch:true,disableStream:true,...pdfResources((method,args)=>runtime.call(method,{request:args}))});
   const pdf=await task.promise;if(alive){setDoc(pdf);onDocument(props.side,pdf);}else await pdf.destroy();
  })().catch(error=>{if(alive){setError(error.message);props.onLoading(props.side,false);}}).finally(()=>{if(!alive&&opened?.lease)void runtime.call('tasks_reader_close',{request:{...identity,lease:opened.lease}}).catch(()=>{});});
  return()=>{alive=false;range?.abort();void task?.destroy();if(opened?.lease)void runtime.call('tasks_reader_close',{request:{...identity,lease:opened.lease}}).catch(()=>{});};
 },[material.id,attempt]);
 return error?h('div',{className:'ib-reader-error',role:'alert'},error,h('button',{onClick:()=>setAttempt(n=>n+1)},'重试')):h(PdfFlow,{...props,doc});
}
