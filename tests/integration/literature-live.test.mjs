import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootLite } from '../helpers/boot-lite.mjs';

test('the assistant source-registration tool creates one visible pending reading entry and publishes only committed changes', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-literature-live-')); let handle;
 try {
  handle = await bootLite({ storageRoot: join(dir, 'storage'), includePython: false, extraRows: [
   { id: 'tools', name: '@deepseek-ai/dsh-tools' }, { id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' },
   { id: 'goals', name: 'dsh-lab-agent/goal-profiles' }, { id: 'notes', name: 'dsh-lab-agent/note-templates' }, { id: 'templates', name: 'dsh-lab-agent/ppt-templates' },
   { id: 'tasks', name: 'dsh-lab-agent/tasks', config: { projectsRoot: join(dir, 'projects') } }, { id: 'tasks-tool', name: new URL('../../plugins/literature/lib/tools.js', import.meta.url).href, inject: ['tools', 'ibmCore', 'labTasks'] },
   { id: 'registry', name: '@deepseek-ai/dsh-typert-registry' }, { id: 'gateway', name: '@deepseek-ai/dsh-api-gateway' }, { id: 'remote', name: 'dsh-lab-agent/remote' },
  ] });
  const { ctx } = handle, core = ctx.ibmCore, workflows = ctx.ibmLiteratureWorkflows;
  const project = await core.createProject({ id: 'live-project', name: '实时登记课题' });
  core.conversations.schedule=()=>{};
  await core.bindProjectSession({projectId:project.id,workspaceId:'reading-workspace',sessionId:'registration-chat'});
  workflows.executor.preparePaper = async (_input, output) => { await writeFile(output, JSON.stringify({ locator_mode: 'structure-grounded', source_type: 'source_map' })); return { locator_mode: 'structure-grounded' }; };
  const input = join(dir, 'source.json'); await writeFile(input, '{}');
  const cursor = core.projectUpdates.revision(project.id);
  const changed = core.projectUpdates.watch(project.id, cursor);
  const tool = ctx.tools.get('lab_tasks_register_bundle');
  const result = await tool.execute({ projectId: project.id, sourceMapPath: input, title: 'Tool registration appears before fine reading' }, {agent:{session:{id:'registration-chat'}}});
  assert.equal(result.ok, true, result.error); assert.equal((await changed).changed, true);
  const invoke = (method, request) => ctx.typertGateway.invoke({ namespace: 'lab', method, args: { request } });
  const workspace = await invoke('projects_workspace', { projectId: project.id });
  assert.notEqual(workspace.revision, cursor);
  const entry = workspace.literature.reports.find(row => row.bundleId === result.bundleId);
  assert.ok(entry, 'source-only registration must appear in the reading panel');
  assert.equal(entry.status, 'pending'); assert.equal(entry.docxPath, undefined);
  assert.equal(entry.sessionId,'registration-chat');
  await core.bindProjectSession({projectId:project.id,sessionId:'reading-chat'});
  const linked=await invoke('tasks_reading_bind_session',{projectId:project.id,reportId:entry.id,sessionId:'reading-chat'});
  assert.equal(linked.report.sessionId,'reading-chat');
  assert.match(await readFile(project.projectFilePath,'utf8'),/reading-chat/,'entry binding persists inside the project file');
  await assert.rejects(workflows.bindReadingSession({projectId:'another-project',reportId:entry.id,sessionId:'reading-chat'}),/不属于当前课题/);
  await assert.rejects(workflows.bindReadingSession({projectId:project.id,reportId:entry.id,sessionId:'unbound-chat'}),/未绑定当前课题/);
  assert.equal(workflows.getReadingReport(entry.id).sessionId,'reading-chat');
  const explicit = await workflows.createReadingReport({ projectId: project.id, bundleId: result.bundleId, goalProfileId: 'default-research', goalProfileVersion: '1' });
  assert.equal(explicit.id, entry.id); assert.equal(workflows.listReadingReports(project.id).length, 1);
  await core.table('reports').delete(entry.id);
  await workflows.reconcileReadingEntries();
  await Promise.all([workflows.ensureReadingEntry(project.id, result.bundleId), workflows.ensureReadingEntry(project.id, result.bundleId)]);
  assert.equal(workflows.listReadingReports(project.id).length, 1, 'historical source-only entries recover without duplicates');
  const revision = core.projectUpdates.revision(project.id), original = await readFile(project.projectFilePath, 'utf8');
  await writeFile(project.projectFilePath, original + ' ');
  const row = workflows.listReadingReports(project.id)[0];
  await assert.rejects(core.table('reports').put(row.id, { ...row, titleZh: 'must roll back' }), /其他程序修改/);
  assert.equal(core.projectUpdates.revision(project.id), revision, 'failed persistence must not publish a successful update');
  assert.notEqual(core.table('reports').get(row.id).titleZh, 'must roll back');
  await writeFile(project.projectFilePath, original);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

