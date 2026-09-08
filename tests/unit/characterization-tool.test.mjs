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
      async update(id, projectId, fields) { calls.push(["update", id, projectId, fields]); return { id, status: fields.status }; },
      async complete(id, projectId, fields) { calls.push(["complete", id, projectId, fields]); return { id, status: "completed" }; }
    }
  };
  apply(ctx);
  const update = definitions.find((item) => item.name === "lab_characterization_update");
  const complete = definitions.find((item) => item.name === "lab_characterization_complete");
  assert.ok(update && complete);
  assert.deepEqual(await update.execute({ taskId: "nmr-a", attempt: 2, status: "running" }, { agent: { session: { id: "session-a" } } }), { ok: true, taskId: "nmr-a", status: "running" });
  assert.equal(calls[0][2], "project-a");
  assert.equal(calls[0][3].sessionId, "session-a");
  assert.equal((await complete.execute({ taskId: "nmr-a", attempt: 2, spectrumPath: "a.mnova", reportPath: "a.docx" }, { agent: { session: { id: "session-a" } } })).status, "completed");
  assert.equal((await update.execute({ projectId: "missing", taskId: "nmr-a", attempt: 2, status: "running" }, {})).ok, false);
});
