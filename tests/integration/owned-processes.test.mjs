import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessSupervisor } from "../../src/runtime/process-supervisor.js";
import { resolvePythonExecutable } from "../../src/python-env.js";
import { nativeMcpConfig } from "../../src/runtime/native-applications.js";

async function firstLine(child) {
 let data = "";
 return await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("worker startup timeout")), 10000);
  child.stdout.on("data", chunk => { data += chunk; if (data.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(data.split("\n")[0])); } });
  child.once("error", reject);
 });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function gone(pids) { for (let n = 0; n < 100 && pids.some(alive); n++) await delay(30); assert.ok(pids.every(pid => !alive(pid)), `owned processes survived: ${pids}`); }
const worker = "import subprocess,sys,os,time,json; child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']); print(json.dumps(dict(worker=os.getpid(),grandchild=child.pid)),flush=True);time.sleep(120)";

test("owned scientific processes: stop kills descendants while an unrelated process survives", async () => {
 const python = (await resolvePythonExecutable()).command;
 assert.ok(python);
 const control = spawn(python[0], [...python.slice(1), "-c", "import os,time,json;print(json.dumps(dict(pid=os.getpid())),flush=True);time.sleep(120)"], { windowsHide: true });
 const supervisor = new ProcessSupervisor(python);
 try {
  const unrelated = await firstLine(control);
  const child = supervisor.spawn(python[0], [...python.slice(1), "-c", worker]);
  const pids = await firstLine(child);
  await supervisor.dispose();
  await gone([pids.worker, pids.grandchild]);
  assert.ok(alive(unrelated.pid));
  assert.throws(() => supervisor.spawn(python[0], []), /stopped/);
 } finally { await supervisor.dispose(); control.kill(); }
});

test("owned scientific processes: a crashed Host closes stdin and kills the entire worker tree", async () => {
 const python = (await resolvePythonExecutable()).command;
 const module = new URL("../../src/runtime/process-supervisor.js", import.meta.url).href;
 const owner = spawn(process.execPath, ["--input-type=module", "-e", `import {ProcessSupervisor} from ${JSON.stringify(module)};const p=new ProcessSupervisor(${JSON.stringify(python)});const c=p.spawn(${JSON.stringify(python[0])},${JSON.stringify([...python.slice(1), "-c", worker])});c.stdout.pipe(process.stdout);`], { windowsHide: true });
 try {
  const pids = await firstLine(owner);
  const closed = once(owner, "close"); owner.kill("SIGKILL"); await closed;
  await gone([pids.worker, pids.grandchild]);
 } finally { owner.kill(); }
});

test("native MCP startup is selected exclusively by the frozen application registry", () => {
 assert.throws(() => nativeMcpConfig("arbitrary", { python: process.execPath }), /未知/);
 assert.throws(() => nativeMcpConfig("origin", { python: "python" }), /absolute/);
 assert.throws(() => nativeMcpConfig("origin", { python: process.execPath, toolProfile: "unknown" }), /profile/);
 const config = nativeMcpConfig("origin", { python: process.execPath });
 assert.equal(config.args.at(-1), "origin_mcp");
 assert.equal(config.command, process.execPath);
 assert.equal(config.reconnect.enabled, false);
});
