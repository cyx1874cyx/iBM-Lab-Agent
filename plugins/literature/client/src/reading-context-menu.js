import {useEffect,useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {h} from 'dsh-lab-agent/client-sdk';

export function ReadingContextMenu({menu,onClose,onDelete,onDeleteOutputs,label='精读条目操作'}){
 const root=useRef(null);
 useLayoutEffect(()=>{
  const node=root.current,rect=node.getBoundingClientRect();
  node.style.left=Math.max(8,Math.min(menu.x,innerWidth-rect.width-8))+'px';
  node.style.top=Math.max(8,Math.min(menu.y,innerHeight-rect.height-8))+'px';
  node.querySelector('button')?.focus({preventScroll:true});
 },[menu]);
 useEffect(()=>{
  const outside=event=>{if(!root.current?.contains(event.target))onClose();};
  const key=event=>{if(event.key==='Escape'||event.key==='Tab'){onClose();if(event.key==='Escape')event.preventDefault();}};
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',key,true);
  document.addEventListener('wheel',onClose,{capture:true,passive:true});
  document.addEventListener('touchmove',onClose,{capture:true,passive:true});
  window.addEventListener('resize',onClose);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);document.removeEventListener('wheel',onClose,true);document.removeEventListener('touchmove',onClose,true);window.removeEventListener('resize',onClose);};
 },[onClose]);
 return createPortal(h('div',{ref:root,className:'ib-reading-context-menu',role:'menu','aria-label':label,style:{left:menu.x,top:menu.y},onContextMenu:event=>event.preventDefault()},
  onDeleteOutputs?h('button',{type:'button',role:'menuitem',onClick:()=>{onClose();onDeleteOutputs(menu.reportIds);}},'删除产出文件…'):null,
  h('button',{type:'button',role:'menuitem',onClick:()=>{onClose();onDelete(menu.reportIds);}},menu.reportIds.length>1?`删除选中的 ${menu.reportIds.length} 篇`:onDeleteOutputs?'删除条目及文件…':'删除')
 ),document.body);
}
