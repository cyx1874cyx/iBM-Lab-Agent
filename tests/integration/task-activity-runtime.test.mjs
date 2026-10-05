import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {bootLite} from '../helpers/boot-lite.mjs';
test('real kernel execution publishes running, success, failure and cancellation to the pet activity source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-activity-test-'));
 const handle=await bootLite({storageRoot:root,coreOnly:true,includePython:false,extraRows:[{id:'prompt',name:'@deepseek-ai/dsh-system-prompt'},{id:'tools',name:'@deepseek-ai/dsh-tools'}]});
 try{
  const {ctx}=handle;let release;
  ctx.tools.register(defineTool({name:'origin_fixture_export',description:'Isolated activity pipeline fixture',parameters:{fail:{type:'boolean'}},output:{schema:{type:'string'},render:value=>[{type:'text',text:value}]},execute:async args=>{await new Promise(done=>{release=done;});if(args.fail)throw Error('fixture failure');return 'saved';}}));
  for(const [id,fail,cancel,status] of [['success',false,false,'completed'],['failure',true,false,'failed'],['cancel',false,true,'cancelled']]){
   release=undefined;const controller=new AbortController();
   const pending=ctx.tools.execute({callId:id,name:'origin_fixture_export',arguments:{fail},signal:controller.signal});
   for(let i=0;i<50&&!release;i++)await new Promise(done=>setTimeout(done,10));
   assert.ok(release);assert.equal(ctx.ibmCore.activity.rows.get('tool:'+id)?.status,'running');
   if(cancel)controller.abort();release();const result=await pending;
   assert.equal(ctx.ibmCore.activity.rows.get('tool:'+id)?.status,status,JSON.stringify(result));
  }
 }finally{await handle.dispose();}
});
