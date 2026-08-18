import { test } from "node:test";
import assert from "node:assert/strict";
import { probeMarkitdown } from "../../src/markitdown.js";

test("probeMarkitdown reports availability with a clear error when unavailable", async () => {
	const result = await probeMarkitdown({});
	assert.equal(typeof result.available, "boolean");
	if (result.available === false) {
		assert.ok(result.error, "unavailable must carry an install hint");
		assert.match(result.error, /markitdown/);
	}
});
