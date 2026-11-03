import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mnovaWithStartupRetry} from '../../lib/analysis.js';

test('only a read-only startup probe timeout is retried once',async()=>{
 let calls=0;const runtime={mnova:async()=>{calls++;if(calls===1)throw Error('Mnova 在 5 秒内未完成只读启动探针，已停止处理');return {ok:true};}};
 assert.deepEqual(await mnovaWithStartupRetry(runtime,'p','operation',{}),{ok:true});assert.equal(calls,2);
 calls=0;runtime.mnova=async()=>{calls++;throw Error('Mnova 任务超过 90 秒，已停止处理');};
 await assert.rejects(mnovaWithStartupRetry(runtime,'p','operation',{}),/超过/);assert.equal(calls,1);
 calls=0;runtime.mnova=async()=>{calls++;throw Error('Mnova 在 5 秒内未完成只读启动探针，已停止处理');};
 await assert.rejects(mnovaWithStartupRetry(runtime,'p','operation',{}),/启动探针/);assert.equal(calls,2);
});
