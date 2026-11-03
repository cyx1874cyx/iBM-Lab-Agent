import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../../scripts/runtime/mnova_job.py',import.meta.url));
export function runMnovaJob(config,tool,args,{spawnImpl,signal,timeoutMs=360000}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(config.command,['-I',script,tool,JSON.stringify(args)],{cwd:config.cwd,env:config.env});
  let stdout='',stderr='',settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
  const abort=()=>{child.kill();finish(signal.reason||Error('核磁分析已终止'));};
  const timer=setTimeout(()=>{child.kill();finish(Error('Mnova 调用超时，已停止本次分析'));},timeoutMs);
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>8*1024*1024){child.kill();finish(Error('Mnova 返回结果过大'));}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
  child.once('error',error=>finish(error));
  child.once('close',code=>{
   if(settled)return;
   try{const payload=JSON.parse(stdout.trim());if(!payload.ok)throw Error(payload.error||'Mnova 调用失败');if(code!==0)throw Error('Mnova 退出码 '+code);finish(null,payload.result);}
   catch(error){finish(Error(stdout.trim()?error.message:stderr.trim()||'Mnova 未返回结果'));}
  });
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
