import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {bootLite} from '../helpers/boot-lite.mjs';
import {plotSpecSchema,validatePlotSelection,recommendationPrompt} from '../../src/plot/workspace.js';
import {plotWorkflowSchema} from '../../src/plot/workspace.js';
import {ScientificDesktopService} from '../../lib/scientific-desktop.js';

const profile=path=>({sheets:['Sheet1','第二页'],sheet:'Sheet1',rows:3,columns:[{index:0,name:'Time (s)',type:'number',count:3,missing:0,unique:3,min:0,max:2,monotonic:true},{index:1,name:'Signal',type:'number',count:3,missing:0,unique:3,min:1,max:3,monotonic:true}],sample:[[0,1],[1,2],[2,3]],warnings:[],normalizedPath:path});
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
async function prepareData(args){await mkdir(args.output,{recursive:true});const path=join(args.output,'data.opju'),data=Buffer.from('origin data project');await writeFile(path,data);return {path,fileName:'data.opju',sha256:sha(data),byteLength:data.length};}
async function idle(service,id){while(service.plotJobs.has(id))await service.plotJobs.get(id).job;return service.get(id);}

test('three-step plotting keeps raw bytes, commits only on confirmation, fences retries and preserves the last saved version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-workspace-'));
 const handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 const service=handle.ctx.labPlotRecords,core=handle.ctx.ibmCore;
 let renderFailure=false,collisionDetected=false,renderCalls=0,renderedSpec,renderedReference,progressSeen,releaseProgress;
 try{
  await core.createProject({id:'plot-project',name:'绘图测试'});await core.createProject({id:'other-project',name:'其他课题'});
  service.plotAskModel=async()=>({recommendations:[{kind:'line',reason:'X 是连续有序时间，适合显示随时间的变化',xCol:0,yCols:[1]},{kind:'scatter',reason:'同时检查数值变量之间的关系',xCol:0,yCols:[1]}]});
  handle.ctx.ibmRuntime.plot=async(projectId,action,args,options={})=>{
   if(action==='inspect'){await mkdir(args.output,{recursive:true});const path=join(args.output,'normalized.csv');await writeFile(path,'Time (s),Signal\n0,1\n1,2\n2,3\n');return profile(path);}
   if(action==='prepare')return prepareData(args);
   renderCalls++;renderedSpec=args.spec;renderedReference=args.referenceSpec;if(renderFailure)throw Error('Origin bridge is unavailable');
   await mkdir(args.output,{recursive:true});if(progressSeen){const path=join(args.output,'layout-probe-2.png'),bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(180)]);await writeFile(path,bytes);await options.onProgress({path,fileName:'layout-probe-2.png',byteLength:bytes.length,sha256:sha(bytes),specHash:args.specHash,renderId:args.renderId,tier:'progress',width:1800,height:1200,pixels:'a'.repeat(64)});progressSeen();await new Promise(resolve=>{releaseProgress=resolve;});progressSeen=null;}
   const result={readback:{width:args.spec.widthCm,...(collisionDetected?{collision:{status:'detected'}}:{}),layers:[{layer:0,positions:[{property:'legend.x',target:args.spec.legendX,signedError:.08}]}]}};
   for(const [slot,extension] of [['preview','png'],['pdf','pdf'],['origin','opju']]){
    const path=join(args.output,'figure.'+extension),buffer=Buffer.from('owned '+slot+' '+renderCalls);await writeFile(path,buffer);result[slot]={path,fileName:'figure.'+extension,sha256:sha(buffer),byteLength:buffer.length};
   }return result;
  };
  const raw=Buffer.from('\ufeffTime (s),Signal\r\n0,1\r\n1,2\r\n2,3\r\n');
  const uploaded=await service.plotUpload({projectId:'plot-project',name:'实验.csv',inspectOnly:false,base64:raw.toString('base64')}),id=uploaded.record.id;
  let row=await idle(service,id);assert.equal(row.workflow.status,'recommended');assert.equal(row.workflow.recommendations[0].kind,'line');assert.equal(row.workflow.recommendationSource,'ai');assert.equal(row.workflow.draft,undefined);assert.deepEqual(await readFile(row.workflow.raw.path),raw);assert.equal((await service.plotArtifactFile(id,'plot-project','data-origin')).buffer.toString(),'origin data project');
  assert.equal(renderCalls,0,'AI recommendation waits for user selection before creating either initial plot');
  await assert.rejects(()=>service.plotEntry('other-project',id),/不属于/);
  const spec=plotSpecSchema.parse({kind:'scatter',xCol:0,yCols:[1],xLabel:'Time (s)',yLabel:'Signal'});
  const progressReady=new Promise(resolve=>{progressSeen=resolve;});const first=await service.plotRender({projectId:'plot-project',id,spec,revision:row.workflow.revision});await progressReady;
  const working=(await service.get(id)).workflow;assert.equal(working.workingPreview.tier,'progress');assert.equal((await service.plotArtifactFile(id,'plot-project','working-preview',working.workingPreview.sha256)).mime,'image/png');releaseProgress();
  await assert.rejects(()=>service.plotRender({projectId:'plot-project',id,spec,revision:row.workflow.revision}),/更新|正在/);
  row=await idle(service,id);assert.equal(first.record.workflow.status,'generating');assert.deepEqual(first.record.workflow.spec,renderedSpec,'local initial chart and Origin share the same fully resolved spec');assert.equal(renderedSpec.xAxis.min,0);assert.equal(renderedSpec.xAxis.max,2);assert.equal(renderedSpec.xAxis.step,.4);assert.equal(row.workflow.status,'editing');assert.ok(row.workflow.draft.origin);assert.equal(row.workflow.saved,undefined);
  await assert.rejects(()=>service.plotArtifactFile(id,'plot-project','origin'),/尚未/);
  const updated={...spec,lineWidth:4,xLabel:'Revised time (s)'};
  await service.plotRender({projectId:'plot-project',id,spec:updated,revision:row.workflow.revision,save:true});row=await idle(service,id);
  assert.equal(row.workflow.status,'completed');assert.equal(row.workflow.savedSpec.xLabel,'Revised time (s)');assert.equal(row.artifactPath,row.workflow.saved.origin.path);assert.ok(row.workflow.savedAt);
  const firstSavedPath=row.workflow.saved.origin.path;
  await service.plotRender({projectId:'plot-project',id,spec:{...updated,xLabel:'Second confirmed title'},revision:row.workflow.revision,save:true});row=await idle(service,id);
  assert.equal(row.workflow.history.length,1);assert.equal(row.workflow.history[0].artifacts.origin.path,firstSavedPath);
  let savedPath=row.workflow.saved.origin.path,savedTime=row.workflow.savedAt;
  await service.plotRestore({projectId:'plot-project',id,index:0,revision:row.workflow.revision});row=await idle(service,id);
  assert.equal(row.workflow.spec.xLabel,'Revised time (s)');assert.equal(row.workflow.saved.origin.path,savedPath,'history restoration must stay a draft until confirmed');
  const brokerCalls=[];
  await ScientificDesktopService.prototype.artifactAction.call({ctx:{ibmCore:core,get:name=>name==='labPlotRecords'?service:undefined},requireBroker:()=>({call:async(name,args)=>{brokerCalls.push({name,args});return {opened:true};}})},{action:'open',url:`/api/lab-artifacts?kind=plotting&recordId=${id}&projectId=plot-project&slot=origin`});
  assert.deepEqual(brokerCalls,[{name:'originOpen',args:{path:savedPath}}],'native Origin open must receive the verified original archive path, bypassing the Office staging channel');
  assert.ok((await service.plotArtifactFile(id,'plot-project','origin')).buffer.length>0);
  await service.plotRender({projectId:'plot-project',id,spec:row.workflow.spec,revision:row.workflow.revision,save:false});row=await idle(service,id);
  const beforeConfirm=renderCalls,png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(180)]);await service.plotRender({projectId:'plot-project',id,spec:row.workflow.spec,revision:row.workflow.revision,save:true,localPreviewBase64:png.toString('base64')});row=await idle(service,id);assert.equal(renderCalls,beforeConfirm,'confirmation must promote verified draft files without invoking Origin again');
  const confirmedPath=row.workflow.saved.origin.path;assert.equal(confirmedPath,row.workflow.draft.origin.path);assert.deepEqual((await service.plotArtifactFile(id,'plot-project','local-preview')).buffer,png);savedPath=confirmedPath;savedTime=row.workflow.savedAt;
  service.plotAskRefiner=async()=>({reason:'根据读回位置对齐图例',adjustments:[{object:'legend',dx:-.08,dy:0}]});
  const referenceSpec=row.workflow.savedSpec,preRefinePath=row.workflow.saved.origin.path;await service.plotRefine({projectId:'plot-project',id,revision:row.workflow.revision});row=await idle(service,id);
  assert.equal(row.workflow.status,'editing');assert.deepEqual(row.workflow.savedSpec,referenceSpec,'Agent must not change the local preview');assert.deepEqual(renderedReference,referenceSpec,'native readback must compare against the original local target');assert.equal(row.workflow.saved.origin.path,preRefinePath);assert.notEqual(row.workflow.draft.origin.path,preRefinePath);assert.ok(row.workflow.pendingRefinement.refinement.after<row.workflow.pendingRefinement.refinement.before);
  await assert.rejects(()=>service.plotRender({projectId:'plot-project',id,spec:referenceSpec,revision:row.workflow.revision,save:true}),/明确确认/);
  row=(await service.plotRender({projectId:'plot-project',id,spec:referenceSpec,revision:row.workflow.revision,save:true,confirmRefinement:true})).record;assert.equal(row.workflow.status,'completed');assert.notEqual(row.workflow.saved.origin.path,preRefinePath);assert.ok(row.workflow.history.some(v=>v.artifacts.origin.path===preRefinePath));savedPath=row.workflow.saved.origin.path;savedTime=row.workflow.savedAt;
  service.plotAskRefiner=async()=>({reason:'轴标题',adjustments:[{object:'xTitle',dx:0,dy:.08}]});const retained=row.workflow.saved.origin.path;await service.plotRefine({projectId:'plot-project',id,revision:row.workflow.revision});row=await idle(service,id);assert.equal(row.workflow.status,'failed');assert.equal(row.workflow.saved.origin.path,retained,'unverified refinement must retain the prior Origin project');row=(await service.plotDiscard({projectId:'plot-project',id,revision:row.workflow.revision})).record;
  renderFailure=true;
  await service.plotRender({projectId:'plot-project',id,spec:{...updated,lineWidth:2},revision:row.workflow.revision,save:true});row=await idle(service,id);
  assert.equal(row.workflow.status,'failed');assert.match(row.workflow.error,/bridge/);assert.equal(row.workflow.saved.origin.path,savedPath);assert.equal(row.workflow.savedAt,savedTime);
  assert.deepEqual((await service.plotArtifactFile(id,'plot-project','raw')).buffer,raw);
  const restored=await service.plotDiscard({projectId:'plot-project',id,revision:row.workflow.revision});assert.equal(restored.record.workflow.status,'completed');assert.equal(restored.record.workflow.spec.lineWidth,4);
  row=restored.record;renderFailure=false;collisionDetected=true;await service.plotRender({projectId:'plot-project',id,spec:{...row.workflow.spec,lineWidth:2},revision:row.workflow.revision,save:true});row=await idle(service,id);
  assert.equal(row.workflow.status,'editing');assert.match(row.workflow.error,/重叠/);assert.equal(row.workflow.saved.origin.path,savedPath,'collision must not replace the saved project');
  await assert.rejects(()=>service.plotRender({projectId:'plot-project',id,spec:row.workflow.spec,revision:row.workflow.revision,save:true}),/重叠/);
  const auto=await service.plotAutoLayout({projectId:'plot-project',id,revision:row.workflow.revision,spec:{...row.workflow.spec,legendX:.42}});
  assert.equal(auto.record.workflow.spec.legendX,.42);assert.equal(auto.record.workflow.saved.origin.path,savedPath);
  assert.match(auto.prompt,/ibm-plot-auto-layout/);assert.match(auto.prompt,/250902/);assert.match(auto.prompt,/不平滑/);
  await assert.rejects(()=>service.plotAutoLayout({projectId:'plot-project',id,revision:row.workflow.revision,spec:row.workflow.spec}),/正在更新/);
  await writeFile(savedPath,'externally modified');await assert.rejects(()=>service.plotArtifactFile(id,'plot-project','origin'),/外部修改/);
  assert.equal(plotWorkflowSchema.parse(row.workflow).version,1);
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});

test('invalid AI recommendations fall back visibly to a provisional rule choice and still wait for user selection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-invalid-'));const handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 try{
  await handle.ctx.ibmCore.createProject({id:'p',name:'图'});const service=handle.ctx.labPlotRecords;
  handle.ctx.ibmRuntime.plot=async(_project,action,args)=>{if(action==='render')throw Error('Origin 不可用');if(action==='prepare')return prepareData(args);await mkdir(args.output,{recursive:true});const path=join(args.output,'normalized.csv');await writeFile(path,'x,y\n0,1');return profile(path);};
  service.plotAskModel=async()=>({recommendations:[{kind:'line',reason:'非法列号',xCol:0,yCols:[99]}]});
  const {record}=await service.plotUpload({projectId:'p',name:'test.csv',inspectOnly:false,base64:Buffer.from('x,y\n0,1').toString('base64')});
  const row=await idle(service,record.id);assert.equal(row.workflow.status,'recommended');assert.ok(row.workflow.profile);assert.equal(row.workflow.recommendationSource,'rules');assert.match(row.workflow.recommendationWarning,/AI 推荐不可用/);assert.equal(row.workflow.draft,undefined);
  await assert.rejects(()=>service.plotUpload({projectId:'p',name:'code.py',base64:'YQ=='}),/请选择/);
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});

test('quick previews coalesce queued edits, fence stale results and reuse the exact cached image',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-quick-')),handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 try{
  await handle.ctx.ibmCore.createProject({id:'p',name:'图'});const service=handle.ctx.labPlotRecords;
  service.plotAskModel=async()=>({recommendations:[{kind:'line',reason:'时间序列适合显示变化趋势',xCol:0,yCols:[1]}]});
  let release,started;const firstStarted=new Promise(resolve=>{started=resolve;}),calls=[];
  handle.ctx.ibmRuntime.plot=async(_project,action,args)=>{
   if(action==='inspect'){await mkdir(args.output,{recursive:true});const path=join(args.output,'normalized.csv');await writeFile(path,'x,y\n0,1\n1,2\n2,3');return profile(path);}
   if(action==='prepare')return prepareData(args);
   calls.push(args.spec.lineWidth);if(calls.length===1){started();await new Promise(resolve=>{release=resolve;});}
   await mkdir(args.output,{recursive:true});const path=join(args.output,'quick.png'),bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(180,calls.length)]);await writeFile(path,bytes);
   const svgPath=join(args.output,'figure.svg'),svgBytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>'+args.spec.lineWidth+'</text></svg>');await writeFile(svgPath,svgBytes);
   return {preview:{path,fileName:'quick.png',byteLength:bytes.length,sha256:sha(bytes)},svg:{path:svgPath,fileName:'figure.svg',byteLength:svgBytes.length,sha256:sha(svgBytes)},scene:{layers:[]},pixels:{width:900,height:800,pixels:'a'.repeat(64)},tier:'preview'};
  };
  const {record}=await service.plotUpload({projectId:'p',name:'test.csv',inspectOnly:false,base64:Buffer.from('x,y\n0,1').toString('base64')});let row=await idle(service,record.id);
  const base=validatePlotSelection({kind:'line',xCol:0,yCols:[1]},row.workflow.profile);row=await service.update(row.id,{workflow:{...row.workflow,spec:base}});
  const request=(width,seq)=>service.plotPreview({projectId:'p',id:row.id,spec:{...base,lineWidth:width},clientId:'client-a',requestSeq:seq});
  await request(1,1);await firstStarted;await request(2,2);await request(4,3);release();await service.plotPreviews.get(row.id).job;
  assert.deepEqual(calls,[1,4]);let preview=(await service.list('p'))[0].workflow.quickPreview;assert.equal(preview.tier,'quick');assert.equal((await service.plotArtifactFile(row.id,'p','quick-preview',preview.sha256)).mime,'image/png');
  await assert.rejects(()=>service.plotArtifactFile(row.id,'p','quick-preview','wrong'),/预览已更新/);
  await assert.rejects(()=>service.plotArtifactFile(row.id,'p','quick-scene','wrong'),/预览已更新/);
  assert.match((await service.plotArtifactFile(row.id,'p','quick-scene',preview.sha256)).buffer.toString(),/<text>4<\/text>/);
  const cached=await request(4,4);assert.equal(cached.cached,true);assert.equal(cached.preview.sha256,preview.sha256);assert.notEqual(cached.preview.renderId,preview.renderId);assert.deepEqual(calls,[1,4],'identical preview should use the cache without starting a new render');
  assert.equal((await request(2,3)).stale,true);assert.equal((await service.get(row.id)).workflow.quickPreview,undefined,'quick previews must never alter saved project state');
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});

test('column mapping rejects false numeric roles, invalid logs and duplicate series; prompt carries only summary',()=>{
 const p=profile('private/path.csv'),base={kind:'line',xCol:0,yCols:[1]};
 assert.throws(()=>validatePlotSelection({...base,yCols:[1,1]},p),/不重复/);
 assert.throws(()=>validatePlotSelection({...base,xAxis:{scale:'log10'}},p),/零或负数/);
 assert.throws(()=>validatePlotSelection({...base,widthCm:0},p));
 assert.throws(()=>validatePlotSelection({...base,kind:'histogram',yCols:[0,1]},p),/一个数值列/);
 const text=recommendationPrompt(p,'比较变化趋势');assert.ok(!text.includes('private/path'));assert.match(text,/不推断|不要推断/);
});
