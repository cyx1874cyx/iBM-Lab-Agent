/** Two actual conversations, native sidebar guests and Agent capture queue; isolated fixtures only. */
/* global document */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { initializeRelease } from '../../electron-next/release-runtime.mjs';

const arg = name => { const index = process.argv.indexOf(name);assert.ok(index >= 0 && process.argv[index + 1], name + ' required');return resolve(process.argv[index + 1]); };
const app=arg('--app'),resources=arg('--resources'),executable=arg('--executable'),output=arg('--output');
mkdirSync(output,{recursive:true});const work=mkdtempSync(join(output,'run-')),home=join(work,'同课题 对话验收');
const pdf=Buffer.from('%PDF-1.4\n/Type /Page\nSESSION ROUTING FIXTURE\n'+' '.repeat(200000)+'\n%%EOF');
const server=createServer((req,res)=>{
 if(req.url.startsWith('/file')){res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="session-fixture.pdf"','content-length':pdf.length});res.end(pdf);}
 else{res.writeHead(200,{'content-type':'text/html','set-cookie':'ibm_session_fixture=retained; Path=/; Max-Age=3600'});res.end('<title>SESSION PUBLISHER</title><h1>SESSION PUBLISHER</h1><button onclick="window.open(\'/file.pdf\')">Download PDF</button>');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const {NextProfiles}=await import(pathToFileURL(join(app,'lib/profiles.js')));
initializeRelease({home,resources,electron:executable,profiles:NextProfiles});const profiles=new NextProfiles(home);profiles.finishOnboarding('ibm-lab');profiles.dismissAccountSetup('ibm-lab');
if(process.argv.includes('--development-root')){
 const repo=arg('--development-root'),agent=join(profiles.directory('ibm-lab'),'node_modules/dsh-lab-agent');
 for(const path of ['lib/scientific-desktop.js','lib/manual-capture.js','lib/tasks-tool.js','src/manual-capture.js'])copyFileSync(join(repo,path),join(agent,path));
 copyFileSync(join(repo,'packages/dsh-lab-ui/client/index.js'),join(profiles.directory('ibm-lab'),'node_modules/dsh-lab-ui/client/index.js'));
}
const fixture=join(profiles.directory('ibm-lab'),'node_modules/dsh-sidebar-session-fixture');mkdirSync(fixture,{recursive:true});
writeFileSync(join(fixture,'package.json'),JSON.stringify({name:'dsh-sidebar-session-fixture',version:'1.0.0',type:'module',main:'index.js',exports:{'.':'./index.js','./client':'./client.js','./package.json':'./package.json'},dsh:{client:{inject:['@deepseek-ai/dsh-client-ui-session','@deepseek-ai/dsh-client-ui-workspace','@deepseek-ai/dsh-client-ui-sidebar'],platform:'web'}}}));
const commandFile=join(work,'capture-command.json'),resultFile=join(work,'capture-result.json');
writeFileSync(join(fixture,'index.js'),`import {existsSync,readFileSync,writeFileSync} from 'node:fs';
export const inject=['ibmCore','ibmScientificDesktop','labCapture'];export async function apply(ctx){
 if(!ctx.ibmCore.getProject('session-project'))await ctx.ibmCore.createProject({id:'session-project',name:'同课题对话验收'});
 for(const id of ['session-pdf','session-si'])if(!ctx.ibmCore.getArtifact('source-bundle',id))await ctx.ibmCore.commitSourceBundle({id,projectId:'session-project',title:'Fixture '+id,doi:'10.1038/fixture-'+id,status:'succeeded',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 ctx.ibmScientificDesktop.config.portal=${JSON.stringify(origin)};
 const navigate=ctx.ibmScientificDesktop.navigate.bind(ctx.ibmScientificDesktop);
 ctx.ibmScientificDesktop.navigate=(lease,url)=>navigate(lease,url.startsWith('https://doi.org/10.1038/fixture-')?${JSON.stringify(origin+'/paper')}:url);
 let sequence=0;const timer=setInterval(()=>{if(!existsSync(${JSON.stringify(commandFile)}))return;let input;try{input=JSON.parse(readFileSync(${JSON.stringify(commandFile)},'utf8'));}catch{return;}if(input.sequence<=sequence)return;sequence=input.sequence;
  ctx.labCapture.createAgentCaptureTask({projectId:'session-project',bundleId:input.bundleId,kind:input.kind,sessionId:input.sessionId}).then(task=>writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({sequence,task})),error=>writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({sequence,error:error.message})));
 },100);ctx.effect(()=>()=>clearInterval(timer),'session capture fixture');
}`);
writeFileSync(join(fixture,'client.js'),`window.__ModuleLoader__.load({id:'dsh-sidebar-session-fixture',factory:()=>({inject:['sessions','workspaces','uiWorkspace','sidebarRight'],apply(ctx){globalThis.ibmSidebarSessionFixture={create:workspaceId=>ctx.sessions.create({workspaceId}),select:id=>ctx.uiWorkspace.openSession(id),state:()=>({current:Object.values(ctx.sessions.list.getSnapshot().byId).find(row=>(row.retainedBy?.mainView??0)>0)?.id,mounted:ctx.sidebarRight.mounted.getSnapshot(),workspaces:ctx.workspaces.list.getSnapshot().items})};ctx.effect(()=>()=>delete globalThis.ibmSidebarSessionFixture,'fixture teardown');}})});`);
const patch=join(profiles.directory('ibm-lab'),'cordis.patch.yml');writeFileSync(patch,readFileSync(patch,'utf8').replace(/^\[\]\s*$/m,'')+"\n- insert:\n    - id: session-fixture\n      name: 'dsh-sidebar-session-fixture'\n");
const report={ok:false,home,checks:[],rendererErrors:[],scope:'Official NEXT conversations and sidebar, actual capture/download/archive; synthetic publisher, no model or institution credentials.'};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const wait=async(fn,label)=>{for(let i=0;i<600;i++){const value=await fn();if(value)return value;await delay(100);}throw Error('Timed out: '+label);};
let child,browser,page,frame,log='';
const rpc=(method,request)=>frame.evaluate(async(method,request)=>{
 const response=await fetch('/api/lab/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'lab/'+method,payload:{args:{request}}})});const result=await response.json();if(!result.result?.ok)throw Error(JSON.stringify(result));return result.result.value;
},method,request);
const state=()=>frame.evaluate(()=>globalThis.ibmSidebarSessionFixture.state());
try{
 let endpoint;
 child=spawn(executable,[...(process.argv.includes('--packaged')?[]:[app]),'--remote-debugging-port=0'],{env:{...process.env,DSH_HOME:home,DSH_DESKTOP_NEXT_HOME:home,ELECTRON_RUN_AS_NODE:undefined,DSH_TELEMETRY_DISABLED:'1',IBM_SIDEBAR_TEST_ORIGINS:JSON.stringify([origin])},windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const value=String(chunk);endpoint??=value.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];log+=value.replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');});
 await wait(()=>{if(child.exitCode!==null)throw Error('Desktop exited: '+child.exitCode);return endpoint;},'desktop debug endpoint');
 browser=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null});
 const observed=new Set();await wait(async()=>{for(const candidate of await browser.pages()){
  if(!observed.has(candidate)){observed.add(candidate);candidate.on('pageerror',error=>report.rendererErrors.push(error.message));}
  for(const current of candidate.frames())if(await current.$('.ib-hero-chip').catch(()=>false)){page=candidate;frame=current;}
 }return frame;},'research entry');
 await frame.waitForFunction(()=>!!globalThis.ibmSidebarSessionFixture);
 await frame.click('.ib-hero-chip');await frame.waitForFunction(()=>[...document.querySelectorAll('.ib-hero-menu-item')].some(node=>node.innerText.includes('同课题对话验收')));
 await frame.evaluate(()=>[...document.querySelectorAll('.ib-hero-menu-item')].find(node=>node.innerText.includes('同课题对话验收')).click());
 const binding=await wait(async()=>{const value=(await rpc('projects_binding',{projectId:'session-project'})).binding;return value?.sessionIds?.length?value:false;},'initial project conversation');
 const old=binding.sessionIds.at(-1);await wait(async()=>(await state()).current===old,'initial conversation');
 await rpc('desktop_browser',{action:'open',projectId:'session-project',sessionId:old});
 const oldWindow=(await rpc('desktop_browser',{action:'status',projectId:'session-project',sessionId:old})).window;
 await frame.waitForFunction(contentsId=>[...document.querySelectorAll('webview')].some(view=>{try{return view.getWebContentsId()===contentsId&&view.getURL().startsWith('http://127.0.0.1:');}catch{return false;}}),{},oldWindow.contentsId);
 report.oldSession=old;report.checks.push('older-project-conversation-has-existing-native-browser');
 for(const [sequence,bundleId,kind] of [[1,'session-pdf','pdf'],[2,'session-si','si']]){
  const fresh=await frame.evaluate(workspaceId=>globalThis.ibmSidebarSessionFixture.create(workspaceId),binding.workspaceId);assert.notEqual(fresh,old);
  await frame.evaluate(id=>globalThis.ibmSidebarSessionFixture.select(id),fresh);await wait(async()=>(await state()).current===fresh,'new conversation');
  assert.equal((await rpc('projects_binding',{projectId:'session-project'})).binding.sessionIds.includes(fresh),false,'fixture must reproduce the missing new conversation in historical project bindings');
  writeFileSync(commandFile,JSON.stringify({sequence,sessionId:fresh,bundleId,kind}));
  const started=await wait(()=>{try{const value=JSON.parse(readFileSync(resultFile,'utf8'));if(value.sequence===sequence){if(value.error)throw Error(value.error);return value.task;}}catch(error){if(!['ENOENT'].includes(error.code)&&error.name!=='SyntaxError')throw error;}return false;},'Agent capture task');
  assert.equal(started.sessionId,fresh);
  const active=await wait(async()=>{const value=(await rpc('desktop_browser',{action:'status',projectId:'session-project',sessionId:fresh}));return value.window&&value.capture?.pendingTaskId===started.id?value:false;},'native browser in initiating conversation');
  assert.notEqual(active.window.lease,oldWindow.lease);assert.equal((await state()).current,fresh);
  const viewInfo=await frame.evaluate(contentsId=>{const view=[...document.querySelectorAll('webview')].find(view=>{try{return view.getWebContentsId()===contentsId;}catch{return false;}});return {visible:view.checkVisibility(),bounds:view.getBoundingClientRect().toJSON(),partition:view.getAttribute('partition')};},active.window.contentsId);
  assert.ok(viewInfo.visible&&viewInfo.bounds.width>100&&viewInfo.bounds.height>100);assert.ok(viewInfo.partition.startsWith('persist:ibm-sidebar-'));
  assert.equal((await rpc('desktop_browser',{action:'open',projectId:'session-project',sessionId:fresh})).lease,active.window.lease);assert.equal((await state()).current,fresh);
  const cookie=await frame.evaluate(contentsId=>[...document.querySelectorAll('webview')].find(view=>{try{return view.getWebContentsId()===contentsId;}catch{return false;}}).executeJavaScript('document.cookie'),active.window.contentsId);assert.match(cookie,/ibm_session_fixture=retained/);
  await frame.evaluate(contentsId=>[...document.querySelectorAll('webview')].find(view=>{try{return view.getWebContentsId()===contentsId;}catch{return false;}}).executeJavaScript('document.querySelector("button").click()',true),active.window.contentsId);
  const completed=await wait(async()=>{const task=(await rpc('manual_capture_get',{taskId:started.id})).task;return task?.status==='completed'?task:false;},'real download archive');
  assert.equal(completed.size,pdf.length);assert.equal(completed.sessionId,fresh);assert.equal((await state()).current,fresh);
  await page.screenshot({path:join(work,`session-${sequence}-sidebar.png`)});
  report.checks.push(kind+'-Agent-capture-remains-in-initiating-new-conversation',kind+'-reopen-preserves-new-conversation-native-guest',kind+'-download-archives-with-original-conversation-id');
 }
 assert.deepEqual(report.rendererErrors,[]);report.ok=true;
}catch(error){
 report.error=String(error);report.failureState=await state().catch(()=>undefined);if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});
 if(frame)report.failureText=await frame.evaluate(()=>document.body.innerText.slice(0,6000)).catch(()=>undefined);
 throw error;
}finally{
 await browser?.close().catch(()=>{});if(child)await wait(()=>child.exitCode!==null,'desktop shutdown').catch(()=>child.kill());
 await new Promise(done=>server.close(done));writeFileSync(join(work,'desktop.log'),log);writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Sidebar session evidence: '+join(work,'verification.json'));
}
