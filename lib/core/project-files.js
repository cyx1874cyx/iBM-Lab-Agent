import { createHash, randomUUID } from 'node:crypto';
import { existsSync, constants, createReadStream } from 'node:fs';
import { cp, copyFile, link, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { labTasksDomainSpec } from './domain.js';
import { chemicalEntitySchema, chemicalPropertySchema, experimentPlanSchema } from '../../src/chemistry/models.js';
import { nmrDatasetSchema } from '../../src/nmr/models.js';
import { synthesisTargetSchema, synthesisRouteSchema, synthesisEvidenceSchema, extractionJobSchema, synthesisReviewBatchSchema } from '../../src/synthesis/models.js';
import { plotRecordSchema } from '../../src/plot/models.js';
import { taskSchema } from '../../src/characterization.js';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

const FORMAT = 'ibm-lab-project';
const MAX_SIZE = 64 * 1024 * 1024;
const schemas = {
 lab_tasks: Object.fromEntries(Object.entries(labTasksDomainSpec.tables).map(([key, value]) => [key, value.valueSchema])),
 lab_chemistry: { chemical_entities: chemicalEntitySchema, chemical_properties: chemicalPropertySchema, experiment_plans: experimentPlanSchema },
 lab_nmr: { nmr_datasets: nmrDatasetSchema },
 lab_synthesis: { synthesis_targets: synthesisTargetSchema, synthesis_routes: synthesisRouteSchema, synthesis_evidence: synthesisEvidenceSchema, synthesis_extraction_jobs: extractionJobSchema, synthesis_review_batches: synthesisReviewBatchSchema },
 lab_plot_records: { plot_records: plotRecordSchema },
 lab_characterization: { tasks: taskSchema },
};
const digest = text => createHash('sha256').update(text).digest('hex');
const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const inside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const localOnly = (domain, table) => domain === 'lab_tasks' && ['lab_projects', 'project_sessions'].includes(table);
const contentOf = value => Array.isArray(value) ? value.map(contentOf) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => !['createdAt', 'updatedAt'].includes(key)).map(key => [key, contentOf(value[key])])) : value;

function mapPaths(value, root, decode = false) {
 if (Array.isArray(value)) return value.map(item => mapPaths(item, root, decode));
 if (value && typeof value === 'object') {
  if (decode && Object.hasOwn(value, '$ibmPath')) {
   const rel = value.$ibmPath;
   if (typeof rel !== 'string' || isAbsolute(rel) || !inside(root, resolve(root, rel))) throw Error('工程文件包含越界的相对路径');
   return resolve(root, rel);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapPaths(item, root, decode)]));
 }
 if (!decode && typeof value === 'string' && !/[\r\n]/.test(value) && isAbsolute(value) && inside(root, value)) return { $ibmPath: relative(root, value).split(sep).join('/') || '.' };
 return value;
}

function references(value, found = new Set()) {
 if (!value || typeof value !== 'object') return found;
 for (const [key, item] of Object.entries(value)) {
  if (key !== 'projectId' && /Ids?$/.test(key)) {
   for (const id of Array.isArray(item) ? item : [item]) if (typeof id === 'string') found.add(id);
  }
  if (item && typeof item === 'object') references(item, found);
 }
 return found;
}

async function assetDigest(path, parents = new Set()) {
 const actual = await realpath(path);
 if (parents.has(actual)) throw Error('导入资料包含循环目录链接');
 const info = await stat(actual), hash = createHash('sha256');
 if (info.isFile()) { for await (const bytes of createReadStream(actual)) hash.update(bytes); }
 else if (info.isDirectory()) {
  const ancestors = new Set([...parents, actual]);
  for (const name of (await readdir(actual)).sort()) hash.update(JSON.stringify([name, await assetDigest(join(actual, name), ancestors)]));
 } else throw Error('只能导入普通文件或文件夹');
 return hash.digest('hex');
}

/** The database is a local index; the project document is the portable source of truth. */
export class ProjectFileStore {
 constructor({ canSwitch = () => true, onCommitted = () => {} } = {}) { this.domains = new Map(); this.dormant = new Map(); this.dormantErrors = new Map(); this.projects = new Map(); this.errors = new Map(); this.tail = Promise.resolve(); this.canSwitch = canSwitch; this.onCommitted = onCommitted; }
 serial(work) { const next = this.tail.catch(() => {}).then(work); this.tail = next; return next; }
 get projectTable() { return this.domains.get('lab_tasks')?.domain.table('lab_projects'); }
 sources() { return new Map([...this.dormant, ...this.domains]); }
 async captureDormant(storage) {
  // Core starts before scientific providers. Read and release their existing metadata
  // so legacy projects retain all records even when a provider is not activated.
  for (const [name, tables] of Object.entries(schemas)) {
   if (name === 'lab_tasks') continue;
   const spec = defineDomain({ name, version: 0, tables: Object.fromEntries(Object.entries(tables).map(([table, schema]) => [table, domainTable(schema)])) });
   let raw;
   try {
    raw = await storage.open(spec);
    const cache = new Map(Object.keys(tables).map(table => [table, new Map([...raw.table(table).keys()].map(key => [key, raw.table(table).get(key)]))]));
    this.dormant.set(name, { spec, domain: { table: table => cache.get(table) } });
   } catch (error) { this.dormantErrors.set(name, error.message); }
   finally { await raw?.close(); }
  }
 }
 async attachDomain(spec, domain) {
  this.domains.set(spec.name, { spec, domain });
  for (const entry of this.projects.values()) this.validateCollisions(entry, spec.name);
  for (const entry of this.projects.values()) await this.restoreDomain(entry, spec.name);
  const tables = new Map();
  return new Proxy(domain, { get: (target, key) => {
   if (key === 'table') return name => {
    if (!tables.has(name)) {
     const raw = domain.table(name);
     tables.set(name, new Proxy(raw, { get: (table, method) => {
      if (method === 'put' || method === 'delete') return (...args) => this.mutate(spec.name, name, method, args);
      const value = Reflect.get(table, method, table); return typeof value === 'function' ? value.bind(table) : value;
     } }));
    }
    return tables.get(name);
   };
   const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
 }
 async initialize() {
  for (const id of [...this.projectTable.keys()]) {
   const project = this.projectTable.get(id);
   if (!project.projectFilePath) continue;
   try { await this.open(project.projectFilePath); }
   catch (error) { this.errors.set(id, error.message); }
  }
 }
 rows(projectId) {
  const all = [];
  for (const [domainName, { spec, domain }] of this.sources()) for (const name of Object.keys(spec.tables)) {
   if (localOnly(domainName, name)) continue;
   const table = domain.table(name);
   for (const key of table.keys()) all.push({ domain: domainName, table: name, key, value: table.get(key) });
  }
  const selected = new Set(all.filter(row => row.value.projectId === projectId));
  let changed = true;
  while (changed) {
   changed = false;
   const ids = new Set([...selected].map(row => row.value.id).filter(id => typeof id === 'string'));
   const refs = new Set(); for (const row of selected) references(row.value, refs);
   for (const row of all) {
    if (selected.has(row) || row.value.projectId && row.value.projectId !== projectId) continue;
    const parent = ['routeId', 'targetId', 'bundleId', 'entityId', 'taskId', 'reportId'].some(key => ids.has(row.value[key]));
    if (refs.has(row.value.id) || parent) { selected.add(row); changed = true; }
   }
  }
  return [...selected];
 }
 snapshot(entry) {
  const project = this.projectTable.get(entry.project.id);
  if (!project) throw Error('项目登记不存在');
  const domains = structuredClone(entry.document?.domains ?? {});
  for (const [name, { spec }] of this.sources()) if (this.domains.has(name) || !entry.document) domains[name] = { version: spec.version, tables: Object.fromEntries(Object.keys(spec.tables).filter(table => !localOnly(name, table)).map(table => [table, []])) };
  for (const row of this.rows(project.id)) if (this.domains.has(row.domain) || !entry.document) domains[row.domain].tables[row.table].push([row.key, row.value]);
  return { format: FORMAT, version: 1, project, domains };
 }
 async text(entry) { return JSON.stringify(mapPaths(this.snapshot(entry), dirname(entry.path)), null, 2) + '\n'; }
 async assertUnchanged(entry) {
  let text;
  try { text = await readFile(entry.path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') throw Error('项目文件已被移动或删除，请重新打开 .ibmproject 文件'); throw error; }
  if (digest(text) !== entry.hash) throw Error('项目文件已被其他程序修改，请重新打开后继续，避免覆盖磁盘内容');
 }
 async atomic(path, text, create = false) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
   const file = await open(temporary, 'wx');
   try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
   if (create) {
    try { await link(temporary, path); }
    catch (error) { if (!['EPERM', 'ENOSYS', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error; await copyFile(temporary, path, constants.COPYFILE_EXCL); }
   } else {
    if (/\.ibmproject$/i.test(path)) await copyFile(path, path + '.bak');
    await rename(temporary, path);
   }
  } finally { await rm(temporary, { force: true }); }
 }
 async locked(entry, work) {
  const path = entry.path + '.lock';
  let lock;
  try { lock = await open(path, 'wx'); }
  catch (error) {
   if (error.code !== 'EEXIST') throw error;
   let stale = false;
   try { const record = JSON.parse(await readFile(path, 'utf8')); if (Number.isSafeInteger(record.pid) && record.pid > 0) { try { process.kill(record.pid, 0); } catch (cause) { stale = cause.code === 'ESRCH'; } } }
   catch { stale = (Date.now() - (await stat(path)).mtimeMs) > 60000; }
   if (!stale) throw Error('另一个 iBM Lab 实例正在保存此项目，请稍后重试');
   await rm(path, { force: true }); lock = await open(path, 'wx');
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid })); return await work(); }
  finally { await lock.close(); await rm(path, { force: true }); }
 }
 async mutate(domain, name, method, args) {
  return this.serial(async () => {
   const table = this.domains.get(domain).domain.table(name), previous = table.get(args[0]);
   if (domain === 'lab_tasks' && name === 'project_sessions') return table[method](...args);
   const owner = domain === 'lab_tasks' && name === 'lab_projects' ? args[0] : (method === 'put' ? args[1] : previous)?.projectId;
   if (owner && this.errors.has(owner)) throw Error(this.errors.get(owner));
   if (method === 'put' && owner && this.projects.has(owner)) args = [args[0], await this.stagePaths(args[1], dirname(this.projects.get(owner).path))];
   const entries = [...this.projects.values()];
   const result = await table[method](...args);
   const written = [];
   try {
    for (const entry of entries) {
     if (!this.projectTable.get(entry.project.id)) continue;
     const text = await this.text(entry);
     if (digest(text) === entry.hash) continue;
     const old = { entry, text: entry.text, hash: entry.hash };
     await this.locked(entry, async () => { await this.assertUnchanged(entry); await this.atomic(entry.path, text); }); written.push(old);
     entry.text = text; entry.hash = digest(text); entry.document = this.snapshot(entry);
    }
   } catch (error) {
    if (previous === undefined) await table.delete(args[0]); else await table.put(args[0], previous);
    for (const old of written.reverse()) { await this.atomic(old.entry.path, old.text); Object.assign(old.entry, { text: old.text, hash: old.hash }); }
    throw error;
   }
   for (const id of new Set([owner, ...written.map(row => row.entry.project.id)].filter(Boolean))) this.onCommitted(id);
   return result;
  });
 }
 async stagePaths(value, root, key = '', copies = new Map()) {
  if (Array.isArray(value)) return Promise.all(value.map(item => this.stagePaths(item, root, key, copies)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await this.stagePaths(item, root, name, copies)])));
  if (typeof value === 'string' && /(?:path|directory|dir)$/i.test(key) && !['workspacePath', 'projectFilePath'].includes(key) && isAbsolute(value) && !inside(root, value) && existsSync(value)) {
   if (inside(value, root)) throw Error('不能将项目目录的上级文件夹作为项目资料导入');
   if (!copies.has(value)) copies.set(value, (async () => {
    const hash = await assetDigest(value), target = join(root, '资料', '外部导入', `${hash.slice(0, 20)}-${basename(value)}`);
    await mkdir(dirname(target), { recursive: true });
    if (!existsSync(target)) await cp(value, target, { recursive: true, dereference: true, errorOnExist: true, force: false });
    if (await assetDigest(target) !== hash) throw Error('导入期间源文件发生变化，或已有资料副本损坏，请检查原始文件后重试');
    return target;
   })());
   return copies.get(value);
  }
  return value;
 }
 async create(project) {
  return this.serial(async () => {
   const path = resolve(project.projectFilePath);
   if (this.projects.has(project.id)) return this.projectTable.get(project.id);
   if (extname(path).toLowerCase() !== '.ibmproject') throw Error('请选择 .ibmproject 工程文件');
   if (existsSync(path)) throw Error('该工程文件已存在，请选择新的文件名或使用打开项目');
   const entry = { path, project };
   const rawProject = this.projectTable.get(project.id);
   try {
    await this.projectTable.put(project.id, project);
    for (const row of this.rows(project.id)) {
     const staged = await this.stagePaths(row.value, dirname(path));
     if (this.domains.has(row.domain)) await this.domains.get(row.domain).domain.table(row.table).put(row.key, staged);
     else this.dormant.get(row.domain).domain.table(row.table).set(row.key, staged);
    }
    const text = await this.text(entry);
    await this.atomic(path, text, true);
    Object.assign(entry, { text, hash: digest(text), document: this.snapshot(entry) });
    this.projects.set(project.id, entry); this.errors.delete(project.id);
    this.onCommitted(project.id);
    return project;
   } catch (error) { if (rawProject) await this.projectTable.put(project.id, rawProject); throw error; }
  });
 }
 async parse(path) {
  path = resolve(path);
  if (extname(path).toLowerCase() !== '.ibmproject') throw Error('请选择 .ibmproject 工程文件');
  if ((await stat(path)).size > MAX_SIZE) throw Error('项目文件超过 64 MB，请检查文件是否正确');
  const text = await readFile(path, 'utf8');
  let document;
  try { document = JSON.parse(text); } catch { throw Error('工程文件不是有效的 JSON 文档'); }
  if (!document || document.format !== FORMAT || document.version !== 1) throw Error('不支持的工程文件格式或版本');
  document = mapPaths(document, dirname(path), true);
  document.project = schemas.lab_tasks.lab_projects.parse({ ...document.project, workspacePath: dirname(path), projectFilePath: path });
  if (!document.project.projectUid) throw Error('工程文件缺少项目唯一标识');
  if (!document.domains || typeof document.domains !== 'object' || Array.isArray(document.domains)) throw Error('工程文件缺少业务记录');
  const ids = new Set();
  const rows = [];
  for (const [name, domain] of Object.entries(document.domains)) {
   if (!Object.hasOwn(schemas, name) || domain.version !== 0 || !domain.tables || typeof domain.tables !== 'object') throw Error('不支持的项目数据域或版本');
   for (const [table, items] of Object.entries(domain.tables)) {
    if (!Object.hasOwn(schemas[name], table) || localOnly(name, table) || !Array.isArray(items)) throw Error('工程文件包含未知的数据表');
    const keys = new Set();
    domain.tables[table] = items.map(item => {
     if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || keys.has(item[0])) throw Error('工程文件包含重复或无效的记录键');
     keys.add(item[0]); const row = schemas[name][table].parse(item[1]);
     const keyMatches = name === 'lab_chemistry' && table === 'chemical_properties' ? item[0].startsWith(`${row.entityId}@${row.property}@`) : row.id === item[0];
     if (!keyMatches || row.projectId && row.projectId !== document.project.id) throw Error('工程文件包含其他课题的记录');
     if (row.projectId === document.project.id) ids.add(row.id);
     rows.push(row); return [item[0], row];
    });
   }
  }
  // Reject unrelated global objects; shared entities must be referenced by this project.
  const refs = new Set(); for (const row of rows) if (row.projectId) references(row, refs);
  let changed = true;
  const owned = new Set();
  while (changed) { changed = false; for (const row of rows) if (!row.projectId && !owned.has(row) && (refs.has(row.id) || ids.has(row.entityId) || ids.has(row.routeId) || ids.has(row.targetId))) { owned.add(row); if(row.id)ids.add(row.id); references(row, refs); changed = true; } }
  if (rows.some(row => !row.projectId && !owned.has(row))) throw Error('工程文件包含不属于该项目的共享记录');
  return { path, text, hash: digest(text), document, project: document.project };
 }
 async restoreDomain(entry, name) {
  const active = this.domains.get(name); if (!active) return;
  const incoming = entry.document.domains[name]?.tables ?? {};
  for (const tableName of Object.keys(active.spec.tables)) {
   if (localOnly(name, tableName)) continue;
   const items = incoming[tableName] ?? [];
   const table = active.domain.table(tableName);
   for (const key of [...table.keys()]) if (table.get(key)?.projectId === entry.project.id) await table.delete(key);
   for (const [key, value] of items) await table.put(key, value);
  }
 }
 validateCollisions(entry, name) {
  const active = this.domains.get(name);
  for (const [tableName, items] of Object.entries(entry.document.domains[name]?.tables ?? {})) for (const [key, row] of items) {
   const old = active.domain.table(tableName).get(key);
   if (old?.projectId && old.projectId !== entry.project.id) throw Error('项目记录标识与其他课题冲突，未导入');
   if (old && !old.projectId && JSON.stringify(contentOf(old)) !== JSON.stringify(contentOf(row))) throw Error('项目共享化学记录与本机记录冲突，未导入');
  }
 }
 async open(path) {
  return this.serial(async () => {
   const entry = await this.parse(path), id = entry.project.id;
   const existing = this.projectTable.get(id);
   if ([...this.projectTable.keys()].some(key => key !== id && this.projectTable.get(key)?.workspacePath && samePath(this.projectTable.get(key).workspacePath, entry.project.workspacePath))) throw Error('该文件夹已登记为另一个项目，请为每个项目使用独立文件夹');
   if (existing?.projectUid && entry.project.projectUid !== existing.projectUid) throw Error('工程文件的项目标识与已登记项目冲突，未导入');
   if (existing?.projectFilePath && !samePath(existing.projectFilePath, entry.path) && !this.canSwitch(id)) throw Error('该项目仍有运行中的任务，请等待任务结束后再打开其他位置的工程文件');
   // Validate collisions in every loaded domain before applying any data.
   for (const name of this.domains.keys()) this.validateCollisions(entry, name);
   const undo = [];
   for (const [name, active] of this.domains) for (const tableName of Object.keys(active.spec.tables)) {
    const table = active.domain.table(tableName);
    const keys = new Set([...table.keys()].filter(key => table.get(key)?.projectId === id));
    for (const [key] of entry.document.domains[name]?.tables[tableName] ?? []) keys.add(key);
    if (name === 'lab_tasks' && tableName === 'lab_projects') keys.add(id);
    for (const key of keys) undo.push({ table, key, value: table.get(key) });
   }
   try {
    for (const name of this.domains.keys()) await this.restoreDomain(entry, name);
    await this.projectTable.put(id, entry.project);
    if (existing?.workspacePath && !samePath(existing.workspacePath, entry.project.workspacePath)) {
     const sessions = this.domains.get('lab_tasks').domain.table('project_sessions');
     for (const key of [...sessions.keys()]) if (sessions.get(key)?.projectId === id) await sessions.delete(key);
    }
   } catch (error) {
    for (const row of undo.reverse()) { if (row.value === undefined) await row.table.delete(row.key); else await row.table.put(row.key, row.value); }
    throw error;
   }
   this.projects.set(id, entry); this.errors.delete(id);
   this.onCommitted(id);
   return entry.project;
  });
 }
 async ensure(project) {
  if (this.errors.has(project.id)) throw Error(this.errors.get(project.id));
  if (this.projects.has(project.id)) { await this.tail.catch(() => {}); await this.assertUnchanged(this.projects.get(project.id)); return this.projectTable.get(project.id); }
  const path = project.projectFilePath ?? join(project.workspacePath, `${project.id}.ibmproject`);
  if (existsSync(path)) return this.open(path);
  if (project.projectFilePath) throw Error('项目文件不存在，请选择移动后的 .ibmproject 文件');
  if (this.dormantErrors.size) throw Error('部分历史科研记录无法读取，请修复相应数据模块后再将旧课题迁移为工程文件');
  return this.create({ ...project, projectFilePath: path, projectUid: project.projectUid ?? randomUUID() });
 }
 forget(id) { this.projects.delete(id); this.errors.delete(id); }
 async readDraft(projectId, kind) {
  const project = await this.ensure(this.projectTable.get(projectId));
  const path = this.draftPath(project, kind);
  try { return { exists: true, text: await readFile(path, 'utf8'), path }; } catch (error) { if (error.code === 'ENOENT') return { exists: false, text: '', path }; throw error; }
 }
 draftPath(project, kind) { if (!['proposal', 'polishing'].includes(kind)) throw Error('未知的草稿类型'); return join(project.workspacePath, '草稿', kind === 'proposal' ? '项目申报.md' : '论文润色.md'); }
 async writeDraft(projectId, kind, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error('草稿内容无效或超过 8 MB');
  const project = await this.ensure(this.projectTable.get(projectId));
  return this.serial(async () => { await this.assertUnchanged(this.projects.get(projectId)); const path = this.draftPath(project, kind); await this.atomic(path, text); return { saved: true, path }; });
 }
}
