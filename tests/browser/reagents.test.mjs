import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import {launchSystemBrowser,resolveBrowserExecutable} from './helpers/ketcher-page.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url)),executable=resolveBrowserExecutable();
const reactRoot=[join(repo,'node_modules'),resolve(repo,'../../outputs/electron-next-p1/next/dsh-plugin-desktop/node_modules')].find(path=>existsSync(join(path,'react/package.json')));
test('reagent search filters, source actions and details work at wide and narrow sizes',{skip:!executable||!reactRoot,timeout:30000},async()=>{
 const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {ReagentPanel} from './client/src/components-reagents.js';import {injectStyles} from './client/src/styles.js';
injectStyles();window.requests=[];
const rows=[{id:'chemical:3',sourceId:'chemical',kind:'chemical',fileName:'化学.xlsx',sheet:'小冰箱',row:3,name:'氘代氯仿',cas:'865-49-6',spec:'0.6 ml',brand:'安耐吉',location:'小冰箱 · 4℃上1',quantity:'0',fields:[{label:'CAS',value:'865-49-6'},{label:'数量',value:'0'}]},{id:'cells:2',sourceId:'cells',kind:'cells',fileName:'细胞.xlsx',sheet:'细胞清单',row:2,name:'RAW 264.7',catalogNumber:'C1',location:'-80℃',quantity:'2',fields:[{label:'生长培养基',value:'DMEM+10% FBS'}]}];
const call=async(method,{request})=>{window.requests.push({method,request});if(method==='reagents_open_source')return {opened:true};if(method==='reagents_choose_source')return {cancelled:true};let filtered=rows.filter(r=>(!request.query||JSON.stringify(r).toLowerCase().includes(request.query.toLowerCase()))&&(request.kind==='all'||r.kind===request.kind)&&(!request.location||r.location===request.location)&&request.status!=='used');return {total:filtered.length,offset:0,limit:50,records:filtered,counts:{all:2,chemical:1,biological:0,cells:1},locations:request.kind==='cells'?['-80℃']:['小冰箱 · 4℃上1','-80℃'],sources:[{id:'chemical',label:'化学试剂',configured:true,fileName:'化学.xlsx',count:1},{id:'biological',label:'生物试剂',configured:false,count:0},{id:'cells',label:'细胞',configured:true,fileName:'细胞.xlsx',count:1}]};};
createRoot(document.getElementById('root')).render(React.createElement(ReagentPanel,{call}));`;
 const built=await esbuild.build({stdin:{contents:fixture,resolveDir:repo,sourcefile:'reagents-fixture.js'},bundle:true,format:'iife',platform:'browser',write:false,target:['chrome110'],nodePaths:[reactRoot],logLevel:'silent'});
 const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].text);}else res.end('<html><body style="margin:0"><main class="ib-overlay" style="padding:24px;box-sizing:border-box"><div id="root"></div></main><script src="/fixture.js"></script></body></html>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
 try{
  browser=await launchSystemBrowser(puppeteer,executable,{headless:'new',defaultViewport:{width:1200,height:900}});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForSelector('.ib-reagent-row');assert.equal(await page.$$eval('.ib-reagent-row',nodes=>nodes.length),2);
  const setQuery=value=>page.$eval('#ib-reagent-query',(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await setQuery('865-49-6');await page.waitForFunction(()=>document.querySelectorAll('.ib-reagent-row').length===1);
  await page.click('.ib-reagent-name');await page.waitForSelector('[aria-label="试剂条目详情"]');assert.match(await page.$eval('.ib-reagent-detail',n=>n.innerText),/数量\n0/);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.ib-reagent-detail'));
  await setQuery('');await page.click('.ib-reagent-kinds button:last-child');await page.waitForFunction(()=>document.querySelectorAll('.ib-reagent-row').length===1&&document.querySelector('.ib-reagent-name')?.textContent==='RAW 264.7');
  await page.select('[aria-label="存放位置"]','-80℃');await page.waitForFunction(()=>window.requests.at(-1).request.location==='-80℃');
  await page.click('.ib-reagent-name');await page.waitForSelector('.ib-reagent-detail');assert.match(await page.$eval('.ib-reagent-detail',n=>n.innerText),/DMEM\+10% FBS/);await page.keyboard.press('Escape');
  await page.click('.ib-reagent-sources summary');await page.$eval('.ib-reagent-source button',n=>n.click());await page.waitForFunction(()=>window.requests.some(r=>r.method==='reagents_open_source'&&r.request.id==='chemical'));
  await page.select('[aria-label="清单标记"]','used');await page.waitForFunction(()=>document.querySelector('.ib-lit-empty')?.textContent.includes('没有匹配'));
  await page.select('[aria-label="清单标记"]','all');await page.waitForSelector('.ib-reagent-row');
  const output=process.env.IBM_REAGENT_BROWSER_OUTPUT;if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'reagents-wide.png')});}
  await page.setViewport({width:500,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(output)await page.screenshot({path:join(output,'reagents-narrow.png')});assert.deepEqual(errors,[]);
 }catch(error){console.error(error);throw error;}
 finally{try{await browser?.close();}catch(error){if(error.code!=='EPERM')throw error;}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}}
});
