import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerMnovaTools} from '../../lib/mnova-tool.js';
import {runMnovaJob} from '../../src/runtime/mnova-job.js';

test('desktop conversations expose all five project-bound Mnova operations',async()=>{
 const previous=process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;
 process.env.IBM_LAB_AGENT_BUNDLED_PYTHON='bundled-python';
 try{
  const definitions=[],calls=[];
  const runtime={mnova:async(...args)=>{calls.push(args);return {status:'ok'};}};
  const core={getProjectBySession:sessionId=>sessionId==='nmr-chat'?{project:{id:'project-a'}}:undefined};
  registerMnovaTools({tools:{register:tool=>definitions.push(tool)},get:name=>name==='ibmCore'?core:name==='ibmRuntime'?runtime:undefined});
  assert.deepEqual(definitions.map(d=>d.name),['mnova_status','mnova_probe_runtime','mnova_process_1d','mnova_prepare_structure_1d','mnova_apply_assignments_1d']);
  const signal=new AbortController().signal;
  const prepare=definitions.find(d=>d.name==='mnova_prepare_structure_1d');
  await prepare.execute({input_path:'raw/fid',structure_path:'target.mol'},{agent:{session:{id:'nmr-chat'}},signal});
  assert.deepEqual(calls[0],['project-a','mnova_prepare_structure_1d',{input_path:'raw/fid',structure_path:'target.mol'},{signal}]);
  assert.equal((await prepare.execute({input_path:'raw/fid',structure_path:'target.mol'},{})).ok,false);
  assert.equal(calls.length,1);
 }finally{if(previous===undefined)delete process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;else process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=previous;}
});

test('fixed Mnova dispatcher passes Unicode paths as data and cancels its owned worker',async()=>{
 const calls=[],children=[];
 const spawnImpl=(...args)=>{calls.push(args);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{child.killed=true;};children.push(child);return child;};
 const config={command:'managed-python',cwd:'H:/科研工程',env:{MNOVA_MCP_WORKSPACE:'H:/科研工程'}};
 const result=runMnovaJob(config,'mnova_status',{}, {spawnImpl});
 children[0].stdout.emit('data',Buffer.from('{"ok":true,"result":{"status":"ok"}}'));children[0].emit('close',0);
 assert.deepEqual(await result,{status:'ok'});assert.equal(calls[0][0],'managed-python');assert.match(calls[0][1][1],/mnova_job\.py$/);assert.equal(calls[0][2].cwd,config.cwd);
 const abort=new AbortController();const pending=runMnovaJob(config,'mnova_probe_runtime',{input_path:'H:/科研工程/原始数据/fid'},{spawnImpl,signal:abort.signal});
 abort.abort(Error('用户已终止'));await assert.rejects(pending,/已终止/);assert.equal(children[1].killed,true);
 assert.equal(JSON.parse(calls[1][1][3]).input_path,'H:/科研工程/原始数据/fid');
});
