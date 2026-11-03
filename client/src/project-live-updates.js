/** Follow committed project changes; older/offline hosts fall back to bounded polling. */
export function followProjectUpdates({ call, projectId, load, getRevision, windowTarget = globalThis.window, documentTarget = globalThis.document }) {
 let stopped = false, supported = true, timer, wake, lastLoaded = Date.now();
 const delay = () => new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 2000); });
 const refresh = async () => { const result = await load({ quiet: true }); if (result) lastLoaded = Date.now(); return Boolean(result); };
 const resume = () => { if (!stopped) void refresh(); };
 const visible = () => { if (documentTarget?.visibilityState !== 'hidden') resume(); };
 windowTarget?.addEventListener('focus', resume);
 documentTarget?.addEventListener('visibilitychange', visible);
 const run = async () => {
  while (!stopped) {
   try {
    if (!supported) { await refresh(); if (!stopped) await delay(); continue; }
    const change = await call('projects_watch', { request: { projectId, revision: getRevision(), waitMs: 10000 } });
    if (stopped) return;
    if (change.changed || change.revision !== getRevision() || Date.now() - lastLoaded >= 15000) {
     if (!await refresh()) { if (!stopped) await delay(); continue; }
     if (!getRevision()) supported = false;
    }
   } catch { supported = false; if (!stopped) await delay(); }
  }
 };
 void run();
 return () => { stopped = true; clearTimeout(timer); wake?.(); windowTarget?.removeEventListener('focus', resume); documentTarget?.removeEventListener('visibilitychange', visible); };
}
