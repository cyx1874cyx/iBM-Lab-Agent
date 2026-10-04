/** Launch only this new installed-layout app with an isolated home. */
/* global document, window */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
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
  await frame.evaluate(()=>{const trigger=document.querySelector('[data-slot="settings.trigger"]')?.closest('button');if(trigger)trigger.click();else document.querySelector('[data-slot="settings.launcher"] button')?.click();});
  for(let attempt=0;attempt<100;attempt++){
   if(await frame.evaluate(()=>[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='桌面设置')))break;
   await frame.evaluate(()=>document.querySelector('[role="menu"] button[role="menuitem"]')?.click());
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




