import {useEffect,useRef,useState} from 'react';
import {h} from './h.js';
import {imageEditSchema} from '../../src/plot/image.js';
import {downloadVerifiedBinary} from './lib.js';

export const imageArtifact=(projectId,row,slot)=>`/api/lab-artifacts?kind=plotting&projectId=${encodeURIComponent(projectId)}&recordId=${encodeURIComponent(row.id)}&slot=${slot}&v=${encodeURIComponent(row.image.saved.preview.sha256)}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const button=(label,onClick,disabled=false,props={})=>h('button',{type:'button',className:'ib-btn',onClick,disabled,...props},label);

export function ImageEntryEditor({row,projectId,call,onSaved,onClose}){
 const image=row.image,[spec,setSpec]=useState(image.spec),[history,setHistory]=useState([]),[future,setFuture]=useState([]),[cropping,setCropping]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[source,setSource]=useState(null),[loadKey,setLoadKey]=useState(0);
 const canvas=useRef(null),stage=useRef(null),cropStage=useRef(null),drag=useRef(null),specRef=useRef(spec),saving=useRef(false),[stageSize,setStageSize]=useState({width:600,height:400});specRef.current=spec;
 useEffect(()=>{const node=stage.current;const fit=()=>setStageSize({width:node.clientWidth,height:node.clientHeight});fit();const observer=new ResizeObserver(fit);observer.observe(node);return()=>observer.disconnect();},[]);
 const sourceUrl=imageArtifact(projectId,row,'image-source');
 useEffect(()=>{
  let alive=true;const node=new Image();setSource(null);node.onload=()=>{if(alive)setSource(node);};node.onerror=()=>{if(alive)setError('原始图片预览加载失败，请重试。');};node.src=sourceUrl;
  return()=>{alive=false;node.onload=null;node.onerror=null;};
 },[sourceUrl,loadKey]);
 useEffect(()=>{
  if(!source||cropping||!canvas.current)return;
  const {x,y,w,h}=spec.crop,fullW=image.width,fullH=image.height;
  // Match Pillow's pixel crop boundaries, including tie-to-even rounding.
  const round=n=>{const f=Math.floor(n),r=n-f;return r===.5?(f%2?f+1:f):Math.round(n);};
  const left=round(x*fullW),top=round(y*fullH),cw=round((x+w)*fullW)-left,ch=round((y+h)*fullH)-top;
  if(cw<1||ch<1)return;
  const swapped=spec.rotation===90||spec.rotation===270,scale=Math.min(1,1600/Math.max(cw,ch)),width=Math.max(1,Math.round(cw*scale)),height=Math.max(1,Math.round(ch*scale));
  const node=canvas.current;node.width=swapped?height:width;node.height=swapped?width:height;const ctx=node.getContext('2d');
  ctx.translate(node.width/2,node.height/2);ctx.rotate(spec.rotation*Math.PI/180);ctx.scale(spec.flipH?-1:1,spec.flipV?-1:1);
  ctx.drawImage(source,left/fullW*source.naturalWidth,top/fullH*source.naturalHeight,cw/fullW*source.naturalWidth,ch/fullH*source.naturalHeight,-width/2,-height/2,width,height);
 },[source,spec,cropping,image.width,image.height]);
 const edit=patch=>{const previous=specRef.current,next={...previous,...patch};if(equal(next,previous))return;specRef.current=next;setHistory(old=>[...old,previous].slice(-50));setFuture([]);setSpec(next);setError('');};
 const close=()=>{if(saving.current)return;if(!equal(specRef.current,image.spec)&&!window.confirm('放弃尚未保存的图片修改？'))return;onClose();};
 const closeRef=useRef(close);closeRef.current=close;
 useEffect(()=>{const key=e=>{if(e.key==='Escape'){e.stopPropagation();closeRef.current();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
 const save=async()=>{
  if(saving.current)return;saving.current=true;setBusy(true);setError('');
  try{const parsed=imageEditSchema.parse(specRef.current),result=await call('plot_image_save',{request:{projectId,id:row.id,revision:image.revision,spec:parsed}});if(!result.record?.image)throw Error('保存未返回有效图片条目');onSaved(result.record);}
  catch(reason){setError('保存失败：'+(reason.issues?.[0]?.message||reason.message));}finally{saving.current=false;setBusy(false);}
 };
 const begin=(event,kind)=>{
  if(busy||!source)return;event.preventDefault();event.stopPropagation();const rect=cropStage.current.getBoundingClientRect();
  drag.current={kind,rect,x:event.clientX,y:event.clientY,initial:specRef.current};event.currentTarget.setPointerCapture(event.pointerId);
 };
 const move=event=>{
  const d=drag.current;if(!d)return;const c=d.initial.crop,dx=(event.clientX-d.x)/d.rect.width,dy=(event.clientY-d.y)/d.rect.height;
  let left=c.x,top=c.y,right=c.x+c.w,bottom=c.y+c.h;
  const minW=1/image.width,minH=1/image.height;
  if(d.kind==='move'){left=clamp(c.x+dx,0,1-c.w);top=clamp(c.y+dy,0,1-c.h);right=left+c.w;bottom=top+c.h;}
  else{if(d.kind.includes('w'))left=clamp(c.x+dx,0,right-minW);if(d.kind.includes('e'))right=clamp(c.x+c.w+dx,left+minW,1);if(d.kind.includes('n'))top=clamp(c.y+dy,0,bottom-minH);if(d.kind.includes('s'))bottom=clamp(c.y+c.h+dy,top+minH,1);}
  const next={...d.initial,crop:{x:left,y:top,w:right-left,h:bottom-top}};specRef.current=next;setSpec(next);
 };
 const end=event=>{const d=drag.current;if(!d)return;drag.current=null;if(event.type==='pointercancel'){setSpec(d.initial);return;}if(!equal(d.initial,specRef.current)){setHistory(old=>[...old,d.initial].slice(-50));setFuture([]);}};
 const crop=spec.crop,valid=imageEditSchema.safeParse(spec).success;
 const horizontalKey=spec.rotation%180?'flipV':'flipH',verticalKey=spec.rotation%180?'flipH':'flipV';
 const pixels={x:Math.round(crop.x*image.width),y:Math.round(crop.y*image.height),w:Math.round((crop.x+crop.w)*image.width)-Math.round(crop.x*image.width),h:Math.round((crop.y+crop.h)*image.height)-Math.round(crop.y*image.height)};
 const setCropPixel=(key,value)=>{if(!Number.isFinite(value))return;const c={...pixels};c[key]=Math.round(value);c.x=clamp(c.x,0,image.width-1);c.y=clamp(c.y,0,image.height-1);c.w=clamp(c.w,1,image.width-c.x);c.h=clamp(c.h,1,image.height-c.y);edit({crop:{x:c.x/image.width,y:c.y/image.height,w:c.w/image.width,h:c.h/image.height}});};
 return h('div',{className:'ib-plot-backdrop'},h('section',{className:'ib-plot-wizard ib-image-editor',role:'dialog','aria-modal':true,'aria-label':'修改导入图片'},
  h('header',{className:'ib-plot-wizard-head'},h('div',null,h('b',null,row.topic),h('small',null,`${image.format} · ${image.width} × ${image.height} px`)),button('关闭',close,busy)),
  h('div',{className:'ib-plot-canvas-toolbar'},button('撤销',()=>{setFuture(old=>[spec,...old]);setSpec(history.at(-1));setHistory(old=>old.slice(0,-1));},busy||!history.length),button('重做',()=>{setHistory(old=>[...old,spec]);setSpec(future[0]);setFuture(old=>old.slice(1));},busy||!future.length),button(cropping?'完成裁剪':'裁剪',()=>setCropping(v=>!v),busy||!source,{'aria-pressed':cropping}),button('向左旋转 90°',()=>{setCropping(false);edit({rotation:(spec.rotation+270)%360});},busy),button('向右旋转 90°',()=>{setCropping(false);edit({rotation:(spec.rotation+90)%360});},busy),button('水平翻转',()=>{setCropping(false);edit({[horizontalKey]:!spec[horizontalKey]});},busy,{'aria-pressed':spec[horizontalKey]}),button('垂直翻转',()=>{setCropping(false);edit({[verticalKey]:!spec[verticalKey]});},busy,{'aria-pressed':spec[verticalKey]}),button('恢复原图',()=>{edit(imageEditSchema.parse({}));setCropping(false);},busy)),
  image.warning?h('p',{className:'ib-plot-native-warning'},image.warning):null,
  h('div',{className:'ib-image-editor-body'},h('div',{className:'ib-image-stage',ref:stage},!source?h('p',{role:'status'},'正在加载图片…'):cropping?h('div',{className:'ib-image-crop-stage',ref:cropStage,style:{width:Math.max(1,Math.min(stageSize.width,stageSize.height*image.width/image.height))+'px'},onPointerMove:move,onPointerUp:end,onPointerCancel:end},
   h('img',{src:sourceUrl,alt:'原始图片裁剪',draggable:false}),h('div',{className:'ib-image-crop-box',style:{left:crop.x*100+'%',top:crop.y*100+'%',width:crop.w*100+'%',height:crop.h*100+'%'},onPointerDown:e=>begin(e,'move'),'aria-label':'裁剪区域'},...['nw','ne','sw','se'].map(corner=>h('button',{key:corner,type:'button',className:'ib-image-crop-handle','data-corner':corner,'aria-label':{nw:'左上',ne:'右上',sw:'左下',se:'右下'}[corner]+'裁剪手柄',onPointerDown:e=>begin(e,corner)})))):h('canvas',{ref:canvas,role:'img','aria-label':'图片编辑预览'})),
   h('aside',{className:'ib-image-properties'},h('b',null,'裁剪区域（像素）'),cropping?h('p',null,'在原图上拖动选框或四角调整范围，完成后查看旋转结果。'):null,...['x','y','w','h'].map(key=>h('label',{key},{x:'左侧',y:'顶部',w:'宽度',h:'高度'}[key],h('input',{type:'number',step:1,min:key==='w'||key==='h'?1:0,max:key==='x'||key==='w'?image.width:image.height,value:pixels[key],disabled:busy,onChange:e=>setCropPixel(key,e.currentTarget.valueAsNumber)}))),h('p',null,'旋转：'+spec.rotation+'°'),h('p',null,'输出：'+(spec.rotation%180?pixels.h+' × '+pixels.w:pixels.w+' × '+pixels.h)+' px'),h('p',{className:'ib-muted'},'原始文件保留，编辑结果保存为 PNG。'))),
  h('footer',{className:'ib-plot-editor-foot'},error?h('span',{role:'alert',className:'ib-error'},error):null,!source?button('重新加载图片',()=>{setError('');setLoadKey(k=>k+1);},busy):null,button('下载当前已保存图片',()=>{setError('');void downloadVerifiedBinary(imageArtifact(projectId,row,'image-export'),{silentCancel:true}).catch(e=>setError(e.message));},busy),button(busy?'正在保存…':'保存图片',()=>void save(),busy||!source||!valid,{'data-primary':true}))));
}
