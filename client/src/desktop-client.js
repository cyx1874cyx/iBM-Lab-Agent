/** Host-owned actions; pages never receive preload, pipe access or download tokens. */
let invoke = null, project = null;
export function installDesktopClient(call) { invoke = call; return () => { if (invoke === call) { invoke = null; project = null; } }; }
export function setDesktopProject(id) { project = id; }
export async function nativeDesktopAvailable() { return invoke ? Boolean((await invoke("desktop_status")).available) : false; }
export async function nativeArtifact(action, input) {
 if (!await nativeDesktopAvailable()) return null;
 return await invoke("desktop_artifact", { request: { action, ...input } });
}
export async function nativeBrowser(action, input = {}) {
 if (!await nativeDesktopAvailable()) return null;
 const projectId = input.projectId ?? project;
 if (!projectId) throw new Error("请先选择一个课题，再打开科研浏览器");
 return await invoke("desktop_browser", { request: { action, projectId, ...input } });
}
