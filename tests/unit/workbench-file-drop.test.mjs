import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addConversationDrop, isFileDrag } from '../../client/src/workbench-file-drop.js';

test('chat drops add real host attachments to the current input and release rejected drafts', () => {
 const files = [{ name: 'paper.pdf' }, { name: 'data.ris' }], scope = {}, calls = [];
 let accept = true;
 const ctx = { sessions: { list: { getSnapshot: () => ({ current: 'active-session' }) }, scope: id => id === 'active-session' ? scope : undefined }, conversation: {
  input: { for: actual => { assert.equal(actual, scope); return { addAttachments: ids => { calls.push(['input', ids]); return accept; } }; } },
  createDrafts: (id, actual) => { assert.equal(id, 'active-session'); assert.deepEqual(actual, files); return [{ id: 'pdf-draft' }, { id: 'ris-draft' }]; },
  releaseDraftAttachments: drafts => { calls.push(['release', drafts.map(row => row.id)]); }
 } };
 addConversationDrop(ctx, files); assert.deepEqual(calls, [['input', ['pdf-draft', 'ris-draft']]]);
 accept = false; assert.throws(() => addConversationDrop(ctx, files), /正在提交/); assert.deepEqual(calls.at(-1), ['release', ['pdf-draft', 'ris-draft']]);
 ctx.sessions.scope = () => undefined; assert.throws(() => addConversationDrop(ctx, files), /尚未就绪/);
 assert.equal(isFileDrag({ dataTransfer: { types: ['Files'] } }), true); assert.equal(isFileDrag({ dataTransfer: { types: ['text/plain'] } }), false);
});
