import {pdfDocumentStatePlugin} from '../../scripts/pdfjs-document-state.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import {launchSystemBrowser,resolveBrowserExecutable} from './helpers/ketcher-page.mjs';
import {pdfViewerStylePlugin} from '../../scripts/pdfjs-viewer-style.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const reactRoot=[process.env.IBM_READER_REACT_ROOT,join(repo,'node_modules'),resolve(repo,'../../outputs/electron-next-p1/next/dsh-plugin-desktop/node_modules')].find(path=>path&&existsSync(join(path,'react/package.json')));
const executable=resolveBrowserExecutable();
function fixturePdf(label,translated=false,count=30){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],kids=[];
 for(let n=1;n<=count;n++){
  const pageId=objects.length+1,contentId=pageId+1,height=(translated?920:842)+(n%5===0?120:0);kids.push(pageId+' 0 R');
  let content=`BT /F1 18 Tf 50 ${height-60} Td (${label} page ${n}) Tj ET\nBT /F1 11 Tf 50 ${height-90} Td (Continuous paper preview with selectable text.) Tj ET\n0.12 0.45 0.58 rg\n`;
  for(let i=0;i<1000;i++)content+=`${50+i%25*19} ${100+Math.floor(i/25)*14} 12 7 re f\n`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
 }
 objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf).toString('base64');
}
test('translation preview stays responsive while loading, preserves canvases and synchronizes logical PDF positions',{skip:!executable||!reactRoot,timeout:120000},async()=>{
 const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ReaderBody,readerStyles} from './client/src/reader-pdf-ui.js';
import {setReaderRuntime,readerAddress} from './client/src/reader-tab.js';
import {pdfPosition} from './client/src/reader-scroll-sync.js';
import {installDesktopClient} from './client/src/desktop-client.js';
window.fixtureSaved=[];installDesktopClient(async(method,args)=>{if(method==='desktop_status')return {available:true};if(method==='desktop_artifact'){window.fixtureSaved.push(args.request);return {fileName:args.request.url.includes('kind=report')?'notes.docx':'slides.pptx'};}throw Error('unexpected desktop action');});
const style=document.createElement('style');style.textContent=readerStyles;document.head.append(style);
const files={original:atob(${JSON.stringify(fixturePdf('Original'))}),si:atob(${JSON.stringify(fixturePdf('SI',false,3))}),report:atob(${JSON.stringify(fixturePdf('Reading notes',false,2))}),ppt:atob(${JSON.stringify(fixturePdf('Presentation',false,4))}),zh:atob(${JSON.stringify(fixturePdf('Translated',true))})};
const translation={id:'translated',status:'completed',pdfWarnings:Array.from({length:2000},()=> '图片译文字号较小，请放大阅读')};
window.fixtureCalls=[];window.fixturePages=[];window.fixturePosition=side=>pdfPosition(document.querySelector('[data-pdf-side="'+side+'"]'));
const WorkerClass=window.Worker;window.Worker=class extends WorkerClass{postMessage(message,...rest){if(message?.action==='GetPage')window.fixturePages.push(message.data.pageIndex);return super.postMessage(message,...rest);}};
const wait=ms=>new Promise(done=>setTimeout(done,ms));
setReaderRuntime({call:async(method,{request})=>{
 window.fixtureCalls.push({method,kind:request?.kind,translationId:request?.translationId,materialId:request?.materialId});
 if(method==='tasks_reader_open'){const side=request.materialId?.startsWith('report:')?'report':request.materialId?.startsWith('ppt:')?'ppt':request.translationId?'zh':request.kind==='si'?'si':'original';await wait(side==='zh'?700:20);return {lease:side,bytes:files[side].length,format:'pdf',fileName:side+'.pdf',title:'翻译预览流畅性验收',translation,completedTranslation:translation};}
 if(method==='tasks_translation_read')return {translation};
 if(method==='tasks_reader_chunk'){await wait(request.lease==='zh'?120:20);if(request.lease==='zh'&&window.fixtureFailTranslationOnce){window.fixtureFailTranslationOnce=false;throw Error('Fixture translation read failure');}return {base64:btoa(files[request.lease].slice(request.offset,request.offset+request.length))};}
 if(method==='tasks_reader_materials')return {materials:[{id:'pdf',label:'原文 PDF',format:'pdf',kind:'pdf'},{id:'si',label:'SI PDF',format:'pdf',kind:'si'},{id:'translation:translated',label:'翻译 PDF',format:'pdf',kind:'pdf',translationId:'translated'},{id:'report:notes',label:'精读笔记',format:'pdf',officeKind:'docx',reportId:'notes'},{id:'ppt:slides',label:'PPT',format:'pdf',officeKind:'pptx',reportId:'notes'}]};
 if(method==='tasks_reader_asset')return {base64:await(await fetch('/assets/'+request.group+'/'+request.name)).text()};
 return {};
},translate:async()=>{}});
const address=readerAddress({projectId:'fixture',bundleId:'paper'});const root=createRoot(document.getElementById('root'));window.disposeReader=()=>root.unmount();
window.refreshReader=()=>window.dispatchEvent(new CustomEvent('ibm-reader-open',{detail:{address}}));
root.render(React.createElement(ReaderBody,{useTabInfo:()=>({tab:{contentId:address}})}));
`;
 const built=await esbuild.build({stdin:{contents:fixture,resolveDir:repo,sourcefile:'reader-preview-fixture.js'},bundle:true,format:'iife',platform:'browser',write:false,target:['chrome110'],nodePaths:[reactRoot],plugins:[pdfDocumentStatePlugin(),pdfViewerStylePlugin(),{name:'pdf-worker-source',setup(build){build.onLoad({filter:/pdf\.worker\.mjs$/},async args=>({contents:readFileSync(args.path,'utf8'),loader:'text'}));}}],logLevel:'silent'});
 const server=createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(built.outputFiles[0].text);}
  else if(req.url?.startsWith('/assets/')){try{const path=resolve(repo,'client/vendor/pdfjs',req.url.slice(8));assert.ok(path.startsWith(resolve(repo,'client/vendor/pdfjs')));res.end(readFileSync(path).toString('base64'));}catch{res.writeHead(404).end();}}
  else{res.writeHead(200,{'content-type':'text/html'});res.end('<html><head><title>Reader preview fixture</title></head><body style="margin:0;height:100vh;overflow:hidden"><div id="root" style="width:860px;height:100%;max-width:100vw"></div><script src="/fixture.js"></script></body></html>');}
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser,page;const errors=[],checks=[];const evidence={ok:false,checks,errors};
 const output=process.env.IBM_READER_BROWSER_OUTPUT;
 try{
  browser=await launchSystemBrowser(puppeteer,executable,{headless:'new',defaultViewport:{width:1280,height:900}});page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load'});
  const click=label=>page.evaluate(label=>[...document.querySelectorAll('.ib-reader-controls button')].find(node=>node.textContent===label).click(),label);
  const ready=()=>page.waitForFunction(()=>!document.querySelector('.ib-reader-view-status')&&!!document.querySelector('.ib-reader-controls'),{timeout:15000});
  const setPosition=(side,n,fraction=0)=>page.evaluate(({side,n,fraction})=>{const flow=document.querySelector('[data-pdf-side="'+side+'"]'),item=flow.querySelector('[data-pdf-page="'+n+'"]');flow.scrollTop=item.offsetTop+item.offsetHeight*fraction-12;},{side,n,fraction});
  const aligned=async n=>{
   await page.waitForFunction(n=>{const a=window.fixturePosition('original'),b=window.fixturePosition('zh');return a.page===n&&b.page===n&&Math.abs(a.fraction-b.fraction)<.004;},{timeout:15000},n);await ready();
   const snapshot=await page.evaluate(()=>({original:window.fixturePosition('original'),zh:window.fixturePosition('zh')}));assert.equal(snapshot.original.page,snapshot.zh.page);assert.ok(Math.abs(snapshot.original.fraction-snapshot.zh.fraction)<.004);return snapshot;
  };
  await ready();await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"] .ib-reader-text-layer').innerText.includes('Original page 1'));
  evidence.initialPagesRequested=await page.evaluate(()=>window.fixturePages.length);assert.ok(evidence.initialPagesRequested<8,'PDF metadata should load near the viewport, not all 30 pages');
  assert.equal(await page.$$eval('.ib-reader-status',nodes=>nodes.length),0);assert.equal(await page.evaluate(()=>document.body.innerText.includes('字号较小')),false);
  await page.evaluate(()=>{window.originalFlow=document.querySelector('[data-pdf-side="original"]');window.originalPage=window.originalFlow.querySelector('[data-pdf-page="1"]');});
  checks.push('long-PDF-only-loads-nearby-pages','repeated-font-warnings-do-not-obscure-preview');
  await click('中文');await page.waitForSelector('[data-reader-mode="zh"] .ib-reader-spinner');
  assert.equal(await page.$eval('.ib-reader-view-status .ib-reader-spinner',node=>getComputedStyle(node).animationName),'ib-reader-spin');
  await click('原文');await click('全屏对照');await click('中文');await ready();
  assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(row=>row.method==='tasks_reader_open'&&row.translationId).length),1);
  assert.equal(await page.evaluate(()=>document.querySelector('[data-pdf-side="original"]')===window.originalFlow&&document.querySelector('[data-pdf-side="original"] [data-pdf-page="1"]')===window.originalPage),true);
  checks.push('loading-animation-during-slow-translation-load','rapid-mode-switch-does-not-cancel-or-reopen-PDF','sidebar-and-fullscreen-retain-official-PDFViewer-page-nodes');
  await click('全屏对照');await ready();
  await setPosition('original',8,.35);evidence.sourceScroll=await aligned(8);
  await new Promise(done=>setTimeout(done,300));assert.deepEqual(await aligned(8),evidence.sourceScroll);
  await setPosition('zh',20,.45);evidence.translationScroll=await aligned(20);
  checks.push('source-scroll-synchronizes-across-different-page-heights','translation-scroll-synchronizes-back-without-feedback-jumps');
  await page.evaluate(()=>[...document.querySelectorAll('.ib-reader-controls label')].find(node=>node.innerText==='双屏关联').querySelector('input').click());
  const unlinked=await page.$eval('[data-pdf-side="zh"]',node=>node.scrollTop);await setPosition('original',10,.25);await new Promise(done=>setTimeout(done,250));assert.equal(await page.$eval('[data-pdf-side="zh"]',node=>node.scrollTop),unlinked);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-reader-controls label')].find(node=>node.innerText==='双屏关联').querySelector('input').click());await aligned(10);
  const canvasWidth=await page.$eval('[data-pdf-side="original"] [data-pdf-page="10"] canvas',node=>node.width);
  await page.select('select[aria-label="original 缩放"]','1.5');assert.ok(await page.$$eval('[data-pdf-side="original"] [data-pdf-page="10"] canvas',nodes=>Math.max(...nodes.map(node=>node.width)))>=canvasWidth);await aligned(10);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-reader-controls label')].find(node=>node.innerText==='上下视图').querySelector('input').click());await aligned(10);
  await page.setViewport({width:1100,height:840});await aligned(10);
  checks.push('unlink-and-relink-preserve-independent-reading','zoom-stacking-and-window-resize-preserve-page-and-fraction','previous-canvas-remains-visible-while-resizing');
  await click('中文');await ready();assert.equal((await page.evaluate(()=>window.fixturePosition('zh'))).page,10);
  for(const label of ['原文','中文','全屏对照','原文','中文']){await click(label);await ready();}
  assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(row=>row.method==='tasks_reader_open'&&row.translationId).length),1);
  checks.push('warm-mode-switches-use-cached-documents-and-reading-position');
  await click('全屏对照');await ready();await setPosition('original',1);await aligned(1);
  await page.select('select[aria-label="original 缩放"]','1');await aligned(1);
  await page.evaluate(()=>[...document.querySelectorAll('.ib-reader-controls label')].find(node=>node.innerText==='上下视图').querySelector('input').click());await aligned(1);
  const flowBox=await(await page.$('[data-pdf-side="original"]')).boundingBox();await page.mouse.move(flowBox.x+flowBox.width/2,flowBox.y+flowBox.height/2);await page.mouse.wheel({deltaY:500});
  await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"]').scrollTop>300);await aligned(1);
  await page.mouse.wheel({deltaY:-500});await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"]').scrollTop<10);await aligned(1);
  checks.push('native-wheel-scrolls-both-panes-and-returns-without-stalling');
  if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'reader-preview-bilingual.png')});}
  await page.evaluate(()=>{window.fixtureFailTranslationOnce=true;window.refreshReader();});await page.waitForSelector('[data-reader-mode="original"] .ib-reader-controls');await ready();await click('中文');
  await page.waitForFunction(()=>document.querySelector('.ib-reader-error')?.innerText.includes('Fixture translation read failure'));await ready();
  await click('中文');await ready();await page.waitForFunction(()=>document.querySelector('[data-pdf-side="zh"] .ib-reader-text-layer')?.innerText.includes('Translated page 1'));
  checks.push('failed-range-read-stops-loading-animation-and-can-retry');
  await click('全屏对照');await ready();
  assert.deepEqual(await page.$eval('select[aria-label="original 阅读材料"]',node=>[...node.options].map(option=>option.text)),['原文 PDF','SI PDF','翻译 PDF','精读笔记','PPT']);
  await page.select('select[aria-label="original 阅读材料"]','si');await ready();
  await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"] .ib-reader-text-layer')?.innerText.includes('SI page 1'));
  assert.ok(await page.evaluate(()=>window.fixtureCalls.some(row=>row.method==='tasks_reader_open'&&row.kind==='si')));
  assert.equal(await page.$eval('input[aria-label="original PDF 页码"]',node=>node.max),'3');
  assert.equal(await page.$eval('input[aria-label="zh PDF 页码"]',node=>node.max),'30');
  await page.$eval('input[aria-label="zh PDF 页码"]',node=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(node,'30');node.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('[data-pdf-side="zh"] .ib-reader-text-layer')?.innerText.includes('Translated page 30')||[...document.querySelectorAll('[data-pdf-side="zh"] .ib-reader-text-layer')].some(node=>node.innerText.includes('Translated page 30')));
  checks.push('different-page-counts-do-not-reset-other-document-page-maps');
  await page.select('select[aria-label="original 阅读材料"]','translation:translated');await ready();
  await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"] .ib-reader-text-layer')?.innerText.includes('Translated page 1'));
  await page.select('select[aria-label="original 阅读材料"]','pdf');await ready();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-pdf-side="original"] .ib-reader-text-layer')].some(node=>node.innerText.includes('Original page')));
  checks.push('each-fullscreen-pane-selects-entry-materials-independently','SI-and-translation-can-occupy-the-left-pane');
  await click('精读');await ready();await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"] .ib-reader-text-layer')?.innerText.includes('Reading notes page 1'));
  assert.equal(await page.$eval('input[aria-label="original PDF 页码"]',node=>node.max),'2');
  await page.click('.ib-pdf-pane:not([hidden]) button[aria-label="下一页"]');await page.waitForFunction(()=>document.querySelector('input[aria-label="original PDF 页码"]').value==='2');
  await page.click('.ib-pdf-pane:not([hidden]) button[aria-label="上一页"]');await page.waitForFunction(()=>document.querySelector('input[aria-label="original PDF 页码"]').value==='1');
  await page.click('.ib-pdf-pane:not([hidden]) button[aria-label="抓手拖动"]');assert.equal(await page.$eval('[data-pdf-side="original"]',node=>node.dataset.hand),'true');
  await page.click('.ib-pdf-pane:not([hidden]) button[aria-label="选择文字"]');await page.select('select[aria-label="original 缩放"]','1');
  await page.click('button[aria-label="下载 精读报告（.docx）"]');await page.waitForFunction(()=>window.fixtureSaved.length===1);assert.equal(await page.evaluate(()=>window.fixtureSaved[0].action),'save');assert.ok(await page.evaluate(()=>window.fixtureSaved[0].url.endsWith('kind=report&format=docx&reportId=notes')));
  await page.setViewport({width:360,height:760});await ready();
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.ib-pdf-pane:not([hidden]) .ib-pdf-toolbar>*')].every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;})),true);
  if(output)await page.screenshot({path:join(output,'reader-notes-narrow.png')});
  await click('PPT');await ready();await page.waitForFunction(()=>document.querySelector('[data-pdf-side="original"] .ib-reader-text-layer')?.innerText.includes('Presentation page 1'));assert.equal(await page.$eval('input[aria-label="original PDF 页码"]',node=>node.max),'4');
  assert.ok(await page.evaluate(()=>window.fixtureCalls.some(row=>row.materialId==='report:notes')&&window.fixtureCalls.some(row=>row.materialId==='ppt:slides')));
  await page.click('button[aria-label="下载 PPT（.pptx）"]');await page.waitForFunction(()=>window.fixtureSaved.length===2);assert.ok(await page.evaluate(()=>window.fixtureSaved[1].url.endsWith('kind=ppt&reportId=notes')));
  await click('全屏对照');await page.select('select[aria-label="zh 阅读材料"]','report:notes');await page.waitForSelector('.ib-pdf-pane button[aria-label="下载 精读报告（.docx）"]');await page.click('.ib-pdf-pane button[aria-label="下载 精读报告（.docx）"]');await page.waitForFunction(()=>window.fixtureSaved.length===3);assert.ok(await page.evaluate(()=>window.fixtureSaved.every(row=>!row.url.includes('preview=1'))));
  checks.push('sidebar-and-fullscreen-download-original-docx-and-pptx-via-native-save-dialog');
  checks.push('reading-notes-and-PPT-open-PDF-with-full-toolbar','reading-notes-toolbar-next-previous-hand-and-text-controls-work','toolbar-groups-wrap-without-overflow-at-360px');
  await page.evaluate(()=>window.disposeReader());assert.equal(await page.$$eval('.ib-reader-host',nodes=>nodes.length),0);assert.deepEqual(errors,[]);checks.push('reader-unmount-releases-portal-and-workers-without-errors');evidence.ok=true;
 }catch(error){
  if(page)evidence.failure=await page.evaluate(()=>({mode:document.querySelector('[data-reader-mode]')?.dataset.readerMode,positions:{original:window.fixturePosition('original'),zh:window.fixturePosition('zh')},panes:[...document.querySelectorAll('[data-pdf-side]')].map(flow=>({side:flow.dataset.pdfSide,top:flow.scrollTop,height:flow.clientHeight,pages:[...flow.querySelectorAll('.page')].filter(page=>page.offsetTop+page.offsetHeight>flow.scrollTop&&page.offsetTop<flow.scrollTop+flow.clientHeight+12).map(page=>({page:page.dataset.pdfPage,state:page.dataset.pdfState,classes:page.className,canvases:[...page.querySelectorAll('canvas')].map(canvas=>({width:canvas.width,height:canvas.height,hidden:canvas.hidden}))}))}))})).catch(()=>null);
  if(output&&page)await page.screenshot({path:join(output,'reader-preview-failure.png')}).catch(()=>{});throw error;
 }finally{
  if(output){mkdirSync(output,{recursive:true});writeFileSync(join(output,'reader-preview-browser.json'),JSON.stringify(evidence,null,2));}
  await browser?.close().catch(()=>{});await new Promise(done=>server.close(done));
 }
});
