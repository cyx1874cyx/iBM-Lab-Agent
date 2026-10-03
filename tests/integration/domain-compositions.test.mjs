import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

const catalog = JSON.parse(await readFile(join(repoRoot, "bundles/catalog.json"), "utf8"));
const toolNames = ["memory-tool", "runtime-tool", "templates-tool", "convert-tool", "tasks-tool", "ppt-build-tool", "synthesis-tool", "characterization-tool"];
const toolInject = new Map(await Promise.all(toolNames.map(async name => [name, (await import(`../../lib/${name}.js`)).inject])));
function options(dir, selected) {
 const names = new Set(["core"]);
 const add = name => { for (const dependency of catalog.domains[name].requires) add(dependency); names.add(name); };
 selected.forEach(add);
 const rows = composeEntries([...names].map(name => loadOverlayPatches("matrix", join(repoRoot, `bundles/${name}.patch.yml`))));
 const extraRows = rows.filter(row => row.id !== "ibm-core").map(row => ({ ...row, config: { ...row.config,
  projectsRoot: join(dir, "projects"), templatesDir: join(dir, "templates"), convertedDir: join(dir, "converted"),
  sessionsDir: join(dir, "sessions"), downloadsDir: join(dir, "downloads"), venvDir: join(dir, "venv"),
  skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), vendorDir: join(repoRoot, "vendor/nature-skills"), lockFile: join(repoRoot, "vendor.lock.json")
 } }));
 extraRows.unshift({ id: "typert", name: "@deepseek-ai/dsh-typert-registry" }, { id: "api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
  { id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" }, { id: "tools", name: "@deepseek-ai/dsh-tools" });
 for (const tool of toolNames) extraRows.push({ id: tool, name: `dsh-lab-agent/${tool}`, inject: toolInject.get(tool) });
 return { storageRoot: join(dir, "storage"), coreOnly: true, includePython: false, coreConfig: { projectsRoot: join(dir, "projects") }, extraRows };
}
const invoke = (ctx, namespace, method, request) => ctx.typertGateway.invoke({ namespace, method, args: request === undefined ? {} : { request } });

test("optional workspace remains usable with core alone and provider recovery preserves memory", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-p5-workspace-"));
 let handle;
 try {
  for (const selected of [[], ["design"], ["analysis"], ["literature"], ["literature", "design", "analysis"], []]) {
   handle = await bootLite(options(dir, selected));
   if (!handle.ctx.ibmCore.getProject("p5-core")) await handle.ctx.ibmCore.createProject({ id: "p5-core", name: "可选课题", coreMarkdown: "# 保留核心记忆" });
   const features = await invoke(handle.ctx, "lab", "capabilities");
   const workspace = await invoke(handle.ctx, "lab", "projects_workspace", { projectId: "p5-core" });
   assert.deepEqual(workspace.capabilities, features);
   assert.equal(features.design, selected.includes("design"));
   assert.equal(features.analysis, selected.includes("analysis"));
   assert.equal(features.literature, selected.includes("literature"));
   assert.equal(workspace.project.name, "可选课题");
   assert.equal(workspace.memory.markdown, "# 保留核心记忆");
   await handle.dispose(); handle = undefined;
  }
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("real compositions: design and analysis independently start without literature/documents and expose only available tools", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-p3-matrix-"));
 let handle;
 try {
  handle = await bootLite(options(dir, ["design"]));
  assert.ok(handle.ctx.get("ibmDesign"));
  for (const name of ["ibmLiteratureWorkflows", "ibmDocuments", "ibmAnalysis"]) assert.equal(handle.ctx.get(name), undefined);
  const project = await handle.ctx.ibmCore.createProject({ id: "matrix", name: "独立设计" });
  const result = await invoke(handle.ctx, "labDesign", "synth_target_create", { fields: { id: "target-matrix", projectId: project.id, name: "目标" } });
  assert.equal(result.target.id, "target-matrix");
  const tools = handle.ctx.tools.schemas().map(row => row.name);
  assert.ok(tools.includes("lab_project_memory_read"));
  assert.ok(tools.includes("lab_synth_target_list"));
  assert.ok(!tools.includes("lab_convert_document"));
  assert.ok(!tools.includes("lab_tasks_register_report"));
  const cachedExecutor = handle.ctx.ibmRuntime.createExecutor({ skillsRoot: join(repoRoot, "vendor/nature-skills/skills") });
  await handle.dispose(); handle = undefined;
  assert.throws(() => cachedExecutor.search("stopped"), error => error.code === "feature-unavailable");
  handle = await bootLite(options(dir, ["analysis"]));
  assert.equal(handle.ctx.get("ibmDesign"), undefined);
  assert.equal(handle.ctx.get("ibmLiteratureWorkflows"), undefined);
  assert.ok(handle.ctx.get("ibmAnalysis"));
  assert.equal(handle.ctx.ibmCore.getProject(project.id).name, project.name);
  assert.deepEqual((await invoke(handle.ctx, "labAnalysis", "characterization_list", { projectId: project.id })).tasks, []);
  assert.ok(!handle.ctx.tools.schemas().some(row => row.name === "lab_synth_target_list"));
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("real literature composition: scoped workflows and explicit document processing work without design/analysis", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-p3-literature-"));
 let handle;
 try {
  handle = await bootLite(options(dir, ["literature"]));
  assert.ok(handle.ctx.get("ibmLiteratureWorkflows"));
  assert.equal(handle.ctx.get("ibmDesign"), undefined);
  assert.equal(handle.ctx.get("ibmAnalysis"), undefined);
  assert.equal(handle.ctx.ibmLiteratureWorkflows.tables.projects, undefined);
  assert.ok(handle.ctx.tools.schemas().some(row => row.name === "lab_tasks_register_search"));
  assert.ok(!handle.ctx.tools.schemas().some(row => row.name === "lab_publisher_browser_download"));
  const goals = await invoke(handle.ctx, "labLiteratureWorkflows", "goals_list");
  assert.ok(goals.goals.length > 0);
  const templates = await invoke(handle.ctx, "labDocuments", "note_templates_list", {});
  assert.ok(templates.templates.length > 0);
  const { project } = await invoke(handle.ctx, "lab", "projects_create", { fields: { id: "paper-project", name: "独立文献", goalProfileId: "default-prodrug-polymer", templateId: "nature-default" } });
  const card = join(project.workspacePath, "card.md"); await writeFile(card, "# Explicit document\n文档处理仅接收输入快照。");
  const output = await handle.ctx.ibmDocuments.renderReadingDocx({ report: { id: "explicit", paperCardPath: card, titleZh: "显式文档" }, bundle: { title: "Explicit paper" }, workspacePath: project.workspacePath });
  assert.equal(output.buffer.subarray(0, 2).toString(), "PK");
  assert.match(output.integrity.sha256, /^[0-9a-f]{64}$/);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("source changes notify design after persistence and reconcile missed changes on restart; reads reject tampering", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-p3-source-"));
 let handle;
 try {
  handle = await bootLite(options(dir, ["design"]));
  const { ctx } = handle;
  await ctx.ibmCore.createProject({ id: "source-project", name: "证据通知" });
  const path = join(dir, "source.pdf");
  const first = Buffer.from("%PDF-1.4\n/Type /Page\nfirst\n%%EOF");
  const second = Buffer.from("%PDF-1.4\n/Type /Page\nsecond\n%%EOF");
  const hash = buffer => createHash("sha256").update(buffer).digest("hex");
  await writeFile(path, first);
  const source = { id: "source-bundle", projectId: "source-project", title: "Source", pdfPath: path, pdfSha256: hash(first), status: "succeeded", createdAt: "2026-10-03", updatedAt: "2026-10-03" };
  await ctx.ibmCore.commitSourceBundle(source);
  await ctx.labSynthesis.createTarget({ id: "target-source", name: "Source" });
  await ctx.labSynthesis.createRoute({ id: "route-source", projectId: "source-project", targetId: "target-source", name: "Route" });
  await ctx.labSynthesis.addRouteStep("route-source", { step: 1, reaction: "反应", reactants: ["A"], products: ["B"] });
  const evidence = await ctx.labSynthesis.addStepEvidence({ routeId: "route-source", stepId: "s1", supportsField: "procedure.temperature", sourceType: "paper-main", sourceTier: 1, sourceName: "PDF", bundleId: source.id, page: "1", excerpt: "70 C", extractionMethod: "text", confidence: "high" });
  await ctx.labSynthesis.registerEvidenceShotVerification(evidence.id, { status: "ready", sourceDigest: hash(first).slice(0, 16) });
  assert.equal(ctx.ibmCore.sourceListeners.size, 1);
  await writeFile(path, second);
  let notified = false;
  const unsubscribe = ctx.ibmCore.onSourceChanged(event => { assert.equal(ctx.ibmCore.getArtifact("source-bundle", event.bundleId).pdfSha256, event.sha256); notified = true; });
  await assert.rejects(ctx.ibmCore.commitSourceBundle({ ...source, pdfSha256: "a".repeat(64) }), /hash mismatch/);
  assert.equal(notified, false);
  await ctx.ibmCore.commitSourceBundle({ ...source, pdfSha256: hash(second) });
  assert.equal(notified, true); unsubscribe();
  assert.equal(ctx.labSynthesis.evidenceById(evidence.id).shotVerification.status, "stale");
  await ctx.labSynthesis.registerEvidenceShotVerification(evidence.id, { status: "ready", sourceDigest: hash(second).slice(0, 16) });
  await handle.dispose(); handle = undefined;
  handle = await bootLite(options(dir, []));
  assert.equal(handle.ctx.get("labSynthesis"), undefined);
  assert.equal(handle.ctx.ibmCore.sourceListeners.size, 0);
  await writeFile(path, first);
  await handle.ctx.ibmCore.commitSourceBundle(source);
  await handle.dispose(); handle = undefined;
  handle = await bootLite(options(dir, ["design"]));
  assert.equal(handle.ctx.labSynthesis.evidenceById(evidence.id).shotVerification.status, "stale");
  await writeFile(path, second);
  await assert.rejects(handle.ctx.ibmCore.bundleFile(source.id, "pdf"), /changed after registration/);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
