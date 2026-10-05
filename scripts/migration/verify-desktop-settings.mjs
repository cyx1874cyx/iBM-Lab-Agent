/** Launch only this new installed-layout app with an isolated home. */
/* global document, window */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync,mkdtempSync,writeFileSync,readdirSync,readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { initializeRelease } from '../../electron-next/release-runtime.mjs';
const arg=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0,name+' required');return resolve(process.argv[index+1]);};
const app=arg('--app'),resources=arg('--resources'),executable=arg('--executable'),output=arg('--output');
mkdirSync(output,{recursive:true});const work=mkdtempSync(join(output,'run-')); const homeIndex=process.argv.indexOf('--home'); const home=homeIndex<0?join(work,'中文桌面 数据'):resolve(process.argv[homeIndex+1]); if(homeIndex>=0)assert.ok(home.startsWith(resolve(output,'..')+String.fromCharCode(92)),'Reused home must belong to the isolated test output tree');
const {NextProfiles}=await import(pathToFileURL(join(app,'lib/profiles.js')));
const initialized=initializeRelease({home,resources,electron:executable,profiles:NextProfiles});const profiles=new NextProfiles(home);const firstRun=process.argv.includes('--first-run');if(!firstRun){profiles.finishOnboarding('ibm-lab');profiles.dismissAccountSetup('ibm-lab');}
let log='',browser;
const child=spawn(executable,[...(process.argv.includes('--staged')?[app]:[]),'--remote-debugging-port=0'],{env:{...process.env,DSH_DESKTOP_NEXT_HOME:home,DSH_HOME:home,HOME:home,USERPROFILE:home,ELECTRON_RUN_AS_NODE:undefined,DSH_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
const report={ok:false,home,initialized:initialized.initialized,mode:firstRun?"first-run":"settings",checks:[]};const redact=value=>String(value).replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');
let endpoint;for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const value=String(chunk);endpoint??=value.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];log+=redact(value);});
try{
 for(let attempt=0;attempt<600&&!endpoint;attempt++){if(child.exitCode!==null)throw Error('Desktop exited before debugging was ready');await new Promise(done=>setTimeout(done,100));}
 assert.ok(endpoint,'Desktop debugging endpoint missing');browser=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null});
 let page,frame; const errors=[]; for(const p of await browser.pages()){p.on("pageerror",e=>errors.push(String(e)));p.on("console",m=>{if(m.type()==="error")errors.push(m.text());});p.on("response",r=>{if(r.status()>=400)errors.push(r.status()+" "+r.url());});p.on("requestfailed",r=>errors.push(r.url()+" "+r.failure()?.errorText));} report.rendererErrors=errors;
 for(let attempt=0;attempt<600&&!frame;attempt++){
  for(const candidate of await browser.pages())for(const current of candidate.frames())if(await current.$('[title="打开科研课题"]').catch(()=>false)){page=candidate;frame=current;break;}
  if(!frame)await new Promise(done=>setTimeout(done,100));
 }
 assert.ok(frame,'Installed desktop did not expose the research entry');
 await frame.waitForFunction(()=>!document.body.innerText.includes('正在加载设置'),{timeout:20000});
 if(firstRun){
  await frame.waitForSelector('.dshDesktopSetupContent',{timeout:20000});
  report.onboarding=await frame.evaluate(()=>document.querySelector('.dshDesktopSetupContent').innerText);
  assert.match(report.onboarding,/运行模式|桌面|Profile/);report.checks.push('fresh-first-run-onboarding-loaded');
 }else{
  await frame.waitForSelector('[data-slot="settings.trigger"], [data-slot="settings.launcher"] button',{timeout:20000});
  report.settingsTrigger=await frame.evaluate(()=>[...document.querySelectorAll('[data-slot="settings.trigger"], [data-slot="settings.launcher"]')].map(n=>n.outerHTML.slice(0,1800)));
  await frame.evaluate(()=>{const slot=document.querySelector('[data-slot="settings.trigger"]');const trigger=slot?.closest('button')??slot?.querySelector('button');if(trigger)trigger.click();else document.querySelector('[data-slot="settings.launcher"] button')?.click();});
  for(let attempt=0;attempt<100;attempt++){
   if(await frame.evaluate(()=>[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='桌面设置')))break;
   await frame.evaluate(()=>{const entry=document.querySelector('[role="menu"] button[role="menuitem"]');if(entry){entry.click();return;}const slot=document.querySelector('[data-slot="settings.trigger"]');const trigger=slot?.closest('button')??slot?.querySelector('button');if(trigger)trigger.click();else document.querySelector('[data-slot="settings.launcher"] button')?.click();});
   await new Promise(done=>setTimeout(done,100));
  }
  assert.ok(await frame.evaluate(()=>[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='桌面设置')),'Desktop settings section did not register');
  const settingsButton=await frame.evaluateHandle(()=>[...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='桌面设置'));
  assert.ok(settingsButton.asElement());await settingsButton.asElement().click();await settingsButton.dispose();
  await frame.waitForSelector('[data-next-desktop-settings] .dshDesktopSettingsList',{timeout:15000});
  report.settings=await frame.evaluate(()=>document.querySelector('[data-next-desktop-settings]').innerText);
  assert.match(report.settings,/ibm-lab/);
  report.state=await frame.evaluate(async()=>{const value=await window.desktopNext.state();return {phase:value.phase,profile:value.selected,version:value.version};});
  assert.equal(report.state.phase,'ready');assert.equal(report.state.profile,'ibm-lab');
  report.checks.push('native-Desktop-client-registered','physical-click-Desktop-settings-profile-loaded','native-state-ready');
  if(process.argv.includes('--ibm-settings')) {
   const clickText=async text=>{const handle=await frame.evaluateHandle(text=>[...document.querySelectorAll('button')].find(n=>n.innerText.trim()===text),text);assert.ok(handle.asElement(),'Missing button: '+text);await handle.asElement().click();await handle.dispose();};
   await clickText('iBM 插件设置');
   await frame.waitForSelector('[data-ibm-plugin-settings]');
   await frame.waitForFunction(()=>[...document.querySelectorAll('[data-ibm-plugin-settings] button')].some(n=>n.innerText==='实验计划模板'&&!n.disabled));
   for(const tab of ['阅读笔记模板','综述模板','PPT 模板','实验计划模板'])await clickText(tab);
   const input=await frame.$('[data-ibm-plugin-settings] input[placeholder^="新实验计划模板名称"]');assert.ok(input);await input.type('设置验收模板');await clickText('新建模板');
   await frame.waitForFunction(()=>[...document.querySelectorAll('[data-ibm-plugin-settings] .ib-row')].some(n=>n.innerText.includes('设置验收模板')));
   await page.screenshot({path:join(work,'ibm-templates.png')});
   const archive=await frame.evaluateHandle(()=>[...document.querySelectorAll('[data-ibm-plugin-settings] .ib-row')].find(n=>n.innerText.includes('设置验收模板'))?.querySelector('button'));assert.ok(archive.asElement());await archive.asElement().click();await archive.dispose();
   await frame.waitForFunction(()=>![...document.querySelectorAll('[data-ibm-plugin-settings] .ib-row')].some(n=>n.innerText.includes('设置验收模板')));
   report.checks.push('ibm-settings-slot-registered','four-template-tabs-accessible','template-created-and-archived-through-settings');
   await clickText('诊断与版本');
   await frame.waitForFunction(()=>[...document.querySelectorAll('[data-ibm-diagnostics] button')].some(n=>n.innerText==='重新检查'&&!n.disabled),{timeout:60000});
   report.ibmDiagnostics=await frame.evaluate(()=>JSON.parse(document.querySelector('[data-ibm-diagnostics] pre').textContent));
   for(const key of ['capabilities','runtime_environment','convert_available','desktop_status','versions_list'])assert.equal(report.ibmDiagnostics.checks[key].ok,true,key);
   assert.equal(report.ibmDiagnostics.checks.runtime_environment.value.python.available,true);
   const download=await page.target().createCDPSession();await download.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:work});await clickText('导出插件诊断');
   let exported;for(let attempt=0;attempt<100&&!exported;attempt++){exported=readdirSync(work).find(name=>/^ibm-plugin-diagnostics-.*\.json$/.test(name));if(!exported)await new Promise(done=>setTimeout(done,100));}assert.ok(exported,'Plugin diagnostic file was not downloaded');assert.equal(JSON.parse(readFileSync(join(work,exported),'utf8')).checkedAt,report.ibmDiagnostics.checkedAt);report.exportedDiagnostics=exported;
   await clickText('重新检查');await frame.waitForFunction(()=>[...document.querySelectorAll('[data-ibm-diagnostics] button')].some(n=>n.innerText==='重新检查'&&!n.disabled),{timeout:60000});
   await page.screenshot({path:join(work,'ibm-diagnostics.png')});
   report.checks.push('live-runtime-diagnostics-loaded','diagnostics-refresh-and-export-clicked');
  }
 }
 assert.equal(await frame.evaluate(()=>document.body.innerText.includes('正在加载设置')),false);
 report.checks.push('no-permanent-loading-placeholder');
 await page.screenshot({path:join(work,'settings.png')}); report.ok=true;
}catch(error){report.error=String(error);if(browser)for(const page of await browser.pages()){await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});report.failureText=await page.evaluate(()=>document.body.innerText).catch(()=>undefined);}throw error;}
finally{
 await browser?.close().catch(()=>{});
 for(let attempt=0;attempt<300&&child.exitCode===null;attempt++)await new Promise(done=>setTimeout(done,100));
 if(child.exitCode===null){child.kill();report.gracefulExit=false;}else report.gracefulExit=true;
 writeFileSync(join(work,'desktop.log'),log);writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Installed desktop evidence: '+join(work,'verification.json'));
}




