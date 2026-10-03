/** Native 1D processing acceptance. Input must retain explicit synthetic provenance. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";
import { nativeMcpConfig } from "../../src/runtime/native-applications.js";
const arg = name => { const n = process.argv.indexOf(name); assert.ok(n >= 0); return resolve(process.argv[n + 1]); };
const python = arg("--python"), output = arg("--output");
const input = join(output, "synthetic/synthetic_1d.fid");
await mkdir(output, { recursive: true });
const preflight = JSON.parse(await readFile(join(output, "preflight.json"), "utf8"));
assert.equal(preflight.ok, true); assert.equal(preflight.selected.python_version, "3.12.11");
assert.equal(resolve(preflight.selected.python), python); assert.equal(preflight.path_accessible_to_mnova, true);
const provenance = JSON.parse(await readFile(join(output, "synthetic/simulation_metadata.json"), "utf8"));
assert.equal(provenance.synthetic, true); assert.equal(provenance.varian_readback_max_abs_error, 0);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const rawHash = hash(await readFile(join(input, "fid")));
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = python;
let handle;
const checks = [], report = { phase: "P4", application: "MestReNova", synthetic: true, ok: false, checks };
try {
 handle = await bootLite({ storageRoot: join(output, "storage"), coreOnly: true, includePython: false,
  coreConfig: { projectsRoot: join(output, "projects") }, extraRows: [
   { id: "runtime", name: "dsh-lab-agent/runtime" },
   { id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
   { id: "tools", name: "@deepseek-ai/dsh-tools" },
   { id: "mnova", name: "@deepseek-ai/dsh-mcp-client", config: nativeMcpConfig("mnova", { python, workspaceRoot: output }) }
  ] });
 const call = async (name, args) => {
  const result = await handle.ctx.tools.get(`mcp__mnova__${name}`).execute(args, { signal: new AbortController().signal });
  assert.ok(!result.isError, result.content?.find(row => row.type === "text")?.text);
  return result.structuredContent ?? JSON.parse(result.content.find(row => row.type === "text").text);
 };
 const status = await call("mnova_status", {}); assert.equal(status.ok, true);
 report.version = status.mnova_version;
 checks.push("fixed-rc2-mcp-client-and-synthetic-raw-data-preflight");
 const result = await call("mnova_process_1d", { input_path: input });
 assert.equal(result.status, "ok"); assert.equal(result.spectrum.dimensions, 1);
 report.spectrum = result.spectrum; report.warnings = result.warnings;
 report.autoPickedPeakCount = result.peaks.length;
 report.dominantPeaks = [...result.peaks].sort((a, b) => Math.abs(b.intensity) - Math.abs(a.intensity)).slice(0, 3).map(peak => ({ ppm: peak.ppm, intensity: peak.intensity })).sort((a, b) => a.ppm - b.ppm);
 for (const [index, ppm] of [1.2, 3.65, 7.26].entries()) assert.ok(Math.abs(report.dominantPeaks[index].ppm - ppm) < 0.01, `dominant synthetic peak missing near ${ppm}`);
 report.scope = "Software processing/export acceptance using synthetic data; low-intensity auto-picked peaks and quantitative integrations are not scientifically validated.";
 checks.push("native-mnova-processes-synthetic-fid-and-preserves-three-modeled-peak-positions");
 report.artifacts = [];
 for (const [kind, path] of Object.entries(result.artifacts)) {
  const within = relative(output, resolve(path)); assert.ok(!within.startsWith("..") && !isAbsolute(within));
  const bytes = await readFile(path); assert.ok(bytes.length > 0);
  if (kind === "pdf") assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  report.artifacts.push({ kind, path, size: bytes.length, sha256: hash(bytes) });
 }
 assert.equal(hash(await readFile(join(input, "fid"))), rawHash);
 checks.push("mnova-document-pdf-csv-export-and-unchanged-synthetic-raw-input");
 report.ok = true;
} catch (error) { report.error = error.message; throw error; }
finally {
 await handle?.dispose();
 await writeFile(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
 console.log(JSON.stringify({ ok: report.ok, checks, evidence: join(output, "verification.json") }));
}
