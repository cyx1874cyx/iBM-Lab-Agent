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
  this.active = true; this.armed = new Map(); this.leases = new Map(); this.events = [];
  const electron = this.config.electron ?? process.env.IBM_LAB_AGENT_BUNDLED_ELECTRON;
  if (electron) this.broker = new ElectronBroker(this.ctx.ibmRuntime.processes, {
   electron, root: this.config.root ?? join(this.ctx.ibmCore.projectsRoot, "..", "scientific-desktop"),
   headless: this.config.headless, hostOrigins: this.config.hostOrigins ?? [], allowedLocalOrigins: this.config.allowedLocalOrigins ?? []
  }, event => this.onEvent(event));
  const releaseResource = this.ctx.ibmRuntime.ownResource(() => this.broker?.dispose());
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
 async open({ projectId, url }) {
  const project = this.ctx.ibmCore.requireProject(projectId);
  const result = await this.requireBroker().call("open", { workspace: project.id, url: url ?? this.status().portal });
  this.leases.set(result.lease, project.id);
  return result;
 }
 async state(lease) { return await this.requireBroker().call("state", { lease }); }
 async links(lease) { return await this.requireBroker().call("links", { lease }); }
 async navigate(lease, url) { return await this.requireBroker().call("navigate", { lease, url }); }
 async windowForProject(projectId, { open = false, url } = {}) {
  this.ctx.ibmCore.requireProject(projectId);
  for (const [lease, owner] of this.leases) if (owner === projectId) {
   try { return await this.state(lease); } catch (error) { if (!/scientific browser lease is closed/.test(error.message)) throw error; this.leases.delete(lease); }
  }
  return open ? await this.open({ projectId, url }) : null;
 }
 async browserAction(request) {
  const { action, projectId } = request ?? {};
  if (!["status", "open", "close", "navigate", "capture", "cancel"].includes(action)) throw new Error("Unsupported scientific browser action");
  const window = await this.windowForProject(projectId, { open: action === "open" || action === "capture", url: action === "open" ? request.url : undefined });
  if (action === "status") return { ...this.status(), window };
  if (action === "close") return window ? await this.release(window.lease) : { closed: true };
  if (!window) throw new Error("请先打开科研浏览器");
  if (action === "navigate") return await this.navigate(window.lease, request.url);
  if (action === "cancel") {
   for (const [id, row] of this.armed) if (row.lease === window.lease && (!request.taskId || request.taskId === id)) { await this.ctx.get("labCapture")?.cancelTask(id, "用户取消捕获"); this.armed.delete(id); }
   if ([...this.armed.values()].some(row => row.lease === window.lease)) return { cancelled: true };
   await this.requireBroker().call("disarm", { lease: window.lease }); return { cancelled: true };
  }
  await this.requireBroker().call("focus", { lease: window.lease });
  return action === "capture" ? await this.capture({ lease: window.lease, projectId, bundleId: request.bundleId, kind: request.kind }) : window;
 }
 async artifactAction(request) {
  const { action } = request ?? {};
  if (!["save", "preview", "open", "revealSaved", "saveRis"].includes(action)) throw new Error("Unsupported artifact action");
  if (action === "revealSaved") return await this.requireBroker().call("revealSaved", { savedRef: request.savedRef });
  let file;
  if (action === "saveRis") {
   if (typeof request.text !== "string" || Buffer.byteLength(request.text) > 10 * 1024 * 1024 || !/^[^\x00-\x1f<>:"/\\|?*]{1,180}\.ris$/i.test(request.fileName ?? "")) throw new Error("Invalid RIS export");
   file = { buffer: Buffer.from(request.text), fileName: request.fileName };
  } else file = await resolveDesktopArtifact(this.ctx.ibmCore, request.url, { requireApproved: action !== "preview" });
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
  if (event.event === "lease-closed") {
   this.leases.delete(event.lease);
   for (const [id, row] of this.armed) if (row.lease === event.lease) { await this.ctx.get("labCapture")?.cancelTask(id, "科研浏览器已关闭"); this.armed.delete(id); }
   return;
  }
  if (event.event === "browser-failed") { this.events.push({ type: event.event }); return; }
  const row = this.armed.get(event.captureId);
  if (!row || row.lease !== event.lease) return;
  this.armed.delete(event.captureId);
  const capture = this.ctx.get("labCapture");
  if (!capture) { if (event.fileId) await this.broker.call("consume", { fileId: event.fileId }); return; }
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
  } finally { if (task) capture.releaseTaskClaim(task.id); }
 }
}
export default ScientificDesktopService;
