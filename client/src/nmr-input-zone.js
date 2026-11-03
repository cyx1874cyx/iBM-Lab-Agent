import {useRef,useState} from 'react';
import {h} from './h.js';
import {NMR_DATA_ACCEPT,NMR_STRUCTURE_ACCEPT,nmrDropFiles} from './nmr-files.js';

export function NmrInputZone({kind,name,drawn,busy,onFiles,onDraw}){
 const picker=useRef(null),depth=useRef(0),[dragging,setDragging]=useState(false);
 const structure=kind==='structure',label=structure?'分子结构式':'核磁原始数据';
 const isFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
 const claim=event=>{if(!isFiles(event))return false;event.preventDefault();event.stopPropagation();return true;};
 return h('section',{className:'ib-nmr-input-zone','data-nmr-input':kind,'data-selected':name||drawn?'true':undefined,'data-dragging':dragging?'true':undefined,
  onDragEnter:event=>{if(claim(event)){depth.current++;setDragging(true);}},
  onDragOver:event=>{if(claim(event))event.dataTransfer.dropEffect='copy';},
  onDragLeave:event=>{if(claim(event)&&--depth.current<=0){depth.current=0;setDragging(false);}},
  onDrop:event=>{if(!claim(event))return;depth.current=0;setDragging(false);onFiles(nmrDropFiles(event.dataTransfer));}
 },h('button',{type:'button',className:'ib-nmr-input-pick','aria-label':'选择'+label,disabled:busy,onClick:()=>picker.current?.click()},
  h('svg',{width:28,height:28,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:structure?'m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z':'M3 4v16h18M6 15h3l2-8 3 10 2-6h4'})),
  h('b',null,label),h('span',{className:'ib-nmr-input-name',title:name},name||(drawn?'已绘制分子结构':'拖拽到这里，或点击选择文件')),
  h('small',null,structure?'MOL、SDF、CDXML 等结构文件':'FID 文件夹拖入、ZIP、Mnova、JCAMP')),
 h('input',{ref:picker,type:'file',hidden:true,accept:structure?NMR_STRUCTURE_ACCEPT:NMR_DATA_ACCEPT,'aria-label':'上传'+label,disabled:busy,onChange:event=>{const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)onFiles(Promise.resolve(files));}}),
 structure?h('button',{type:'button',className:'ib-act ib-nmr-draw-button',disabled:busy,onClick:onDraw},drawn?'重新绘制':'绘制结构式'):null);
}
