import {Worker} from 'node:worker_threads';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {simulationParameters,simulationJcamp} from 'dsh-lab-agent/nmr/simulation';
import {NMR_STRUCTURE_EXTENSIONS} from './intake.js';

export function inspectNmrStructure(input,{timeoutMs=60000}={}){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./structure-worker.js',import.meta.url),{workerData:input,execArgv:[]});
  const timer=setTimeout(()=>{void worker.terminate();reject(Error('结构解析超时，请简化结构后重试'));},timeoutMs);
  let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);};
  worker.once('message',message=>finish(message.error?Error(message.error):null,message.result));
  worker.once('error',error=>finish(error));
  worker.once('exit',code=>{if(code!==0)finish(Error('结构解析进程退出'));});
 });
}
export async function simulationStructure(service,request){
 const {projectId}=request;
 if(!service.ctx.ibmCore.getProject(projectId))throw Error('课题不存在');
 const task=request.taskId?service.get(request.taskId,projectId):null;
 if(task&&task.kind!=='nmr')throw Error('条目不是核磁条目');
 if(task)request={...request,structurePath:task.structurePath,smiles:task.compound?.smiles,title:task.title};
 const parameters=simulationParameters(request.parameters);
 let source=request.smiles?.trim(),format='smiles';
 if(request.structurePath){
  const path=await service.filePath(projectId,request.structurePath);
  format=extname(path).toLowerCase().slice(1);
  if(!NMR_STRUCTURE_EXTENSIONS.has('.'+format))throw Error('请选择核磁解析支持的结构文件');
  if((await stat(path)).size>5*1024*1024)throw Error('结构文件不得超过 5 MB');
  const bytes=await readFile(path);if(task?.structureSha256&&createHash('sha256').update(bytes).digest('hex')!==task.structureSha256)throw Error('输入结构已改变，请重新登记');source=bytes.toString(format==='cdx'?'base64':'utf8');
 }
 if(!source||source.length>7*1024*1024)throw Error('请上传分子结构式或输入 SMILES');
 if(['smi','smiles'].includes(format)){
  const lines=source.trim().split(/\r?\n/).filter(x=>x.trim());
  if(lines.length!==1)throw Error('SMILES 文件应只包含一个分子');source=lines[0].trim().split(/\s+/)[0];
 }
 const result=await inspectNmrStructure({source,format,parameters,peakModel:request.peakModel});
 return {result,task,request};
}
export async function createNmrSimulation(service,request){
 if(!request.peakModel)throw Error('请先提供科研助手构建的峰模型；旧自动预测器已停用');
 const {result,task,request:normalized}=await simulationStructure(service,request),{projectId}=request;
 request=normalized;
 const workspace=await service.ctx.ibmCore.ensureProjectWorkspace(projectId),id='synthetic-'+randomUUID();
 const directory=join(workspace.path,'nmr-simulations',id);await mkdir(directory,{recursive:true});
 await service.filePath(projectId,directory,true);
 Object.assign(result,{id,projectId,taskId:task?.id,title:String(request.title||result.formula).slice(0,200),createdAt:new Date().toISOString()});
 await writeFile(join(directory,'synthetic-spectrum.svg'),result.svg);
 await writeFile(join(directory,'synthetic-spectrum.jdx'),simulationJcamp(result));
 await writeFile(join(directory,'synthetic-structure.svg'),result.structureSvg);
 await writeFile(join(directory,'synthetic-structure.mol'),result.molfile);
 await writeFile(join(directory,'synthetic-spectrum.csv'),'ppm,intensity\n'+result.spectrum.points.map(p=>p.join(',')).join('\n'));
 await writeFile(join(directory,'synthetic-peaks.csv'),'label,ppm,relative_atom_count,attached_atom_ids,multiplicity,j_hz\n'+result.peaks.map(p=>[p.label,p.ppm,p.area,p.attachedAtomIds.join(';'),p.multiplicity,p.jHz].join(',')).join('\n'));
 await writeFile(join(directory,'synthetic-model.json'),JSON.stringify(result,null,2));
 return result;
}
export async function registerSimulationMnova(service,projectId,taskId,result,path){
 return service.serial(taskId,async()=>{
  const row=service.get(taskId,projectId);if(row.kind!=='nmr')throw Error('条目不是核磁条目');
  const checked=await service.filePath(projectId,path),bytes=await readFile(checked);
  if(extname(checked).toLowerCase()!=='.mnova'||!bytes.length)throw Error('Mnova 未生成有效文档');
  const artifact={path:checked,fileName:'synthetic.mnova',sha256:(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length};
  await service.table.put(taskId,{...row,simulationArtifact:artifact,simulationId:result.id,updatedAt:new Date().toISOString()});
  return artifact;
 });
}
export async function listNmrSimulations(service,projectId){
 if(!service.ctx.ibmCore.getProject(projectId))throw Error('课题不存在');
 const workspace=await service.ctx.ibmCore.ensureProjectWorkspace(projectId),directory=join(workspace.path,'nmr-simulations');
 let entries;try{entries=await readdir(directory);}catch(error){if(error.code==='ENOENT')return {simulations:[]};throw error;}
 const simulations=[];
 for(const id of entries.filter(x=>/^synthetic-[a-f0-9-]{36}$/.test(x))){
  try{const path=await service.filePath(projectId,join(directory,id,'synthetic-model.json'));const row=JSON.parse(await readFile(path,'utf8'));if(row.projectId===projectId&&row.synthetic===true)simulations.push(row);}catch{/* Ignore incomplete writes; never expose foreign paths. */}
 }
 return {simulations:simulations.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
}
