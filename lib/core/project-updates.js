import { randomUUID } from 'node:crypto';

/** A project-scoped cursor wakes clients only after a successful storage commit. */
export class ProjectUpdates {
 constructor() { this.epoch = randomUUID(); this.sequence = 0; this.revisions = new Map(); this.waiters = new Map(); this.closed = false; }
 revision(projectId) { return `${this.epoch}:${this.revisions.get(projectId) ?? 0}`; }
 publish(projectId) {
  if (this.closed || !projectId) return;
  this.revisions.set(projectId, ++this.sequence);
  for (const finish of [...(this.waiters.get(projectId) ?? [])]) finish(true);
 }
 watch(projectId, revision, waitMs = 10000) {
  if (this.closed) return Promise.reject(Error('项目同步服务已关闭'));
  if (revision !== this.revision(projectId)) return Promise.resolve({ revision: this.revision(projectId), changed: true });
  return new Promise(resolve => {
   let timer;
   const finish = changed => { clearTimeout(timer); const set = this.waiters.get(projectId); set?.delete(finish); if (!set?.size) this.waiters.delete(projectId); resolve({ revision: this.revision(projectId), changed }); };
   if (!this.waiters.has(projectId)) this.waiters.set(projectId, new Set());
   this.waiters.get(projectId).add(finish);
   timer = setTimeout(() => finish(false), Math.max(1, Math.min(10000, Number(waitMs) || 10000))); timer.unref?.();
  });
 }
 close() { this.closed = true; for (const set of [...this.waiters.values()]) for (const finish of [...set]) finish(false); }
}
