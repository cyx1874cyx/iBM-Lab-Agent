/** Actual plugin settings + native Electron pet, with an isolated application home. */
/* global document */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { initializeRelease } from '../../electron-next/release-runtime.mjs';

const arg = name => {
 const index = process.argv.indexOf(name);
 assert.ok(index >= 0 && process.argv[index + 1], name + ' required');
 return resolve(process.argv[index + 1]);
};
const app = arg('--app'), resources = arg('--resources'), executable = arg('--executable'), output = arg('--output');
mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(output, 'run-')), home = join(work, '语录验收 数据');
const { NextProfiles } = await import(pathToFileURL(join(app, 'lib/profiles.js')));
initializeRelease({ home, resources, electron: executable, profiles: NextProfiles });
const profiles = new NextProfiles(home);
profiles.finishOnboarding('ibm-lab');profiles.dismissAccountSetup('ibm-lab');
if (process.argv.includes('--development-client')) copyFileSync(arg('--development-client'), join(profiles.directory('ibm-lab'), 'node_modules/dsh-lab-ui/client/index.js'));
const preferenceFile = join(home, 'lab-agent/scientific-desktop/desktop-pet.json');
mkdirSync(join(home, 'lab-agent/scientific-desktop'), { recursive: true });
writeFileSync(preferenceFile, JSON.stringify({ visible: true, x: 80, y: 80 }));
const preference = () => JSON.parse(readFileSync(preferenceFile, 'utf8'));
const report = { ok: false, home, checks: [], rendererErrors: [], scope: 'Real plugin settings, native pet, isolated home; no model or institution credentials.' };
const delay = ms => new Promise(done => setTimeout(done, ms));
const wait = async (fn, label) => {
 for (let i = 0; i < 600; i++) { const value = await fn();if (value) return value;await delay(100); }
 throw Error('Timed out: ' + label);
};
let child, browser, page, frame, pet, log = '';
const launch = async () => {
 let endpoint;
 child = spawn(executable, [...(process.argv.includes('--packaged') ? [] : [app]), '--remote-debugging-port=0'], { env: { ...process.env, DSH_HOME: home, DSH_DESKTOP_NEXT_HOME: home, ELECTRON_RUN_AS_NODE: undefined, DSH_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
 for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  const value = String(chunk);endpoint ??= value.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
  log += value.replace(/([?&]token=)[^&\s]+/g, '$1<redacted>');
 });
 await wait(() => { if (child.exitCode !== null) throw Error('Desktop exited: ' + child.exitCode);return endpoint; }, 'desktop debug endpoint');
 browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
 const observed = new Set();
 await wait(async () => {
  for (const candidate of await browser.pages()) {
   if (!observed.has(candidate)) { observed.add(candidate);candidate.on('pageerror', error => report.rendererErrors.push(error.message)); }
   if (candidate.url().includes('desktop-pet.html')) pet = candidate;
   for (const current of candidate.frames()) if (await current.$('[title="打开科研课题"]').catch(() => false)) { page = candidate;frame = current; }
  }
  return frame && pet;
 }, 'main UI and native pet');
 await pet.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
 await pet.waitForFunction(() => document.querySelector('#stage').textContent === '当前没有进行中的任务');
};
const rpc = request => frame.evaluate(async request => {
 const response = await fetch('/api/lab/desktop_pet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'lab/desktop_pet', payload: { args: { request } } }) });
 const result = await response.json();if (!result.result?.ok) throw Error(JSON.stringify(result));return result.result.value;
}, request);
const clickText = async text => {
 const handle = await frame.evaluateHandle(text => [...document.querySelectorAll('button')].find(node => node.innerText.trim() === text), text);
 assert.ok(handle.asElement(), 'Missing button: ' + text);await handle.asElement().click();await handle.dispose();
};
const openPetSettings = async () => {
 await frame.waitForSelector('[data-slot="settings.trigger"], [data-slot="settings.launcher"] button');
 await frame.evaluate(() => { const slot = document.querySelector('[data-slot="settings.trigger"]');const trigger = slot?.closest('button') ?? slot?.querySelector('button');if (trigger) trigger.click();else document.querySelector('[data-slot="settings.launcher"] button')?.click(); });
 await wait(async () => {
  if (await frame.evaluate(() => [...document.querySelectorAll('button')].some(node => node.innerText.trim() === 'iBM 插件设置'))) return true;
  await frame.evaluate(() => document.querySelector('[role="menu"] button[role="menuitem"]')?.click());return false;
 }, 'plugin settings entry');
 await clickText('iBM 插件设置');await clickText('桌面宠物');
 await frame.waitForFunction(() => document.querySelector('#ibm-pet-quotes')?.disabled === false);
};
const editQuotes = async value => {
 await frame.focus('#ibm-pet-quotes');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');
 await page.keyboard.sendCharacter(value);
};
const saveQuotes = async count => {
 await clickText('保存语录');await frame.waitForFunction(count => document.querySelector('[data-ibm-pet-settings] [role="status"]')?.textContent === `已保存 ${count} 条语录`, {}, count);
};
const close = async () => {
 await browser?.close().catch(() => {});
 if (child) await wait(() => child.exitCode !== null, 'desktop shutdown').catch(() => child.kill());
 browser = null;page = null;frame = null;pet = null;
};
try {
 await launch();await openPetSettings();
 assert.equal(await frame.$eval('#ibm-pet-quotes', node => node.value), '');
 await pet.click('#portrait-button');await pet.waitForFunction(() => !document.querySelector('#quote').hidden);
 assert.match(await pet.$eval('#quote-text', node => node.textContent), /还没有语录/);
 await pet.click('#quote-close');report.checks.push('legacy-preferences-load-with-empty-quotes-and-click-guidance');
 const quotes = ['保持好奇，继续探索。', '慢慢来，今天也在进步。', '<img src=x onerror="alert(1)">'];
 await editQuotes('  ' + quotes[0] + '  \n\n' + quotes[1] + '\n' + quotes[0] + '\n' + quotes[2]);
 await saveQuotes(3);assert.deepEqual(preference().quotes, quotes);assert.deepEqual((await rpc({})).quotes, quotes);
 assert.equal(await frame.$eval('#ibm-pet-quotes', node => node.value), quotes.join('\n'));
 await page.screenshot({ path: join(work, 'pet-quote-settings.png') });report.checks.push('settings-editor-saves-normalized-quotes-through-real-host');
 let previous = '', seen = new Set();
 for (let i = 0; i < 10; i++) {
  await pet.click('#portrait-button');const text = await pet.$eval('#quote-text', node => node.textContent);
  assert.ok(quotes.includes(text));assert.notEqual(text, previous);previous = text;seen.add(text);
 }
 assert.ok(seen.size >= 2);assert.equal(await pet.$('#quote-text img'), null);
 await pet.screenshot({ path: join(work, 'pet-quote-popup.png'), omitBackground: true });
 await delay(700);assert.equal(await pet.$eval('#quote', node => node.hidden), false);
 await pet.waitForFunction(() => document.querySelector('#quote').hidden, { timeout: 8000 });
 report.checks.push('portrait-single-click-random-no-immediate-repeat','quotes-render-as-text-and-survive-task-refresh','quote-popup-dismisses-after-six-seconds');
 await pet.focus('#portrait-button');await pet.keyboard.press('Enter');assert.equal(await pet.$eval('#quote', node => node.hidden), false);await pet.click('#quote-close');
 report.checks.push('keyboard-activation-and-manual-dismissal');
 const before = preference(), box = await pet.$eval('#portrait-button', node => node.getBoundingClientRect().toJSON());
 const x = box.x + box.width / 2, y = box.y + box.height / 2;
 await pet.mouse.move(x, y);await pet.mouse.down();await pet.mouse.move(x + 35, y + 20);await delay(250);await pet.mouse.up();
 await wait(() => preference().x !== before.x || preference().y !== before.y, 'native portrait drag persistence');
 assert.equal(await pet.$eval('#quote', node => node.hidden), true);assert.deepEqual(preference().quotes, quotes);
 const position = { x: preference().x, y: preference().y };report.checks.push('portrait-drag-moves-native-window-without-triggering-quote');
 await editQuotes(quotes.join('\n') + '\n尚未保存的语录');await clickText('隐藏桌面宠物');await wait(() => preference().visible === false, 'hide');
 await clickText('显示桌面宠物');await wait(() => preference().visible === true, 'show');
 assert.match(await frame.$eval('#ibm-pet-quotes', node => node.value), /尚未保存的语录/);assert.deepEqual(preference().quotes, quotes);
 report.checks.push('visibility-toggle-preserves-saved-quotes-and-unsaved-editor');
 await close();await launch();assert.deepEqual((await rpc({})).quotes, quotes);assert.deepEqual({ x: preference().x, y: preference().y }, position);
 await openPetSettings();assert.equal(await frame.$eval('#ibm-pet-quotes', node => node.value), quotes.join('\n'));
 await pet.click('#portrait-button');assert.ok(quotes.includes(await pet.$eval('#quote-text', node => node.textContent)));
 report.checks.push('quotes-and-position-survive-application-restart');
 await editQuotes('只保留这一条。');await saveQuotes(1);
 for (let i = 0; i < 2; i++) { await pet.click('#portrait-button');assert.equal(await pet.$eval('#quote-text', node => node.textContent), '只保留这一条。'); }
 await editQuotes('');await saveQuotes(0);assert.deepEqual(preference().quotes, []);
 assert.equal(await pet.$eval('#quote', node => node.hidden), true);
 await pet.click('#portrait-button');assert.match(await pet.$eval('#quote-text', node => node.textContent), /还没有语录/);
 report.checks.push('single-quote-and-clearing-settings-apply-immediately');
 assert.deepEqual(report.rendererErrors, []);report.ok = true;
} catch (error) {
 report.error = String(error);
 if(browser)report.pages=await Promise.all((await browser.pages()).map(async(candidate,index)=>{
  await candidate.screenshot({path:join(work,`failure-${index}.png`)}).catch(()=>{});
  return {url:candidate.url().replace(/([?&]token=)[^&\s]+/g,'$1<redacted>'),frames:await Promise.all(candidate.frames().map(current=>current.evaluate(()=>document.body.innerText.slice(0,4000)).catch(()=>'')))};
 }));
 if (page) await page.screenshot({ path: join(work, 'failure.png') }).catch(() => {});
 if (frame) report.failureText = await frame.evaluate(() => document.body.innerText).catch(() => undefined);
 throw error;
} finally {
 await close();writeFileSync(join(work, 'desktop.log'), log);writeFileSync(join(work, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
 console.log('Pet quotes evidence: ' + join(work, 'verification.json'));
}
