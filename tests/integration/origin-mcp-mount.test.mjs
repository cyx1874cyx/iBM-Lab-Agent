import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootLite} from '../helpers/boot-lite.mjs';
import {createScope} from '@deepseek-ai/dsh-scope';
import * as origin from '../../lib/origin-mcp.js';

const python=process.env.IBM_ORIGIN_ACCEPTANCE_PYTHON;

test('server form never mounts the desktop Origin client',async()=>{
 const previous=process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;
 delete process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;
 try{await origin.apply({get ibmRuntime(){throw Error('must not start a worker on server');}});}
 finally{if(previous===undefined)delete process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;else process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=previous;}
});

test('research Origin plugin publishes the full model catalog in its conversation scope and disposes it', {skip:!python,timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-origin-mount-'));
 const previous=process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;
 process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=python;
 let handle,scope;
 try{
  // Same fixed product plugin used in the real research preset, no manually
  // supplied MCP config or Python-side tool listing.
  const preset=await readFile(new URL('../../presets/lab-research/preset.patch.yml',import.meta.url),'utf8');
  assert.match(preset,/id: lab-origin-mcp\s+name: dsh-lab-agent\/origin-mcp/);
  handle=await bootLite({storageRoot:join(dir,'storage'),coreOnly:true,includePython:false,extraRows:[
   {id:'runtime',name:'dsh-lab-agent/runtime'},
   {id:'system-prompt',name:'@deepseek-ai/dsh-system-prompt'},
   {id:'tools',name:'@deepseek-ai/dsh-tools'}
  ]});
  const key={id:'origin-conversation-fixture'};
  scope=createScope(handle.ctx,key);
  await scope.ctx.plugin(origin);
  const schemas=handle.ctx.tools.sdkSchemas(key);
  const names=schemas.map(s=>s.name).filter(name=>name.startsWith('mcp__origin__'));
  assert.equal(names.length,237);
  for(const raw of ['origin_ping','origin_plot','origin_set_axis','origin_set_plot_style','origin_export_graph','origin_get_layer_info'])assert.ok(names.includes('mcp__origin__'+raw),raw);
  assert.equal(handle.ctx.tools.get('mcp__origin__origin_plot'),undefined,'not injected into unrelated conversations');
  const result=await handle.ctx.tools.get('mcp__origin__origin_list_project',key).execute({}, {signal:new AbortController().signal});
  const body=result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);
  assert.equal(typeof body.ok,'boolean');
  assert.ok(body.ok||body.error_code==='origin_bridge_unavailable',JSON.stringify(body));
  console.log(JSON.stringify({modelToolCount:names.length,liveBridgeConnected:body.ok,errorCode:body.error_code??null}));
  await scope.dispose();scope=undefined;
  assert.equal(handle.ctx.tools.get('mcp__origin__origin_plot',key),undefined,'tools removed with conversation scope');
 }finally{
  await scope?.dispose();await handle?.dispose();
  if(previous===undefined)delete process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;else process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=previous;
  await rm(dir,{recursive:true,force:true});
 }
});
