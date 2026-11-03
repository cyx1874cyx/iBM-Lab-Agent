import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {bootLite} from '../helpers/boot-lite.mjs';
import {ProjectKnowledge} from '../../plugins/knowledge/lib/project-knowledge.js';
import {readingTransferRequested} from '../../plugins/knowledge/lib/reading.js';
import {apply as registerKnowledgeTools} from '../../plugins/knowledge/lib/tools.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('RAG-selected papers create a live reading folder with archived PDF/SI, including earlier references; retries reuse rows',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-rag-reading-'));let handle,knowledge;
 try{
  handle=await bootLite({storageRoot:join(root,'storage'),includePython:false,extraRows:[{id:'knowledge',name:new URL('../../plugins/knowledge/lib/index.js',import.meta.url).href,inject:['ibmCore'],config:{root:join(root,'knowledge')}},{id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(root,'projects')}}]});
  const core=handle.ctx.ibmCore,tasks=handle.ctx.ibmLiteratureWorkflows;
  const project=await core.createProject({id:'transfer-project',name:'知识库精读联动验收'});await core.bindProjectSession({projectId:project.id,sessionId:'qa-transfer',workspaceId:'workspace-transfer'});
  const docs=join(root,'library'),index=join(root,'index'),baseId=randomUUID();await mkdir(docs);await mkdir(join(index,'catalogs'),{recursive:true});
  const documents=[],originals=new Map();
  const add=async(paperId,role,fileName,bytes)=>{await writeFile(join(docs,fileName),bytes);originals.set(fileName,bytes);const id=randomUUID();const row={id,sourceId:randomUUID(),rootPath:docs,relativePath:fileName,displayName:fileName,contentHash:hash(bytes),size:bytes.length,mtimeMs:Date.now(),chunks:[{id:id+':1',text:paperId+' thrombus characterization',structuralContext:fileName,locator:{kind:'text',lineStart:1,lineEnd:1,titlePath:[]}}],literature:{paperId,role,title:paperId==='G001'?'MRI clot composition mapping':'Spatial clot heterogeneity quantification',doi:paperId==='G001'?'10.1234/one':'10.1234/two',year:2024,authors:['A Example'],topics:[]}};documents.push(row);return row;};
  const note=await add('G001','reading_note','G001.md',Buffer.from('# MRI clot composition mapping'));
  await add('G001','original','G001.pdf',Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF'));
  const si=new JSZip();si.file('word/document.xml','<document>Supplemental methods</document>');await add('G001','supplement','G001 SI.docx',await si.generateAsync({type:'nodebuffer'}));
  await add('G002','original','G002.pdf',Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%two\n%%EOF'));
  const noteOnly=await add('G003','reading_note','G003.md',Buffer.from('# Metadata-only independent study'));noteOnly.literature={...noteOnly.literature,title:'Metadata-only independent study',doi:'10.1234/three'};
  const config=join(index,'config.json'),catalog=join(index,'catalogs',baseId+'.json');await writeFile(config,JSON.stringify({schemaVersion:1,knowledgeBases:[{id:baseId,name:'共享文献',roots:[docs],createdAt:new Date().toISOString()}]}));await writeFile(catalog,JSON.stringify({schemaVersion:1,knowledgeBaseId:baseId,generation:1,updatedAt:new Date().toISOString(),documents}));
  const before=[await readFile(config,'utf8'),await readFile(catalog,'utf8')];knowledge=new ProjectKnowledge(core,{root:join(root,'knowledge')});await knowledge.attach(index);const key=(await knowledge.available(project.id)).libraries.find(base=>base.scope==='shared').key;
  await knowledge.bindChat({projectId:project.id,sessionId:'qa-transfer',keys:[key],role:'reading_note'});
  await knowledge.chatWrite(project.id,'qa-transfer',{question:'把 G001 和 G002 加入精读条目的新文件夹',retrievals:[{turn:1,result:{sources:[{...note,libraryKey:key,citationId:'S1'}]}}]});
  const request={projectId:project.id,sessionId:'qa-transfer',paperRefs:['T1:S1','G002'],folderName:'血栓成分与空间异质性'},cursor=core.projectUpdates.revision(project.id);
  const owner=core[Symbol.for('cordis.original')]??core;owner[Symbol.for('ibm.lab.knowledge.instance')]=knowledge;
  const tools=[];registerKnowledgeTools({tools:{register:tool=>tools.push(tool)},get:name=>name==='labKnowledge'?{forCore:()=>knowledge}:name==='ibmCore'?core:name==='ibmLiteratureWorkflows'?tasks:undefined});
  const result=await tools.find(tool=>tool.name==='lab_knowledge_add_to_reading').execute({paperRefs:request.paperRefs,folderName:request.folderName},{agent:{session:{id:'qa-transfer'}},signal:new AbortController().signal});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.added,2);assert.equal(result.folderCreated,true);assert.notEqual(core.projectUpdates.revision(project.id),cursor);assert.equal(tasks.listReadingFolders(project.id).length,1);
  for(const entry of result.entries){const report=tasks.getReadingReport(entry.reportId),bundle=tasks.getBundle(entry.bundleId);assert.equal(report.folderId,result.folder.id);assert.equal(report.docxPath,undefined);assert.ok(bundle.pdfPath.startsWith(project.workspacePath));assert.equal(bundle.acquisitionStatus,'ready');assert.equal(report.status,'pending');}
  const first=tasks.getBundle(result.entries[0].bundleId);assert.deepEqual(await readFile(first.pdfPath),originals.get('G001.pdf'));assert.match(first.siPath,/\.docx$/);assert.deepEqual(await readFile(first.siPath),originals.get('G001 SI.docx'));
  const retry=await knowledge.addToReading(tasks,request);assert.equal(retry.reused,2);assert.equal(retry.added,0);assert.equal(retry.folderCreated,false);assert.equal(tasks.listReadingReports(project.id).length,2);
  await rm(first.pdfPath);const repaired=await knowledge.addToReading(tasks,{...request,paperRefs:['G001']});assert.equal(repaired.ok,true);assert.deepEqual(await readFile(first.pdfPath),originals.get('G001.pdf'));
  await assert.rejects(knowledge.addToReading(tasks,{...request,paperRefs:['G001','G999'],folderName:'不得出现的空文件夹'}),/G999/);assert.equal(tasks.listReadingFolders(project.id).length,1);
  const missing=await knowledge.addToReading(tasks,{...request,paperRefs:['G003']});assert.equal(missing.ok,true);assert.equal(missing.entries[0].hasPdf,false);assert.equal(tasks.getBundle(missing.entries[0].bundleId).acquisitionStatus,'awaiting-pdf');assert.equal(tasks.getReadingReport(missing.entries[0].reportId).docxPath,undefined);
  await knowledge.chatWrite(project.id,'qa-transfer',{question:'先不要添加，只推荐相关文献',previousTransferRequest:false});await assert.rejects(knowledge.addToReading(tasks,request),/明确要求/);
  assert.deepEqual([await readFile(config,'utf8'),await readFile(catalog,'utf8')],before);for(const [name,bytes]of originals)assert.deepEqual(await readFile(join(docs,name)),bytes);
  const saved=JSON.parse(await readFile(project.projectFilePath,'utf8'));assert.ok(JSON.stringify(saved).includes('血栓成分与空间异质性'));
 }finally{await knowledge?.close();await handle?.dispose();await rm(root,{recursive:true,force:true});}
});

test('discussion and negative requests do not authorize adding reading entries',()=>{
 assert.equal(readingTransferRequested('推荐几篇精读文献'),false);assert.equal(readingTransferRequested('先不要把文献添加到精读文件夹'),false);assert.equal(readingTransferRequested('把这三篇加入精读条目的新文件夹'),true);
});
