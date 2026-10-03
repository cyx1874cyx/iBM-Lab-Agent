import { createHash } from "node:crypto";
import { artifactProvenanceSchema, paperSourceBundleSchema, sourceChangedSchema } from "../../src/contracts/index.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { validatePdfBuffer } from "../../src/artifact-integrity.js";

/** Evidence operations accept explicit snapshots; scientific runtimes remain callers. */
export const artifactMethods = {
 onSourceChanged(listener) {
  this.sourceListeners.add(listener);
  return () => this.sourceListeners.delete(listener);
 },
 async commitSourceBundle(next) {
  const row = paperSourceBundleSchema.parse(next);
  const previous = this.table("bundles").get(row.id);
  for (const kind of ["pdf", "si"]) {
   const digest = kind === "pdf" ? "pdfSha256" : "siSha256";
   if (!row[digest] || row[digest] === previous?.[digest]) continue;
   const file = await readFile(kind === "pdf" ? row.pdfPath : row.siPath);
   if (createHash("sha256").update(file).digest("hex") !== row[digest]) throw new Error(`${kind} source commit hash mismatch`);
  }
  await this.table("bundles").put(row.id, row);
  for (const kind of ["pdf", "si"]) {
   const field = kind === "pdf" ? "pdfSha256" : "siSha256";
   if (!row[field] || row[field] === previous?.[field]) continue;
   const event = sourceChangedSchema.parse({ version: 1, projectId: row.projectId, bundleId: row.id, kind, previousSha256: previous?.[field], sha256: row[field] });
   for (const listener of this.sourceListeners) {
    try { await listener(event); } catch (error) { this.ctx.logger.warn(`source change consumer failed: ${error.message}`); }
   }
  }
  return row;
 },
 async bundleFile(bundleId, which) {
  const bundle = this.getArtifact("source-bundle", bundleId);
  if (!bundle) throw new Error(`source bundle '${bundleId}' not found`);
  const path = which === "pdf" ? bundle.pdfPath : which === "si" ? bundle.siPath : undefined;
  if (!path) throw new Error(`source bundle '${bundleId}' has no ${which} file`);
  const buffer = await readFile(path);
  const extension = path.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] || "";
  if (which === "pdf" || extension === "pdf") validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
  if (which === "si" && !["pdf", "docx", "zip"].includes(extension)) throw new Error(`unsupported SI file type: .${extension || "?"}`);
  if (which === "si" && extension !== "pdf" && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error(`${extension.toUpperCase()} SI file is not a valid ZIP/Office container`);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const expected = which === "pdf" ? bundle.pdfSha256 : bundle.siSha256;
  if (expected && sha256 !== expected) throw new Error(`${which} file changed after registration`);
  return { fileName: basename(path), mime: extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/zip", buffer, byteLength: buffer.length, sha256 };
 },
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
