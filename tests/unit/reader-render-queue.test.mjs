import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderQueue} from '../../client/src/reader-render-queue.js';
test('PDF rendering bounds concurrent work, skips cancelled pages and releases slots after errors',async()=>{
 const queue=createRenderQueue(2);let active=0,peak=0,skipped=false;const releases=[];
 const run=()=>queue(async()=>{active++;peak=Math.max(peak,active);await new Promise(done=>releases.push(done));active--;});
 const first=run(),second=run(),cancelled=queue(()=>{skipped=true;}),failed=queue(()=>{throw Error('fixture');}),last=queue(()=>42);
 cancelled.cancel();const rejected=assert.rejects(failed.promise,/fixture/);
 await new Promise(done=>setImmediate(done));assert.equal(active,2);releases.forEach(done=>done());await Promise.all([first.promise,second.promise,cancelled.promise,rejected]);assert.equal(await last.promise,42);assert.equal(peak,2);assert.equal(skipped,false);
});
