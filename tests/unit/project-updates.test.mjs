import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectUpdates } from '../../lib/core/project-updates.js';
import { followProjectUpdates } from '../../client/src/project-live-updates.js';
import { setTimeout as delay } from 'node:timers/promises';

test('project notifications isolate projects, wake pending clients and invalidate cursors after restart', async () => {
 const updates = new ProjectUpdates();
 const initial = updates.revision('one');
 let resolved = false;
 const pending = updates.watch('one', initial).then(value => { resolved = true; return value; });
 updates.publish('two'); await Promise.resolve(); assert.equal(resolved, false);
 updates.publish('one');
 const result = await pending; assert.equal(result.changed, true); assert.notEqual(result.revision, initial);
 assert.equal(updates.waiters.size, 0);
 assert.equal((await updates.watch('one', initial)).changed, true);
 const heartbeat = updates.watch('one', result.revision, 5); await delay(10); assert.equal((await heartbeat).changed, false);
 const ending = updates.watch('one', result.revision); updates.close(); assert.equal((await ending).changed, false);
 assert.equal(updates.waiters.size, 0);
 const restarted = new ProjectUpdates(); assert.notEqual(restarted.revision('one'), new ProjectUpdates().revision('one')); restarted.close();
});

test('client reloads on committed changes, resumes on focus and stops when the project closes', async () => {
 const updates = new ProjectUpdates(), windowTarget = new EventTarget(), documentTarget = new EventTarget();
 let revision = updates.revision('one'), loads = 0;
 const close = followProjectUpdates({ projectId: 'one', windowTarget, documentTarget, getRevision: () => revision,
  call: (_method, { request }) => updates.watch(request.projectId, request.revision),
  load: async () => { loads++; revision = updates.revision('one'); return { revision }; } });
 updates.publish('one'); await delay(10); assert.equal(loads, 1);
 updates.publish('two'); await delay(5); assert.equal(loads, 1);
 windowTarget.dispatchEvent(new Event('focus')); await delay(5); assert.equal(loads, 2);
 close(); updates.publish('one'); await delay(5); assert.equal(loads, 2); updates.close();
});
