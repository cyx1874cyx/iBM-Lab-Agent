import { test } from "node:test";
import assert from "node:assert/strict";
import {
	applyFakeInvokePatch,
	inspectFakeInvokePatch,
	revertFakeInvokePatch
} from "../../src/dsh-runtime-patch.js";

const pristine = `header
\t\tconst system = renderPrompt(assembly);
\t\twhile (true) {
body
\t\t\tconst toolCalls = message.content.filter((block) => block.type === "tool-call");
\t\t\tif (toolCalls.length === 0) return { kind: "completed" };
footer`;

test("DSH fake-invoke patch is exact, idempotent and reversible", () => {
	const patched = applyFakeInvokePatch(pristine);
	assert.equal(inspectFakeInvokePatch(patched).patchedAnchors, true);
	assert.equal(applyFakeInvokePatch(patched), patched);
	assert.equal(revertFakeInvokePatch(patched), pristine);
});

test("DSH fake-invoke patch refuses an unknown source layout", () => {
	assert.throws(() => applyFakeInvokePatch("unrelated source"), /exactly one loop counter anchor/);
});
