import React,{useEffect,useLayoutEffect,useRef,useCallback} from 'react';
import {h} from './h.js';
import {loadPdfViewer} from './reader-tab.js';
import {pdfPosition} from './reader-scroll-sync.js';

// PDF.js owns page rendering, text layers, visible-page priority and canvas cache.
// This adapter only connects its events to our toolbar, loading state and anchors.
export const PdfFlow=React.memo(function PdfFlow({doc,side,zoom,active,scrollRef,onScroll,onError,hand,onLayout,onLoading,failed}){
 const viewerElement=useRef(),engine=useRef(),drag=useRef(),frame=useRef(0),current=useRef();
 current.current={active,zoom,failed,onLayout,onLoading,onError};
 const report=useCallback(()=>{
  const flow=scrollRef.current,props=current.current,view=engine.current?.viewer;
  if(!props.active||!flow?.clientHeight){props.onLoading(side,false);return;}
  if(!view?.pagesCount){props.onLoading(side,!props.failed);return;}
  let pending=engine.current.scaleReadyAt>performance.now();const start=pdfPosition(flow,0).page,end=pdfPosition(flow,flow.clientHeight-1).page;
  for(let n=start;n<=end;n++){const page=view.getPageView(n-1);if(!page||page.div.offsetTop>=flow.scrollTop+flow.clientHeight||page.div.offsetTop+page.div.offsetHeight<=flow.scrollTop)continue;if(page.renderingState!==engine.current.finished&&page.div.dataset.pdfState!=='error'){pending=true;break;}}
  props.onLoading(side,pending);
 },[side,scrollRef]);
 const schedule=useCallback(()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;report();});},[report]);
 const resize=useCallback(()=>{
  const flow=scrollRef.current,props=current.current,handle=engine.current;if(!props.active||!flow?.clientWidth||!handle?.viewer.pagesCount)return;
  const scale=Math.max(.1,Math.round((flow.clientWidth-24)/handle.pageWidth/(96/72)*props.zoom*100)/100);
  if(!handle.scaled){handle.viewer.currentScale=scale;handle.scaled=true;}
  else if(Math.abs(handle.viewer.currentScale-scale)>.0001){handle.scaleReadyAt=performance.now()+100;handle.viewer.updateScale({scaleFactor:scale/handle.viewer.currentScale,drawingDelay:100});clearTimeout(handle.drawingTimer);handle.drawingTimer=setTimeout(schedule,110);}
  props.onLayout(side);handle.viewer.update();schedule();
 },[side,scrollRef,schedule]);
 useEffect(()=>{
  let alive=true;const lifecycle=new AbortController();
  if(!doc){report();return()=>{alive=false;lifecycle.abort();};}
  void(async()=>{
   const {PDFViewer,PDFLinkService,EventBus,RenderingStates}=await loadPdfViewer();if(!alive)return;
   const first=await doc.getPage(1);if(!alive)return;
   const flow=scrollRef.current,eventBus=new EventBus(),linkService=new PDFLinkService({eventBus});
   const view=new PDFViewer({container:flow,viewer:viewerElement.current,eventBus,linkService,abortSignal:lifecycle.signal,annotationEditorMode:-1,annotationMode:1,maxCanvasPixels:4000000,enableDetailCanvas:false,enableAutoLinking:false,minDurationToUpdateCanvas:100,removePageBorders:true});
   engine.current={viewer:view,finished:RenderingStates.FINISHED,pageWidth:first.getViewport({scale:1}).width};flow.dataset.pdfEngine='PDF.js 5.4.624';
   const markPage=(number,state)=>{const page=view.getPageView(number-1);if(!page)return;page.div.dataset.pdfState=state;page.div.dataset.pdfReady=String(state==='ready');page.div.dataset.pdfPage=String(number);page.div.classList.add('ib-pdf-page');page.div.querySelector('.textLayer')?.classList.add('ib-reader-text-layer');};
   eventBus.on('pagesinit',()=>{for(let n=1;n<=view.pagesCount;n++)markPage(n,'loading');resize();});
   eventBus.on('pagerender',event=>{markPage(event.pageNumber,'loading');current.current.onLayout(side);schedule();});
   eventBus.on('pagerendered',event=>{markPage(event.pageNumber,event.error?'error':'ready');if(event.error)current.current.onError(event.error);schedule();});
   eventBus.on('textlayerrendered',event=>{view.getPageView(event.pageNumber-1)?.div.querySelector('.textLayer')?.classList.add('ib-reader-text-layer');schedule();});
   eventBus.on('updateviewarea',schedule);
   linkService.setViewer(view);linkService.setDocument(doc);view.setDocument(doc);
   void view.firstPagePromise.catch(error=>{if(alive)current.current.onError(error);});
  })().catch(error=>{if(alive){current.current.onError(error);current.current.onLoading(side,false);}});
  return()=>{alive=false;lifecycle.abort();cancelAnimationFrame(frame.current);frame.current=0;clearTimeout(engine.current?.drawingTimer);engine.current?.viewer.setDocument(null);engine.current=null;};
 },[doc,side,scrollRef,resize,schedule,report]);
 useEffect(()=>{const observer=new ResizeObserver(resize);observer.observe(scrollRef.current);return()=>observer.disconnect();},[scrollRef,resize]);
 useLayoutEffect(()=>{if(active)resize();report();},[active,zoom,failed,resize,report]);
 return h('div',{className:'ib-pdf-viewport'},h('div',{ref:scrollRef,className:'ib-pdf-flow','data-pdf-side':side,'data-hand':hand||undefined,onScroll:event=>{onScroll(side,event.currentTarget);schedule();},
  onPointerDown:event=>{if(!hand||event.button!==0)return;event.preventDefault();drag.current={x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop};event.currentTarget.setPointerCapture(event.pointerId);},
  onPointerMove:event=>{if(!drag.current)return;event.currentTarget.scrollLeft=drag.current.left+drag.current.x-event.clientX;event.currentTarget.scrollTop=drag.current.top+drag.current.y-event.clientY;},onPointerUp:()=>{drag.current=null;},onPointerCancel:()=>{drag.current=null;}},
  h('div',{ref:viewerElement,className:'pdfViewer'}),!doc?h('div',{className:'ib-reader-loading',role:failed?'alert':'status'},failed?null:h('span',{className:'ib-reader-spinner','aria-hidden':true}),failed?'译文加载失败，可重新选择中文视图重试。':'正在读取 '+(side==='zh'?'中文':'原文')+' PDF…'):null));
});
