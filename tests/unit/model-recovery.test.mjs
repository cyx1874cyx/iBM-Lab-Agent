import {test} from 'node:test';import assert from 'node:assert/strict';
import {installModelRecovery} from '../../src/runtime/model-recovery.js';
test('malformed DeepSeek tool JSON regenerates once per step; cancellation and other errors never retry',async()=>{
 let handler,warnings=0,nextCalls=0;installModelRecovery({on:(_,fn)=>{handler=fn;},logger:{warn:()=>warnings++}});
 const agent={},payload={agent,turn:1,step:2,provider:'deepseek-account',failure:{code:'MALFORMED_RESPONSE',message:'DeepSeek Messages stream: tool input is invalid JSON'}};
 const next=async()=>{nextCalls++;return undefined;};
 assert.deepEqual(await handler(payload,next),{kind:'retry'});assert.equal(await handler(payload,next),undefined);assert.equal(warnings,1);
 assert.deepEqual(await handler({...payload,step:3},next),{kind:'retry'});
 assert.equal(await handler({...payload,signal:{aborted:true}},next),undefined);
 assert.equal(await handler({...payload,failure:{code:'INVALID_CREDENTIAL'}},next),undefined);assert.equal(nextCalls,3);
});
