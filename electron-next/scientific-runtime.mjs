/** Private Electron sidecar. Research pages have no preload or host transport. */
import { app, BrowserWindow, session, dialog, shell, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyLiteratureAccess } from './literature-access.mjs';
import { nativePdfResource } from './pdf-browser-policy.mjs';

export function createScientificRuntime(config, emit) {
const leases = new Map(), captures = new Map(), files = new Map(), configured = new Set();
const previews = new Set();
const savedFiles = new Map();
const MAX_BYTES = 250 * 1024 * 1024;

function allowed(value) {
 try {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) || /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
   && (!local || (config.allowedLocalOrigins ?? []).includes(url.origin))
   && !(config.getHostOrigins?.() ?? config.hostOrigins ?? []).some(origin => {
    const host = new URL(origin);
    return url.port === host.port && (url.hostname === host.hostname || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
   });
 } catch { return false; }
}
function options(partition) {
 return { show: !config.headless, width: 1100, height: 800, webPreferences: {
  partition, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
  contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
  webviewTag: false, plugins: true, navigateOnDragDrop: false
 } };
}
function publicUrl(value) { const url = new URL(value); return url.protocol === "about:" ? "about:blank" : `${url.origin}${url.pathname}`; }
function requireLease(id) {
 const row = leases.get(id);
 if (!row || row.window.isDestroyed()) throw new Error("scientific browser lease is closed");
 return row;
}
async function inspectAccess(row,contents=row.window.webContents) {
 let timer;const signals=await Promise.race([
  contents.executeJavaScriptInIsolatedWorld(998,[{code:`(()=>{const visible=e=>Boolean(e?.getClientRects().length);const body=document.querySelector('[data-test="article-body"],.c-article-body,[itemprop="articleBody"]');return {text:(document.body?.innerText||'').slice(0,60000),password:[...document.querySelectorAll('input[type="password"]')].some(visible),fullText:visible(body)&&(body.innerText||'').length>1500,downloadEntry:[...document.querySelectorAll('a,button')].some(e=>visible(e)&&/download pdf|下载|supplementary|supporting information/i.test(e.innerText||''))};})()`}]).catch(()=>({})),
  new Promise(resolve=>{timer=setTimeout(()=>resolve({}),1500);})
 ]).finally(()=>clearTimeout(timer));
 return classifyLiteratureAccess({...signals,title:contents.isDestroyed()?'':contents.getTitle(),statusCode:contents===row.window.webContents?row.statusCode:0,documentType:contents===row.window.webContents?row.documentType:''});
}
function bind(window, lease) {
 const contents = window.webContents;
 contents.on("did-start-navigation", (_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){emit({event:"page-loading",lease:lease.id});lease.pageSeq=(lease.pageSeq??0)+1;lease.observation=null;lease.access=null;lease.statusCode=0;lease.documentType='';}});
 const reportPage=async()=>{if(contents!==lease.window.webContents)return;const seq=lease.pageSeq;emit({event:'page-checking-access',lease:lease.id});const access=await inspectAccess(lease,contents);if(contents.isDestroyed()||seq!==lease.pageSeq)return;lease.access=access;emit({event:"page-state",lease:lease.id,url:publicUrl(contents.getURL()),pageSeq:seq??1,documentType:lease.documentType??"",access});};
 contents.on("dom-ready",()=>{void reportPage().catch(()=>{});});
 contents.on("did-finish-load",()=>{void reportPage().catch(()=>{});});
 contents.setWindowOpenHandler(({ url, postBody }) => {
  if(!allowed(url))return {action:"deny"};
  const authentication=/login|oauth|sso|passport|\/cas\/|\/auth(?:\/|\?)/i.test(new URL(url).hostname+new URL(url).pathname);
  if(config.embedded&&!postBody&&!authentication){queueMicrotask(()=>contents.loadURL(url).catch(()=>{}));return {action:"deny"};}
  return {action:"allow",overrideBrowserWindowOptions:options(lease.partition)};
 });
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
  callback({ cancel: ["http:", "https:", "ws:", "wss:"].includes(protocol) ? !allowed(details.url.replace(/^ws/, "http")) : !nativePdfResource(details)&&!["about:", "data:", "blob:"].includes(protocol) });
 });
 browserSession.webRequest.onHeadersReceived((details,callback)=>{if(details.resourceType==="mainFrame"){const lease=[...leases.values()].find(row=>row.partition===partition&&(row.window.webContents.id===details.webContentsId||[...row.popups].some(p=>p.webContents.id===details.webContentsId)));if(lease){lease.statusCode=details.statusCode;const headers=details.responseHeaders??{};lease.documentType=Object.entries(headers).find(([key])=>key.toLowerCase()==="content-type")?.[1]?.[0]??"";}}callback({cancel:false});});
 browserSession.on("will-download", (event, item, contents) => {
  let lease = [...leases.values()].find(row => row.partition === partition &&
   (row.window.webContents === contents || [...row.popups].some(popup => popup.webContents === contents)));
  if(!lease&&!contents){const owners=[...leases.values()].filter(row=>row.partition===partition&&captures.has(row.id));if(owners.length===1)lease=owners[0];}
  const armed = lease && captures.get(lease.id);
  if (!armed || item.getTotalBytes() > MAX_BYTES) { event.preventDefault(); return; }
  captures.delete(lease.id);
  lease.downloadStartedAt=Date.now();emit({event:"capture-progress",lease:lease.id,captureId:armed.captureId,bytes:0,totalBytes:item.getTotalBytes()});
  const fileId = randomUUID(), path = join(config.downloadsRoot, fileId);
  lease.downloadItem=item;
  item.setSavePath(path);
  item.on("updated", () => { emit({event:"capture-progress",lease:lease.id,captureId:armed.captureId,bytes:item.getReceivedBytes(),totalBytes:item.getTotalBytes()});if (item.getReceivedBytes() > MAX_BYTES) item.cancel(); });
  item.once("done", async (_event, state) => {
   lease.downloadItem=null;
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
   if(config.openGuest)return await config.openGuest(input);
   const partition = `persist:ibm-scientific-${createHash("sha256").update(input.workspace).digest("hex")}`;
   configure(partition);
   const id = randomUUID(), window = new BrowserWindow(options(partition));
   const lease = { id, window, partition, popups: new Set() };
   leases.set(id, lease); bind(window, lease);
   window.once("closed", () => { for (const popup of lease.popups) popup.destroy(); captures.delete(id); leases.delete(id); emit({ event: "lease-closed", lease: id }); });
   try { await window.loadURL(input.blank === true ? "about:blank" : input.url); }
   catch { window.destroy(); throw new Error("Scientific browser navigation failed"); }
   return { lease: id, url: publicUrl(window.webContents.getURL()), title: window.webContents.getTitle(), persistent: true };
  }
  case "state": {
   const row = requireLease(input.lease);
   return { lease: row.id, contentsId:row.window.webContents.id,url: publicUrl(row.window.webContents.getURL()), title: row.window.webContents.getTitle(), popups: row.popups.size, persistent: true, pageSeq:row.pageSeq??1, documentType:row.documentType??"",access:row.access };
  }
  case "navigate": {
   const row = requireLease(input.lease);
   if (!allowed(input.url)) throw new Error("blocked scientific browser destination");
   const startedAt=Date.now(),contents=row.window.webContents;let timer,ready;
   const domReady=new Promise(resolve=>{ready=()=>resolve();contents.once('dom-ready',ready);});
   try { await Promise.race([row.window.loadURL(input.url),domReady,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Scientific browser navigation timed out before document ready')),20000);})]); } catch(error) {
    // Electron can report ERR_ABORTED or ERR_FAILED before will-download for
    // attachments. Success requires an actual download event for this lease.
    if(['ERR_ABORTED','ERR_FAILED'].includes(error.code)||[-2,-3].includes(error.errno))for(let i=0;i<25&&(row.downloadStartedAt??0)<startedAt;i++)await new Promise(done=>setTimeout(done,20));
    if((row.downloadStartedAt??0)<startedAt)throw new Error(`Scientific browser navigation failed (${error.code??"unknown"}, ${error.errno??"unknown"})`);
   }finally{clearTimeout(timer);contents.removeListener('dom-ready',ready);}
   row.access=await inspectAccess(row);
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
  case "observe": {
   const row=requireLease(input.lease),observationId=randomUUID();
   const windows=[row.window,...row.popups].filter(window=>!window.isDestroyed()&&allowed(window.webContents.getURL()));
   const pages=[];row.observation={id:observationId,windows:[]};
   for(const window of windows){
    const contents=window.webContents,url=contents.getURL();
    const result=await contents.executeJavaScriptInIsolatedWorld(999,[{code:`(()=>{const all=[...document.querySelectorAll('a[href],button,input[type="submit"],[role="button"]')].filter(e=>e.getClientRects().length&&!e.disabled);const match=e=>/pdf|download|supplement|supporting|全文|下载|补充/i.test((e.innerText||e.value||e.title||'')+' '+(e.href||''));const filtered=${JSON.stringify(input.scope)}==='all'?all:all.filter(match);filtered.sort((a,b)=>Number(match(b))-Number(match(a)));const elements=filtered.slice(0,30);globalThis.ibmObservation={id:${JSON.stringify(observationId)},elements};return {candidateCount:filtered.length,candidates:elements.map((e,i)=>({text:(e.innerText||e.value||e.title||'').slice(0,180),tagName:e.tagName,downloadRelated:match(e),index:i}))};})()`}]);
    const page=row.observation.windows.length;row.observation.windows.push({contents,url});
    const access=await inspectAccess(row,contents);if(window===row.window)row.access=access;
    pages.push({url:publicUrl(url),title:contents.getTitle(),access,...result,candidates:result.candidates.map(c=>({...c,elementId:'e'+(page*30+c.index)}))});
   }
   return {observationId,pageSeq:row.pageSeq??1,pages,candidates:pages.flatMap(p=>p.candidates),candidateCount:pages.reduce((sum,p)=>sum+p.candidateCount,0)};
  }
  case "click": {
   const row=requireLease(input.lease),observation=row.observation;
   if(!observation||observation.id!==input.observationId||!/^e\d{1,2}$/.test(input.elementId??''))throw Error('页面观察已失效，请重新观察');
   const index=Number(input.elementId.slice(1)),page=observation.windows[Math.floor(index/30)];
   if(!page||page.contents.isDestroyed()||page.contents.getURL()!==page.url)throw Error('页面已导航，请重新观察');
   const clicked=await page.contents.executeJavaScriptInIsolatedWorld(999,[{code:`(()=>{const observed=globalThis.ibmObservation;if(observed?.id!==${JSON.stringify(input.observationId)})return false;const element=observed.elements[${index%30}];if(!element?.isConnected||!element.getClientRects().length||element.disabled)return false;element.click();return true;})()`}]);
   if(!clicked)throw Error('下载入口已变化，请重新观察');return {clicked:true};
  }
  case "viewer-download": {
   const row=requireLease(input.lease);if(!/^application\/pdf(?:;|$)/i.test(row.documentType??'')||!captures.has(row.id))throw Error('当前页面不是可捕获的 PDF，请观察出版社下载入口');
   row.window.webContents.downloadURL(row.window.webContents.getURL());return {started:true};
  }
  case "close": { const row = requireLease(input.lease); row.window.destroy(); return { closed: true }; }
  case "focus": { const row = requireLease(input.lease); const visible=await row.window.show(); row.window.focus(); return visible??{ shown: true }; }
  case "disarm": { const row=requireLease(input.lease); captures.delete(input.lease);row.downloadItem?.cancel(); return { disarmed: true }; }
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
   let owner = input.lease ? requireLease(input.lease).window.webContents.getOwnerBrowserWindow() : undefined;
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
    callback({ cancel: !((request.protocol === "file:" && request.hostname === url.hostname && request.pathname === url.pathname) || nativePdfResource(details) || ["about:", "blob:", "data:"].includes(request.protocol)) });
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
   if(!config.embedded)setImmediate(() => app.quit()); return { stopped: true };
  }
  default: throw new Error("unknown scientific desktop operation");
 }
}

 function attachGuest(id, contents, workspace, partition, focus) {
  const window={webContents:contents,isDestroyed:()=>contents.isDestroyed(),loadURL:url=>contents.loadURL(url),destroy:()=>contents.close({waitForBeforeUnload:false}),show:()=>focus?.(),focus:()=>contents.focus()};
  const row={id,window,partition,workspace,popups:new Set()};
  leases.set(id,row);bind(window,row);
  contents.once('destroyed',()=>{row.downloadItem?.cancel();for(const popup of row.popups)if(!popup.isDestroyed())popup.destroy();captures.delete(id);leases.delete(id);emit({event:'lease-closed',lease:id});});
  return row;
 }
 return {dispatch,configure,attachGuest,leases,allowed};
}
