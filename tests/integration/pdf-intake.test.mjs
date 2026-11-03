import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bootLite } from '../helpers/boot-lite.mjs';
import JSZip from 'jszip';
import { pdfMetadataPrompt } from '../../lib/tasks/pdf-intake.js';

const text = '# Controlled polymer delivery\nJournal of Controlled Release 300, 10-20 (2024)\nA Li, B Wang\nCorrespondence: B Wang\nDOI: 10.1016/example\nAbstract: We investigate controlled drug delivery with polymer carriers.';
const metadata = { documentKind: 'pdf', title: 'Controlled polymer delivery', titleZh: '聚合物可控递送', journal: 'Journal of Controlled Release', journalAbbrev: 'J Control Release', year: 2024, doi: '10.1016/example', authors: ['A Li', 'B Wang'], correspondingAuthor: 'B Wang', summaryZh: '聚合物 可控递送', volume: '300', pages: '10–20' };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF');
async function waitFor(predicate) { for (let n = 0; n < 250; n++) { if (predicate()) return; await delay(10); } throw Error('PDF task did not settle'); }

test('PDF upload creates a visible queue entry, processes independently, renames files and keeps citation/title display separate', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-pdf-')); let handle;
 try {
  handle = await bootLite({ storageRoot: join(dir, 'storage'), includePython: false, extraRows: [
   { id: 'goals', name: 'dsh-lab-agent/goal-profiles' }, { id: 'notes', name: 'dsh-lab-agent/note-templates' }, { id: 'templates', name: 'dsh-lab-agent/ppt-templates' }, { id: 'tasks', name: 'dsh-lab-agent/tasks', config: { projectsRoot: join(dir, 'projects') } }
  ] });
  const { ctx } = handle, tasks = ctx.ibmLiteratureWorkflows;
  await ctx.ibmCore.createProject({ id: 'pdf-project', name: 'PDF 导入验收' });
  await ctx.ibmCore.createProject({ id: 'other-project', name: '隔离课题' });
  const folder = await tasks.saveReadingFolder({ projectId: 'pdf-project', name: '药物递送' });
  let release, conversions = 0, agentPrompt;
  ctx.ibmRuntime.convert = async () => { conversions++; await new Promise(resolve => { release = resolve; }); return { available: true, text }; };
  // Only the Python/remote model boundaries are fixtures; project persistence,
  // queue state, agent lifecycle handling and file moves all use production code.
  let disposed = 0, forbiddenTools, presentation;
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture-provider', model: 'fixture-model' }) });
  ctx.provide('agents', { create: async options => {
   assert.equal(options.agentOptions.provider, 'fixture-provider'); assert.equal(options.agentOptions.model, 'fixture-model');
   const scope = { tools: { restrict: filter => { forbiddenTools = filter; }, presentAs: value => { presentation = value; } }, systemPrompt: { section() {}, getSectionOrder() { return 0; } } };
   options.setup(scope);
   return { dispose: async () => { disposed++; }, agent: { followup: message => { agentPrompt = message.content[0].text; }, whenIdle: async () => {}, session: { snapshotEvents: () => [
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(metadata) }] } } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } }
   ] } } };
  } });
  const input = { projectId: 'pdf-project', name: '用户原始名字.pdf', base64: pdf.toString('base64'), folderId: folder.id };
  const first = await tasks.uploadReadingPdf(input);
  assert.equal(first.report.folderId, folder.id); assert.equal(first.report.docxPath, undefined);
  await waitFor(() => release);
  assert.equal(tasks.getBundle(first.bundle.id).pdfIntake.status, 'running');
  await assert.rejects(tasks.deleteReadingReport(first.report.id, input.projectId), /正在后台识别/);
  const duplicate = await tasks.uploadReadingPdf(input); assert.equal(duplicate.reused, true); assert.equal(duplicate.bundle.id, first.bundle.id); assert.equal(conversions, 1);
  await assert.rejects(tasks.retryReadingPdf({ projectId: 'other-project', bundleId: first.bundle.id }), /不属于/);
  release(); await waitFor(() => !tasks.pdfIntakeJobs.has(first.bundle.id));
  const bundle = tasks.getBundle(first.bundle.id), report = tasks.getReadingReport(first.report.id);
  assert.equal(bundle.pdfIntake.status, 'completed', bundle.pdfIntake.error);
  assert.equal(report.shortCitation, 'J Control Release 300, 10–20 (2024).');
  assert.equal(report.titleZh, '聚合物可控递送'); assert.equal(report.docxPath, undefined, 'metadata extraction must not fabricate a completed fine-reading report');
  assert.match(bundle.entryStem, /^J Control Release 2024 B Wang 聚合物 可控递送 Controlled polymer delivery$/);
  assert.notEqual(report.shortCitation, bundle.entryStem);
  assert.equal(basename(bundle.pdfPath), bundle.entryStem + '.pdf'); assert.deepEqual(await readFile(bundle.pdfPath), pdf);
  assert.equal(await readFile(bundle.paperMdPath, 'utf8'), text); assert.equal(existsSync(first.bundle.entryDir), false);
  assert.match(agentPrompt, /MarkItDown/); assert.ok(agentPrompt.includes(text)); assert.deepEqual(forbiddenTools, { allow: [] }); assert.equal(presentation, 'native'); assert.equal(disposed, 1);
  const project = ctx.ibmCore.requireProject(input.projectId), document = JSON.parse(await readFile(project.projectFilePath, 'utf8'));
  assert.match(JSON.stringify(document), /pdfIntake/); assert.ok(!JSON.stringify(document).includes(bundle.pdfPath), 'project stores portable paths');
  await assert.rejects(tasks.uploadReadingPdf({ ...input, name: 'bad.pdf', base64: Buffer.from('not a PDF').toString('base64') }), /PDF/);
  assert.equal(tasks.listReadingReports(input.projectId).length, 1);
  // Failed conversion keeps the source and permits a real retry of the same row.
  ctx.ibmRuntime.convert = async () => ({ available: false, error: '转换器不可用' });
  const failed = await tasks.uploadReadingPdf({ ...input, name: 'failure.pdf', base64: Buffer.concat([pdf.subarray(0, -5), Buffer.from('%different\n%%EOF')]).toString('base64') });
  await waitFor(() => !tasks.pdfIntakeJobs.has(failed.bundle.id));
  assert.equal(tasks.getBundle(failed.bundle.id).pdfIntake.status, 'failed'); assert.ok(existsSync(tasks.getBundle(failed.bundle.id).pdfPath));
  ctx.ibmRuntime.convert = async () => ({ available: true, text });
  const recoveryMetadata = { ...metadata, doi:'10.1016/another-example', title: 'Another controlled polymer delivery', titleZh: '另一种聚合物递送', summaryZh: '另一种递送' };
  // Preserve the fake agent API but change only its model response.
  const agents = ctx.get('agents'), create = agents.create;
  agents.create = async options => { const created = await create(options); created.agent.session.snapshotEvents = () => [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(recoveryMetadata) }] } } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } }]; return created; };
  await tasks.retryReadingPdf({ projectId: input.projectId, bundleId: failed.bundle.id }); await waitFor(() => !tasks.pdfIntakeJobs.has(failed.bundle.id));
  assert.equal(tasks.getBundle(failed.bundle.id).pdfIntake.status, 'completed', tasks.getBundle(failed.bundle.id).pdfIntake.error);
  assert.equal(tasks.getBundle(failed.bundle.id).pdfIntake.attempt, 2); assert.equal(tasks.listReadingReports(input.projectId).length, 2);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('SI classification links either upload order, keeps original paper bytes and repairs legacy misclassified uploads', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-si-')); let handle;
 try {
  handle = await bootLite({ storageRoot: join(dir, 'storage'), includePython: false, extraRows: [
   { id: 'goals', name: 'dsh-lab-agent/goal-profiles' }, { id: 'notes', name: 'dsh-lab-agent/note-templates' }, { id: 'templates', name: 'dsh-lab-agent/ppt-templates' }, { id: 'tasks', name: 'dsh-lab-agent/tasks', config: { projectsRoot: join(dir, 'projects') } }
  ] });
  const { ctx } = handle, tasks = ctx.ibmLiteratureWorkflows;
  for (const id of ['main-first','si-first','legacy-si']) await ctx.ibmCore.createProject({ id, name: id });
  let response = { ...metadata, documentKind: 'pdf' };
  ctx.ibmRuntime.convert = async () => ({ available: true, text });
  tasks.identifyReadingPdf = async () => response;
  const bytes = tag => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%' + tag + '\n%%EOF');
  const upload = async (projectId, tag, name = tag + '.pdf') => {
   const result = await tasks.uploadReadingPdf({ projectId, name, base64: bytes(tag).toString('base64') });
   await waitFor(() => !tasks.pdfIntakeJobs.has(result.bundle.id)); return result;
  };
  const main = await upload('main-first','main','misleading SI.pdf'), original = tasks.getBundle(main.bundle.id);
  assert.equal(original.pdfIntake.kind,'pdf','filename must not override the content classification');
  assert.ok(original.pdfPath);assert.equal(original.siPath,undefined);
  response = { ...metadata, documentKind: 'si' };
  const si = await upload('main-first','si','opaque-download.pdf');
  assert.equal(tasks.getBundle(si.bundle.id), undefined, 'SI temporary row merges into the parent paper');
  const parent = tasks.getBundle(main.bundle.id);
  assert.equal(tasks.listReadingReports('main-first').length, 1); assert.equal(parent.pdfPath, original.pdfPath);
  assert.deepEqual(await readFile(parent.pdfPath), bytes('main')); assert.deepEqual(await readFile(parent.siPath), bytes('si'));
  assert.match(parent.siPath,/ SI\.pdf$/); assert.equal(await readFile(parent.siMdPath,'utf8'),text);
  assert.ok((await tasks.readingReportInputs({projectId:'main-first',bundleId:parent.id})).resources.some(row=>row.kind==='si-markdown'&&row.available));
  assert.equal((await tasks.uploadReadingPdf({projectId:'main-first',name:'SI.pdf',base64:bytes('si').toString('base64')})).reused,true);
  await upload('main-first','updated-si','ordinary-document.pdf');
  assert.deepEqual(await readFile(tasks.getBundle(parent.id).siPath),bytes('updated-si'),'new SI versions route through the same PDF intake');
  assert.equal(tasks.listReadingReports('main-first').length,1);
  await assert.rejects(tasks.uploadReadingSi({projectId:'si-first',bundleId:parent.id,name:'SI.pdf',base64:bytes('si').toString('base64')}),/不属于/);
  await assert.rejects(tasks.uploadReadingSi({projectId:'main-first',bundleId:parent.id,name:'SI.pdf',base64:bytes('replacement').toString('base64')}),/已有 SI/);
  await tasks.uploadReadingSi({projectId:'main-first',bundleId:parent.id,name:'opaque.pdf',replace:true,base64:bytes('replacement').toString('base64')});
  const replaced = tasks.getBundle(parent.id);assert.deepEqual(await readFile(replaced.pdfPath),bytes('main'));assert.deepEqual(await readFile(replaced.siPath),bytes('replacement'));assert.equal(replaced.siMdPath,undefined);
  const history='SI-history-'+parent.siSha256+'.pdf';assert.ok((await readdir(parent.entryDir)).includes(history));assert.deepEqual(await readFile(join(parent.entryDir,history)),bytes('si'));
  const firstSi=await upload('si-first','first-si','supporting_information.pdf');
  const siOnly=tasks.getBundle(firstSi.bundle.id);assert.equal(siOnly.pdfPath,undefined);assert.ok(siOnly.siPath);assert.equal(siOnly.acquisitionStatus,'awaiting-pdf');
  response={...metadata,documentKind:'pdf'};
  await upload('si-first','second-main');
  const merged=tasks.getBundle(firstSi.bundle.id);assert.ok(merged.pdfPath);assert.equal(merged.pdfIntake.kind,'pdf');assert.deepEqual(await readFile(merged.siPath),bytes('first-si'));assert.deepEqual(await readFile(merged.pdfPath),bytes('second-main'));assert.equal(tasks.listReadingReports('si-first').length,1);
  const legacy=await upload('legacy-si','legacy');
  await ctx.ibmCore.commitSourceBundle({...tasks.getBundle(legacy.bundle.id),pdfIntake:{...tasks.getBundle(legacy.bundle.id).pdfIntake,kind:undefined,originalFileName:'previous-upload SI.pdf'}});
  response={...metadata,documentKind:'si'};await tasks.pdfIntakeResume();await waitFor(()=>!tasks.pdfIntakeJobs.has(legacy.bundle.id));
  const repaired=tasks.getBundle(legacy.bundle.id);assert.equal(repaired.pdfPath,undefined);assert.equal(repaired.pdfIntake.kind,'si');assert.deepEqual(await readFile(repaired.siPath),bytes('legacy'));assert.equal(tasks.getReadingReport(legacy.report.id).bundleId,repaired.id);
 } finally { await handle?.dispose();await rm(dir,{recursive:true,force:true}); }
});

test('SI without parent titles keeps its bytes, matches only supported identities and recovers validation failures', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-sparse-si-')); let handle;
 try {
  handle = await bootLite({ storageRoot: join(dir, 'storage'), includePython: false, extraRows: [
   { id: 'goals', name: 'dsh-lab-agent/goal-profiles' }, { id: 'notes', name: 'dsh-lab-agent/note-templates' }, { id: 'templates', name: 'dsh-lab-agent/ppt-templates' }, { id: 'tasks', name: 'dsh-lab-agent/tasks', config: { projectsRoot: join(dir, 'projects') } }
  ] });
  const { ctx } = handle, tasks = ctx.ibmLiteratureWorkflows;
  for (const id of ['sparse-first','sparse-last']) await ctx.ibmCore.createProject({ id, name: id });
  ctx.ibmRuntime.convert = async () => ({ available: true, text });
  let response = { ...metadata, documentKind: 'si', title: '', titleZh: '', summaryZh: '' };
  tasks.identifyReadingPdf = async () => response;
  const bytes = tag => Buffer.from('%PDF-1.4\n%' + tag + '\n%%EOF');
  const upload = async (projectId, tag, name = tag + '.pdf') => {
   const result = await tasks.uploadReadingPdf({ projectId, name, base64: bytes(tag).toString('base64') });
   await waitFor(() => !tasks.pdfIntakeJobs.has(result.bundle.id)); return result;
  };
  const first = await upload('sparse-first','sparse-si');
  const retained = tasks.getBundle(first.bundle.id);
  assert.equal(retained.pdfIntake.status,'completed',retained.pdfIntake.error);
  assert.equal(retained.title,''); assert.equal(retained.pdfPath,undefined);
  assert.deepEqual(await readFile(retained.siPath),bytes('sparse-si'));
  assert.equal(tasks.getReadingReport(first.report.id).titleZh,undefined);
  response = metadata; await upload('sparse-first','main');
  const merged = tasks.getBundle(first.bundle.id);
  assert.equal(tasks.listReadingReports('sparse-first').length,1);
  assert.equal(merged.title,metadata.title);assert.deepEqual(await readFile(merged.siPath),bytes('sparse-si'));
  assert.match(basename(merged.siPath),/ SI\.pdf$/);
  const main = await upload('sparse-last','main-last');
  response = { ...metadata, documentKind: 'si', title: null, titleZh: null, summaryZh: null };
  const linked = await upload('sparse-last','doi-only');
  assert.equal(tasks.getBundle(linked.bundle.id),undefined);
  assert.deepEqual(await readFile(tasks.getBundle(main.bundle.id).siPath),bytes('doi-only'));
  // Matching the uploaded filename to a known title is not bibliographic evidence.
  response = { documentKind: 'si', authors: [] };
  const anonymous = await upload('sparse-last','anonymous',metadata.title+'.pdf');
  const unknown = tasks.getBundle(anonymous.bundle.id);
  assert.equal(unknown.pdfIntake.status,'completed',unknown.pdfIntake.error);
  assert.equal(unknown.title,'');assert.equal(tasks.listReadingReports('sparse-last').length,2);
  assert.deepEqual(await readFile(unknown.siPath),bytes('anonymous'));
  await tasks.reconcileReadingSi();assert.ok(tasks.getBundle(unknown.id),'anonymous SI must not link to an arbitrary parent');
  response = { documentKind: 'pdf', title: '', titleZh: '' };
  const invalid = await upload('sparse-last','validation-failure');
  const failure = tasks.getBundle(invalid.bundle.id);
  assert.equal(failure.pdfIntake.status,'failed');assert.match(failure.pdfIntake.error,/请重新识别/);
  assert.doesNotMatch(failure.pdfIntake.error,/too_small|"path"|"code"/);
  response = { documentKind: 'si', title: '', titleZh: '' };
  await tasks.retryReadingPdf({projectId:'sparse-last',bundleId:failure.id});await waitFor(()=>!tasks.pdfIntakeJobs.has(failure.id));
  const recovered=tasks.getBundle(failure.id);assert.equal(recovered.pdfIntake.status,'completed',recovered.pdfIntake.error);
  assert.equal(recovered.pdfIntake.error,undefined);assert.deepEqual(await readFile(recovered.siPath),bytes('validation-failure'));
 } finally { await handle?.dispose();await rm(dir,{recursive:true,force:true}); }
});

test('DOCX SI uses unified intake, native bytes, deduplication and association in both upload orders', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-docx-si-')); let handle;
 try {
  handle = await bootLite({ storageRoot: join(dir, 'storage'), includePython: false, extraRows: [
   { id: 'goals', name: 'dsh-lab-agent/goal-profiles' }, { id: 'notes', name: 'dsh-lab-agent/note-templates' }, { id: 'templates', name: 'dsh-lab-agent/ppt-templates' }, { id: 'tasks', name: 'dsh-lab-agent/tasks', config: { projectsRoot: join(dir, 'projects') } }
  ] });
  const { ctx } = handle, tasks = ctx.ibmLiteratureWorkflows;
  for (const id of ['docx-first','docx-last']) await ctx.ibmCore.createProject({ id, name: id });
  const docx = async tag => {
   const zip = new JSZip();
   zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
   zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
   zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Supporting Information '+tag+'</w:t></w:r></w:p></w:body></w:document>');
   return zip.generateAsync({type:'nodebuffer'});
  };
  const office = await docx('first'), replacement = await docx('replacement');
  let response = { ...metadata, documentKind:'si' }, conversionError = false;
  const convertedPaths=[];
  ctx.ibmRuntime.convert = async path => { convertedPaths.push(path); return conversionError ? {available:false,error:'转换器暂不可用'} : {available:true,text}; };
  tasks.identifyReadingPdf = async () => response;
  const upload = async (projectId, name, bytes) => {
   const result = await tasks.uploadReadingPdf({projectId,name,base64:bytes.toString('base64')});
   await waitFor(()=>!tasks.pdfIntakeJobs.has(result.bundle.id));return result;
  };
  conversionError = true;
  const first = await upload('docx-first','ordinary-document.DOCX',office);
  assert.equal(tasks.getBundle(first.bundle.id).pdfIntake.status,'failed');
  assert.match(convertedPaths.at(-1),/\.docx$/);assert.deepEqual(await readFile(tasks.getBundle(first.bundle.id).siPath),office);
  conversionError = false;
  await tasks.retryReadingPdf({projectId:'docx-first',bundleId:first.bundle.id});await waitFor(()=>!tasks.pdfIntakeJobs.has(first.bundle.id));
  const onlySi=tasks.getBundle(first.bundle.id);
  assert.equal(onlySi.pdfIntake.status,'completed',onlySi.pdfIntake.error);assert.equal(onlySi.pdfIntake.kind,'si');
  assert.equal(onlySi.pdfPath,undefined);assert.match(onlySi.siPath,/ SI\.docx$/);assert.deepEqual(await readFile(onlySi.siPath),office);
  assert.equal((await ctx.ibmCore.bundleFile(onlySi.id,'si')).mime,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal((await tasks.uploadReadingPdf({projectId:'docx-first',name:'same.docx',base64:office.toString('base64')})).bundle.id,first.bundle.id);
  response=metadata;await upload('docx-first','main.pdf',pdf);
  const merged=tasks.getBundle(first.bundle.id);assert.deepEqual(await readFile(merged.pdfPath),pdf);assert.deepEqual(await readFile(merged.siPath),office);
  assert.match(merged.siPath,/ SI\.docx$/);assert.equal(tasks.listReadingReports('docx-first').length,1);
  const main=await upload('docx-last','main.pdf',pdf);response={...metadata,documentKind:'si'};
  const attachment=await upload('docx-last','attachment.docx',office);
  assert.equal(tasks.getBundle(attachment.bundle.id),undefined);assert.equal(tasks.listReadingReports('docx-last').length,1);
  const parent=tasks.getBundle(main.bundle.id);assert.match(parent.siPath,/\.docx$/);assert.deepEqual(await readFile(parent.siPath),office);
  // A different SI format keeps the old version with its original extension.
  const siPdf=Buffer.from('%PDF-1.4\n%SI replacement\n%%EOF');await upload('docx-last','attachment.pdf',siPdf);
  assert.deepEqual(await readFile(join(parent.entryDir,'SI-history-'+parent.siSha256+'.docx')),office);
  const pdfSi=tasks.getBundle(parent.id);assert.match(pdfSi.siPath,/\.pdf$/);assert.deepEqual(await readFile(pdfSi.siPath),siPdf);
  await upload('docx-last','updated.docx',replacement);
  const latest=tasks.getBundle(parent.id);assert.match(latest.siPath,/\.docx$/);assert.deepEqual(await readFile(latest.siPath),replacement);
  assert.deepEqual(await readFile(join(parent.entryDir,'SI-history-'+pdfSi.siSha256+'.pdf')),siPdf);
  assert.deepEqual(await readFile(latest.pdfPath),pdf);assert.equal(tasks.listReadingReports('docx-last').length,1);
  const inputs=await tasks.readingReportInputs({projectId:'docx-last',bundleId:latest.id});assert.ok(inputs.resources.some(row=>row.kind==='si-markdown'&&row.available));
  const document=await readFile(ctx.ibmCore.requireProject('docx-last').projectFilePath,'utf8');assert.ok(!document.includes(latest.siPath),'DOCX paths remain portable');
  await assert.rejects(tasks.uploadReadingPdf({projectId:'docx-last',name:'fake.docx',base64:pdf.toString('base64')}),/DOCX 文件损坏/);
  await assert.rejects(tasks.uploadReadingPdf({projectId:'docx-last',name:'fake.doc',base64:office.toString('base64')}),/PDF 或 DOCX/);
 } finally { await handle?.dispose();await rm(dir,{recursive:true,force:true}); }
});

test('content-grounded SI matching handles missing identifiers and rechecks when its main paper arrives', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-content-si-'));let handle;
 try {
  handle = await bootLite({storageRoot:join(dir,'storage'),includePython:false,extraRows:[
   {id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(dir,'projects')}}
  ]});
  const {ctx}=handle,tasks=ctx.ibmLiteratureWorkflows;
  for(const id of ['content-first','content-last'])await ctx.ibmCore.createProject({id,name:id});
  const paperA='Bland Altman analysis found a mean bias of 1.1% between histopathology and impedance measurements.';
  const paperB='The limits of agreement ranged from -42.4% to 44.5% (Supplementary Figure S2).';
  const siA='Supplementary Figure 2. Bland Altman plot with a bias of 1.1% between the two measurements.';
  const siB='The 95% confidence interval limits of agreement ranged from -42.4 to 44.5%.';
  let siCalls=0;
  ctx.ibmRuntime.convert=async path=>({available:true,text:(await readFile(path)).toString()});
  tasks.identifyReadingPdf=async(bundle,markdown,candidates)=>{
   if(!markdown.includes('SUPPLEMENT'))return metadata;
   siCalls++;
   const parent=candidates.find(row=>row.text.includes(paperA));
   if(parent){const prompt=pdfMetadataPrompt(markdown,candidates);assert.ok(prompt.includes(paperB));assert.ok(!prompt.includes('misleading-filename'));}
   return {documentKind:'si',parentMatch:parent?{bundleId:parent.id,evidence:[{siQuote:siA,paperQuote:paperA},{siQuote:siB,paperQuote:paperB}]}:undefined};
  };
  const upload=async(projectId,tag,body)=>{
   const result=await tasks.uploadReadingPdf({projectId,name:'misleading-filename-'+tag+'.pdf',base64:Buffer.from('%PDF-1.4\n'+body+'\n%%EOF').toString('base64')});
   await waitFor(()=>tasks.pdfIntakeJobs.size===0);return result;
  };
  const siFirst=await upload('content-first','si','SUPPLEMENT\n'+siA+'\n'+siB);
  assert.equal(tasks.getBundle(siFirst.bundle.id).title,'');assert.ok(tasks.getBundle(siFirst.bundle.id).siPath);
  await upload('content-first','main',paperA+'\n'+paperB);
  const firstRows=tasks.listBundles('content-first');assert.equal(firstRows.length,1);
  assert.ok(firstRows[0].pdfPath);assert.ok(firstRows[0].siPath);assert.equal(firstRows[0].title,metadata.title);
  const calls=siCalls;await tasks.reconcileReadingSi();await waitFor(()=>tasks.pdfIntakeJobs.size===0);assert.equal(siCalls,calls,'unchanged catalog must not trigger repeated model sessions');
  const main=await upload('content-last','main',paperA+'\n'+paperB);
  const si=await upload('content-last','si','SUPPLEMENT\n'+siA+'\n'+siB);
  assert.equal(tasks.getBundle(si.bundle.id),undefined);assert.equal(tasks.listBundles('content-last').length,1);
  assert.ok(tasks.getBundle(main.bundle.id).siPath);assert.equal(tasks.listReadingReports('content-last').length,1);
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('missing publication source never stores pages and year as the literature display title',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-citation-'));let handle;
 try{
  handle=await bootLite({storageRoot:join(dir,'storage'),includePython:false,extraRows:[
   {id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(dir,'projects')}}
  ]});
  const {ctx}=handle,tasks=ctx.ibmLiteratureWorkflows;
  await ctx.ibmCore.createProject({id:'unknown-source',name:'缺失来源验收'});
  ctx.ibmRuntime.convert=async()=>({available:true,text});
  tasks.identifyReadingPdf=async()=>({...metadata,doi:'',journal:'',journalAbbrev:'',volume:'',pages:'3723-3726',year:2020});
  tasks.executor.search=async()=>[];
  const result=await tasks.uploadReadingPdf({projectId:'unknown-source',name:'unknown.pdf',base64:pdf.toString('base64')});
  await waitFor(()=>tasks.pdfIntakeJobs.size===0);
  assert.equal(tasks.getReadingReport(result.report.id).shortCitation,metadata.title);
  assert.equal((await tasks.readingReportOverview(result.report.id)).shortCitation,metadata.title);
  let query;
  tasks.executor.search=async(title,options)=>{query={title,options};return [{title:metadata.title,doi:'10.1109/example',journal:'2020 International Conference of the IEEE Society (EMBC)',year:2020,pages:'3723-3726',authors:metadata.authors,sources:['crossref']}];};
  await tasks.retryReadingPdf({projectId:'unknown-source',bundleId:result.bundle.id});await waitFor(()=>tasks.pdfIntakeJobs.size===0);
  const repaired=tasks.getBundle(result.bundle.id);
  assert.equal(query.title,metadata.title);assert.equal(query.options.oaOnly,false);
  assert.equal(repaired.doi,'10.1109/example');assert.equal(repaired.naming.journalAbbrev,'IEEE EMBC');
  assert.equal(tasks.getReadingReport(result.report.id).shortCitation,'IEEE EMBC 3723–3726 (2020).');
  assert.deepEqual(await readFile(repaired.pdfPath),pdf);
  const incomplete={...metadata,documentKind:'pdf',doi:'',journal:'',journalAbbrev:'',pages:'3723-3726',year:2020};
  const candidate={title:metadata.title,doi:'10.1109/example',journal:'IEEE EMBC',pages:'3723-3726',year:2020,authors:metadata.authors};
  let knownSourceLookups=0;
  tasks.executor.search=async()=>{knownSourceLookups++;return [candidate];};
  assert.equal(await tasks.completeReadingPublicationMetadata(repaired,metadata),metadata,'a source extracted from the file should be registered directly');
  assert.equal(knownSourceLookups,0,'known publication sources must not trigger an online lookup');
  const siSource=await tasks.completeReadingPublicationMetadata(repaired,{...incomplete,documentKind:'si',title:'',titleZh:'',doi:candidate.doi,authors:[]});
  assert.equal(siSource.journal,candidate.journal);assert.equal(siSource.title,candidate.title,'an explicit SI DOI can identify its parent publication without inventing a title');
  for(const records of [[{...candidate,title:'A different article'}],[{...candidate,year:2019}],[{...candidate,authors:['Unrelated Author']}],[candidate,{...candidate,doi:'10.1109/ambiguous'}]]){
   tasks.executor.search=async()=>records;
   assert.equal((await tasks.completeReadingPublicationMetadata(repaired,incomplete)).journal,'','ambiguous or conflicting records must not supply a source');
  }
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('non-paper uploads leave a rejection event, keep original bytes and cannot reappear as literature on resume',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-non-paper-'));let handle;
 try{
  handle=await bootLite({storageRoot:join(dir,'storage'),includePython:false,extraRows:[
   {id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(dir,'projects')}}
  ]});
  const {ctx}=handle,tasks=ctx.ibmLiteratureWorkflows;
  await ctx.ibmCore.createProject({id:'non-paper',name:'非论文验收'});
  ctx.ibmRuntime.convert=async()=>({available:true,text:'INVOICE: stationery purchase, total 150.00.'});
  let response={documentKind:'non-paper',rejectionReason:'文件内容为办公用品采购发票，不是论文或论文补充材料'};
  tasks.identifyReadingPdf=async()=>response;
  let searches=0;tasks.executor.search=async()=>{searches++;return [];};
  const upload=await tasks.uploadReadingPdf({projectId:'non-paper',name:'invoice.pdf',base64:pdf.toString('base64')});
  await waitFor(()=>tasks.pdfIntakeJobs.size===0);
  const rejected=tasks.getBundle(upload.bundle.id);
  assert.equal(rejected.pdfIntake.status,'rejected');assert.equal(rejected.pdfIntake.kind,'non-paper');assert.match(rejected.pdfIntake.error,/采购发票/);
  assert.equal(searches,0,'explicit non-papers must not trigger academic metadata search');
  assert.equal(tasks.listReadingReports('non-paper').length,0);assert.deepEqual(await readFile(rejected.pdfPath),pdf);
  const duplicate=await tasks.uploadReadingPdf({projectId:'non-paper',name:'same.pdf',base64:pdf.toString('base64')});
  assert.equal(duplicate.rejected,true);assert.equal(duplicate.reused,true);assert.equal(duplicate.report,undefined);
  await tasks.reconcileReadingEntries();assert.equal(tasks.listReadingReports('non-paper').length,0);
  assert.deepEqual(await tasks.readingMaterialCandidates({id:'new-upload',projectId:'non-paper'}),[],'non-papers cannot become SI parent candidates');
  // A mistaken classification is recoverable without re-uploading the source.
  response={...metadata,journal:'',journalAbbrev:'',doi:''};
  await tasks.retryReadingPdf({projectId:'non-paper',bundleId:rejected.id});await waitFor(()=>tasks.pdfIntakeJobs.size===0);
  const recovered=tasks.getBundle(rejected.id);assert.equal(recovered.pdfIntake.status,'completed',recovered.pdfIntake.error);
  assert.equal(recovered.pdfIntake.kind,'pdf');assert.equal(tasks.listReadingReports('non-paper').length,1);
  assert.equal(tasks.listReadingReports('non-paper')[0].shortCitation,metadata.title,'missing venue alone must not reject a paper');
  // Reclassification must never delete a completed reading artifact.
  const report=tasks.listReadingReports('non-paper')[0];await tasks.table('reports').put(report.id,{...report,docxPath:join(recovered.entryDir,'existing-reading.docx')});
  response={documentKind:'non-paper',rejectionReason:'错误分类验收'};
  await tasks.retryReadingPdf({projectId:'non-paper',bundleId:recovered.id});await waitFor(()=>tasks.pdfIntakeJobs.size===0);
  assert.equal(tasks.getBundle(recovered.id).pdfIntake.status,'failed');assert.ok(tasks.getReadingReport(report.id).docxPath);
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});
