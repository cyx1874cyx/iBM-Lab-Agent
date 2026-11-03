import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {basename,dirname,extname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {taskSchema} from 'dsh-lab-agent/characterization-schema';
import {todayLocal} from 'dsh-lab-agent/plot/models';
import {PROFILE_ID_RE} from 'dsh-lab-agent/goal-profile';

export const NMR_STRUCTURE_EXTENSIONS=new Set(['.mol','.sdf','.cdx','.cdxml','.mrv','.cml','.smi','.smiles','.inchi']);
export const NMR_DATA_EXTENSIONS=new Set(['.zip','.mnova','.jdx','.dx','.jcamp']);
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');

/** Drafts bind one dataset and one target structure; analysis never guesses which pair was intended. */
export async function saveNmrDraft(service,fields){
 if(!PROFILE_ID_RE.test(fields.taskId||'')||!PROFILE_ID_RE.test(fields.projectId||''))throw Error('无效课题或条目编号');
 return service.serial(fields.taskId,async()=>{
  if(!service.ctx.ibmCore.getProject(fields.projectId))throw Error('课题不存在');
  const old=service.table.get(fields.taskId);
  if(old&&(old.projectId!==fields.projectId||old.kind!=='nmr'))throw Error('条目不属于当前课题');
  if(old&&old.status!=='draft')throw Error('分析已启动，原始输入不可替换');
  let inputPath=old?.inputPath,structurePath=old?.structurePath,inputSha256=old?.inputSha256;
  if(fields.inputPath){
   inputPath=await service.filePath(fields.projectId,fields.inputPath,true);
   const info=await stat(inputPath);
   if(info.isFile()&&!NMR_DATA_EXTENSIONS.has(extname(inputPath).toLowerCase()))throw Error('核磁数据支持 FID 目录、ZIP、Mnova 或 JCAMP 文件');
   if(info.isDirectory()&&!await service.findNmrDatasetRoot(inputPath))throw Error('目录中未找到完整的 FID 数据和采集参数');
   inputSha256=info.isFile()?hash(await readFile(inputPath)):undefined;
  }
  if(fields.structurePath){
   structurePath=await service.filePath(fields.projectId,fields.structurePath);
   if(!NMR_STRUCTURE_EXTENSIONS.has(extname(structurePath).toLowerCase()))throw Error('不支持该结构文件格式');
  }
  const compound={...(old?.compound||{}),...(fields.compound||{})};
  if(fields.structurePath&&fields.structurePath!==old?.structurePath&&!fields.compound?.smiles)delete compound.smiles;
  if(Object.hasOwn(fields.compound||{},'smiles')&&compound.smiles?.trim()){
   const smiles=compound.smiles.trim();
   if(smiles.length>100000||/[\r\n\x00]/.test(smiles))throw Error('SMILES 格式不正确');
   const workspace=await service.ctx.ibmCore.ensureProjectWorkspace(fields.projectId);
   const directory=join(workspace.path,'nmr-inputs',fields.taskId);
   await mkdir(directory,{recursive:true});
   structurePath=join(directory,'target-'+hash(Buffer.from(smiles)).slice(0,12)+'.smi');
   await writeFile(structurePath,smiles+'\n');
  }
  // SMILES files are self-contained; do not mislabel MOL/CDXML text as SMILES.
  if(structurePath&&/\.(smi|smiles)$/i.test(structurePath)&&!compound.smiles)compound.smiles=(await readFile(structurePath,'utf8')).split(/\r?\n/).find(line=>line.trim())?.trim().split(/\s/)[0];
  if(!compound.name?.trim()&&structurePath&&/\.(mol|sdf)$/i.test(structurePath)){
   const name=(await readFile(structurePath,'utf8')).split(/\r?\n/,1)[0].trim();
   if(name&&name.length<300)compound.name=name;
  }
  const title=compound.name?.trim()||fields.title?.trim()||old?.title||basename(inputPath||structurePath||'核磁条目').replace(/\.[^.]+$/,'');
  compound.name=compound.name?.trim()||title;
  const now=new Date().toISOString();
  const row=taskSchema.parse({...old,id:fields.taskId,projectId:fields.projectId,kind:'nmr',title,date:fields.date||old?.date||todayLocal(),inputPath,rawInputPath:inputPath,inputSha256,structurePath,structureSha256:structurePath?hash(await readFile(structurePath)):undefined,compound,nucleus:fields.nucleus||old?.nucleus||'1H',deuteratedSolvent:fields.deuteratedSolvent??old?.deuteratedSolvent,instructions:fields.instructions?.trim()||old?.instructions||'根据输入结构在 Mnova 中完成核磁处理、峰归属与标注，保存标峰后的可编辑核磁文件和分析报告。',status:'draft',attempt:old?.attempt||1,createdAt:old?.createdAt||now,updatedAt:now});
  await service.table.put(row.id,row);
  return {task:row};
 });
}

export async function nmrStructureSource(service,id,projectId){
 const row=service.table.get(id)||service.ctx.root?.get?.("labNmr").listDatasets().find(entry=>entry.id===id);
 if(!row||row.projectId!==projectId)throw Error('条目不属于当前课题');
 if(!row.structurePath)return {source:row.compound?.smiles||null,format:'smiles'};
 const path=await service.filePath(projectId,row.structurePath);
 const buffer=await readFile(path);
 if(row.structureSha256&&hash(buffer)!==row.structureSha256)throw Error('输入结构已改变，请重新登记');
 if(buffer.length>5*1024*1024)throw Error('结构文件过大');
 if(extname(path).toLowerCase()==='.cdx')return {source:row.compound?.smiles||null,format:'smiles',message:'CDX 结构将在 Mnova 读取后回填预览；也可使用 MOL 或 CDXML'};
 return {source:buffer.toString('utf8'),format:extname(path).slice(1)};
}

export async function nmrOpenPath(service,id,projectId,slot){
 const row=service.table.get(id)||service.ctx.root?.get?.("labNmr").listDatasets().find(entry=>entry.id===id);
 if(!row||row.projectId!==projectId||row.kind&&row.kind!=='nmr')throw Error('条目不属于当前课题');
 if(slot==='simulation'){
  const artifact=row.simulationArtifact;if(!artifact)throw Error('尚未生成 Mnova 模拟谱');
  const path=await service.filePath(projectId,artifact.path);if(hash(await readFile(path))!==artifact.sha256)throw Error('模拟谱文件已改变');return path;
 }
 if(slot==='spectrum'){
  // Existing artifact validation checks the registered output hash before opening it in place.
  await service.artifactFile(id,projectId,'spectrum');
  return service.filePath(projectId,row.artifacts?.spectrum?.path||row.spectrumPath);
 }
 if(slot!=='raw')throw Error('无效核磁文件类型');
 const path=await service.filePath(projectId,row.inputPath||row.fidPath,true);
 if(extname(path).toLowerCase()==='.zip')return service.materializeNmrInput(projectId,id,path);
 const info=await stat(path);
 if(info.isDirectory())return await service.findNmrDatasetRoot(path)||Promise.reject(Error('未找到 FID 数据'));
 if(row.inputSha256&&hash(await readFile(path))!==row.inputSha256)throw Error('输入核磁文件已改变，请重新登记');
 return path;
}

export async function nmrFolderPath(service,id,projectId){
 const row=service.table.get(id)||service.ctx.root?.get?.("labNmr").listDatasets().find(entry=>entry.id===id);
 if(!row||row.projectId!==projectId||row.kind&&row.kind!=='nmr')throw Error('条目不属于当前课题');
 const output=row.artifacts?.spectrum?.path||row.spectrumPath||row.artifacts?.report?.path||row.reportPath;
 const path=output?await service.filePath(projectId,output):row.inputPath||row.fidPath?await nmrOpenPath(service,id,projectId,'raw'):await service.filePath(projectId,row.structurePath);
 return (await stat(path)).isDirectory()?path:dirname(path);
}
