import { createInterface } from "node:readline";
import { createServer, createConnection } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const MAIN = fileURLToPath(new URL("../../electron-next/scientific-main.mjs", import.meta.url));
export class ElectronBroker {
 constructor(processes, config, onEvent = () => {}) { this.processes = processes; this.config = config; this.onEvent = onEvent; this.pending = new Map(); this.sequence = 0; }
 async start() { this.ready ??= this.launch(); return await this.ready; }
 async launch() {
  if(process.env.IBM_SCIENTIFIC_MAIN_ENDPOINT)return await this.connectMain(JSON.parse(process.env.IBM_SCIENTIFIC_MAIN_ENDPOINT));
  const root = resolve(this.config.root);
  await mkdir(root, { recursive: true });
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\ibm-scientific-${randomUUID()}` : join(root, `ipc-${randomUUID()}.sock`);
  const auth = randomBytes(32).toString("hex");
  return await new Promise((resolveReady, rejectReady) => {
   const server = createServer(socket => {
    let authenticated = false;
    const deadline = setTimeout(() => socket.destroy(), 3000);
    createInterface({ input: socket }).on("line", line => {
     let packet;
     try { packet = JSON.parse(line); } catch { socket.destroy(); return; }
     if (!authenticated) {
      if (packet.event !== "ready" || packet.auth !== auth || this.socket) { socket.destroy(); return; }
      authenticated = true; clearTimeout(deadline); clearTimeout(timer); this.socket = socket;
      server.close(); resolveReady({ event: "ready", electron: packet.electron }); return;
     }
     if (packet.event) void Promise.resolve(this.onEvent(packet)).catch(error => { this.lastEventError = error.message; });
     else {
      const row = this.pending.get(packet.id);
      if (!row) return;
      this.pending.delete(packet.id); clearTimeout(row.timer);
      if (packet.error) row.reject(new Error(packet.error)); else row.resolve(packet.result);
     }
    });
    socket.on("error", () => {});
    socket.once("close", () => { clearTimeout(deadline); if (this.socket === socket) this.socket = undefined; });
   });
   const timer = setTimeout(() => { rejectReady(new Error("scientific Electron startup timed out")); server.close(); this.child?.kill(); }, 20000);
   server.once("error", error => { clearTimeout(timer); rejectReady(error); });
   server.listen(pipe, () => {
    this.child = this.processes.spawn(this.config.electron, [MAIN,'--ibm-scientific-desktop'], { env: {
     IBM_SCIENTIFIC_DESKTOP_CONFIG: JSON.stringify({ pipe, auth, userData: join(root, "session"), downloadsRoot: join(root, "downloads"), headless: this.config.headless ?? false, hostOrigins: this.config.hostOrigins ?? [], allowedLocalOrigins: this.config.allowedLocalOrigins ?? [] }),
     ELECTRON_RUN_AS_NODE: undefined
    } });
    let stderr = "";
    this.child.stdout.resume();
    this.child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
    this.child.once("error", error => { clearTimeout(timer); server.close(); rejectReady(error); });
    this.child.once("close", (code, signal) => {
     clearTimeout(timer); server.close(); this.socket?.destroy(); this.ready = undefined;
     const error = new Error(`scientific Electron closed (${code ?? signal}): ${stderr.replace(/https?:\/\/\S+/g, "<url>")}`);
     rejectReady(error);
     for (const row of this.pending.values()) { clearTimeout(row.timer); row.reject(error); }
     this.pending.clear();
     void this.onEvent({event:"browser-failed"});
    });
   });
  });
 }
 async connectMain({pipe,auth}) {
  this.embedded=true;
  return await new Promise((resolveReady,reject)=>{
   const socket=createConnection(pipe);let authenticated=false;
   const timer=setTimeout(()=>{socket.destroy();reject(Error('应用侧栏连接超时'));},10000);
   socket.once('connect',()=>socket.write(JSON.stringify({auth})+'\n'));
   socket.on('error',error=>{clearTimeout(timer);reject(error);});
   createInterface({input:socket}).on('line',line=>{
    let packet;try{packet=JSON.parse(line);}catch{socket.destroy();return;}
    if(!authenticated){if(packet.event!=='ready'){socket.destroy();return;}authenticated=true;clearTimeout(timer);this.socket=socket;resolveReady(packet);return;}
    if(packet.event)void Promise.resolve(this.onEvent(packet)).catch(error=>{this.lastEventError=error.message;});
    else {const row=this.pending.get(packet.id);if(!row)return;this.pending.delete(packet.id);clearTimeout(row.timer);packet.error?row.reject(Error(packet.error)):row.resolve(packet.result);}
   });
   socket.once('close',()=>{clearTimeout(timer);this.socket=undefined;this.ready=undefined;const error=Error('应用侧栏连接已关闭');reject(error);for(const row of this.pending.values()){clearTimeout(row.timer);row.reject(error);}this.pending.clear();});
  });
 }
 async call(method, input, timeoutMs = 30000) {
  await this.start();
  if (!this.socket) throw new Error("scientific Electron transport is closed");
  const id = ++this.sequence;
  return await new Promise((resolveResult, reject) => {
   const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`scientific desktop ${method} timed out`)); }, timeoutMs);
   this.pending.set(id, { resolve: resolveResult, reject, timer });
   this.socket.write(`${JSON.stringify({ id, method, input })}\n`);
  });
 }
 async dispose() {
  this.closing ??= this.close();
  return await this.closing;
 }
 async close() {
  if(this.embedded){this.socket?.destroy();return;}
  if (!this.child) return;
  try { await this.call("stop", {}, 3000); } catch { /* a crashed renderer still belongs to the process guardian */ }
  await this.child.stopOwned();
 }
}
