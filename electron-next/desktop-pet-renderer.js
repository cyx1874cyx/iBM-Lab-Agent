import { selectPetTask, runningPetTasks } from '../src/runtime/task-activity.js';
import { selectPetQuote } from '../src/runtime/pet-quotes.js';
const element=id=>document.getElementById(id);
element('hide').onclick=()=>window.ibmPet.hide();element('main').onclick=()=>window.ibmPet.openMain();
let quotes=[],previousQuote='',quoteTimer,pointer,suppressClick=false;
const closeQuote=()=>{clearTimeout(quoteTimer);element('quote').hidden=true;element('pet').classList.remove('quote-open');};
const showQuote=()=>{
 previousQuote=selectPetQuote(quotes,previousQuote);
 element('quote-text').textContent=previousQuote||'还没有语录，请在 iBM 插件设置 → 桌面宠物中添加。';
 element('quote').hidden=false;element('pet').classList.add('quote-open');
 clearTimeout(quoteTimer);quoteTimer=setTimeout(closeQuote,6000);
};
element('quote-close').onclick=closeQuote;
const portrait=element('portrait-button');
portrait.onclick=event=>{if(suppressClick&&event.detail!==0){suppressClick=false;return;}showQuote();};
portrait.onpointerdown=event=>{
 if(event.button!==0||!event.isPrimary)return;
 suppressClick=false;pointer={id:event.pointerId,x:event.screenX,y:event.screenY,dragged:false};portrait.setPointerCapture(event.pointerId);
};
portrait.onpointermove=event=>{
 if(pointer?.id!==event.pointerId)return;
 if(!pointer.dragged&&Math.hypot(event.screenX-pointer.x,event.screenY-pointer.y)<6)return;
 if(!pointer.dragged){pointer.dragged=true;window.ibmPet.beginDrag(pointer.x,pointer.y);}
 window.ibmPet.drag(event.screenX,event.screenY);
};
const finishPointer=event=>{
 if(pointer?.id!==event.pointerId)return;
 suppressClick=pointer.dragged;
 if(pointer.dragged)window.ibmPet.endDrag();
 pointer=null;
};
portrait.onpointerup=finishPointer;portrait.onpointercancel=finishPointer;portrait.onlostpointercapture=finishPointer;
window.renderPet=state=>{
 quotes=state.quotes??[];
 if(previousQuote&&!quotes.includes(previousQuote))closeQuote();
 element('portrait').src=state.icon;
 const tasks=state.tasks??[],active=runningPetTasks(tasks);
 const task=selectPetTask(tasks);
 const mood=!task?'idle':task.status==='failed'?'error':task.status==='completed'?'done':['waiting','queued'].includes(task.status)?'waiting':task.status==='cancelled'?'idle':'busy';
 element('pet').className=mood+(element('quote').hidden?'':' quote-open');element('badge').textContent={idle:'·',busy:'↻',waiting:'Ⅱ',done:'✓',error:'!'}[mood];
 element('label').textContent=task?.label??'iBM 科研助手';element('stage').textContent=task?.stage??'当前没有进行中的任务';
 element('detail').textContent=task?.detail??'';
 const percent=task?.percent;element('fill').className='fill'+(percent==null?' unknown':'');element('fill').style.width=percent==null?'':percent+'%';
 element('foot').textContent=active.length>1?`${active.length} 项任务进行中`:percent!=null?`${Math.round(percent)}% · 单击语录`: '单击语录 · 拖动调整位置';
 element('queue').replaceChildren(...active.slice(1,4).map(row=>{const node=document.createElement('div');node.textContent=row.label+' · '+row.stage;return node;}));
};
