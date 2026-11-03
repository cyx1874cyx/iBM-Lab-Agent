/** Exercise actual Electron window bounds. Never emulate the renderer viewport. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyWorkbenchWindow({ BrowserWindow, output }) {
 const report = { ok: false, checks: [], scope: 'Real native restore, maximize and fullscreen; no device emulation.' };
 let window;
 try {
  for (let attempt = 0; attempt < 100; attempt++) {
   window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed() && item.webContents.getURL().startsWith('dsh-app://app/'));
   if (window && await window.webContents.executeJavaScript('Boolean(document.querySelector(".ib-wb"))').catch(() => false)) break;
   await delay(150);
  }
  assert.ok(window, 'Main development window missing');
  const check = async name => {
   await delay(600);
   const actual = await window.webContents.executeJavaScript(`(() => {
    const root=document.querySelector('.ib-wb').getBoundingClientRect();
    const chat=document.querySelector('.ib-wb-chat').getBoundingClientRect();
    const page=document.querySelector('.ib-wb-project-page[data-workspace=literature]');
    const groups=page?[...page.querySelectorAll('.ib-lit>.ib-lit-group')].map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}):[];
    const literature=groups.length===2&&groups[0].width>0?{width:page.getBoundingClientRect().width,groups,columns:Math.abs(groups[0].y-groups[1].y)<2?2:1,projectHeader:Boolean(page.querySelector('.ib-project-head')),tools:Boolean(page.querySelector('.ib-wb-module-tools'))}:null;
    return {viewport:{width:innerWidth,height:innerHeight},root:{width:root.width,height:root.height},chatRight:chat.right,overflow:document.documentElement.scrollWidth>innerWidth,literature};
   })()`);
   const content = window.getContentBounds();
   report.checks.push({ name, content, ...actual });
   assert.ok(Math.abs(content.width - actual.viewport.width) <= 1, name + ': renderer must follow native width');
   assert.ok(Math.abs(content.height - actual.viewport.height) <= 1, name + ': renderer must follow native height');
   assert.ok(Math.abs(actual.root.width - actual.viewport.width) <= 1, name + ': workbench must fill width');
   assert.ok(Math.abs(actual.root.height - actual.viewport.height) <= 1, name + ': workbench must fill height');
   assert.equal(actual.overflow, false, name + ': unexpected horizontal overflow');
   if (actual.literature) {
    assert.equal(actual.literature.columns, actual.literature.width >= 1000 ? 2 : 1, name + ': literature columns must follow available width');
    assert.equal(actual.literature.projectHeader, false, name + ': removed project header');
    assert.equal(actual.literature.tools, false, name + ': removed project tool row');
    writeFileSync(join(output, 'literature-' + name + '.png'), (await window.webContents.capturePage()).toPNG());
   }
  };
  window.setFullScreen(false); window.unmaximize(); window.setBounds({ width: 1280, height: 840 });
  await check('normal-1280x840');
  window.maximize(); await check('maximized');
  window.unmaximize(); window.setBounds({ width: 1100, height: 760 }); await check('restored-1100x760');
  window.setFullScreen(true); await check('fullscreen');
  window.setFullScreen(false); window.maximize(); await check('maximized-after-fullscreen');
  writeFileSync(join(output, 'workbench-maximized.png'), (await window.webContents.capturePage()).toPNG());
  report.ok = true;
 } catch (error) {
  report.error = String(error);
  console.error('[iBM Lab] native window verification failed:', error.message);
 } finally {
  if (window && !window.isDestroyed()) { window.setFullScreen(false); window.maximize(); window.show(); window.focus(); }
  writeFileSync(join(output, 'window-resize-verification.json'), JSON.stringify(report, null, 2));
 }
 return report;
}
