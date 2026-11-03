import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../../scripts/runtime/plot_session.py',import.meta.url));
export function createPlotSession(config,spawnImpl){
 const child=spawnImpl(config.command,['-I',script],{cwd:config.cwd,env:config.env});let buffer='',pending=null,closed=false,tail=Promise.resolve();
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const fail=error=>{closed=true;if(pending){pending.reject(error);pending=null;}};
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{continue;}if(value.event)continue;const job=pending;pending=null;if(job)value.ok?job.resolve(value.result):job.reject(Error(value.error||'Origin 会话失败'));}});
 child.stderr.on('data',()=>{});child.once('error',fail);child.once('close',()=>fail(Error('Origin 绘图会话已关闭')));
 return {get closed(){return closed;},close:()=>new Promise(resolve=>{if(closed){resolve();return;}closed=true;const timer=setTimeout(()=>{child.kill();resolve();},5000);child.once('close',()=>{clearTimeout(timer);resolve();});child.stdin.write(JSON.stringify({close:true})+'\n');}),run(args,{signal,timeoutMs=180000}={}){
  const execute=async()=>{signal?.throwIfAborted();if(closed)throw Error('Origin 绘图会话已关闭');return new Promise((resolve,reject)=>{let timer;const abort=()=>{child.kill();fail(signal?.reason||Error('Origin 会话超时'));};const finish=fn=>value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};pending={resolve:finish(resolve),reject:finish(reject)};timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});child.stdin.write(JSON.stringify({args})+'\n');});};
  const result=tail.then(execute);tail=result.catch(()=>{});return result;
 }};
}
