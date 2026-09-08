import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import JSZip from "jszip";
import {bootLite} from "../helpers/boot-lite.mjs";
import {createArtifactDownloadHandler} from "../../lib/artifact-download.js";
const vendorRoot=fileURLToPath(new URL("../../vendor/nature-skills",import.meta.url));
test("characterization persists tasks, retries, validates artifacts and updates entries exactly once",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ibm-characterization-"));let handle;
 const options={storageRoot:join(dir,"store"),vendorDir:vendorRoot,lockFile:fileURLToPath(new URL("../../vendor.lock.json",import.meta.url)),includePython:false,extraRows:[
  {id:"goals",name:"dsh-lab-agent/goal-profiles",inject:["storageDomain"]},
  {id:"notes",name:"dsh-lab-agent/note-templates",inject:["storageDomain"]},
  {id:"templates",name:"dsh-lab-agent/ppt-templates",inject:["storageDomain"],config:{templatesDir:join(dir,"templates")}},
  {id:"tasks",name:"dsh-lab-agent/tasks",inject:["storageDomain","labGoals","labNoteTemplates","labTemplates","labVersions"],config:{skillsRoot:vendorRoot+"/skills",projectsRoot:join(dir,"projects")}},
  {id:"nmr",name:"dsh-lab-agent/nmr",inject:["storageDomain"]},
  {id:"characterization",name:"dsh-lab-agent/characterization",inject:["storageDomain","labTasks","labNmr","labPlotRecords"]}
 ]};
 try{
  await mkdir(join(dir,"templates"));handle=await bootLite(options);const {ctx}=handle;
  await ctx.labTasks.createProject({id:"p-test",name:"test",goalProfileId:"default-prodrug-polymer",goalProfileVersion:"1",templateId:"nature-default",templateVersion:"1"});
  const workspace=(await ctx.labTasks.ensureProjectWorkspace("p-test")).path;
  await writeFile(join(workspace,"input.txt"),"fixture input");
  const fields={id:"nmr-test",projectId:"p-test",kind:"nmr",title:"sample",inputPath:"input.txt",instructions:"analyze",compound:{name:"ethanol",smiles:"CCO"},deuteratedSolvent:"CDCl3"};
  const c=ctx.labCharacterization;const [a,b]=await Promise.all([c.submit(fields),c.submit(fields)]);
  assert.equal(a.task.id,b.task.id);assert.equal(c.list("p-test").length,1);assert.match(a.prompt,/lab_characterization_complete/);
  await assert.rejects(c.submit({...fields,projectId:"other"}));
  await assert.rejects(c.complete(a.task.id,"p-test",{attempt:1}),/缺少/);
  assert.equal(c.get(a.task.id).status,"queued");
  await c.update(a.task.id,"p-test",{attempt:1,status:"failed",error:"software unavailable"});
  await assert.rejects(c.update(a.task.id,"p-test",{attempt:1,status:"running"}),/先重试/);
  const retry=await c.retry(a.task.id,"p-test");assert.equal(retry.task.attempt,2);
  await assert.rejects(c.complete(a.task.id,"p-test",{attempt:1}),/过期/);
  await c.update(a.task.id,"p-test",{attempt:2,status:"running"});
  // Format-labeled fixture bytes exercise registration, not scientific software validity.
  await writeFile(join(workspace,"测试谱图.mnova"),"fixture: not a real Mnova document");
  const zip=new JSZip();zip.file("word/document.xml","<document/>");await writeFile(join(workspace,"报告.docx"),await zip.generateAsync({type:"nodebuffer"}));
  const outputs={attempt:2,spectrumPath:"测试谱图.mnova",reportPath:"报告.docx"};
  const done=await c.complete(a.task.id,"p-test",outputs);assert.equal(done.status,"completed");
  await c.complete(a.task.id,"p-test",outputs);assert.equal(ctx.labNmr.listDatasets().length,1);
  assert.equal(ctx.labNmr.getDataset(a.task.id).compound.smiles,"CCO");assert.equal(ctx.labNmr.getDataset(a.task.id).deuteratedSolvent,"CDCl3");assert.equal(ctx.labNmr.getDataset(a.task.id).status,"prepared");
  const file=await c.artifactFile(a.task.id,"p-test","report");assert.equal(file.sha256,done.artifacts.report.sha256);
  await assert.rejects(c.artifactFile(a.task.id,"other","report"),/当前课题/);
  let status,headers,body;const response={writeHead:(s,h)=>{status=s;headers=h;},end:b=>{body=b;}};
  await createArtifactDownloadHandler(ctx.labTasks,{characterization:()=>c})({method:"GET",url:"/api/lab-artifacts?kind=characterization&taskId=nmr-test&projectId=p-test&slot=report",headers:{}},response);
  assert.equal(status,200);assert.equal(headers["x-content-sha256"],file.sha256);assert.ok(body.length);
  await writeFile(join(workspace,"报告.docx"),"changed");await assert.rejects(c.artifactFile(a.task.id,"p-test","report"),/已改变/);
  const plot=await c.submit({...fields,id:"plot-test",kind:"plot",title:"曲线"});await writeFile(join(workspace,"curve.opju"),"fixture: not real Origin project");
  await c.complete(plot.task.id,"p-test",{attempt:1,originPath:"curve.opju"});await c.complete(plot.task.id,"p-test",{attempt:1,originPath:"curve.opju"});assert.equal((await ctx.labPlotRecords.list("p-test")).length,1);
  await ctx.labPlotRecords.update(plot.task.id,{topic:"edited",date:"2026-09-08"});
  assert.equal((await ctx.labPlotRecords.update(plot.task.id,{projectId:"other"})).projectId,"p-test");
  await writeFile(join(workspace,"legacy.opju"),"legacy origin fixture");
  await ctx.labPlotRecords.create({id:"legacy-plot",projectId:"p-test",topic:"legacy",artifactPath:join(workspace,"legacy.opju")});
  assert.equal((await c.artifactFile("legacy-plot","p-test","origin")).fileName,"legacy.opju");
  await assert.rejects(c.submit({...fields,id:"nmr-test",date:"2025-01-01"}),/另一任务/);
  const outside=join(dir,"outside.txt");await writeFile(outside,"outside");await assert.rejects(c.submit({...fields,id:"escape",inputPath:outside}),/当前课题工作目录/);
  await handle.dispose();handle=await bootLite(options);assert.equal(handle.ctx.labCharacterization.get(a.task.id).status,"completed");assert.equal((await handle.ctx.labPlotRecords.get(plot.task.id)).topic,"edited");
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});
