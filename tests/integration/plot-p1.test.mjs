import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {bootLite} from '../helpers/boot-lite.mjs';import {plotSpecSchema} from '../../src/plot/workspace.js';
import {ScientificDesktopService} from '../../lib/scientific-desktop.js';
import {createArtifactDownloadHandler} from '../../lib/artifact-download.js';
import {plotWorkspaceMethods} from '../../lib/plot-workspace.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function idle(service,id){while(service.plotJobs.has(id))await service.plotJobs.get(id).job;return service.get(id);}
test('Origin diagnosis shares probes, caches status and distinguishes busy from disconnected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-origin-status-')),handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 try{
  await handle.ctx.ibmCore.createProject({id:'p',name:'Diagnosis'});const service=handle.ctx.labPlotRecords;let calls=0,offline=false;
  handle.ctx.ibmRuntime.plot=async(_project,action)=>{assert.equal(action,'status');calls++;await new Promise(r=>setTimeout(r,10));if(offline)throw Error('Bridge unavailable');return {bridgeVersion:'0.1.4',originPid:123};};
  const scoped={ctx:new Proxy(service.ctx,{get(target,key){if(key==='ibmRuntime')throw Error('cannot get property "ibmRuntime" without inject');return Reflect.get(target,key);}}),plotJobs:service.plotJobs,plotPreviews:service.plotPreviews};
  assert.equal((await plotWorkspaceMethods.plotConnection.call(scoped,{projectId:'p'})).connected,true,'diagnosis must resolve the optional runtime through Context.get in a restricted service context');calls=0;
  const unavailable=await plotWorkspaceMethods.plotConnection.call({ctx:{ibmCore:handle.ctx.ibmCore,get:()=>undefined},plotJobs:new Map(),plotPreviews:new Map()},{projectId:'p'});assert.equal(unavailable.connected,false);assert.equal(unavailable.error,'科学运行环境尚未就绪');
  const [a,b]=await Promise.all([service.plotConnection({projectId:'p'}),service.plotConnection({projectId:'p',force:true})]);assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(a.connected,true);assert.equal(a.originPid,123);
  await service.plotConnection({projectId:'p'});assert.equal(calls,1);offline=true;const failed=await service.plotConnection({projectId:'p',force:true});assert.equal(failed.connected,false);assert.match(failed.error,/Bridge/);
  service.plotPreviews.set('busy',{job:Promise.resolve()});const busy=await service.plotConnection({projectId:'p',force:true});assert.equal(busy.connected,null);assert.equal(busy.busy,true);service.plotPreviews.clear();
  await assert.rejects(()=>service.plotConnection({projectId:'missing'}));
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});
test('original CSV and Excel downloads preserve exact archived bytes through HTTP and native save',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-download-')),handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 try{
  await handle.ctx.ibmCore.createProject({id:'p',name:'Downloads'});const service=handle.ctx.labPlotRecords;
  handle.ctx.ibmRuntime.plot=async(_project,_action,args)=>{await mkdir(args.output,{recursive:true});const path=join(args.output,'table.csv');await writeFile(path,'');return {sheets:['Empty'],sheet:'Empty',rows:0,columns:[],sample:[],warnings:[],normalizedPath:path};};
  for(const [name,raw] of [['原始 数据.csv',Buffer.from('\ufeff时间,信号\r\n0,-1\r\n')],['原始 数据.xlsx',Buffer.from('PK\u0003\u0004transport fixture: exact archive bytes')]]){
   const {record}=await service.plotUpload({projectId:'p',name,base64:raw.toString('base64')});await idle(service,record.id);
   const url='/api/lab-artifacts?kind=plotting&projectId=p&recordId='+record.id+'&slot=raw',response={writeHead(code,headers){this.code=code;this.headers=headers;},end(bytes){this.bytes=bytes;}};
   await createArtifactDownloadHandler({}, {plotting:()=>service})({method:'GET',url,headers:{}},response);assert.equal(response.code,200);assert.deepEqual(response.bytes,raw);assert.equal(response.headers['x-content-sha256'],sha(raw));assert.equal(decodeURIComponent(response.headers['x-file-name']),name);
   const calls=[];let staged;
   const result=await ScientificDesktopService.prototype.artifactAction.call({ctx:{ibmCore:handle.ctx.ibmCore,get:key=>key==='labPlotRecords'?service:undefined},requireBroker:()=>({call:async(method,input)=>{calls.push(method);if(method==='stage'){staged=Buffer.from(input.base64,'base64');return {fileId:'owned'};}if(method==='save'){assert.equal(input.name,name);return {savedRef:'saved'};}return {};}})},{action:'save',url});
   assert.deepEqual(staged,raw);assert.equal(result.fileName,name);assert.deepEqual(calls,['stage','save','discard']);
  }
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});
test('a pending AI recommendation can be skipped without losing inspected data or waiting for model timeout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-skip-ai-')),handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 try{
  const service=handle.ctx.labPlotRecords;await handle.ctx.ibmCore.createProject({id:'p',name:'Manual'});let started,aborted=false;const ready=new Promise(r=>{started=r;});
  handle.ctx.ibmRuntime.plot=async(_project,action,args)=>{await mkdir(args.output,{recursive:true});const path=join(args.output,action==='prepare'?'data.opju':'table.csv'),bytes=Buffer.from('y\n1\n2\n3');await writeFile(path,bytes);if(action==='prepare')return {path,fileName:'data.opju',sha256:sha(bytes),byteLength:bytes.length};return {sheets:['Data'],sheet:'Data',rows:3,columns:[{index:0,name:'y',type:'number',count:3,missing:0,unique:3,min:1,max:3,monotonic:true}],sample:[[1],[2],[3]],warnings:[],normalizedPath:path,normalizedSha256:sha(bytes)};};
  service.plotAskModel=(_profile,_intent,signal)=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});started();});
  const {record}=await service.plotUpload({projectId:'p',name:'data.csv',inspectOnly:false,base64:Buffer.from('y\n1\n2\n3').toString('base64')});await ready;
  const manual=await service.plotRecommend({projectId:'p',id:record.id,manualOnly:true});assert.equal(manual.record.workflow.status,'recommended');assert.equal(manual.record.workflow.profile.rows,3);assert.equal(manual.record.workflow.error,undefined);assert.equal(aborted,true);assert.equal(service.plotJobs.has(record.id),false);
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});
test('empty workbook preview is recoverable; manual plotting needs no AI; historical originals keep exact files and metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-p1-')),handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
 try{
  const core=handle.ctx.ibmCore,service=handle.ctx.labPlotRecords;await core.createProject({id:'p',name:'P1'});let prepares=0,renders=0,asks=0;
  service.plotAskModel=async()=>{asks++;throw Error('offline');};
  handle.ctx.ibmRuntime.plot=async(_project,action,args)=>{
   await mkdir(args.output,{recursive:true});
   const file=async(name,bytes)=>{const path=join(args.output,name);await writeFile(path,bytes);return {path,fileName:name,byteLength:bytes.length,sha256:sha(bytes)};};
   if(action==='inspect'){
    const populated=args.sheet==='Measurements',data=await file('normalized.csv',Buffer.from(populated?'x,y\n0,11\n1,22\n2,33':'\n'));
    return {sheets:['Empty','Notes','Measurements'],sheet:args.sheet||'Empty',rows:populated?3:0,columns:populated?[{index:0,name:'x',type:'number',count:3,missing:0,unique:3,min:0,max:2,monotonic:true},{index:1,name:'y',type:'number',count:3,missing:0,unique:3,min:11,max:33,monotonic:true}]:[],sample:populated?[[0,11],[1,22],[2,33]]:[],warnings:[],normalizedPath:data.path,normalizedSha256:data.sha256};
   }
   if(action==='prepare'){prepares++;return file('data.opju',Buffer.from('owned data project'));}
   renders++;const pixels={width:900,height:800,pixels:'a'.repeat(64)},result={pixelVerification:{probe:pixels,final:pixels,equal:true},scene:{layers:[]},readback:{passed:true}};
   for(const [slot,ext] of [['preview','png'],['pdf','pdf'],['origin','opju'],['svg','svg']])result[slot]=await file('figure.'+ext,Buffer.from(slot+' '+JSON.stringify(args.spec)));
   return result;
  };
  let {record}=await service.plotUpload({projectId:'p',name:'empty-first.xlsx',base64:Buffer.from('fixture workbook').toString('base64')});
  let row=await idle(service,record.id);const id=row.id;assert.equal(row.workflow.status,'inspected');assert.equal(row.workflow.profile.sheets.length,3);assert.equal(asks,0);assert.equal(prepares,0);
  await service.plotRecommend({projectId:'p',id,sheet:'Measurements',headerRow:1,inspectOnly:true});row=await idle(service,id);assert.equal(row.workflow.profile.rows,3);assert.equal(row.workflow.headerRow,1);assert.equal(asks,0);
  const spec=plotSpecSchema.parse({kind:'line_symbol',xCol:0,yCols:[1],series:[{column:1,color:'#C23D51'}]});
  await service.plotRender({projectId:'p',id,spec,revision:row.workflow.revision,save:true});row=await idle(service,id);assert.equal(row.workflow.status,'completed');assert.equal(asks,0);assert.equal(prepares,1);const original=row.workflow.saved,originalSpec=row.workflow.savedSpec;
  await service.plotRender({projectId:'p',id,spec:{...spec,lineWidth:4},revision:row.workflow.revision,save:true});row=await idle(service,id);
  assert.deepEqual(row.workflow.history[0].artifacts.previewMeta,original.previewMeta);assert.deepEqual(row.workflow.history[0].artifacts.scene,original.scene);
  const latest=row.workflow.saved.origin.path,before=renders;await service.plotRestore({projectId:'p',id,index:0,mode:'original',revision:row.workflow.revision});row=await service.get(id);
  assert.equal(renders,before);assert.equal(row.workflow.saved.origin.path,latest);assert.equal(row.workflow.draft.origin.path,original.origin.path);assert.deepEqual(row.workflow.renderedSpec,originalSpec);
  assert.deepEqual((await service.plotArtifactFile(id,'p','draft-preview')).buffer,await readFile(original.preview.path));
  await service.plotRender({projectId:'p',id,spec:row.workflow.spec,revision:row.workflow.revision,save:true});row=await idle(service,id);assert.equal(renders,before);assert.equal(row.workflow.saved.origin.sha256,original.origin.sha256);assert.deepEqual(row.workflow.savedSpec,originalSpec);
  await service.plotRestore({projectId:'p',id,index:0,mode:'redraw',revision:row.workflow.revision});row=await idle(service,id);assert.equal(renders,before+1);assert.notEqual(row.workflow.draft.origin.path,original.origin.path);assert.equal(row.workflow.saved.origin.sha256,original.origin.sha256);
 }finally{await handle.dispose();await rm(root,{recursive:true,force:true});}
});
