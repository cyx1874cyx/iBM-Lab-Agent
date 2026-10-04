/** Launch only this new installed-layout app with an isolated home. */
/* global document */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { initializeRelease } from '../../electron-next/release-runtime.mjs';
const arg=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0,name+' required');return resolve(process.argv[index+1]);};
const app=arg('--app'),resources=arg('--resources'),executable=arg('--executable'),output=arg('--output');
mkdirSync(output,{recursive:true});const work=mkdtempSync(join(output,'run-')),home=join(work,'中文桌面 数据');
const {NextProfiles}=await import(pathToFileURL(join(app,'lib/profiles.js')));
initializeRelease({home,resources,electron:executable,profiles:NextProfiles});const profiles=new NextProfiles(home);profiles.finishOnboarding('ibm-lab');profiles.dismissAccountSetup('ibm-lab');
let log='',browser;
const child=spawn(executable,['--remote-debugging-port=0'],{env:{...process.env,DSH_DESKTOP_NEXT_HOME:home,DSH_HOME:home,HOME:home,USERPROFILE:home,ELECTRON_RUN_AS_NODE:undefined,DSH_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
const report={ok:false,home,checks:[]};const redact=value=>String(value).replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');
let endpoint;for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const value=String(chunk);endpoint??=value.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];log+=redact(value);});
try{
 for(let attempt=0;attempt<600&&!endpoint;attempt++){if(child.exitCode!==null)throw Error('Desktop exited before debugging was ready');await new Promise(done=>setTimeout(done,100));}
 assert.ok(endpoint,'Desktop debugging endpoint missing');browser=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null});
 let page,frame;
 for(let attempt=0;attempt<600&&!frame;attempt++){
  for(const candidate of await browser.pages())for(const current of candidate.frames())if(await current.$('[title="打开科研课题"]').catch(()=>false)){page=candidate;frame=current;break;}
  if(!frame)await new Promise(done=>setTimeout(done,100));
 }
 assert.ok(frame,'Installed desktop did not expose the research entry');
 // All pages and data belong to this freshly created smoke home.
 await frame.evaluate(()=>{for(const text of ['继续','稍后配置']){const button=[...document.querySelectorAll('button')].find(node=>node.innerText.trim()===text);button?.click();}});
 await new Promise(done=>setTimeout(done,1000));
 await frame.evaluate(()=>[...document.querySelectorAll('button')].find(node=>node.innerText.trim()==='稍后配置')?.click());
 await frame.click('[title="打开科研课题"]');await frame.waitForSelector('.ib-main',{timeout:30000});
 assert.ok(await frame.evaluate(()=>document.querySelector('.ib-overlay').getBoundingClientRect().top>=40),'Research panel overlaps the native Windows caption/menu');
 await page.screenshot({path:join(work,'installed-desktop.png'),fullPage:true});
 report.page=await frame.evaluate(()=>({title:document.title,text:document.querySelector('.ib-main')?.innerText,menus:[...document.querySelectorAll('button')].filter(node=>['应用','编辑'].includes(node.innerText.trim())).map(node=>({text:node.innerText,class:node.className,parent:node.parentElement.outerHTML.slice(0,1400)}))}));
 assert.match(report.page.text,/科研课题|课题/);report.checks.push('real-packaged-Electron-main-window','official-client-research-entry','native-caption-clearance','isolated-new-home');
 report.ok=true;
}catch(error){report.error=String(error);if(browser)for(const page of await browser.pages()){await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});report.failureText=await page.evaluate(()=>document.body.innerText).catch(()=>undefined);}throw error;}
finally{
 await browser?.close().catch(()=>{});
 for(let attempt=0;attempt<300&&child.exitCode===null;attempt++)await new Promise(done=>setTimeout(done,100));
 if(child.exitCode===null){child.kill();report.gracefulExit=false;}else report.gracefulExit=true;
 writeFileSync(join(work,'desktop.log'),log);writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Installed desktop evidence: '+join(work,'verification.json'));
}
