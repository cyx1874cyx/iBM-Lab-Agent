import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {bootLite} from '../helpers/boot-lite.mjs';
import {sameReadingPaper} from '../../lib/tasks/reading-dedup.js';

const meta={documentKind:'pdf',title:'Tracking fibrinolysis of Chandler loop formed whole blood clots under shear flow',titleZh:'全血凝块纤维蛋白溶解',journal:'Journal of Visualized Experiments',journalAbbrev:'J Vis Exp',year:2024,doi:'10.3791/66524',authors:['N Alves'],correspondingAuthor:'N Alves',summaryZh:'剪切流纤溶监测',volume:'206',pages:'e66524'};
const bytes=tag=>Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%'+tag+'\n%%EOF');
test('without a DOI only an exact long source title, year and author identify a paper',()=>{
 const a={title:meta.title,authors:meta.authors,year:2024};assert.equal(sameReadingPaper(a,{...a,title:a.title.toUpperCase()}),true);
 assert.equal(sameReadingPaper(a,{...a,authors:['Another author']}),false);assert.equal(sameReadingPaper(a,{...a,year:2023}),false);
 assert.equal(sameReadingPaper({...a,doi:'10.3791/one'},{...a,doi:'10.3791/two'}),false);assert.equal(sameReadingPaper(a,{shortCitation:'J Vis Exp 206, e66524 (2024).'}),false);
});
async function settle(tasks){for(let i=0;i<500;i++){if(!tasks.pdfIntakeJobs.size)return;await delay(10);}throw Error('Intake did not settle');}
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'ibm-reading-dedup-'));const handle=await bootLite({storageRoot:join(dir,'storage'),includePython:false,extraRows:[{id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(dir,'projects')}}]});const tasks=handle.ctx.ibmLiteratureWorkflows;handle.ctx.ibmRuntime.convert=async()=>({available:true,text:'# '+meta.title});tasks.identifyReadingPdf=async()=>meta;await handle.ctx.ibmCore.createProject({id:'p',name:'去重验收'});return {dir,handle,tasks,close:async()=>{await handle.dispose();await rm(dir,{recursive:true,force:true});}};}

test('different PDF downloads of the same DOI merge after identification and both original files remain reusable',async()=>{
 const f=await fixture();try{
  const upload=tag=>f.tasks.uploadReadingPdf({projectId:'p',name:tag+'.pdf',base64:bytes(tag).toString('base64')});
  const [a,b]=await Promise.all([upload('publisher'),upload('repository')]);await settle(f.tasks);
  const bundles=f.tasks.listBundles('p'),reports=f.tasks.listReadingReports('p');assert.equal(bundles.length,1);assert.equal(reports.length,1);
  const canonical=bundles[0],alias=f.tasks.table('bundles').get(a.bundle.id===canonical.id?b.bundle.id:a.bundle.id);
  assert.equal(alias.mergedInto,canonical.id);assert.equal(f.tasks.getBundle(alias.id).id,canonical.id);
  assert.deepEqual(await readFile(canonical.pdfPath),bytes(canonical.id===a.bundle.id?'publisher':'repository'));
  assert.deepEqual(await readFile(alias.pdfPath),bytes(alias.id===a.bundle.id?'publisher':'repository'));
  assert.ok(canonical.sourceVersions.some(v=>v.sha256===alias.pdfSha256&&v.path===alias.pdfPath));
  assert.equal((await upload('publisher')).bundle.id,canonical.id);assert.equal((await upload('repository')).bundle.id,canonical.id);assert.equal(f.tasks.listReadingReports('p').length,1);
  assert.deepEqual((await f.tasks.reconcileDuplicateReadingEntries('p')).merged,[]);
  const doc=JSON.parse(await readFile(f.handle.ctx.ibmCore.requireProject('p').projectFilePath,'utf8'));assert.ok(JSON.stringify(doc).includes('mergedInto'));
 }finally{await f.close();}
});

test('legacy duplicates retain report artifacts, folder choice, conversations and translation drafts',async()=>{
 const f=await fixture();try{
  const one=await f.tasks.uploadReadingPdf({projectId:'p',name:'first.pdf',base64:bytes('first').toString('base64')});await settle(f.tasks);
  const original=f.tasks.getBundle(one.bundle.id),report=f.tasks.getReadingReport(one.report.id),time=new Date().toISOString();
  const archived=join(f.dir,'old-fine-reading.md');await writeFile(archived,'# Existing reading report');
  const second={...original,id:'legacy-bundle',createdAt:time,conversationSessionId:'retained-chat',translations:[{id:'translation-retained',kind:'pdf',status:'completed',sourceSha256:original.pdfSha256,directory:join(f.dir,'draft'),stage:'已归档',createdAt:time,updatedAt:time}]};
  await f.tasks.table('bundles').put(second.id,second);
  const folder=await f.tasks.saveReadingFolder({projectId:'p',name:'已选文献'});
  await f.tasks.table('reports').put('legacy-report',{...report,id:'legacy-report',bundleId:second.id,paperCardPath:archived,folderId:folder.id,sessionId:'retained-chat'});
  const archivedInProject=f.tasks.table('reports').get('legacy-report').paperCardPath;
  await f.tasks.reconcileDuplicateReadingEntries('p');
  const [merged]=f.tasks.listBundles('p'),[entry]=f.tasks.listReadingReports('p');
  assert.equal(merged.id,second.id);assert.equal(merged.conversationSessionId,'retained-chat');assert.equal(merged.translations[0].id,'translation-retained');
  assert.equal(entry.id,'legacy-report');assert.equal(entry.folderId,folder.id);assert.equal(entry.paperCardPath,archivedInProject);assert.equal(await readFile(entry.paperCardPath,'utf8'),'# Existing reading report');
  assert.equal(f.tasks.getReadingReport(report.id).id,entry.id);assert.equal(f.tasks.table('reports').get(report.id).bundleId,original.id,'historical raw row remains available');
 }finally{await f.close();}
});

test('metadata registration is idempotent under concurrent calls and does not merge a citation or another project',async()=>{
 const f=await fixture();try{
  const fields={projectId:'p',title:meta.title,doi:'https://doi.org/10.3791/66524'};
  const values=await Promise.all(Array.from({length:6},()=>f.tasks.registerPaperMeta(fields)));assert.equal(new Set(values.map(v=>v.bundle.id)).size,1);assert.equal(f.tasks.listReadingReports('p').length,1);
  await f.tasks.registerPaperMeta({...fields,doi:'10.3791/another',shortCitation:'J Vis Exp 206, e66524 (2024).'});
  await f.handle.ctx.ibmCore.createProject({id:'q',name:'其他课题'});await f.tasks.registerPaperMeta({...fields,projectId:'q'});
  await f.tasks.reconcileDuplicateReadingEntries('p');assert.equal(f.tasks.listBundles('p').length,2);assert.equal(f.tasks.listBundles('q').length,1);
 }finally{await f.close();}
});
