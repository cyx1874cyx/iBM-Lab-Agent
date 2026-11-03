// Use the same page and in-page fraction even when the panes have different widths.
const inset=12,other=side=>side==='original'?'zh':'original';
const pageItems=flow=>flow?.querySelector?.('.pdfViewer')?.children??flow?.children;
export function pdfPosition(flow,offset=inset){
 const pages=pageItems(flow);if(!pages?.length)return {page:1,fraction:0};
 const y=flow.scrollTop+offset;let low=0,high=pages.length-1;
 while(low<high){const mid=(low+high)>>1,item=pages[mid];if(item.offsetTop+item.offsetHeight>y)high=mid;else low=mid+1;}
 const item=pages[low],page=item?.dataset.pdfPage??item?.dataset.pageNumber;return page?{page:Number(page),fraction:Math.max(0,Math.min(1,(y-item.offsetTop)/item.offsetHeight))}:{page:1,fraction:0};
}
export function scrollPdfTo(flow,{page,fraction=0}){
 const items=pageItems(flow);if(!items?.length||!flow.clientHeight)return false;
 const n=Math.max(1,Math.min(items.length,page)),item=items[n-1];if(!(item.dataset.pdfPage??item.dataset.pageNumber))return false;
 flow.scrollTop=Math.max(0,Math.min(flow.scrollHeight-flow.clientHeight,item.offsetTop+Math.max(0,Math.min(1,fraction))*item.offsetHeight-inset));return true;
}
export function createPdfScrollSync({flowFor,linked,onPosition,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)}){
 let anchors={original:{page:1,fraction:0},zh:{page:1,fraction:0}},frame=0,work,lastSide='original';const expected=new Map();
 const publish=()=>onPosition(anchors);
 const write=(side,anchor)=>{anchors[side]={...anchor};const flow=flowFor(side);if(scrollPdfTo(flow,anchor)){expected.set(side,{flow,top:flow.scrollTop});anchors[side]=pdfPosition(flow);}};
 const flush=()=>{frame=0;if(!work)return;const {side,anchor}=work;work=null;if(linked())write(other(side),anchor);publish();};
 const stop=()=>{if(frame)cancelFrame(frame);frame=0;work=null;};
 return {
  onScroll(side,flow){if(!flow.clientHeight||!pageItems(flow)?.length)return;const echo=expected.get(side);if(echo?.flow===flow&&Math.abs(echo.top-flow.scrollTop)<1)return;expected.delete(side);const anchor=pdfPosition(flow);anchors[side]=anchor;lastSide=side;work={side,anchor};if(!frame)frame=requestFrame(flush);},
  capture(side=lastSide){const flow=flowFor(side);if(flow?.clientHeight&&pageItems(flow)?.length)anchors[side]=pdfPosition(flow);return {...anchors[side]};},
  move(side,anchor,link=linked()){stop();lastSide=side;write(side,anchor);if(link)write(other(side),anchor);publish();},
  restore(side){write(side,anchors[side]);publish();},
  reset(){stop();expected.clear();anchors={original:{page:1,fraction:0},zh:{page:1,fraction:0}};lastSide='original';},
  dispose:stop,
  get lastSide(){return lastSide;}
 };
}
