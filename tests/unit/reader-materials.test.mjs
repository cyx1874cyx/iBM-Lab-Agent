import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readerMethods} from '../../lib/tasks/reader.js';

test('comparison materials belong to one entry and advertise archived PDF previews',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ibm-materials-'));
 try{
  const paths={};for(const name of ['source.pdf','si.pdf','notes.docx','slides.pptx']){paths[name]=join(directory,name);await writeFile(paths[name],'fixture');}
  const bundle={id:'entry',projectId:'p',pdfPath:paths['source.pdf'],siPath:paths['si.pdf'],pdfSha256:'current',translations:[{id:'old',kind:'pdf',status:'completed',sourceSha256:'stale'},{id:'zh',kind:'pdf',status:'completed',sourceSha256:'current'},{id:'pending',kind:'si',status:'running'}]};
  const reports=new Map([['notes',{id:'notes',bundleId:'entry',projectId:'p',docxPath:paths['notes.docx']}],['other',{id:'other',bundleId:'elsewhere',projectId:'p',docxPath:paths['notes.docx']}]]);
  const validated=[];const core={requireProject:()=>{},listPresentationsForReport:id=>id==='notes'?[{id:'slides',reportId:'notes',projectId:'p',pptxPath:paths['slides.pptx']}]:[],readingReportFile:async id=>{validated.push('word:'+id);},presentationFile:async id=>{validated.push('ppt:'+id);}};
  const service={...readerMethods,ctx:{ibmCore:core},table:name=>name==='bundles'?new Map([['entry',bundle]]):reports};
  const request={projectId:'p',bundleId:'entry'};
  const result=await service.readerMaterials(request);
  assert.deepEqual(result.materials.map(row=>row.id),['pdf','translation:zh','si','report:notes','ppt:slides']);
  assert.ok(result.materials.every(row=>!row.path&&row.format==='pdf'));
  assert.equal((await service.readerMaterials({...request,select:'report:notes'})).material.path,paths['notes.docx']);
  assert.equal((await service.readerMaterials({...request,select:'ppt:slides'})).material.artifactId,'slides');assert.deepEqual(validated,[]);
  await assert.rejects(()=>service.readerMaterials({...request,select:'report:other',path:paths['notes.docx']}),/不属于/);
  await assert.rejects(()=>service.readerMaterials({...request,projectId:'other'}),/不属于/);
  await assert.rejects(()=>service.readerOpen({...request,materialId:'report:other'}),/不属于/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
