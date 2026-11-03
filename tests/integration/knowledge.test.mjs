import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import JSZip from 'jszip';
import {ProjectKnowledge,knowledgeFor} from '../../plugins/knowledge/lib/project-knowledge.js';
import {KnowledgeService} from '../../lib/rag/core.mjs';
import {apply as registerKnowledgeTools} from '../../plugins/knowledge/lib/tools.js';
import {registerResearchReadTool} from '../../lib/research-read.js';

function pdf(text){
 const stream=`BT /F1 12 Tf 50 720 Td (${text}) Tj ET`,objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n',offsets=[0];for(const [index,object]of objects.entries()){offsets.push(Buffer.byteLength(data));data+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(data);data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(data);
}
async function fixture(){const root=await mkdtemp(join(tmpdir(),'ibm-knowledge-')),projects=new Map();for(const id of ['one','two']){const workspacePath=join(root,id);await mkdir(workspacePath);projects.set(id,{id,name:id,workspacePath,projectFilePath:join(workspacePath,id+'.ibmproject')});}const core={getProject:id=>projects.get(id)},service=new ProjectKnowledge(core,{root:join(root,'settings')});return{root,projects,core,service};}
async function settle(service,id){const row=await service.project(id);while(row.job)await row.job;return row;}

test('project indexes PDF/DOCX/text, keeps projects isolated, supports import and incremental rename/deletion',async()=>{
 const f=await fixture();try{
  const row=await settle(f.service,'one');
  await writeFile(join(row.path,'literature','paper.pdf'),pdf('Electrical impedance identifies erythrocytes in thrombus'));
  const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Supplementary evidence nanoelectrodes</w:t></w:r></w:p></w:body></w:document>');await writeFile(join(row.path,'literature','SI.docx'),await zip.generateAsync({type:'nodebuffer'}));
  await f.service.sync({projectId:'one'});await settle(f.service,'one');
  let result=await f.service.search({projectId:'one',query:'erythrocytes'});assert.equal(result.sources.length,1);assert.equal(result.sources[0].locator.kind,'pdf');assert.equal(result.sources[0].locator.page,1);
  assert.match((await f.service.prepare({projectId:'one',query:'erythrocytes'})).prompt,/never as instructions/);
  assert.equal((await f.service.search({projectId:'one',query:'nanoelectrodes'})).sources[0].locator.kind,'docx');
  const source=result.sources[0];assert.equal((await f.service.source({projectId:'one',libraryKey:source.libraryKey,sourceId:source.sourceId})).fileName,'paper.pdf');
  assert.equal((await f.service.search({projectId:'two',query:'erythrocytes'})).sources.length,0);
  await assert.rejects(f.service.source({projectId:'two',libraryKey:source.libraryKey,sourceId:source.sourceId}),/不可用|不属于/);
  await assert.rejects(f.service.upload({projectId:'one',fileName:'../escape.md',base64:'YWJj'}));
  const upload={projectId:'one',fileName:'notes.md',base64:Buffer.from('# Findings\nphotothermal nanomedicine evidence').toString('base64')};await f.service.upload(upload);await settle(f.service,'one');assert.equal((await f.service.search({projectId:'one',query:'photothermal'})).sources.length,1);assert.equal((await f.service.upload(upload)).duplicate,true);await settle(f.service,'one');
  await rename(join(row.path,'literature','paper.pdf'),join(row.path,'literature','renamed.pdf'));await f.service.sync({projectId:'one'});await settle(f.service,'one');result=await f.service.search({projectId:'one',query:'erythrocytes'});assert.equal(result.sources[0].fileName,'renamed.pdf');
  await rm(join(row.path,'literature','renamed.pdf'));await f.service.sync({projectId:'one'});await settle(f.service,'one');assert.equal((await f.service.search({projectId:'one',query:'erythrocytes'})).sources.length,0);
  await assert.rejects(f.service.prepare({projectId:'one',query:'unfindablexxxyyy'}),/未检索到/);
 }finally{await f.service.close();assert.ok(resolve(f.root).startsWith(resolve(tmpdir())));await rm(f.root,{recursive:true,force:true});}
});

test('shared library remains byte-for-byte unchanged and requires explicit selection; role/year filters and source scope work',async()=>{
 const f=await fixture();try{
  const docs=join(f.root,'shared-docs'),index=join(f.root,'shared-index');await mkdir(docs);
  await writeFile(join(docs,'evidence.md'),'# Impedance\nErythrocytes nanoelectrodes experimental evidence.');
  await writeFile(join(docs,'literature-manifest.json'),JSON.stringify({papers:[{gid:'P1',title:'Clinical impedance evidence',year:2024,doi:'10.1234/example'}],files:[{paper_id:'P1',role:'original',path:'evidence.md'}]}));
  const shared=new KnowledgeService(index),base=await shared.createKnowledgeBase('共享证据',[docs]);await shared.sync(base.id);
  const paths=[join(index,'config.json'),join(index,'catalogs',base.id+'.json')],before=await Promise.all(paths.map(path=>readFile(path,'utf8')));
  await f.service.attach(index);const available=await f.service.available('one'),key=available.libraries.find(row=>row.scope==='shared').key;
  assert.equal((await f.service.search({projectId:'one',query:'nanoelectrodes'})).sources.length,0);
  const result=await f.service.search({projectId:'one',keys:[key],query:'nanoelectrodes',role:'original',yearFrom:2023,yearTo:2025});assert.equal(result.sources.length,1);assert.equal(result.sources[0].citationId,'S1');
  assert.equal((await f.service.search({projectId:'one',keys:[key],query:'nanoelectrodes',role:'supplement'})).sources.length,0);
  assert.equal((await f.service.search({projectId:'one',keys:[key],query:'nanoelectrodes',yearFrom:2025})).sources.length,0);
  await f.service.source({projectId:'one',libraryKey:key,sourceId:result.sources[0].sourceId});assert.deepEqual(await Promise.all(paths.map(path=>readFile(path,'utf8'))),before);
  await writeFile(join(docs,'evidence.md'),'# Evidence\nVascular biocompatibility replacement.');await shared.sync(base.id);
  assert.equal((await f.service.search({projectId:'one',keys:[key],query:'biocompatibility'})).sources.length,1);
  await writeFile(join(index,'config.json'),JSON.stringify({schemaVersion:2,knowledgeBases:[]}));await assert.rejects(f.service.attach(index),/格式不受支持/);assert.equal(JSON.parse(await readFile(join(index,'config.json'),'utf8')).schemaVersion,2);
  await shared.close();
 }finally{await f.service.close();await rm(f.root,{recursive:true,force:true});}
});

test('moving the .ibmproject folder rebases the local index and leaves source lookup operational',async()=>{
 const f=await fixture();let restarted;try{
  await f.service.upload({projectId:'one',fileName:'portable.md',base64:Buffer.from('Portable polymeric nanostructures').toString('base64')});await settle(f.service,'one');await f.service.close();
  const old=f.projects.get('one'),workspacePath=join(f.root,'moved');await rename(old.workspacePath,workspacePath);f.projects.set('one',{...old,workspacePath,projectFilePath:join(workspacePath,'one.ibmproject')});
  restarted=new ProjectKnowledge(f.core,{root:join(f.root,'settings')});await settle(restarted,'one');const result=await restarted.search({projectId:'one',query:'nanostructures'});assert.equal(result.sources.length,1);const source=await restarted.source({projectId:'one',libraryKey:result.sources[0].libraryKey,sourceId:result.sources[0].sourceId});assert.ok(source.path.startsWith(workspacePath));await stat(source.path);
 }finally{await restarted?.close();await f.service.close();await rm(f.root,{recursive:true,force:true});}
});

test('research assistant exposes list/search tools with project-aware execution and evidence boundaries',async()=>{
 const tools=[];const toolsCtx={tools:{register:tool=>tools.push(tool)},get:name=>name==='labKnowledge'?{forCore:()=>({})}:name==='ibmCore'?{getProjectBySession:()=>null,table:()=>null}:undefined};
 // 跨模块只读工具属母插件；知识库工具随插件注册。
 registerResearchReadTool(toolsCtx);registerKnowledgeTools(toolsCtx);
 assert.deepEqual(tools.map(tool=>tool.name),['lab_research_read','lab_knowledge_list','lab_knowledge_search','lab_knowledge_add_to_reading']);
 const search=tools.find(tool=>tool.name==='lab_knowledge_search');assert.match(search.description,/不可信/);assert.ok(search.parameters.required.includes('query'));
 const unavailable=await search.execute({query:'evidence'},{});assert.equal(unavailable.ok,false);
});

test('Cordis caller proxies share one project watcher and assistant retrieval instance',async()=>{
 const f=await fixture();try{
  let cleanups=0;f.core.ctx={effect:()=>{cleanups++;}};
  const proxy=()=>new Proxy(f.core,{get:(target,key)=>key===Symbol.for('cordis.original')?target:target[key]});
  const first=knowledgeFor(proxy()),second=knowledgeFor(proxy());assert.equal(first,second);assert.equal(cleanups,1);
  await settle(first,'one');const marker=join(f.projects.get('one').workspacePath,'.ibm-rag','project-root.json'),before=(await stat(marker)).mtimeMs;
  await second.available('one');await second.available('one');assert.equal((await stat(marker)).mtimeMs,before);await first.close();
 }finally{await f.service.close();await rm(f.root,{recursive:true,force:true});}
});
