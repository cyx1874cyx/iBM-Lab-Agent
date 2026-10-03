/** Real Origin round trip. Creates/deletes only its own uniquely named sample workbook. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";
import { nativeMcpConfig } from "../../src/runtime/native-applications.js";

const arg = name => { const n = process.argv.indexOf(name); assert.ok(n >= 0); return resolve(process.argv[n + 1]); };
const python = arg("--python"), output = arg("--output");
await mkdir(output, { recursive: true });
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = python;
const bookName = `P4${Date.now().toString(36)}`;
const sample = join(output, "sample.csv"), exported = join(output, "roundtrip.csv");
await writeFile(sample, "x,y\n1,3\n2,5\n3,7\n");
let handle, createdBook;
const checks = [];
const report = { phase: "P4", application: "Origin", ok: false, checks, output, userApplicationOwnedByHost: false };
try {
 handle = await bootLite({ storageRoot: join(output, "storage"), coreOnly: true, includePython: false,
  coreConfig: { projectsRoot: join(output, "projects") }, extraRows: [
   { id: "runtime", name: "dsh-lab-agent/runtime" },
   { id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
   { id: "tools", name: "@deepseek-ai/dsh-tools" },
   { id: "origin", name: "@deepseek-ai/dsh-mcp-client", config: nativeMcpConfig("origin", { python, toolProfile: "full", workspaceRoot: output }) }
  ] });
 const call = async (name, input) => {
  const result = await handle.ctx.tools.get(`mcp__origin__${name}`).execute(input, { signal: new AbortController().signal });
  const body = result.structuredContent ?? JSON.parse(result.content.find(row => row.type === "text").text);
  assert.equal(body.ok, true, `${name}: ${body.message}`);
  return body.data;
 };
 report.connection = await call("origin_ping", { show: true });
 checks.push("fixed-rc2-mcp-client-connects-to-user-started-origin-bridge");
 const imported = await call("origin_import_table", { path: sample, book_name: bookName, sheet_name: "Fixture" });
 createdBook = imported.worksheet.book_name;
 const sheet = { book_name: createdBook, sheet_name: imported.worksheet.sheet_name };
 const data = await call("origin_read_worksheet", { ...sheet, max_rows: 3 });
 assert.deepEqual(data.rows.map(row => [Number(row.x), Number(row.y)]), [[1, 3], [2, 5], [3, 7]]);
 checks.push("synthetic-csv-import-and-structured-origin-data-match");
 await call("origin_export_worksheet_csv", { ...sheet, path: exported, overwrite: false });
 const bytes = await readFile(exported);
 const rows = bytes.toString("utf8").trim().split(/\r?\n/).slice(-3).map(line => line.split(",").map(Number));
 assert.deepEqual(rows, [[1, 3], [2, 5], [3, 7]]);
 report.export = { path: exported, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
 checks.push("origin-exported-file-roundtrip-preserves-synthetic-values");
 await call("origin_delete_object", { name: createdBook, object_type: "workbook" });
 createdBook = undefined;
 checks.push("only-acceptance-workbook-removed-user-origin-kept-open");
 report.ok = true;
} catch (error) { report.error = error.message; throw error; }
finally {
 if (createdBook && handle) {
  try { await handle.ctx.tools.get("mcp__origin__origin_delete_object").execute({ name: createdBook, object_type: "workbook" }, { signal: new AbortController().signal }); }
  catch { report.cleanupPending = createdBook; }
 }
 await handle?.dispose();
 await writeFile(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
 console.log(JSON.stringify({ ok: report.ok, checks, evidence: join(output, "verification.json") }));
}
