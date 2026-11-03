/* global window, document, getComputedStyle, requestAnimationFrame, DataTransfer, DragEvent, MouseEvent, innerWidth, innerHeight */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { launchSystemBrowser, resolveBrowserExecutable } from './helpers/ketcher-page.mjs';
import { pdfDocumentStatePlugin } from '../../scripts/pdfjs-document-state.mjs';
import { pdfViewerStylePlugin } from '../../scripts/pdfjs-viewer-style.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const reactRoot = [process.env.IBM_READER_REACT_ROOT, join(repo, 'node_modules'), resolve(repo, '../../outputs/electron-next-p1/next/dsh-plugin-desktop/node_modules')].find(path => path && existsSync(join(path, 'react/package.json')));
const executable = resolveBrowserExecutable();

test('literature restores project folders, tabs and per-folder scroll after navigation and reload', { skip: !executable || !reactRoot, timeout: 90000 }, async () => {
 const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Project} from './client/src/components-project.js';
import {injectStyles} from './client/src/styles.js';
injectStyles();
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let folders=[{id:'nano',name:'纳米递送'},{id:'bio',name:'生物材料'}];
const reports=Array.from({length:40},(_,n)=>({id:'report-'+n,bundleId:'bundle-'+n,titleZh:'文献 '+(n+1)+'：用于测试分类与位置恢复的精读条目',shortCitation:'Journal '+(n+1),createdAt:'2026-10-20T00:00:00Z',folderId:n<24?'nano':n<36?'bio':undefined}));
const bundles=reports.map(row=>({id:row.bundleId,title:row.titleZh}));
bundles[2].pdfPath='paper.pdf';bundles[3].pdfPath='paper.docx';bundles[4].pdfPath='source-map.json';bundles[5].acquisitionStatus='ready';
bundles[0].acquisitionStatus='awaiting-pdf';bundles[0].siPath='existing-SI.pdf';
reports[0].sessionId='fine-reading-chat';bundles[1].translations=[{kind:'si',status:'completed',sessionId:'translation-chat'}];window.fixtureChats=[];
reports[2].shortCitation='3723-3726 (2020).';bundles[2].title='Dielectric profile of blood clots to inform ischemic stroke treatments';
reports[3].shortCitation='3723-3726 (2020).';bundles[3].journal='IEEE EMBC';bundles[3].pages='3723-3726';bundles[3].year=2020;
const searches=[{id:'search-1',title:'检索记录',createdAt:'2026-10-20T00:00:00Z',results:[{id:'p1',title:'First result'},{id:'p2',title:'Second result'},{id:'p3',title:'Third result'}]}];
let revision=0;const watchers=new Set();
window.fixtureRegister=()=>{reports.push({id:'live-report',bundleId:'live-bundle',titleZh:'实时登记的待精读文献',status:'pending',createdAt:new Date().toISOString()});bundles.push({id:'live-bundle',title:'实时登记的待精读文献'});revision++;for(const finish of [...watchers])finish(true);};
window.fixtureFinishPdf=()=>{for(const bundle of [...bundles])if(bundle.pdfIntake){if(bundle.pdfIntake.status==='rejected')continue;if(bundle.nonPaper){bundle.pdfIntake.status='rejected';bundle.pdfIntake.kind='non-paper';bundle.pdfIntake.error='这是发票，不是论文';bundle.pdfIntake.updatedAt=new Date().toISOString();reports.splice(reports.findIndex(row=>row.bundleId===bundle.id),1);continue;}if(bundle.siFor){bundles.find(row=>row.id===bundle.siFor).siPath='fixture-SI.pdf';reports.splice(reports.findIndex(row=>row.bundleId===bundle.id),1);bundles.splice(bundles.indexOf(bundle),1);continue;}bundle.pdfIntake.status='completed';const report=reports.find(row=>row.bundleId===bundle.id);report.shortCitation='Nature 630, 84–90 (2024).';report.titleZh='上传 PDF 的中文论文标题';bundle.entryStem='Nature 2024 Wang 文件命名 这是归档文件';}revision++;for(const finish of [...watchers])finish(true);};
window.fixturePdfUploads=0;
window.fixtureAttachMainText=()=>{bundles[0].pdfPath='uploaded-main.pdf';bundles[0].acquisitionStatus='ready';revision++;for(const finish of [...watchers])finish(true);};
window.fixtureMoves=[];window.fixtureDeletes=[];
const call=async(method,{request}={})=>{
 if(method==='tasks_overview')return {overview:{summary:'Fixture overview'}};
 if(method==='tasks_report_delete'){window.fixtureDeletes.push(request);reports.splice(reports.findIndex(row=>row.id===request.reportId),1);revision++;for(const finish of [...watchers])finish(true);return {};}
 if(method==='tasks_reading_move'){window.fixtureMoves.push(request);const moved=reports.filter(row=>request.reportIds.includes(row.id));if(Object.hasOwn(request,'folderId'))for(const row of moved)row.folderId=request.folderId||undefined;if(request.targetId){const rest=reports.filter(row=>!request.reportIds.includes(row.id)),index=rest.findIndex(row=>row.id===request.targetId);rest.splice(index+(request.position==='after'?1:0),0,...moved);reports.splice(0,reports.length,...rest);}revision++;for(const finish of [...watchers])finish(true);return {reports:[...reports]};}
 if(method==='tasks_search_import_ris'){const run={id:'ris-'+searches.length,title:request.fileName.replace(/\.ris$/i,''),results:[{id:'imported',title:'Dragged RIS paper'}],createdAt:new Date().toISOString()};searches.push(run);revision++;for(const finish of [...watchers])finish(true);return {run,duplicateCount:0};}
 if(method==='tasks_reading_pdf_upload'){window.fixturePdfUploads++;if(atob(request.base64).includes('NON_PAPER')){const existing=bundles.find(row=>row.nonPaper&&row.pdfIntake.status==='rejected');if(existing)return {bundle:existing,reused:true,rejected:true};}const reused=atob(request.base64).match(/REUSE (bundle-[0-9]+)/)?.[1];if(reused)return {bundle:bundles.find(row=>row.id===reused),report:reports.find(row=>row.bundleId===reused),reused:true};const id='pdf-'+bundles.length;const bundle={id,title:request.name,nonPaper:atob(request.base64).includes('NON_PAPER'),siFor:atob(request.base64).match(/SUPPORTING_INFORMATION (pdf-[0-9]+)/)?.[1],pdfIntake:{status:'running',originalFileName:request.name,stage:'正在识别文献信息'}};const report={id:'report-'+id,bundleId:id,createdAt:new Date().toISOString()};reports.push(report);bundles.push(bundle);revision++;for(const finish of [...watchers])finish(true);return {bundle,report};}
 if(method==='projects_watch'){if(request.revision!==String(revision))return {changed:true,revision:String(revision)};return new Promise(resolve=>{let timer;const finish=changed=>{clearTimeout(timer);watchers.delete(finish);resolve({changed,revision:String(revision)});};watchers.add(finish);timer=setTimeout(()=>finish(false),10000);});}
 if(method==='projects_workspace'){await wait(30);return {revision:String(revision),project:{id:request.projectId,name:'课题 '+request.projectId,memoryVersion:1},memory:{markdown:''},capabilities:{literature:true,design:true,analysis:true},literature:{reports:[...reports],bundles:[...bundles],searches:[...searches],presentations:[]},planning:{}};}
 if(method==='tasks_reading_folders'){await wait(80);return {folders:[...folders]};}
 if(method==='literature_status')return {browserMode:'managed-edge'};
 if(method==='tasks_reading_folder_delete'){folders=folders.filter(row=>row.id!==request.id);for(const row of reports)if(row.folderId===request.id)delete row.folderId;return {};}
 throw Error('Unexpected fixture API: '+method);
};
function App(){const [id,setId]=React.useState('A');window.fixtureOpen=setId;return id?React.createElement(Project,{key:id,project:{id},call,onBack:()=>setId(null),onDelete:async()=>{},onStartChat:async(project,options)=>{if(window.fixtureChatError)throw Error('会话启动测试失败');window.fixtureChats.push({projectId:project.id,...options});}}):React.createElement('div',null,'课题已关闭');}
window.confirm=()=>true;
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
 const built = await esbuild.build({ stdin: { contents: fixture, resolveDir: repo, sourcefile: 'literature-state-fixture.js' }, bundle: true, format: 'iife', platform: 'browser', write: false, target: ['chrome110'], nodePaths: [reactRoot], logLevel: 'silent', plugins: [
  // The navigation destinations do not participate in literature persistence.
  { name: 'other-workspaces', setup(build) { build.onLoad({ filter: /[\\/]components-(workspace|characterization)\.js$/ }, ({ path }) => ({ contents: path.endsWith('components-workspace.js') ? 'export function ResearchDesignWorkspace(){return "研究设计内容"}' : 'export function CharacterizationPanel(){return "表征内容"}', loader: 'js' })); } },
  pdfDocumentStatePlugin(), pdfViewerStylePlugin(), { name: 'pdf-worker-source', setup(build) { build.onLoad({ filter: /pdf\.worker\.mjs$/ }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' })); } }
 ] });
 const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(built.outputFiles[0].text); }
  else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head><title>iBM Lab literature check</title></head><body style="margin:0"><div id="scroll" class="ib-overlay ib-panel-embed" style="position:relative;height:650px;width:1050px;overflow:auto"><main id="root" class="ib-main"></main></div><script src="/fixture.js"></script></body></html>'); }
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 let browser, page;
 const errors = [];
 const output = process.env.IBM_LITERATURE_BROWSER_OUTPUT;
 try {
  browser = await launchSystemBrowser(puppeteer, executable, { headless: 'new', defaultViewport: { width: 1150, height: 800 } });
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'load' });
  const selected = id => page.waitForFunction(id => [...document.querySelectorAll('.ib-reading-folders button')].some(node => node.textContent.includes(id) && node.dataset.selected === 'true'), {}, id);
  const click = async text => { await page.waitForFunction(text => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === text || node.textContent.startsWith(text)), {}, text); await page.evaluate(text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.textContent.startsWith(text)).click(), text); };
  const scroll = async position => { await page.evaluate(position => { document.getElementById('scroll').scrollTop = position; }, position); await page.waitForFunction(position => Math.abs(document.getElementById('scroll').scrollTop - position) < 2, {}, position); await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); };
  const restored = position => page.waitForFunction(position => Math.abs(document.getElementById('scroll').scrollTop - position) < 2, {}, position);
  const reopen = async id => { await page.evaluate(() => window.fixtureOpen(null)); await page.waitForFunction(() => !document.querySelector('.ib-project-head')); await page.evaluate(id => window.fixtureOpen(id), id); };
  await selected('全部');
  await page.click('[data-bundle-id="bundle-0"] [aria-label="打开科研助手对话"]');
  await page.waitForFunction(()=>window.fixtureChats.length===1);
  assert.deepEqual(await page.evaluate(()=>window.fixtureChats[0]),{projectId:'A',openSessionId:'fine-reading-chat',entryIdentity:{kind:'reading',reportId:'report-0',bundleId:'bundle-0'},entryOpenOnly:true,preserveDraft:true});
  await page.click('[data-bundle-id="bundle-1"] [aria-label="打开科研助手对话"]');
  await page.waitForFunction(()=>window.fixtureChats.length===2);
  assert.equal(await page.evaluate(()=>window.fixtureChats[1].openSessionId),'translation-chat');
  assert.equal(await page.$eval('[data-bundle-id="bundle-2"] [aria-label="打开科研助手对话"]',node=>node.disabled),true);
  for(const index of [0,1,4,5])for(const action of ['精读','PPT']){
   assert.equal(await page.$eval('[data-bundle-id="bundle-'+index+'"] [aria-label="'+action+'"]',node=>node.disabled),true,'metadata, SI, JSON or ready status alone must not enable '+action);
   assert.match(await page.$eval('[data-bundle-id="bundle-'+index+'"] [aria-label="'+action+'"]',node=>node.title),/正文/);
   await page.click('[data-bundle-id="bundle-'+index+'"] [aria-label="'+action+'"]');
  }
  assert.equal(await page.evaluate(()=>window.fixtureChats.length),2,'disabled actions cannot launch task chats');
  for(const index of [2,3])for(const action of ['精读','PPT'])assert.equal(await page.$eval('[data-bundle-id="bundle-'+index+'"] [aria-label="'+action+'"]',node=>node.disabled),false,'archived PDF/DOCX enables '+action);
  await page.click('[data-bundle-id="bundle-2"] [aria-label="精读"]');
  await page.waitForFunction(()=>window.fixtureChats.length===3);
  assert.deepEqual(await page.evaluate(()=>window.fixtureChats[2].readingIdentity),{reportId:'report-2'});
  assert.equal(await page.evaluate(()=>window.fixtureChats[2].freshSession),false);
  assert.equal(await page.$eval('[data-bundle-id="bundle-2"] .ib-lit-title',node=>node.textContent),'Dielectric profile of blood clots to inform ischemic stroke treatments');
  assert.equal(await page.$eval('[data-bundle-id="bundle-3"] .ib-lit-title',node=>node.textContent),'IEEE EMBC 3723–3726 (2020).');
  assert.equal(await page.$eval('[data-bundle-id="bundle-3"] .ib-lit-title i',node=>node.textContent),'IEEE EMBC');
  assert.equal(await page.$eval('input[aria-label="上传精读文献"]',node=>node.accept.includes('.docx')),true);
  assert.equal(await page.$$eval('.ib-group-head button',nodes=>nodes.some(node=>node.textContent==='上传文献')),true);
  assert.equal(await page.$$eval('.ib-group-head button',nodes=>nodes.some(node=>node.textContent==='上传 PDF')),false);
  // Link intake uses the existing project task chat and automatically submits it.
  await click('上传链接');
  await page.waitForSelector('form[aria-label="上传文献链接"]');
  assert.equal(await page.$eval('form[aria-label="上传文献链接"] button[type=submit]',node=>node.disabled),true);
  await page.type('form[aria-label="上传文献链接"] input','file:///C:/paper.pdf');
  await click('开始解析');
  await page.waitForFunction(()=>document.querySelector('form[aria-label="上传文献链接"] [role=alert]')?.textContent.includes('HTTP'));
  assert.equal(await page.evaluate(()=>window.fixtureChats.length),3,'invalid protocols must not launch a chat');
  await page.$eval('form[aria-label="上传文献链接"] input',node=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(node,'https://doi.org/10.1038/example');node.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(()=>{window.fixtureChatError=true;});
  await click('开始解析');
  await page.waitForFunction(()=>document.querySelector('form[aria-label="上传文献链接"] [role=alert]')?.textContent.includes('会话启动测试失败'));
  assert.equal(await page.$eval('form[aria-label="上传文献链接"] input',node=>node.value),'https://doi.org/10.1038/example','failed dispatch retains the URL for retry');
  await page.evaluate(()=>{window.fixtureChatError=false;const form=document.querySelector('form[aria-label="上传文献链接"]');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>window.fixtureChats.length===4);
  const linkTask=await page.evaluate(()=>window.fixtureChats[3]);
  assert.equal(linkTask.projectId,'A');assert.equal(linkTask.autoSubmit,true);assert.equal(linkTask.freshSession,true);
  assert.match(linkTask.prompt,/https:\/\/doi.org\/10.1038\/example/);
  assert.match(linkTask.prompt,/lab_tasks_register_paper_meta/);
  assert.match(linkTask.prompt,/Crossref\/OpenAlex/);
  assert.match(linkTask.prompt,/projectId: "A"/);
  await page.waitForFunction(()=>!document.querySelector('form[aria-label="上传文献链接"]'));
  await click('上传链接');
  await page.type('form[aria-label="上传文献链接"] input','https://mp.weixin.qq.com/s/test-paper');
  if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'literature-link-upload.png')});}
  await click('开始解析');
  await page.waitForFunction(()=>window.fixtureChats.length===5);
  const wechatTask=await page.evaluate(()=>window.fixtureChats[4]);
  assert.match(wechatTask.prompt,/lab_tasks_fetch_wechat_article/);
  assert.match(wechatTask.prompt,/lab_tasks_resolve_wechat_doi/);
  assert.match(wechatTask.prompt,/lab_tasks_register_wechat_paper/);
  assert.equal(wechatTask.autoSubmit,true);
  await page.evaluate(()=>window.fixtureAttachMainText());
  await page.waitForFunction(()=>!document.querySelector('[data-bundle-id="bundle-0"] [aria-label="精读"]').disabled&&!document.querySelector('[data-bundle-id="bundle-0"] [aria-label="PPT"]').disabled);
  const actions=await page.$$eval('[data-report-id="report-2"] .ib-reading-acts button',nodes=>nodes.map(node=>({name:node.getAttribute('aria-label'),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,icon:!!node.querySelector('svg'),text:node.textContent.trim(),hint:!!node.title})));
  assert.equal(actions.length,7);
  assert.deepEqual(actions.slice(2).map(row=>row.name),['简介','翻译','精读','PPT','打开科研助手对话']);
  assert.ok(actions.every(row=>row.width===actions[0].width&&row.height===actions[0].height&&row.icon&&!row.text&&row.hint),'all actions use file-button dimensions, icons and hover descriptions');
  assert.equal(await page.$('.ib-lit-flag'),null,'archival status should use file icons, without the removed permanent hint');
  assert.equal(await page.$eval('.ib-lit',node=>node.textContent.includes('SI 已归档 · 正文待归档')),false);
  // A committed registration must appear in the mounted panel without navigation or a manual reload.
  await page.evaluate(() => window.fixtureRegister());
  await page.waitForFunction(() => document.querySelector('.ib-lit')?.textContent.includes('实时登记的待精读文献'), { timeout: 1500 });
  await page.evaluate(() => { const target=document.querySelector('.ib-search-drop'),files=new DataTransfer();files.items.add(new File(['TY  - JOUR\nER  -\n'],'拖拽检索.ris',{type:'application/x-research-info-systems'}));target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:files})); });
  await page.waitForSelector('.ib-search-drop[data-dragging=true]');
  await page.evaluate(() => { const target=document.querySelector('.ib-search-drop'),files=new DataTransfer();files.items.add(new File(['TY  - JOUR\nER  -\n'],'拖拽检索.ris',{type:'application/x-research-info-systems'}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files})); });
  await page.waitForFunction(()=>document.querySelector('.ib-search-drop')?.textContent.includes('拖拽检索'));
  assert.equal(await page.$('.ib-search-drop[data-dragging=true]'),null);
  // Both picker and drop use the real component, retaining a busy row until the
  // independently completed worker supplies citation + translated title.
  await page.evaluate(() => { const input=document.querySelector('input[aria-label="上传精读文献"]'),files=new DataTransfer();files.items.add(new File(['%PDF-1.4\n%%EOF'],'picker.pdf',{type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.waitForSelector('.ib-pdf-processing[data-intake-state=running]');
  assert.equal(await page.$eval('.ib-pdf-processing',node=>node.getAttribute('aria-busy')), 'true');
  assert.ok(await page.$('.ib-pdf-processing svg'));
  await page.evaluate(() => { const target=document.querySelector('.ib-reading-drop'),files=new DataTransfer();files.items.add(new File(['%PDF-1.4\n%%EOF'],'drop.pdf',{type:'application/pdf'}));target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:files})); });
  await page.waitForSelector('.ib-reading-drop[data-dragging=true]');
  await page.evaluate(() => { const target=document.querySelector('.ib-reading-drop'),files=new DataTransfer();files.items.add(new File(['%PDF-1.4\n%%EOF'],'drop.pdf',{type:'application/pdf'}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files})); });
  await page.waitForFunction(()=>document.querySelectorAll('.ib-pdf-processing[data-intake-state=running]').length===2);
  await page.evaluate(()=>window.fixtureFinishPdf());
  await page.waitForFunction(()=>document.querySelectorAll('.ib-lit-item[data-intake-state=completed]').length===2);
  await page.waitForFunction(()=>!document.querySelector('.ib-pdf-processing'));
  const importedText=await page.$eval('.ib-lit-item[data-intake-state=completed]',node=>node.innerText);
  assert.match(importedText,/Nature 630/);assert.match(importedText,/上传 PDF 的中文论文标题/);assert.doesNotMatch(importedText,/文件命名/);
  assert.equal(await page.$('input[aria-label="上传 SI PDF"]'),null);
  assert.equal(await page.$$eval('.ib-reading-drop button',nodes=>nodes.some(node=>/上传 SI|替换 SI/.test(node.textContent))),false);
  await page.evaluate(()=>{const id=document.querySelector('.ib-lit-item[data-intake-state=completed]').dataset.bundleId,picker=document.querySelector('input[aria-label="上传精读文献"]'),files=new DataTransfer();files.items.add(new File(['SUPPORTING_INFORMATION '+id],'opaque.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));picker.files=files.files;picker.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForSelector('.ib-pdf-processing[data-intake-state=running]');await page.evaluate(()=>window.fixtureFinishPdf());
  await page.waitForFunction(()=>document.querySelector('.ib-lit-item[data-intake-state=completed] button[aria-label="SI 补充材料 / 获取 SI"]')?.dataset.ready==='true');
  await page.evaluate(()=>{const entries=document.querySelectorAll('.ib-lit-item[data-intake-state=completed]'),files=new DataTransfer();files.items.add(new File(['SUPPORTING_INFORMATION '+entries[1].dataset.bundleId],'paper SI.DOCX',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));entries[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files}));});
  await page.waitForSelector('.ib-pdf-processing[data-intake-state=running]');await page.evaluate(()=>window.fixtureFinishPdf());
  await page.waitForFunction(()=>[...document.querySelectorAll('.ib-lit-item[data-intake-state=completed] button[aria-label="SI 补充材料 / 获取 SI"]')].every(button=>button.dataset.ready==='true'));
  assert.equal(await page.$$eval('.ib-lit-item[data-intake-state=completed]',nodes=>nodes.length),2,'SI uploads must attach to existing rows');
  await page.waitForFunction(()=>!document.querySelector('.ib-pdf-processing'));
  assert.equal(await page.evaluate(()=>window.fixturePdfUploads),4,'paper and SI both use the unified PDF API');
  assert.equal(await page.$('.ib-scientific-browser'), null);
  await page.mouse.move(1140,780);
  const colors = await page.$$eval('.ib-lit-group:last-child .ib-lit-item', nodes => nodes.slice(0, 3).map(node => getComputedStyle(node).backgroundColor));
  assert.equal(colors[0], 'rgb(255, 255, 255)'); assert.notEqual(colors[0], colors[1]); assert.equal(colors[0], colors[2]);
  await click('📁 纳米递送'); await selected('纳米递送'); await scroll(850);
  await reopen('A'); await selected('纳米递送'); await restored(850);
  await click('📁 生物材料'); await selected('生物材料'); await scroll(340);
  await click('📁 纳米递送'); await selected('纳米递送'); await restored(850);
  await click('研究设计'); await page.waitForFunction(() => !document.querySelector('.ib-lit'));
  await reopen('A'); await page.waitForFunction(() => document.querySelector('.ib-tab[data-active=true]')?.textContent === '研究设计');
  await click('文献资料'); await selected('纳米递送'); await restored(850);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-search-drop .ib-lit-item')].find(node=>node.querySelector('.ib-lit-title')?.textContent==='检索记录').querySelector('button').click()); await page.waitForSelector('.ib-search-results');
  const paperColors = await page.$$eval('.ib-search-paper', nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  assert.notEqual(paperColors[0], paperColors[1]); assert.equal(paperColors[0], paperColors[2]);
  await scroll(970); await reopen('B'); await selected('全部'); await restored(0);
  await click('📁 生物材料'); await selected('生物材料'); await scroll(210);
  await reopen('A'); await selected('纳米递送'); await restored(970); await page.waitForSelector('.ib-search-results');
  await page.reload({ waitUntil: 'load' }); await selected('纳米递送'); await restored(970); await page.waitForSelector('.ib-search-results');
  // Embedded sidebar layout must retain the same state when narrowed.
  await page.evaluate(() => { document.getElementById('scroll').style.width = '480px'; });
  await scroll(650); await reopen('A'); await selected('纳米递送'); await restored(650);
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'literature-folders-alternating-rows.png') }); }
  await click('删除文件夹'); await selected('未分类');
  await reopen('A'); await selected('未分类');
  // Invalid local state and unavailable storage both leave navigation usable.
  await page.evaluate(() => { localStorage.setItem('ib-project-view:C:reading-folder', '{broken'); window.fixtureOpen('C'); });
  await selected('全部');
  await page.evaluate(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('Storage disabled'); } }); });
  await click('📁 生物材料'); await selected('生物材料'); await scroll(220);
  await reopen('C'); await selected('生物材料'); await restored(220);
  const beforeDuplicate=await page.$$eval('.ib-reading-drop [data-bundle-id]',nodes=>nodes.length);
  assert.equal(await page.$('[data-bundle-id="bundle-23"]'),null,'duplicate target starts outside the selected folder');
  await page.evaluate(()=>{const files=new DataTransfer();files.items.add(new File(['REUSE bundle-23'],'already-uploaded.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));document.querySelector('.ib-reading-drop').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files}));});
  await selected('全部');
  await page.waitForSelector('[data-bundle-id="bundle-23"][data-located=true]');
  await page.waitForFunction(()=>{const row=document.querySelector('[data-bundle-id="bundle-23"]'),host=document.getElementById('scroll'),r=row.getBoundingClientRect(),h=host.getBoundingClientRect();return r.top>=h.top&&r.bottom<=h.bottom;});
  assert.equal(await page.$eval('[data-bundle-id="bundle-23"]',node=>getComputedStyle(node).animationName),'ib-lit-locate');
  assert.ok(await page.$$eval('.ib-reading-drop [data-bundle-id]',nodes=>nodes.length)>beforeDuplicate,'switching folders reveals existing items');
  const allCount=await page.$$eval('.ib-reading-drop [data-bundle-id]',nodes=>nodes.length);
  await page.waitForFunction(()=>!document.querySelector('[data-located=true]'));
  await page.evaluate(()=>{const input=document.querySelector('input[aria-label="上传精读文献"]'),files=new DataTransfer();files.items.add(new File(['REUSE bundle-23'],'same-again.pdf',{type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForSelector('[data-bundle-id="bundle-23"][data-located=true]');
  assert.equal(await page.$$eval('.ib-reading-drop [data-bundle-id]',nodes=>nodes.length),allCount,'repeated picker upload must reuse, not add a row');
  await page.evaluate(()=>{const input=document.querySelector('input[aria-label="上传精读文献"]'),files=new DataTransfer();files.items.add(new File(['NON_PAPER'],'invoice.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForSelector('.ib-pdf-processing');await page.evaluate(()=>window.fixtureFinishPdf());
  await page.waitForSelector('.ib-non-paper-notice');
  const noticeStarted=Date.now();
  assert.match(await page.$eval('.ib-non-paper-notice',node=>node.textContent),/该文件不是论文或补充材料.*invoice.docx/);
  assert.deepEqual(await page.$eval('.ib-non-paper-notice',node=>({duration:getComputedStyle(node).animationDuration,iterations:getComputedStyle(node).animationIterationCount})),{duration:'1s',iterations:'3'});
  assert.equal(await page.$$eval('.ib-reading-drop [data-bundle-id]',nodes=>nodes.length),allCount,'non-paper temporary row must be removed');
  await page.waitForFunction(()=>!document.querySelector('.ib-non-paper-notice'),{timeout:5000});
  assert.ok(Date.now()-noticeStarted>=2800,'the notice remains for three seconds');
  await page.evaluate(()=>{const files=new DataTransfer();files.items.add(new File(['NON_PAPER'],'same-invoice.pdf',{type:'application/pdf'}));document.querySelector('.ib-reading-drop').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files}));});
  await page.waitForSelector('.ib-non-paper-notice');
  assert.equal(await page.$$eval('.ib-reading-drop [data-bundle-id]',nodes=>nodes.length),allCount,'re-uploaded non-papers remain outside the literature list');
  await page.click('[data-report-id="report-1"] .ib-lit-title');
  await page.keyboard.down('Shift');await page.click('[data-report-id="report-3"] .ib-lit-title');await page.keyboard.up('Shift');
  assert.deepEqual(await page.$$eval('.ib-lit-item[data-selected=true]',nodes=>nodes.map(n=>n.dataset.reportId)),['report-1','report-2','report-3']);
  assert.equal(await page.$eval('.ib-lit-item[data-selected=true]',node=>getComputedStyle(node).backgroundColor),'rgb(226, 244, 241)');
  await page.$eval('[data-report-id="report-2"] button[title="展开文献概览"]',node=>node.click());
  await page.waitForFunction(()=>document.querySelector('[data-report-id="report-2"] .ib-lit-overview')?.textContent.includes('Fixture overview'));
  assert.equal(await page.$$eval('.ib-lit-item[data-selected=true]',nodes=>nodes.length),3,'using an entry control must not replace the selection');
  assert.equal(await page.$('.ib-reading-selection'),null);
  assert.equal(await page.$('.ib-reading-drop .ib-lit-item select'),null);
  assert.equal(await page.$$eval('.ib-reading-drop .ib-lit-item button',nodes=>nodes.some(n=>n.textContent==='删除')),false);
  await page.click('[data-report-id="report-2"] .ib-lit-title',{button:'right'});
  await page.waitForSelector('[role=menuitem]');
  assert.equal(await page.$eval('[role=menuitem]',node=>node.textContent),'删除选中的 3 篇');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.ib-reading-context-menu'));
  assert.equal(await page.$$eval('.ib-lit-item[data-selected=true]',nodes=>nodes.length),3);
  const startDrag=async(source,target,after=false)=>page.evaluate(({source,target,after})=>{
   const from=document.querySelector('[data-report-id="'+source+'"]'),to=document.querySelector(target),rect=to.getBoundingClientRect();window.fixtureEntryDrag=new DataTransfer();
   from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:window.fixtureEntryDrag,clientY:from.getBoundingClientRect().top+20}));
   to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.fixtureEntryDrag,clientY:after?rect.bottom-2:rect.top+2}));
  },{source,target,after});
  const finishDrag=async(target,after=false)=>page.evaluate(({target,after})=>{const to=document.querySelector(target),rect=to.getBoundingClientRect();to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:window.fixtureEntryDrag,clientY:after?rect.bottom-2:rect.top+2}));},{target,after});
  await startDrag('report-2','[data-report-id="report-5"]',true);
  await page.waitForSelector('[data-report-id="report-5"][data-drop-position=after]');
  await finishDrag('[data-report-id="report-5"]',true);
  await page.waitForFunction(()=>[...document.querySelectorAll('.ib-reading-drop [data-report-id]')].slice(0,6).map(n=>n.dataset.reportId).join(',')==='report-0,report-4,report-5,report-1,report-2,report-3');
  assert.deepEqual(await page.evaluate(()=>window.fixtureMoves.at(-1).reportIds),['report-1','report-2','report-3']);
  await startDrag('report-2','[data-folder-id="bio"]');await page.waitForSelector('[data-folder-id="bio"][data-drop-folder=true]');
  await finishDrag('[data-folder-id="bio"]');await selected('生物材料');
  await page.waitForFunction(()=>document.querySelectorAll('.ib-lit-item[data-selected=true]').length===3);
  assert.equal(await page.evaluate(()=>window.fixtureMoves.at(-1).folderId),'bio');
  await startDrag('report-2','[data-folder-id="unfiled"]');await finishDrag('[data-folder-id="unfiled"]');await selected('未分类');
  assert.equal(await page.evaluate(()=>window.fixtureMoves.at(-1).folderId),null);
  await click('全部');await selected('全部');assert.equal(await page.$$eval('.ib-lit-item[data-selected=true]',nodes=>nodes.length),0);
  await startDrag('report-5','[data-report-id="report-0"]');await finishDrag('[data-report-id="report-0"]');
  await page.waitForFunction(()=>document.querySelector('.ib-reading-drop [data-report-id]')?.dataset.reportId==='report-5');
  assert.deepEqual(await page.evaluate(()=>window.fixtureMoves.at(-1).reportIds),['report-5']);
  assert.equal(await page.$('.ib-reading-drop[data-dragging=true]'),null,'entry dragging must not activate file-upload handling');
  await page.waitForFunction(()=>!document.querySelector('[data-located=true]'));
  // Menus stay inside the viewport, dismiss outside and delete only the chosen entries.
  await page.$eval('[data-report-id="report-4"]',node=>node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1148,clientY:798})));
  await page.waitForSelector('.ib-reading-context-menu');
  assert.equal(await page.$eval('[role=menuitem]',node=>node.textContent),'删除');
  assert.deepEqual(await page.$$eval('.ib-lit-item[data-selected=true]',nodes=>nodes.map(n=>n.dataset.reportId)),['report-4']);
  assert.equal(await page.$eval('.ib-reading-context-menu',node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),true);
  await page.click('h3');await page.waitForFunction(()=>!document.querySelector('.ib-reading-context-menu'));
  await page.click('[data-report-id="report-4"] .ib-lit-title',{button:'right'});await page.waitForSelector('[role=menuitem]');
  await page.evaluate(()=>window.confirm=()=>false);await page.click('[role=menuitem]');
  assert.equal(await page.evaluate(()=>window.fixtureDeletes.length),0,'cancel retains the row');
  await page.click('[data-report-id="report-1"] .ib-lit-title');
  await page.keyboard.down('Control');await page.click('[data-report-id="report-3"] .ib-lit-title');await page.keyboard.up('Control');
  await page.click('[data-report-id="report-1"] .ib-lit-title',{button:'right'});await page.waitForSelector('[role=menuitem]');
  assert.equal(await page.$eval('[role=menuitem]',node=>node.textContent),'删除选中的 2 篇');
  if(output)await page.screenshot({path:join(output,'literature-green-context-menu.png')});
  await page.evaluate(()=>window.confirm=()=>true);await page.click('[role=menuitem]');
  await page.waitForFunction(()=>!document.querySelector('[data-report-id="report-1"]')&&!document.querySelector('[data-report-id="report-3"]'));
  assert.deepEqual(await page.evaluate(()=>window.fixtureDeletes.map(row=>row.reportId)),['report-1','report-3']);
  assert.equal(await page.$$eval('.ib-lit-item[data-selected=true]',nodes=>nodes.length),0);

  assert.deepEqual(errors, []);
 } catch (error) {
  if (output && page) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'literature-state-failure.png') }).catch(() => {}); }
  throw error;
 } finally { await browser?.close().catch(() => {}); await new Promise(done => server.close(done)); }
});
