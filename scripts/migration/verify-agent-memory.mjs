/** Real installed-layout Host smoke in a new isolated home; no live credentials. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeRelease } from '../../electron-next/release-runtime.mjs';
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,name+' required');return resolve(process.argv[i+1]);};
const app=arg('--app'),resources=arg('--resources'),electron=arg('--electron'),output=arg('--output');mkdirSync(output,{recursive:true});
const work=mkdtempSync(join(output,'run-')),home=join(work,'中文用户 科研数据');mkdirSync(home);
const previousIndex=process.argv.indexOf('--previous-home');
if(previousIndex>=0){const previous=resolve(process.argv[previousIndex+1]);cpSync(previous,home,{recursive:true,dereference:false,verbatimSymlinks:true,filter:path=>path!==join(previous,'profiles','node_modules')});}
const previousMarker=previousIndex>=0?createHash('sha256').update(readFileSync(join(home,'ibm-release.json'))).digest('hex'):undefined;
const {NextProfiles}=await import(pathToFileURL(join(app,'lib/profiles.js')));
const initialize=process.argv.includes('--legacy-bootstrap')?(await import(pathToFileURL(join(app,'release-runtime.mjs')))).initializeRelease:initializeRelease;
const initialized=initialize({home,resources,electron,profiles:NextProfiles});assert.equal(initialized.initialized,previousIndex<0);
const repeated=initialize({home,resources,electron,profiles:NextProfiles});assert.equal(repeated.initialized,false);if(repeated.plugins)assert.equal(repeated.plugins.updated.length,0);
if(previousMarker)assert.equal(createHash('sha256').update(readFileSync(join(home,'ibm-release.json'))).digest('hex'),previousMarker);
const manager=new NextProfiles(home);manager.finishOnboarding('ibm-lab');
process.env.HOME=home;process.env.USERPROFILE=home;process.env.DSH_TELEMETRY_DISABLED='1';
const entry=join(work,'isolated-host.mjs');
const probe=process.argv.includes('--tool-probe'),probeFile=join(work,'tool-probe.json');
const recovery=process.argv.includes('--model-recovery');
const activityProbe=process.argv.includes('--activity-probe');
let hostEntry=join(app,'lib/host.js');
if(probe){
 const require=createRequire(join(app,'package.json'));
 let source=readFileSync(hostEntry,'utf8').replace(/from "([^"]+)"/g,(full,spec)=>spec.startsWith('node:')?full:'from '+JSON.stringify(pathToFileURL(spec.startsWith('.')?resolve(app,'lib',spec):require.resolve(spec)).href));
 const tools=pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href;
 const profileTools=pathToFileURL(join(manager.directory('ibm-lab'),'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href;
 source=source.replace('const { ctx } = await application;',`const { ctx } = await application;
 process.on('message',async message=>{if(message?.type!=='ibm-test-tool')return;
 const {writeFileSync}=await import('node:fs');let result;
 try{const root=await import(${JSON.stringify(tools)}),local=await import(${JSON.stringify(profileTools)});
 const scheduler=ctx.tools[root.TOOL_RUNTIME_SCHEDULER];
 if(!scheduler)throw Error('Host scheduler missing');
 if(root.TOOL_RUNTIME_SCHEDULER!==local.TOOL_RUNTIME_SCHEDULER)throw Error('Kernel scheduler module identity mismatch');
 const petUpdates=[];ctx.on('ibm/task-activity',()=>petUpdates.push(ctx.ibmCore.taskActivity()));
 if(${activityProbe})ctx.tools.register({name:'origin_export_fixture',description:'Isolated task activity probe',parameters:{},execute:async()=>{await new Promise(done=>setTimeout(done,150));return {ok:true};}});
 const llm=await import(${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)});let fixtureStep=0;class FixtureAdapter extends llm.LlmAdapter{async *stream(){if(${recovery}&&fixtureStep++===0){yield {type:'finish',reason:{kind:'error',failure:{code:'MALFORMED_RESPONSE',message:'DeepSeek Messages stream: tool input is invalid JSON'}}};return;}const block=fixtureStep++===${recovery?2:0}?{type:'tool-call',id:'loop-memory',name:'lab_project_memory_read',arguments:JSON.stringify({projectId:'installed-smoke'})}:{type:'text',text:'MEMORY TURN DONE'};yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};if(${activityProbe}&&block.type==='tool-call'){yield {type:'block-start',index:1,blockType:'tool-call'};yield {type:'block-end',index:1,block:{type:'tool-call',id:'loop-origin',name:'origin_export_fixture',arguments:'{}'}};}yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};}}
 ctx.llm.registerAdapter(['${recovery?'deepseek-fixture':'ibm-fixture'}'],new FixtureAdapter());
 let scopedAgent,scopedContext;const setup=async(agentCtx,agent)=>{await ctx.agentPresets.mount(agentCtx,'lab-research');scopedAgent=agent;scopedContext=agentCtx;};
 const agentOptions={provider:'${recovery?'deepseek-fixture':'ibm-fixture'}',model:'memory'};
 const handle=message.resume?await ctx.agents.resume({resumeSessionId:'agent-memory-probe',agentOptions,setup}):await ctx.agents.create({sessionId:'agent-memory-probe',agentOptions,meta:{cwd:ctx.ibmCore.requireProject('installed-smoke').workspacePath},setup});
 const scopedScheduler=scopedContext.tools[root.TOOL_RUNTIME_SCHEDULER];
 if(!scopedScheduler)throw Error('Agent scheduler missing; root='+Boolean(scheduler)+'; symbols='+Object.getOwnPropertySymbols(scopedContext.tools).map(s=>s.description).join(','));
 const prepared=await scopedScheduler.prepare({agent:scopedAgent,callId:'tool-probe',name:'lab_project_memory_read',arguments:{projectId:'installed-smoke'},signal:new AbortController().signal});
 if(prepared.kind!=='dispatch')throw Error('Tool preparation did not dispatch: '+JSON.stringify(prepared));
 const dispatched=await scopedScheduler.dispatch(prepared.exec);
 const final=dispatched.kind==='post-result'?await scopedScheduler.finalize(prepared.exec,dispatched.result):scopedScheduler.finish(prepared.exec,dispatched.result);
 if(final.isError||!JSON.stringify(final).includes('# Installed smoke'))throw Error('Memory tool failed: '+JSON.stringify(final));
 scopedAgent.followup(llm.createUserMessage({content:[{type:'text',text:'Read isolated memory'}],source:{kind:'user'}}));await scopedAgent.whenIdle();
 const events=scopedAgent.session.snapshotEvents(0);const end=events.filter(e=>e.type==='turn/end').at(-1);if(end?.data.reason.kind==='error'||!JSON.stringify(events).includes('# Installed smoke'))throw Error('Agent turn failed: '+JSON.stringify(events));
 if(${recovery}&&events.filter(e=>e.type==='assistant/attempt').length!== (message.resume?2:1))throw Error('Malformed-response recovery count mismatch');
 if(${activityProbe}&&!petUpdates.some(state=>state.tasks.some(row=>row.kind==='origin'&&row.status==='running')))throw Error('Real scoped tool execution did not publish task activity');
 if(${activityProbe}&&ctx.ibmCore.taskActivity().tasks.some(row=>row.status==='running'))throw Error('Completed Agent turn left an active pet task');
 result={ok:true,sameSymbol:true,schedulerAvailable:true,resumed:Boolean(message.resume),completedTurns:events.filter(e=>e.type==='turn/end'&&e.data.reason.kind==='completed').length,result:final,agentTurn:events,petUpdates};
 }catch(error){result={ok:false,error:String(error)};}
 writeFileSync(${JSON.stringify(probeFile)},JSON.stringify(result,null,2));});`);
 hostEntry=join(work,'instrumented-host.mjs');writeFileSync(hostEntry,source);
}
writeFileSync(entry,`import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
const previous=os.userInfo;os.userInfo=options=>({...previous(options),homedir:options?.encoding==='buffer'?Buffer.from(process.env.DSH_HOME):process.env.DSH_HOME});os.homedir=()=>process.env.DSH_HOME;syncBuiltinESMExports();
process.argv[1]=${JSON.stringify(hostEntry)};await import(${JSON.stringify(pathToFileURL(hostEntry).href)});`);
const {DesktopHostProcess}=await import(pathToFileURL(join(app,'lib/host-process.js')));
const report={ok:false,home,checks:['offline-bootstrap','repeat-bootstrap-no-overwrite'],release:JSON.parse(readFileSync(join(resources,'release.json')))};
report.kernel=initialized.kernel;report.repairedPreviousHome=previousIndex>=0;
report.plugins=initialized.plugins;
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
async function runProbe(resume=false){
 rmSync(probeFile,{force:true});host.child.send({type:'ibm-test-tool',resume});
 let result;for(let attempt=0;attempt<300;attempt++){try{result=JSON.parse(readFileSync(probeFile));break;}catch{await new Promise(done=>setTimeout(done,100));}}
 assert.equal(result?.ok,true,JSON.stringify(result));return result;
}
try{
 await boot();const capability=await rpc('capabilities');for(const key of ['core','runtime','documents','literature','design','analysis'])assert.equal(capability[key],true);
 const status=await rpc('desktop_status');assert.equal(status.available,true);
 if(previousIndex<0)await rpc('projects_create',{fields:{id:'installed-smoke',name:'安装版隔离课题',coreMarkdown:'# Installed smoke'}});
 else{assert.equal((await rpc('projects_memory',{projectId:'installed-smoke'})).memory.markdown,'# Installed smoke');report.checks.push('old-profile-v1-memory-and-bootstrap-marker-preserved','old-kernel-copies-backed-up');}
 if(probe){report.toolProbe=await runProbe();assert.equal(report.toolProbe.completedTurns,1);report.checks.push('Agent-loop-scheduler-Symbol-identity','full-Agent-turn-project-memory-read');}
 await host.stop(true);host=undefined;await boot();
 assert.equal((await rpc('projects_memory',{projectId:'installed-smoke'})).memory.markdown,'# Installed smoke');
 if(probe){report.resumedToolProbe=await runProbe(true);assert.equal(report.resumedToolProbe.completedTurns,2);report.checks.push('resumed-persisted-session-full-Agent-memory-turn');}
 report.checks.push('real-installed-Electron-node-host','seven-domain-providers','native-provider-configured','Chinese-path-memory-restart');report.ok=true;
}catch(error){report.error=String(error);throw error;}
finally{try{await host?.stop(true);}catch(error){report.shutdownError=String(error);report.ok=false;process.exitCode=1;}writeFileSync(join(work,'host.log'),log);writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Installed layout evidence: '+join(work,'verification.json'));}
