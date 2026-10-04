/** Real Electron, rc.2 Gateway and formal client adapter; no institutional profile or save dialogs. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";
import { installDesktopClient, nativeArtifact, nativeBrowser, setDesktopProject } from "../../client/src/desktop-client.js";

const arg = name => { const index = process.argv.indexOf(name); assert.ok(index >= 0, `${name} required`); return resolve(process.argv[index + 1]); };
const electron = arg("--electron"), python = arg("--python"), sample = arg("--pdf"), output = arg("--output");
await mkdir(output, { recursive: true });
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = python;
const original = await readFile(sample);
const eof = original.lastIndexOf(Buffer.from("%%EOF")); assert.ok(eof >= 0);
const pdf = Buffer.concat([original.subarray(0, eof), Buffer.alloc(Math.max(0, 12000 - original.length), 32), original.subarray(eof)]);
const server = createServer((req, res) => {
 if (req.url === "/paper.pdf") { res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="client-fixture.pdf"' }); res.end(pdf); }
 else if (req.url === "/download") res.end('<title>fixture-download</title><script>location.href="/paper.pdf"</script>');
 else res.end('<title>isolated-client-fixture</title><a href="/paper.pdf">PDF</a>');
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let handle, uninstall;
const checks = [];
try {
 handle = await bootLite({ storageRoot: join(output, "storage"), coreOnly: true, includePython: false, coreConfig: { projectsRoot: join(output, "projects") }, extraRows: [
  { id: "runtime", name: "dsh-lab-agent/runtime" },
  { id: "documents", name: "dsh-lab-agent/documents" },
  { id: "goals", name: "dsh-lab-agent/goal-profiles" },
  { id: "templates", name: "dsh-lab-agent/ppt-templates" },
  { id: "notes", name: "dsh-lab-agent/note-templates" },
  { id: "workflow", name: "dsh-lab-agent/workflows" },
  { id: "tasks", name: "dsh-lab-agent/tasks" },
  { id: "capture", name: "dsh-lab-agent/manual-capture" },
  { id: "desktop", name: "dsh-lab-agent/scientific-desktop", config: { electron, root: join(output, "desktop"), headless: true, portal: origin, allowedLocalOrigins: [origin] } },
  { id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
  { id: "gateway", name: "@deepseek-ai/dsh-api-gateway" },
  { id: "remote", name: "dsh-lab-agent/remote" }
 ] });
 const { ctx } = handle;
 uninstall = installDesktopClient((method, args) => ctx.typertGateway.invoke({ namespace: "lab", method, args: args?.request ? { request: args.request } : {} }));
 const project = await ctx.ibmCore.createProject({ id: "native-ui-fixture", name: "Electron 界面动作验收" }); setDesktopProject(project.id);
 await ctx.ibmCore.commitSourceBundle({ id: "native-ui-source", projectId: project.id, title: "Isolated fixture", doi: "10.1000/fixture", status: "succeeded", createdAt: "2026-10-04", updatedAt: "2026-10-04" });
 assert.equal((await nativeBrowser("status")).window, null);
 const opened = await nativeBrowser("open"); assert.equal(opened.title, "isolated-client-fixture");
 assert.equal((await nativeBrowser("open")).lease, opened.lease);
 checks.push("formal-client-through-real-gateway-reuses-real-electron-window");
 await assert.rejects(nativeBrowser("navigate", { url: "file:///C:/Windows/win.ini" }), /blocked/);
 checks.push("client-cannot-navigate-research-window-to-local-files");
 const prior = await nativeBrowser("capture", { bundleId: "native-ui-source", kind: "si" });
 const task = await nativeBrowser("capture", { bundleId: "native-ui-source", kind: "pdf" });
 assert.equal(ctx.labCapture.getTask(prior.task.id).status, "cancelled");
 assert.ok(!JSON.stringify(task).includes('"token"'));
 await nativeBrowser("navigate", { url: `${origin}/download` });
 for (let n = 0; n < 150 && ctx.labCapture.getTask(task.task.id).status !== "completed"; n++) await delay(100);
 assert.equal(ctx.labCapture.getTask(task.task.id).status, "completed", ctx.labCapture.getTask(task.task.id).error);
 const file = await ctx.ibmCore.bundleFile("native-ui-source", "pdf"); assert.deepEqual(file.buffer, pdf);
 checks.push("formal-client-capture-replacement-and-download-register-identical-pdf");
 assert.equal((await nativeArtifact("preview", { url: "/api/lab-artifacts?kind=pdf&bundleId=native-ui-source" })).previewOpened, true);
 checks.push("registered-pdf-opens-in-real-isolated-electron-preview");
 await nativeBrowser("close"); await delay(2100);
 assert.equal((await nativeBrowser("status")).window, null);
 checks.push("closed-window-remains-closed-after-status-poll");
 await writeFile(join(output, "verification.json"), JSON.stringify({ phase: "P5", ok: true, checks, scope: "Actual Electron + Gateway + formal client adapter. Does not certify product button rendering, native save dialogs, system Office opening or institutional authentication." }, null, 2) + "\n");
 console.log(JSON.stringify({ ok: true, checks, evidence: join(output, "verification.json") }));
} finally { uninstall?.(); await handle?.dispose(); await new Promise(done => server.close(done)); }
