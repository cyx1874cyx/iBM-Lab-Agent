import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootLite} from '../helpers/boot-lite.mjs';

test('reading entry group order and folder moves persist in the project and reject foreign or processing entries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-reading-move-'));let handle;
 try{
  handle=await bootLite({storageRoot:join(dir,'storage'),includePython:false,extraRows:[
   {id:'goals',name:'dsh-lab-agent/goal-profiles'},{id:'notes',name:'dsh-lab-agent/note-templates'},{id:'templates',name:'dsh-lab-agent/ppt-templates'},{id:'tasks',name:'dsh-lab-agent/tasks',config:{projectsRoot:join(dir,'projects')}},
   {id:'registry',name:'@deepseek-ai/dsh-typert-registry'},{id:'gateway',name:'@deepseek-ai/dsh-api-gateway'},{id:'remote',name:'dsh-lab-agent/remote'}
  ]});
  const {ctx}=handle,core=ctx.ibmCore,tasks=ctx.labTasks;
  const project=await core.createProject({id:'move-project',name:'排序归类验收'});await core.createProject({id:'foreign-project',name:'隔离课题'});
  const rows=[];
  for(let n=0;n<5;n++){
   const projectId=n===4?'foreign-project':project.id,now=new Date(2026,0,n+1).toISOString();
   await core.commitSourceBundle({id:'move-bundle-'+n,projectId,title:'Paper '+n,acquisitionStatus:'awaiting-pdf',createdAt:now,updatedAt:now});
   const report=await tasks.ensureReadingEntry(projectId,'move-bundle-'+n);
   await tasks.table('reports').put(report.id,{...report,createdAt:now});rows.push(report);
  }
  const ids=rows.map(row=>row.id),folder=await tasks.saveReadingFolder({projectId:project.id,name:'血栓研究'});
  const invoke=request=>ctx.typertGateway.invoke({namespace:'lab',method:'tasks_reading_move',args:{request}});
  await invoke({projectId:project.id,reportIds:[ids[3],ids[1]],targetId:ids[0],position:'after'});
  assert.deepEqual(tasks.listReadingReports(project.id).map(row=>row.id),[ids[2],ids[0],ids[3],ids[1]]);
  const saved=JSON.parse(await readFile(project.projectFilePath,'utf8'));assert.deepEqual(saved.project.readingOrder,[ids[2],ids[0],ids[3],ids[1]]);
  await core.projectFiles.open(project.projectFilePath);
  assert.deepEqual(tasks.listReadingReports(project.id).map(row=>row.id),saved.project.readingOrder,'order survives reopening the project');
  await invoke({projectId:project.id,reportIds:[ids[3],ids[1]],folderId:folder.id});
  assert.equal(tasks.getReadingReport(ids[3]).folderId,folder.id);assert.equal(tasks.getReadingReport(ids[1]).folderId,folder.id);
  assert.equal(tasks.getReadingReport(ids[3]).classification.source,'human');
  const before=await readFile(project.projectFilePath,'utf8');
  await assert.rejects(invoke({projectId:project.id,reportIds:[ids[0],ids[4]],folderId:folder.id}),/不属于/);
  await assert.rejects(invoke({projectId:project.id,reportIds:[ids[0]],targetId:ids[4]}),/不属于/);
  await assert.rejects(invoke({projectId:project.id,reportIds:[ids[0]],folderId:'foreign-folder'}),/不属于/);
  assert.equal(await readFile(project.projectFilePath,'utf8'),before,'validate every selected entry and destination before writing');
  await invoke({projectId:project.id,reportIds:[ids[3],ids[1]],folderId:null});
  assert.equal(tasks.getReadingReport(ids[3]).folderId,undefined);assert.equal(tasks.getReadingReport(ids[1]).classification,undefined);
  const bundle=tasks.getBundle('move-bundle-0'),now=new Date().toISOString();
  await core.commitSourceBundle({...bundle,pdfIntake:{status:'running',stage:'处理中',originalFileName:'paper.pdf',attempt:1,createdAt:now,updatedAt:now}});
  await assert.rejects(invoke({projectId:project.id,reportIds:[ids[0]],targetId:ids[2]}),/识别完成/);
  assert.deepEqual(tasks.listReadingReports(project.id).map(row=>row.id),saved.project.readingOrder);
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});
