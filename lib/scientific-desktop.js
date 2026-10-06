import { Service } from "@deepseek-ai/cordis";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronBroker } from "../src/runtime/electron-broker.js";
import { validateCapturedFile, sanitizeCaptureFileName, kindMatchesFileName } from "../src/manual-capture.js";
import { resolveDesktopArtifact } from "../src/runtime/desktop-artifacts.js";
import { inspectOfficePackage } from "../src/office-package.js";

export class ScientificDesktopService extends Service {
 static inject = ["ibmCore", "ibmRuntime"];
 constructor(ctx, config = {}) { super(ctx, "ibmScientificDesktop"); this.config = config; }
 async [Service.init]() {
  this.active = true; this.armed = new Map(); this.leases = new Map(); this.events = []; this.captureQueue = []; this.startingProjects = new Set();
  const electron = this.config.electron ?? process.env.IBM_LAB_AGENT_BUNDLED_ELECTRON;
  if (electron) this.broker = new ElectronBroker(this.ctx.ibmRuntime.processes, {
   electron, root: this.config.root ?? join(this.ctx.ibmCore.projectsRoot, "..", "scientific-desktop"),
   headless: this.config.headless, hostOrigins: this.config.hostOrigins ?? [], allowedLocalOrigins: this.config.allowedLocalOrigins ?? []
  }, event => Promise.resolve(this.onEvent(event)).finally(()=>this.ctx.emit('ibm/task-activity')));
  const releaseResource = this.ctx.ibmRuntime.ownResource(() => this.broker?.dispose());
  if(process.env.IBM_SCIENTIFIC_MAIN_ENDPOINT&&this.broker){
   const tick=()=>this.broker.call("pet-state",this.ctx.ibmCore.taskActivity(),3000).catch(()=>{});
   this.ctx.on('ibm/task-activity',tick,{global:true});
   void tick();const timer=setInterval(tick,1000);timer.unref();this.ctx.effect(()=>()=>clearInterval(timer),"ibm-task-pet.poll");
  }
  this.ctx.effect(() => async () => {
   this.active = false;
   for (const row of this.armed.values()) await this.ctx.get("labCapture")?.cancelTask(row.task.id, "科研桌面服务已停用");
   this.armed.clear(); await this.broker?.dispose(); releaseResource();
  }, "ibm-scientific-desktop.close");
 }
 requireBroker() {
  if (!this.active || !this.broker) throw new RemoteError("feature-unavailable", "Scientific Electron provider is not configured", { service: "ibmScientificDesktop" });
  return this.broker;
 }
 status() { return { available: this.active && Boolean(this.broker), portal: this.config.portal ?? "https://wvpn.ustc.edu.cn/", armed: this.armed.size, events: this.events.slice(-10) }; }
 async open({ projectId, url, blank = false }) {
  const project = this.ctx.ibmCore.requireProject(projectId);
  const result = await this.requireBroker().call("open", { workspace: process.env.IBM_SCIENTIFIC_MAIN_ENDPOINT?`cwd:${project.workspacePath}`:project.id, projectId:project.id,sessionIds:this.ctx.ibmCore.getProjectSession(project.id)?.sessionIds??[],url: url ?? this.status().portal, blank });
  this.leases.set(result.lease, project.id);
  return result;
 }
 async state(lease) { return await this.requireBroker().call("state", { lease }); }
 async links(lease) { return await this.requireBroker().call("links", { lease }); }
 async navigate(lease, url) { return await this.requireBroker().call("navigate", { lease, url }); }
 async windowForProject(projectId, { open = false, url, blank = false } = {}) {
  this.ctx.ibmCore.requireProject(projectId);
  for (const [lease, owner] of this.leases) if (owner === projectId) {
   try { return open&&url&&!blank?await this.navigate(lease,url):await this.state(lease); } catch (error) { if (!/scientific browser lease is closed/.test(error.message)) throw error; this.leases.delete(lease); }
  }
  return open ? await this.open({ projectId, url, blank }) : null;
 }
 async browserAction(request) {
  const { action, projectId } = request ?? {};
  if (!["status", "open", "close", "navigate", "capture", "cancel", "viewer-download"].includes(action)) throw new Error("Unsupported scientific browser action");
  const window = await this.windowForProject(projectId, { open: action === "open" || action === "capture", url: action === "open" ? request.url : undefined, blank: action === "capture" });
  if (action === "status") return { ...this.status(), window, capture:this.captureStatus(undefined,projectId) };
  if (action === "close") return window ? await this.release(window.lease) : { closed: true };
  if (!window) throw new Error("请先打开科研浏览器");
  if (action === "navigate") return await this.navigate(window.lease, request.url);
  if (action === "viewer-download") return await this.requireBroker().call(action,{lease:window.lease});
  if (action === "cancel") {
   for (const [id, row] of this.armed) if (row.lease === window.lease && (!request.taskId || request.taskId === id)) { await this.ctx.get("labCapture")?.cancelTask(id, "用户取消捕获"); this.armed.delete(id); }
   if ([...this.armed.values()].some(row => row.lease === window.lease)) return { cancelled: true };
   await this.requireBroker().call("disarm", { lease: window.lease }); return { cancelled: true };
  }
  await this.requireBroker().call("focus", { lease: window.lease });
  if(action !== "capture")return window;
  const created=await this.capture({ lease: window.lease, projectId, bundleId: request.bundleId, kind: request.kind });
  await this.navigateCapture(window.lease,created.task);
  return created;
 }
 async navigateCapture(lease,task){
  try{const result=await this.navigate(lease,task.publisherUrl);const row=this.armed.get(task.id);if(row)await this.updateAccess(row,result.access);}
  catch(error){if(this.ctx.get("labCapture")?.getTask(task.id)?.status!=="completed"){await this.ctx.get("labCapture")?.transit(task.id,{status:"failed",reasonCode:"navigation-failed",error:error.message});this.armed.delete(task.id);throw error;}}
 }
 async updateAccess(row,access){
  if(!access||row.downloading||row.processing||this.armed.get(row.task.id)!==row)return;
  const capture=this.ctx.get('labCapture');if(capture?.getTask(row.task.id)?.status!=='armed')return;
  row.access=access;row.loading=false;row.accessChecking=false;
  // Article paywalls do not establish permission for separately public SI.
  const blocked=['not-found','page-error'].includes(access.state)||(access.state==='access-denied'&&(row.task.kind==='pdf'||access.evidence==='页面返回 HTTP 403'));
  await capture.transit(row.task.id,{access,...blocked?{status:'failed',reasonCode:access.state,error:access.evidence}:{}});
  if(blocked&&this.armed.get(row.task.id)===row){this.armed.delete(row.task.id);await this.broker?.call('disarm',{lease:row.lease}).catch(()=>{});this.pumpCaptures();}
 }
 enqueueAgentCapture(task){
  this.requireBroker();this.captureQueue.push(task.id);this.pumpCaptures();
 }
 captureStatus(taskId,projectId){
  const row=(taskId&&this.armed.get(taskId))??[...this.armed.values()].find(row=>!projectId||row.task.projectId===projectId);
  if(!row)return null;
  return {state:row.processing?"uploading":row.downloading?"downloading":row.loading?'navigating':row.accessChecking?'checking-access':'waiting-download',access:row.access,accessChecking:Boolean(row.accessChecking),windowOpen:true,pendingTaskId:row.task.id,pageUrl:row.pageUrl??row.task.publisherUrl,pageSeq:row.pageSeq??1,documentType:row.documentType??"",downloadedBytes:row.bytes??0,automationStage:row.downloading?"saving":row.loading?'opening':"manual",observedAt:new Date().toISOString(),stale:false,ageMs:0,ready:false,iwanReady:false};
 }
 async executeBrowserOperation(operation){
  const capture=this.ctx.get("labCapture");
  const claimed=capture.claimBrowserOperation(operation.projectId,operation.id);if(!claimed)return;
  operation={...claimed,projectId:operation.projectId};
  const row=this.armed.get(operation.taskId);
  try{
   if(!row||row.task.projectId!==operation.projectId)throw Error("该任务尚未在科研浏览器打开");
   row.observing=["observe","click"].includes(operation.action);
   let result;
   if(operation.action==="debug")result=await this.state(row.lease);
   else if(operation.action==="navigate"){
    const doi=row.task.publisherUrl.match(/^https:\/\/doi\.org\/(10\.1126\/[a-z0-9._-]+)$/i)?.[1];
    if(!doi||operation.routeId!=="science-pdf")throw Error("备用下载入口不可用");
    result=await this.navigate(row.lease,"https://www.science.org/doi/pdf/"+doi);
   }else result=await this.requireBroker().call(operation.action,{lease:row.lease,scope:operation.scope,observationId:operation.observationId,elementId:operation.elementId});
   if(operation.action==='observe')await this.updateAccess(row,result.pages?.[0]?.access);
   else if(['debug','navigate'].includes(operation.action))await this.updateAccess(row,result.access);
   row.observing=false;
   capture.completeBrowserOperation({id:operation.id,projectId:operation.projectId,result});
  }catch(error){capture.completeBrowserOperation({id:operation.id,projectId:operation.projectId,error:error.message});}
 }
 async cancelOwnedCapture(taskId){
  this.captureQueue=this.captureQueue.filter(id=>id!==taskId);
  const row=this.armed.get(taskId);this.armed.delete(taskId);
  if(row)await this.broker?.call("disarm",{lease:row.lease}).catch(()=>{});
  this.pumpCaptures();
 }
 pumpCaptures(){
  if(!this.active)return;
  const capture=this.ctx.get("labCapture");if(!capture)return;
  this.captureQueue=this.captureQueue.filter(id=>capture.getTask(id)?.status==="armed");
  for(const id of [...this.captureQueue]){
   const task=capture.getTask(id);
   if(this.startingProjects.has(task.projectId)||[...this.armed.values()].some(row=>row.task.projectId===task.projectId))continue;
   this.captureQueue=this.captureQueue.filter(value=>value!==id);this.startingProjects.add(task.projectId);
   const work=(async()=>{
    try{
     const window=await this.windowForProject(task.projectId,{open:true,blank:true});
     if(!this.active)return;
     const claimed=capture.claimAgentCaptureTask(id);this.armed.set(id,{...claimed,lease:window.lease});
     await this.requireBroker().call("arm",{lease:window.lease,captureId:id,kind:task.kind});
     await this.requireBroker().call("focus",{lease:window.lease});
     await this.navigateCapture(window.lease,task);
    }catch(error){this.armed.delete(id);if(capture.getTask(id)?.status==="armed")await capture.transit(id,{status:"failed",reasonCode:"browser-start-failed",error:error.message});}
    finally{this.startingProjects.delete(task.projectId);this.pumpCaptures();}
   })();
   this.ctx.ibmRuntime.track(()=>work).catch(()=>{});
  }
 }
 async artifactAction(request) {
  const { action } = request ?? {};
  if (!["save", "preview", "open", "revealSaved", "saveRis"].includes(action)) throw new Error("Unsupported artifact action");
  if (action === "revealSaved") return await this.requireBroker().call("revealSaved", { savedRef: request.savedRef });
  let file;
  if (action === "saveRis") {
   if (typeof request.text !== "string" || Buffer.byteLength(request.text) > 10 * 1024 * 1024 || !/^[^\x00-\x1f<>:"/\\|?*]{1,180}\.ris$/i.test(request.fileName ?? "")) throw new Error("Invalid RIS export");
   file = { buffer: Buffer.from(request.text), fileName: request.fileName };
  // Match the 0.5.8 Office workflow and the HTTP endpoint: staged files can
  // be opened/downloaded directly. Review is optional, not a migration gate.
  } else file = await resolveDesktopArtifact(this.ctx.ibmCore, request.url);
  if (action === "open" && /\.(docx|pptx)$/i.test(file.fileName)) await inspectOfficePackage(file.buffer, /\.docx$/i.test(file.fileName) ? "docx" : "pptx");
  const broker = this.requireBroker();
  const { fileId } = await broker.call("stage", { base64: file.buffer.toString("base64") });
  try {
   if (["save", "saveRis"].includes(action)) return { ...await broker.call("save", { fileId, name: file.fileName }, 300000), fileName: file.fileName };
   if (action === "preview") return await broker.call("preview", { fileId });
   return await broker.call("artifactOpen", { fileId, name: file.fileName });
  } finally { await broker.call("discard", { fileId }); }
 }
 /** Installer/configuration path only. The decrypted value never crosses a Remote/tool API. */
 async importLegacyCredential() {
  const path = this.config.legacyCredentialFile;
  if (!path) throw new Error("legacy credential import is not configured");
  const python = this.ctx.ibmRuntime.processes.python;
  const command = Array.isArray(python) ? python : [python];
  const script = fileURLToPath(new URL("../scripts/runtime/dpapi_credential.py", import.meta.url));
  const child = this.ctx.ibmRuntime.processes.spawn(command[0], [...command.slice(1), "-I", script, path]);
  const payload = await new Promise((resolve, reject) => {
   let stdout = "";
   child.stdout.on("data", chunk => { stdout += chunk; if (stdout.length > 100000) child.kill(); });
   child.stderr.resume();
   child.once("error", () => reject(new Error("Protected credential import failed")));
   child.once("close", code => { if (code !== 0) reject(new Error("Protected credential import failed")); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Invalid protected credential response")); } } });
  });
  try { return await this.requireBroker().call("storeCredential", { value: payload.value }); }
  finally { payload.value = undefined; }
 }
 async release(lease) {
  for (const [id, row] of this.armed) if (row.lease === lease) { await this.ctx.get("labCapture")?.cancelTask(id, "科研浏览器已关闭"); this.armed.delete(id); }
  this.leases.delete(lease);
  return await this.requireBroker().call("close", { lease });
 }
 async capture({ lease, projectId, bundleId, kind }) {
  await this.state(lease);
  if (this.leases.get(lease) !== projectId) throw new Error("scientific browser lease belongs to another project");
  const capture = this.ctx.get("labCapture");
  if (!capture) throw new RemoteError("feature-unavailable", "Capture service is stopped", { service: "labCapture" });
  for (const [id, row] of this.armed) if (row.lease === lease) {
   await capture.cancelTask(id, "科研窗口重新发起捕获，旧任务作废");
   this.armed.delete(id);
  }
  const created = await capture.createCaptureTask({ projectId, bundleId, kind });
  this.armed.set(created.task.id, { ...created, lease });
  try { await this.requireBroker().call("arm", { lease, captureId: created.task.id, kind }); }
  catch (error) { this.armed.delete(created.task.id); await capture.cancelTask(created.task.id, error.message); throw error; }
  return { task: created.task };
 }
 async onEvent(event) {
  if (!this.active) return;
  if(event.event==="page-loading"){for(const row of this.armed.values())if(row.lease===event.lease){row.loading=true;row.observing=false;row.access=null;row.accessChecking=false;}return;}
  if(event.event==='page-checking-access'){for(const row of this.armed.values())if(row.lease===event.lease&&!row.downloading&&!row.processing){row.loading=false;row.accessChecking=true;}return;}
  if(event.event==="page-state"){for(const row of this.armed.values())if(row.lease===event.lease){Object.assign(row,{loading:false,pageUrl:event.url,pageSeq:event.pageSeq,documentType:event.documentType});await this.updateAccess(row,event.access);}return;}
  if(event.event==="capture-progress"){const row=this.armed.get(event.captureId);if(row&&row.lease===event.lease){row.loading=false;row.observing=false;row.downloading=true;row.bytes=event.bytes;row.totalBytes=event.totalBytes;}return;}
  if (event.event === "lease-closed") {
   const projectId=this.leases.get(event.lease),capture=this.ctx.get("labCapture");
   const queued=this.captureQueue.filter(id=>capture?.getTask(id)?.projectId===projectId);this.captureQueue=this.captureQueue.filter(id=>!queued.includes(id));
   for(const id of queued)await capture.cancelTask(id,"科研浏览器已关闭");
   this.leases.delete(event.lease);
   for (const [id, row] of this.armed) if (row.lease === event.lease&&!row.processing) { await capture?.cancelTask(id, "科研浏览器已关闭"); this.armed.delete(id); }
   return;
  }
  if (event.event === "browser-failed") { this.events.push({ type: event.event });for(const [id,row] of this.armed)if(!event.lease||row.lease===event.lease){this.armed.delete(id);await this.ctx.get("labCapture")?.transit(id,{status:"failed",reasonCode:"browser-closed",error:"科研浏览器已停止，请重新发起下载"}).catch(()=>{});}return; }
  const row = this.armed.get(event.captureId);
  if (!row || row.lease !== event.lease) {if(event.fileId)await this.broker.call("discard",{fileId:event.fileId}).catch(()=>{});return;}
  if(row.processing)return;row.processing=true;
  const capture = this.ctx.get("labCapture");
  if (!capture) { this.armed.delete(event.captureId);if (event.fileId) await this.broker.call("consume", { fileId: event.fileId }); return; }
  let task;
  try {
   if (event.event !== "capture-ready") throw new Error("科研浏览器下载未完成");
   const payload = await this.broker.call("consume", { fileId: event.fileId });
   task = await capture.claimTaskForUpload(row.token);
   const buffer = Buffer.from(payload.base64, "base64");
   const fileName = sanitizeCaptureFileName(event.fileName, task.kind);
   if (!kindMatchesFileName(task.kind, fileName)) throw new Error("下载类型与捕获任务不匹配");
   const integrity = validateCapturedFile({ kind: task.kind, buffer, fileName });
   const bundle = await capture.saveCapturedFile(task, { buffer, fileName });
   const savedName = (task.kind === "pdf" ? bundle.pdfPath : bundle.siPath).split(/[\\/]/).at(-1);
   await capture.transit(task.id, { status: "completed", fileName: savedName, size: integrity.byteLength, fileSha256: integrity.sha256, error: undefined, reasonCode: undefined, archiveConflict: undefined });
   this.events.push({ type: "capture-completed", taskId: task.id });
  } catch (error) {
   await capture.transit(row.task.id, { status: "failed", reasonCode: error.code ?? "download-failed", error: error.message });
   this.events.push({ type: "capture-failed", taskId: row.task.id });
  } finally { this.armed.delete(event.captureId);if (task) capture.releaseTaskClaim(task.id); this.pumpCaptures(); }
 }
}
export default ScientificDesktopService;
