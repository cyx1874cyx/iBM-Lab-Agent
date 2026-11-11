import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as remote from '../../lib/search-tasks.js';
import * as tool from '../../plugins/literature/lib/search-tasks-core.js';

test('tool and remote share live search tasks, including an already cached empty list', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'search-task-live-'));
 const revisions = [];
 const core = { ensureProjectWorkspace: async id => ({ path: join(dir, id) }), projectUpdates: { publish: id => revisions.push(id) } };
 try {
  assert.deepEqual((await remote.listSearchTasks(core, 'A')).tasks, []);
  assert.deepEqual((await tool.listSearchTasks(core, 'A')).tasks, []);
  for (const id of ['first', 'second']) {
   await tool.upsertSearchTask(core, 'A', { id, title: id, candidates: [] });
   assert.ok((await remote.listSearchTasks(core, 'A')).tasks.some(row => row.id === id));
   assert.ok(JSON.parse(await readFile(join(dir, 'A', 'search-tasks.json'), 'utf8')).tasks.some(row => row.id === id));
  }
  await remote.upsertSearchTask(core, 'A', { id: 'first', title: 'Updated', candidates: [] });
  assert.equal((await tool.listSearchTasks(core, 'A')).tasks.find(row => row.id === 'first').title, 'Updated');
  assert.equal((await remote.listSearchTasks(core, 'A')).tasks.length, 2);
  assert.deepEqual((await remote.listSearchTasks(core, 'B')).tasks, []);
  await tool.deleteSearchTask(core, 'A', 'second');
  assert.deepEqual((await remote.listSearchTasks(core, 'A')).tasks.map(row => row.id), ['first']);
  assert.deepEqual(revisions, ['A', 'A', 'A', 'A']);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
