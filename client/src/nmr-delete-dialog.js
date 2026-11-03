import {useState} from 'react';
import {createPortal} from 'react-dom';
import {h} from './h.js';

export function NmrDeleteDialog({row,mode,busy,error,onCancel,onDelete}){
 const [selected,setSelected]=useState([]);
 const exists=slot=>slot==='simulation'?!!row.simulationArtifact?.sha256:!!row.artifacts?.[slot]?.sha256||(row.artifactHistory||[]).some(h=>!!h.artifacts?.[slot]?.sha256);
 const toggle=slot=>setSelected(old=>old.includes(slot)?old.filter(v=>v!==slot):[...old,slot]);
 return createPortal(h('div',{className:'ib-overlay ib-nmr-modal-backdrop',onClick:e=>{if(e.target===e.currentTarget&&!busy)onCancel();}},h('section',{className:'ib-nmr-form ib-nmr-delete-dialog',role:'dialog','aria-modal':true,'aria-label':mode==='outputs'?'删除核磁产出文件':'删除核磁条目'},
  h('h3',null,mode==='outputs'?'删除产出文件':'删除条目及文件'),h('p',null,'核磁条目：',h('b',null,row.compound?.name||row.title||row.name)),
  mode==='outputs'?h('p',null,'选择要删除的产出文件，条目和原始文件会保留：'):h('p',null,'将删除条目及其登记的原始核磁数据、结构文件、标峰文件、报告和模拟任务文件。此操作不可撤销。'),
  mode==='outputs'?h('div',{className:'ib-nmr-delete-options'},[['simulation','模拟谱 Mnova 文件'],['spectrum','真实标峰 Mnova 文件（含已登记的历史版本）'],['report','核磁报告（含已登记的历史版本）']].map(([slot,label])=>h('label',{key:slot},h('input',{type:'checkbox',checked:selected.includes(slot),disabled:busy||!exists(slot),onChange:()=>toggle(slot)}),h('span',null,label,exists(slot)?'':'（没有可校验的登记文件）')))):null,
  h('p',{className:'ib-muted'},mode==='outputs'?'仅删除勾选的已登记文件，未选择的文件会保留。':'被其他条目引用的文件不会被删除；未登记且无法确认归属的辅助文件可能保留。'),
  error?h('p',{className:'ib-error',role:'alert'},error):null,
  h('div',{className:'ib-form-foot'},h('button',{className:'ib-act',disabled:busy,onClick:onCancel},'取消'),h('button',{className:'ib-act','data-kind':'danger',disabled:busy||mode==='outputs'&&!selected.length,onClick:()=>onDelete(selected)},busy?'正在删除…':mode==='outputs'?'删除所选文件':'删除条目及文件')))),document.body);
}
