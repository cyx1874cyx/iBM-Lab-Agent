/** Private Electron sidecar. Research pages have no preload or host transport. */
import { app, BrowserWindow, session, dialog, shell, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

import { createScientificRuntime } from './scientific-runtime.mjs';
const config=JSON.parse(process.env.IBM_SCIENTIFIC_DESKTOP_CONFIG??'{}');
if(!config.userData||!config.downloadsRoot)throw Error('scientific desktop requires isolated absolute roots');
app.setPath('userData',config.userData);app.disableHardwareAcceleration();
let transport;
const emit=packet=>transport?.write(JSON.stringify(packet)+'\n');
const {dispatch}=createScientificRuntime(config,emit);
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
