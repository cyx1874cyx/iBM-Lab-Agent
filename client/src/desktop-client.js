/** Host-owned actions; pages never receive preload, pipe access or download tokens. */
let invoke = null, project = null, currentSessionId = null;
export function installDesktopClient(call, sessionId = () => undefined) { invoke = call;currentSessionId = sessionId;return () => { if (invoke === call) { invoke = null;project = null;currentSessionId = null; } }; }
export function setDesktopProject(id) { project = id; }
export function currentDesktopSessionId(sessions) {
 const snapshot=sessions?.list.getSnapshot();
 return snapshot?.current??Object.values(snapshot?.byId??{}).find(row=>(row.retainedBy?.mainView??0)>0)?.id;
}
export async function nativeDesktopAvailable() { return invoke ? Boolean((await invoke("desktop_status")).available) : false; }
export async function nativeArtifact(action, input) {
 if (!await nativeDesktopAvailable()) return null;
 return await invoke("desktop_artifact", { request: { action, ...input } });
}
export async function nativeBrowser(action, input = {}) {
 if (!await nativeDesktopAvailable()) return null;
 const projectId = input.projectId ?? project;
 if (!projectId) throw new Error("请先选择一个课题，再打开科研浏览器");
 const sessionId = input.sessionId ?? currentSessionId?.();
 return await invoke("desktop_browser", { request: { action, projectId, ...(sessionId ? { sessionId } : {}), ...input } });
}
