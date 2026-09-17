import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../../lib/characterization-tool.js";

test("characterization tools bind the active project and pass attempt-scoped outputs", async () => {
  const definitions = [];
  const calls = [];
  const ctx = {
    tools: { register(definition) { definitions.push(definition); } },
    labTasks: {
      getProject(id) { return id === "project-a" ? { id } : undefined; },
      getProjectBySession() { return { project: { id: "project-a" } }; },
      getProjectByCwd() { return undefined; }
    },
    labCharacterization: {
      async submit(fields) { calls.push(["submit", fields]); return { task: { ...fields, attempt: 1, status: "queued" }, prompt: "run task" }; },
      async update(id, projectId, fields) { calls.push(["update", id, projectId, fields]); return { id, status: fields.status }; },
      async complete(id, projectId, fields) { calls.push(["complete", id, projectId, fields]); return { id, status: "completed" }; },
      async recomplete(id, projectId, fields) { calls.push(["recomplete", id, projectId, fields]); return { id, status: "completed" }; }
    }
  };
  apply(ctx);
  const submit = definitions.find((item) => item.name === "lab_characterization_submit");
  const preflight = definitions.find((item) => item.name === "lab_characterization_preflight");
  const update = definitions.find((item) => item.name === "lab_characterization_update");
  const complete = definitions.find((item) => item.name === "lab_characterization_complete");
  const recomplete = definitions.find((item) => item.name === "lab_characterization_recomplete");
  assert.ok(submit && preflight && update && complete && recomplete);
  for (const tool of [submit, preflight, update, complete, recomplete]) {
    assert.equal(typeof tool.output?.render, "function");
  }
  const created = await submit.execute({ taskId: "nmr-created", inputPath: "attachment.zip", structurePath: "target.mol" }, { agent: { session: { id: "session-a" } } });
  assert.equal(created.ok, true);assert.equal(created.taskId, "nmr-created");assert.equal(calls[0][1].importExternal, true);
  assert.deepEqual(await update.execute({ taskId: "nmr-a", attempt: 2, status: "running" }, { agent: { session: { id: "session-a" } } }), { ok: true, taskId: "nmr-a", status: "running" });
  assert.match(update.output.render({}, { ok: true, taskId: "nmr-a", status: "running" })[0].text, /running/);
  assert.match(complete.output.render({}, { ok: false, error: "fixture" })[0].text, /fixture/);
  assert.equal(calls[1][2], "project-a");
  assert.equal(calls[1][3].sessionId, "session-a");
  assert.equal((await complete.execute({ taskId: "nmr-a", attempt: 2, spectrumPath: "a.mnova", reportPath: "a.docx",assessment:{verdict:"match",confidence:"high",summary:"consistent"} }, { agent: { session: { id: "session-a" } } })).status, "completed");
  assert.equal((await recomplete.execute({ taskId: "nmr-a", attempt: 2, spectrumPath: "b.mnova", reportPath: "b.docx",assessment:{verdict:"inconclusive",confidence:"medium",summary:"overlap"} }, { agent: { session: { id: "session-a" } } })).status, "completed");
  assert.equal((await update.execute({ projectId: "missing", taskId: "nmr-a", attempt: 2, status: "running" }, {})).ok, false);
});
