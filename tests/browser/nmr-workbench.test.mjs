/* global window,document,DataTransfer,DragEvent,HTMLInputElement,location */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {readFileSync,existsSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import {launchSystemBrowser,resolveBrowserExecutable} from './helpers/ketcher-page.mjs';
import {resolveKetcherAsset} from '../../lib/ketcher-assets.js';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const executable=resolveBrowserExecutable();
const reactRoot=[process.env.IBM_READER_REACT_ROOT,join(repo,'node_modules'),resolve(repo,'../../outputs/electron-next-p1/next/dsh-plugin-desktop/node_modules')].find(path=>path&&existsSync(join(path,'react/package.json')));
const mol='\n  Ketcher\n\n  3  2  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    2.5981    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  2  3  1  0  0  0  0\nM  END\n';

test('NMR two-input picker stages files until confirmation, supports drawing and opens four destinations',{skip:!executable||!reactRoot,timeout:90000},async()=>{
 const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {NmrPanel} from './client/src/components-nmr.js';import {injectStyles} from './client/src/styles.js';import {installDesktopClient} from './client/src/desktop-client.js';
injectStyles();const tasks=[],uploads=new Map();window.fixturePrompts=[];window.fixtureOpens=[];window.fixtureUploads=0;window.fixtureSaves=0;window.fixtureCancelled=[];window.fixtureChats=[];
const call=async(method,{request}={})=>{
 if(method==='characterization_list')return {tasks:tasks.map(row=>({...row}))};
 if(method==='project_file_upload'){window.fixtureUploads++;const path='/workspace/'+request.name;uploads.set(path,atob(request.base64));return {file:{sourcePath:path}};}
 if(method==='characterization_nmr_save'){window.fixtureSaves++;let row=tasks.find(row=>row.id===request.taskId);if(!row){row={id:request.taskId,kind:'nmr',status:'draft',date:'2026-10-22',artifacts:{}};tasks.push(row);}Object.assign(row,request,{title:request.compound.name||request.title,updatedAt:new Date().toISOString()});return {task:{...row}};}
 if(method==='characterization_nmr_simulation_start'){const row=tasks.find(row=>row.id===request.taskId);row.simulationJob={id:'sim-job',status:'queued'};return {job:row.simulationJob,prompt:'Simulate '+row.id};}
 if(method==='characterization_remove'){window.fixtureDelete=request;const index=tasks.findIndex(row=>row.id===request.taskId);if(request.mode==='all')tasks.splice(index,1);else for(const slot of request.deleteFiles)delete tasks[index].artifacts[slot];return {removed:{deletedFiles:[]}};}
 if(method==='characterization_nmr_start'){const row=tasks.find(row=>row.id===request.taskId);if(!row.inputPath||!row.structurePath&&!row.compound.smiles)throw Error('missing input');row.status='queued';row.attempt||=1;return {task:{...row},prompt:'Analyze '+row.id};}
 if(method==='characterization_nmr_cancel'){const row=tasks.find(row=>row.id===request.taskId);if(row.attempt!==request.attempt)throw Error('stale attempt');window.fixtureCancelled.push(row.sessionId);row.conversationSessionId=row.sessionId;row.status='draft';row.attempt++;row.sessionId=undefined;return {task:{...row}};}
 if(method==='characterization_nmr_structure'){const row=tasks.find(row=>row.id===request.taskId);return {source:uploads.get(row.structurePath)||row.compound?.smiles||null};}
 if(method==='desktop_status')return {available:true};
 if(method==='desktop_artifact'){window.fixtureOpens.push(request);return {opened:true};}
 throw Error('Unexpected API '+method);
};
installDesktopClient(call);window.fixtureSimulationPrompts=[];window.fixtureFinish=()=>{for(const row of tasks){row.status='completed';row.artifacts={spectrum:{path:'labeled.mnova',sha256:'fixture'},report:{path:'report.docx',sha256:'fixture'}};}};
window.confirm=()=>true;createRoot(document.getElementById('root')).render(React.createElement(NmrPanel,{projectId:'nmr-project',call,onOpenConversation:async id=>{window.fixtureChats.push(id);},onSubmitTask:async(prompt,identity)=>{if(!identity){window.fixtureSimulationPrompts.push(prompt);return;}const row=tasks.find(row=>row.id===identity.taskId);if(row.attempt!==identity.attempt)throw Error('stale dispatch');row.sessionId='new-session-'+(window.fixturePrompts.length+1);window.fixturePrompts.push({prompt,identity,sessionId:row.sessionId});}}));
`;
 const built=await esbuild.build({stdin:{contents:fixture,resolveDir:repo,sourcefile:'nmr-fixture.js'},bundle:true,format:'iife',platform:'browser',write:false,target:['chrome110'],nodePaths:[reactRoot],logLevel:'silent'});
 const server=createServer((req,res)=>{
  if(req.url.startsWith('/api/lab-ketcher/')){
   const file=resolveKetcherAsset(new URL(req.url,'http://local').pathname.replace('/api/lab-ketcher',''));
   if(!file||!existsSync(file)){res.writeHead(404).end();return;}
   res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
  }else if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].text);}
  else if(req.url.startsWith('/api/lab-artifacts')){res.setHeader('content-type','application/pdf');res.end('%PDF-fixture');}
  else res.end('<html><body style="margin:0"><div class="ib-overlay" style="width:1100px;min-height:800px;padding:20px;box-sizing:border-box"><div id="root"></div></div><script src="/fixture.js"></script></body></html>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const temp=mkdtempSync(join(tmpdir(),'ibm-nmr-picker-'));writeFileSync(join(temp,'sample.zip'),'raw fixture');
 let browser,page;const errors=[],output=process.env.IBM_NMR_BROWSER_OUTPUT;
 try{
  browser=await launchSystemBrowser(puppeteer,executable,{headless:'new',defaultViewport:{width:1150,height:900}});page=await browser.newPage();page.on('pageerror',reason=>errors.push(reason.message));
  await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load'});
  const drop=(files,target='.ib-nmr-panel')=>page.evaluate(({files,target})=>{const data=new DataTransfer();for(const file of files)data.items.add(new File([file.content],file.name));document.querySelector(target).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));},{files,target});
  const button=label=>page.$eval('button[aria-label="'+label+'"]',node=>node.click());
  const click=label=>page.evaluate(label=>[...document.querySelectorAll('button')].find(n=>n.textContent===label).click(),label);
  const fill=(label,value)=>page.evaluate(({label,value})=>{const input=[...document.querySelectorAll('.ib-nmr-form label')].find(n=>n.textContent===label).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));},{label,value});
  await page.waitForSelector('.ib-nmr-panel');
  await click('+ 新建条目');await page.waitForSelector('[aria-label="核磁条目输入"]');
  assert.equal(await page.$$eval('.ib-nmr-input-zone',nodes=>nodes.length),2);
  const createDisabled=()=>page.$$eval('.ib-nmr-form button',nodes=>nodes.find(n=>n.textContent==='新建条目')?.disabled);
  assert.equal(await createDisabled(),true);
  const chooserPromise=page.waitForFileChooser();await page.click('[aria-label="选择核磁原始数据"]');
  const chooser=await chooserPromise;await chooser.accept([join(temp,'sample.zip')]);
  await page.waitForSelector('[data-nmr-input=data][data-selected=true]');
  assert.equal(await createDisabled(),true,'raw data alone cannot create an entry');
  assert.deepEqual(await page.evaluate(()=>[window.fixtureUploads,window.fixtureSaves,window.fixturePrompts.length]),[0,0,0]);
  assert.equal(await page.$('.ib-nmr-entry'),null);
  await drop([{name:'wrong.zip',content:'raw'}],'[data-nmr-input=structure]');
  await page.waitForFunction(()=>document.querySelector('.ib-nmr-form [role=alert]')?.textContent.includes('分子结构式区域'));
  assert.equal(await createDisabled(),true);
  const structureChooserPromise=page.waitForFileChooser();await page.click('[aria-label="选择分子结构式"]');
  await (await structureChooserPromise).accept([]);
  await drop([{name:'ethanol.mol',content:mol}],'[data-nmr-input=structure]');
  await page.waitForSelector('[data-nmr-input=structure][data-selected=true]');
  assert.equal(await createDisabled(),false);
  assert.deepEqual(await page.evaluate(()=>[window.fixtureUploads,window.fixtureSaves,window.fixturePrompts.length]),[0,0,0],'collecting both inputs still waits for explicit creation');
  await fill('化合物名称（可选）','乙醇');await fill('分子式（可选）','C2H6O');await fill('CAS 号（若有）','64-17-5');
  if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'nmr-two-input-picker.png')});}
  await click('新建条目');await page.waitForSelector('.ib-nmr-entry[data-status=draft]');
  assert.equal(await page.$eval('[aria-label="模拟谱 · Mnova"]',node=>node.dataset.ready),'false');
  assert.notEqual(await page.$eval('[aria-label="模拟谱 · Mnova"] svg path',node=>node.getAttribute('d')),await page.$eval('[aria-label="标峰后核磁文件 · Mnova"] svg path',node=>node.getAttribute('d')));
  await button('模拟谱 · Mnova');await page.waitForSelector('[aria-label="核磁模拟设置"]');await click('取消');
  assert.equal(await page.$('[aria-label="核磁模拟设置"]'),null,'settings can be closed');
  await button('模拟谱 · Mnova');await click('生成');await page.waitForFunction(()=>window.fixtureSimulationPrompts.length===1);
  assert.equal(await page.$('[aria-label="核磁模拟设置"]'),null,'settings close before dispatch');
  await page.waitForSelector('[aria-label="模拟中"]');
  assert.equal(await page.evaluate(()=>window.fixturePrompts.length),0,'creation waits for explicit analysis');
  assert.equal(await page.$eval('[aria-label="打开科研助手对话"]',node=>node.disabled),true);
  const startColor=await page.$eval('.ib-nmr-analysis',node=>getComputedStyle(node).backgroundColor);
  assert.notEqual(startColor,'rgba(0, 0, 0, 0)');
  await click('开始分析');await page.waitForFunction(()=>window.fixturePrompts.length===1);
  assert.deepEqual(await page.evaluate(()=>[window.fixtureUploads,window.fixtureSaves]),[2,1]);
  await page.waitForSelector('.ib-nmr-entry[data-status=queued]');
  await page.waitForSelector('[aria-label="打开科研助手对话"]:enabled');
  await button('打开科研助手对话');await page.waitForFunction(()=>window.fixtureChats.length===1);
  assert.deepEqual(await page.evaluate(()=>window.fixtureChats),['new-session-1']);
  assert.equal(await page.$eval('.ib-nmr-analysis',node=>node.textContent),'正在分析');
  await click('正在分析');await page.waitForSelector('.ib-nmr-entry[data-status=draft]');
  assert.deepEqual(await page.evaluate(()=>window.fixtureCancelled),['new-session-1']);
  assert.equal(await page.$eval('.ib-nmr-analysis',node=>node.textContent),'开始分析');
  await button('打开科研助手对话');await page.waitForFunction(()=>window.fixtureChats.length===2);
  assert.deepEqual(await page.evaluate(()=>window.fixtureChats),['new-session-1','new-session-1']);
  await click('开始分析');await page.waitForFunction(()=>window.fixturePrompts.length===2);
  assert.equal(await page.evaluate(()=>window.fixturePrompts[1].identity.attempt),2);
  assert.notEqual(await page.evaluate(()=>window.fixturePrompts[0].sessionId),await page.evaluate(()=>window.fixturePrompts[1].sessionId));
  await page.waitForSelector('.ib-nmr-molecule[data-state=loaded] img',{timeout:60000});
  assert.match(await page.$eval('.ib-nmr-identity',node=>node.textContent),/乙醇.*C2H6O.*64-17-5/);
  assert.equal(await page.$eval('.ib-nmr-date',node=>node.textContent),'日期：2026-10-22');
  await button('输入结构式');await page.waitForSelector('[aria-label="输入结构式预览"] img');
  await click('关闭');await button('核磁原始文件 · Mnova');
  await page.waitForFunction(()=>window.fixtureOpens.length===1);
  assert.equal(await page.evaluate(()=>window.fixtureOpens[0].action),'openMnova');
  assert.match(await page.evaluate(()=>window.fixtureOpens[0].url),/slot=raw$/);
  await page.evaluate(()=>window.fixtureFinish());await page.waitForSelector('.ib-nmr-entry[data-status=completed]');
  await button('打开科研助手对话');await page.waitForFunction(()=>window.fixtureChats.length===3);
  assert.equal(await page.evaluate(()=>window.fixtureChats[2]),'new-session-2');
  assert.equal(await page.evaluate(()=>window.fixturePrompts.length),2,'opening a bound conversation never dispatches another task');
  await button('标峰后核磁文件 · Mnova');await page.waitForFunction(()=>window.fixtureOpens.length===2);
  assert.match(await page.evaluate(()=>window.fixtureOpens[1].url),/slot=spectrum$/);
  await button('标峰报告 · 软件内预览');await page.waitForSelector('[aria-label="标峰报告预览"] iframe');
  assert.match(await page.$eval('iframe[title="核磁标峰报告"]',node=>node.src),/slot=report&preview=1/);
  await click('关闭');
  await button('打开条目文件夹');await page.waitForFunction(()=>window.fixtureOpens.length===3);
  assert.equal(await page.evaluate(()=>window.fixtureOpens[2].action),'openNmrFolder');
  assert.match(await page.evaluate(()=>window.fixtureOpens[2].url),/slot=folder$/);
  // A column drop also stages both files; cancel never uploads or registers anything.
  await drop([{name:'second.mnova',content:'raw fixture'},{name:'target.smi',content:'CCO'}]);
  await page.waitForSelector('[aria-label="核磁条目输入"]');assert.equal(await createDisabled(),false);
  assert.equal(await page.$$eval('.ib-nmr-entry',nodes=>nodes.length),1);
  await click('取消');assert.deepEqual(await page.evaluate(()=>[window.fixtureUploads,window.fixtureSaves,window.fixturePrompts.length]),[2,1,2]);
  await drop([{name:'one.zip',content:'raw'},{name:'two.zip',content:'raw'},{name:'target.smi',content:'CCO'}]);
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('一次导入一组'));
  assert.equal(await page.$$eval('.ib-nmr-entry',nodes=>nodes.length),1);
  // Raw-data drag + Ketcher drawing supplies the second input without a structure upload.
  await click('+ 新建条目');await page.waitForSelector('.ib-nmr-form');
  await drop([{name:'drawn.mnova',content:'raw fixture'}],'[data-nmr-input=data]');
  await page.waitForSelector('[data-nmr-input=data][data-selected=true]');
  await click('绘制结构式');await page.waitForSelector('.ib-nmr-drawing iframe');
  const editor=await (await page.$('.ib-nmr-drawing iframe')).contentFrame();
  await editor.waitForFunction(()=>[...document.querySelectorAll('button')].some(n=>n.textContent==='保存结构'&&!n.disabled));
  await page.evaluate(()=>{window.drawReady=false;window.addEventListener('message',event=>{if(event.data?.requestId==='nmr-drawing-test'&&event.data.type==='image')window.drawReady=true;});document.querySelector('.ib-nmr-drawing iframe').contentWindow.postMessage({type:'render',smiles:'CCO',requestId:'nmr-drawing-test'},location.origin);});
  await page.waitForFunction(()=>window.drawReady,{timeout:30000});
  await editor.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.textContent==='保存结构').click());
  await page.waitForFunction(()=>!document.querySelector('.ib-nmr-drawing'));
  assert.match(await page.$eval('[data-nmr-input=structure]',node=>node.textContent),/已绘制分子结构/);
  assert.equal(await createDisabled(),false);
  assert.deepEqual(await page.evaluate(()=>[window.fixtureUploads,window.fixtureSaves]),[2,1]);
  await click('新建条目');await page.waitForFunction(()=>window.fixtureSaves===2);
  assert.equal(await page.evaluate(()=>window.fixturePrompts.length),2);
  await click('开始分析');await page.waitForFunction(()=>window.fixturePrompts.length===3);
  assert.deepEqual(await page.evaluate(()=>[window.fixtureUploads,window.fixtureSaves]),[3,2],'drawn structure creates no redundant structure upload');
  assert.equal(await page.$$eval('.ib-nmr-entry',nodes=>nodes.length),2);
  await page.click('.ib-nmr-entry',{button:'right'});await page.waitForSelector('[aria-label="核磁条目操作"]');
  await page.click('[aria-label="核磁条目操作"] [role="menuitem"]');await page.waitForSelector('[aria-label="删除核磁产出文件"]');
  assert.equal(await page.$$eval('.ib-nmr-delete-options input:checked',nodes=>nodes.length),0);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-nmr-delete-options label')].find(node=>node.textContent.includes('真实标峰')).querySelector('input').click());
  await click('取消');assert.equal(await page.evaluate(()=>window.fixtureDelete||null),null);
  await page.click('.ib-nmr-entry',{button:'right'});await page.click('[aria-label="核磁条目操作"] [role="menuitem"]');
  await page.evaluate(()=>[...document.querySelectorAll('.ib-nmr-delete-options label')].find(node=>node.textContent.includes('真实标峰')).querySelector('input').click());
  await click('删除所选文件');await page.waitForFunction(()=>!!window.fixtureDelete);
  assert.deepEqual(await page.evaluate(()=>window.fixtureDelete.deleteFiles),['spectrum']);
  assert.equal(await page.evaluate(()=>window.fixtureDelete.mode),'outputs');
  await page.click('.ib-nmr-entry',{button:'right'});await page.evaluate(()=>[...document.querySelectorAll('[aria-label="核磁条目操作"] [role="menuitem"]')].find(e=>e.textContent.includes('删除条目')).click());
  await page.waitForSelector('[aria-label="删除核磁条目"]');assert.match(await page.$eval('[aria-label="删除核磁条目"]',n=>n.textContent),/原始核磁数据、结构文件/);
  await click('取消');
  if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'nmr-workbench.png')});}
  assert.deepEqual(errors,[]);
 }catch(reason){if(output&&page){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'nmr-workbench-failure.png')}).catch(()=>{});}throw reason;}
 finally{await browser?.close().catch(()=>{});await new Promise(done=>server.close(done));rmSync(temp,{recursive:true,force:true});}
});
