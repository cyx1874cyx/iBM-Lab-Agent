import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectSessionId,openProjectConversation,taskEntryIdentity,createEntryOperationQueue,resolveEntryConversation,openReadingPreviewConversation,prefillEntryTask} from '../../client/src/project-task-session.js';
import {LabCharacterizationService} from '../../lib/characterization.js';

test('panel operations without an entry still create separate conversations',async()=>{
 const calls=[];let counter=0;
 const ctx={sessions:{create:async options=>{calls.push(options);return 'new-'+ ++counter;}},uiWorkspace:{connectWorkspace:async()=>{throw Error('must not reuse a blank conversation');}}};
 const ids=await Promise.all(['reading','nmr','plot','writing'].map(()=>projectSessionId(ctx,{workspaceId:'project-workspace',reuseSessionId:'existing-chat',fresh:true})));
 assert.equal(new Set(ids).size,4);assert.deepEqual(calls,Array(4).fill({workspaceId:'project-workspace'}));
 assert.equal(await projectSessionId(ctx,{workspaceId:'project-workspace',reuseSessionId:'existing-chat'}),'existing-chat');
});

test('translation, reading and PPT resolve one persisted conversation even for concurrent report/bundle aliases',async()=>{
 const stored=new Map(),created=[],bound=[],opened=[],queue=createEntryOperationQueue();
 const ctx={sessions:{create:async({workspaceId})=>{assert.equal(workspaceId,'workspace-a');const id='entry-'+(created.length+1);created.push(id);return id;},using:async(id,_options,work)=>{assert.ok(bound.includes(id));return work();}}};
 const call=async(method,{request})=>{
  if(method==='tasks_reading_conversation'){const bundleId=request.bundleId||request.reportId.replace('report-','bundle-');return {bundleId,reportId:bundleId.replace('bundle-','report-'),sessionId:stored.get(bundleId)||null};}
  if(method==='projects_by_session')return {bound:{project:{id:'project-a'}}};
  throw Error('Unexpected API '+method);
 };
 const run=options=>{const entry=taskEntryIdentity(options);return queue('project-a',entry,async()=>{
  const resolved=await resolveEntryConversation(ctx,call,{projectId:'project-a',workspaceId:'workspace-a',entry});
  bound.push(resolved.sessionId);stored.set(resolved.bundleId,resolved.sessionId);opened.push(resolved.sessionId);return resolved;
 });};
 await Promise.all([run({readingIdentity:{reportId:'report-1'}}),run({translationIdentity:{bundleId:'bundle-1'}}),run({readingIdentity:{reportId:'report-1'}})]);
 assert.deepEqual(created,['entry-1']);assert.deepEqual(opened,['entry-1','entry-1','entry-1']);
 await run({readingIdentity:{reportId:'report-2'}});assert.deepEqual(created,['entry-1','entry-2']);
});

test('NMR retries resolve their saved entry conversation; missing sessions may be replaced but transient failures are surfaced',async()=>{
 let created=0,missing=false,failure;
 const ctx={sessions:{create:async()=>{created++;return 'replacement';},using:async()=>{if(failure)throw failure;if(missing)throw Error('session not found');}}};
 const call=async method=>method==='characterization_list'?{tasks:[{id:'nmr-1',projectId:'project-a',conversationSessionId:'analysis-chat'}]}:{bound:{project:{id:'project-a'}}};
 const request={projectId:'project-a',workspaceId:'workspace-a',entry:taskEntryIdentity({characterizationIdentity:{taskId:'nmr-1',attempt:2}})};
 assert.equal((await resolveEntryConversation(ctx,call,request)).sessionId,'analysis-chat');assert.equal(created,0);
 missing=true;assert.equal((await resolveEntryConversation(ctx,call,request)).sessionId,'replacement');assert.equal(created,1);
 failure=Error('connection unavailable');await assert.rejects(resolveEntryConversation(ctx,call,request),/connection unavailable/);assert.equal(created,1);
});

test('plot entries reopen their own project-bound conversations',async()=>{
 let created=0;
 const ctx={sessions:{create:async()=>{created++;return 'new-plot-chat';},using:async()=>{}}};
 const call=async(method,{request})=>method==='plot_records_list'?{records:[{id:'plot-a',projectId:'p',workflow:{},conversationSessionId:'plot-chat'}]}:{bound:{project:{id:request.sessionId==='plot-chat'?'p':'other'}}};
 const entry={kind:'plot',recordId:'plot-a'};
 assert.equal((await resolveEntryConversation(ctx,call,{projectId:'p',workspaceId:'ws',entry})).sessionId,'plot-chat');
 assert.equal(created,0);
 await assert.rejects(resolveEntryConversation(ctx,call,{projectId:'other',workspaceId:'ws',entry}),/不属于当前课题/);
});

test('PDF, translation and report previews open the corresponding entry conversation without submitting a task or overwriting drafts',async()=>{
 const launches=[],project={id:'project-a'},call=async(method,{request})=>{assert.equal(method,'projects_get');assert.equal(request.id,project.id);return{project};};
 const launch=async(target,options)=>{assert.equal(target,project);launches.push(options);return{sessionId:'paper-'+options.entryIdentity.bundleId,openedNew:false};};
 for(const mode of ['pdf','zh','report','ppt']){
  assert.equal((await openReadingPreviewConversation(call,launch,{projectId:project.id,bundleId:'a',mode})).sessionId,'paper-a',mode);
 }
 assert.equal((await openReadingPreviewConversation(call,launch,{projectId:project.id,bundleId:'b',mode:'report'})).sessionId,'paper-b');
 assert.ok(launches.every(options=>options.entryOpenOnly&&options.preserveDraft&&!options.autoSubmit&&!options.prompt));
 assert.deepEqual(launches[0].entryIdentity,{kind:'reading',bundleId:'a'});
});

test('continuing an entry preserves unsent text and does not duplicate a prefilled task',()=>{
 let draft='补充要求：关注图 2 的数据';const input={state:{getSnapshot:()=>({draft})},setDraft:text=>{draft=text;}};
 prefillEntryTask(input,'请精读这篇论文',true);assert.equal(draft,'补充要求：关注图 2 的数据\n\n请精读这篇论文');
 prefillEntryTask(input,'请精读这篇论文',true);assert.equal(draft.split('请精读这篇论文').length,2);
});

test('entry navigation opens only its bound conversation and never creates or sends a task',async()=>{
 const opened=[],scopeCalls=[];
 const ctx={sessions:{using:async(id,options,work)=>{scopeCalls.push([id,options.source]);return work();},create:()=>{throw Error('must not create');}},uiWorkspace:{openSession:id=>opened.push(id)}};
 const call=async(method,{request})=>{assert.equal(method,'projects_by_session');return{bound:{project:{id:request.sessionId==='other-chat'?'other-project':'project-a'}}};};
 assert.deepEqual(await openProjectConversation(ctx,call,{projectId:'project-a',sessionId:'entry-chat'}),{sessionId:'entry-chat',openedNew:false});
 assert.deepEqual(opened,['entry-chat']);assert.deepEqual(scopeCalls,[['entry-chat','controllerOperation']]);
 await assert.rejects(openProjectConversation(ctx,call,{projectId:'project-a',sessionId:'other-chat'}),/未绑定当前课题/);
 await assert.rejects(openProjectConversation(ctx,call,{projectId:'project-a'}),/尚未绑定/);
 ctx.sessions.using=async()=>{throw Error('not found');};
 await assert.rejects(openProjectConversation(ctx,call,{projectId:'project-a',sessionId:'deleted-chat'}),/已不存在/);
 assert.deepEqual(opened,['entry-chat']);
});

test('stopping NMR cancels only its bound conversation and fences late callbacks',async()=>{
 const row={id:'nmr-task',projectId:'project-a',kind:'nmr',title:'sample',date:'2026-10-22',inputPath:'raw.mnova',structurePath:'target.mol',instructions:'analyze',status:'running',attempt:3,sessionId:'nmr-chat',artifacts:{},artifactHistory:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const rows=new Map([[row.id,row]]),cancelled=[];
 const service=Object.create(LabCharacterizationService.prototype);
 Object.defineProperty(service,'ctx',{value:{get:name=>name==='agents'?{get:id=>({cancel:cause=>cancelled.push({id,cause})})}:undefined}});
 service.table={get:id=>rows.get(id),put:async(id,value)=>rows.set(id,value)};service.locks=new Map();
 await assert.rejects(service.cancelNmr(row.id,'another-project',3),/当前课题/);
 await assert.rejects(service.cancelNmr(row.id,row.projectId,2),/过期/);
 assert.equal(cancelled.length,0);
 const stopped=await service.cancelNmr(row.id,row.projectId,3);
 assert.equal(stopped.conversationSessionId,'nmr-chat','cancelled analysis keeps its conversation accessible');
 assert.deepEqual(cancelled,[{id:'nmr-chat',cause:{kind:'user'}}]);assert.equal(stopped.status,'draft');assert.equal(stopped.attempt,4);assert.equal(stopped.sessionId,undefined);
 await assert.rejects(service.update(row.id,row.projectId,{attempt:3,status:'running'}),/过期/);
 await assert.rejects(service.complete(row.id,row.projectId,{attempt:3}),/过期/);
});
