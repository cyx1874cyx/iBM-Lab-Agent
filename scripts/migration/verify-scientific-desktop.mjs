/** Real Electron plus real rc.2 Cordis/MCP, against isolated fixtures and home. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";
import { nativeMcpConfig } from "../../src/runtime/native-applications.js";
import { ProcessSupervisor } from "../../src/runtime/process-supervisor.js";

function arg(name) { const n = process.argv.indexOf(name); assert.ok(n >= 0, `${name} required`); return resolve(process.argv[n + 1]); }
const electron = arg("--electron"), python = arg("--python"), output = arg("--output");
await mkdir(output, { recursive: true });
const testProcesses = new ProcessSupervisor(python);
try {
 const child = testProcesses.spawn(python, ["-I", resolve("scripts/runtime/dpapi_credential.py"), join(output, "synthetic-legacy.dpapi"), "--self-test"]);
 child.stdout.resume(); child.stderr.resume();
 const [code] = await once(child, "close"); assert.equal(code, 0);
} finally { await testProcesses.dispose(); }
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = python;
const checks = [], native = {};
const pdf = Buffer.from("%PDF-1.4\n/Type /Page\nScientific fixture\n" + " ".repeat(12000) + "\n%%EOF");
const server = createServer((req, res) => {
 const path = new URL(req.url, "http://fixture").pathname;
 if (path === "/login") { res.writeHead(302, { "set-cookie": "institution=fixture; Max-Age=3600; HttpOnly; SameSite=Lax", location: "/check?ticket=private-test-ticket" }); res.end(); }
 else if (path === "/check") { res.end(`<title>${req.headers.cookie?.includes("institution=fixture") ? "session-authorized" : "session-empty"}</title>`); }
 else if (path === "/popup") { res.end('<title>popup-parent</title><form id="sso" action="/sso" target="institution-sso" method="POST"><input name="assertion" value="fixture"></form><script>window.open("about:blank","institution-sso");document.getElementById("sso").submit()</script>'); }
 else if (path === "/sso") { assert.equal(req.method, "POST"); res.end("<title>sso-post-received</title>"); }
 else if (path === "/paper.pdf") { res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="fixture.pdf"' }); res.end(pdf); }
 else if (path === "/download") { res.end('<title>download</title><script>location.href="/paper.pdf"</script>'); }
 else if (path === "/popup-download") { res.end('<title>popup-download</title><script>window.open("/paper.pdf", "paper-download")</script>'); }
 else { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const fixture = `http://127.0.0.1:${server.address().port}`;
const desktopRoot = join(output, "desktop");
function options() {
 return { storageRoot: join(output, "storage"), coreOnly: true, includePython: false,
  coreConfig: { projectsRoot: join(output, "projects") }, extraRows: [
   { id: "runtime", name: "dsh-lab-agent/runtime" },
   { id: "documents", name: "dsh-lab-agent/documents" },
   { id: "goals", name: "dsh-lab-agent/goal-profiles" },
   { id: "templates", name: "dsh-lab-agent/ppt-templates" },
   { id: "notes", name: "dsh-lab-agent/note-templates" },
   { id: "workflow", name: "dsh-lab-agent/workflows" },
   { id: "tasks", name: "dsh-lab-agent/tasks" },
   { id: "capture", name: "dsh-lab-agent/manual-capture" },
   { id: "desktop", name: "dsh-lab-agent/scientific-desktop", config: { electron, root: desktopRoot, headless: true, allowedLocalOrigins: [fixture], hostOrigins: ["http://127.0.0.1:1"], legacyCredentialFile: join(output, "synthetic-legacy.dpapi") } },
   { id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
   { id: "tools", name: "@deepseek-ai/dsh-tools" },
   ...["origin", "mnova"].map(key => ({ id: `native-${key}`, name: "@deepseek-ai/dsh-mcp-client", config: nativeMcpConfig(key, { python, workspaceRoot: output }) }))
  ] };
}
let handle;
try {
 handle = await bootLite(options());
 let ctx = handle.ctx, desktop = ctx.ibmScientificDesktop;
 const project = await ctx.ibmCore.createProject({ id: "p4-fixture", name: "科研桌面验收" });
 const lease = await desktop.open({ projectId: project.id, url: `${fixture}/login` });
 assert.equal(lease.title, "session-authorized"); assert.ok(!JSON.stringify(lease).includes("private-test-ticket"));
 checks.push("real-electron-isolated-persistent-session-and-url-redaction");
 await assert.rejects(desktop.navigate(lease.lease, "http://127.0.0.1:1/?token=private-host-token"), /blocked/);
 await assert.rejects(desktop.navigate(lease.lease, "file:///C:/Windows/win.ini"), /blocked/);
 checks.push("research-pages-denied-host-and-file-destinations");
 await desktop.navigate(lease.lease, `${fixture}/popup`);
 await delay(500);
 assert.equal((await desktop.state(lease.lease)).popups, 1);
 checks.push("sso-popup-with-post-body-shares-only-research-session");
 await ctx.ibmCore.commitSourceBundle({ id: "p4-source", projectId: project.id, title: "Fixture", doi: "10.1000/fixture", status: "succeeded", createdAt: "2026-10-03", updatedAt: "2026-10-03" });
 const replaced = await desktop.capture({ lease: lease.lease, projectId: project.id, bundleId: "p4-source", kind: "si" });
 const capture = await desktop.capture({ lease: lease.lease, projectId: project.id, bundleId: "p4-source", kind: "pdf" });
 assert.equal(ctx.labCapture.getTask(replaced.task.id).status, "cancelled");
 assert.equal(desktop.status().armed, 1);
 checks.push("new-window-capture-cancels-previous-kind-and-clears-owned-token");
 assert.ok(!JSON.stringify(capture).includes('"token"'));
 await desktop.navigate(lease.lease, `${fixture}/popup-download`);
 for (let n = 0; n < 100 && ctx.labCapture.getTask(capture.task.id).status !== "completed"; n++) await delay(100);
 assert.equal(ctx.labCapture.getTask(capture.task.id).status, "completed", ctx.labCapture.getTask(capture.task.id).error);
 const artifact = ctx.ibmCore.getArtifact("source-bundle", "p4-source");
 assert.deepEqual(await readFile(artifact.pdfPath), pdf);
 checks.push("electron-download-through-one-use-capture-and-core-hash-registration");
 for (let n = 0; n < 30 && (await desktop.state(lease.lease)).popups !== 1; n++) await delay(100);
 assert.equal((await desktop.state(lease.lease)).popups, 1);
 checks.push("download-only-blank-popup-closes-without-closing-institution-popup");
 const publicLinks = await desktop.links(lease.lease);
 assert.ok(publicLinks.length >= 1);
 const names = ctx.tools.schemas().map(row => row.name);
 for (const app of ["origin", "mnova"]) {
  const appTools = names.filter(name => name.startsWith(`mcp__${app}__`));
  assert.ok(appTools.length > 0, `${app} MCP tools not registered`);
  native[app] = { tools: appTools.length };
 }
 const status = await ctx.tools.get("mcp__mnova__mnova_status").execute({}, { signal: new AbortController().signal });
 native.mnova.status = status;
 checks.push("official-rc2-mcp-client-discovers-fixed-origin-and-mnova-workers");
 const credential = await desktop.broker.call("credentialStatus", {});
 assert.equal(credential.available, true);
 await desktop.broker.call("storeCredential", { value: "synthetic-p4-key-for-encryption-test" });
 const sealed = await readFile(join(desktopRoot, "session/scientific-credential.bin"));
 assert.ok(!sealed.includes(Buffer.from("synthetic-p4-key-for-encryption-test")));
 checks.push("os-key-encryption-with-no-plaintext-artifact");
 await desktop.importLegacyCredential();
 const imported = await readFile(join(desktopRoot, "session/scientific-credential.bin"));
 assert.ok(!imported.includes(Buffer.from("synthetic-p4-credential-验收")));
 checks.push("legacy-dpapi-import-resealed-without-remote-secret-return");
 await handle.dispose(); handle = undefined;
 handle = await bootLite(options()); ctx = handle.ctx; desktop = ctx.ibmScientificDesktop;
 const restored = await desktop.open({ projectId: project.id, url: `${fixture}/check` });
 assert.equal(restored.title, "session-authorized");
 assert.equal(ctx.ibmCore.getArtifact("source-bundle", "p4-source").pdfSha256, artifact.pdfSha256);
 checks.push("persistent-institution-session-and-artifacts-survive-provider-restart");
 const unarmed = await desktop.capture({ lease: restored.lease, projectId: project.id, bundleId: "p4-source", kind: "si" });
 await desktop.release(restored.lease);
 assert.equal(ctx.labCapture.getTask(unarmed.task.id).status, "cancelled");
 checks.push("lease-release-cancels-pending-capture");
 // Actual portal reachability only: authentication remains a user action.
 try {
  const portal = await desktop.open({ projectId: project.id });
  native.institutionPortal = { reachable: true, ...portal, authenticated: false };
  await desktop.release(portal.lease);
 } catch (error) { native.institutionPortal = { reachable: false, authenticated: false, error: error.message }; }
 const report = { phase: "P4", ok: true, checks, native, scope: "Isolated real Electron fixtures, MCP discovery/status and OS encryption; institutional authentication and licensed scientific workflows require separate acceptance." };
 await writeFile(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
 console.log(JSON.stringify({ ok: true, checks, evidence: join(output, "verification.json") }));
} catch (error) { console.error("Scientific desktop verification failed:", error); throw error; }
finally { await handle?.dispose(); await new Promise(resolveClose => server.close(resolveClose)); }
