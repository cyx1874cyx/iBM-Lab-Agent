/** P1: real pinned NEXT Host + unchanged single iBM bundle, in a new isolated home. */
/* global document */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const arg = name => { const i=process.argv.indexOf(name); return i<0 ? undefined : process.argv[i+1]; };
const nextRepo = resolve(arg('--next-root') ?? (()=>{throw Error('--next-root required');})());
const output = resolve(arg('--output') ?? (()=>{throw Error('--output required');})());
const browserExe = arg('--browser');
const pythonRuntime=arg('--python-runtime');
const exerciseCore=process.argv.includes('--exercise-core');
const runtime = join(nextRepo,'dsh-desktop-next');
assert.equal(execFileSync('git',['-C',nextRepo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'838ba60fd79362087c0a0d134efee671c284786a');
assert.equal(JSON.parse(readFileSync(join(runtime,'package.json'))).version,'2.0.17-next');
assert.equal(JSON.parse(readFileSync(join(repo,'package.json'))).version,'0.5.8-rc.1');
const nextRequire = createRequire(join(runtime,'package.json'));
assert.equal(nextRequire('@deepseek-ai/dsh/package.json').version,'0.2.0-rc.2');
mkdirSync(output,{recursive:true});
const runDir=mkdtempSync(join(output,'run-'));
const home=join(runDir,'home'); mkdirSync(home);
process.env.DSH_HOME=home; process.env.HOME=home; process.env.USERPROFILE=home;
process.env.TEMP=join(runDir,'temp'); process.env.TMP=process.env.TEMP; mkdirSync(process.env.TEMP);
process.env.DSH_TELEMETRY_DISABLED='1';
const {NextProfiles,NEXT_PACKAGE}=await import(pathToFileURL(join(runtime,'lib/profiles.js')));
const {DesktopHostProcess}=await import(pathToFileURL(join(runtime,'lib/host-process.js')));
const {createPackageRunner,bundledPnpmEntry}=await import(pathToFileURL(join(runtime,'lib/extensions.js')));
const manager=new NextProfiles(home); const dir=manager.ensure('ibm-lab');
manager.setFeatures('ibm-lab',{remoteControl:false,market:false});
manager.finishOnboarding('ibm-lab');
const executable=process.argv.includes('--electron') ? nextRequire('electron') : process.execPath;
const runner=createPackageRunner({command:executable,args:['--expose-internals',bundledPnpmEntry(NEXT_PACKAGE)],env:{
 ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:executable,
 PATH:`${join(runtime,'scripts/node-bin')}${delimiter}${process.env.PATH}`,
}},dir);
let host,browser; const checks=[]; let hostLog='';
const redact=value=>String(value).replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');
const originalWrite=process.stdout.write;
process.stdout.write=function(chunk,...rest){return originalWrite.call(this,redact(chunk),...rest);};
const report={phase:exerciseCore?'P2':'P1',next:'2.0.17-next',kernel:'0.2.0-rc.2',ibm:'0.5.8-rc.1',mode:process.argv.includes('--electron')?'electron-node':'node',home,checks};
let auth;
async function launchBrowser(){
 const profile=join(runDir,'browser');mkdirSync(profile);
 if(process.platform!=='win32'||!/msedge\.exe$/i.test(browserExe))return puppeteer.launch({executablePath:browserExe,headless:true,userDataDir:profile});
 // Edge's compatibility launcher exits before its browser child is ready.
 const child=spawn(browserExe,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--disable-features=msEdgeFirstRunExperience','about:blank'],{windowsHide:true,stdio:'ignore'});child.unref();
 const active=join(profile,'DevToolsActivePort');
 for(let attempt=0;attempt<150;attempt++){
  if(existsSync(active))try{
   const port=Number(readFileSync(active,'utf8').split(/\r?\n/)[0]);
   if(Number.isInteger(port)&&port>0)return await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`,defaultViewport:{width:1360,height:900}});
  }catch(error){if(!['EBUSY','EPERM','EACCES','ENOENT'].includes(error.code))throw error;}
  await new Promise(resolveWait=>setTimeout(resolveWait,100));
 }
 throw Error('Isolated Edge did not expose its debug port');
}
async function closeBrowser(){
 if(!browser)return;
 await browser.close().catch(()=>{});browser=undefined;
 if(process.platform==='win32'&&/msedge\.exe$/i.test(browserExe)){
  // Edge can retain background children after its debugging connection closes.
  // Match only this freshly created profile; do not touch the user's browser.
  const profile=join(runDir,'browser').replaceAll("'","''");
  const command=`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${profile}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  execFileSync('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,stdio:'ignore'});
 }
 checks.push('isolated-browser-stopped');
}
const rpc=async (service,method,args={})=>{
 const response=await fetch(`${auth.origin}/api/${service}/${method}`,{method:'POST',headers:{cookie:auth.cookie,origin:auth.origin,'content-type':'application/json'},
 body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:`${service}/${method}`,payload:{args}}),signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,`${service}/${method} HTTP ${response.status}`);
 const reply=await response.json();assert.equal(reply.result.ok,true,JSON.stringify(reply));return reply.result.value;
};
async function boot(){
 host=new DesktopHostProcess(executable,runtime,dir,undefined,{...process.env,DSH_NEXT_PREFERENCES:JSON.stringify({browserAccess:true})},undefined,undefined,undefined,
 join(runtime,'scripts/fixtures/isolated-user-host.mjs'),undefined,undefined,chunk=>{hostLog+=chunk;});
 let timer; const ready=await Promise.race([host.start(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NEXT startup exceeded 90 seconds')),90000);})]).finally(()=>clearTimeout(timer));
 const url=new URL(ready.url);assert.equal(url.hostname,'127.0.0.1');
 const login=await fetch(url,{redirect:'manual'});assert.equal(login.status,303);
 auth={origin:url.origin,cookie:login.headers.get('set-cookie')?.split(';')[0]};assert.ok(auth.cookie);await login.body?.cancel();
 checks.push('real-host-ready');
 return ready.url;
}
try {
 console.log('Materializing pinned skill resources into the isolated home');
 const deployment=execFileSync(process.execPath,[join(repo,'scripts/install.mjs'),'--skip-python','--dsh-home',home],{cwd:repo,env:process.env,encoding:'utf8',timeout:180000,windowsHide:true});
 writeFileSync(join(runDir,'deployment.log'),deployment);checks.push('isolated-pinned-resources-deployed');
 if(pythonRuntime){
  const venv=resolve(pythonRuntime);const python=join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  assert.equal(execFileSync(python,['--version'],{encoding:'utf8'}).trim(),'Python 3.12.11');
  symlinkSync(venv,join(home,'lab-agent/.venv'),process.platform==='win32'?'junction':'dir');checks.push('exact-managed-python-linked');
 }
 console.log('Installing local single bundle through NEXT plugin runner');
 const install=runner.runPlugin(['add','--offline','--ignore-scripts',`link:${repo.replaceAll('\\','/')}`],repo);
 let installLog='';install.stdout.on('data',v=>{installLog+=v;});install.stderr.on('data',v=>{installLog+=v;});
 const result=await install.done;writeFileSync(join(runDir,'install.log'),installLog);assert.equal(result.exitCode,0,installLog);
 assert.ok(JSON.parse(readFileSync(join(dir,'package.json'))).dsh.profile.bundles.includes('dsh-lab-agent'));checks.push('official-plugin-install-activated');
 await runner.dispose();
 const url=await boot();
 const plugins=await rpc('pluginManager','listPlugins');assert.ok(plugins.some(p=>p.moduleName==='dsh-lab-agent'&&p.enabled));checks.push('bundle-enabled');
 const roster=await rpc('agentPresets','list');const preset=roster.presets.find(p=>p.id==='lab-research');assert.ok(preset);assert.equal(preset.broken,undefined,JSON.stringify(preset));checks.push('research-preset-healthy');
 assert.ok((await rpc('lab','note_templates_list',{request:{}})).templates);checks.push('lab-remote-request-contract');
 if(pythonRuntime){
  assert.equal((await rpc('lab','python_preflight')).preflight.ok,true);assert.equal((await rpc('lab','convert_available')).available.available,true);
  const converted=await rpc('lab','convert_upload',{request:{name:'p1-runtime.html',base64:Buffer.from('<html><body><h1>P1 scientific runtime</h1></body></html>').toString('base64')}});
  assert.equal(converted.result.run.status,'succeeded');assert.match(converted.result.text,/P1 scientific runtime/);checks.push('scientific-runtime-host-preflight-and-conversion');
 }
 const created=await rpc('lab','projects_create',{request:{fields:{id:'p1-prototype',name:'P1 兼容验证',goalProfileId:'default-prodrug-polymer',goalProfileVersion:'1',templateId:'nature-default',templateVersion:'1'}}});
 assert.equal(created.project.id,'p1-prototype');
 const updated=await rpc('lab','projects_memory_update',{request:{fields:{projectId:'p1-prototype',markdown:'# P1 核心记忆\n固定版本持久化验证',changeNote:'P1 smoke'}}});assert.equal(updated.memory.version,'2');checks.push('project-memory-write');
 const workspace=await rpc('lab','projects_ensure_workspace',{request:{projectId:'p1-prototype'}});
 const registered=await rpc('workspace','create',{request:{path:workspace.path}});const workspaceId=registered.workspace.workspaceId;
 assert.ok(workspaceId);
 const session=await rpc('session','create',{request:{workspaceId,agentPreset:'lab-research'}});assert.equal(session.agentPreset,'lab-research');
 await rpc('lab','projects_bind_session',{request:{projectId:'p1-prototype',sessionId:session.sessionId,workspaceId}});checks.push('research-session-created-and-bound');
 if(browserExe){
  const pageErrors=[];
  browser=await launchBrowser();
  const page=await browser.newPage();page.on('pageerror',e=>pageErrors.push(e.message));report.clientConsole=[];
  page.on('console',message=>report.clientConsole.push({type:message.type(),text:redact(message.text())}));
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.body.innerText.includes('课题'),{timeout:30000});
  await page.screenshot({path:join(runDir,'client.png'),fullPage:true});
  let defaultRoster;
  for(let attempt=0;attempt<25;attempt++){
   defaultRoster=await rpc('agentPresets','list');if(defaultRoster.presets.find(p=>p.id==='lab-research')?.isDefault)break;
   await new Promise(resolveWait=>setTimeout(resolveWait,200));
  }
  assert.ok(defaultRoster.presets.find(p=>p.id==='lab-research')?.isDefault,JSON.stringify(report.clientConsole));
  const defaultSession=await rpc('session','create',{request:{workspaceId}});assert.equal(defaultSession.agentPreset,'lab-research');checks.push('client-selected-research-default');
  assert.deepEqual(pageErrors,[]);await page.screenshot({path:join(runDir,'client.png'),fullPage:true});checks.push('client-mounted-no-page-errors');
  await closeBrowser();
 }
 await host.stop(true);host=undefined;await boot();
 const stored=await rpc('lab','projects_memory',{request:{projectId:'p1-prototype'}});assert.equal(stored.memory.markdown,updated.memory.markdown);assert.equal(stored.history.length,2);checks.push('memory-survives-host-restart');
 const binding=await rpc('lab','projects_binding',{request:{projectId:'p1-prototype'}});assert.ok(binding.binding.sessionIds.includes(session.sessionId));assert.equal(binding.binding.workspaceId,workspaceId);checks.push('binding-survives-host-restart');
 if(exerciseCore){
  await host.stop(true);host=undefined;
  const patchPath=join(dir,'cordis.patch.yml');
  const originalPatch=readFileSync(patchPath,'utf8');
  // Disable only this isolated profile's iBM workflow/runtime/UI rows. NEXT stays pristine.
  const ids=[...readFileSync(join(repo,'cordis.patch.yml'),'utf8').matchAll(/^\s+- id: (lab-[\w-]+)$/gm)].map(match=>match[1]).filter(id=>id!=='lab-remote');
  writeFileSync(patchPath,originalPatch.trimEnd()+'\n'+ids.map(id=>`- id: ${id}\n  disabled: true`).join('\n')+'\n');
  await boot();
  const coreMemory=await rpc('lab','projects_memory',{request:{projectId:'p1-prototype'}});assert.equal(coreMemory.memory.markdown,updated.memory.markdown);
  const coreBinding=await rpc('lab','projects_binding',{request:{projectId:'p1-prototype'}});assert.equal(coreBinding.binding.workspaceId,workspaceId);
  const active=await rpc('pluginManager','listPlugins');
  for(const id of ['lab-tasks','lab-synthesis','lab-nmr','lab-convert','lab-python-env','lab-goal-profiles','lab-ppt-templates'])assert.ok(active.some(row=>row.patchId===id&&!row.enabled),`core-only row still active: ${id}`);
  const failure=await fetch(`${auth.origin}/api/lab/goals_list`,{method:'POST',headers:{cookie:auth.cookie,origin:auth.origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'lab/goals_list',payload:{args:{}}})});
  assert.equal(failure.status,200);const unavailable=await failure.json();assert.equal(unavailable.result.ok,false);assert.equal(unavailable.result.error.code,'feature-unavailable');
  const foundation=await rpc('lab','projects_create',{request:{fields:{id:'p2-core-only',name:'P2 独立 core'}}});assert.equal(foundation.project.id,'p2-core-only');
  await rpc('lab','projects_memory_update',{request:{fields:{projectId:'p2-core-only',markdown:'# 仅 core 仍可更新'}}});
  await rpc('lab','projects_delete',{request:{projectId:'p2-core-only'}});checks.push('core-only-host-history-create-memory-delete-and-feature-error');
  await host.stop(true);host=undefined;writeFileSync(patchPath,originalPatch);await boot();
  assert.ok((await rpc('lab','note_templates_list',{request:{}})).templates);
  assert.equal((await rpc('lab','projects_memory',{request:{projectId:'p1-prototype'}})).memory.markdown,updated.memory.markdown);
  checks.push('full-workflows-restored-without-data-loss');
 }
 report.ok=true;
} catch(error){report.ok=false;report.error=String(error);throw error;}
finally{
 await closeBrowser();await host?.stop(true);await runner.dispose();
 // The Host already masks secrets; never save login URLs/cookies or process environments.
 writeFileSync(join(runDir,'host.log'),redact(hostLog));writeFileSync(join(runDir,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`${report.phase} evidence: ${join(runDir,'verification.json')}`);
 process.stdout.write=originalWrite;
}
