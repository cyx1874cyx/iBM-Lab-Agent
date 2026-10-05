import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskActivity,toolActivity,activitySnapshot,registeredActivity,selectPetTask} from '../../src/runtime/task-activity.js';
test('all seven research categories have real execution classifications',()=>{
 for(const [name,kind] of [['lab_tasks_fetch_wechat_article','wechat'],['lab_tasks_get_reading_inputs','reading'],['lab_ppt_build_from_template','ppt'],['lab_synth_route_create','synthesis'],['mnova_apply_assignments_1d','nmr'],['origin_export_graph','origin']])assert.equal(toolActivity(name)?.kind,kind);
 assert.equal(toolActivity('lab_tasks_register_paper_meta'),null);
 assert.equal(toolActivity('lab_synth_target_list'),null);
});
test('tools never claim whole-task completion or invent numeric progress; cancellation and failure stay distinct',()=>{
 let now=1000;const activity=new TaskActivity(()=>now);
 const row=activity.start({callId:'a',name:'origin_export_graph',arguments:{password:'secret'}});
 assert.equal(row.percent,null);assert.equal(JSON.stringify(row).includes('secret'),false);
 activity.finish(row.id,{isError:false});assert.equal(activity.snapshot()[0].stage,'当前步骤完成');
 activity.finish(row.id,{isError:true});assert.equal(activity.snapshot()[0].status,'failed');
 activity.finish(row.id,{},true);assert.equal(activity.snapshot()[0].status,'cancelled');
 now+=120001;assert.deepEqual(activity.snapshot(),[]);
});
test('download percentage requires a known total, archive phase is distinct, and completion comes from the registry',()=>{
 const task={id:'capture-1',status:'armed',projectId:'p',createdAt:new Date().toISOString()};
 const table={keys:()=>['capture-1'],get:()=>task},live={task,downloading:true,bytes:30,totalBytes:0};
 const providers={labCapture:{table},ibmScientificDesktop:{armed:new Map([['capture-1',live]])}};
 const core={activity:new TaskActivity(),table:()=>({keys:()=>[]})},ctx={get:name=>providers[name]};
 let state=activitySnapshot(core,ctx);assert.equal(state.tasks[0].percent,null);assert.equal(state.tasks[0].stage,'正在下载');
 live.totalBytes=100;assert.equal(activitySnapshot(core,ctx).tasks[0].percent,30);
 live.processing=true;state=activitySnapshot(core,ctx);assert.equal(state.tasks[0].stage,'正在归档');
 providers.ibmScientificDesktop.armed.clear();task.status='completed';state=activitySnapshot(core,ctx);assert.equal(state.tasks[0].percent,100);assert.equal(state.tasks[0].stage,'归档完成');
});
test('waiting review is not a completed scientific task; concurrent work remains visible',()=>{
 const row=registeredActivity({id:'r',status:'under-review',updatedAt:new Date().toISOString()},'reading');
 assert.equal(row.status,'waiting');assert.equal(row.percent,null);
 const activity=new TaskActivity();activity.update('one',{label:'核磁',stage:'标峰',status:'running'});activity.update('two',{label:'Origin',stage:'绘图',status:'running'});
 assert.equal(activity.snapshot([row]).length,3);
});
test('pet only selects running tasks, excluding queued, review and terminal notifications',()=>{
 const tasks=['queued','waiting','completed','failed','cancelled'].map(status=>({id:status,status,updatedAt:Date.now()}));
 assert.equal(selectPetTask(tasks),undefined);
 tasks.push({id:'pdf',status:'running',stage:'正在下载'});
 assert.equal(selectPetTask(tasks).id,'pdf');
});
