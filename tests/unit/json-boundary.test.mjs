import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanJson } from "../../src/json-boundary.js";

test("cleanJson removes undefined object fields and normalizes array holes", () => {
	const value = {
		id: "lab-ppt-v4",
		pageSize: { ratio: "16:9", type: undefined },
		optional: undefined,
		items: ["cover", undefined, { layoutId: "slideLayout1", notes: undefined }]
	};
	const cleaned = cleanJson(value);
	assert.deepEqual(cleaned, {
		id: "lab-ppt-v4",
		pageSize: { ratio: "16:9" },
		items: ["cover", null, { layoutId: "slideLayout1" }]
	});
	assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), cleaned);
});
