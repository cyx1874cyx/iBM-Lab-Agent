/* global window, document */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { resolveBrowserExecutable } from './helpers/ketcher-page.mjs';
import { listSearchTasks } from '../../lib/search-tasks.js';
import { ProjectUpdates } from '../../lib/core/project-updates.js';

const executable = resolveBrowserExecutable();
test('visible search panel updates from registered runs without remounting a focused draft', { skip: !executable, timeout: 30000 }, async () => {
 const dir = await mkdtemp(join(tmpdir(), 'search-ui-'));
 const rows = new Map(), updates = new ProjectUpdates();
 const core = { table: () => rows, ensureProjectWorkspace: async () => ({ path: dir }), projectUpdates: updates };
 const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
 import {SearchTasksPanel} from './plugins/literature/client/src/search-tasks-panel.js';
 import {followProjectUpdates} from './client/src/project-live-updates.js';
 const call=async(method,args={})=>{const r=await fetch('/api',{method:'POST',body:JSON.stringify({method,...args})});return r.json();};
 function App(){const [revision,setRevision]=React.useState();const cursor=React.useRef();const [count,setCount]=React.useState(0);
 React.useEffect(()=>followProjectUpdates({call,projectId:'A',getRevision:()=>cursor.current,load:async()=>{const r=await call('revision');cursor.current=r.revision;setRevision(r.revision);return r;}}),[]);
 return React.createElement(React.Fragment,null,React.createElement('output',{id:'count'},count),React.createElement(SearchTasksPanel,{projectId:'A',revision,call,onCount:setCount}));}
 createRoot(document.getElementById('root')).render(React.createElement(App));`;
 const compiled = await build({ stdin: { contents: fixture, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'iife', plugins: [{ name: 'sdk-react', setup(b) {
  b.onResolve({ filter: /^dsh-lab-agent\/client-sdk$/ }, () => ({ path: 'sdk', namespace: 'test-sdk' }));
  b.onLoad({ filter: /.*/, namespace: 'test-sdk' }, () => ({ contents: "export {createElement as h} from 'react';", resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }));
 } }] });
 const server = createServer(async (req, res) => {
  if (req.url === '/bundle.js') { res.end(compiled.outputFiles[0].text); return; }
  if (req.url !== '/api') { res.end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const { method, request } = JSON.parse(body);
  let value = {};
  if (method === 'search_tasks_list') value = await listSearchTasks(core, 'A');
  if (method === 'projects_watch') value = await updates.watch('A', request.revision, 1000);
  if (method === 'revision') value = { revision: updates.revision('A') };
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
 });
 let browser;
 try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.getElementById('count').textContent === '0');
  await page.click('.ib-st-add');
  await page.type('.ib-st-dialog input', 'draft title');
  await page.evaluate(() => { window.draftInput = document.activeElement; });
  for (const id of ['first', 'second']) {
   rows.set(id, { id, projectId: 'A', title: id, query: id, results: [{ id: 'paper-'+id, title: 'Paper '+id }], status: 'succeeded', createdAt: id, updatedAt: id }); updates.publish('A');
   await page.waitForFunction(count => document.querySelectorAll('.ib-st-task').length === count, { timeout: 2000 }, rows.size);
   assert.equal(await page.evaluate(() => document.activeElement === window.draftInput), true);
   assert.equal(await page.$eval('.ib-st-dialog input', node => node.value), 'draft title');
  }
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ib-st-task').length === 2);
  assert.deepEqual(errors, []);
 } finally { updates.close(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
