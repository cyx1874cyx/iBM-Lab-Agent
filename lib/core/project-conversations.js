import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Keep a portable copy of project conversations and their attachments beside research files. */
export class ProjectConversations {
 constructor(core, ctx) { this.core = core; this.ctx = ctx; this.pending = new Map(); this.jobs = new Map(); this.errors = new Map(); }
 schedule(projectId, sessionId) {
  if (!sessionId || this.pending.has(sessionId)) return;
  const timer = setTimeout(() => {
   this.pending.delete(sessionId);
   void this.save(projectId, sessionId).catch(error => this.ctx.logger.warn(`项目对话归档失败：${error.message}`));
  }, 2000);
  timer.unref(); this.pending.set(sessionId, { projectId, timer });
 }
 async save(projectId, sessionId) {
  if (this.jobs.has(sessionId)) return this.jobs.get(sessionId);
  if (!this.ctx.get('sessionPersistence') || !this.ctx.get('attachments')) return;
  const job = this.write(projectId, sessionId).then(() => { this.errors.delete(projectId); }, error => { this.errors.set(projectId, error.message); throw error; }).finally(() => this.jobs.delete(sessionId));
  this.jobs.set(sessionId, job); return job;
 }
 async write(projectId, sessionId) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) throw Error('无效的会话归档标识');
  const exporter = await import('@deepseek-ai/dsh-session-log-export');
  const deps = exporter.sessionLogExportDeps(this.ctx);
  const signal = new AbortController().signal;
  await exporter.flushLiveSessionLog(deps, sessionId, signal);
  const content = await exporter.readSessionLogText(deps.sessionPersistence, sessionId, signal);
  if (content === undefined) return;
  const { path: root } = await this.core.ensureProjectWorkspace(projectId);
  const directory = join(root, '对话'); await mkdir(directory, { recursive: true });
  const target = join(directory, sessionId + '.zip'), temporary = join(directory, '.' + sessionId + '.' + randomUUID() + '.tmp');
  try {
   await pipeline(Readable.fromWeb(exporter.streamSessionLogZip(deps, content, sessionId, Boolean(deps.sessionQuery), 6, signal)), createWriteStream(temporary, { flags: 'wx' }));
   await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
 }
 async close() {
  const pending = [...this.pending.entries()]; this.pending.clear();
  for (const [, row] of pending) clearTimeout(row.timer);
  await Promise.allSettled([...pending.map(([sessionId, row]) => this.save(row.projectId, sessionId)), ...this.jobs.values()]);
 }
}
