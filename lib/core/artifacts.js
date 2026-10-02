import { createHash } from "node:crypto";
import { artifactProvenanceSchema } from "../../src/contracts/index.js";

/** Evidence operations accept explicit snapshots; scientific runtimes remain callers. */
export const artifactMethods = {
 async recordProvenance({ projectId, kind, runId, recordId, inputs, skillVersions = [], model, source, replaced }) {
  const id = recordId ?? `${kind}-${runId}`;
  const record = artifactProvenanceSchema.parse({
   id, projectId, kind, runId,
   inputsSha256: createHash("sha256").update(JSON.stringify(inputs ?? {})).digest("hex"),
   skillVersions, model, source: source ?? "labTasks",
   ...(replaced ? { replaced } : {}), createdAt: new Date().toISOString()
  });
  await this.table("provenance").put(id, record);
  return record;
 },
 listProvenance(projectId) {
  return [...this.table("provenance").keys()].map(key => this.table("provenance").get(key))
   .filter(row => row.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
 },
 getArtifact(kind, id) {
  const table = { "source-bundle": "bundles", "reading-report": "reports", presentation: "presentations" }[kind];
  if (!table) throw new Error(`unknown artifact kind '${kind}'`);
  return this.table(table).get(id);
 },
 readHistory(projectId) {
  this.requireProject(projectId);
  return Object.fromEntries(Object.entries(this.repositories.scope("history")).map(([name, table]) =>
   [name, [...table.keys()].map(key => table.get(key)).filter(row => name === "projects" ? row.id === projectId : row.projectId === projectId)]));
 },
 assertApprovedArtifact(row, label, sha256) {
  if (row.review?.status !== "approved") throw new Error(`${label} is awaiting human review; preview it and approve before download`);
  if (!row.review?.artifactSha256 || row.review.artifactSha256 !== sha256) {
   throw new Error(`${label} changed after review; preview and approve the current version again`);
  }
 }
};
