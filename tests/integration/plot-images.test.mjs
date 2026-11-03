import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {bootLite} from '../helpers/boot-lite.mjs';
import {resolveDesktopArtifact} from '../../src/runtime/desktop-artifacts.js';

const python=process.env.IBM_PLOT_TEST_PYTHON;
test('image upload, full-resolution edits, failed-save recovery, download and restart require no Origin',{skip:!python,timeout:60000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-image-entries-')),options={storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false};let handle;
 try{
  handle=await bootLite(options);await handle.ctx.ibmCore.createProject({id:'p',name:'图片条目'});await handle.ctx.ibmCore.createProject({id:'other',name:'Other'});
  const {stdout}=await promisify(execFile)(python,['-I','-c',"from PIL import Image;import io,json,base64;out={};\nfor fmt in ['PNG','JPEG','TIFF','WEBP']:\n b=io.BytesIO();Image.new('RGB',(80,60),(24,75,125)).save(b,format=fmt);out[fmt]=base64.b64encode(b.getvalue()).decode()\nprint(json.dumps(out))"]);
  const fixtures=JSON.parse(stdout),calls=[];let fail=false;
  const attachRuntime=ctx=>{const runtime=ctx.ibmRuntime,plot=runtime.plot.bind(runtime);runtime.mcpConfig=()=>({command:python,cwd:root});runtime.plot=async(project,action,args,opts={})=>{assert.equal(action,'image');calls.push(action);if(fail)throw Error('Disk write fixture failure');return plot(project,action,args,opts);};};attachRuntime(handle.ctx);
  const service=handle.ctx.labPlotRecords;let id;
  for(const [format,base64] of Object.entries(fixtures)){
   const extension={PNG:'png',JPEG:'jpg',TIFF:'tiff',WEBP:'webp'}[format];const {record}=await service.plotUpload({projectId:'p',name:'原始图片.'+extension,base64});id=record.id;
   assert.equal(record.workflow,undefined);assert.equal(record.image.width,80);assert.equal(record.image.height,60);assert.deepEqual((await service.plotArtifactFile(id,'p','raw')).buffer,Buffer.from(base64,'base64'));
  }
  const before=(await service.get(id)).image;
  const spec={crop:{x:.25,y:0,w:.5,h:1},rotation:90,flipH:true,flipV:false};
  fail=true;await assert.rejects(()=>service.plotImageSave({projectId:'p',id,revision:before.revision,spec}),/Disk write/);assert.deepEqual((await service.get(id)).image,before);fail=false;
  const {record}=await service.plotImageSave({projectId:'p',id,revision:before.revision,spec});assert.equal(record.image.saved.width,60);assert.equal(record.image.saved.height,40);
  await assert.rejects(()=>service.plotImageSave({projectId:'p',id,revision:before.revision,spec}),/已更新/);await assert.rejects(()=>service.plotArtifactFile(id,'other','raw'),/不属于/);
  const file=await resolveDesktopArtifact(handle.ctx.ibmCore,`/api/lab-artifacts?kind=plotting&projectId=p&recordId=${id}&slot=image-export`,{plottingFile:(...args)=>service.plotArtifactFile(...args)});assert.equal(file.mime,'image/png');assert.deepEqual(file.buffer.subarray(0,8),Buffer.from('89504e470d0a1a0a','hex'));
  await promisify(execFile)(python,['-I','-c',"from PIL import Image;import sys;im=Image.open(sys.argv[1]);assert im.size==(60,40);assert im.getpixel((0,0))==Image.open(sys.argv[2]).convert('RGBA').getpixel((0,0))",record.image.saved.image.path,record.image.raw.path]);
  const savedBytes=await readFile(record.image.saved.image.path);await handle.dispose();handle=await bootLite(options);const reopened=await handle.ctx.labPlotRecords.get(id);assert.deepEqual(reopened.image.spec,spec);assert.deepEqual((await handle.ctx.labPlotRecords.plotArtifactFile(id,'p','image-export')).buffer,savedBytes);
  attachRuntime(handle.ctx);await assert.rejects(()=>handle.ctx.labPlotRecords.plotUpload({projectId:'p',name:'fake.png',base64:Buffer.from('fake').toString('base64')}),/image|图片/i);assert.equal((await handle.ctx.labPlotRecords.list('p')).length,4);assert.ok(calls.length>=5);
 }finally{await handle?.dispose();await rm(root,{recursive:true,force:true});}
});
