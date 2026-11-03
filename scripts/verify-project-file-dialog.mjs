// Run with Electron. Exercise the real dispatcher with deterministic native dialog results.
import { app, dialog } from 'electron';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createScientificRuntime } from '../electron-next/scientific-runtime.mjs';
const output = process.argv[process.argv.indexOf('--output') + 1];
app.setName('iBM Lab');
void app.whenReady().then(async () => {
const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
try {
 const runtime = createScientificRuntime({ embedded: true }, () => {});
 const calls = [];
 dialog.showOpenDialog = async (...args) => { calls.push(args.at(-1)); return { canceled: false, filePaths: ['H:\\项目\\研究.ibmproject'] }; };
 dialog.showSaveDialog = async (...args) => { calls.push(args.at(-1)); return { canceled: false, filePath: 'H:\\项目\\新研究' }; };
 assert.deepEqual(await runtime.dispatch('project-file-dialog', { action: 'open' }), { cancelled: false, path: 'H:\\项目\\研究.ibmproject' });
 assert.deepEqual(calls[0].filters, [{ name: 'iBM Lab 项目', extensions: ['ibmproject'] }]);
 assert.deepEqual(calls[0].properties, ['openFile']);
 assert.deepEqual(await runtime.dispatch('project-file-dialog', { action: 'save', name: '科研/项目' }), { cancelled: false, path: 'H:\\项目\\新研究.ibmproject' });
 assert.equal(calls[1].defaultPath, '科研_项目.ibmproject');
 dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
 dialog.showSaveDialog = async () => ({ canceled: true });
 assert.deepEqual(await runtime.dispatch('project-file-dialog', { action: 'open' }), { cancelled: true, path: null });
 assert.deepEqual(await runtime.dispatch('project-file-dialog', { action: 'save' }), { cancelled: true, path: null });
 await assert.rejects(runtime.dispatch('project-file-dialog', { action: 'invalid' }), /未知/);
 await writeFile(output, JSON.stringify({ ok: true, checks: ['native-open-dialog-filter', 'native-save-extension', 'safe-default-name', 'cancel-open-and-save', 'reject-invalid-action'] }, null, 2));
 app.exit(0);
} catch (error) { await writeFile(output, JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); }
finally { dialog.showOpenDialog = originalOpen; dialog.showSaveDialog = originalSave; }
});
