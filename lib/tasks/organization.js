import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {coreProjectSchema,readingReportSchema,literatureSearchRunSchema} from '../../src/task-models.js';
import {decodeRis,parseRis,RIS_MAX_BYTES} from '../../src/literature/ris-import.js';
export const validateReadingFolderName=value=>{const name=String(value??'').replace(/\s+/g,' ').trim();if(!name||name.length>80||/[\x00-\x1f\\/]/.test(name)||['全部','未分类'].includes(name))throw Error('文件夹名称需为 1–80 字，不含斜杠，且不能使用“全部”或“未分类”');return name;};
export const organizationMethods={
 listReadingFolders(projectId){return this.ctx.ibmCore.requireProject(projectId).readingFolders??[];},
 async withFolderLock(projectId,work){
  this.folderLocks??=new Map();const previous=this.folderLocks.get(projectId)??Promise.resolve();const next=previous.catch(()=>{}).then(work);this.folderLocks.set(projectId,next);
  try{return await next;}finally{if(this.folderLocks.get(projectId)===next)this.folderLocks.delete(projectId);}
 },
 async saveReadingFolder({projectId,id,name}){return this.withFolderLock(projectId,async()=>{
  const project=this.ctx.ibmCore.requireProject(projectId),folders=[...(project.readingFolders??[])];name=validateReadingFolderName(name);
  const existing=folders.find(row=>row.name.toLocaleLowerCase()===name.toLocaleLowerCase());
  if(existing&&(!id||existing.id===id))return existing;
  if(existing)throw Error('该名称的文件夹已存在');
  const index=id?folders.findIndex(row=>row.id===id):-1;if(id&&index<0)throw Error('文件夹不存在或不属于当前课题');
  const folder={id:id??'folder-'+randomUUID(),name,createdAt:index<0?new Date().toISOString():folders[index].createdAt};
  if(index<0)folders.push(folder);else folders[index]=folder;
  await this.ctx.ibmCore.table('projects').put(projectId,coreProjectSchema.parse({...project,readingFolders:folders,updatedAt:new Date().toISOString()}));return folder;
 });},
 async deleteReadingFolder({projectId,id}){return this.withFolderLock(projectId,async()=>{
  const project=this.ctx.ibmCore.requireProject(projectId);if(!(project.readingFolders??[]).some(row=>row.id===id))throw Error('文件夹不存在或不属于当前课题');
  for(const report of this.listReadingReports(projectId))if(report.folderId===id)await this.table('reports').put(report.id,readingReportSchema.parse({...report,folderId:undefined,classification:undefined,updatedAt:new Date().toISOString()}));
  await this.ctx.ibmCore.table('projects').put(projectId,coreProjectSchema.parse({...project,readingFolders:project.readingFolders.filter(row=>row.id!==id),updatedAt:new Date().toISOString()}));return {deleted:true};
 });},
 async classifyReadingReport({projectId,reportId,folderId,name,reason='',source='human'}){
  this.ctx.ibmCore.requireProject(projectId);let report=this.getReadingReport(reportId);
  if(!report||report.projectId!==projectId)throw Error('精读条目不存在或不属于当前课题');
  if(source==='agent'&&(!report.paperCardPath||!report.docxPath))throw Error('请完成并登记精读报告后，再按报告内容分类');
  if(source==='agent'&&!String(reason).trim())throw Error('Agent 分类必须提供基于精读内容的理由');
  if(name)folderId=(await this.saveReadingFolder({projectId,name})).id;
  return this.withFolderLock(projectId,async()=>{
  if(folderId&&!this.listReadingFolders(projectId).some(row=>row.id===folderId))throw Error('文件夹不存在或不属于当前课题');
  report=this.getReadingReport(reportId);const now=new Date().toISOString();
  const next=readingReportSchema.parse({...report,folderId:folderId||undefined,classification:folderId?{reason:String(reason).slice(0,1000),source,updatedAt:now,reportSha256:report.paperCardPath?createHash('sha256').update(await readFile(report.paperCardPath)).digest('hex'):undefined}:undefined,updatedAt:now});
  await this.table('reports').put(reportId,next);return next;
  });
 },
 async importSearchRis({projectId,fileName,base64}){
  this.ctx.ibmCore.requireProject(projectId);
  if(!/\.ris$/i.test(String(fileName??'')))throw Error('请选择 .ris 文件');
  if(typeof base64!=='string'||base64.length>Math.ceil(RIS_MAX_BYTES/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('RIS 上传内容无效或超过 2 MB');
  const bytes=Buffer.from(base64,'base64'),decoded=decodeRis(bytes),parsed=parseRis(decoded.text);
  const sha256=createHash('sha256').update(bytes).digest('hex'),id='search-ris-'+createHash('sha256').update(projectId+'\0'+sha256).digest('hex').slice(0,24);
  const prior=this.table('searches').get(id);if(prior)return {run:prior,reused:true,...parsed};
  const workspace=await this.ensureProjectWorkspace(projectId),directory=join(workspace.path,'literature-searches',id);await mkdir(directory,{recursive:true});
  const path=join(directory,'source.ris');await writeFile(path,bytes);
  const safeName=String(fileName).split(/[\\/]/).at(-1).slice(0,180),now=new Date().toISOString();
  const run=literatureSearchRunSchema.parse({id,projectId,title:safeName.replace(/\.ris$/i,''),query:'人工检索 RIS 导入：'+safeName,queries:[],sources:['ris'],oaOnly:false,limit:parsed.results.length,results:parsed.results,status:'succeeded',progress:`导入 ${parsed.results.length} 条文献`,exports:[{format:'ris',path}],importedRis:{fileName:safeName,sha256,path,recordCount:parsed.recordCount,duplicateCount:parsed.duplicateCount,encoding:decoded.encoding},createdAt:now,updatedAt:now});
  await this.table('searches').put(id,run);return {run,reused:false,...parsed};
 }
};
