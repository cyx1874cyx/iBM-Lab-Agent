/** P1: real pinned NEXT Host + unchanged single iBM bundle, in a new isolated home. */
/* global document, window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { once } from 'node:events';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const arg = name => { const i=process.argv.indexOf(name); return i<0 ? undefined : process.argv[i+1]; };
const nextRepo = resolve(arg('--next-root') ?? (()=>{throw Error('--next-root required');})());
const output = resolve(arg('--output') ?? (()=>{throw Error('--output required');})());
const browserExe = arg('--browser');
const scientificUi = process.argv.includes('--scientific-ui');
const populated = process.argv.includes('--populated');
let scientificServer, scientificOrigin;
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
const newRunner=()=>createPackageRunner({command:executable,args:['--expose-internals',bundledPnpmEntry(NEXT_PACKAGE)],env:{
 ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:executable,
 PATH:`${join(runtime,'scripts/node-bin')}${delimiter}${process.env.PATH}`,
}},dir);
let runner=newRunner();
let host,browser; const checks=[]; let hostLog='';
const redact=value=>String(value).replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');
const originalWrite=process.stdout.write;
process.stdout.write=function(chunk,...rest){return originalWrite.call(this,redact(chunk),...rest);};
const report={phase:'P5',next:'2.0.17-next',kernel:'0.2.0-rc.2',ibm:'0.5.8-rc.1',mode:process.argv.includes('--electron')?'electron-node':'node',home,checks};
let auth;
let populationSnapshot;
async function populationState(){
 const workspace=await rpc('lab','projects_workspace',{request:{projectId:'p5-composition'}});
 const plots=await rpc('lab','plot_records_list',{request:{projectId:'p5-composition'}}),tasks=await rpc('lab','characterization_list',{request:{projectId:'p5-composition'}});
 const rows=values=>values.map(row=>({id:row.id,status:row.status})).sort((a,b)=>a.id.localeCompare(b.id));
 return {searches:rows(workspace.literature.searches),bundles:rows(workspace.literature.bundles),reports:rows(workspace.literature.reports),presentations:rows(workspace.literature.presentations),routes:rows(workspace.planning.routes),plots:plots.records.map(row=>({id:row.id,topic:row.topic,date:row.date})),tasks:rows(tasks.tasks)};
}
async function launchBrowser(){
 const profile=join(runDir,'browser');mkdirSync(profile);
 if(process.platform!=='win32'||!/msedge\.exe$/i.test(browserExe))return puppeteer.launch({executablePath:browserExe,headless:true,userDataDir:profile});
 // Edge's compatibility launcher exits before its browser child is ready.
 const child=spawn(browserExe,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--disable-extensions','--disable-features=msEdgeFirstRunExperience','about:blank'],{windowsHide:true,stdio:'ignore'});child.unref();
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
 host=new DesktopHostProcess(executable,runtime,dir,undefined,{...process.env,DSH_NEXT_PREFERENCES:JSON.stringify({browserAccess:true}),IBM_P5_NEXT_FIXTURE:join(runtime,'scripts/fixtures/isolated-user-host.mjs')},undefined,undefined,undefined,
 join(repo,'scripts/migration/p5-isolated-host.mjs'),undefined,undefined,chunk=>{hostLog+=chunk;});
 let timer; const ready=await Promise.race([host.start(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NEXT startup exceeded 90 seconds')),90000);})]).finally(()=>clearTimeout(timer));
 const url=new URL(ready.url);assert.equal(url.hostname,'127.0.0.1');
 const login=await fetch(url,{redirect:'manual'});assert.equal(login.status,303);
 auth={origin:url.origin,cookie:login.headers.get('set-cookie')?.split(';')[0]};assert.ok(auth.cookie);await login.body?.cancel();
 checks.push('real-host-ready');
 return ready.url;
}

try {
 const packageNames=['core','runtime','documents','literature','design','analysis','ui'].map(name=>'dsh-lab-'+name);
 const staging=join(runDir,'packages');mkdirSync(staging);
 for(const name of packageNames){
  const destination=join(staging,name);cpSync(join(repo,'packages',name),destination,{recursive:true,filter:source=>!source.split(/[\\/]/).includes('node_modules')});
  mkdirSync(join(destination,'node_modules'));symlinkSync(repo,join(destination,'node_modules','dsh-lab-agent'),process.platform==='win32'?'junction':'dir');
 }
 const install=runner.runPlugin(['add','--offline','--ignore-scripts',...packageNames.map(name=>'link:'+join(staging,name).replaceAll('\\','/'))],repo);
 let installLog='';install.stdout.on('data',v=>{installLog+=v;});install.stderr.on('data',v=>{installLog+=v;});
 const installed=await install.done;writeFileSync(join(runDir,'install.log'),installLog);assert.equal(installed.exitCode,0,installLog);
 const profile=JSON.parse(readFileSync(join(dir,'package.json')));for(const name of packageNames)assert.ok(profile.dsh.profile.bundles.includes(name));
 assert.ok(!profile.dsh.profile.bundles.includes('dsh-lab-agent'));checks.push('seven-official-package-runner-installs-without-compatibility-bundle');
 await runner.dispose();
 if(populated){
  assert.ok(arg('--pdf'),'--pdf required for --populated');
  const fixtureDir=join(runDir,'fixture-package');mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir,'package.json'),JSON.stringify({name:'ibm-p5-isolated-fixture',version:'1.0.0',type:'module'}));
  const fixtureFile=join(fixtureDir,'index.mjs');
  writeFileSync(fixtureFile,readFileSync(join(repo,'scripts/migration/p5-populated-fixture.mjs'),'utf8').replace('\"@deepseek-ai/cordis\"',JSON.stringify(pathToFileURL(join(repo,'node_modules/@deepseek-ai/cordis/lib/index.js')).href)).replace('\"../../tests/fixtures/office-builder.mjs\"',JSON.stringify(pathToFileURL(join(repo,'tests/fixtures/office-builder.mjs')).href)));
  const patch=join(dir,'cordis.patch.yml');
  writeFileSync(patch,readFileSync(patch,'utf8').replace(/^\[\]\s*$/m,'')+'\n- insert:\n    - id: p5-populated-fixture\n      name: '+JSON.stringify(pathToFileURL(fixtureFile).href)+'\n      config:\n        pdf: '+JSON.stringify(resolve(arg('--pdf')))+'\n');
 }
 if(scientificUi){
  assert.ok(arg('--python'),'--python required for --scientific-ui');
  process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=resolve(arg('--python'));
  scientificServer=createServer((_request,response)=>response.end('<title>P5 isolated scientific UI</title><p>Local acceptance fixture</p>'));
  scientificServer.listen(0,'127.0.0.1');await once(scientificServer,'listening');
  scientificOrigin=`http://127.0.0.1:${scientificServer.address().port}`;
  const patch=join(dir,'cordis.patch.yml');
  writeFileSync(patch,readFileSync(patch,'utf8').replace(/^\[\]\s*$/m,'')+'\n- id: ibm-scientific-desktop\n  config:\n    electron: '+JSON.stringify(nextRequire('electron'))+'\n    root: '+JSON.stringify(join(runDir,'scientific-desktop'))+'\n    headless: true\n    portal: '+JSON.stringify(scientificOrigin)+'\n    allowedLocalOrigins: ['+JSON.stringify(scientificOrigin)+']\n');
 }
 const url=await boot();
 let features=await rpc('lab','capabilities');for(const name of ['core','runtime','documents','literature','design','analysis'])assert.equal(features[name],true,name);
 const created=populated ? {project:(await rpc('lab','projects_list')).projects.find(row=>row.id==='p5-composition')} : await rpc('lab','projects_create',{request:{fields:{id:'p5-composition',name:'P5 可选科研课题',coreMarkdown:'# P5 核心记忆'}}});
 assert.equal(created.project.id,'p5-composition');
 if(populated){
  await rpc('lab','synth_target_create',{request:{fields:{id:'p5-target',projectId:'p5-composition',name:'P5 隔离设计目标',formula:'C2H6O'}}});
  await rpc('lab','synth_route_create',{request:{fields:{id:'p5-route',projectId:'p5-composition',targetId:'p5-target',name:'P5 隔离研究路线',steps:[{step:1,reaction:'P5 隔离步骤',reactants:['A'],products:['B'],conditions:'仅用于软件验收'}]}}});
  await rpc('lab','plot_records_create',{request:{id:'p5-plot',projectId:'p5-composition',topic:'P5 隔离绘图登记',date:'2026-10-04',notes:'没有执行真实 Origin 作图'}});
  const queued=await rpc('lab','characterization_submit',{request:{id:'p5-plot-task',projectId:'p5-composition',kind:'plot',title:'P5 失败绘图任务',date:'2026-10-04',inputPath:'fixture.pdf',instructions:'隔离状态验收；不执行科学软件'}});
  await rpc('lab','characterization_dispatch_failed',{request:{taskId:queued.task.id,projectId:'p5-composition',attempt:queued.task.attempt,error:'P5 隔离任务失败样例'}});
  checks.push('populated-isolated-literature-design-and-analysis-fixtures');
  populationSnapshot=await populationState();report.population=populationSnapshot;
 }
 const healthy=await rpc('agentPresets','list');assert.ok(healthy.presets.some(p=>p.id==='lab-research'&&!p.broken));checks.push('independent-bundles-full-provider-and-preset-composition');
 const change=async(name,enabled)=>{
  const result=await rpc('pluginManager','setBundleEnabled',{name:'dsh-lab-'+name,enabled});
  assert.ok(result.ok!==false,JSON.stringify(result));
  for(let attempt=0;attempt<100;attempt++){
   const current=await rpc('lab','capabilities');if(current[name]===enabled)return current;
   await new Promise(resolveWait=>setTimeout(resolveWait,200));
  }
  throw Error('Feature did not settle after bundle change: '+name);
 };
 for(const name of ['literature','design','analysis','documents','runtime'])await change(name,false);
 features=await rpc('lab','capabilities');assert.equal(features.core,true);assert.equal(features.runtime,false);assert.equal(features.literature,false);
 const workspace=await rpc('lab','projects_workspace',{request:{projectId:'p5-composition'}});assert.equal(workspace.memory.markdown,'# P5 核心记忆');
 await rpc('lab','projects_memory_update',{request:{fields:{projectId:'p5-composition',markdown:'# P5 停用期间更新'}}});checks.push('live-bundle-disable-core-workspace-and-memory-survive');
 for(const name of ['runtime','documents','literature','design','analysis'])await change(name,true);
 const restored=await rpc('lab','projects_workspace',{request:{projectId:'p5-composition'}});assert.equal(restored.memory.markdown,'# P5 停用期间更新');
 if(populated)assert.deepEqual(await populationState(),populationSnapshot);
 checks.push('live-bundle-reactivation-no-storage-duplicate-and-memory-retained');
 const plugins=await rpc('pluginManager','listPlugins');for(const id of ['ibm-core','ibm-runtime','ibm-documents','ibm-literature-workflows','ibm-design','ibm-analysis','lab-client'])assert.equal(plugins.filter(p=>p.patchId===id&&p.enabled).length,1,id);
 checks.push('exactly-one-active-provider-per-domain');
 if(browserExe){
  browser=await launchBrowser();const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));report.browserErrors=errors;
  page.on('console',message=>{if(['error','warn'].includes(message.type()))(report.browserConsoleErrors??=[]).push(redact(message.text()));});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('[title="打开科研课题"]',{timeout:30000});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(node=>node.innerText.trim()==='继续'),{timeout:30000});
  await page.evaluate(()=>{const notice=[...document.querySelectorAll('button')].find(node=>node.innerText.trim()==='继续');notice?.click();});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(node=>node.innerText.trim()==='稍后配置'),{timeout:10000});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(node=>node.innerText.trim()==='稍后配置').click());
  await page.click('[title="打开科研课题"]');await page.waitForFunction(()=>document.querySelector('.ib-main')?.innerText.includes('P5 可选科研课题'),{timeout:30000});
  await page.evaluate(()=>[...document.querySelectorAll('.ib-project')].find(node=>node.innerText.includes('P5 可选科研课题')).click());
  await page.waitForFunction(()=>document.querySelector('.ib-project-head')?.innerText.includes('P5 可选科研课题'),{timeout:30000});
  if(scientificUi){
   await page.waitForSelector('.ib-scientific-browser');
   const clickScientific=label=>page.evaluate(text=>[...document.querySelectorAll('.ib-scientific-browser button')].find(node=>node.innerText===text).click(),label);
   await clickScientific('打开科研浏览器');
   await page.waitForFunction(()=>document.querySelector('.ib-scientific-browser')?.innerText.includes('P5 isolated scientific UI'),{timeout:30000});
   const first=await rpc('lab','desktop_browser',{request:{action:'status',projectId:'p5-composition'}});
   await clickScientific('显示科研浏览器');
   await page.waitForFunction(()=>![...document.querySelectorAll('.ib-scientific-browser button')].some(node=>node.disabled&&node.innerText==='显示科研浏览器'));
   assert.equal((await rpc('lab','desktop_browser',{request:{action:'status',projectId:'p5-composition'}})).window.lease,first.window.lease);
   await page.type('[aria-label="科研页面地址"]',scientificOrigin+'/article');await clickScientific('前往');
   await page.waitForFunction(()=>![...document.querySelectorAll('.ib-scientific-browser button')].some(node=>node.disabled&&node.innerText==='显示科研浏览器'));
   assert.ok((await rpc('lab','desktop_browser',{request:{action:'status',projectId:'p5-composition'}})).window.url.endsWith('/article'));
   await clickScientific('关闭浏览器');
   await page.waitForFunction(()=>[...document.querySelectorAll('.ib-scientific-browser button')].some(node=>node.innerText==='打开科研浏览器'&&!node.disabled));
   await new Promise(done=>setTimeout(done,2500));
   assert.equal((await rpc('lab','desktop_browser',{request:{action:'status',projectId:'p5-composition'}})).window,null);
   checks.push('formal-next-ui-buttons-open-reuse-navigate-close-real-electron-without-auto-reopen');
  }
  for(const width of [1360,600])for(const theme of ['light','dark']){
   await page.setViewport({width,height:900});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme}]);
   await page.evaluate(dark=>{document.body.toggleAttribute('data-ds-dark-theme',dark);},theme==='dark');
   await page.screenshot({path:join(runDir,`project-${width}-${theme}.png`),fullPage:true});
   assert.equal(await page.evaluate(()=>document.querySelector('.ib-overlay').scrollWidth<=window.innerWidth+1),true,'project overflow');
  }
  await page.setViewport({width:1360,height:900});
  if(populated){
   assert.equal(await page.evaluate(()=>document.querySelectorAll('.ib-lit-item:has([data-kind=reading])').length),3);
   assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.ib-lit-item:has([data-kind=reading])')].map(node=>({title:node.querySelector('.ib-lit-zh').innerText,reading:node.querySelector('[data-kind="reading"]').dataset.done==='true',ppt:node.querySelector('[data-kind="ppt"]').dataset.done==='true'})).sort((a,b)=>a.title.localeCompare(b.title))),[
    {title:'P5 失败精读',reading:false,ppt:false},{title:'P5 待审核精读',reading:true,ppt:false},{title:'P5 进行中精读',reading:false,ppt:false}
   ].sort((a,b)=>a.title.localeCompare(b.title)));
   await page.evaluate(()=>[...document.querySelectorAll('.ib-lit-item button')].find(node=>node.innerText==='简介').click());
   await page.waitForFunction(()=>document.querySelector('.ib-main').innerText.includes('软件迁移隔离样例'));
   await page.evaluate(()=>[...document.querySelectorAll('.ib-lit-item button')].find(node=>node.innerText==='收起简介').click());
   const clickTab=label=>page.evaluate(text=>[...document.querySelectorAll('.ib-tab')].find(node=>node.innerText===text).click(),label);
   for(const [tab,expected] of [['文献资料','P5 待审核精读'],['研究设计','P5 隔离研究路线'],['表征分析','P5 失败绘图任务']]){
    await clickTab(tab);await page.waitForFunction(text=>document.querySelector('.ib-main')?.innerText.includes(text),{timeout:30000},expected);
    for(const width of [1360,600])for(const theme of ['light','dark']){
     await page.setViewport({width,height:900});await page.evaluate(dark=>document.body.toggleAttribute('data-ds-dark-theme',dark),theme==='dark');
     await page.screenshot({path:join(runDir,`populated-${tab}-${width}-${theme}.png`),fullPage:true});
     assert.equal(await page.evaluate(()=>document.querySelector('.ib-overlay').scrollWidth<=window.innerWidth+1),true,tab+' overflow');
    }
   }
   await page.evaluate(()=>[...document.querySelectorAll('.ib-characterization-row')].find(node=>node.innerText.includes('P5 隔离绘图登记')).querySelector('summary').click());
   await page.click('[aria-label="绘图主题"]',{clickCount:3});await page.keyboard.press('Backspace');await page.type('[aria-label="绘图主题"]','P5 隔离绘图登记（已修改）');
   await page.evaluate(()=>document.querySelector('.ib-entry-edit button').click());
   await page.waitForFunction(()=>document.querySelector('.ib-characterization-title')?.parentElement.parentElement.innerText.includes('P5 隔离绘图登记（已修改）'));
   assert.equal((await rpc('lab','plot_records_list',{request:{projectId:'p5-composition'}})).records[0].topic,'P5 隔离绘图登记（已修改）');
   populationSnapshot=await populationState();report.population=populationSnapshot;
   await page.setViewport({width:1360,height:900});await clickTab('文献资料');
   checks.push('populated-three-tabs-four-viewports-flat-actions-independent-reading-ppt-state-and-plot-ui-edit');
  }
  for(const name of ['literature','design','analysis','documents','runtime'])await change(name,false);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-tab-refresh')][0].click());
  await page.waitForFunction(()=>document.querySelector('.ib-main')?.innerText.includes('科研功能尚未启用'),{timeout:30000});
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.ib-tab')].every(node=>node.disabled)),true);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-btn')].find(node=>node.innerText==='核心记忆').click());
  await page.waitForSelector('.ib-memory-drawer textarea');await page.screenshot({path:join(runDir,'core-only-memory.png'),fullPage:true});
  checks.push('core-only-ui-disabled-tabs-and-working-memory-drawer');
  for(const name of ['runtime','documents','literature','design','analysis'])await change(name,true);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-tab-refresh')][0].click());
  await page.waitForFunction(()=>[...document.querySelectorAll('.ib-tab')].length===3&&[...document.querySelectorAll('.ib-tab')].every(node=>!node.disabled),{timeout:30000});
  if(populated)assert.equal(await page.evaluate(()=>document.querySelectorAll('.ib-lit-item:has([data-kind=reading])').length),3);
  assert.deepEqual(errors,[]);checks.push('full-ui-wide-narrow-two-themes-and-live-provider-recovery');
  const stoppedUi=await rpc('pluginManager','setBundleEnabled',{name:'dsh-lab-ui',enabled:false});assert.ok(stoppedUi.ok!==false);
  await page.waitForFunction(()=>!document.querySelector('.ib-overlay')&&!document.querySelector('[data-dsh-lab-research-entry]'),{timeout:30000});
  const restartedUi=await rpc('pluginManager','setBundleEnabled',{name:'dsh-lab-ui',enabled:true});assert.ok(restartedUi.ok!==false);
  await page.waitForSelector('[title="打开科研课题"]',{timeout:30000});await page.click('[title="打开科研课题"]');
  await page.waitForFunction(()=>document.querySelector('.ib-main')?.innerText.includes('P5 可选科研课题'),{timeout:30000});
  assert.equal(await page.evaluate(()=>document.querySelectorAll('style[data-plugin-css="dsh-lab-agent"]').length),1);
  assert.deepEqual(errors,[]);checks.push('live-ui-disable-disposes-overlay-and-reactivation-restores-working-entry');await closeBrowser();
 }
 await host.stop(true);host=undefined;await boot();assert.equal((await rpc('lab','projects_memory',{request:{projectId:'p5-composition'}})).memory.markdown,'# P5 停用期间更新');checks.push('bundle-selection-and-memory-persist-across-host-restart');
 if(populated)assert.deepEqual(await populationState(),populationSnapshot);
 await host.stop(true);host=undefined;
 const upgrade=join(staging,'ui-upgrade');cpSync(join(repo,'packages/dsh-lab-ui'),upgrade,{recursive:true});
 const upgradedManifest=JSON.parse(readFileSync(join(upgrade,'package.json')));upgradedManifest.version='0.5.8-rc.1+p5.fixture.1';writeFileSync(join(upgrade,'package.json'),JSON.stringify(upgradedManifest,null,2));
 mkdirSync(join(upgrade,'node_modules'));symlinkSync(repo,join(upgrade,'node_modules/dsh-lab-agent'),process.platform==='win32'?'junction':'dir');
 for(const [location,expected] of [[upgrade,upgradedManifest.version],[join(staging,'dsh-lab-ui'),'0.5.8-rc.1']]){
  runner=newRunner();const reinstall=runner.runPlugin(['add','--offline','--ignore-scripts','link:'+location.replaceAll('\\','/')],repo);let log='';reinstall.stdout.on('data',v=>{log+=v;});reinstall.stderr.on('data',v=>{log+=v;});
  const result=await reinstall.done;assert.equal(result.exitCode,0,log);await runner.dispose();await boot();
  const installedBundles=await rpc('pluginManager','listBundles');assert.equal(installedBundles.find(bundle=>bundle.name==='dsh-lab-ui').version,expected);
  assert.equal((await rpc('lab','projects_memory',{request:{projectId:'p5-composition'}})).memory.markdown,'# P5 停用期间更新');
  if(populated)assert.deepEqual(await populationState(),populationSnapshot);
  const after=await rpc('pluginManager','listPlugins');assert.equal(after.filter(row=>row.patchId==='ibm-core'&&row.enabled).length,1);
  await host.stop(true);host=undefined;
 }
 checks.push('isolated-ui-version-fixture-update-and-rollback-preserve-core-data');
 report.ok=true;
} catch(error){
 report.ok=false;report.error=String(error);
 if(browser){const pages=await browser.pages();const current=pages.find(page=>page.url().startsWith(auth.origin))??pages.at(-1);report.failureText=await current.evaluate(()=>document.querySelector('.ib-main')?.innerText ?? document.body.innerText);await current.screenshot({path:join(runDir,'failure.png'),fullPage:true}).catch(()=>{});}
 throw error;
}
finally{
 await closeBrowser();
 try { await host?.stop(true); } catch(error) { report.cleanupError=String(error); report.ok=false; }
 await runner.dispose();
 if(scientificServer)await new Promise(done=>scientificServer.close(done));
 writeFileSync(join(runDir,'host.log'),redact(hostLog));writeFileSync(join(runDir,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log('P5 evidence: '+join(runDir,'verification.json'));process.stdout.write=originalWrite;
}
