import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootLite } from "../helpers/boot-lite.mjs";
import { labTasksDomainSpec } from "../../lib/core/index.js";

const remoteRows = [
 { id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
 { id: "api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
 { id: "lab-remote", name: "dsh-lab-agent/remote", inject: ["ibmCore"] }
];

test("core alone: historical Remote projects/memory/bindings persist, missing features report a stable error", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-core-p2-"));
 const options = { storageRoot: join(dir, "storage"), coreOnly: true, includePython: false, extraRows: remoteRows };
 let handle;
 try {
  handle = await bootLite(options);
  const { ctx } = handle;
  for (const name of ["labTasks", "labGoals", "labTemplates", "labLiterature", "labSynthesis", "labNmr", "labPython", "labConvert"]) assert.equal(ctx.get(name), undefined, name);
  const invoke = (method, request) => ctx.typertGateway.invoke({ namespace: "lab", method, args: request === undefined ? {} : { request } });
  const { project } = await invoke("projects_create", { fields: { id: "core-only", name: "独立 core 课题" } });
  assert.equal(project.goalProfile, undefined);
  assert.ok(existsSync(project.workspacePath));
  await invoke("projects_memory_update", { fields: { projectId: project.id, markdown: "# 核心记忆 v2" } });
  await invoke("projects_bind_session", { projectId: project.id, sessionId: "session-p2", workspaceId: "workspace-p2" });
  await assert.rejects(invoke("goals_list"), error => error.code === "feature-unavailable" && error.details.service === "labGoals");
  await assert.rejects(invoke("projects_create", { fields: { id: "profiles-required", name: "未启用模板", goalProfileId: "default-prodrug-polymer" } }), error => error.code === "feature-unavailable");
  assert.equal(ctx.ibmCore.getProject("profiles-required"), undefined);
  await assert.rejects(ctx.storageDomain.open(labTasksDomainSpec), /already|open/i);
  const repositories = ctx.ibmCore.repositories;
  const documents = repositories.scope("documents");
  assert.equal(documents.projects, undefined);
  assert.equal(repositories.scope("history").reports.put, undefined);
  await assert.rejects(ctx.ibmCore.createProject({ id: "../escape", name: "invalid" }));
  assert.equal(existsSync(join(dir, "storage", "escape")), false);
  const oldProjects = repositories.table("projects");
  await handle.dispose(); handle = undefined;
  assert.throws(() => oldProjects.get(project.id), /disposed/);
  handle = await bootLite(options);
  assert.equal(handle.ctx.ibmCore.getProjectMemory(project.id).version, "2");
  assert.equal(handle.ctx.ibmCore.listProjectMemoryVersions(project.id).length, 2);
  assert.equal(handle.ctx.ibmCore.getProjectBySession("session-p2").project.id, project.id);
  assert.match(await readFile(join(project.workspacePath, "项目记忆.md"), "utf8"), /核心记忆 v2/);
  await handle.ctx.ibmCore.deleteProject(project.id);
  assert.equal(existsSync(project.workspacePath), false);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("core restart migrates legacy session rows without losing existing bindings or scientific snapshots", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-core-legacy-"));
 const options = { storageRoot: join(dir, "storage"), coreOnly: true, includePython: false };
 let handle;
 try {
  handle = await bootLite(options);
  const refs = { id: "frozen-profile", version: "7", snapshot: { historical: true } };
  await handle.ctx.ibmCore.createProject({ id: "legacy", name: "历史课题", goalProfile: refs, template: refs });
  await handle.ctx.ibmCore.table("sessions").put("legacy", { projectId: "legacy", workspaceId: "legacy-workspace", sessionId: "legacy-session", sessionIds: ["new-session"], createdAt: "2025-01-01" });
  const provenance = await handle.ctx.ibmCore.recordProvenance({ projectId: "legacy", kind: "reading-report", runId: "report-old", inputs: { paper: "old.pdf" }, source: "historical" });
  await handle.dispose(); handle = undefined;
  handle = await bootLite(options);
  assert.deepEqual(handle.ctx.ibmCore.getProjectSession("legacy").sessionIds, ["new-session", "legacy-session"]);
  assert.deepEqual(handle.ctx.ibmCore.getProject("legacy").goalProfile, refs);
  assert.deepEqual(handle.ctx.ibmCore.listProvenance("legacy"), [JSON.parse(JSON.stringify(provenance))]);
  const approved = { review: { status: "approved", artifactSha256: "a".repeat(64) } };
  handle.ctx.ibmCore.assertApprovedArtifact(approved, "report", "a".repeat(64));
  assert.throws(() => handle.ctx.ibmCore.assertApprovedArtifact(approved, "report", "b".repeat(64)), /changed after review/);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("compatibility facade shares the core owner; old projects and approved history remain readable with workflows removed", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-core-facade-"));
 const storageRoot = join(dir, "storage");
 let handle;
 try {
  handle = await bootLite({ storageRoot, includePython: false, extraRows: [
   { id: "lab-goals", name: "dsh-lab-agent/goal-profiles" },
   { id: "lab-notes", name: "dsh-lab-agent/note-templates" },
   { id: "lab-templates", name: "dsh-lab-agent/ppt-templates", config: { templatesDir: join(dir, "templates") } },
   { id: "lab-tasks", name: "dsh-lab-agent/tasks", config: { projectsRoot: join(dir, "projects") } }
  ] });
  const { ctx } = handle;
  const project = await ctx.labTasks.createProject({ id: "compat", name: "兼容课题", goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1", templateId: "nature-default", templateVersion: "1" });
  assert.deepEqual(ctx.ibmCore.getProject("compat"), project);
  assert.equal(ctx.labTasks.table("reports"), ctx.ibmCore.table("reports"));
  await assert.rejects(ctx.storageDomain.open(labTasksDomainSpec), /already|open/i);
  const hash = "a".repeat(64);
  await ctx.labTasks.table("reports").put("report-history", {
   id: "report-history", projectId: "compat", bundleId: "bundle-history", goalSnapshot: { old: true }, paperCardRequirements: {},
   artifactSha256: hash, review: { status: "approved", artifactSha256: hash, reviewer: "human-ui" }, status: "succeeded", createdAt: project.createdAt, updatedAt: project.updatedAt
  });
  await ctx.labTasks.updateProjectMemory({ projectId: "compat", markdown: "# facade → core" });
  const cachedTable = ctx.labTasks.table("reports");
  await handle.dispose(); handle = undefined;
  assert.throws(() => cachedTable.get("report-history"), /disposed/);
  handle = await bootLite({ storageRoot, coreOnly: true, includePython: false, coreConfig: { projectsRoot: join(dir, "projects") } });
  assert.equal(handle.ctx.get("labTasks"), undefined);
  assert.deepEqual(handle.ctx.ibmCore.getProject("compat").goalProfile, JSON.parse(JSON.stringify(project.goalProfile)));
  const row = handle.ctx.ibmCore.getArtifact("reading-report", "report-history");
  assert.deepEqual(handle.ctx.ibmCore.readHistory("compat").reports, [row]);
  assert.equal(row.review.status, "approved");
  handle.ctx.ibmCore.assertApprovedArtifact(row, "history", hash);
  assert.equal(handle.ctx.ibmCore.getProjectMemory("compat").version, "2");
  const result = await handle.ctx.ibmCore.deleteProject("compat");
  assert.equal(result.deleted.reports, 1);
 } finally { await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
