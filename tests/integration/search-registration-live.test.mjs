import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootLite } from '../helpers/boot-lite.mjs';

test('search tool commits are immediately visible through the workspace and survive reload', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-search-live-')); let handle;
 try {
  handle = await bootLite({ storageRoot: join(dir, 'storage'), includePython: false, extraRows: [
   { id: 'tools', name: '@deepseek-ai/dsh-tools' }, { id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' },
   { id: 'goals', name: 'dsh-lab-agent/goal-profiles' }, { id: 'notes', name: 'dsh-lab-agent/note-templates' }, { id: 'templates', name: 'dsh-lab-agent/ppt-templates' },
   { id: 'tasks', name: 'dsh-lab-agent/tasks', config: { projectsRoot: join(dir, 'projects') } },
   { id: 'literature', name: new URL('../../plugins/literature/lib/index.js', import.meta.url).href },
   { id: 'tasks-tool', name: new URL('../../plugins/literature/lib/tools.js', import.meta.url).href },
   { id: 'registry', name: '@deepseek-ai/dsh-typert-registry' }, { id: 'gateway', name: '@deepseek-ai/dsh-api-gateway' }, { id: 'remote', name: 'dsh-lab-agent/remote' },
  ] });
  const { ctx } = handle, core = ctx.ibmCore;
  const project = await core.createProject({ id: 'live-search', name: 'Live search' });
  await core.createProject({ id: 'other-search', name: 'Other project' });
  ctx.labLiteratureTasks.executor.search = async query => [{ id: query, title: query, sources: ['crossref'] }];
  const invoke = (method, request) => ctx.typertGateway.invoke({ namespace: 'lab', method, args: { request } });
  const read = () => invoke('projects_workspace', { projectId: project.id });
  const tool = ctx.tools.get('lab_tasks_register_search');
  const visible = () => invoke('search_tasks_list', { projectId: project.id });
  assert.deepEqual((await visible()).tasks, []);
  for (const query of ['first', 'second']) {
   const before = (await read()).revision;
   const result = await tool.execute({ projectId: project.id, entryTitle: query, query }, { agent: { session: { id: query } } });
   assert.equal(result.ok, true, result.error);
   const workspace = await read();
   assert.notEqual(workspace.revision, before);
   assert.ok(workspace.literature.searches.some(row => row.id === result.runId));
   const task = (await visible()).tasks.find(row => row.legacySearchRunIds?.includes(result.runId));
   assert.ok(task, "registered run must appear in the endpoint the visible panel actually reads");
   assert.equal(task.candidates.length, result.count);
   assert.ok((await read()).literature.searches.some(row => row.id === result.runId));
   const disk = JSON.parse(await readFile(join(dir, 'storage', 'lab_tasks.json'), 'utf8'));
   assert.ok(disk.tables.literature_search_runs[result.runId]);
  }
  assert.equal((await read()).literature.searches.length, 2);
  assert.equal((await invoke('projects_workspace', { projectId: 'other-search' })).literature.searches.length, 0);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
