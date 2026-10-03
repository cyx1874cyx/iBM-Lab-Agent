/** User-operated institutional acceptance. Never reads page credentials or cookie values. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";

const arg = name => resolve(process.argv[process.argv.indexOf(name) + 1]);
const output = arg("--output");
await mkdir(output, { recursive: true });
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = arg("--python");
let handle;
try {
 handle = await bootLite({ storageRoot: join(output, "storage"), coreOnly: true, includePython: false,
  coreConfig: { projectsRoot: join(output, "projects") }, extraRows: [
   { id: "runtime", name: "dsh-lab-agent/runtime" },
   { id: "documents", name: "dsh-lab-agent/documents" },
   { id: "goals", name: "dsh-lab-agent/goal-profiles" },
   { id: "templates", name: "dsh-lab-agent/ppt-templates" },
   { id: "notes", name: "dsh-lab-agent/note-templates" },
   { id: "workflow", name: "dsh-lab-agent/workflows" },
   { id: "tasks", name: "dsh-lab-agent/tasks" },
   { id: "capture", name: "dsh-lab-agent/manual-capture" },
   { id: "desktop", name: "dsh-lab-agent/scientific-desktop", config: { electron: arg("--electron"), root: join(output, "desktop"), headless: false } }
  ] });
 const ctx = handle.ctx;
 const project = ctx.ibmCore.getProject("ustc-institution") ?? await ctx.ibmCore.createProject({ id: "ustc-institution", name: "中科大机构验收" });
 const opened = await ctx.ibmScientificDesktop.open({ projectId: project.id });
 console.log("Institutional scientific browser opened. Credentials stay in its isolated session.");
 let stopping = false;
 let requestId;
 process.once("SIGINT", () => { stopping = true; });
 process.once("SIGTERM", () => { stopping = true; });
 while (!stopping) {
  try {
   const state = await ctx.ibmScientificDesktop.state(opened.lease);
   await writeFile(join(output, "session-status.json"), JSON.stringify({ ...state, capture: ctx.ibmScientificDesktop.status(), checkedAt: new Date().toISOString(), credentialsExported: false }, null, 2) + "\n");
   let request;
   try { request = JSON.parse(await readFile(join(output, "request.json"), "utf8")); } catch { /* no acceptance request yet */ }
   if (request && request.id !== requestId) {
    requestId = request.id;
    let result;
    try {
     if (request.method === "links") result = await ctx.ibmScientificDesktop.links(opened.lease);
     else if (request.method === "navigate") result = await ctx.ibmScientificDesktop.navigate(opened.lease, request.url);
     else if (request.method === "capture") {
      const bundleId = `institution-${createHash("sha256").update(request.doi ?? request.url).digest("hex").slice(0, 16)}`;
      if (!ctx.ibmCore.getArtifact("source-bundle", bundleId)) await ctx.ibmCore.commitSourceBundle({ id: bundleId, projectId: project.id, title: "机构捕获验收", doi: request.doi, publisherUrl: request.url, status: "succeeded", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      result = await ctx.ibmScientificDesktop.capture({ lease: opened.lease, projectId: project.id, bundleId, kind: request.kind });
     } else if (request.method === "stop") { stopping = true; result = { stopping: true }; }
     else throw new Error("unknown institutional acceptance request");
    } catch (error) { result = { error: error.message }; }
    await writeFile(join(output, "response.json"), JSON.stringify({ id: requestId, result }, null, 2) + "\n");
   }
  } catch { break; }
  await delay(1000);
 }
} finally { await handle?.dispose(); }
