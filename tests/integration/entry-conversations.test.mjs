import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootLite} from '../helpers/boot-lite.mjs';

test('paper conversations persist across tasks and reject metadata/RAG/shared conversations as task defaults',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-entry-conversations-'));let handle;
 const options={storageRoot:join(dir,'storage'),includePython:false,extraRows:[
  {id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},
  {id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(dir,'projects')}}
 ]};
 try{
  handle=await bootLite(options);let core=handle.ctx.ibmCore,tasks=handle.ctx.ibmLiteratureWorkflows;core.conversations.schedule=()=>{};
  const project=await core.createProject({id:'entry-project',name:'条目对话验证'});
  for(const sessionId of ['metadata-chat','rag-chat','shared-chat','paper-chat','other-chat'])await core.bindProjectSession({projectId:project.id,workspaceId:'entry-workspace',sessionId});
  const first=await tasks.registerPaperMeta({projectId:project.id,title:'First paper for conversation ownership',sourceType:'publisher'});
  const second=await tasks.registerPaperMeta({projectId:project.id,title:'Second paper for conversation ownership',sourceType:'publisher'});
  const request={projectId:project.id,reportId:first.report.id};
  await tasks.bindReadingSession({...request,sessionId:'shared-chat'});
  await tasks.bindReadingSession({projectId:project.id,reportId:second.report.id,sessionId:'shared-chat'});
  assert.equal((await tasks.readingConversation(request)).sessionId,null,'a shared project conversation cannot become two entry conversations');
  const workspace=(await core.ensureProjectWorkspace(project.id)).path;
  await mkdir(join(workspace,'.ibm-rag'),{recursive:true});
  await writeFile(join(workspace,'.ibm-rag','chat-sessions.json'),JSON.stringify({sessions:{'rag-chat':{settings:{keys:[]}}}}));
  await tasks.bindReadingSession({...request,sessionId:'rag-chat'});
  assert.equal((await tasks.readingConversation(request)).sessionId,null,'RAG conversations have a restricted task toolset');
  const original=tasks.getBundle(first.bundle.id),now=new Date().toISOString();
  await core.commitSourceBundle({...original,pdfIntake:{status:'completed',stage:'done',sessionId:'metadata-chat',originalFileName:'fixture.pdf',attempt:1,createdAt:now,updatedAt:now}});
  await tasks.bindReadingSession({...request,sessionId:'metadata-chat'});
  assert.equal((await tasks.readingConversation(request)).sessionId,null,'background metadata sessions are never reused for research tasks');
  await tasks.bindReadingSession({...request,sessionId:'paper-chat',canonical:true,previousSessionId:null});
  await core.commitSourceBundle({...original,title:'Updated metadata from an earlier snapshot'});
  assert.equal(tasks.getBundle(first.bundle.id).conversationSessionId,'paper-chat','metadata refreshes cannot erase the entry conversation');
  await tasks.bindReadingSession({...request,sessionId:'other-chat'});
  assert.equal(tasks.getReadingReport(first.report.id).sessionId,'paper-chat','unrelated tool registration cannot retarget an entry');
  assert.equal((await tasks.readingConversation({projectId:project.id,bundleId:first.bundle.id})).sessionId,'paper-chat');
  await assert.rejects(tasks.bindReadingSession({...request,sessionId:'other-chat',canonical:true}),/绑定已变化/);
  await assert.rejects(tasks.bindReadingSession({projectId:project.id,reportId:second.report.id,sessionId:'paper-chat',canonical:true}),/各自的对话/);
  const data=JSON.parse(await readFile(project.projectFilePath,'utf8'));assert.ok(JSON.stringify(data).includes('conversationSessionId'));
  await handle.dispose();handle=await bootLite(options);core=handle.ctx.ibmCore;tasks=handle.ctx.ibmLiteratureWorkflows;core.conversations.schedule=()=>{};
  assert.equal((await tasks.readingConversation(request)).sessionId,'paper-chat','restarting retains the entry conversation');
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});
