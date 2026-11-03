import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rename, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { bootLite } from '../helpers/boot-lite.mjs';

const extraRows = [
 { id: 'nmr', name: 'dsh-lab-agent/nmr' },
 { id: 'chemistry', name: 'dsh-lab-agent/chemistry' },
 { id: 'synthesis', name: 'dsh-lab-agent/synthesis' },
];
const boot = (root, full = false) => bootLite({ storageRoot: join(root, 'index'), includePython: false, coreOnly: !full, extraRows: full ? extraRows : [], coreConfig: { projectsRoot: join(root, 'legacy') } });

test('project document carries memories, scientific records, referenced entities, local drafts and assets across a folder move and a clean application index', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-project-portable-'));
 let first, second;
 try {
  first = await boot(join(dir, 'app-one'), true);
  const { ctx } = first;
  const file = join(dir, '项目甲', '研究.ibmproject');
  const project = await ctx.ibmCore.createProject({ name: '可迁移课题', projectFilePath: file });
  assert.equal(project.workspacePath, dirname(file));
  await ctx.ibmCore.updateProjectMemory({ projectId: project.id, markdown: '# 保留核心记忆', changeNote: '测试更新' });
  await ctx.ibmCore.bindProjectSession({ projectId: project.id, sessionId: 'local-only', workspaceId: 'old-workspace' });
  const fid = join(dir, '原始实验', 'sample.fid');
  await mkdir(fid, { recursive: true }); await writeFile(join(fid, 'fid'), 'original-fid-bytes');
  await ctx.labChemistry.createEntity({ id: 'ethanol', name: '乙醇', kind: 'small-molecule', formula: 'C2H6O' });
  await ctx.labChemistry.createEntity({ id: 'unrelated', name: '其他课题', kind: 'small-molecule', formula: 'H2O' });
  await ctx.labChemistry.addProperty({ entityId: 'ethanol', property: 'formula', value: 'C2H6O', sourceKind: 'db-measured', source: 'fixture', sourceId: 'fixture' });
  await ctx.labNmr.createDataset({ id: 'sample-one', projectId: project.id, name: '谱图一', fidPath: fid, entityId: 'ethanol' });
  const storedDataset = ctx.labNmr.table.get('sample-one');
  assert.ok(storedDataset.fidPath.startsWith(project.workspacePath));
  assert.equal(await readFile(join(storedDataset.fidPath, 'fid'), 'utf8'), 'original-fid-bytes');
  await writeFile(join(fid, 'fid'), 'updated-fid-bytes');
  const updated = await ctx.labNmr.createDataset({ id: 'sample-two', projectId: project.id, name: '新版本谱图', fidPath: fid });
  assert.notEqual(updated.fidPath, storedDataset.fidPath);
  assert.equal(await readFile(join(storedDataset.fidPath, 'fid'), 'utf8'), 'original-fid-bytes');
  assert.equal(await readFile(join(updated.fidPath, 'fid'), 'utf8'), 'updated-fid-bytes');
  await ctx.ibmCore.projectFiles.writeDraft(project.id, 'polishing', '移动后仍可编辑的论文草稿');
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(document.format, 'ibm-lab-project');
  assert.equal(document.domains.lab_tasks.tables.project_sessions, undefined);
  assert.equal(document.domains.lab_chemistry.tables.chemical_entities.length, 1);
  assert.equal(document.domains.lab_chemistry.tables.chemical_entities[0][0], 'ethanol');
  assert.equal(document.domains.lab_chemistry.tables.chemical_properties.length, 1);
  assert.equal(typeof document.domains.lab_nmr.tables.nmr_datasets[0][1].fidPath.$ibmPath, 'string');
  const moved = join(dir, '移动后的项目');
  await rename(dirname(file), moved);
  const reopened = await ctx.ibmCore.projectFiles.open(join(moved, '研究.ibmproject'));
  assert.equal(reopened.workspacePath, moved);
  assert.equal(ctx.ibmCore.getProjectSession(project.id), undefined);
  assert.ok(ctx.labNmr.table.get('sample-one').fidPath.startsWith(moved));
  await first.dispose(); first = undefined;
  // Open with no application database, then load scientific services lazily.
  second = await boot(join(dir, 'app-two'));
  await second.ctx.ibmCore.projectFiles.open(join(moved, '研究.ibmproject'));
  assert.equal(second.ctx.ibmCore.getProjectMemory(project.id).markdown, '# 保留核心记忆');
  assert.equal((await second.ctx.ibmCore.projectFiles.readDraft(project.id, 'polishing')).text, '移动后仍可编辑的论文草稿');
  await second.dispose(); second = await boot(join(dir, 'app-two'), true);
  assert.equal(second.ctx.ibmCore.getProject(project.id).workspacePath, moved);
  assert.ok(second.ctx.labNmr.table.get('sample-one').fidPath.startsWith(moved));
  assert.equal(second.ctx.labChemistry.table('entities').get('ethanol').name, '乙醇');
  assert.equal(second.ctx.labChemistry.table('entities').get('unrelated'), undefined);
  await second.ctx.ibmCore.updateProjectMemory({ projectId: project.id, markdown: '# 重开后更新' });
  assert.match(await readFile(join(moved, '研究.ibmproject'), 'utf8'), /重开后更新/);
 } finally { await first?.dispose(); await second?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('malformed, foreign and traversing documents are rejected before import; existing documents and external edits are protected', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-project-validation-'));
 let handle;
 try {
  handle = await boot(dir); const core = handle.ctx.ibmCore;
  const project = await core.createProject({ id: 'one', name: '项目一', projectFilePath: join(dir, 'one', 'one.ibmproject') });
  const original = await readFile(project.projectFilePath, 'utf8');
  await assert.rejects(core.createProject({ id: 'two', name: '覆盖', projectFilePath: project.projectFilePath }), /已存在/);
  assert.equal(core.getProject('two'), undefined);
  const corrupt = join(dir, '坏文件.ibmproject');
  await writeFile(corrupt, '{'); await assert.rejects(core.projectFiles.open(corrupt), /JSON/);
  const doc = JSON.parse(original); doc.project.workspacePath = { $ibmPath: '../../escape' };
  await writeFile(corrupt, JSON.stringify(doc)); await assert.rejects(core.projectFiles.open(corrupt), /越界/);
  doc.project.workspacePath = { $ibmPath: '.' }; doc.domains.lab_tasks.tables.project_memory_versions[0][1].projectId = 'foreign';
  await writeFile(corrupt, JSON.stringify(doc)); await assert.rejects(core.projectFiles.open(corrupt), /其他课题/);
  assert.equal(core.getProjectMemory('one').version, '1');
  await writeFile(project.projectFilePath, original + ' ');
  await assert.rejects(core.updateProjectMemory({ projectId: 'one', markdown: '# 不得覆盖外部修改' }), /其他程序修改/);
  assert.equal(core.getProjectMemory('one').version, '1');
  assert.equal(await readFile(project.projectFilePath, 'utf8'), original + ' ');
  await core.projectFiles.open(project.projectFilePath);
  await core.updateProjectMemory({ projectId: 'one', markdown: '# 重新打开后允许保存' });
  await cp(dirname(project.projectFilePath), join(dir, 'copy'), { recursive: true });
  await core.projectFiles.open(join(dir, 'copy', 'one.ibmproject'));
  assert.equal(core.getProject('one').workspacePath, join(dir, 'copy'));
  const sourceText = await readFile(project.projectFilePath, 'utf8');
  await core.updateProjectMemory({ projectId: 'one', markdown: '# 只写入当前打开的副本' });
  assert.equal(await readFile(project.projectFilePath, 'utf8'), sourceText);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('concurrent writes serialize, deleted rows stay deleted, and a missing project never recreates its old directory', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-project-save-'));
 let handle;
 try {
  handle = await boot(dir); const core = handle.ctx.ibmCore;
  const project = await core.createProject({ id: 'one', name: '项目一' });
  const two = await core.createProject({ id: 'two', name: '项目二' });
  await Promise.all([core.projectFiles.writeDraft('one', 'proposal', '申报材料'), core.projectFiles.writeDraft('one', 'polishing', '论文材料'), core.table('projects').put('one', { ...project, readingFolders: [{ id: 'folder', name: '分类', createdAt: project.createdAt }] })]);
  assert.equal(JSON.parse(await readFile(project.projectFilePath, 'utf8')).project.readingFolders[0].name, '分类');
  const memory = core.getProjectMemory('one');
  await core.table('memories').delete(memory.id);
  assert.equal(JSON.parse(await readFile(project.projectFilePath, 'utf8')).domains.lab_tasks.tables.project_memory_versions.length, 0);
  await rename(project.workspacePath, project.workspacePath + '-moved');
  await assert.rejects(core.ensureProjectWorkspace('one'), /移动或删除/);
  assert.equal(existsSync(project.workspacePath), false);
  await core.updateProjectMemory({ projectId: two.id, markdown: '# 另一个项目可继续保存' });
  assert.match(await readFile(two.projectFilePath, 'utf8'), /另一个项目可继续保存/);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('legacy migration captures records from scientific providers that are not activated', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ibm-project-legacy-'));
 let handle;
 try {
  handle = await boot(join(dir, 'old-app'), true);
  const project = await handle.ctx.ibmCore.createProject({ id: 'legacy', name: '旧科研项目' });
  const input = join(project.workspacePath, 'old.fid'); await writeFile(input, 'legacy-fid');
  await handle.ctx.labNmr.createDataset({ id: 'legacy-nmr', projectId: 'legacy', name: '旧核磁', fidPath: input });
  handle.ctx.ibmCore.projectFiles.forget(project.id);
  const { projectFilePath, projectUid, ...oldRow } = project;
  await handle.ctx.ibmCore.table('projects').put(project.id, oldRow);
  await rm(projectFilePath);
  await handle.dispose(); handle = await boot(join(dir, 'old-app'));
  assert.equal(handle.ctx.get('labNmr'), undefined);
  await handle.ctx.ibmCore.ensureProjectWorkspace('legacy');
  const doc = JSON.parse(await readFile(projectFilePath, 'utf8'));
  assert.equal(doc.domains.lab_nmr.tables.nmr_datasets[0][0], 'legacy-nmr');
  const copied = join(dir, 'portable-copy'); await cp(project.workspacePath, copied, { recursive: true });
  await handle.dispose(); handle = await boot(join(dir, 'clean-app'), true);
  await handle.ctx.ibmCore.projectFiles.open(join(copied, 'legacy.ibmproject'));
  assert.equal(await readFile(handle.ctx.labNmr.getDataset('legacy-nmr').fidPath, 'utf8'), 'legacy-fid');
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
