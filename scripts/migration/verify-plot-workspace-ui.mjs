/* global document,HTMLInputElement */
/** End-to-end acceptance on the independent development Electron app. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,'Missing '+name);return process.argv[i+1];};
const output=resolve(arg('--output'));await mkdir(output,{recursive:true});
const browser=await puppeteer.connect({browserURL:arg('--browser-url'),defaultViewport:null});
const report={ok:false,checks:[]};let frame,page;
try{
 for(const candidate of await browser.pages())for(const f of candidate.frames())if(await f.$('.ib-wb').catch(()=>null)){frame=f;page=candidate;break;}
 assert.ok(frame,'iBM Lab workbench must be open');
 const rpc=(method,request)=>frame.evaluate(async(method,request)=>{const response=await fetch('/api/lab/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'lab/'+method,payload:{args:request===undefined?{}:{request}}})});const result=await response.json();if(!result.result?.ok)throw Error(JSON.stringify(result));return result.result.value;},method,request);
 const id='plotting-workflow-preview',name='科研绘图流程验证';
 const projects=(await rpc('projects_list')).projects;
 if(!projects.some(row=>row.id===id))await rpc('projects_create',{fields:{id,name,coreMarkdown:'# 科研绘图流程验证\n\n仅使用独立合成数据验证。'}});
 await frame.evaluate(project=>localStorage.setItem('ib-workbench:last-project',JSON.stringify(project)),{id,name});
 await page.reload();
 frame=undefined;
 for(let attempt=0;attempt<60&&!frame;attempt++){for(const f of page.frames())if(await f.$('.ib-wb').catch(()=>null)){frame=f;break;}if(!frame)await new Promise(resolve=>setTimeout(resolve,500));}
 assert.ok(frame,'workbench did not reload');
 await frame.waitForFunction(name=>document.querySelector('.ib-wb-current-project')?.textContent.includes(name),{},name);
 await frame.click('[data-module=plotting]');await frame.waitForSelector('.ib-tab-panel:not([hidden]) .ib-plotting');
 const input=join(output,'synthetic-time-series.csv');await writeFile(input,'Time (s),Sample A,Sample B\n0,2,3\n1,3,5\n2,5,6\n3,6,8\n4,8,9\n');
 const click=text=>frame.evaluate(text=>{const button=[...document.querySelectorAll('.ib-plot-wizard button,.ib-plotting button')].find(node=>node.textContent.trim()===text&&!node.disabled);if(!button)throw Error('Missing enabled button '+text);button.click();},text);
 await click('＋ 新建绘图');await (await frame.$('.ib-tab-panel:not([hidden]) .ib-plotting input[type=file]')).uploadFile(input);
 await frame.waitForFunction(()=>document.querySelector('.ib-plot-choice')||document.querySelector('.ib-plot-wizard .ib-error'),{timeout:180000});
 if(await frame.$('.ib-plot-wizard .ib-error'))throw Error(await frame.$eval('.ib-plot-wizard .ib-error',node=>node.innerText));
 const recommendations=await frame.$$eval('.ib-plot-choice',nodes=>nodes.map(node=>node.innerText));assert.ok(recommendations.length>0);report.recommendations=recommendations;
 const rows=(await rpc('plot_records_list',{projectId:id})).records;const record=rows.filter(row=>row.workflow).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];report.recordId=record.id;
 assert.equal(record.workflow.status,'recommended');assert.equal(record.workflow.draft,undefined);report.recommendationSource=record.workflow.recommendationSource;report.checks.push('real-upload-parser-recommendations-await-user-selection');
 await page.screenshot({path:join(output,'01-real-ai-recommendations.png')});
 await click('生成本地粗图和 Origin 初版');await frame.waitForSelector('.ib-plot-paper [data-live-preview]',{timeout:120000});
 await frame.waitForFunction(()=>document.querySelector('.ib-plot-render-state')?.textContent==='Origin 已生成，请核对',{timeout:120000});
 report.checks.push('user-selected-style-real-Origin-preview');
 await click('X 坐标轴');await click('轴标题');
 await frame.$eval('.ib-plot-properties input',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Elapsed time (s)');node.dispatchEvent(new Event('input',{bubbles:true}));});
 await frame.waitForFunction(()=>document.querySelector('.ib-plot-render-state')?.textContent.includes('Origin 快速图'),{timeout:90000});
 assert.match(await frame.$eval('.ib-plot-comparison figure img',node=>node.src),/slot=quick-preview/);report.checks.push('automatic-quick-preview-after-edit');
 await click('交给 Origin 核对');await frame.waitForFunction(()=>document.querySelector('.ib-plot-render-state')?.textContent==='Origin 已生成，请核对',{timeout:120000});
 await page.screenshot({path:join(output,'02-real-Origin-canvas.png')});
 await click('完成设计并生成 Origin');await frame.waitForFunction(()=>!document.querySelector('[aria-label="科研绘图向导"]'),{timeout:120000});
 const completed=(await rpc('plot_records_list',{projectId:id})).records.find(row=>row.id===record.id);
 assert.equal(completed.workflow.status,'completed');assert.equal(completed.workflow.savedSpec.xLabel,'Elapsed time (s)');assert.ok(completed.workflow.saved.origin.path.endsWith('.opju'));assert.ok(completed.workflow.saved.localPreview?.path.endsWith('.png'));report.saved=completed.workflow.saved;report.checks.push('edited-axis-Origin-writeback-and-confirmed-entry-save');
 await frame.$eval('.ib-plot-entry-files button:nth-child(2)',node=>node.click());await frame.waitForSelector('[aria-label="绘图图片预览"]');
 await page.screenshot({path:join(output,'03-real-saved-preview.png')});
 await frame.$eval('.ib-plot-image-preview .ib-plot-wizard-head button',node=>node.click());
 assert.deepEqual(await frame.$$eval('.ib-plot-entry:first-child .ib-plot-entry-files button',nodes=>nodes.map(node=>({text:node.textContent,disabled:node.disabled}))),[{text:'原始数据',disabled:false},{text:'图片预览',disabled:false},{text:'Origin 工程',disabled:false}]);
 await page.screenshot({path:join(output,'04-real-saved-entry.png')});report.checks.push('thumbnail-drawing-time-three-entry-artifacts-and-preview');report.ok=true;
}catch(error){report.error=error.message;if(page)await page.screenshot({path:join(output,'failure.png')});if(frame)report.failureText=await frame.evaluate(()=>document.body.innerText.slice(-5000));throw error;}
finally{await writeFile(join(output,'ui-verification.json'),JSON.stringify(report,null,2));browser.disconnect();console.log(JSON.stringify({ok:report.ok,checks:report.checks,evidence:join(output,'ui-verification.json'),error:report.error}));}
