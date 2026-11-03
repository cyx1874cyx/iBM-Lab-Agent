import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,rm,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const script=fileURLToPath(new URL('../../scripts/runtime/plot_job.py',import.meta.url));
export async function runPlotJob(config,action,args,{spawnImpl,signal,onProgress,timeoutMs=180000}={}){
 signal?.throwIfAborted();
 const directory=await mkdtemp(join(tmpdir(),'ibm-plot-request-')),request=join(directory,'request.json');
 try{
 await writeFile(request,JSON.stringify(args),'utf8');signal?.throwIfAborted();
 return await new Promise((resolve,reject)=>{
  // Windows command lines are limited to 32K. Rich object specs travel in an
  // owned request file; stdin remains reserved for the process supervisor.
  const child=spawnImpl(config.command,['-I',script,action,'@'+request],{cwd:config.cwd,env:config.env});
  let stdout='',stderr='',settled=false,progress=Promise.resolve();
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
  const abort=()=>{child.kill();finish(signal.reason||Error('绘图操作已停止'));};
  const timer=setTimeout(()=>{child.kill();finish(Error('绘图操作超时，请检查 Origin 桥接后重试'));},timeoutMs);
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>3*1024*1024){child.kill();finish(Error('绘图返回数据过大'));return;}let newline;while((newline=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,newline).trim();if(!line){stdout=stdout.slice(newline+1);continue;}let value;try{value=JSON.parse(line);}catch{break;}if(value.event!=='plot-preview')break;stdout=stdout.slice(newline+1);if(onProgress)progress=progress.then(()=>onProgress(value.preview)).catch(()=>{});}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-3000);});
  child.once('error',error=>finish(error));
  child.once('close',code=>{if(settled)return;void progress.then(()=>{if(settled)return;try{const payload=JSON.parse(stdout.trim());if(!payload.ok)throw Error(payload.error||'绘图操作失败');if(code!==0)throw Error('绘图子进程退出码 '+code);finish(null,payload.result);}catch(error){finish(Error(stdout.trim()?error.message:stderr.trim()||'绘图未返回结果'));}});});
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
 }finally{await rm(request,{force:true});await rmdir(directory);}
}
