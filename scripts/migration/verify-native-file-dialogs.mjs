/** User-operated native dialog acceptance; never substitutes fixture booleans for interaction. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";
const arg = name => { const n = process.argv.indexOf(name); assert.ok(n >= 0); return resolve(process.argv[n + 1]); };
const output = arg("--output"), python = arg("--python"), electron = arg("--electron");
await mkdir(output, { recursive: true });
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = python;
let handle;
const checks = [], report = { phase: "P4", scope: "native PDF artifact interaction", ok: false, checks };
const state = async step => writeFile(join(output, "status.json"), JSON.stringify({ step, checks, at: new Date().toISOString() }, null, 2));
try {
 handle = await bootLite({ storageRoot: join(output, "storage"), coreOnly: true, includePython: false,
  coreConfig: { projectsRoot: join(output, "projects") }, extraRows: [
   { id: "runtime", name: "dsh-lab-agent/runtime" },
   { id: "desktop", name: "dsh-lab-agent/scientific-desktop", config: { electron, root: join(output, "desktop"), headless: false } }
  ] });
 const broker = handle.ctx.ibmScientificDesktop.requireBroker();
 const bytes = await readFile(arg("--pdf"));
 const sha256 = createHash("sha256").update(bytes).digest("hex");
 const { fileId } = await broker.call("stage", { base64: bytes.toString("base64") });
 await state("cancel-first-save-dialog");
 assert.equal((await broker.call("save", { fileId, name: "P4-native-file-test.pdf" }, 300000)).cancelled, true);
 checks.push("user-cancels-real-native-save-dialog");
 await state("save-second-dialog");
 const saved = await broker.call("save", { fileId, name: "P4-native-file-test.pdf" }, 300000);
 assert.equal(saved.saved, true); assert.equal(saved.size, bytes.length); assert.equal(saved.sha256, sha256);
 checks.push("native-save-readback-hash-and-byte-count-match");
 assert.equal((await broker.call("preview", { fileId })).previewOpened, true);
 assert.equal((await broker.call("artifactOpen", { fileId })).opened, true);
 assert.equal((await broker.call("reveal", { fileId })).revealed, true);
 await state("await-user-preview-open-and-reveal-observation");
 let confirmation;
 for (let n = 0; n < 1200; n++) {
  try { confirmation = JSON.parse(await readFile(join(output, "confirmation.json"), "utf8")); } catch { /* user observation pending */ }
  if (confirmation) break;
  await delay(1000);
 }
 assert.equal(confirmation?.previewVisible, true);
 assert.equal(confirmation?.systemPdfOpened, true);
 assert.equal(confirmation?.fileRevealed, true);
 report.userObservation = confirmation;
 checks.push("user-observes-internal-preview-system-pdf-open-and-file-reveal");
 report.ok = true;
} catch (error) { report.error = error.message; throw error; }
finally {
 await handle?.dispose();
 await writeFile(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
 console.log(JSON.stringify({ ok: report.ok, checks, evidence: join(output, "verification.json") }));
}
