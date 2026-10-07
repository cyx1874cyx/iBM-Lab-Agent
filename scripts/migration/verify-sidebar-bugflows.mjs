/** Actual official NEXT browser UI + native guest + Host archive, isolated fixtures only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,copyFileSync,existsSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer-core';
import {initializeRelease} from '../../electron-next/release-runtime.mjs';
const arg=name=>resolve(process.argv[process.argv.indexOf(name)+1]);
const app=arg('--app'),resources=arg('--resources'),executable=arg('--executable'),output=arg('--output');
mkdirSync(output,{recursive:true});const work=mkdtempSync(join(output,'run-')),home=join(work,'独立科研 验收');
const pdf=Buffer.from('%PDF-1.4\n/Type /Page\nSIDEBAR FIXTURE\n'+' '.repeat(200000)+'\n%%EOF');
const previewPdf=process.argv.includes('--preview-pdf')?readFileSync(arg('--preview-pdf')):Buffer.from(execFileSync(join(resources,'python/python.exe'),['-I','-c','import pymupdf,base64; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,72),"NATIVE PDF SIDEBAR PREVIEW"); print(base64.b64encode(d.tobytes()).decode())'],{encoding:'utf8',windowsHide:true}).trim(),'base64');
const cookies=[];
const server=createServer((req,res)=>{
 if(req.url.startsWith('/verify')){res.writeHead(200,{'content-type':'text/html'});res.end('<title>Just a moment</title><h1>Verify you are human</h1>');}
 else if(req.url.startsWith('/inline.pdf')){res.writeHead(200,{'content-type':'application/pdf','content-disposition':'inline; filename="preview.pdf"','content-length':previewPdf.length});res.end(previewPdf);}
 else if(req.url.startsWith('/file')){res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="fixture-SI.pdf"','content-length':pdf.length});let offset=0;const timer=setInterval(()=>{res.write(pdf.subarray(offset,offset+20000));offset+=20000;if(offset>=pdf.length){clearInterval(timer);res.end();}},250);res.once('close',()=>clearInterval(timer));}
 else{if(req.url.startsWith('/check'))cookies.push(req.headers.cookie??'');res.writeHead(200,{'content-type':'text/html',...(!req.url.startsWith('/check')?{'set-cookie':'ibm_fixture_session=retained; Path=/; Max-Age=3600'}:{})});res.end('<title>SIDEBAR PUBLISHER</title><h1>SIDEBAR PUBLISHER</h1><button onclick="window.open(\'/file.pdf\')">Download PDF</button>');}
});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const {NextProfiles}=await import(pathToFileURL(join(app,'lib/profiles.js')));
initializeRelease({home,resources,electron:executable,profiles:NextProfiles});const profiles=new NextProfiles(home);profiles.finishOnboarding('ibm-lab');profiles.dismissAccountSetup('ibm-lab');
if(process.argv.includes('--development-client')){
 writeFileSync(join(profiles.directory('ibm-lab'),'node_modules/dsh-lab-ui/client/index.js'),readFileSync(arg('--development-client'),'utf8').replace('id: "dsh-lab-agent", factory:','id: "dsh-lab-ui", factory:'));
 copyFileSync(join(app,'node_modules/dsh-lab-agent/src/runtime/task-activity.js'),join(profiles.directory('ibm-lab'),'node_modules/dsh-lab-agent/src/runtime/task-activity.js'));
}
const fixture=join(profiles.directory('ibm-lab'),'node_modules','dsh-ibm-sidebar-fixture');mkdirSync(fixture,{recursive:true});
const readerPdfPath=join(work,'reader-source.pdf');
if(process.argv.includes('--reader'))execFileSync(join(resources,'python/python.exe'),['-I','-c','import pymupdf,sys; d=pymupdf.open(); p=d.new_page(); p.insert_textbox(pymupdf.Rect(72,60,500,125),"Full paper source paragraph. "*8,fontsize=10); pix=pymupdf.Pixmap(pymupdf.csRGB,(0,0,64,64),False); pix.clear_with(180); p.insert_image(pymupdf.Rect(72,130,250,250),stream=pix.tobytes("png")); p=d.new_page(); p.insert_textbox(pymupdf.Rect(72,60,500,180),"Methods: lipid nanoparticle delivery. "*8,fontsize=10); d.save(sys.argv[1])',readerPdfPath],{windowsHide:true});
writeFileSync(join(fixture,'package.json'),JSON.stringify({name:'dsh-ibm-sidebar-fixture',version:'1.0.0',type:'module',main:'index.js'}));
writeFileSync(join(fixture,'index.js'),`import {writeFileSync} from 'node:fs';export const inject=['ibmCore','ibmScientificDesktop','ibmLiteratureWorkflows'];export async function apply(ctx){
 if(!ctx.ibmCore.getProject('sidebar-test'))await ctx.ibmCore.createProject({id:'sidebar-test',name:'侧栏宠物验收'});
 const registered=await ctx.ibmLiteratureWorkflows.registerPaperMeta({projectId:'sidebar-test',sourceType:'wechat',sourceUrl:'https://mp.weixin.qq.com/s/sidebar-fixture',title:'微信登记后捕获验收',doi:'10.1038/fixture-sidebar-pdf',authors:['Fixture Author'],year:2026});
 writeFileSync(${JSON.stringify(join(work,"wechat-registration.json"))},JSON.stringify(registered));
 ${process.argv.includes('--reader')?`
 const workflow=ctx.ibmLiteratureWorkflows;
 const readerMeta=await workflow.registerPaperMeta({projectId:'sidebar-test',sourceType:'publisher',sourceUrl:'https://example.org/reader-fixture',title:'全文翻译侧栏验收',doi:'10.1000/reader-fixture'});
 if(!readerMeta.bundle.pdfPath)await workflow.preparePaper({projectId:'sidebar-test',bundleId:readerMeta.bundle.id,pdfPath:${JSON.stringify(readerPdfPath)},siPath:${JSON.stringify(readerPdfPath)},title:'全文翻译侧栏验收'});
 const readerIdentity={projectId:'sidebar-test',bundleId:readerMeta.bundle.id,kind:'pdf'};
 const translation=await workflow.translationCreate(readerIdentity);const request={...readerIdentity,translationId:translation.translation.id};
 const finishFixture=async identity=>{await workflow.translationPrepare(identity);for(;;){const result=await workflow.translationRead({...identity,pendingOnly:true,limit:40});if(!result.total)break;await workflow.translationWrite({...identity,blocks:result.blocks.map(block=>({id:block.id,zh:block.original.includes('Full paper')?'完整的论文来源段落。':'方法：脂质纳米颗粒递送。'}))});}await workflow.translationFinish({...identity,notes:'验收用固定译文；未调用真实模型。'});};
 if(translation.translation.status!=='completed')await finishFixture(request);
 writeFileSync(${JSON.stringify(join(work,'reader-fixture.json'))},JSON.stringify({bundleId:readerMeta.bundle.id,reportId:readerMeta.report.id,translationId:request.translationId}));
 let working=false;const tick=setInterval(async()=>{if(working)return;const bundle=workflow.getBundle(readerMeta.bundle.id),queued=(bundle.translations??[]).find(row=>row.kind==='si'&&row.status==='queued'&&row.sessionId);if(!queued)return;working=true;try{const identity={...readerIdentity,kind:'si',translationId:queued.id};await workflow.translationPrepare(identity);await new Promise(done=>setTimeout(done,4000));await finishFixture(identity);}finally{working=false;}},1000);ctx.effect(()=>()=>clearInterval(tick),'reader fixture progress');
 `:''}
 ${process.argv.includes('--organization')?`if(!registered.report.paperCardPath){writeFileSync(${JSON.stringify(join(work,'reading-fixture.md'))},'# 精读报告\\n\\n该报告讨论脂质纳米颗粒的大载荷核酸递送及体内编辑机制。\\n');await ctx.ibmLiteratureWorkflows.completeReadingReport({reportId:registered.report.id,paperCardPath:${JSON.stringify(join(work,'reading-fixture.md'))},folderName:'核酸递送',classificationReason:'精读内容讨论脂质纳米颗粒与核酸递送机制'});}`:''}
 for(const id of ['sidebar-si','sidebar-cancel'])if(!ctx.ibmCore.getArtifact('source-bundle',id))await ctx.ibmCore.commitSourceBundle({id,projectId:'sidebar-test',title:'Fixture '+id,doi:'10.1038/fixture-'+id,status:'succeeded',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 ctx.ibmScientificDesktop.config.portal=${JSON.stringify(origin)};
 const navigate=ctx.ibmScientificDesktop.navigate.bind(ctx.ibmScientificDesktop);
 ctx.ibmScientificDesktop.navigate=(lease,url)=>navigate(lease,url.startsWith('https://doi.org/10.1038/fixture-')?${JSON.stringify(origin+'/paper')}:url);
}`);
const patch=join(profiles.directory('ibm-lab'),'cordis.patch.yml');writeFileSync(patch,readFileSync(patch,'utf8').replace(/^\[\]\s*$/m,'')+"\n- insert:\n    - id: sidebar-fixture\n      name: 'dsh-ibm-sidebar-fixture'\n");
const report={ok:false,home,checks:[],scope:'Official NEXT UI and actual Electron download into isolated projects; synthetic publisher, no institution account or model credentials.'};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const wait=async(fn,label)=>{for(let i=0;i<300;i++){const result=await fn();if(result)return result;await delay(100);}throw Error('Timed out: '+label);};
let child,browser,frame,page,pet,log='';
const launch=async(requirePet=true)=>{
 let endpoint;
 child=spawn(executable,[...(process.argv.includes('--staged')?[app]:[]),'--remote-debugging-port=0'],{env:{...process.env,DSH_HOME:home,DSH_DESKTOP_NEXT_HOME:home,ELECTRON_RUN_AS_NODE:undefined,DSH_TELEMETRY_DISABLED:'1',IBM_SIDEBAR_TEST_ORIGINS:JSON.stringify([origin])},stdio:['ignore','pipe','pipe'],windowsHide:true});
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const value=String(chunk);endpoint??=value.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];log+=value.replace(/([?&]token=)[^&\s]+/g,'$1<redacted>');});
 await wait(()=>endpoint,'desktop debug endpoint');browser=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null});
 const observed=new Set();await wait(async()=>{for(const candidate of await browser.pages()){if(!observed.has(candidate)){observed.add(candidate);const record=value=>appendFileSync(join(work,'renderer.log'),String(value).replace(/([?&]token=)[^&\s]+/g,'$1<redacted>')+'\n');candidate.on('console',message=>record(message.type()+': '+message.text().slice(0,2000)));candidate.on('pageerror',error=>record(error.stack??error.message));}if(candidate.url().includes('desktop-pet.html'))pet=candidate;for(const current of candidate.frames())if(await current.$('[title="打开科研课题"]').catch(()=>false)){page=candidate;frame=current;}}return frame&&(!requirePet||pet);},'main and pet');
};
const rpc=(method,request)=>frame.evaluate(async(method,request)=>{
 const response=await fetch('/api/lab/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'lab/'+method,payload:{args:request?{request}:{}}})});const result=await response.json();if(!result.result?.ok)throw Error(JSON.stringify(result));return result.result.value;
},method,request);
const readerCheck=async(restarted=false)=>{
 const registered=JSON.parse(readFileSync(join(work,'reader-fixture.json'),'utf8'));
 const openItem=async label=>{await frame.click('[title="打开科研课题"]');await frame.waitForSelector('.ib-project');await frame.evaluate(()=>[...document.querySelectorAll('.ib-project')].find(node=>node.innerText.includes('侧栏宠物验收')).click());await frame.waitForFunction(()=>[...document.querySelectorAll('.ib-lit-item')].some(node=>node.innerText.includes('全文翻译侧栏验收')));await frame.evaluate(label=>[...document.querySelectorAll('.ib-lit-item')].find(node=>node.innerText.includes('全文翻译侧栏验收')).querySelector('button[aria-label="'+label+'"]').click(),label);await frame.waitForSelector('.ib-reader');};
 await openItem('正文 PDF / 获取原文');
 await frame.waitForFunction(()=>document.querySelector('.ib-reader-text-layer')?.innerText.includes('Full paper source paragraph.'));
 const pixels=await frame.evaluate(()=>{const c=document.querySelector('.ib-reader canvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i+3]===255&&data[i]<100&&data[i+1]<100&&data[i+2]<100)dark++;return {width:c.width,height:c.height,dark};});assert.ok(pixels.dark>100);report.readerPixels=pixels;
 await page.screenshot({path:join(work,restarted?'reader-original-restarted.png':'reader-original.png')});
 if(restarted){assert.equal((await rpc('tasks_translation_read',{projectId:'sidebar-test',bundleId:registered.bundleId,kind:'pdf',translationId:registered.translationId})).translation.status,'completed');report.checks.push('archived-reader-and-complete-translation-survive-real-Host-restart');return;}
 await frame.evaluate(()=>[...document.querySelectorAll('.ib-reader button')].find(node=>node.textContent==='下一页').click());
 await frame.waitForFunction(()=>document.querySelector('.ib-reader-text-layer')?.innerText.includes('Methods: lipid nanoparticle delivery.'));
 await frame.type('.ib-reader input[aria-label="查找 PDF 文本"]','Full paper');await frame.focus('.ib-reader input[aria-label="查找 PDF 文本"]');await page.keyboard.press('Enter');await frame.waitForFunction(()=>document.querySelector('.ib-reader-text-layer')?.innerText.includes('Full paper source paragraph.'));
 await frame.evaluate(()=>[...document.querySelectorAll('.ib-reader button')].find(node=>node.textContent==='双语对照').click());await frame.waitForFunction(()=>document.querySelector('[data-translation]')?.innerText.includes('完整的论文来源段落'));assert.ok(await frame.$('[data-original]'));
 await frame.waitForFunction(()=>[...document.querySelectorAll('.ib-reader-translated img')].some(image=>image.naturalWidth>0));await page.screenshot({path:join(work,'reader-bilingual.png')});
 await frame.evaluate(()=>[...document.querySelectorAll('.ib-reader button')].find(node=>node.textContent==='中文').click());await frame.waitForFunction(()=>document.querySelector('[data-translation]')&&!document.querySelector('[data-original]'));await page.screenshot({path:join(work,'reader-chinese.png')});
 await frame.evaluate(()=>[...document.querySelectorAll('.ib-reader-translated button')].find(node=>node.textContent==='原文第 2 页').click());await frame.waitForFunction(()=>document.querySelector('.ib-reader-text-layer')?.innerText.includes('Methods: lipid nanoparticle delivery.'));
 report.checks.push('actual-reading-item-opens-archived-PDF-in-sidebar-with-painted-content','PDF-pages-text-search-and-source-anchor-navigation','full-Chinese-and-bilingual-reading-with-source-figures');
 const before=(await browser.pages()).length;await openItem('正文 PDF / 获取原文');assert.equal((await browser.pages()).length,before);report.checks.push('repeated-archived-PDF-click-reuses-sidebar-without-new-Electron-window');
 await openItem('SI 补充材料 / 获取 SI');await frame.waitForFunction(()=>document.querySelector('.ib-reader-text-layer')?.innerText.includes('Full paper source paragraph.'));
 const si=await rpc('tasks_translation_create',{projectId:'sidebar-test',bundleId:registered.bundleId,kind:'si'});assert.notEqual(si.translation.id,registered.translationId);
 const binding=(await rpc('projects_binding',{projectId:'sidebar-test'})).binding;assert.equal((await rpc('tasks_translation_bind',{projectId:'sidebar-test',bundleId:registered.bundleId,kind:'si',translationId:si.translation.id,sessionId:binding.sessionIds.at(-1)})).bound,true);
 await wait(()=>pet.evaluate(()=>document.querySelector('#stage').innerText.includes('翻译全文')),'translation progress pushed to desktop pet');await pet.screenshot({path:join(work,'pet-translating.png'),omitBackground:true});
 await wait(async()=>{try{return (await rpc('tasks_translation_read',{projectId:'sidebar-test',bundleId:registered.bundleId,kind:'si',translationId:si.translation.id})).translation.status==='completed';}catch{return false;}},'independent SI translation completes');
 await wait(()=>pet.evaluate(()=>document.querySelector('#stage').innerText==='当前没有进行中的任务'),'pet clears completed translation');
 report.checks.push('SI-opens-in-sidebar-and-has-independent-translation-state','translation-job-binds-to-real-project-session-through-authenticated-Remote','actual-translation-stage-push-and-completed-task-removal-in-pet');
};
const close=async()=>{await browser?.close().catch(()=>{});await wait(()=>child.exitCode!==null,'desktop shutdown').catch(()=>child.kill());browser=null;frame=null;pet=null;};
try{
 await launch();if(process.argv.includes('--reader'))await wait(()=>existsSync(join(work,'reader-fixture.json')),'translation fixture completes Host initialization');await frame.waitForSelector('.ib-hero-chip');await frame.click('.ib-hero-chip');
 await frame.waitForFunction(()=>[...document.querySelectorAll('.ib-hero-menu-item')].some(node=>node.innerText.includes('侧栏宠物验收')));
 await frame.evaluate(()=>[...document.querySelectorAll('.ib-hero-menu-item')].find(node=>node.innerText.includes('侧栏宠物验收')).click());
 await wait(async()=>(await rpc('projects_binding',{projectId:'sidebar-test'})).binding?.sessionIds?.length,'project session binding');
 await wait(()=>pet.evaluate(()=>document.querySelector('#stage').innerText==='当前没有进行中的任务'),'pet real Host connection');
 if(process.argv.includes('--organization')){
  await frame.click('[title="打开科研课题"]');
  await frame.waitForSelector('.ib-project');
  await frame.evaluate(()=>[...document.querySelectorAll('.ib-project')].find(node=>node.innerText.includes('侧栏宠物验收')).click());
  await frame.waitForSelector('.ib-reading-folders');
  await frame.waitForFunction(()=>document.querySelector('.ib-reading-folders')?.innerText.includes('核酸递送 (1)'));
  await frame.evaluate(()=>[...document.querySelectorAll('.ib-lit button')].find(node=>node.textContent==='+ 文件夹').click());
  await frame.type('input[aria-label="文件夹名称"]','人工测试分类');
  await frame.click('.ib-folder-editor button[type="submit"]');
  await frame.waitForFunction(()=>document.querySelector('.ib-reading-folders')?.innerText.includes('人工测试分类'));
  const risPath=join(work,'人工检索导入.ris');const ris='TY  - JOUR\nTI  - 手工检索核酸递送研究\nDO  - 10.1038/manual-ris-fixture\nAU  - Li, A\nPY  - 2026\nAB  - Delivery study\nER  -\n';writeFileSync(risPath,ris+ris);
  const picker=await frame.$('input[accept=".ris"]');assert.ok(picker);await picker.uploadFile(risPath);
  await frame.waitForFunction(()=>document.querySelector('.ib-lit')?.innerText.includes('人工检索导入'));
  const searches=(await rpc('tasks_searches',{projectId:'sidebar-test'})).runs;const imported=searches.find(row=>row.importedRis?.fileName==='人工检索导入.ris');assert.equal(imported.results.length,1);assert.equal(imported.importedRis.duplicateCount,1);
  const folders=(await rpc('tasks_reading_folders',{projectId:'sidebar-test'})).folders;assert.equal(folders[0].name,'核酸递送');
  await frame.evaluate(()=>[...document.querySelectorAll('.ib-reading-folders button')].find(node=>node.innerText.includes('核酸递送 (1)')).click());
  assert.ok(await frame.$('select[title]'));
  await page.screenshot({path:join(work,'reading-folders-ris.png')});
  report.checks.push('actual-RIS-file-picker-registers-deduplicated-manual-search','content-based-reading-folder-visible-in-actual-project-panel');
  await frame.evaluate(()=>[...document.querySelectorAll('.ib-reading-folders button')].find(node=>node.textContent==='重命名').click());
  await frame.click('input[aria-label="文件夹名称"]',{clickCount:3});await frame.type('input[aria-label="文件夹名称"]','脂质核酸递送');
  await frame.click('.ib-folder-editor button[type="submit"]');
  await frame.waitForFunction(()=>document.querySelector('.ib-reading-folders')?.innerText.includes('脂质核酸递送'));
  await page.screenshot({path:join(work,'reading-folder-renamed.png')});
  await frame.evaluate(()=>[...document.querySelectorAll('.ib-overlay button')].find(node=>node.textContent==='返回 Harness')?.click());
  await frame.waitForFunction(()=>!document.querySelector('.ib-overlay'));
 }
 const uploadPath=join(work,'对话附件.pdf'),textPath=join(work,'中文记录.txt');writeFileSync(uploadPath,pdf);writeFileSync(textPath,'上传验收');
 await frame.evaluate(()=>{const original=globalThis.fetch;globalThis.__ibmUploadReceipts=[];globalThis.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/session/uploadFileBinary'))globalThis.__ibmUploadReceipts.push(await response.clone().json());return response;};});
 report.uploadInputs=await frame.evaluate(()=>[...document.querySelectorAll('input[type=file]')].map(n=>({disabled:n.disabled,hidden:n.hidden,html:n.outerHTML})));
 const uploadInput=await frame.$('input[type=file]');assert.ok(uploadInput,'conversation file picker');await uploadInput.uploadFile(uploadPath,textPath);const receipts=await wait(async()=>{const rows=await frame.evaluate(()=>globalThis.__ibmUploadReceipts);return rows.length===2?rows:false;},'two authenticated upload receipts');await delay(500);
 assert.ok(receipts.every(result=>result.ok&&result.value.receiptId));assert.equal(receipts.find(r=>r.value.file.name==='对话附件.pdf').value.file.bytes,pdf.length);report.uploadReceipts=receipts;report.checks.push('conversation-multiple-PDF-and-Chinese-text-upload-staged-with-real-receipts');
 report.uploadText=await frame.evaluate(()=>document.body.innerText);
 await page.screenshot({path:join(work,'upload.png')});
 assert.ok(!/上传失败|上传出错|background upload|HTTP 403/.test(report.uploadText),'conversation upload failed: '+report.uploadText.slice(-1500));
 const registered=JSON.parse(readFileSync(join(work,'wechat-registration.json'),'utf8'));report.registration=registered;
 const metadataBundleId=registered.bundle.id;
 const coldCapture=await rpc('desktop_browser',{action:'capture',projectId:'sidebar-test',bundleId:metadataBundleId,kind:'pdf'});
 const opened=(await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'})).window;assert.ok(opened.lease);report.checks.push('wechat-metadata-registration-then-cold-sidebar-capture-without-application-exit');
 await frame.waitForFunction(()=>document.querySelector('webview'));
 await frame.waitForFunction(()=>document.querySelector('webview')?.getURL().includes('/'));
 const info=await frame.evaluate(()=>{const view=document.querySelector('webview');return {url:view.getURL(),parent:!!view.closest('[data-sidebar-right-tab]'),partition:view.getAttribute('partition'),bounds:view.getBoundingClientRect().toJSON(),guestId:view.getWebContentsId()};});
 assert.equal(info.parent,true);assert.ok(info.partition.startsWith('persist:ibm-sidebar-'));assert.ok(info.bounds.width>100);assert.ok(info.bounds.height>100);report.browser=info;report.checks.push('official-browser-tab-mounted-inside-right-sidebar','persistent-project-storage-partition');
 await page.screenshot({path:join(work,'sidebar.png')});
 // A live guest remains mounted when the official column is collapsed.
 // Reusing that lease must reveal the UI, rather than only focus the app.
 await frame.click('button[aria-label="收起右侧边栏"],button[aria-label="Collapse right sidebar"]');
 await frame.waitForFunction(()=>!document.querySelector('[data-sidebar-right-open]'));
 await rpc('desktop_browser',{action:'open',projectId:'sidebar-test'});
 await frame.waitForFunction(()=>{const view=document.querySelector('webview'),r=view?.getBoundingClientRect();return document.querySelector('[data-sidebar-right-open]')&&view.checkVisibility()&&r.width>100&&r.height>100;});
 assert.equal((await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'})).window.lease,opened.lease);
 report.checks.push('existing-browser-lease-reveals-collapsed-official-sidebar-without-new-guest');
 await page.screenshot({path:join(work,'sidebar-reopened.png')});
 const isolated=await frame.evaluate(async origin=>{
  const reservation=await window.dshDesktop.browser.acquire('cwd:independent-fixture-workspace');
  const guest=document.createElement('webview');guest.setAttribute('partition',reservation.partition);guest.setAttribute('src','about:blank#'+reservation.lease);guest.style.cssText='position:absolute;width:150px;height:100px;left:-1000px;top:-1000px';
  const ready=new Promise(done=>guest.addEventListener('dom-ready',done,{once:true}));document.body.append(guest);await ready;await guest.loadURL(origin+'/check-other');
  const cookie=await guest.executeJavaScript('document.cookie');await window.dshDesktop.browser.release(reservation.lease);guest.remove();return {partition:reservation.partition,cookie};
 },origin);
 assert.notEqual(isolated.partition,info.partition);assert.equal(isolated.cookie.includes('ibm_fixture_session'),false);report.checks.push('institution-session-isolated-between-workspaces');
 let completed;
 for(const [bundleId,kind] of [[metadataBundleId,'pdf'],['sidebar-si','si']]){
  const created=kind==='pdf'?coldCapture:await rpc('desktop_browser',{action:'capture',projectId:'sidebar-test',bundleId,kind});
  assert.ok(!(await pet.evaluate(()=>document.body.innerText)).includes('等待开始'),'pet must exclude queued reading');
  const lease=(await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'})).window.lease;
  // Actual user click in the official embedded browser; the native download is authoritative.
  const guest=await wait(async()=>{for(const target of browser.targets())if(target.type()==='webview'){const session=await target.createCDPSession();const value=await session.send('Runtime.evaluate',{expression:'document.title',returnByValue:true});if(value.result.value==='SIDEBAR PUBLISHER')return session;await session.detach();}return false;},'publisher guest');
  await guest.send('Runtime.evaluate',{expression:'document.querySelector("button").click()',userGesture:true});await guest.detach();
  await wait(()=>pet.evaluate(()=>document.querySelector('#stage').innerText==='正在下载'),'real download progress in pet');
  await pet.screenshot({path:join(work,'pet-downloading-'+kind+'.png'),omitBackground:true});
  completed=await wait(async()=>{const task=(await rpc('manual_capture_get',{taskId:created.task.id})).task;return task?.status==='completed'?task:false;},'PDF/SI archive');
  assert.equal(completed.size,pdf.length);assert.ok(completed.fileSha256);
  await wait(()=>pet.evaluate(()=>document.querySelector('#stage').innerText==='当前没有进行中的任务'),'pet archived status');
  report.checks.push(kind+'-actual-sidebar-download-validated-and-archived');report.lease=lease;
 }
 await pet.screenshot({path:join(work,'pet-completed.png'),omitBackground:true});
 assert.equal((await browser.pages()).filter(p=>!p.url().startsWith('dsh-')&&!p.url().includes('desktop-pet.html')&&!p.url().startsWith('devtools:')&&p.url()!=='about:blank').length,0,'publisher opened a standalone window');
 report.checks.push('publisher-download-popup-stays-in-sidebar','pet-only-running-task-real-download-progress-no-queued-or-completed-rows');
 await rpc('desktop_pet',{visible:false});assert.equal((await rpc('desktop_pet',{})).visible,false);await rpc('desktop_pet',{visible:true});assert.equal((await rpc('desktop_pet',{})).visible,true);report.checks.push('pet-show-hide-preference');
 const pending=await rpc('desktop_browser',{action:'capture',projectId:'sidebar-test',bundleId:'sidebar-cancel',kind:'pdf'});await rpc('desktop_browser',{action:'cancel',projectId:'sidebar-test',taskId:pending.task.id});assert.equal((await rpc('manual_capture_get',{taskId:pending.task.id})).task.status,'cancelled');report.checks.push('sidebar-capture-cancellation');
 await frame.click('button[aria-label="收起右侧边栏"],button[aria-label="Collapse right sidebar"]');
 await frame.waitForFunction(()=>!document.querySelector('[data-sidebar-right-open]'));
 const rebuilt=await rpc('manual_capture_recreate',{taskId:pending.task.id,reason:'sidebar visibility regression'});
 await wait(async()=>{const state=await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'});return state.capture?.pendingTaskId===rebuilt.task.id;},'AI rebuilt capture bound to existing browser');
 await frame.waitForFunction(()=>document.querySelector('[data-sidebar-right-open]')&&document.querySelector('webview')?.checkVisibility());
 assert.equal((await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'})).window.lease,opened.lease);
 report.checks.push('AI-task-reconstruction-reopens-collapsed-sidebar-and-reuses-guest');
 await page.screenshot({path:join(work,'sidebar-ai-rebuilt.png')});
 await frame.click('button[aria-label="收起右侧边栏"],button[aria-label="Collapse right sidebar"]');
 await frame.waitForFunction(()=>!document.querySelector('[data-sidebar-right-open]'));
 await rpc('desktop_browser',{action:'navigate',projectId:'sidebar-test',url:origin+'/verify'});
 await wait(async()=>{const state=await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'});return state.capture?.access?.state==='verification-required';},'verification access state');
 await frame.waitForFunction(()=>document.querySelector('[data-sidebar-right-open]')&&document.querySelector('webview')?.checkVisibility());
 await page.screenshot({path:join(work,'sidebar-verification-visible.png')});
 report.checks.push('human-verification-page-reveals-collapsed-sidebar-without-automated-verification');
 await rpc('desktop_browser',{action:'cancel',projectId:'sidebar-test',taskId:rebuilt.task.id});
 await rpc('desktop_browser',{action:'open',projectId:'sidebar-test',url:origin+'/inline.pdf'});
 report.pdfPreview=await wait(async()=>{const state=(await rpc('desktop_browser',{action:'status',projectId:'sidebar-test'})).window;if(!state?.url?.includes('/inline.pdf')||!/^application\/pdf/i.test(state.documentType??''))return false;const bounds=await frame.evaluate(()=>{const r=document.querySelector('webview')?.getBoundingClientRect();return {width:r?.width,height:r?.height};});assert.ok(bounds.width>350&&bounds.height>400);return {url:state.url,documentType:state.documentType,...bounds,bytes:previewPdf.length};},'PDF response in full-size official sidebar');
 await delay(8000);await page.screenshot({path:join(work,'native-pdf-preview.png')});report.checks.push('real-PDF-response-in-full-size-official-sidebar-visual-preview-recorded');
 if(process.argv.includes('--reader'))await readerCheck();
 await rpc('desktop_pet',{visible:false});await close();await launch(false);assert.equal((await rpc('desktop_pet',{})).visible,false);report.checks.push('pet-preference-survives-restart');
 if(process.argv.includes('--reader'))await readerCheck(true);
 if(process.argv.includes('--organization')){
  const folders=(await rpc('tasks_reading_folders',{projectId:'sidebar-test'})).folders;assert.ok(folders.some(row=>row.name==='脂质核酸递送'));
  const searches=(await rpc('tasks_searches',{projectId:'sidebar-test'})).runs;assert.equal(searches.filter(row=>row.importedRis?.fileName==='人工检索导入.ris').length,1);
  const workspace=await rpc('projects_workspace',{projectId:'sidebar-test'});assert.ok(workspace.literature.reports.some(row=>folders.some(folder=>folder.id===row.folderId&&folder.name==='脂质核酸递送')));
  report.checks.push('reading-folder-assignment-and-manual-RIS-search-persist-across-real-Host-restart');
 }
 const before=cookies.length;await rpc('desktop_browser',{action:'open',projectId:'sidebar-test',url:origin+'/check'});await wait(()=>cookies.length>before,'persistent cookie request');assert.match(cookies.at(-1),/ibm_fixture_session=retained/);report.checks.push('browser-login-cookie-survives-application-restart');
 report.ok=true;
}catch(error){report.error=String(error);report.processExitCode=child?.exitCode;report.processSignal=child?.signalCode;if(browser)report.pages=await browser.pages().then(pages=>Promise.all(pages.map(async page=>({url:page.url(),text:await page.evaluate(()=>document.body.innerText).catch(()=>undefined)})))).catch(()=>[]);if(page)await page.screenshot({path:join(work,'failure.png')}).catch(()=>{});if(frame)report.failureText=await Promise.resolve().then(()=>frame.evaluate(()=>document.body.innerText)).catch(()=>undefined);throw error;}
finally{await close().catch(()=>{});await new Promise(done=>server.close(done));writeFileSync(join(work,'desktop.log'),log);writeFileSync(join(work,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Sidebar and pet evidence: '+join(work,'verification.json'));}
