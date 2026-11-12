import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSearchTasks, patchTaskCandidate, deleteSearchTask } from '../../lib/search-tasks.js';

test('legacy registrations reach the visible search API after its empty cache is populated', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'search-projection-'));
 const rows = new Map();
 const core = { ensureProjectWorkspace: async id => ({ path: join(dir, id) }), table: () => rows };
 const run = (id, sessionId, results) => ({ id, sessionId, projectId: 'A', title: 'Registered', query: id, queries: [id], results, status: 'succeeded', createdAt: '2026-11-12', updatedAt: '2026-11-12' });
 try {
  assert.deepEqual((await listSearchTasks(core, 'A')).tasks, []);
  rows.set('first', run('first', 'session', [{ id: 'p1', title: 'First paper', doi: '10.1/a' }]));
  const first = (await listSearchTasks(core, 'A')).tasks[0];
  assert.ok(first, 'the visible API must expose lab_tasks_register_search results');
  assert.equal(first.candidates.length, 1);
  await patchTaskCandidate(core, 'A', { taskId: first.id, candidateId: first.candidates[0].id, patch: { selected: true, recommendation: 'priority' } });
  rows.set('second', run('second', 'session', [{ id: 'new-id', title: 'First paper', doi: '10.1/a', abstract: 'Updated abstract' }, { id: 'p2', title: 'Second paper' }]));
  let tasks = (await listSearchTasks(core, 'A')).tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].candidates.length, 2);
  assert.equal(tasks[0].candidates[0].id, first.candidates[0].id);
  assert.equal(tasks[0].candidates[0].selected, true);
  assert.equal(tasks[0].candidates[0].abstract, 'Updated abstract');
  assert.deepEqual((await listSearchTasks(core, 'B')).tasks, []);
  rows.set('third', run('third', 'another-session', [{ id: 'p3', title: 'Third paper' }]));
  assert.equal((await listSearchTasks(core, 'A')).tasks.length, 2);
  await deleteSearchTask(core, 'A', first.id);
  assert.equal((await listSearchTasks(core, 'A')).tasks.length, 1, 'deleted imports must not reappear');
  const reopened = await import('../../lib/search-tasks.js?reopened');
  assert.equal((await reopened.listSearchTasks(core, 'A')).tasks.length, 1, 'restart preserves imported history and deletions');
  const id = (await reopened.listSearchTasks(core, 'A')).tasks[0].id;
  assert.equal(id, (await listSearchTasks(core, 'A')).tasks[0].id, 'import IDs remain stable across restart');
 } finally { await rm(dir, { recursive: true, force: true }); }
});
