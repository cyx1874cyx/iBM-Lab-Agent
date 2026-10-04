/** Private Electron sidecar. Research pages have no preload or host transport. */
import { app, BrowserWindow, session, dialog, shell, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.env.IBM_SCIENTIFIC_DESKTOP_CONFIG ?? "{}");
if (!config.userData || !config.downloadsRoot) throw new Error("scientific desktop requires isolated absolute roots");
app.setPath("userData", config.userData);
app.disableHardwareAcceleration();
const leases = new Map(), captures = new Map(), files = new Map(), configured = new Set();
const previews = new Set();
const savedFiles = new Map();
const MAX_BYTES = 250 * 1024 * 1024;
let transport;
const emit = value => transport.write(`${JSON.stringify(value)}\n`);

function allowed(value) {
 try {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) || /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
   && (!local || (config.allowedLocalOrigins ?? []).includes(url.origin))
   && !(config.hostOrigins ?? []).some(origin => {
    const host = new URL(origin);
    return url.port === host.port && (url.hostname === host.hostname || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
   });
 } catch { return false; }
}
function options(partition) {
 return { show: !config.headless, width: 1100, height: 800, webPreferences: {
  partition, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
  contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
  webviewTag: false, plugins: false, navigateOnDragDrop: false
 } };
}
function publicUrl(value) { const url = new URL(value); return `${url.origin}${url.pathname}`; }
function requireLease(id) {
 const row = leases.get(id);
 if (!row || row.window.isDestroyed()) throw new Error("scientific browser lease is closed");
 return row;
}
function bind(window, lease) {
 const contents = window.webContents;
 contents.setWindowOpenHandler(({ url }) => allowed(url)
  ? { action: "allow", overrideBrowserWindowOptions: options(lease.partition) } : { action: "deny" });
 contents.on("did-create-window", popup => { lease.popups.add(popup); bind(popup, lease); popup.once("closed", () => lease.popups.delete(popup)); });
 contents.on("will-navigate", (event, url) => { if (!allowed(url)) event.preventDefault(); });
 contents.on("will-redirect", (event, url) => { if (!allowed(url)) event.preventDefault(); });
 contents.on("will-attach-webview", event => event.preventDefault());
 contents.on("render-process-gone", () => { emit({ event: "browser-failed", lease: lease.id }); });
}
function configure(partition) {
 const browserSession = session.fromPartition(partition);
 if (configured.has(partition)) return browserSession;
 configured.add(partition);
 browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
 browserSession.setPermissionCheckHandler(() => false);
 browserSession.webRequest.onBeforeRequest((details, callback) => {
  const protocol = new URL(details.url).protocol;
  callback({ cancel: ["http:", "https:", "ws:", "wss:"].includes(protocol) ? !allowed(details.url.replace(/^ws/, "http")) : !["about:", "data:", "blob:"].includes(protocol) });
 });
 browserSession.on("will-download", (event, item, contents) => {
  const lease = [...leases.values()].find(row => row.partition === partition &&
   (row.window.webContents === contents || [...row.popups].some(popup => popup.webContents === contents)));
  const armed = lease && captures.get(lease.id);
  if (!armed || item.getTotalBytes() > MAX_BYTES) { event.preventDefault(); return; }
  captures.delete(lease.id);
  const fileId = randomUUID(), path = join(config.downloadsRoot, fileId);
  item.setSavePath(path);
  item.on("updated", () => { if (item.getReceivedBytes() > MAX_BYTES) item.cancel(); });
  item.once("done", async (_event, state) => {
   if (state !== "completed") {
    await rm(path, { force: true });
    emit({ event: "capture-failed", captureId: armed.captureId, lease: lease.id, state });
    return;
   }
   files.set(fileId, path);
   emit({ event: "capture-ready", captureId: armed.captureId, lease: lease.id, fileId, fileName: basename(item.getFilename()), size: item.getReceivedBytes() });
   const owner = contents?.getOwnerBrowserWindow();
   if (owner && !owner.isDestroyed() && lease.popups.has(owner) && ["", "about:blank"].includes(contents.getURL())) owner.close();
  });
 });
 return browserSession;
}
async function dispatch(method, input = {}) {
 switch (method) {
  case "open": {
   if (typeof input.workspace !== "string" || !input.workspace || input.workspace.length > 4096 || !allowed(input.url)) throw new Error("invalid scientific browser reservation");
   const partition = `persist:ibm-scientific-${createHash("sha256").update(input.workspace).digest("hex")}`;
   configure(partition);
   const id = randomUUID(), window = new BrowserWindow(options(partition));
   const lease = { id, window, partition, popups: new Set() };
   leases.set(id, lease); bind(window, lease);
   window.once("closed", () => { for (const popup of lease.popups) popup.destroy(); captures.delete(id); leases.delete(id); emit({ event: "lease-closed", lease: id }); });
   try { await window.loadURL(input.url); }
   catch { window.destroy(); throw new Error("Scientific browser navigation failed"); }
   return { lease: id, url: publicUrl(window.webContents.getURL()), title: window.webContents.getTitle(), persistent: true };
  }
  case "state": {
   const row = requireLease(input.lease);
   return { lease: row.id, url: publicUrl(row.window.webContents.getURL()), title: row.window.webContents.getTitle(), popups: row.popups.size, persistent: true };
  }
  case "navigate": {
   const row = requireLease(input.lease);
   if (!allowed(input.url)) throw new Error("blocked scientific browser destination");
   try { await row.window.loadURL(input.url); } catch { throw new Error("Scientific browser navigation failed"); }
   return await dispatch("state", input);
  }
  case "links": {
   const row = requireLease(input.lease);
   const windows = [row.window, ...row.popups].filter(window => !window.isDestroyed());
   const result = [];
   for (const window of windows) {
    const url = window.webContents.getURL();
    if (!allowed(url)) continue;
    let timer;
    const links = await Promise.race([
     window.webContents.executeJavaScript('Array.from(document.querySelectorAll("a[href]")).map(a => ({text: (a.innerText || a.title || "").slice(0, 120), url: a.href})).filter(a => /science|科学|PDF|supplement/i.test(a.text + " " + a.url)).sort((a,b) => Number(/PDF|supplement/i.test(b.text + " " + b.url)) - Number(/PDF|supplement/i.test(a.text + " " + a.url))).slice(0, 80)').catch(() => []),
     new Promise(resolveLinks => { timer = setTimeout(() => resolveLinks([]), 2000); })
    ]).finally(() => clearTimeout(timer));
    if (!window.isDestroyed()) result.push({ url: publicUrl(url), title: window.webContents.getTitle(), links: links.filter(link => allowed(link.url)).map(link => ({ text: link.text, url: publicUrl(link.url) })) });
   }
   return result;
  }
  case "close": { const row = requireLease(input.lease); row.window.destroy(); return { closed: true }; }
  case "focus": { const row = requireLease(input.lease); row.window.show(); row.window.focus(); return { shown: true }; }
  case "disarm": { requireLease(input.lease); captures.delete(input.lease); return { disarmed: true }; }
  case "discard": { const path = files.get(input.fileId); files.delete(input.fileId); if (path) await rm(path, { force: true }); return { discarded: true }; }
  case "revealSaved": { const path = savedFiles.get(input.savedRef); if (!path) throw new Error("Unknown saved artifact"); shell.showItemInFolder(path); return { revealed: true }; }
  case "arm": {
   requireLease(input.lease);
   if (!["pdf", "si"].includes(input.kind) || !/^capture-[a-z0-9]+$/.test(input.captureId)) throw new Error("invalid capture task");
   captures.set(input.lease, { captureId: input.captureId, kind: input.kind });
   return { armed: true };
  }
  case "consume": {
   const path = files.get(input.fileId);
   if (!path) throw new Error("unknown captured file");
   files.delete(input.fileId);
   try { return { base64: (await readFile(path)).toString("base64") }; }
   finally { await rm(path, { force: true }); }
  }
  case "stage": {
   const buffer = Buffer.from(input.base64 ?? "", "base64");
   if (!buffer.length || buffer.length > MAX_BYTES) throw new Error("invalid artifact size");
   const fileId = randomUUID(), path = join(config.downloadsRoot, fileId);
   await writeFile(path, buffer); files.set(fileId, path);
   return { fileId };
  }
  case "save": {
   const path = files.get(input.fileId);
   if (!path) throw new Error("unknown artifact");
   let owner = input.lease ? requireLease(input.lease).window : undefined;
   const temporaryOwner = !owner;
   if (!owner) {
    owner = new BrowserWindow({ ...options(`ibm-native-dialog-${randomUUID()}`), show: true, width: 520, height: 220, title: "保存文件" });
    previews.add(owner);
    owner.once("closed", () => previews.delete(owner));
    owner.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    owner.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    owner.webContents.session.setPermissionCheckHandler(() => false);
    await owner.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<title>保存文件</title><body style="font:18px sans-serif;padding:30px">请选择保存位置，或点击取消。</body>')}`);
    owner.focus();
   }
   const opts = { defaultPath: basename(String(input.name ?? "artifact.pdf")) };
   let result;
   try { result = await dialog.showSaveDialog(owner, opts); }
   finally { if (temporaryOwner && !owner.isDestroyed()) owner.destroy(); }
   if (result.canceled || !result.filePath) return { cancelled: true };
   const bytes = await readFile(path);
   await writeFile(result.filePath, bytes);
   const saved = await readFile(result.filePath);
   const savedRef = randomUUID(); savedFiles.set(savedRef, result.filePath);
   return { cancelled: false, saved: true, savedRef, size: saved.length, sha256: createHash("sha256").update(saved).digest("hex") };
  }
  case "artifactOpen": {
   const path = files.get(input.fileId);
   if (!path) throw new Error("unknown artifact");
   const bytes = await readFile(path);
   const extension = bytes.subarray(0, 4).toString() === "%PDF" ? "pdf" : /\.(docx|pptx)$/i.exec(input.name ?? "")?.[1]?.toLowerCase();
   if (!extension || (extension !== "pdf" && bytes.subarray(0, 2).toString() !== "PK")) throw new Error("System open supports validated PDF/DOCX/PPTX artifacts");
   const directory = join(config.userData, "exports");
   await mkdir(directory, { recursive: true });
   const exported = join(directory, `${input.fileId}.${extension}`);
   await writeFile(exported, bytes);
   const error = await shell.openPath(exported);
   if (error) throw new Error("System application could not open the artifact");
   return { opened: true };
  }
  case "preview": {
   const path = files.get(input.fileId);
   if (!path) throw new Error("unknown artifact");
   const bytes = await readFile(path);
   if (bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("preview currently supports validated PDF artifacts");
   const directory = join(config.downloadsRoot, "previews");
   await mkdir(directory, { recursive: true });
   const previewPath = join(directory, `${input.fileId}.pdf`);
   await writeFile(previewPath, bytes);
   const url = pathToFileURL(previewPath);
   const partition = `ibm-artifact-preview-${randomUUID()}`;
   const settings = options(partition);
   settings.show = !config.headless; settings.webPreferences.plugins = true;
   const previewSession = session.fromPartition(partition);
   previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
   previewSession.setPermissionCheckHandler(() => false);
   previewSession.webRequest.onBeforeRequest((details, callback) => {
    const request = new URL(details.url);
    callback({ cancel: !((request.protocol === "file:" && request.hostname === url.hostname && request.pathname === url.pathname) || ["chrome-extension:", "about:", "blob:", "data:"].includes(request.protocol)) });
   });
   const window = new BrowserWindow(settings);
   previews.add(window);
   window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
   window.webContents.on("will-navigate", event => event.preventDefault());
   window.once("closed", () => { previews.delete(window); void rm(previewPath, { force: true }).catch(() => {}); });
   try { await window.loadURL(url.href); } catch { window.destroy(); throw new Error("Artifact PDF preview failed"); }
   return { previewOpened: true };
  }
  case "reveal": {
   const path = files.get(input.fileId);
   if (!path) throw new Error("unknown artifact");
   shell.showItemInFolder(path); return { revealed: true };
  }
  case "credentialStatus": return { available: safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text") };
  case "storeCredential": {
   if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("OS credential encryption unavailable");
   if (typeof input.value !== "string" || !input.value || input.value.length > 16384) throw new Error("invalid credential");
   await writeFile(join(config.userData, "scientific-credential.bin"), safeStorage.encryptString(input.value), { mode: 0o600 });
   return { stored: true };
  }
  case "stop": {
   for (const window of previews) window.destroy();
   for (const row of leases.values()) row.window.destroy();
   await Promise.all([...configured].map(partition => session.fromPartition(partition).cookies.flushStore()));
   await Promise.all([...files.values()].map(path => rm(path, { force: true })));
   setImmediate(() => app.quit()); return { stopped: true };
  }
  default: throw new Error("unknown scientific desktop operation");
 }
}
async function start() {
 await mkdir(config.userData, { recursive: true });
 await mkdir(config.downloadsRoot, { recursive: true });
 await app.whenReady();
 app.on("window-all-closed", () => {});
 transport = createConnection(config.pipe);
 transport.on("error", () => app.quit());
 await new Promise(resolveConnected => transport.once("connect", resolveConnected));
 const lines = createInterface({ input: transport });
 lines.on("line", line => {
  let packet;
  try { packet = JSON.parse(line); } catch { return; }
  void dispatch(packet.method, packet.input).then(result => emit({ id: packet.id, result }), error => emit({ id: packet.id, error: String(error.message) }));
 });
 lines.once("close", () => app.quit());
 emit({ event: "ready", electron: process.versions.electron, auth: config.auth });
}
// Awaiting app readiness at ESM top level prevents Electron from finishing its bootstrap.
void start().catch(error => { console.error(error.message); app.exit(1); });
