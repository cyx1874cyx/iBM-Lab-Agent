import { selectPetTask, runningPetTasks } from '../src/runtime/task-activity.js';
const element=id=>document.getElementById(id);
element('hide').onclick=()=>window.ibmPet.hide();element('main').onclick=()=>window.ibmPet.openMain();
window.renderPet=state=>{
 element('portrait').src=state.icon;
 const tasks=state.tasks??[],active=runningPetTasks(tasks);
 const task=selectPetTask(tasks);
 const mood=!task?'idle':task.status==='failed'?'error':task.status==='completed'?'done':['waiting','queued'].includes(task.status)?'waiting':task.status==='cancelled'?'idle':'busy';
 element('pet').className=mood;element('badge').textContent={idle:'·',busy:'↻',waiting:'Ⅱ',done:'✓',error:'!'}[mood];
 element('label').textContent=task?.label??'iBM 科研助手';element('stage').textContent=task?.stage??'当前没有进行中的任务';
 element('detail').textContent=task?.detail??'';
 const percent=task?.percent;element('fill').className='fill'+(percent==null?' unknown':'');element('fill').style.width=percent==null?'':percent+'%';
 element('foot').textContent=active.length>1?`${active.length} 项任务进行中`:percent!=null?`${Math.round(percent)}% · 可拖动头像`: '拖动头像调整位置';
 element('queue').replaceChildren(...active.slice(1,4).map(row=>{const node=document.createElement('div');node.textContent=row.label+' · '+row.stage;return node;}));
};
