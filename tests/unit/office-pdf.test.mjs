import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import JSZip from 'jszip';
import {officePdf} from '../../lib/tasks/office-pdf.js';
import {readerMethods} from '../../lib/tasks/reader.js';
import {entryAdminMethods} from '../../lib/tasks/entry-admin.js';

async function source(kind,text='first'){
 const zip=new JSZip(),word=kind==='docx';zip.file('[Content_Types].xml',word?'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml':'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');zip.file('_rels/.rels','<Relationships/>');
 zip.file(word?'word/document.xml':'ppt/presentation.xml',word?'<w:document>'+text+'</w:document>':'<p:presentation>'+text+'</p:presentation>');
 if(!word){zip.file('ppt/_rels/presentation.xml.rels','<Relationships/>');zip.file('ppt/slides/slide1.xml','<p:sld/>');}
 return zip.generateAsync({type:'nodebuffer'});
}
async function fixture(kind){
 const directory=await mkdtemp(join(tmpdir(),'ibm-office-pdf-')),path=join(directory,'artifact.'+kind),name=kind==='docx'?'reports':'presentations';await writeFile(path,await source(kind));
 const row={id:'artifact',projectId:'p',bundleId:'entry',reportId:'artifact',[kind==='docx'?'docxPath':'pptxPath']:path},rows=new Map([['artifact',row]]),table={get:id=>rows.get(id),keys:()=>rows.keys(),put:async(id,row)=>rows.set(id,row)};
 let conversions=0;const renderer={convert:async(request,signal)=>{conversions++;assert.equal(request.extension,kind);assert.equal(request.priority,'foreground');signal.throwIfAborted();const data=await request.source.read(signal,50*1024*1024);assert.equal(data.version,request.source.version);return {pdf:Buffer.from('%PDF-1.4\n'+conversions+'\n%%EOF')};}};
 const service={...readerMethods,ctx:{get:name=>name==='officeToPdf'?renderer:null,ibmCore:{requireProject:()=>{},listPresentationsForReport:()=>kind==='pptx'?[rows.get('artifact')]:[]}},table:tableName=>tableName==='bundles'?new Map([['entry',{id:'entry',projectId:'p'}]]):table};
 return {directory,path,name,rows,renderer,service,get count(){return conversions;},dispose:()=>rm(directory,{recursive:true,force:true})};
}
for(const kind of ['docx','pptx'])test(kind+' archives PDF once, survives restart, invalidates changed sources and repairs corrupt PDFs',async()=>{
 const f=await fixture(kind);try{
  const [first,concurrent]=await Promise.all([officePdf(f.service,f.name,'artifact'),officePdf(f.service,f.name,'artifact')]);assert.equal(f.count,1);assert.equal(first.sha256,concurrent.sha256);assert.equal(first.path,f.path.replace(/\.(docx|pptx)$/,'.pdf'));
  const reopened=await officePdf({...f.service,officePdfJobs:undefined},f.name,'artifact');assert.equal(f.count,1);assert.deepEqual(reopened.buffer,await readFile(first.path));
  await writeFile(f.path,await source(kind,'changed'));await officePdf(f.service,f.name,'artifact');assert.equal(f.count,2);
  await writeFile(first.path,'%PDF-1.4\ntampered');await officePdf(f.service,f.name,'artifact');assert.equal(f.count,3);
  const request={projectId:'p',bundleId:'entry',materialId:(kind==='docx'?'report:':'ppt:')+'artifact'};
  const opened=await f.service.readerOpen(request);assert.equal(opened.format,'pdf');assert.equal(f.count,3);assert.equal(opened.fileName,'artifact.pdf');assert.match(Buffer.from(f.service.readerChunk({...request,lease:opened.lease}).base64,'base64').toString(),/^%PDF/);await f.service.readerClose({...request,lease:opened.lease});
  await writeFile(f.path,'invalid Word/PPT');await assert.rejects(()=>f.service.readerOpen(request),/ZIP/);assert.equal(f.count,3);
 }finally{await f.dispose();}
});
test('failed or outdated conversions do not publish a preview and are retryable',async()=>{
 const f=await fixture('docx');try{
  f.renderer.convert=async()=>{throw Error('conversion failed');};await assert.rejects(()=>officePdf(f.service,f.name,'artifact'),/conversion failed/);assert.equal(f.rows.get('artifact').previewPdfPath,undefined);assert.equal(f.service.officePdfJobs.size,0);
  f.renderer.convert=async()=>{await writeFile(f.path,await source('docx','replacement'));return {pdf:Buffer.from('%PDF-1.4\n%%EOF')};};await assert.rejects(()=>officePdf(f.service,f.name,'artifact'),/已更新/);assert.equal(f.rows.get('artifact').previewPdfPath,undefined);
  f.renderer.convert=async()=>({pdf:Buffer.from('%PDF-1.4\n%%EOF')});await officePdf(f.service,f.name,'artifact');assert.ok(f.rows.get('artifact').previewPdfPath);
 }finally{await f.dispose();}
});
for(const kind of ['docx','pptx'])test(kind+' replacement regenerates PDF alongside the new artifact',async()=>{
 const f=await fixture(kind);try{
  const iso=new Date().toISOString(),bundle={id:'entry',projectId:'p',entryDir:f.directory,entryStem:'Fixture'};
  const tables={bundles:new Map([['entry',bundle]]),reports:kind==='docx'?f.rows:new Map([['artifact',{id:'artifact',projectId:'p',bundleId:'entry'}]]),presentations:kind==='pptx'?f.rows:new Map()};
  const row=f.rows.get('artifact');Object.assign(row,{goalSnapshot:{},paperCardRequirements:{},templateSnapshot:{},createdAt:iso,updatedAt:iso});if(kind==='pptx')delete row.bundleId;
  const service={...f.service,...entryAdminMethods,ensureProjectWorkspace:async()=>({path:f.directory}),table:name=>({get:id=>tables[name].get(id),put:async(id,row)=>tables[name].set(id,row)})};
  const replace=buffer=>kind==='docx'?service.resubmitReport({projectId:'p',reportId:'artifact',format:'docx',buffer}):service.resubmitPresentation({projectId:'p',presentationId:'artifact',buffer});
  await replace(await source(kind));assert.equal(f.count,1);
  const result=await replace(await source(kind,'new version')),updated=result.report??result.presentation;
  assert.equal(f.count,2);assert.equal(updated.previewSourceSha256,updated.artifactSha256);assert.match((await readFile(updated.previewPdfPath)).toString(),/^%PDF/);
 }finally{await f.dispose();}
});
