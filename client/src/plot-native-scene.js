import {useEffect,useLayoutEffect,useState,useRef} from 'react';
import {h} from './h.js';

const numeric=value=>value!==null&&/^[\d\s.,eE+\-%]+$/.test(value);
const safeTransform=value=>value&&/^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s.,eE+\-]+\)\s*)+$/.test(value);
function typography(node){
 const attrs={},style={};
 for(const key of ['x','y','dx','dy','font-size','font-weight','letter-spacing','word-spacing','baseline-shift','rotate']){const value=node.getAttribute(key);if(numeric(value))attrs[key]=value;}
 for(const key of ['font-family','font-style','text-anchor','dominant-baseline','alignment-baseline']){const value=node.getAttribute(key);if(value&&/^[\p{L}\p{N}\s,.'_-]+$/u.test(value))attrs[key]=value;}
 const rules={'font-kerning':['none','normal','auto'],'white-space':['pre','pre-wrap','normal'],'font-style':['normal','italic','oblique'],'font-weight':['normal','bold','400','700'],'font-variant':['normal','small-caps']};
 for(const [key,allowed] of Object.entries(rules)){const value=node.style?.getPropertyValue(key);if(allowed.includes(value))style[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
 for(const key of ['font-size','letter-spacing','word-spacing','baseline-shift']){const value=node.style?.getPropertyValue(key);if(value&&/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|em|rem|%)?$/.test(value))style[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
 if(node.getAttributeNS('http://www.w3.org/XML/1998/namespace','space')==='preserve')style.whiteSpace='pre';
 if(Object.keys(style).length)attrs.style=style;
 return attrs;
}
function textChildren(node){return [...node.childNodes].flatMap(child=>child.nodeType===3?(child.textContent.trim()||node.getAttributeNS('http://www.w3.org/XML/1998/namespace','space')==='preserve'?[child.textContent]:[]):child.nodeType===1&&child.localName==='tspan'?[{attrs:typography(child),children:textChildren(child)}]:[]);}
const renderText=(children)=>children.map((child,i)=>typeof child==='string'?child:h('tspan',{key:i,...child.attrs},...renderText(child.children)));

function inkRect(node){
 if(node.localName!=='text')return node.getBoundingClientRect();
 const leaves=[node,...node.querySelectorAll('tspan')].filter(n=>!n.querySelector('tspan'));
 const points=[],context=document.createElement('canvas').getContext('2d');
 for(const leaf of leaves){
  const style=getComputedStyle(leaf),raw=leaf.textContent,text=style.whiteSpace.startsWith('pre')?raw:raw.replace(/\s+/g,' ').trim();
  if(leaf.getNumberOfChars()!==text.length)return node.getBoundingClientRect();
  context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if('fontKerning' in context)context.fontKerning=style.fontKerning;
  const matrix=leaf.getScreenCTM();if(!matrix)return node.getBoundingClientRect();
  for(let i=0;i<text.length;i++){
   if(/\s/.test(text[i]))continue;
   const m=context.measureText(text[i]),p=leaf.getStartPositionOfChar(i),angle=leaf.getRotationOfChar(i)*Math.PI/180;
   if(!Number.isFinite(m.actualBoundingBoxAscent))return node.getBoundingClientRect();
   for(const x of [-m.actualBoundingBoxLeft,m.actualBoundingBoxRight])for(const y of [-m.actualBoundingBoxAscent,m.actualBoundingBoxDescent])points.push(new DOMPoint(p.x+x*Math.cos(angle)-y*Math.sin(angle),p.y+x*Math.sin(angle)+y*Math.cos(angle)).matrixTransform(matrix));
  }
 }
 if(!points.length)return node.getBoundingClientRect();
 const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
 return {left,right,top,bottom,width:right-left,height:bottom-top};
}

/** Only inert geometry is read from Origin SVG. Never mount its scripts, links,
 * events, foreignObject, CSS, external resources or arbitrary markup. */
export function originHitGeometry(source){
 const doc=new DOMParser().parseFromString(source,'image/svg+xml');
 if(doc.querySelector('parsererror'))throw Error('Origin SVG 无法解析');
 const shapes=[];
 for(const node of doc.querySelectorAll('path,polyline,polygon,rect,circle,ellipse,line,text')){
  let classes='';for(let parent=node;parent&&parent!==doc.documentElement;parent=parent.parentElement)classes+=' '+(parent.getAttribute('class')||'')+' '+(parent.getAttributeNS('http://www.originlab.com/namespaces/olab','scope')||'').replaceAll('.',' ');
  const match=/\bLayer(\d+)\b/.exec(classes),plot=/\bPlot(\d+)\b/.exec(classes),axis=/\bAxis(\d+)\b/.exec(classes);
  if(!match||!['path','polyline','polygon','rect','circle','ellipse','line','text'].includes(node.localName))continue;
  const attrs={};
  for(const key of ['d','points','x','y','width','height','cx','cy','r','rx','ry','x1','x2','y1','y2','dx','dy','font-size','font-weight','rotate']){
   const value=node.getAttribute(key);if(value!==null&&/^[\d\s.,eE+\-MmZzLlHhVvCcSsQqTtAa]+$/.test(value))attrs[key]=value;
  }
  if(node.localName==='text'){
   const ancestors=[];for(let parent=node;parent&&parent!==doc.documentElement;parent=parent.parentElement)ancestors.unshift(parent);
   for(const parent of ancestors){const t=typography(parent);const inherited={...t};for(const k of ['x','y','dx','dy','rotate'])if(parent!==node)delete inherited[k];const previousStyle=attrs.style;Object.assign(attrs,inherited);attrs.style={...previousStyle,...t.style};}
  }
  const transforms=[];for(let parent=node;parent&&parent!==doc.documentElement;parent=parent.parentElement){const value=parent.getAttribute('transform');if(safeTransform(value))transforms.unshift(value);}
  if(transforms.length)attrs.transform=transforms.join(' ');
  const children=node.localName==='text'?textChildren(node):[];
  if(Object.keys(attrs).length)shapes.push({tag:node.localName,attrs,layer:Number(match[1]),plot:plot?Number(plot[1]):undefined,axis:axis?Number(axis[1]):undefined,part:/\bTitle\b/.test(classes)?'title':/\bTickLabel\b/.test(classes)?'digits':'axis',text:node.textContent.trim(),children});
 }
 return shapes;
}

export function NativeSceneOverlay({url,scene,spec,selected,onSelect,change,disabled,panelEditing=true}){
 const [shapes,setShapes]=useState([]),drag=useRef(null),[ghost,setGhost]=useState(null),root=useRef(null),[bounds,setBounds]=useState(null);
 useLayoutEffect(()=>{const node=root.current;if(!node)return;const all=[...node.querySelectorAll('[data-native-key]')].filter(n=>n.getAttribute('data-native-key')===selected).map(n=>inkRect(n));if(!all.length){setBounds(null);return;}const r=node.getBoundingClientRect();setBounds({x:(Math.min(...all.map(b=>b.left))-r.left)/r.width,y:(Math.min(...all.map(b=>b.top))-r.top)/r.height,width:(Math.max(...all.map(b=>b.right))-Math.min(...all.map(b=>b.left)))/r.width,height:(Math.max(...all.map(b=>b.bottom))-Math.min(...all.map(b=>b.top)))/r.height});},[selected,shapes,scene]);
 useEffect(()=>{const abort=new AbortController();setShapes([]);setBounds(null);setGhost(null);if(!url)return;fetch(url,{signal:abort.signal}).then(response=>{if(!response.ok)throw Error('SVG 场景不可用');return response.text();}).then(source=>{if(!abort.signal.aborted){setShapes(originHitGeometry(source));setGhost(null);}}).catch(()=>{});return()=>abort.abort();},[url]);
 if(!scene?.layers?.length)return null;
 const multi=spec.layout.mode==='panels',view=scene.viewBox||[0,0,1,1];
 const nativeLayer=index=>scene.layers.find(row=>row.index===index);
 const targetLayer=index=>nativeLayer(index);
 const normalized=text=>String(text||'').replace(/\s+/g,'');
 const textKey=shape=>{
  const text=normalized(shape.text);
  if(spec.titleText&&text===normalized(spec.titleText))return 'title';
  const note=spec.annotations.find(n=>n.kind==='text'&&text===normalized(n.text));
  if(note)return 'note:'+note.id;
  return spec.showLegend?'legend':null;
 };
 const move=e=>{
  const box=(e.currentTarget.closest('.ib-plot-native-frame')||e.currentTarget.closest('.ib-plot-paper')).getBoundingClientRect(),frame=targetLayer(drag.current?.layer??0);
  return {x:((e.clientX-box.left)/box.width-frame.left)/frame.width,y:((e.clientY-box.top)/box.height-frame.top)/frame.height};
 };
 const begin=(e,kind,id,layer=0)=>{if(disabled)return;e.preventDefault();e.stopPropagation();drag.current={kind,id,layer,clientX:e.clientX,clientY:e.clientY};drag.current.start=move(e);
 const style=kind==='legend'?{x:spec.legendX,y:spec.legendY}:kind==='title'?{x:.5,y:.06,...spec.titleStyle}:['x','y'].includes(kind)?{x:kind==='x'?.5:-.14,y:kind==='x'?1.12:.5,...spec[kind+'TitleStyle']}:spec.annotations.find(n=>n.id===id);
 drag.current.base=kind==='note-end'&&style?{x:style.x2??style.x+.15,y:style.y2??style.y+.15}:style;e.currentTarget.setPointerCapture(e.pointerId);onSelect(kind.startsWith('note')?'note:'+id:['x','y'].includes(kind)?'axis-title:'+kind:kind);};
 const finish=e=>{
  const work=drag.current;if(!work)return;const raw=move(e),point={x:work.base?.x===undefined?raw.x:work.base.x+raw.x-work.start.x,y:work.base?.y===undefined?raw.y:work.base.y+raw.y-work.start.y};drag.current=null;if(Math.hypot(e.clientX-work.clientX,e.clientY-work.clientY)<3){setGhost(null);return;}
  const rounded=value=>Number(Math.max(-1,Math.min(2,value)).toFixed(3));
  if(work.kind==='note-end')change({annotations:spec.annotations.map(row=>row.id===work.id?{...row,x2:rounded(point.x),y2:rounded(point.y)}:row)});
  else if(work.kind==='note'){
   const old=spec.annotations.find(row=>row.id===work.id),dx=point.x-old.x,dy=point.y-old.y;
   change({annotations:spec.annotations.map(row=>row.id===work.id?{...row,x:rounded(point.x),y:rounded(point.y),...(row.kind!=='text'?{x2:rounded(row.x2+dx),y2:rounded(row.y2+dy)}:{})}:row)});
  }else if(work.kind==='x'||work.kind==='y'||work.kind==='title'){
   const key=work.kind==='title'?'titleStyle':work.kind+'TitleStyle';change({[key]:{...spec[key],x:rounded(point.x),y:rounded(point.y)}});
  }else if(work.kind==='legend')change({legendX:Math.max(0,Math.min(1,point.x)),legendY:Math.max(0,Math.min(1,point.y))});
 };
 const handle=(kind,id,x,y,label,layer=0)=>{
  const frame=targetLayer(layer);if(!frame)return null;
  const point=ghost?.id===id&&ghost?.kind===kind?ghost:{x,y};
  return h('button',{key:kind+id,className:'ib-plot-object-handle','aria-label':'拖动'+label,title:'拖动'+label,disabled,'data-selected':selected===(kind.startsWith('note')?'note:'+id:kind),style:{left:(frame.left+point.x*frame.width)*100+'%',top:(frame.top+point.y*frame.height)*100+'%'},
   onPointerDown:e=>begin(e,kind,id,layer),onPointerMove:e=>{if(drag.current){const point=move(e);setGhost({...point,id,kind});}},onPointerUp:finish,onPointerCancel:()=>{drag.current=null;setGhost(null);}},label);
 };
 return h('div',{className:'ib-plot-native-scene'},h('svg',{ref:root,viewBox:'0 0 1 1',preserveAspectRatio:'none',className:'ib-plot-geometry-hits','aria-label':'Origin 图形对象命中层'},...shapes.map((shape,index)=>{
  const frame=nativeLayer(shape.layer),target=targetLayer(shape.layer);if(!frame||!target)return null;
  const column=multi?spec.yCols[shape.layer]:spec.yCols[shape.plot];let key;
  if(shape.plot!==undefined)key='series:'+column;
  else if(shape.axis!==undefined){const axis=shape.axis%2===(spec.kind==='bar'?1:0)?'x':'y';key=shape.part==='title'?'axis-title:'+axis:shape.part==='digits'?'ticks:'+axis:axis;}
  else if(shape.tag==='text')key=textKey(shape);
  else if(spec.showLegend&&shape.tag==='polyline'){
   const points=(shape.attrs.points||'').trim().split(/[\s,]+/).map(Number),labels=shapes.filter(s=>s.layer===shape.layer&&s.tag==='text'&&s.axis===undefined&&s.plot===undefined&&textKey(s)==='legend');
   if(points.length===4&&Math.abs(points[1]-points[3])<1&&labels.some(s=>{const x=Number(s.attrs.x),y=Number(s.attrs.y),size=Number(s.attrs['font-size'])||12;return Math.abs(y-points[1])<size&&Math.abs(x-points[2])<size;}))key='legend';else return null;
  }
  else return null;
  if(!key)return null;
  const dragKind=key.startsWith('axis-title:')?key.slice(11):['title','legend'].includes(key)?key:key.startsWith('note:')?'note':null;
  const events={onClick:e=>{e.stopPropagation();if(!disabled)onSelect(key);},...(dragKind?{onPointerDown:e=>begin(e,dragKind,key.startsWith('note:')?key.slice(5):key,shape.layer),onPointerMove:e=>{const work=drag.current;if(!work)return;const box=root.current.getBoundingClientRect();setGhost({dx:(e.clientX-work.clientX)/box.width,dy:(e.clientY-work.clientY)/box.height});},onPointerUp:finish,onPointerCancel:()=>{drag.current=null;setGhost(null);}}:{})};
  const transform=`scale(${1/view[2]} ${1/view[3]}) translate(${-view[0]} ${-view[1]})`;
  const children=renderText(shape.children);
  return h('g',{key:index,transform},h(shape.tag,{...shape.attrs,fill:'transparent',stroke:'transparent',strokeWidth:20,vectorEffect:'non-scaling-stroke',pointerEvents:disabled?'none':shape.tag==='text'?'bounding-box':'stroke',style:{cursor:disabled?'not-allowed':dragKind?(drag.current?'grabbing':'grab'):'pointer',userSelect:'none',touchAction:'none'},...events,'data-native-key':key,'data-column':shape.plot!==undefined?column:undefined},...children),selected===key&&shape.tag!=='text'?h(shape.tag,{...shape.attrs,fill:'none',stroke:'#13A58B',strokeWidth:4,opacity:.5,vectorEffect:'non-scaling-stroke',pointerEvents:'none'}):null);
 })),
  bounds?h('svg',{viewBox:'0 0 1 1',preserveAspectRatio:'none',className:'ib-plot-geometry-hits',style:{pointerEvents:'none'},'aria-hidden':true},h('rect',{...bounds,x:bounds.x+(ghost?.dx||0),y:bounds.y+(ghost?.dy||0),fill:'none',stroke:'#13A58B',strokeWidth:2,vectorEffect:'non-scaling-stroke','data-native-selection':selected})):null,
  ...spec.annotations.flatMap(note=>[note.kind!=='text'?handle('note',note.id,note.x,note.y,{arrow:'箭头起点',rectangle:'矩形起点',line:'直线起点'}[note.kind]):null,note.kind!=='text'&&selected==='note:'+note.id?handle('note-end',note.id,note.x2??note.x+.15,note.y2??note.y+.15,'标注终点'):null]),
  multi&&panelEditing?h(PanelHandles,{spec,scene,change,onSelect,disabled}):null);
}

function PanelHandles({spec,scene,change,onSelect,disabled}){
 const drag=useRef(null),[moving,setMoving]=useState(null),frames=spec.layout.panels.length?spec.layout.panels:scene.panelGeometry||[];
 const native=index=>scene.layers.find(row=>row.index===index);
 const begin=(e,panel,resize)=>{if(disabled)return;e.preventDefault();e.stopPropagation();drag.current={panel,resize,x:e.clientX,y:e.clientY,box:(e.currentTarget.closest('.ib-plot-native-frame')||e.currentTarget.closest('.ib-plot-paper')).getBoundingClientRect()};e.currentTarget.setPointerCapture(e.pointerId);onSelect('layout');};
 const next=e=>{
  const {panel,resize,x,y,box}=drag.current,frame=native(panel.index),dx=(e.clientX-x)/box.width*panel.width/frame.width,dy=(e.clientY-y)/box.height*panel.height/frame.height;
  return resize?{...panel,width:Math.max(5,Math.min(100-panel.left,Math.round(panel.width+dx))),height:Math.max(5,Math.min(100-panel.top,Math.round(panel.height+dy)))}:{...panel,left:Math.max(0,Math.min(100-panel.width,Math.round(panel.left+dx))),top:Math.max(0,Math.min(100-panel.height,Math.round(panel.top+dy)))};
 };
 return h('div',null,...frames.map(panel=>{
  const frame=native(panel.index);if(!frame)return null;
  const shown=moving?.index===panel.index?moving:panel;
  const style={left:(frame.left+(shown.left-panel.left)*frame.width/panel.width)*100+'%',top:(frame.top+(shown.top-panel.top)*frame.height/panel.height)*100+'%',width:frame.width*shown.width/panel.width*100+'%',height:frame.height*shown.height/panel.height*100+'%'};
  return h('div',{className:'ib-plot-panel-handle',key:panel.index,style},...['move','resize'].map(kind=>h('button',{key:kind,className:'ib-plot-panel-'+kind,disabled,'aria-label':(kind==='move'?'移动':'缩放')+'面板 '+(panel.index+1),onPointerDown:e=>begin(e,panel,kind==='resize'),onPointerMove:e=>{if(drag.current)setMoving(next(e));},onPointerUp:e=>{if(!drag.current)return;const value=next(e);drag.current=null;setMoving(null);change({layout:{...spec.layout,panels:frames.map(row=>row.index===value.index?value:row)}});},onPointerCancel:()=>{drag.current=null;setMoving(null);}},kind==='move'?String.fromCharCode(97+panel.index):'↘')));
 }));
}
