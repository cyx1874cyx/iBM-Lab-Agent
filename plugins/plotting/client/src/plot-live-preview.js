import {useEffect,useLayoutEffect,useMemo,useState,useRef,useId} from 'react';
import {h} from 'dsh-lab-agent/client-sdk';
import {seriesStyle} from 'dsh-lab-agent/plot/editor';

export function parsePlotCsv(source){
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(value);value='';if(c!==','){if(c==='\r'&&source[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}}
  else value+=c;
 }
 if(quoted)throw Error('数据 CSV 引号不完整');if(value||row.length){row.push(value);rows.push(row);}return rows.slice(1);
}
const palette=['#000000','#0000FF','#800020','#008B8B','#E08000','#8000A0'];
const dash=['','14 8','3 6','14 6 3 6','14 5 3 5 3 5'];
const number=value=>value===''||value===undefined?NaN:Number(value);
const ticks=(a,b,step)=>{const d=step>0?step:(b-a)/5,out=[];for(let v=Math.ceil(a/d)*d;v<=b+d*.001&&out.length<100;v+=d)out.push(v);return out;};
export function previewDomain(values,settings={}){let lo=Infinity,hi=-Infinity;for(const v of values)if(Number.isFinite(v)&&(settings.scale!=='log10'||v>0)){lo=Math.min(lo,v);hi=Math.max(hi,v);}if(lo===Infinity){lo=0;hi=1;}if(lo===hi){lo-=.5;hi+=.5;}lo=settings.min??lo;hi=settings.max??hi;if(settings.scale==='log10'&&lo<=0)lo=.1;return [lo,hi];}

export function LivePlotPreview({url,spec,profile,selected,onSelect,change,disabled,onError}){
 const clipPrefix='ibm'+useId().replace(/[^a-zA-Z0-9]/g,'');
 const [rows,setRows]=useState(null),[error,setError]=useState(''),drag=useRef(null),[moving,setMoving]=useState(null),svg=useRef(null),[selectionBox,setSelectionBox]=useState(null);
 useLayoutEffect(()=>{const root=svg.current;if(!root)return;const nodes=[...root.querySelectorAll('[data-select-key]')].filter(n=>n.getAttribute('data-select-key')===selected);if(!nodes.length){setSelectionBox(null);return;}const r=root.getBoundingClientRect(),v=root.viewBox.baseVal,boxes=nodes.map(n=>n.getBoundingClientRect()).filter(b=>b.width||b.height);if(!boxes.length)return;const left=Math.min(...boxes.map(b=>b.left)),right=Math.max(...boxes.map(b=>b.right)),top=Math.min(...boxes.map(b=>b.top)),bottom=Math.max(...boxes.map(b=>b.bottom));setSelectionBox({x:(left-r.left)/r.width*v.width,y:(top-r.top)/r.height*v.height,w:(right-left)/r.width*v.width,h:(bottom-top)/r.height*v.height});},[selected,spec,moving,rows]);
 useEffect(()=>{const abort=new AbortController();setRows(null);setError('');fetch(url,{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('绘图数据加载失败');return r.text();}).then(text=>setRows(parsePlotCsv(text))).catch(e=>{if(e.name!=='AbortError'){setError(e.message);onError?.(e.message);}});return()=>abort.abort();},[url]);
 const data=useMemo(()=>rows?.map(row=>row.map(number)),[rows]);
 if(error)return h('p',{role:'alert'},error);if(!data)return h('p',{role:'status'},'正在加载本地绘图数据…');
 const width=1200,height=1100*spec.heightCm/spec.widthCm*9/8,panels=spec.layout.mode==='panels'?spec.yCols.map(c=>[c]):[spec.yCols],cols=spec.layout.mode==='panels'?Math.min(spec.layout.columns,panels.length):1,rs=Math.ceil(panels.length/cols);
 const selectKey=key=>/^tick\d+([xy])/.test(key)?'ticks:'+key.match(/^tick\d+([xy])/)[1]:key.startsWith('legend-')?'legend':key.startsWith('panel-label')?'layout':key;
 const text=(key,content,x,y,style={},fallback=spec.fontSize)=>h('text',{key,x,y,fill:style.color||'#000000',fontFamily:style.font||spec.fontFamily,fontSize:(style.size??fallback)*2,fontWeight:style.bold?'bold':'normal',fontStyle:style.italic?'italic':'normal',textAnchor:'middle',dominantBaseline:'middle',transform:`rotate(${-Number(style.rotation||0)} ${x} ${y})`,visibility:style.visible===false?'hidden':undefined,onClick:e=>{e.stopPropagation();onSelect(selectKey(key));},'data-select-key':selectKey(key),'data-live-object':key},content);
 const begin=(e,key,frame)=>{if(disabled)return;e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);drag.current={key,frame,clientX:e.clientX,clientY:e.clientY};drag.current.start=point(e);onSelect(key.startsWith('end:')?'note:'+key.slice(4):key.startsWith('panel:')?'layout':key);};
 const point=e=>{const rect=e.currentTarget.ownerSVGElement.getBoundingClientRect(),f=drag.current.frame;return {x:((e.clientX-rect.left)/rect.width*width-f.x)/f.w,y:((e.clientY-rect.top)/rect.height*height-f.y)/f.h};};
 const commit=(key,p)=>{if(key.startsWith('ticks:')){const axis=key.slice(6),a=spec[axis+'Axis'],d=drag.current,sz=(a.tickSize??spec.fontSize)*2;change({[axis+'Axis']:{...a,tickOffsetX:Math.max(-500,Math.min(500,(a.tickOffsetX??0)+(p.x-d.start.x)*d.frame.w/sz*100)),tickOffsetY:Math.max(-500,Math.min(500,(a.tickOffsetY??0)+(p.y-d.start.y)*d.frame.h/sz*100))}});return;}if(key.startsWith('panel:')){const index=Number(key.slice(6)),f=drag.current?.frame;if(!f)return;const panel={index,left:Math.max(0,Math.min(95,Math.round((f.x+p.x*f.w)/width*100))),top:Math.max(0,Math.min(95,Math.round((f.y+p.y*f.h)/height*100))),width:f.w/width*100,height:f.h/height*100};panel.left=Math.min(100-panel.width,panel.left);panel.top=Math.min(100-panel.height,panel.top);change({layout:{...spec.layout,panels:[...spec.layout.panels.filter(r=>r.index!==index),panel]}});return;}const clip=v=>Math.max(-1,Math.min(2,Number(v.toFixed(3))));p={x:clip(p.x),y:clip(p.y)};if(key==='legend')change({legendX:Math.max(0,Math.min(1,p.x)),legendY:Math.max(0,Math.min(1,p.y))});else if(key.startsWith('end:'))change({annotations:spec.annotations.map(n=>n.id===key.slice(4)?{...n,x2:p.x,y2:p.y}:n)});else if(key.startsWith('note:'))change({annotations:spec.annotations.map(n=>n.id===key.slice(5)?{...n,...p,...(n.kind!=='text'?{x2:(n.x2??n.x)+p.x-n.x,y2:(n.y2??n.y)+p.y-n.y}:{})}:n)});else{const k=key==='title'?'titleStyle':key.startsWith('axis-title:')?key.slice(11)+'TitleStyle':key+'TitleStyle';change({[k]:{...spec[k],...p}});}};
 const draggable=(key,f,content)=>{
  // Translating the existing SVG group avoids recalculating every data series
  // on each pointer event. Shapes with independently moving endpoints still
  // use the full preview so their geometry remains accurate while dragging.
  const note=key.startsWith('note:')&&spec.annotations.find(n=>n.id===key.slice(5));
  const translate=!key.startsWith('panel:')&&!key.startsWith('end:')&&(!note||note.kind==='text');
  const clear=e=>{e.currentTarget.removeAttribute('transform');const tooltip=svg.current?.querySelector('[data-selection-tooltip]');if(tooltip)tooltip.removeAttribute('visibility');};
  return h('g',{key:key+':'+f.x+':'+f.y,'data-select-key':key.startsWith('end:')?'note:'+key.slice(4):key.startsWith('panel:')?'layout':key,onPointerDown:e=>begin(e,key,f),onPointerMove:e=>{if(!drag.current)return;const p=point(e);if(translate){const d=drag.current;e.currentTarget.setAttribute('transform',`translate(${(p.x-d.start.x)*f.w} ${(p.y-d.start.y)*f.h})`);const tooltip=svg.current?.querySelector('[data-selection-tooltip]');if(tooltip)tooltip.setAttribute('visibility','hidden');}else setMoving({key,...p});},onPointerUp:e=>{if(!drag.current)return;const p=point(e),d=drag.current;clear(e);setMoving(null);if(Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)>3)commit(key,p);drag.current=null;},onPointerCancel:e=>{clear(e);drag.current=null;setMoving(null);},style:{cursor:disabled?'default':'move'}},content);
 };
 const elements=[];
 panels.forEach((columns,index)=>{
  const geometry=spec.layout.panels.find(p=>p.index===index),f=geometry?{x:geometry.left/100*width,y:geometry.top/100*height,w:geometry.width/100*width,h:geometry.height/100*height}:{x:170+(index%cols)*(990/cols),y:100+Math.floor(index/cols)*(850/rs),w:850/cols,h:760/rs};
  const distribution=['histogram','box'].includes(spec.kind),bar=spec.kind==='bar',category=spec.kind==='column'||bar,histValues=data.map(r=>r[columns[0]]).filter(Number.isFinite),histDomain=previewDomain(histValues,{}),histBins=Array(10).fill(0);for(const v of histValues)histBins[Math.min(9,Math.floor((v-histDomain[0])/(histDomain[1]-histDomain[0])*10))]++;const xd=bar?previewDomain(data.flatMap(r=>columns.map(c=>r[c])),spec.xAxis):category?[0,data.length]:spec.kind==='histogram'?previewDomain(histValues,spec.xAxis):distribution?[0,columns.length+1]:previewDomain(data.map(r=>r[spec.xCol]),spec.xAxis),yd=bar?[0,data.length]:spec.kind==='histogram'?previewDomain([0,...histBins],spec.yAxis):previewDomain(data.flatMap(r=>columns.map(c=>r[c])),spec.yAxis);if(bar&&spec.xAxis.min===undefined)xd[0]=Math.min(0,xd[0]);
  if(['column','bar','histogram'].includes(spec.kind)&&spec.yAxis.min===undefined)yd[0]=Math.min(0,yd[0]);
  const scale=(v,d,setting)=>setting.scale==='log10'?(Math.log10(v)-Math.log10(d[0]))/(Math.log10(d[1])-Math.log10(d[0])):(v-d[0])/(d[1]-d[0]);
  const x=v=>f.x+scale(v,xd,spec.xAxis)*f.w,y=v=>f.y+(1-scale(v,yd,spec.yAxis))*f.h;
  if(spec.layout.mode==='panels'){elements.push(draggable('panel:'+index,f,h('text',{x:f.x,y:f.y-16,fontSize:18,fill:'#0B9B87','aria-label':'移动本地面板 '+(index+1)},'移动面板 '+String.fromCharCode(97+index))));if(spec.layout.labels)elements.push(text('panel-label'+index,'('+String.fromCharCode(97+index)+')',f.x+25,f.y+25));}
  elements.push(h('defs',{key:'clip'+index},h('clipPath',{id:clipPrefix+'-clip-'+index},h('rect',{x:f.x,y:f.y,width:f.w,height:f.h}))));
  elements.push(h('rect',{key:'frame'+index,x:f.x,y:f.y,width:f.w,height:f.h,fill:spec.background,stroke:'#000',strokeWidth:2}));
  for(const axis of ['x','y']){
   const settings=spec[axis+'Axis'],domain=axis==='x'?xd:yd;
   const categoryAxis=category&&(bar?axis==='y':axis==='x');const values=categoryAxis?data.map((_,i)=>i+.5):settings.scale==='log10'?Array.from({length:Math.min(12,Math.max(0,Math.floor(Math.log10(domain[1]))-Math.ceil(Math.log10(domain[0]))+1))},(_,i)=>10**(Math.ceil(Math.log10(domain[0]))+i)):ticks(...domain,settings.step);
   if(settings.visible===false)continue;
   const direction=settings.ticks||'in',font=(settings.tickSize??spec.fontSize)*2,labelElements=[];
   const offset={x:settings.tickOffsetX??0,y:settings.tickOffsetY??0};
   if(moving?.key==='ticks:'+axis&&drag.current){offset.x+=(moving.x-drag.current.start.x)*f.w/font*100;offset.y+=(moving.y-drag.current.start.y)*f.h/font*100;}
   const tickLine=(v,minor=false)=>{const px=axis==='x'?x(v):f.x,py=axis==='x'?f.y+f.h:y(v),len=minor?11:22,inside=direction==='in'||direction==='both'?len:0,outside=direction==='out'||direction==='both'?len:0;
    if(direction!=='none')elements.push(h('line',{key:`tick-line-${index}-${axis}-${v}-${minor}`,'data-live-tick':axis,'data-tick-kind':minor?'minor':'major',x1:axis==='x'?px:px-outside,y1:axis==='x'?py+outside:py,x2:axis==='x'?px:px+inside,y2:axis==='x'?py-inside:py,stroke:settings.color||'#000',strokeWidth:settings.lineWidth??3,pointerEvents:'none'}));
    if(settings.grid==='both'&&minor)elements.push(h('line',{key:`minor-grid-${index}-${axis}-${v}`,x1:px,y1:axis==='x'?f.y:py,x2:axis==='x'?px:f.x+f.w,y2:axis==='x'?f.y+f.h:py,stroke:'#eee',pointerEvents:'none'}));
   };
   // A wider transparent hit target makes the axis line selectable.
   elements.push(h('line',{key:'axis-hit'+index+axis,'data-select-key':axis,x1:f.x,y1:axis==='x'?f.y+f.h:f.y,x2:axis==='x'?f.x+f.w:f.x,y2:f.y+f.h,stroke:'transparent',strokeWidth:24,onClick:e=>{e.stopPropagation();onSelect(axis);},style:{cursor:'pointer'}}));
   for(const [i,v] of values.entries()){const px=axis==='x'?x(v):f.x,py=axis==='x'?f.y+f.h:y(v);if(settings.grid&&settings.grid!=='none')elements.push(h('line',{key:`grid${index}${axis}${v}`,x1:px,y1:axis==='x'?f.y:py,x2:axis==='x'?px:f.x+f.w,y2:axis==='x'?f.y+f.h:py,stroke:'#ddd',pointerEvents:'none'}));
    tickLine(v);
    if(!categoryAxis&&i<values.length-1){const next=values[i+1],count=settings.minorTicks??3;for(let j=1;j<=count;j++){const minor=settings.scale==='log10'?v*(next/v)**(j/(count+1)):v+(next-v)*j/(count+1);tickLine(minor,true);}}
    const formatted=categoryAxis?rows[Math.floor(v)]?.[spec.xCol]??String(v):settings.format==='scientific'?v.toExponential(settings.decimals>=0?settings.decimals:1):settings.decimals>=0?v.toFixed(settings.decimals):Number(v.toPrecision(4)).toString();
    labelElements.push(text('tick'+index+axis+v,formatted,(axis==='x'?px:px-34)+offset.x/100*font,(axis==='x'?py+48:py)+offset.y/100*font,{size:settings.tickSize??spec.fontSize,font:settings.tickFont,color:settings.tickColor,rotation:settings.tickRotation}));
   }
   elements.push(draggable('ticks:'+axis,f,labelElements));
  }
  columns.forEach((column,pi)=>{
   const style=seriesStyle(spec,column),color=style.color||palette[spec.yCols.indexOf(column)%palette.length],strokeWidth=style.lineWidth??spec.lineWidth,points=data.map((r,i)=>({x:distribution?i:r[spec.xCol],y:r[column]}));
   const shapes=[];
   if(['line','line_symbol','scatter'].includes(spec.kind)){
    let path='';for(const p of points)path+=Number.isFinite(x(p.x))&&Number.isFinite(y(p.y))?`${!path||path.endsWith(' ')?'M':'L'}${x(p.x)},${y(p.y)}`:' ';
    if(spec.kind!=='scatter')shapes.push(h('path',{key:'line',d:path,fill:'none',stroke:color,strokeWidth,strokeDasharray:dash[style.lineStyle??(spec.lineStyle==='distinct'?pi%2:0)]}));
    if(spec.kind!=='line')for(const [i,p] of points.entries())if(Number.isFinite(x(p.x))&&Number.isFinite(y(p.y))){const cx=x(p.x),cy=y(p.y),r=(style.symbolSize??spec.symbolSize)*.65,kind=style.symbolKind??2;shapes.push(kind===1?h('rect',{key:i,x:cx-r,y:cy-r,width:2*r,height:2*r,fill:color}):kind===3||kind===4||kind===5?h('polygon',{key:i,points:kind===5?`${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}`:kind===3?`${cx},${cy-r} ${cx+r},${cy+r} ${cx-r},${cy+r}`:`${cx-r},${cy-r} ${cx+r},${cy-r} ${cx},${cy+r}`,fill:color}):h('circle',{key:i,cx,cy,r,fill:color}));}
   }else if(['column','bar'].includes(spec.kind)){
    points.forEach((p,i)=>{if(!Number.isFinite(p.y))return;const w=f.w/data.length/columns.length*.72,base=y(0),bh=f.h/data.length/columns.length*.72;shapes.push(h('rect',{key:i,...(bar?{x:Math.min(x(0),x(p.y)),y:f.y+(i+.15)/data.length*f.h+pi*bh,width:Math.abs(x(p.y)-x(0)),height:bh}:{x:f.x+(i+.15)/data.length*f.w+pi*w,y:Math.min(y(p.y),base),width:w,height:Math.abs(base-y(p.y))}),fill:color}));});
   }else if(spec.kind==='box'){
    const values=points.map(p=>p.y).filter(Number.isFinite).sort((a,b)=>a-b),q=p=>{const a=(values.length-1)*p,i=Math.floor(a);return values[i]+(values[Math.ceil(a)]-values[i])*(a-i);};if(values.length){const px=f.x+(pi+1)/(columns.length+1)*f.w;shapes.push(h('path',{key:'whisker',d:`M${px} ${y(values[0])}V${y(values.at(-1))}`,stroke:color}));shapes.push(h('rect',{key:'box',x:px-22,y:y(q(.75)),width:44,height:y(q(.25))-y(q(.75)),fill:color,fillOpacity:.2,stroke:color}));shapes.push(h('path',{key:'median',d:`M${px-22} ${y(q(.5))}h44`,stroke:color}));}
   }else{
    histBins.forEach((n,i)=>{const x1=x(histDomain[0]+i*(histDomain[1]-histDomain[0])/10),x2=x(histDomain[0]+(i+1)*(histDomain[1]-histDomain[0])/10);shapes.push(h('rect',{key:i,x:x1,y:y(n),width:x2-x1,height:y(0)-y(n),fill:color,stroke:'white'}));});
   }
   elements.push(h('g',{key:'series'+index+column,'data-live-series':column,'data-select-key':'series:'+column,clipPath:`url(#${clipPrefix}-clip-${index})`,opacity:style.visible===false?0:style.opacity??1,onClick:()=>onSelect('series:'+column),style:{cursor:'pointer'}},...shapes));
  });
  const loc=(key,style,dx,dy)=>{const p=moving?.key===key?moving:style;return [f.x+(p.x??dx)*f.w,f.y+(p.y??dy)*f.h];};
  for(const axis of ['x','y'])elements.push(draggable('axis-title:'+axis,f,text('axis-title:'+axis,spec[axis+'Label'],...loc('axis-title:'+axis,spec[axis+'TitleStyle'],axis==='x'?.5:-.14,axis==='x'?1.17:.5),{rotation:axis==='y'?90:0,...spec[axis+'TitleStyle']},spec.titleSize)));
  if(index===0&&spec.titleText)elements.push(draggable('title',f,text('title',spec.titleText,...loc('title',spec.titleStyle,.5,-.1),spec.titleStyle,spec.titleSize)));
  if(spec.showLegend){const [lx,ly]=loc('legend',{x:spec.legendX,y:spec.legendY},.68,.12),order=[...spec.legendOrder.filter(c=>columns.includes(c)),...columns.filter(c=>!spec.legendOrder.includes(c))],size=(spec.legendStyle.size??spec.fontSize)*2;elements.push(draggable('legend',f,h('g',{'data-live-legend':true},...order.map((c,i)=>{const st=seriesStyle(spec,c),cy=ly+i*size*1.3,color=st.color||palette[spec.yCols.indexOf(c)%6];return h('g',{key:c},h('line',{x1:lx-150,y1:cy,x2:lx-75,y2:cy,stroke:color,strokeWidth:st.lineWidth??spec.lineWidth,strokeDasharray:dash[st.lineStyle??(spec.lineStyle==='distinct'?spec.yCols.indexOf(c)%2:0)]}),['scatter','line_symbol'].includes(spec.kind)?h('circle',{cx:lx-112,cy,r:(st.symbolSize??spec.symbolSize)*.65,fill:color}):null,text('legend-'+c,st.label??profile.columns[c]?.name??String(c),lx+35,cy,spec.legendStyle));}))));}
  if(index===0)for(const n of spec.annotations){if(n.style.visible===false)continue;const key='note:'+n.id,[nx,ny]=loc(key,moving?.key===key?moving:n,n.x,n.y),x2=f.x+(moving?.key==='end:'+n.id?moving.x:n.x2??n.x+.15)*f.w,y2=f.y+(moving?.key==='end:'+n.id?moving.y:n.y2??n.y+.15)*f.h;if(n.kind!=='text'&&selected===key)elements.push(draggable('end:'+n.id,f,h('circle',{cx:x2,cy:y2,r:10,fill:'#0B9B87','aria-label':'拖动本地标注终点'})));elements.push(draggable(key,f,n.kind==='text'?text(key,n.text,nx,ny,n.style):h('g',{'data-live-note':n.id},n.kind==='rectangle'?h('rect',{x:Math.min(nx,x2),y:Math.min(ny,y2),width:Math.abs(x2-nx),height:Math.abs(y2-ny),fill:n.fill||'white',fillOpacity:n.opacity,stroke:n.style.color||'#000',strokeWidth:n.lineWidth}):h('path',{d:`M${nx} ${ny}L${x2} ${y2}`+(n.kind==='arrow'?(()=>{const a=Math.atan2(y2-ny,x2-nx),r=14;return `M${x2-r*Math.cos(a-.5)} ${y2-r*Math.sin(a-.5)}L${x2} ${y2}L${x2-r*Math.cos(a+.5)} ${y2-r*Math.sin(a+.5)}`;})():''),fill:'none',stroke:n.style.color||'#000',strokeWidth:n.lineWidth}))));}
 });
 if(selectionBox){
  const names={canvas:'画布',title:'图标题',x:'X 坐标轴',y:'Y 坐标轴','axis-title:x':'X 坐标轴标题','axis-title:y':'Y 坐标轴标题','ticks:x':'X 轴数字刻度','ticks:y':'Y 轴数字刻度',legend:'图例',layout:'多面板排版'};
  const column=Number(selected.split(':')[1]),note=spec.annotations.find(n=>selected==='note:'+n.id),name=selected.startsWith('series:')?'数据系列：'+(seriesStyle(spec,column).label||profile.columns[column]?.name||column):note?'标注：'+(note.text||{arrow:'箭头',line:'直线',rectangle:'矩形'}[note.kind]):names[selected]||'图形元素';
  const box=selectionBox,bw=Math.min(width-16,Math.max(220,name.length*29+32)),bx=Math.max(8,Math.min(width-bw-8,box.x)),by=Math.max(8,box.y-80);
  elements.push(h('g',{key:'selection-feedback',pointerEvents:'none','data-selection-tooltip':true},h('rect',{x:box.x-6,y:box.y-6,width:Math.max(12,box.w+12),height:Math.max(12,box.h+12),fill:'none',stroke:'#0B9B87',strokeWidth:3,strokeDasharray:'10 7'}),h('rect',{x:bx,y:by,width:bw,height:62,rx:10,fill:'#F0FFFB',stroke:'#0B9B87',strokeWidth:2}),h('text',{x:bx+16,y:by+40,fontSize:30,fontFamily:'Arial,Microsoft YaHei,sans-serif',fill:'#075E50'},'已选中：'+name)));
 }
 return h('svg',{ref:svg,viewBox:`0 0 ${width} ${height}`,width:'100%',role:'img','aria-label':'本地操作草图，非验收图',style:{display:'block',background:spec.background,touchAction:'none'},'data-live-preview':true,'data-sketch':'1'},...elements);
}
