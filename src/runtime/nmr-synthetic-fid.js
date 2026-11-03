import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const script=fileURLToPath(new URL('../../vendor/mnova-mcp/skill/nmr-analyze-simulate/scripts/simulate_1d.py',import.meta.url));
export async function runSyntheticFid(python,modelPath,outputDir,{spawnImpl,signal,timeoutMs=120000}={}){
 const command=Array.isArray(python)?python:[python];if(!command[0])throw Error('没有可用的科学 Python 环境');
 signal?.throwIfAborted();
 await new Promise((resolve,reject)=>{
  const child=spawnImpl(command[0],[...command.slice(1),'-I',script,modelPath,'--output',outputDir,'--format','varian'],{cwd:outputDir.substring(0,Math.max(outputDir.lastIndexOf('/'),outputDir.lastIndexOf('\\'))),env:{MPLBACKEND:'Agg'}});
  let stderr='',settled=false;const done=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
  const abort=()=>{child.kill();done(signal.reason||Error('模拟已终止'));};
  const timer=setTimeout(()=>{child.kill();done(Error('模拟 FID 超时'));},timeoutMs);
  child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
  child.once('error',done);child.once('close',code=>done(code===0?null:Error('模拟 FID 生成失败：'+(stderr.trim()||'退出码 '+code))));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
 const metadata=JSON.parse(await readFile(join(outputDir,'simulation_metadata.json'),'utf8'));
 if(metadata.synthetic!==true||metadata.output_format!=='varian'||!Number.isFinite(metadata.varian_readback_max_abs_error)||!metadata.component_peak_verification?.length)throw Error('模拟 FID 未通过回读校验');
 return {fidPath:join(outputDir,'synthetic_1d.fid'),metadata};
}
