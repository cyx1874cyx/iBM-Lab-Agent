import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LabRemoteService } from '../../lib/remote.js';

test('proposal drafts remain readable but cannot be submitted for writing', async () => {
 let writes = 0;
 const files = { readDraft: async () => ({ exists: true, text: 'historical draft' }), writeDraft: async () => { writes++; } };
 const receiver = { require: () => ({ requireProject() {}, projectFiles: files }) };
 const request = { projectId: 'p1', kind: 'proposal', text: 'replacement' };
 assert.equal((await LabRemoteService.prototype.projects_draft_read.call(receiver, request)).text, 'historical draft');
 await assert.rejects(LabRemoteService.prototype.projects_draft_write.call(receiver, request));
 assert.equal(writes, 0);
});

test('workbench omits the proposal entry and the polishing placeholder cannot submit tasks', async () => {
 const source = await readFile(new URL('../../client/src/workbench.js', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /id: 'proposal'/);
 const placeholder = source.slice(source.indexOf('function PolishingPlaceholder'), source.indexOf('export function Workbench'));
 assert.match(placeholder, /暂不可用/);
 assert.doesNotMatch(placeholder, /onTask|submit/);
});
