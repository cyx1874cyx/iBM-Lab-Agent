/* global window,document,getComputedStyle,HTMLInputElement,HTMLSelectElement,DataTransfer,DragEvent */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import {launchSystemBrowser,resolveBrowserExecutable} from './helpers/ketcher-page.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url)),executable=resolveBrowserExecutable();
const reactRoot=[join(repo,'node_modules'),resolve(repo,'../../outputs/electron-next-p1/next/dsh-plugin-desktop/node_modules')].find(path=>existsSync(join(path,'react/package.json')));

test('all chart property panels commit colors and expose relevant native controls',{skip:!executable||!reactRoot,timeout:60000},async()=>{
 const fixture=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {EditorProperties,BufferedEditorProperties} from './client/src/plot-editor-controls.js';import {plotSpecSchema} from './src/plot/workspace.js';
 window.commits=0;function App(){const [spec,setSpec]=useState(plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1]})),[batch,setBatch]=useState(false),[selected,setSelected]=useState('series:1');window.spec=spec;window.legend=()=>{window.commits=0;setBatch(true);setSelected('legend');setSpec(plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1],legendX:.683279,legendY:.123456}));};window.batch=()=>{window.commits=0;setBatch(true);setSpec(plotSpecSchema.parse({kind:'histogram',yCols:[1]}));};window.choose=kind=>setSpec(plotSpecSchema.parse({kind,xCol:0,yCols:[1]}));return React.createElement(batch?BufferedEditorProperties:EditorProperties,{spec,selected,profile:{columns:[{name:'X'},{name:'Sample'}]},change:patch=>{window.commits++;setSpec(plotSpecSchema.parse({...spec,...patch}));},onSelect:()=>{}});}createRoot(document.getElementById('root')).render(React.createElement(App));`;
 const built=await esbuild.build({stdin:{contents:fixture,resolveDir:repo},bundle:true,format:'iife',platform:'browser',write:false,nodePaths:[reactRoot],logLevel:'silent'});
 const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].text);}else res.end('<div id="root"></div><script src="/fixture.js"></script>');});server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
 try{browser=await launchSystemBrowser(puppeteer,executable,{headless:'new'});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.choose);
 const set=async(label,value)=>page.evaluate((label,value)=>{const row=[...document.querySelectorAll('label')].find(n=>n.firstChild.textContent===label);if(!row)throw Error('Missing '+label);const input=row.querySelector('input'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));if(input.type==='number')input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},label,value);
 for(const kind of ['line','line_symbol','scatter','column','bar','box','histogram']){
  await page.evaluate(kind=>window.choose(kind),kind);await page.waitForFunction(kind=>window.spec.kind===kind,{},kind);
  await set('系列颜色','#c23d51');assert.equal(await page.evaluate(()=>window.spec.series[0].color),'#c23d51');
  const filled=['column','bar','box','histogram'].includes(kind),symbol=['scatter','line_symbol'].includes(kind);
  if(filled||symbol){await set(symbol?'符号填充颜色':'填充颜色','#168c60');await set(symbol?'符号边框颜色':'边框颜色','#314159');assert.equal(await page.evaluate(()=>window.spec.series[0].fillColor),'#168c60');assert.equal(await page.evaluate(()=>window.spec.series[0].borderColor),'#314159');}
  if(symbol){await set('符号边框宽度（% 半径）','25');assert.equal(await page.evaluate(()=>window.spec.series[0].symbolEdgeWidth),25);}
  if(kind==='box'){await set('箱体宽度（pt）','32');assert.equal(await page.evaluate(()=>window.spec.series[0].boxWidth),32);}
  if(kind==='histogram'){await set('分箱宽度（留空自动）','20');assert.equal(await page.evaluate(()=>window.spec.series[0].binWidth),20);}
  if(['column','bar'].includes(kind)){await set('柱间距（%）','40');assert.equal(await page.evaluate(()=>window.spec.series[0].barGap),40);}
 }
 await page.evaluate(()=>window.batch());await page.waitForSelector('[data-plot-property-draft]');
 await set('分箱宽度（留空自动）','0');await page.waitForSelector('[role=alert]');assert.equal(await page.evaluate(()=>window.commits),0,'invalid completed settings must not reach rendering');
 await set('分箱宽度（留空自动）','20');assert.equal(await page.evaluate(()=>window.spec.series[0].binWidth),20);assert.equal(await page.evaluate(()=>window.commits),1);
 await page.evaluate(()=>window.legend());await page.waitForFunction(()=>document.querySelector('h5')?.textContent==='图例名称');
 assert.equal(await page.$$eval('input:invalid',nodes=>nodes.length),2,'precise Origin positions reproduce step mismatches');
 await set('字号','40');assert.equal(await page.evaluate(()=>window.spec.legendStyle.size),40,'Enter submits font size despite untouched precise positions');
 await page.evaluate(()=>{const canvas=document.createElement('div');canvas.id='drag-canvas';canvas.textContent='Origin canvas';canvas.style='width:200px;height:100px';canvas.addEventListener('pointerdown',e=>e.preventDefault());document.body.append(canvas);});
 const size=await page.evaluateHandle(()=>[...document.querySelectorAll('label')].find(n=>n.firstChild.textContent==='字号').querySelector('input'));await size.asElement().focus();
 await page.evaluate(()=>{const n=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'44');n.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>window.spec.legendStyle.size),40,'typing stays local');await page.click('#drag-canvas');assert.equal(await page.evaluate(()=>window.spec.legendStyle.size),44,'canvas pointerdown submits before drag prevents focus');assert.equal(await page.evaluate(()=>window.commits),2);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
test('plotting wizard: upload and drop, ranked choice, Origin preview request, canvas edit and three saved entry files',{skip:!executable||!reactRoot,timeout:60000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-browser-')),csv=join(root,'实验数据.csv');await writeFile(csv,'Time (s),Signal\n0,1\n1,2\n2,4\n');
 const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {PlottingPanel} from './client/src/components-plotting.js';import {injectStyles} from './client/src/styles.js';import {plotSpecSchema,materializeNumericAxes,validatePlotSelection} from './src/plot/workspace.js';injectStyles();window.requests=[];let records=[];
 const file={path:'owned',fileName:'实验数据.csv',sha256:'abc',byteLength:100};
 const profile={sheets:['数据','第二页'],sheet:'数据',rows:3,columns:[{index:0,name:'Time (s)',type:'number',count:3,missing:0,unique:3,min:0,max:2,monotonic:true},{index:1,name:'Signal',type:'number',count:3,missing:0,unique:3,min:1,max:4,monotonic:true}],sample:[[0,1],[1,2],[2,4]],warnings:[],normalizedPath:'owned.csv'};
 const recommendations=[{kind:'line',reason:'有序时间变量，适合比较信号的变化趋势',xCol:0,yCols:[1]},{kind:'scatter',reason:'观察两个数值变量之间的关系',xCol:0,yCols:[1]}];
 const call=async(method,{request})=>{window.requests.push({method,request});
 if(method==='plot_records_list')return {records:structuredClone(records)};if(method==='characterization_list')return {tasks:[]};
 if(method==='plot_workspace_upload'){let record={id:'plot-'+records.length,projectId:'p',topic:'实验数据',createdAt:new Date().toISOString(),workflow:{version:1,status:'recommended',stage:'请选择图样式',revision:1,headerRow:0,raw:file,profile,sheet:'数据',recommendations}};records.unshift(record);return {record:structuredClone(record)};}
 let row=records.find(row=>row.id===(request.id||request.recordId));
 if(method==='plot_records_update'){Object.assign(row,request.patch);return {record:structuredClone(row)};}
 if(method==='plot_workspace_render'){Object.assign(row.workflow,{spec:request.spec,revision:row.workflow.revision+1,operation:'op-'+Date.now(),status:request.save?'saving':'generating',stage:request.save?'正在回写并保存 Origin 工程':'Origin 正在绘制预览'});let result=structuredClone(row);setTimeout(()=>{let draft={preview:{...file,fileName:'figure.png'},origin:{...file,fileName:'figure.opju'},pdf:{...file,fileName:'figure.pdf'}};Object.assign(row.workflow,{draft,renderedSpec:request.spec,status:request.save?'completed':'editing',stage:request.save?'已保存 Origin 工程':'初版已生成，可编辑画布'});if(request.save)Object.assign(row.workflow,{saved:draft,savedSpec:request.spec,savedAt:new Date().toISOString()});},100);return {record:result};}
 if(method==='plot_workspace_preview'){if(window.failPreview)throw Error('Origin preview test failure');const normalized=materializeNumericAxes(validatePlotSelection(plotSpecSchema.parse(request.spec),row.workflow.profile),row.workflow.profile);const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(normalized)));const specHash=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');await new Promise(resolve=>setTimeout(resolve,250));return {preview:{...file,sha256:'updated-preview-'+request.requestSeq,renderId:'updated-render-'+request.requestSeq,specHash,tier:'quick',width:900,height:800}};}
 if(method==='plot_workspace_auto_layout'){row.workflow.spec=request.spec;row.workflow.revision++;return {record:structuredClone(row),prompt:'ibm-plot-auto-layout: apply the provided plotting standard'};}
 if(method==='plot_workspace_discard'){Object.assign(row.workflow,{spec:row.workflow.savedSpec,draft:row.workflow.saved,status:row.workflow.saved?'completed':'recommended',revision:row.workflow.revision+1});return {record:structuredClone(row)};}
 return {};};window.addPanelFixture=()=>{const row=structuredClone(records[0]);row.id='plot-panel';row.topic='排版测试';row.workflow.profile.columns.push({...row.workflow.profile.columns[1],index:2,name:'Secondary'});row.workflow.spec.yCols=[1,2];row.workflow.savedSpec=structuredClone(row.workflow.spec);records.push(row);};createRoot(document.getElementById('root')).render(React.createElement(PlottingPanel,{projectId:'p',call,onRefineConversation:async(row,options)=>{if(options?.autoLayout){window.autoLayout={id:row.id,prompt:options.prompt};return;}window.refined=row.id;const item=records.find(item=>item.id===row.id);item.conversationSessionId='plot-chat';item.workflow.pendingRefinement={originSpec:item.workflow.spec,baseOriginSha256:'abc',refinement:{reason:'图例',before:.1,after:.05,scope:'需要视觉核对'}};},onOpenConversation:async(sessionId,entry)=>{window.opened={sessionId,entry};}}));`;
 const built=await esbuild.build({stdin:{contents:fixture,resolveDir:repo,sourcefile:'plot-fixture.js'},bundle:true,format:'iife',platform:'browser',write:false,target:['chrome110'],nodePaths:[reactRoot],logLevel:'silent'});
 const preview=process.env.IBM_PLOT_PREVIEW?await readFile(process.env.IBM_PLOT_PREVIEW):null;
 const server=createServer((req,res)=>{
  if(req.url.includes('slot=data')){res.setHeader('content-type','text/csv');res.end('Time (s),Signal\n0,1\n1,2\n2,4\n');}
  else if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].text);}
  else if(req.url.startsWith('/api/lab-artifacts')){res.setHeader('content-type',preview?'image/png':'image/svg+xml');res.end(preview||'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="800"><rect width="900" height="800" fill="white"/><path d="M120 80v600h660M130 600L280 490L430 410L590 260L730 140" fill="none" stroke="#245c75" stroke-width="7"/><text x="340" y="755" font-family="Arial" font-size="32">Time (s)</text></svg>');}
  else res.end('<html><body style="margin:0"><main class="ib-overlay" style="padding:24px;box-sizing:border-box"><div id="root"></div></main><script src="/fixture.js"></script></body></html>');
 });server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
 const output=process.env.IBM_PLOT_BROWSER_OUTPUT;if(output)await mkdir(output,{recursive:true});
 try{
  browser=await launchSystemBrowser(puppeteer,executable,{headless:'new',defaultViewport:{width:1280,height:920}});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const click=async text=>page.evaluate(text=>{const node=Array.from(document.querySelectorAll('button')).find(n=>n.textContent.trim()===text&&!n.disabled);if(!node)throw Error('Button not found: '+text);node.click();},text);
  await page.waitForSelector('.ib-plot-empty');await click('＋ 新建绘图');await page.waitForSelector('[aria-label="新建绘图"]');
  await (await page.$('input[type=file]')).uploadFile(csv);await page.waitForSelector('.ib-plot-choice');
  assert.match(await page.$eval('.ib-plot-choice',node=>node.textContent),/折线图/);assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_render').length),0);
  if(output)await page.screenshot({path:join(output,'01-ai-recommendations.png')});
  await page.$eval('.ib-plot-choice:nth-child(2)',node=>node.click());await click('生成 Origin 初稿');await page.waitForSelector('.ib-plot-native-frame img');await page.waitForFunction(()=>document.querySelector('.ib-plot-render-state')?.textContent==='Origin 图片已更新');
  assert.equal(await page.evaluate(()=>window.requests.find(r=>r.method==='plot_workspace_render').request.spec.kind),'scatter');
  assert.equal(await page.$$eval('.ib-plot-wizard .ib-plot-native-frame img',nodes=>nodes.length),1);
  assert.equal(await page.$$eval('.ib-plot-wizard [data-live-preview],.ib-plot-wizard .ib-plot-comparison',nodes=>nodes.length),0);
  assert.equal(await page.$$eval('.ib-plot-wizard button',nodes=>nodes.filter(n=>['本地画布','并排核对','交给 Origin 核对'].includes(n.textContent)).length),0);
  await click('X 坐标轴');await click('轴标题');
  assert.ok(await page.$eval('.ib-plot-axis-tabs button',n=>parseFloat(getComputedStyle(n).fontSize))>=20);
  assert.ok(await page.$eval('.ib-plot-properties input',n=>parseFloat(getComputedStyle(n).fontSize))>=20);
  assert.ok(await page.$eval('.ib-plot-object-tree button',n=>parseFloat(getComputedStyle(n).fontSize))>=20);
  await page.focus('.ib-plot-properties input');
  await page.$eval('.ib-plot-properties input',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Elapsed time (s)');node.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>window.requests.some(r=>r.method==='plot_workspace_preview')),false,'typing must remain local until committed');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.ib-plot-editor')?.getAttribute('aria-busy')==='true');
  assert.equal(await page.$eval('.ib-plot-properties input',n=>n.disabled),false,'preview rendering must not disable parameter editing');
  assert.equal(await page.$eval('.ib-plot-native-frame',n=>n.style.filter),'grayscale(1)');
  await page.waitForFunction(()=>window.requests.some(r=>r.method==='plot_workspace_preview'));
  await page.waitForFunction(()=>document.querySelector('.ib-plot-wizard .ib-plot-native-frame img')?.src.includes('slot=quick-preview'));
  assert.equal(await page.$$eval('.ib-plot-wizard .ib-plot-native-frame img',nodes=>nodes.length),1,'editing keeps one Origin bitmap');
  await page.waitForFunction(()=>document.querySelector('.ib-plot-editor')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.$eval('.ib-plot-properties input',n=>n.disabled),false);
  const lastImage=await page.$eval('.ib-plot-native-frame img',n=>n.src);
  await page.focus('.ib-plot-properties input[type=number]');
  await page.$eval('.ib-plot-properties input[type=number]',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'3');node.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').length),1,'partial numeric input must not request a render');
  await page.$eval('.ib-plot-properties input[type=number]',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'38');node.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.$$eval('.ib-plot-properties input[type=number]',nodes=>nodes[1].focus());
  await page.$$eval('.ib-plot-properties input[type=number]',nodes=>{const node=nodes[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'15');node.dispatchEvent(new Event('input',{bubbles:true}));});
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').length),1,'moving between parameter fields must keep one local batch');
  assert.equal(await page.$eval('.ib-plot-properties input',n=>n.disabled),false);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').length>=2);
  assert.equal(await page.$eval('.ib-plot-native-frame img',n=>n.src),lastImage,'waiting for another edit must retain the previous render');
  await page.waitForFunction(previous=>document.querySelector('.ib-plot-native-frame img').src!==previous,{},lastImage);
  assert.match(await page.$eval('.ib-plot-native-frame img',n=>n.src),/slot=quick-preview/);
  await page.waitForFunction(()=>document.querySelector('.ib-plot-editor')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').at(-1).request.spec.xLabel),'Elapsed time (s)');
  assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').at(-1).request.spec.xTitleStyle.size),38);
  assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').at(-1).request.spec.xTitleStyle.rotation),15);

  await page.evaluate(()=>{window.failPreview=true;});
  await page.focus('.ib-plot-properties input[type=number]');
  await page.$eval('.ib-plot-properties input[type=number]',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'39');node.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('.ib-plot-properties h4');
  await page.waitForFunction(()=>document.querySelector('.ib-plot-native-warning')?.textContent.includes('Origin preview test failure'));
  assert.equal(await page.$eval('.ib-plot-editor',n=>n.getAttribute('aria-busy')),'false','failed previews must unlock the editor');
  assert.equal(await page.$eval('.ib-plot-properties input',n=>n.disabled),false);
  await page.evaluate(()=>{window.failPreview=false;});
  await click('保存 Origin 工程');await page.waitForFunction(()=>!document.querySelector('[aria-label="科研绘图向导"]'));
  const rendered=await page.evaluate(()=>window.requests.filter(r=>r.method==='plot_workspace_render').at(-1));assert.equal(rendered.request.save,true);assert.equal(rendered.request.localPreviewBase64,undefined,'saving must not substitute a local SVG snapshot');
  const labels=await page.$$eval('.ib-plot-entry-files button',nodes=>nodes.map(n=>({label:n.textContent,disabled:n.disabled})));assert.deepEqual(labels,[{label:'原始数据',disabled:false},{label:'Origin 工程',disabled:false},{label:'修改图片',disabled:false}]);
  if(preview){
   await page.setViewport({width:4200,height:4200,deviceScaleFactor:1});await page.click('.ib-plot-entry-name');await click('原始像素');await page.waitForSelector('.ib-plot-paper figure img');
   const img=await page.$('.ib-plot-paper figure img');await img.evaluate(node=>node.decode());const sharp=(await import('sharp')).default,box=await img.boundingBox();
   assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=4200&&box.y+box.height<=4200,'image must fit in the test viewport: '+JSON.stringify(box));
   const expected=await sharp(preview).ensureAlpha().raw().toBuffer({resolveWithObject:true}),actual=await sharp(await page.screenshot({type:'png',clip:{x:box.x,y:box.y,width:box.width,height:box.height}})).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   assert.equal(actual.info.width,expected.info.width);assert.equal(actual.info.height,expected.info.height);assert.deepEqual(actual.data,expected.data,'1:1 screenshot must match decoded Origin pixels');await click('关闭');
  }
  await click('修改图片');await page.waitForSelector('[aria-label="科研绘图向导"] .ib-plot-editor');await page.waitForSelector('.ib-plot-properties');
  assert.equal(await page.$$eval('.ib-plot-object-tree button',nodes=>nodes.filter(n=>n.textContent==='多面板排版').length),0);
  await click('数据系列');assert.equal(await page.$eval('.ib-plot-properties',n=>n.textContent.includes('图例名称')),false);
  await click('图例');assert.equal(await page.$eval('.ib-plot-properties',n=>n.textContent.includes('图例名称')),true);
  assert.equal(await page.$$eval('.ib-plot-legend-locator',nodes=>nodes.length),0);
  assert.ok(await page.$$eval('.ib-plot-legend-order',nodes=>nodes.length)>0,'legend ordering controls remain');
  assert.equal(await page.$eval('.ib-plot-editor',n=>n.textContent.includes('选择图中元素或左侧对象修改')||n.textContent.includes('部分文字碰撞无法自动确认')),false);
  assert.equal(await page.evaluate(()=>window.refined),undefined,'manual editing must not start an AI conversation');assert.equal(await page.evaluate(()=>window.opened),undefined,'manual editing must not navigate to an existing conversation');assert.equal(await page.evaluate(()=>window.requests.some(r=>r.method==='plot_workspace_refine')),false);
  await click('画布');
  await page.$eval('.ib-plot-properties select',node=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,'tight');node.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.$eval('.ib-plot-properties select',node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  await page.waitForFunction(()=>window.requests.filter(r=>r.method==='plot_workspace_preview').at(-1)?.request.spec.pageFit==='tight');
  await page.waitForFunction(()=>document.querySelector('.ib-plot-editor')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.$eval('.ib-plot-canvas-toolbar > button:last-child',n=>n.textContent),'Auto');
  await click('Auto');await page.waitForFunction(()=>window.autoLayout?.id==='plot-0');assert.match(await page.evaluate(()=>window.autoLayout.prompt),/ibm-plot-auto-layout/);await page.waitForFunction(()=>!document.querySelector('[aria-label="科研绘图向导"]'));
  await page.evaluate(()=>window.addPanelFixture());
  await page.waitForFunction(()=>[...document.querySelectorAll('.ib-plot-entry-name')].some(n=>n.textContent==='排版测试'));
  await click('多面板排版');await page.waitForSelector('[aria-label="选择多面板绘图"]');assert.equal(await page.$$eval('.ib-layout-candidate',nodes=>nodes.length),2);await click('关闭');
  await page.setViewport({width:1280,height:920});if(output)await page.screenshot({path:join(output,'04-saved-entry.png')});
  await page.evaluate(()=>{const files=new DataTransfer();files.items.add(new File(['x,y\n1,2'],'第二组.csv',{type:'text/csv'}));document.querySelector('.ib-plotting').dispatchEvent(new DragEvent('drop',{dataTransfer:files,bubbles:true,cancelable:true}));});await page.waitForFunction(()=>window.requests.filter(r=>r.method==='plot_workspace_upload').length===2);
  await page.waitForSelector('.ib-plot-choice');await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});


test('native scene selects a source series, rejects active SVG content and drags annotation endpoints',{skip:!executable||!reactRoot,timeout:60000},async()=>{
 const fixture=String.raw`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {h} from './client/src/h.js';import {EditorProperties} from './client/src/plot-editor-controls.js';import {NativeSceneOverlay} from './client/src/plot-native-scene.js';import {plotSpecSchema} from './src/plot/workspace.js';import {injectStyles} from './client/src/styles.js';injectStyles();
 function Fixture(){const [spec,setSpec]=useState(plotSpecSchema.parse({kind:'line_symbol',xCol:0,yCols:[1,2],titleText:'Graph title'})),[selected,onSelect]=useState('canvas');window.spec=spec;window.selected=selected;window.bar=()=>setSpec(old=>({...old,kind:'bar'}));const change=patch=>setSpec(old=>({...old,...patch}));const scene={viewBox:[0,0,100,100],layers:[{index:0,left:.1,top:.1,width:.8,height:.8}],objects:[]};return h('div',null,h('button',{onClick:()=>onSelect('annotations')},'标注工具'),h('div',{className:'ib-plot-paper',style:{width:'600px',height:'500px',position:'relative',background:'white'}},h(NativeSceneOverlay,{url:'/scene.svg',scene,canvas:scene.layers[0],spec,selected,onSelect,change})),h('aside',{className:'ib-plot-properties'},h(EditorProperties,{selected,spec,change,profile:{columns:[{name:'Time'},{name:'Control'},{name:'Treated'}]},onSelect,scene})));}createRoot(document.getElementById('root')).render(h(Fixture));`;
 const built=await esbuild.build({stdin:{contents:fixture,resolveDir:repo,sourcefile:'native-editor-fixture.js'},bundle:true,format:'iife',platform:'browser',write:false,target:['chrome110'],nodePaths:[reactRoot],logLevel:'silent'});
 const server=createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].text);}
  else if(req.url==='/scene.svg'){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>window.pwned=true</script><image href="https://invalid.example/tracker.png"/><g class="Layer0" transform="translate(2 1)"><text x="30" y="8" font-size="6" font-style="italic"><tspan style="font-kerning:none;white-space:pre" xml:space="preserve">Graph</tspan><tspan dx="2" style="white-space:pre"> title</tspan></text><polyline points="60,22 68,22"/><text x="69" y="23" font-size="4">Control</text><polyline points="60,29 68,29"/><text x="69" y="30" font-size="4">Treated</text></g><text class="Layer0 Axis0 Title" x="35" y="98" font-size="6">Time</text><text class="Layer0 Axis1 Title" x="0" y="0" font-size="6" transform="matrix(0 -1 1 0 7 60)">Signal</text><text class="Layer0 Axis0 TickLabel" x="45" y="95" font-size="3">10</text><polyline class="Layer0 Axis0 Line" points="10,90 90,90"/><path class="Layer0 Plot0" d="M10 90 L90 10" onclick="window.pwned=true"/></svg>');}
  else res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
 try{
  browser=await launchSystemBrowser(puppeteer,executable,{headless:'new',defaultViewport:{width:1100,height:1000}});const page=await browser.newPage(),external=[];page.on('request',r=>{if(r.url().includes('invalid.example'))external.push(r.url());});await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForSelector('[data-column="1"]');await page.click('[data-column="1"]');assert.equal(await page.evaluate(()=>window.selected),'series:1');
  await page.evaluate(()=>{const label=[...document.querySelectorAll('label')].find(n=>n.firstChild.textContent==='系列颜色'),input=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#b42035');input.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.evaluate(()=>window.spec.series[0].color),'#b42035');
  for(const key of ['title','legend','axis-title:x','axis-title:y','ticks:x','x']){
   const node=await page.$('[data-native-key="'+key+'"]'),hit=await node.boundingBox();assert.ok(hit,key);await page.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2);assert.equal(await page.evaluate(()=>window.selected),key);await page.waitForSelector('[data-native-selection="'+key+'"]');
  }
  assert.equal(await page.$eval('[data-native-key="title"] tspan',n=>getComputedStyle(n).fontKerning),'none');
  assert.equal(await page.$eval('[data-native-key="title"] tspan',n=>getComputedStyle(n).whiteSpace),'pre');
  assert.equal(await page.$eval('[data-native-key="title"]',n=>getComputedStyle(n).fontStyle),'italic');
  assert.match(await page.$eval('[data-native-key="title"]',n=>n.getAttribute('transform')),/translate\(2 1\)/);
  assert.equal(await page.$eval('[data-column="1"]',n=>n.parentElement.getAttribute('transform')),'scale(0.01 0.01) translate(0 0)');
  assert.equal(await page.$$eval('[aria-label="拖动X 轴标题"],[aria-label="拖动Y 轴标题"],[aria-label="拖动图标题"],[aria-label="拖动图例"]',nodes=>nodes.length),0);
  assert.equal(await page.$eval('[data-column="1"]',n=>n.getAttribute('stroke-width')),'20');
  for(const key of ['title','legend','axis-title:x','axis-title:y'])assert.equal(await page.$eval('[data-native-key="'+key+'"]',n=>getComputedStyle(n).cursor),'grab');
  const legend=await page.$('[data-native-key="legend"]'),legendBox=await legend.boundingBox();
  await page.mouse.click(legendBox.x+legendBox.width/2,legendBox.y+legendBox.height/2);
  const initialRect=await page.$eval('[data-native-selection="legend"]',n=>+n.getAttribute('x')),initialSpec=await page.evaluate(()=>window.spec.legendX);
  await page.mouse.move(legendBox.x+legendBox.width/2,legendBox.y+legendBox.height/2);await page.mouse.down();await page.mouse.move(legendBox.x+legendBox.width/2+30,legendBox.y+legendBox.height/2+15,{steps:4});
  assert.ok(await page.$eval('[data-native-selection="legend"]',n=>+n.getAttribute('x'))>initialRect,'selection frame follows pointer before rendering');
  assert.equal(await page.evaluate(()=>window.spec.legendX),initialSpec,'pointer movement must not submit a render');
  await page.mouse.up();assert.ok(await page.evaluate(()=>window.spec.legendX)>initialSpec);
  await page.evaluate(()=>{const label=[...document.querySelectorAll('.ib-plot-properties label')].find(n=>n.firstChild.textContent==='Control'),input=label.querySelector('input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Renamed control');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.spec.series[0].label),'Renamed control');assert.equal(await page.evaluate(()=>window.spec.series[0].color),'#b42035');


  const click=async text=>page.evaluate(text=>{const node=[...document.querySelectorAll('button')].find(n=>n.textContent===text);if(!node)throw Error(text);node.click();},text);
  await click('标注工具');await click('＋箭头');await page.waitForSelector('[aria-label="拖动标注终点"]');const endpoint=await page.$('[aria-label="拖动标注终点"]'),rect=await endpoint.boundingBox();const before=await page.evaluate(()=>window.spec.annotations[0]);
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+48,rect.y+rect.height/2+40,{steps:4});await page.mouse.up();
  const after=await page.evaluate(()=>window.spec.annotations[0]);assert.equal(after.x,before.x);assert.ok(after.x2>before.x2+.05);assert.ok(after.y2>before.y2+.05);assert.deepEqual(external,[]);assert.equal(await page.evaluate(()=>window.pwned),undefined);await page.evaluate(()=>window.bar());await page.waitForFunction(()=>[...document.querySelectorAll('[data-native-key]')].some(n=>n.getAttribute('data-native-key')==='axis-title:y'&&n.textContent==='Time'));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
