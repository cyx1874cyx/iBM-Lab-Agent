import {useState} from 'react';
import {createPortal} from 'react-dom';
import {h} from 'dsh-lab-agent/client-sdk';
import {SIMULATION_SOLVENTS} from 'dsh-lab-agent/nmr/simulation';

export function NmrSimulationSettings({row,onClose,onGenerate}){
 const [p,setP]=useState({nucleus:'1H',solvent:'CDCl3',frequencyMHz:400,massMg:10,volumeMl:0.6,linewidthHz:1.5,temperatureK:298,scans:16,includeExchangeable:false}),[error,setError]=useState('');
 const set=(key,value)=>setP(old=>({...old,[key]:value}));
 const number=(key,label,min,max)=>h('label',{className:'ib-field'},h('span',null,label),h('input',{type:'number',step:'any',min,max,value:p[key],onChange:e=>set(key,e.target.value)}));
 const select=(key,label,choices)=>h('label',{className:'ib-field'},h('span',null,label),h('select',{value:p[key],onChange:e=>{set(key,e.target.value);if(key==='nucleus')set('frequencyMHz',e.target.value==='1H'?400:100);}},choices.map(v=>h('option',{key:v,value:v},v))));
 return createPortal(h('div',{className:'ib-overlay ib-nmr-modal-backdrop',onClick:e=>{if(e.target===e.currentTarget)onClose();}},h('section',{className:'ib-nmr-form ib-nmr-sim-settings',role:'dialog','aria-modal':true,'aria-label':'核磁模拟设置'},
  h('h3',null,'核磁模拟设置'),h('p',null,row.title),
  h('div',{className:'ib-form-grid'},select('nucleus','核种',['1H','13C']),select('solvent','氘代溶剂',SIMULATION_SOLVENTS),number('massMg','样品质量 / mg',0.001,10000),number('volumeMl','溶剂体积 / mL',0.01,1000)),
  h('details',null,h('summary',null,'更多条件'),h('div',{className:'ib-form-grid'},number('frequencyMHz','观测核频率 / MHz',10,1500),number('linewidthHz','线宽 / Hz',0.1,100),number('temperatureK','温度 / K',180,400),number('scans','扫描次数',1,100000)),h('label',null,h('input',{type:'checkbox',checked:p.includeExchangeable,onChange:e=>set('includeExchangeable',e.target.checked)}),' 显示交换氢预测')),
  h('p',{className:'ib-muted'},'科研助手将依据结构和可用证据建立峰模型，再生成合成 FID；不确定的峰不会伪装为实测。'),error?h('p',{className:'ib-error',role:'alert'},error):null,
  h('div',{className:'ib-form-foot'},h('button',{className:'ib-act',type:'button',onClick:onClose},'取消'),h('button',{className:'ib-act','data-kind':'accent',type:'button',onClick:()=>{try{const values=Object.entries(p).filter(([key])=>!['nucleus','solvent','includeExchangeable'].includes(key));if(values.some(([,value])=>!Number.isFinite(Number(value))||Number(value)<=0))throw Error('请填写有效的正数参数');onGenerate(p);}catch(e){setError(e.message);}}},'生成')))),document.body);
}
