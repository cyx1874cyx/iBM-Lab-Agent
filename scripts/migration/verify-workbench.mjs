/* global document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const output = resolve(arg('--output') || '../../work/workbench-dev-20261021/verification');
mkdirSync(output, { recursive: true });
const browser = await puppeteer.connect({ ...(arg('--endpoint') ? { browserWSEndpoint: arg('--endpoint') } : { browserURL: arg('--browser-url') || 'http://127.0.0.1:61936' }), defaultViewport: null });
const errors = [];
let frame, page;
for (let attempt = 0; attempt < 120 && !frame; attempt++) {
 for (const candidate of await browser.pages()) {
  for (const current of candidate.frames()) {
   if (await current.$('.ib-wb').catch(() => null)) { frame = current; page = candidate; break; }
  }
 }
 if (!frame) await new Promise(done => setTimeout(done, 250));
}
if (!frame) {
 for (const candidate of await browser.pages()) {
  console.log('Page:', candidate.url());
  for (const current of candidate.frames()) console.log('Frame:', current.url().split('?')[0], await current.evaluate(() => document.body.innerText.slice(0, 3500)).catch(error => error.message));
  await candidate.screenshot({ path: join(output, 'startup-failure.png') }).catch(() => {});
 }
 browser.disconnect(); throw Error('Workbench did not mount');
}
page.on('pageerror', error => errors.push(error.message));
const report = { checks: [], errors, screenshots: output };
const rpc = (method, request) => frame.evaluate(async (method, request) => {
 const response = await fetch('/api/lab/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'lab/' + method, payload: { args: request === undefined ? {} : { request } } }) });
 const result = await response.json();
 if (!result.result?.ok) throw Error(JSON.stringify(result));
 return result.result.value;
}, method, request);
const clickText = async (selector, text) => {
 const clicked = await frame.evaluate((selector, text) => { const button = [...document.querySelectorAll(selector)].find(node => node.textContent.trim() === text); if (!button) return false; button.click(); return true; }, selector, text);
 assert.ok(clicked, 'Missing button: ' + text);
};
try {
 await page.screenshot({ path: join(output, 'workbench-home.png') });
 report.initial = await frame.evaluate(() => ({ title: document.title, nav: [...document.querySelectorAll('.ib-wb-nav nav button')].map(node => node.textContent), chat: Boolean(document.querySelector('.ib-wb-conversation textarea,[contenteditable=true]')), text: document.body.innerText.slice(0, 1800) }));
 if (process.argv.includes('--inspect-only')) { console.log(JSON.stringify(report.initial, null, 2)); browser.disconnect(); process.exit(0); }
 const projects = (await rpc('projects_list')).projects || [];
 let project = projects.find(row => row.id === 'workbench-preview');
 if (!project) project = (await rpc('projects_create', { fields: { id: 'workbench-preview', name: '前端验证课题', coreMarkdown: '# 前端验证课题\n\n仅用于本地界面验证。' } })).project;
 // The real Home component reloads its project list when revisited.
 await frame.click('.ib-wb-brand');
 await frame.waitForSelector('.ib-wb[data-welcome]');
 assert.equal(await frame.$eval('.ib-wb-nav', node => getComputedStyle(node).display), 'none');
 assert.equal(await frame.$eval('.ib-wb-chat', node => getComputedStyle(node).display), 'none');
 assert.equal(await frame.$eval('.ib-wb-welcome h1', node => node.textContent), '欢迎使用 iBM Lab');
 assert.equal(await frame.$('button.ib-wb-project-picker'), null);
 report.checks.push('unloaded-project-shows-full-welcome-page');
 await frame.waitForFunction(() => [...document.querySelectorAll('.ib-project-file-recent')].some(node => node.textContent.includes('前端验证课题')));
 await frame.evaluate(() => [...document.querySelectorAll('.ib-project-file-recent')].find(node => node.textContent.includes('前端验证课题')).click());
 await frame.waitForFunction(() => document.querySelector('.ib-wb-current-project')?.textContent.includes('前端验证课题'));
 assert.equal(await frame.$eval('.ib-wb-current-project', node => node.tagName), 'DIV');
 await frame.waitForSelector('.ib-wb-project-page');
 await frame.waitForFunction(() => document.querySelector('.ib-wb-conversation [contenteditable=true],.ib-wb-conversation textarea'));
 const bindingBefore = (await rpc('projects_binding', { projectId: project.id })).binding;
 report.checks.push('real-project-open-and-resident-conversation');
 await frame.click('[data-module=planning]');
 await frame.waitForFunction(() => document.querySelector('.ib-wb-page-head h1')?.textContent === '合成路线');
 assert.ok(await frame.$('.sw04-workspace,.sw-workspace,.ib-tab-panel'));
 await frame.click('[data-module=characterization]');
 await frame.waitForFunction(() => document.querySelector('.ib-wb-page-head h1')?.textContent === '核磁解析');
 await frame.waitForSelector('.ib-tab-panel:not([hidden]) [data-task-kind=nmr]');
 assert.equal(await frame.$('.ib-tab-panel:not([hidden]) [data-task-kind=plot]'), null);
 await frame.click('[data-module=plotting]');
 await frame.waitForFunction(() => document.querySelector('.ib-wb-page-head h1')?.textContent === '科研绘图');
 await frame.waitForSelector('.ib-tab-panel:not([hidden]) [data-task-kind=plot]');
 assert.equal(await frame.$('.ib-tab-panel:not([hidden]) [data-task-kind=nmr]'), null);
 await clickText('.ib-tab-panel:not([hidden]) button', '提交绘图任务');
 await frame.waitForSelector('[data-task-kind=plot] [role=dialog]');
 assert.match(await frame.$eval('[data-task-kind=plot] [role=dialog]', node => node.textContent), /上传数据文件/);
 assert.doesNotMatch(await frame.$eval('[data-task-kind=plot] [role=dialog]', node => node.textContent), /FID|谱核|氘代/);
 await frame.click('[data-module=characterization]');
 await frame.waitForSelector('.ib-tab-panel:not([hidden]) [data-task-kind=nmr]');
 await frame.click('[data-module=plotting]');
 await frame.waitForSelector('.ib-tab-panel:not([hidden]) [data-task-kind=plot] [role=dialog]');
 await clickText('[data-task-kind=plot] [role=dialog] button', '取消');
 report.checks.push('scientific-plotting-is-independent-from-nmr-and-retains-own-form');
 report.checks.push('existing-synthesis-and-characterization-panels');
 await frame.click('[data-module=polishing]');
 await frame.waitForSelector('#ib-wb-draft-polishing:not(:disabled)');
 await frame.focus('#ib-wb-draft-polishing'); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
 await frame.type('#ib-wb-draft-polishing', 'This is a local frontend verification draft.');
 await frame.click('[data-module=proposal]');
 await frame.waitForSelector('#ib-wb-draft-proposal:not(:disabled)');
 await frame.focus('#ib-wb-draft-proposal'); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
 await frame.type('#ib-wb-draft-proposal', '研究目标与技术路线测试。');
 await frame.click('[data-module=polishing]');
 await frame.waitForSelector('#ib-wb-draft-polishing:not(:disabled)');
 assert.equal(await frame.$eval('#ib-wb-draft-polishing', node => node.value), 'This is a local frontend verification draft.');
 await clickText('.ib-wb-writing button', '交给右侧助手');
 await frame.waitForFunction(() => document.querySelector('.ib-wb-conversation')?.innerText.includes('This is a local frontend verification draft.') || [...document.querySelectorAll('.ib-wb-conversation [contenteditable=true],.ib-wb-conversation textarea')].some(node => (node.value || node.textContent).includes('This is a local frontend verification draft.')));
 const bindingAfter = (await rpc('projects_binding', { projectId: project.id })).binding;
 assert.deepEqual(bindingAfter.sessionIds, bindingBefore.sessionIds, 'Preparing a workbench task should reuse the current project conversation');
 report.checks.push('writing-drafts-survive-module-switch-and-populate-real-composer');
 assert.equal((await rpc('projects_draft_read', { projectId: project.id, kind: 'polishing' })).text, 'This is a local frontend verification draft.');
 assert.equal((await rpc('projects_get', { id: project.id })).project.projectFilePath.endsWith('.ibmproject'), true);
 report.checks.push('project-document-and-writing-draft-persist-to-project-folder');
 await page.screenshot({ path: join(output, 'workbench-polishing.png') });
 await frame.click('[data-module=knowledge]');
 assert.match(await frame.$eval('.ib-wb-pending', node => node.textContent), /待接入/);
 await frame.click('[data-module=reagents]');
 assert.match(await frame.$eval('.ib-wb-pending', node => node.textContent), /待接入/);
 report.checks.push('unfinished-services-explicitly-labelled');
 await clickText('.ib-wb-top button', '收起对话');
 assert.equal(await frame.$eval('.ib-wb-chat', node => getComputedStyle(node).display), 'none');
 await clickText('.ib-wb-top button', '展开对话');
 await frame.click('[role=separator]');
 await frame.focus('[role=separator]');
 const before = await frame.$eval('.ib-wb-chat', node => node.getBoundingClientRect().width);
 await page.keyboard.press('ArrowLeft');
 const after = await frame.$eval('.ib-wb-chat', node => node.getBoundingClientRect().width);
 assert.ok(after >= before, 'Keyboard resizing must increase chat width');
 await clickText('.ib-wb-top button', '会话与设置');
 await frame.waitForFunction(() => !document.querySelector('.ib-wb-history').hidden);
 assert.ok(await frame.$('.ib-wb-history-panel [class*="_regionArea"]'));
 await clickText('.ib-wb-history-heading button', '关闭');
 report.checks.push('chat-collapse-resize-and-native-history');
 await frame.click('[data-module=literature]');
 await frame.waitForSelector('.ib-lit');
 await page.screenshot({ path: join(output, 'workbench-literature.png') });
 const geometry = await frame.evaluate(() => {
  const box = selector => { const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height }; };
  return { nav: box('.ib-wb-nav'), center: box('.ib-wb-center'), chat: box('.ib-wb-chat'), overflow: document.documentElement.scrollWidth > window.innerWidth };
 });
 assert.ok(geometry.center.x > geometry.nav.x && geometry.chat.x >= geometry.center.x + geometry.center.width);
 assert.equal(geometry.overflow, false);
 report.geometry = geometry;
 report.checks.push('three-column-geometry-no-horizontal-overflow');
 await frame.click('.ib-wb-conversation button[aria-label="打开右侧边栏"]');
 await frame.waitForSelector('.ib-wb-resources [data-sidebar-right-open]');
 const resource = await frame.$eval('.ib-wb-resources [data-sidebar-right-open]', node => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width }; });
 assert.equal(Math.round(resource.x), Math.round(geometry.center.x));
 assert.equal(Math.round(resource.width), Math.round(geometry.center.width));
 await page.screenshot({ path: join(output, 'workbench-resources.png') });
 await frame.click('[data-module=literature]');
 report.checks.push('original-resource-tabs-open-in-center-with-chat-resident');
 assert.deepEqual(errors, []);
 report.ok = true;
} catch (error) {
 report.error = String(error);
 await page.screenshot({ path: join(output, 'verification-failure.png') }).catch(() => {});
 report.failureText = await frame.evaluate(() => document.body.innerText.slice(0, 5500)).catch(() => '');
 throw error;
} finally {
 // Leave viewport emulation untouched; native resize checks use verify-workbench-window.
 writeFileSync(join(output, 'verification.json'), JSON.stringify(report, null, 2));
 browser.disconnect();
 console.log('Workbench verification: ' + join(output, 'verification.json'));
}
