import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {bootLite} from '../helpers/boot-lite.mjs';
import {ResearchReadAccess,registerResearchReadTool} from '../../lib/research-read.js';
import {ReagentCatalog} from '../../src/reagents/catalog.js';
import {reagentWorkbook,reagentFixtureSheets} from '../helpers/reagent-workbook.mjs';
import {installKnowledgeAssistant} from '../../lib/knowledge-assistant.js';
import {defineTool} from '@deepseek-ai/dsh-tools';

async function snapshot(root){
 const rows={};
 const visit=async path=>{for(const item of await readdir(path,{withFileTypes:true})){const child=join(path,item.name);if(item.isDirectory())await visit(child);else if(item.isFile())rows[relative(root,child)]=createHash('sha256').update(await readFile(child)).digest('hex');}};
 await visit(root);return rows;
}

function pdf(text){
 const stream=`BT /F1 12 Tf 50 720 Td (${text}) Tj ET`,objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n',offsets=[];for(const [index,object]of objects.entries()){offsets.push(Buffer.byteLength(data));data+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(data);return Buffer.from(data+`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('cross-module read access reads records and documents without changing project files, templates or reagent workbooks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-research-read-'));let handle;
 try{
  handle=await bootLite({storageRoot:join(root,'storage'),includePython:false,extraRows:[{id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(root,'projects')}}]});
  const core=handle.ctx.ibmCore,tasks=handle.ctx.ibmLiteratureWorkflows;core.conversations.schedule=()=>{};
  const project=await core.createProject({id:'read-project',name:'只读科研课题',coreMarkdown:'# 核心记忆\n研究已完成第一阶段'}),workspace=project.workspacePath;
  const entry=await tasks.registerPaperMeta({projectId:project.id,title:'Read-only evidence from a registered study',sourceType:'publisher'});
  await writeFile(join(workspace,'notes.md'),'# 已有报告\n'+'证据定位与数据分析。'.repeat(800));
  await writeFile(join(workspace,'study.pdf'),pdf('Existing experimental evidence from a PDF.'));
  await writeFile(join(workspace,'.credentials.yaml'),'token: must-not-be-read');
  const doc=new JSZip();doc.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>NMR assignment report: sample alpha, verified.</w:t></w:r></w:p></w:body></w:document>');
  await writeFile(join(workspace,'nmr-report.docx'),await doc.generateAsync({type:'nodebuffer'}));
  const catalog=new ReagentCatalog(join(root,'reagents')),workbook=join(root,'inventory.xlsx');await writeFile(workbook,await reagentWorkbook(reagentFixtureSheets));await catalog.setSource('chemical',workbook);
  const optional=new Map([
   ['labCharacterization',{list:()=>[{id:'nmr-1',projectId:project.id,kind:'nmr',compound:{name:'样品甲'},assessment:{summary:'已完成标峰'},artifacts:{report:{path:join(workspace,'nmr-report.docx')}}}]}],
   ['labPlotRecords',{list:async()=>[{id:'plot-1',projectId:project.id,topic:'已有科研绘图'}]}],
   ['labSynthesis',{listTargets:()=>[{id:'target-1',projectId:project.id,name:'目标化合物'}],getProjectRoutes:()=>[{id:'route-1',projectId:project.id,name:'已有路线'}],listRouteEvidence:()=>[{id:'evidence-1',text:'参考文献证据'}]}]
  ]);
  const ctx={get:name=>optional.has(name)?optional.get(name):handle.ctx.get(name)},access=new ResearchReadAccess(ctx,{catalog});
  const before=await snapshot(workspace),templateCount=handle.ctx.labNoteTemplates.requireTable().size,workbookBefore=await readFile(workbook);
  const read=(resource,args={})=>access.read({projectId:project.id,resource,...args});
  assert.equal((await read('overview')).counts.reports,1);
  assert.match((await read('memory')).records[0].text,/第一阶段/);
  assert.equal((await read('reading')).records[0].id,entry.report.id);
  assert.equal((await read('nmr')).records[0].compound.name,'样品甲');
  assert.equal((await read('plots')).records[0].topic,'已有科研绘图');
  assert.ok((await read('synthesis')).records.some(row=>row.id==='route-1'));
  assert.ok((await read('reagents',{query:'865-49-6'})).records.every(row=>row.cas==='865-49-6'));
  assert.ok((await read('files')).records.every(row=>row.name!=='.credentials.yaml'));
  const first=await read('file',{path:'notes.md',limit:1});assert.ok(first.nextOffset>0);
  assert.ok((await read('file',{path:'notes.md',offset:first.nextOffset,limit:1})).records.length);
  assert.match((await read('file',{path:'nmr-report.docx'})).records[0].text,/NMR assignment report/);
  const paper=await read('file',{path:'study.pdf'});assert.match(paper.records[0].text,/experimental evidence/);assert.equal(paper.records[0].locator.page,1);
  const detail=await read('reading',{id:entry.report.id});assert.match(detail.records[0].text,new RegExp(entry.report.id));assert.equal(detail.format,'json');
  await read('templates');await read('drafts');
  await assert.rejects(read('file',{path:'.credentials.yaml'}),/科研资料/);
  const outside=join(root,'outside.md');await writeFile(outside,'not registered');
  await assert.rejects(read('file',{path:outside}),/只能读取/);
  assert.deepEqual(await snapshot(workspace),before,'all module reads leave project files byte-for-byte unchanged');
  assert.equal(handle.ctx.labNoteTemplates.requireTable().size,templateCount,'reading templates must not seed versions');
  assert.deepEqual(await readFile(workbook),workbookBefore);
  const report=tasks.getReadingReport(entry.report.id);await core.table('reports').put(report.id,{...report,summary:outside});
  await assert.rejects(read('file',{path:outside}),/只能读取/,'metadata prose must not grant file access');
  await core.table('reports').put(report.id,report);
  const linked=join(workspace,'external-link');await symlink(root,linked,'junction');
  try{await assert.rejects(read('file',{path:'external-link/outside.md'}),/只能读取/);}finally{await rm(linked,{recursive:false,force:true});}
 }finally{await handle?.dispose();await rm(root,{recursive:true,force:true});}
});

test('registered knowledge tools enforce read-only dispatch while allowing a query through the real tool registry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-knowledge-permissions-'));let handle;
 try{
  handle=await bootLite({storageRoot:join(root,'storage'),coreOnly:true,includePython:false,extraRows:[{id:'tools',name:'@deepseek-ai/dsh-tools'},{id:'prompt',name:'@deepseek-ai/dsh-system-prompt'}]});
  const ctx=handle.ctx,core=ctx.ibmCore;core.conversations.schedule=()=>{};
  const project=await core.createProject({id:'permissions-project',name:'权限验证'});await core.bindProjectSession({projectId:project.id,workspaceId:'workspace-read',sessionId:'knowledge-read-chat'});
  registerResearchReadTool(ctx);let writes=0;
  ctx.tools.register(defineTool({name:'write',description:'test write',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},execute:async()=>{writes++;return{ok:true};}}));
  installKnowledgeAssistant(ctx,{serviceFor:()=>({chatState:async()=>({chat:{}})})});
  const agent={ctx,session:{id:'knowledge-read-chat',header:{id:'knowledge-read-chat',cwd:project.workspacePath}}};
  const execute=(name,args={})=>ctx.tools.execute({name,arguments:args,agent,callId:'call-'+name,signal:new AbortController().signal});
  const denied=await execute('write');assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/只读/);assert.equal(writes,0);
  const read=await execute('lab_research_read',{resource:'memory'});assert.equal(read.isError,false,JSON.stringify(read));assert.match(JSON.stringify(read),/readOnly/);
 }finally{await handle?.dispose();await rm(root,{recursive:true,force:true});}
});
