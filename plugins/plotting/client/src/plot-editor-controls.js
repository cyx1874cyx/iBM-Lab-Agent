import {h} from 'dsh-lab-agent/client-sdk';
import {useEffect,useRef,useState} from 'react';
import {fonts,seriesStyle,seriesColor,updateSeries} from 'dsh-lab-agent/plot/editor';
import {plotSpecSchema} from 'dsh-lab-agent/plot/workspace';

function TextInput({value,onChange,disabled,...props}){
 const [draft,setDraft]=useState(value??''),composing=useRef(false),committed=useRef(value??'');
 useEffect(()=>{setDraft(value??'');committed.current=value??'';},[value]);
 const commit=()=>{if(!composing.current&&draft!==committed.current){committed.current=draft;onChange(draft);}};
 return h('input',{...props,value:draft,disabled,onChange:e=>setDraft(e.target.value),onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;},onBlur:commit,onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!composing.current){e.preventDefault();commit();}}});
}
function NumberInput({value,onChange,disabled,...props}){
 const [draft,setDraft]=useState(value??''),committed=useRef(value??'');
 useEffect(()=>{setDraft(value??'');committed.current=value??'';},[value]);
 const commit=node=>{
  // Preserve incomplete signs/decimals and out-of-range values while typing.
  // Validate the completed field before a draft can reach the render pipeline.
  if(!node.checkValidity()){node.reportValidity();return;}
  const next=node.value===''?undefined:node.valueAsNumber;
  if(next!==undefined&&!Number.isFinite(next))return;
  if(next!==(committed.current===''?undefined:committed.current)){committed.current=next??'';onChange(next);}
 };
 return h('input',{...props,type:'number',value:draft,disabled,'data-plot-edited-field':String(draft)!==String(value??'')||undefined,onChange:e=>setDraft(e.target.value),onBlur:e=>commit(e.currentTarget),onKeyDown:e=>{
  if(e.key==='Enter'){e.preventDefault();if(!e.currentTarget.checkValidity()){e.stopPropagation();e.currentTarget.reportValidity();return;}commit(e.currentTarget);}
  if(e.key==='Escape'){e.stopPropagation();setDraft(committed.current);}
 }});
}
const input=(label,value,onChange,disabled,props={})=>h('label',null,label,props.type==='number'?h(NumberInput,{value,onChange,disabled,...props}):(!props.type||props.type==='text')?h(TextInput,{value,onChange,disabled,...props}):h('input',{value:value??'',disabled,...props,onChange:e=>onChange(e.target.value)}));
const select=(label,value,options,onChange,disabled)=>h('label',null,label,h('select',{value,disabled,onChange:e=>onChange(e.target.value)},...options.map(([id,text])=>h('option',{key:id,value:id},text))));
const check=(label,value,onChange,disabled)=>h('label',{className:'ib-plot-check'},h('input',{type:'checkbox',checked:value,disabled,onChange:e=>onChange(e.target.checked)}),label);
const action=(label,onClick,disabled)=>h('button',{type:'button',className:'ib-btn',onClick,disabled},label);
const num=(label,value,onChange,disabled,min,max,step=1)=>input(label,value,onChange,disabled,{type:'number',min,max,step});

/** Keep edits local while focus moves between settings. Submit one coherent
 * patch on Enter or when the user leaves the properties panel. */
export function BufferedEditorProperties({spec,change,...props}){
 const [draft,setDraft]=useState(spec),draftRef=useRef(spec),pending=useRef({}),root=useRef(null),composing=useRef(false);
 const [validationError,setValidationError]=useState('');
 useEffect(()=>{draftRef.current=spec;pending.current={};setDraft(spec);setValidationError('');},[spec]);
 const update=patch=>{pending.current={...pending.current,...patch};draftRef.current={...draftRef.current,...patch};setDraft(draftRef.current);setValidationError('');};
 const commit=()=>{
  if(!Object.keys(pending.current).length)return;
  // Origin readback positions can have more precision than the input step.
  // Only unfinished user input may block a patch, never untouched readback.
  if(root.current?.querySelector('input[data-plot-edited-field]:invalid'))return;
  const parsed=plotSpecSchema.safeParse(draftRef.current);
  if(!parsed.success){setValidationError('请检查参数：'+parsed.error.issues[0].message);return;}
  const patch=pending.current;pending.current={};change(patch);
 };
 useEffect(()=>{
  const leave=e=>{const node=root.current;if(!node||node.contains(e.target))return;if(node.contains(document.activeElement))document.activeElement.blur();commit();};
  // Canvas dragging prevents pointerdown's default focus change, so blur alone
  // cannot reliably submit settings when clicking a graph object.
  document.addEventListener('pointerdown',leave,true);
  return()=>document.removeEventListener('pointerdown',leave,true);
 });
 return h('div',{ref:root,'data-plot-property-draft':true,onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;},onBlur:e=>{if(!e.currentTarget.contains(e.relatedTarget))commit();},onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!composing.current)commit();}},h(EditorProperties,{key:props.selected,...props,spec:draft,change:update}),validationError?h('small',{className:'ib-error',role:'alert'},validationError):Object.keys(pending.current).length?h('small',{role:'status'},'参数待应用：按回车或离开设置区后更新图片'):null);
}

export function TextProperties({text,onText,style={},onChange,spec,disabled,position=true}){
 return h('div',{className:'ib-plot-text-properties'},onText?input('文字内容',text,onText,disabled):null,
  select('字体',style.font||spec.fontFamily||'Arial',fonts.map(name=>[name,name]),font=>onChange({font}),disabled),
  num('字号',style.size??spec.fontSize,size=>onChange({size}),disabled,6,100),input('文字颜色',style.color||'#000000',color=>onChange({color}),disabled,{type:'color'}),
  h('div',{className:'ib-plot-checks'},check('加粗',!!style.bold,bold=>onChange({bold}),disabled),check('斜体',!!style.italic,italic=>onChange({italic}),disabled),check('显示',style.visible!==false,visible=>onChange({visible}),disabled)),
  num('旋转角度（°）',style.rotation||0,rotation=>onChange({rotation}),disabled,-360,360),
  position?h('div',{className:'ib-plot-small-grid'},num('水平位置',style.x,x=>onChange({x}),disabled,-1,2,.01),num('垂直位置',style.y,y=>onChange({y}),disabled,-1,2,.01)):null);
}

export function EditorProperties({selected,spec,change,profile,disabled,scene,onSelect}){
 const axis=['x','y'].includes(selected)?selected:selected.startsWith('ticks:')?selected.slice(6):selected.startsWith('axis-title:')?selected.slice(11):null;
 const seriesColumn=selected.startsWith('series:')?Number(selected.split(':')[1]):spec.yCols[0];
 const current=seriesStyle(spec,seriesColumn),seriesPatch=patch=>change({series:updateSeries(spec,seriesColumn,patch)});
 const textStyle=(key,patch)=>change({[key]:{...spec[key],...patch}});
 if(selected==='title')return h(TextProperties,{text:spec.titleText,onText:titleText=>change({titleText,...(!spec.titleText?{titleStyle:{...spec.titleStyle,x:spec.titleStyle.x??.5,y:spec.titleStyle.y??.06}}:{})}),style:{size:spec.titleSize,x:.5,y:.06,...spec.titleStyle},onChange:patch=>textStyle('titleStyle',patch),spec,disabled});
 if(axis){
  const settings=spec[axis+'Axis'],patch=value=>change({[axis+'Axis']:{...settings,...value}}),styleKey=axis+'TitleStyle';
  const positionFields=h('div',null,num('数字刻度水平偏移（% 字号）',settings.tickOffsetX??0,tickOffsetX=>patch({tickOffsetX}),disabled,-500,500,5),num('数字刻度垂直偏移（% 字号，向下为正）',settings.tickOffsetY??0,tickOffsetY=>patch({tickOffsetY}),disabled,-500,500,5),action('重置数字刻度位置',()=>patch({tickOffsetX:0,tickOffsetY:0}),disabled));
  const part=selected.startsWith('axis-title:')?'title':selected.startsWith('ticks:')?'digits':'axis';
  return h('div',null,h('div',{className:'ib-plot-axis-tabs',role:'tablist','aria-label':axis.toUpperCase()+' 坐标轴设置'},...[["axis","轴线与刻度"],["title","轴标题"],["digits","数字刻度"]].map(([id,label])=>h('button',{key:id,type:'button',role:'tab','aria-selected':part===id,onClick:()=>onSelect(id==='axis'?axis:id==='title'?'axis-title:'+axis:'ticks:'+axis)},label))),part==='title'?h('section',{'data-axis-section':'title'},h(TextProperties,{text:spec[axis+'Label'],onText:value=>change({[axis+'Label']:value}),style:{size:spec.titleSize,...spec[styleKey]},onChange:value=>textStyle(styleKey,value),spec,disabled})):part==='axis'?h('section',{'data-axis-section':'axis'},h('h5',null,'坐标与刻度'),select('坐标尺度',settings.scale,[['linear','线性'],['log10','对数（10）']],scale=>patch({scale}),disabled),
   num('最小值（留空自动）',settings.min,min=>patch({min}),disabled,undefined,undefined,'any'),num('最大值（留空自动）',settings.max,max=>patch({max}),disabled,undefined,undefined,'any'),num('主刻度间隔（留空自动）',settings.step,step=>patch({step}),disabled,0,undefined,'any'),num('次刻度数',settings.minorTicks??3,minorTicks=>patch({minorTicks}),disabled,0,20),
   select('刻度方向',settings.ticks||'in',[['none','隐藏'],['in','向内'],['out','向外'],['both','双向']],ticks=>patch({ticks}),disabled),select('网格',settings.grid||'none',[['none','隐藏'],['major','主网格'],['both','主 / 次网格']],grid=>patch({grid}),disabled),check('显示坐标轴',settings.visible!==false,visible=>patch({visible}),disabled),
   input('轴线颜色',settings.color||'#000000',color=>patch({color}),disabled,{type:'color'}),num('轴线宽度（pt）',settings.lineWidth??3,lineWidth=>patch({lineWidth}),disabled,.5,8,.5)):h('section',{'data-axis-section':'digits'},h('h5',null,'刻度文字'),positionFields,select('刻度字体',settings.tickFont||spec.fontFamily,fonts.map(font=>[font,font]),tickFont=>patch({tickFont}),disabled),num('刻度字号',settings.tickSize??spec.fontSize,tickSize=>patch({tickSize}),disabled,6,100),input('刻度颜色',settings.tickColor||'#000000',tickColor=>patch({tickColor}),disabled,{type:'color'}),num('刻度文字旋转（°）',settings.tickRotation||0,tickRotation=>patch({tickRotation}),disabled,-180,180),select('数字格式',settings.format||'decimal',[['decimal','小数'],['scientific','科学计数'],['engineering','工程计数']],format=>patch({format}),disabled),num('小数位（-1 自动）',settings.decimals??-1,decimals=>patch({decimals}),disabled,-1,12)));
 }
 if(selected==='series'||selected.startsWith('series:')){const filled=['column','bar','box','histogram'].includes(spec.kind),symbols=['scatter','line_symbol'].includes(spec.kind);return h('div',null,
  select('数据系列',String(seriesColumn),spec.yCols.map(col=>[String(col),profile?.columns[col]?.name||'系列 '+(col+1)]),col=>onSelect('series:'+col),disabled),
  input('系列颜色',seriesColor(spec,seriesColumn),color=>seriesPatch({color,...(current.fillColor?{fillColor:color}:{}),...(current.borderColor?{borderColor:color}:{})}),disabled,{type:'color'}),
  filled||symbols?h('div',null,input(symbols?'符号填充颜色':'填充颜色',current.fillColor||seriesColor(spec,seriesColumn),fillColor=>seriesPatch({fillColor}),disabled,{type:'color'}),input(symbols?'符号边框颜色':'边框颜色',current.borderColor||seriesColor(spec,seriesColumn),borderColor=>seriesPatch({borderColor}),disabled,{type:'color'})):null,
  spec.kind!=='scatter'?num(filled?'边框宽度（pt）':'线宽（pt）',current.lineWidth??spec.lineWidth,lineWidth=>seriesPatch({lineWidth}),disabled,.5,8,.5):null,spec.kind!=='scatter'?select(filled?'边框线型':'线型',String(current.lineStyle??(!filled&&spec.lineStyle==='distinct'?spec.yCols.indexOf(seriesColumn)%2:0)),[['0','实线'],['1','虚线'],['2','点线'],['3','点划线'],['4','双点划线']],value=>seriesPatch({lineStyle:Number(value)}),disabled):null,
  symbols?h('div',null,num('符号大小',current.symbolSize??spec.symbolSize,symbolSize=>seriesPatch({symbolSize}),disabled,1,30),select('符号形状',String(current.symbolKind??spec.yCols.indexOf(seriesColumn)%5+1),[['1','方形'],['2','圆形'],['3','上三角'],['4','下三角'],['5','菱形']],value=>seriesPatch({symbolKind:Number(value)}),disabled),select('符号填充',current.symbolFill||'solid',[['solid','实心'],['open','空心']],symbolFill=>seriesPatch({symbolFill}),disabled)):null,
  ['column','bar'].includes(spec.kind)?num('柱间距（%）',current.barGap??20,barGap=>seriesPatch({barGap}),disabled,0,100):null,
  spec.kind==='box'?num('箱体宽度（pt）',current.boxWidth??20,boxWidth=>seriesPatch({boxWidth}),disabled,1,100):null,
  spec.kind==='histogram'?num('分箱宽度（留空自动）',current.binWidth,binWidth=>seriesPatch({binWidth}),disabled,0,undefined,'any'):null,
  symbols?num('符号边框宽度（% 半径）',current.symbolEdgeWidth??15,symbolEdgeWidth=>seriesPatch({symbolEdgeWidth}),disabled,0,100):null,
  num(spec.kind==='box'?'箱体不透明度':'不透明度',current.opacity??1,opacity=>seriesPatch({opacity}),disabled,0,1,.05),check('显示此系列',current.visible!==false,visible=>seriesPatch({visible}),disabled));}
 if(selected==='legend'){
  const order=[...(spec.legendOrder||[]),...spec.yCols.filter(col=>!spec.legendOrder?.includes(col))];
  return h('div',null,h('h5',null,'图例名称'),...order.map(col=>h('div',{key:'legend-name-'+col},input(profile?.columns[col]?.name||'系列 '+(col+1),seriesStyle(spec,col).label??profile?.columns[col]?.name??'',label=>change({series:updateSeries(spec,col,{label})}),disabled))),check('显示图例',spec.showLegend,showLegend=>change({showLegend}),disabled),check('显示边框',spec.legendFrame,legendFrame=>change({legendFrame}),disabled),h(TextProperties,{style:spec.legendStyle,onChange:patch=>textStyle('legendStyle',patch),spec,disabled,position:false}),
   num('水平位置',spec.legendX,legendX=>change({legendX}),disabled,0,1,.01),num('垂直位置',spec.legendY,legendY=>change({legendY}),disabled,0,1,.01),h('h5',null,'图例顺序'),...order.map((col,index)=>h('div',{className:'ib-plot-legend-order',key:col},h('span',null,seriesStyle(spec,col).label||profile?.columns[col]?.name||String(col)),action('↑',()=>{const next=[...order];[next[index-1],next[index]]=[next[index],next[index-1]];change({legendOrder:next});},disabled||index===0),action('↓',()=>{const next=[...order];[next[index+1],next[index]]=[next[index],next[index+1]];change({legendOrder:next});},disabled||index===order.length-1))));
 }
 if(selected==='annotations'||selected.startsWith('note:')){
  const note=spec.annotations.find(row=>row.id===selected.slice(5));
  const patch=value=>change({annotations:spec.annotations.map(row=>row.id===note.id?{...row,...value}:row)});
  return h('div',null,h('div',{className:'ib-plot-annotation-add'},...['text','arrow','line','rectangle'].map(kind=>action({text:'＋文字',arrow:'＋箭头',line:'＋直线',rectangle:'＋矩形'}[kind],()=>{const id='note'+crypto.randomUUID().replaceAll('-','').slice(0,10);change({annotations:[...spec.annotations,{id,kind,text:kind==='text'?'Text':'',x:.35,y:.25,x2:.6,y2:.4,style:{},lineWidth:2,opacity:1}]});onSelect('note:'+id);},disabled))),
   ...spec.annotations.map(row=>h('button',{className:'ib-plot-object-button',key:row.id,onClick:()=>onSelect('note:'+row.id),'data-selected':row.id===note?.id},row.text||{arrow:'箭头',line:'直线',rectangle:'矩形'}[row.kind])),
   note?h('div',null,note.kind==='text'?h(TextProperties,{text:note.text,onText:text=>patch({text}),style:note.style,onChange:value=>patch({style:{...note.style,...value}}),spec,disabled,position:false}):h('div',null,input('颜色',note.style.color||'#000000',color=>patch({style:{...note.style,color}}),disabled,{type:'color'}),num('线宽',note.lineWidth,lineWidth=>patch({lineWidth}),disabled,.5,8,.5),note.kind==='rectangle'?h('div',null,input('填充色',note.fill||'#FFFFFF',fill=>patch({fill}),disabled,{type:'color'}),num('不透明度',note.opacity,opacity=>patch({opacity}),disabled,0,1,.05)):null),
    num('起点 X',note.x,x=>patch({x}),disabled,-1,2,.01),num('起点 Y',note.y,y=>patch({y}),disabled,-1,2,.01),note.kind!=='text'?h('div',null,num('终点 X',note.x2,x2=>patch({x2}),disabled,-1,2,.01),num('终点 Y',note.y2,y2=>patch({y2}),disabled,-1,2,.01)):null,action('删除此标注',()=>{change({annotations:spec.annotations.filter(row=>row.id!==note.id)});onSelect('annotations');},disabled)):null);
 }
 if(selected==='layout'){
  const layout=spec.layout,patch=value=>change({layout:{...layout,...value}}),frames=layout.panels.length?layout.panels:(scene?.panelGeometry||[]);
  return h('div',null,select('页面排版',layout.mode,[['single','叠加在同一图层'],['panels','每个系列一个面板']],mode=>patch({mode}),disabled||spec.yCols.length<2||!['line','line_symbol','scatter','column'].includes(spec.kind)),num('网格列数',layout.columns,columns=>patch({columns,panels:[]}),disabled,1,4),num('面板间距（%）',layout.gap,gap=>patch({gap,panels:[]}),disabled,0,30),check('显示 (a)(b)(c) 标签',layout.labels,labels=>patch({labels}),disabled),
   h('p',{className:'ib-muted'},'更新预览后可在画布拖动、缩放各面板。位置吸附到 1% 网格。'),action('恢复网格对齐',()=>patch({panels:[]}),disabled),
   ...frames.map(panel=>h('fieldset',{className:'ib-plot-panel-editor',key:panel.index},h('legend',null,'面板 '+String.fromCharCode(97+panel.index)),...['left','top','width','height'].map(key=>num({left:'左侧（%）',top:'顶部（%）',width:'宽度（%）',height:'高度（%）'}[key],panel[key],value=>patch({panels:frames.map(row=>row.index===panel.index?{...row,[key]:value}:row)}),disabled,key==='width'||key==='height'?5:0,100)))));
 }
 return h('div',null,select('画布边距',spec.pageFit||'border',[['border','保留边距'],['tight','Tight（紧凑）']],pageFit=>change({pageFit}),disabled),num('图层宽度（cm）',spec.widthCm,widthCm=>change({widthCm}),disabled,4,30,.1),num('图层高度（cm）',spec.heightCm,heightCm=>change({heightCm}),disabled,4,30,.1),select('默认字体',spec.fontFamily,fonts.map(font=>[font,font]),fontFamily=>change({fontFamily}),disabled),num('刻度 / 图例字号',spec.fontSize,fontSize=>change({fontSize}),disabled,6,72),num('轴标题字号',spec.titleSize,titleSize=>change({titleSize}),disabled,8,80),input('背景颜色',spec.background,background=>change({background}),disabled,{type:'color'}),h('p',{className:'ib-muted'},'原始数据保持不变。修改会保存为可重放的对象配置，并写入 Origin 工程。'));
}
