import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {runPlotJob} from '../../src/runtime/plot-job.js';

test('Origin progress is delivered before final result, and final waits for progress handling',async()=>{
 const seen=[],spawnImpl=()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  setImmediate(()=>{child.stdout.write('{"event":"plot-preview","preview":{"tier":"progress"}}\n');child.stdout.write('{"ok":true,"result":{"done":true}}\n');child.emit('close',0);});return child;
 };
 const result=await runPlotJob({command:'unused',cwd:'.',env:{}},'render',{}, {spawnImpl,onProgress:async event=>{await new Promise(resolve=>setTimeout(resolve,10));seen.push(event.tier);}});
 assert.deepEqual(seen,['progress']);assert.deepEqual(result,{done:true});
});
