import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {readerMethods} from '../../lib/tasks/reader.js';
import {organizationMethods} from '../../lib/tasks/organization.js';
import {registerReaderTools} from '../../lib/tasks/reader-tools.js';
import {paperSourceBundleSchema} from '../../src/task-models.js';
const iso='2026-10-07T00:00:00.000Z';
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'ibm-reader-'));const rows=new Map();let bytes=Buffer.from('%PDF-1.4\nreader fixture\n%%EOF');
 rows.set('reader',paperSourceBundleSchema.parse({id:'reader',projectId:'p',title:'Reader test',entryDir:dir,status:'succeeded',createdAt:iso,updatedAt:iso}));
 const service={...readerMethods,withFolderLock:organizationMethods.withFolderLock,ctx:{ibmCore:{requireProject:id=>{if(!['p','other'].includes(id))throw Error('missing project');return {id};},bundleFile:async(id,kind)=>({buffer:bytes,fileName:kind+'.pdf'}),activity:{update(){}}},ibmRuntime:{track:work=>work()}},table:()=>({get:id=>rows.get(id),keys:()=>rows.keys(),put:async(id,row)=>rows.set(id,row)}),ensureBundleEntryLayout:async bundle=>bundle};
 const request={projectId:'p',bundleId:'reader',kind:'pdf'};return {dir,service,rows,request,setBytes:value=>{bytes=value;},dispose:()=>rm(dir,{recursive:true,force:true})};
}
test('reader verifies project, bounded chunks, lease owner and revocation',async()=>{const f=await fixture();try{
 const opened=await f.service.readerOpen(f.request);assert.equal(opened.format,'pdf');assert.ok(opened.lease);
 assert.match(Buffer.from(f.service.readerChunk({...f.request,lease:opened.lease}).base64,'base64').toString(),/reader fixture/);
 assert.throws(()=>f.service.readerChunk({...f.request,lease:opened.lease,length:262145}),/范围/);
 assert.throws(()=>f.service.readerChunk({...f.request,projectId:'other',lease:opened.lease}),/不属于/);
 await f.service.readerClose({...f.request,lease:opened.lease});assert.throws(()=>f.service.readerChunk({...f.request,lease:opened.lease}),/过期/);
 await assert.rejects(()=>f.service.readerAsset({group:'cmaps',name:'../../secret'}),/无效/);
}finally{await f.dispose();}});
test('translation requires every source block, protects completed output, supports cancellation and source invalidation',async()=>{const f=await fixture();try{
 const created=await f.service.translationCreate(f.request),id=created.translation.id,request={...f.request,translationId:id};
 assert.equal((await f.service.translationCreate(f.request)).reused,true);
 const row=f.rows.get('reader').translations[0],data={pageCount:2,blocks:[{id:'p1-b1-1',page:1,kind:'text',original:'A complete source paragraph.'},{id:'p2-b1-1',page:2,kind:'text',original:'Another source paragraph.'}],translations:{}};
 await writeFile(join(row.directory,'draft.json'),JSON.stringify(data));await f.service.translationStore(f.rows.get('reader'),{...row,status:'running',totalBlocks:2,completedBlocks:0});
 await assert.rejects(()=>f.service.translationFinish(request),/未翻译/);
 await f.service.translationWrite({...request,blocks:[{id:'p1-b1-1',zh:'完整的来源段落。'}]});assert.equal((await f.service.translationRead({...request,pendingOnly:true})).total,1);
 await assert.rejects(()=>f.service.translationWrite({...request,blocks:[{id:'invented',zh:'伪造的译文'}]}),/编号/);
 await f.service.translationCancel(request);await assert.rejects(()=>f.service.translationWrite({...request,blocks:[{id:'p2-b1-1',zh:'另一段'}]}),/未运行/);
 const resumed=await f.service.translationCreate(f.request);assert.equal(resumed.translation.id,id);
 const queued=f.rows.get('reader').translations[0];await f.service.translationStore(f.rows.get('reader'),{...queued,status:'running'});
 await f.service.translationWrite({...request,blocks:[{id:'p2-b1-1',zh:'另一个来源段落。'}]});
 f.setBytes(Buffer.from('%PDF changed'));await assert.rejects(()=>f.service.translationFinish(request),/更新/);
 f.setBytes(Buffer.from('%PDF-1.4\nreader fixture\n%%EOF'));await f.service.translationFinish({...request,notes:'测试译文'});
 assert.equal((await f.service.translationRead(request)).translation.status,'completed');assert.match(await readFile(join(row.directory,'paper.md'),'utf8'),/完整的来源段落/);
 await writeFile(join(row.directory,'reader.json'),'{}');await assert.rejects(()=>f.service.translationRead(request),/完整性/);
}finally{await f.dispose();}});
test('translation tools use session project resolution and a closed result schema',()=>{const tools=[];registerReaderTools({tools:{register:tool=>tools.push(tool)}});assert.equal(tools.length,6);assert.ok(tools.every(tool=>tool.name.startsWith('lab_reader_translation_')));});
test('translation is bound to its project session and failed Agent turns release queued tasks',async()=>{const f=await fixture();try{
 f.service.ctx.ibmCore.getProjectBySession=id=>id==='valid-session'?{project:{id:'p'}}:{project:{id:'other'}};
 const created=await f.service.translationCreate(f.request),request={...f.request,translationId:created.translation.id};
 await assert.rejects(()=>f.service.translationBind({...request,sessionId:'wrong-session'}),/不属于/);
 await f.service.translationBind({...request,sessionId:'valid-session'});await f.service.readerTurnEnded('valid-session');
 assert.equal(f.rows.get('reader').translations[0].status,'failed');assert.equal((await f.service.translationCreate(f.request)).translation.id,created.translation.id);
}finally{await f.dispose();}});
test('real local PDF extraction retains text, images and scanned page markers',{skip:!process.env.IBM_READER_TEST_PYTHON},async()=>{const f=await fixture();try{
 const python=process.env.IBM_READER_TEST_PYTHON,pdfPath=join(f.dir,'source.pdf');
 execFileSync(python,['-I','-c','import pymupdf,sys; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,72),"Full paper source paragraph."); p.draw_rect(pymupdf.Rect(72,100,250,200),color=(0,0,0)); d.new_page(); d.save(sys.argv[1])',pdfPath],{windowsHide:true});
 f.setBytes(await readFile(pdfPath));f.service.executor={resolvePython:async()=>({command:[python]}),spawnImpl:spawn};
 const created=await f.service.translationCreate(f.request),request={...f.request,translationId:created.translation.id};const prepared=await f.service.translationPrepare(request);
 assert.equal(prepared.translation.pageCount,2);assert.deepEqual(prepared.scannedPages,[2]);const content=await f.service.translationRead(request);assert.ok(content.blocks.some(x=>x.original?.includes('Full paper')));assert.ok(content.blocks.some(x=>x.kind==='scan'&&x.imagePath));assert.ok(content.blocks.some(x=>x.id.startsWith('p1-v')&&x.imagePath));
 const zipPath=join(f.dir,'si.zip');execFileSync(python,['-I','-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"../source.pdf"); z.writestr("data.txt","numbers"); z.close()',zipPath,pdfPath],{windowsHide:true});
 const bundle=f.rows.get('reader');await f.service.table().put(bundle.id,{...bundle,siPath:zipPath});
 const embedded=await f.service.readerZipPdf({...f.request,kind:'si',index:0});assert.ok(Buffer.from(embedded.base64,'base64').subarray(0,4).equals(Buffer.from('%PDF')));assert.equal(embedded.name,'source.pdf');await assert.rejects(()=>f.service.readerZipPdf({...f.request,kind:'si',index:1}),/PDF/);
}finally{await f.dispose();}});
