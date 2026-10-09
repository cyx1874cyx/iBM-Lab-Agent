import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const asset = readFileSync(new URL("../../vendor/mnova-mcp/src/mnova_mcp/assets/bridge.qs", import.meta.url), "utf8");

function run(options = {}) {
 const { operation = "prepare_structure_1d", nmr = {}, throws = false, deadline } = options;
 const opened = Object.hasOwn(options, "opened") ? options.opened : true;
 const files = {}, called = [], openedPaths = [], exits = [];
 const request = { operation, job_id: "test", input_path: "sample/fid", prepared_mnova_path: "prepared.mnova", output_dir: "output", startup_probe_path: "probe.json", response_path: "response.json" };
 if (deadline !== undefined) request.startup_deadline_ms = deadline;
 const sandbox = { Application: { mainWindow: { newWindow: () => ({}) }, setExitStatus: code => exits.push(code) }, DocumentWindow: function () { this.close = () => {}; }, serialization: { open(path) { openedPaths.push(path); if (throws) throw Error("open rejected"); return opened; } } };
 if (nmr !== "absent") sandbox.nmr = nmr;
 const context = vm.createContext(sandbox);
 vm.runInContext(asset, context);
 context.readText = () => JSON.stringify(request);
 context.writeText = (path, text) => { files[path] = JSON.parse(text); };
 for (const [name, op] of [["process1D", "process_1d"], ["prepareStructure1D", "prepare_structure_1d"], ["applyAssignments1D", "apply_assignments_1d"]]) context[name] = () => { called.push(op); return { status: "ok" }; };
 context.runJob("request.json");
 return { files, called, openedPaths, exits };
}

for (const operation of ["process_1d", "prepare_structure_1d", "apply_assignments_1d"]) {
 test(`${operation}: missing NMR module stops before import and processing`, () => {
  const result = run({ operation, nmr: "absent" });
  assert.equal(result.files["probe.json"].nmr_type, "undefined");
  assert.deepEqual(result.openedPaths, []);
  assert.deepEqual(result.called, []);
  assert.equal(result.files["response.json"].status, "error");
  assert.deepEqual(result.exits, [1]);
 });
 test(`${operation}: failed input open never enters the workflow`, () => {
  for (const options of [{ opened: false }, { opened: undefined }, { opened: 1 }, { throws: true }]) {
   const result = run({ operation, ...options });
   assert.deepEqual(result.called, []);
   assert.equal(result.files["response.json"].status, "error");
  }
 });
 test(`${operation}: valid runtime and input retain the existing operation`, () => {
  const result = run({ operation });
  assert.deepEqual(result.called, [operation]);
  const key = operation === "apply_assignments_1d" ? "open_document" : "open_fid";
  assert.equal(result.files["probe.json"][key], true);
  assert.deepEqual(result.openedPaths, [operation === "apply_assignments_1d" ? "prepared.mnova" : "sample/fid"]);
  assert.deepEqual(result.exits, [0]);
 });
}

test("standalone runtime probe is read-only and returns both required values", () => {
 const result = run({ operation: "probe_runtime" });
 assert.equal(result.files["response.json"].nmr_type, "object");
 assert.equal(result.files["response.json"].open_fid, true);
 assert.deepEqual(result.called, []);
 assert.equal(result.files["output/analysis.json"], undefined);
 assert.deepEqual(result.exits, [0]);
});

test("a request forwarded to an existing GUI after its deadline cannot import or process", () => {
 const result = run({ deadline: Date.now() - 1000 });
 assert.equal(result.files["probe.json"].expired, true);
 assert.deepEqual(result.openedPaths, []);
 assert.deepEqual(result.called, []);
 assert.equal(result.files["response.json"].status, "error");
});

test("installed and source-checkout bridge scripts remain identical", () => {
 assert.equal(readFileSync(new URL("../../vendor/mnova-mcp/mnova/bridge.qs", import.meta.url), "utf8"), asset);
});
