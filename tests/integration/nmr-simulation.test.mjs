import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import init from 'indigo-ketcher/jsNoRender';
import {inspectNmrStructure,createNmrSimulation,listNmrSimulations} from '../../lib/nmr-simulation.js';
import {simulationParameters,simulateLines} from '../../src/nmr/simulation.js';
import {syntheticAssignmentPlan} from '../../src/nmr/synthetic-assignment.js';
import {runSyntheticFid} from '../../src/runtime/nmr-synthetic-fid.js';
import {spawn} from 'node:child_process';
import {ProcessSupervisor} from '../../src/runtime/process-supervisor.js';

const exampleModel={provenance:'仅用于验证的一阶峰模型',peaks:[{environmentId:'a',ppm:1.2,multiplicity:'t',jHz:7,evidence:'测试数据'},{environmentId:'b',ppm:3.65,multiplicity:'q',jHz:7,evidence:'测试数据'}]};
test('structure parsing accepts NMR formats; only an explicit peak model creates a spectrum',async()=>{
 const indigo=await init(),options=new indigo.MapStringString();
 try{
  const mrv='<cml><MDocument><MChemicalStruct><molecule molID="m1"><atomArray><atom id="a1" elementType="C" x2="0" y2="0"/><atom id="a2" elementType="C" x2="1" y2="0"/><atom id="a3" elementType="O" x2="2" y2="0"/></atomArray><bondArray><bond atomRefs2="a1 a2" order="1"/><bond atomRefs2="a2 a3" order="1"/></bondArray></molecule></MChemicalStruct></MDocument></cml>';
  for(const format of ['mol','sdf','cdx','cdxml','cml','inchi','mrv','smi','smiles']){
   const source=format==='mrv'?mrv:['smi','smiles'].includes(format)?'CCO':indigo.convert('CCO',format==='mol'?'molfile':format,options);
   const structure=await inspectNmrStructure({source,format,parameters:{}});
   assert.equal(structure.peaks,undefined,'structure inspection never predicts shifts');
   const r=await inspectNmrStructure({source,format,parameters:{},peakModel:exampleModel});
   assert.equal(r.synthetic,true,format);assert.equal(r.formula,'C2H6O',format);
   assert.equal(r.peaks.reduce((s,p)=>s+p.area,0),5,format);
   assert.equal(r.unresolved.length,1,format);
   assert.deepEqual(r.peaks.map(p=>p.attachedAtomIds),[[1],[2]],format);
   assert.ok(r.spectrum.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)));
   assert.ok(r.spectrum.points[0][0]>r.spectrum.points.at(-1)[0]);
   assert.match(r.svg,/SYNTHETIC/);assert.match(r.structureSvg,/>1<\/text>/);
   assert.ok(Math.abs(r.concentrationMm-361.776)<0.01);
  }
  const carbon=await inspectNmrStructure({source:'CCO',parameters:{nucleus:'13C'}});
  assert.equal(carbon.environments.length,2);
  const exchange=await inspectNmrStructure({source:'CCO',parameters:{includeExchangeable:true,solvent:'D2O'},peakModel:exampleModel});
  assert.equal(exchange.peaks.reduce((s,p)=>s+p.area,0),5);
  await assert.rejects(inspectNmrStructure({source:'CCO.C',parameters:{}}),/单个/);
  await assert.rejects(inspectNmrStructure({source:'C2H6O',parameters:{}}),/结构读取失败/);
  await assert.rejects(inspectNmrStructure({source:indigo.convert('CCO','sdf',options).repeat(2),format:'sdf',parameters:{}}),/多个记录/);
  await assert.rejects(inspectNmrStructure({source:'CCO',peakModel:{provenance:'test',peaks:[{environmentId:'a',ppm:1,multiplicity:'d',jHz:0,evidence:'test'}]}}),/无效/);
  await assert.rejects(inspectNmrStructure({source:'CCO',peakModel:{provenance:'test',peaks:[{environmentId:'z',ppm:1,multiplicity:'s',jHz:0,evidence:'test'}]}}),/编号无效/);
  const dd=await inspectNmrStructure({source:'CCO',parameters:{frequencyMHz:400},peakModel:{provenance:'test',peaks:[{environmentId:'a',ppm:1,multiplicity:'dd',jHz:8,extraJHz:2,evidence:'test'}]}});
  assert.deepEqual(dd.spectrum.components.map(c=>Number(c.ppm.toFixed(4))),[0.9875,0.9925,1.0075,1.0125]);
  assert.equal(dd.spectrum.components.reduce((sum,c)=>sum+c.area,0),3);
  await assert.rejects(inspectNmrStructure({source:'CCO',peakModel:{provenance:'test',peaks:[{environmentId:'a',ppm:1,multiplicity:'dd',jHz:8,evidence:'test'}]}}),/第二个 J/);
 }finally{options.delete();}
});

test('simulation validates numerical inputs and conserves first-order multiplet component areas',()=>{
 for(const parameters of [{massMg:0},{volumeMl:-1},{frequencyMHz:Infinity},{linewidthHz:0},{scans:1.5},{solvent:'unknown'},{nucleus:'31P'}])assert.throws(()=>simulationParameters(parameters));
 const r=simulateLines([{label:'a',ppm:1,area:3,weights:[1,2,1],jHz:8}],{frequencyMHz:400});
 assert.deepEqual(r.components.map(c=>c.ppm),[0.98,1,1.02]);
 assert.equal(r.components.reduce((s,c)=>s+c.area,0),3);
 for(const c of r.components)assert.ok(r.points.some(p=>p[0]===c.ppm),'every component center is sampled');
});

test('simulation labels only unambiguous predicted sites using the current Mnova atom and peak IDs',()=>{
 const result={parameters:{nucleus:'1H',frequencyMHz:400,linewidthHz:1.5},peaks:[{label:'a',ppm:1.2,attachedAtomIds:[1]},{label:'b',ppm:3.8,attachedAtomIds:[2]}]};
 const analysis={status:'ok',operation:'prepare_structure_1d',job_id:'current',atoms:[{index:1,non_equivalent_h_indices:[1]},{index:2,non_equivalent_h_indices:[1]}],multiplets:[{uuid:'m1',ppm:1.2,range_min_ppm:1.18,range_max_ppm:1.22},{uuid:'m2',ppm:3.8,range_min_ppm:3.78,range_max_ppm:3.82}]};
 const plan=syntheticAssignmentPlan(result,analysis);
 assert.deepEqual(plan.assignments.map(a=>[a.label,a.atom_index,a.h_index,a.multiplet_uuid]),[['a',1,1,'m1'],['b',2,1,'m2']]);
 const overlap=syntheticAssignmentPlan({...result,peaks:[result.peaks[0],{label:'b',ppm:1.2,attachedAtomIds:[2]}]},analysis);
 assert.equal(overlap.assignments.length,2);assert.ok(overlap.assignments.every(a=>a.multiplet_uuid==='m1'));
 analysis.atoms[1].non_equivalent_h_indices=[1,2];
 const ambiguous=syntheticAssignmentPlan(result,analysis);
   assert.equal(ambiguous.assignments.length,1);assert.equal(ambiguous.unresolved[0].multiplet_uuid,'m2');assert.equal(ambiguous.unmatchedEnvironments.length,1);
   assert.throws(()=>syntheticAssignmentPlan({...result,peaks:[{label:'a',ppm:1.2,attachedAtomIds:[1]},{label:'b',ppm:3.8,attachedAtomIds:[1]}]},analysis),/没有可匹配/);
});

test('project simulation archives source model and exports, reloads history, and rejects foreign files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-nmr-simulation-'));
 const service={ctx:{ibmCore:{getProject:id=>id==='p',ensureProjectWorkspace:async()=>({path:root})}},filePath:async(id,path)=>{const resolved=resolve(root,path),r=relative(root,resolved);if(id!=='p'||r.startsWith('..')||isAbsolute(r))throw Error('不属于当前课题');return resolved;}};
 try{
  await writeFile(join(root,'input.smi'),'CCO ethanol\n');
  await assert.rejects(createNmrSimulation(service,{projectId:'p',structurePath:'input.smi'}),/峰模型/);
  const r=await createNmrSimulation(service,{projectId:'p',structurePath:'input.smi',parameters:{massMg:5},peakModel:exampleModel});
  const path=join(root,'nmr-simulations',r.id);
  assert.equal(JSON.parse(await readFile(join(path,'synthetic-model.json'),'utf8')).synthetic,true);
  assert.match(await readFile(join(path,'synthetic-peaks.csv'),'utf8'),/a,1/);
  assert.equal((await listNmrSimulations(service,'p')).simulations[0].id,r.id);
  await assert.rejects(createNmrSimulation(service,{projectId:'other',smiles:'CCO',peakModel:exampleModel}),/课题不存在/);
  await assert.rejects(createNmrSimulation(service,{projectId:'p',structurePath:'../outside.smi',peakModel:exampleModel}),/当前课题/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('skill simulator creates and verifies a synthetic Varian FID',{skip:!process.env.IBM_MNOVA_ACCEPTANCE_PYTHON,timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-synthetic-fid-'));
 try{
  const model=join(root,'model.json'),out=join(root,'output');
  await writeFile(model,JSON.stringify({experiment:{nucleus:'1H',solvent:'CDCl3',obs_mhz:400,carrier_ppm:5,spectral_width_hz:5600,complex_points:16384,seed:42,noise_std:0},peaks:[{label:'a',ppm:1.2,area:3,linewidth_hz:1.5},{label:'b',ppm:3.8,area:2,linewidth_hz:1.5}]}));
  const result=await runSyntheticFid(process.env.IBM_MNOVA_ACCEPTANCE_PYTHON,model,out,{spawnImpl:(cmd,args,options)=>spawn(cmd,args,{...options,env:{...process.env,...options.env}})});
  assert.equal(result.metadata.synthetic,true);assert.equal(result.metadata.varian_readback_max_abs_error,0);
  assert.equal(result.metadata.component_peak_verification.length,2);
  assert.ok((await readFile(join(result.fidPath,'fid'))).length>0);
  assert.ok((await readFile(join(out,'synthetic_1d_varian_fid.zip'))).length>0);
  const supervisor=new ProcessSupervisor([process.env.IBM_MNOVA_ACCEPTANCE_PYTHON]);
  try{const supervised=await runSyntheticFid(supervisor.python,model,join(root,'supervised'),{spawnImpl:supervisor.spawn});assert.equal(supervised.metadata.synthetic,true);assert.equal(supervised.metadata.varian_readback_max_abs_error,0);}finally{await supervisor.dispose();}
 }finally{await rm(root,{recursive:true,force:true});}
});
