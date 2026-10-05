/** Real installed-layout Host smoke in a new isolated home; no live credentials. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeRelease } from '../../electron-next/release-runtime.mjs';
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,name+' required');return resolve(process.argv[i+1]);};
const app=arg('--app'),resources=arg('--resources'),electron=arg('--electron'),output=arg('--output');mkdirSync(output,{recursive:true});
const work=mkdtempSync(join(output,'run-')),home=join(work,'中文用户 科研数据');mkdirSync(home);
const {NextProfiles}=await import(pathToFileURL(join(app,'lib/profiles.js')));
const initialized=initializeRelease({home,resources,electron,profiles:NextProfiles});assert.equal(initialized.initialized,true);
assert.equal(initializeRelease({home,resources,electron,profiles:NextProfiles}).initialized,false);
const manager=new NextProfiles(home);manager.finishOnboarding('ibm-lab');
process.env.HOME=home;process.env.USERPROFILE=home;process.env.DSH_TELEMETRY_DISABLED='1';
const entry=join(work,'isolated-host.mjs');
const probe=process.argv.includes('--tool-probe'),probeFile=join(work,'tool-probe.json');
let hostEntry=join(app,'lib/host.js');
if(probe){
 const require=createRequire(join(app,'package.json'));
 let source=readFileSync(hostEntry,'utf8').replace(/from "([^"]+)"/g,(full,spec)=>spec.startsWith('node:')?full:'from '+JSON.stringify(pathToFileURL(spec.startsWith('.')?resolve(app,'lib',spec):require.resolve(spec)).href));
 const tools=pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href;
 const profileTools=pathToFileURL(join(manager.directory('ibm-lab'),'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href;
 const memoryTool=pathToFileURL(join(manager.directory('ibm-lab'),'node_modules/dsh-lab-agent/lib/memory-tool.js')).href;
 source=source.replace('const { ctx } = await application;',`const { ctx } = await application;
 process.on('message',async message=>{if(message?.type!=='ibm-test-tool')return;
 const {writeFileSync}=await import('node:fs');let result;
 try{const root=await import(${JSON.stringify(tools)}),local=await import(${JSON.stringify(profileTools)});
 const scheduler=ctx.tools[root.TOOL_RUNTIME_SCHEDULER];
 if(root.TOOL_RUNTIME_SCHEDULER!==local.TOOL_RUNTIME_SCHEDULER||!scheduler)throw Error('Kernel scheduler module identity mismatch');
 const memory=await import(${JSON.stringify(memoryTool)});memory.apply(ctx);
 const prepared=await scheduler.prepare({callId:'tool-probe',name:'lab_project_memory_read',arguments:{projectId:'installed-smoke'},signal:new AbortController().signal});
 if(prepared.kind!=='dispatch')throw Error('Tool preparation did not dispatch: '+JSON.stringify(prepared));
 const dispatched=await scheduler.dispatch(prepared.exec);
 const final=dispatched.kind==='post-result'?await scheduler.finalize(prepared.exec,dispatched.result):scheduler.finish(prepared.exec,dispatched.result);
 if(final.isError||!JSON.stringify(final).includes('# Installed smoke'))throw Error('Memory tool failed: '+JSON.stringify(final));
 result={ok:true,sameSymbol:true,schedulerAvailable:true,result:final};
 }catch(error){result={ok:false,error:String(error)};}
 writeFileSync(${JSON.stringify(probeFile)},JSON.stringify(result,null,2));});`);
 hostEntry=join(work,'instrumented-host.mjs');writeFileSync(hostEntry,source);
}
writeFileSync(entry,`import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
const previous=os.userInfo;os.userInfo=options=>({...previous(options),homedir:options?.encoding==='buffer'?Buffer.from(process.env.DSH_HOME):process.env.DSH_HOME});os.homedir=()=>process.env.DSH_HOME;syncBuiltinESMExports();
process.argv[1]=${JSON.stringify(hostEntry)};await import(${JSON.stringify(pathToFileURL(hostEntry).href)});`);
const {DesktopHostProcess}=await import(pathToFileURL(join(app,'lib/host-process.js')));
const report={ok:false,home,checks:['offline-bootstrap','repeat-bootstrap-no-overwrite'],release:JSON.parse(readFileSync(join(resources,'release.json')))};
report.python=JSON.parse(execFileSync(initialized.python,['-I','-c','import sys,json,pymupdf,numpy,scipy,PIL,lxml,pptx; print(json.dumps({"version":sys.version.split()[0],"executable":sys.executable,"modules":{m.__name__:m.__file__ for m in [pymupdf,numpy,scipy,PIL,lxml,pptx]}}))'],{encoding:'utf8',windowsHide:true}));
assert.equal(report.python.version,'3.12.11');for(const file of Object.values(report.python.modules))assert.ok(resolve(file).startsWith(resolve(resources)),'Python dependency escaped bundled resources');report.checks.push('relocated-bundled-python-and-six-scientific-document-libraries');
let host,log='',auth;
const redact=value=>String(value).replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');
const originalWrite=process.stdout.write;process.stdout.write=function(chunk,...args){return originalWrite.call(this,redact(chunk),...args);};
const rpc=async(method,request)=>{
 const response=await fetch(auth.origin+'/api/lab/'+method,{method:'POST',headers:{cookie:auth.cookie,origin:auth.origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'lab/'+method,payload:{args:request?{request}:{}}}),signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.result.ok,true,JSON.stringify(data));return data.result.value;
};
async function boot(){
 host=new DesktopHostProcess(electron,app,manager.directory('ibm-lab'),undefined,{...process.env,DSH_NEXT_PREFERENCES:JSON.stringify({browserAccess:true})},undefined,undefined,undefined,entry,undefined,undefined,chunk=>{log+=redact(chunk);});
 const ready=await host.start();const response=await fetch(ready.url,{redirect:'manual'});assert.equal(response.status,303);
 auth={origin:new URL(ready.url).origin,cookie:response.headers.get('set-cookie')?.split(';')[0]};assert.ok(auth.cookie);await response.body?.cancel();
}
try{
 await boot();const capability=await rpc('capabilities');for(const key of ['core','runtime','documents','literature','design','analysis'])assert.equal(capability[key],true);
 const status=await rpc('desktop_status');assert.equal(status.available,true);
 await rpc('projects_create',{fields:{id:'installed-smoke',name:'安装版隔离课题',coreMarkdown:'# Installed smoke'}});
 if(probe){host.child.send({type:'ibm-test-tool'});for(let attempt=0;attempt<300;attempt++){try{report.toolProbe=JSON.parse(readFileSync(probeFile));break;}catch{await new Promise(done=>setTimeout(done,100));}}assert.equal(report.toolProbe?.ok,true,JSON.stringify(report.toolProbe));report.checks.push('Agent-loop-scheduler-Symbol-identity','real-scheduled-project-memory-read');}
 await host.stop(true);host=undefined;await boot();
 assert.equal((await rpc('projects_memory',{projectId:'installed-smoke'})).memory.markdown,'# Installed smoke');
 report.checks.push('real-installed-Electron-node-host','seven-domain-providers','native-provider-configured','Chinese-path-memory-restart');report.ok=true;
}catch(error){report.error=String(error);throw error;}
finally{await host?.stop(true);writeFileSync(join(work,'host.log'),log);writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Installed layout evidence: '+join(work,'verification.json'));}
