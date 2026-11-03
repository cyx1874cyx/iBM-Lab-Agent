import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScope} from '@deepseek-ai/dsh-scope';
import {bootLite} from '../helpers/boot-lite.mjs';
import {registerMnovaTools} from '../../lib/mnova-tool.js';

const python=process.env.IBM_MNOVA_ACCEPTANCE_PYTHON;
test('real desktop tool catalog contains five scoped Mnova tools and calls the managed bridge',{skip:!python,timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-mnova-tools-'));let handle,scope;
 const previous=process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=python;
 try{
  handle=await bootLite({storageRoot:join(root,'store'),coreOnly:true,includePython:false,extraRows:[{id:'runtime',name:'dsh-lab-agent/runtime'},{id:'system',name:'@deepseek-ai/dsh-system-prompt'},{id:'tools',name:'@deepseek-ai/dsh-tools'}]});
  await handle.ctx.ibmCore.createProject({id:'mnova-fixture',name:'核磁工具验证'});
  const key={id:'mnova-tool-fixture'};scope=createScope(handle.ctx,key);
  await scope.ctx.plugin({inject:['tools','ibmCore','ibmRuntime'],apply:registerMnovaTools});
  const names=handle.ctx.tools.sdkSchemas(key).map(row=>row.name);
  for(const name of ['mnova_status','mnova_probe_runtime','mnova_process_1d','mnova_prepare_structure_1d','mnova_apply_assignments_1d'])assert.ok(names.includes(name),name);
  assert.equal(handle.ctx.tools.get('mnova_status'),undefined,'unrelated conversations have no injected Mnova tools');
  const status=await handle.ctx.tools.get('mnova_status',key).execute({projectId:'mnova-fixture'},{signal:new AbortController().signal});
  assert.equal(status.ok,true);assert.equal(status.launch_channel,'windows-shell');assert.equal(status.bridge_script_exists,true);
  assert.match(status.project_root,/mnova-fixture$/);
  await scope.dispose();scope=undefined;assert.equal(handle.ctx.tools.get('mnova_status',key),undefined);
 }finally{await scope?.dispose();await handle?.dispose();if(previous===undefined)delete process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;else process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=previous;await rm(root,{recursive:true,force:true});}
});
