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

test("cleanJson normalizes NaN/Infinity to null and BigInt to string (lossless-safe)", () => {
	const cleaned = cleanJson({
		nan: NaN,
		posInf: Infinity,
		negInf: -Infinity,
		big: 123456789012345678901234567890n,
		finite: 3.25,
		hole: [NaN, undefined, 1]
	});
	assert.equal(cleaned.nan, null);
	assert.equal(cleaned.posInf, null);
	assert.equal(cleaned.negInf, null);
	assert.equal(cleaned.big, "123456789012345678901234567890");
	assert.equal(cleaned.finite, 3.25);
	assert.deepEqual(cleaned.hole, [null, null, 1]);
	assert.doesNotThrow(() => JSON.stringify(cleaned));
	assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), cleaned);
});

test("cleanJson converts Date/Map/Set/typed arrays to reversible plain values", () => {
	const cleaned = cleanJson({
		at: new Date("2026-09-03T12:00:00.000Z"),
		table: new Map([["a", 1], ["b", { ok: true, extra: undefined }]]),
		tags: new Set(["x", "y"]),
		bytes: new Uint8Array([1, 2, 255])
	});
	assert.equal(cleaned.at, "2026-09-03T12:00:00.000Z");
	assert.deepEqual(cleaned.table, { a: 1, b: { ok: true } });
	assert.deepEqual(cleaned.tags, ["x", "y"]);
	assert.deepEqual(cleaned.bytes, [1, 2, 255]);
	assert.doesNotThrow(() => JSON.stringify(cleaned));
});

test("cleanJson drops functions/symbols and survives circular references", () => {
	const inner = { keep: 1 };
	inner.self = inner;
	const value = { fn() {}, sym: Symbol("s"), node: inner, plain: { a: 1 } };
	const cleaned = cleanJson(value);
	assert.equal(cleaned.fn, undefined);
	assert.equal(cleaned.sym, undefined);
	assert.deepEqual(cleaned.plain, { a: 1 });
	assert.equal(cleaned.node.keep, 1);
	assert.equal("self" in cleaned.node, false, "循环引用属性被跳过而非抛错");
	assert.doesNotThrow(() => JSON.stringify(cleaned));
});
