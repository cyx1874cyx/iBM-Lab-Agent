import {realpath,mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveOfficeKit} from '../scripts/render-deck.mjs';

const helper=fileURLToPath(new URL('../scripts/render-deck.mjs',import.meta.url));
function inside(root,path){const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'));}
export async function renderDeckJob({workspace,input,dpi=110,pages='',sheetCols=3},{spawnImpl,signal,env=process.env}={}){
 if(!workspace||!isAbsolute(workspace))throw Error('渲染需要当前会话的绝对工作区路径');
 if(!Number.isInteger(dpi)||dpi<50||dpi>200)throw Error('dpi 必须为 50–200 的整数');
 if(!Number.isInteger(sheetCols)||sheetCols<1||sheetCols>6)throw Error('sheetCols 必须为 1–6 的整数');
 if(typeof pages!=='string'||pages.length>200||!/^\s*(?:\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)?\s*$/.test(pages))throw Error('pages 必须为页码列表，如 1,3,5-7');
 for(const chunk of pages.split(',')){const range=chunk.trim().split('-').map(Number);if(chunk.trim()&&(range.some(n=>n<1||n>300)||Math.abs((range[1]??range[0])-range[0])>299))throw Error('页码必须为 1–300');}
 const root=await realpath(workspace),source=await realpath(resolve(root,input));
 if(!inside(root,source))throw Error('仅能渲染当前会话工作区内的文件');
 if(!['.pptx','.ppt','.pdf'].includes(extname(source).toLowerCase()))throw Error('仅接受 PPT/PPTX/PDF');
 const temp=join(root,'.lab-tmp');
 await mkdir(temp,{recursive:true});
 const canonicalTemp=await realpath(temp);
 if(!inside(root,canonicalTemp))throw Error('工作区临时目录指向了工作区之外');
 const output=await mkdtemp(join(canonicalTemp,'ppt-review-'));
 const jobEnv={...env,IBM_LAB_AGENT_WORKSPACE:root,TMP:output,TEMP:output,TMPDIR:output};
 const kit=await resolveOfficeKit({env:jobEnv,probe:false});
 if(kit.cliPath)jobEnv.IBM_LAB_AGENT_OFFICE_KIT=kit.cliPath;
 const args=[helper,source,'--out',output,'--dpi',String(dpi),'--sheet-cols',String(sheetCols),'--json'];
 if(pages)args.push('--pages',pages);
 const result=await new Promise((settle,reject)=>{
  signal?.throwIfAborted();
  const child=spawnImpl(env.IBM_LAB_AGENT_BUNDLED_NODE||process.execPath,args,{cwd:root,env:jobEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',finished=false;
  const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):settle(value);};
  const abort=()=>{child.kill();finish(signal.reason??Error('渲染已取消'));};
  const timer=setTimeout(()=>{child.kill();finish(Error('PPT 渲染超时'));},360000);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>4*1024*1024){child.kill();finish(Error('渲染输出超过限制'));}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-65536);});
  child.once('error',error=>finish(error));
  child.once('close',code=>finish(null,{code,stdout,stderr}));
 });
 let payload;try{payload=JSON.parse(result.stdout);}catch{throw Error('官方渲染助手未返回有效结果：'+result.stderr.slice(-1000));}
 if(result.code!==0||!payload.ok||!payload.pages?.length||!payload.contactSheet)throw Error('官方渲染未完成逐页图片和总览图：'+(payload.errors??[]).join('；'));
 for(const path of [...payload.pages.map(page=>page.path),payload.contactSheet]){
  const canonical=await realpath(path);if(!inside(output,canonical))throw Error('渲染产物超出作业目录');
  const bytes=await readFile(canonical);if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('渲染产物不是有效 PNG');
 }
 return {...payload,renderHelper:helper,execution:'host-render-tool'};
}
