import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyLiteratureAccess as classify} from '../../electron-next/literature-access.mjs';
import {deriveCaptureView,TERMINAL_PHASES} from '../../lib/capture-phase.js';
import {ScientificDesktopService} from '../../lib/scientific-desktop.js';

test('abstracts and download links do not establish permission; explicit evidence does',()=>{
 assert.equal(classify({text:'Abstract Download PDF',downloadEntry:true}).state,'unknown');
 assert.equal(classify({documentType:'application/pdf'}).state,'accessible');
 assert.equal(classify({fullText:true,text:'Purchase this article'}).state,'access-denied');
 assert.equal(classify({statusCode:403}).state,'access-denied');
 assert.equal(classify({statusCode:403,text:'Verify you are human'}).state,'verification-required');
 assert.equal(classify({password:true}).state,'login-required');
 assert.equal(classify({statusCode:404}).state,'not-found');
 assert.equal(classify({statusCode:503}).state,'page-error');
});
const task={id:'capture-1',projectId:'p',kind:'pdf',status:'armed',requestedBy:'agent'};
test('task view reports access separately from navigation and preserves blocked evidence after release',()=>{
 for(const state of ['login-required','verification-required']){
  const view=deriveCaptureView({task,desktop:{pendingTaskId:task.id,state:'waiting-download',stale:false,access:{state,evidence:'fixture'}}});
  assert.equal(view.requiresUserAction,true);assert.equal(view.nextAction,state==='login-required'?'complete-login':'complete-verification');
 }
 const view=deriveCaptureView({task:{...task,status:'failed',reasonCode:'access-denied',access:classify({statusCode:403})},desktop:{stale:true}});
 assert.equal(view.phase,'access-denied');assert.equal(view.nextAction,'check-institution-access');assert.equal(TERMINAL_PHASES.has(view.phase),true);
 assert.equal(deriveCaptureView({task,desktop:{pendingTaskId:task.id,state:'checking-access',stale:false}}).phase,'checking-access');
});
test('denied captures release ownership; login waits; native downloads and public SI remain eligible',async()=>{
 const run=async(kind,access,downloading=false)=>{
  const row={task:{...task,kind},lease:'lease',downloading};let saved={...row.task},disarmed=0;
  const service=Object.create(ScientificDesktopService.prototype);service.active=true;service.armed=new Map([[task.id,row]]);service.broker={call:async(method)=>{if(method==='disarm')disarmed++;assert.ok(['focus','disarm'].includes(method));}};
  service.ctx={get:()=>({getTask:()=>saved,transit:async(_,patch)=>{saved={...saved,...patch};}})};service.pumpCaptures=()=>{};
  await service.updateAccess(row,access);return {saved,disarmed,active:service.armed.size};
 };
 const denied=await run('pdf',classify({text:'Purchase this article'}));assert.equal(denied.saved.status,'failed');assert.equal(denied.disarmed,1);assert.equal(denied.active,0);
 const login=await run('pdf',classify({password:true}));assert.equal(login.saved.status,'armed');assert.equal(login.disarmed,0);
 const download=await run('pdf',classify({statusCode:403}),true);assert.equal(download.saved.status,'armed');assert.equal(download.disarmed,0);
 const si=await run('si',classify({text:'Purchase this article'}));assert.equal(si.saved.status,'armed');assert.equal(si.active,1);
});
