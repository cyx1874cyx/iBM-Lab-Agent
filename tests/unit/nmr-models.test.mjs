import { test } from "node:test";
import assert from "node:assert/strict";
import { nmrDatasetSchema, canTransitNmr, NMR_STATUSES, NMR_TRANSITIONS, IMMUTABLE_FIELDS, integralSchema } from "../../src/nmr/models.js";

test("dataset schema defaults to prepared and carries original paths", () => {
	const ds = nmrDatasetSchema.parse({
		id: "nmr-1", name: "聚前药 1H", fidPath: "/data/a.fid", structurePath: "/data/a.mol",
		createdAt: "now", updatedAt: "now"
	});
	assert.equal(ds.status, "prepared");
	assert.equal(ds.nucleus, "1H");
	assert.deepEqual(ds.approvedIntegrals, []);
});

test("immutable fields protect original FID and structure", () => {
	assert.deepEqual(IMMUTABLE_FIELDS, ["fidPath", "structurePath", "createdAt"]);
});

test("integral schema validates positive integral and protons", () => {
	const ok = integralSchema.parse({ peak: "3.6 ppm", integral: 2, protons: 1, assignment: "OCH3" });
	assert.equal(ok.protons, 1);
	assert.throws(() => integralSchema.parse({ peak: "x", integral: -1, protons: 1, assignment: "a" }));
	assert.throws(() => integralSchema.parse({ peak: "x", integral: 1, protons: 0, assignment: "a" }));
});

test("state machine covers prepare→review→write-back→visual check", () => {
	assert.deepEqual(NMR_STATUSES, ["prepared", "under-review", "approved-written", "visually-verified"]);
	assert.ok(canTransitNmr("prepared", "under-review"));
	assert.ok(canTransitNmr("under-review", "approved-written"));
	assert.ok(canTransitNmr("approved-written", "visually-verified"));
	assert.ok(canTransitNmr("under-review", "prepared")); // 打回
	assert.ok(canTransitNmr("approved-written", "prepared")); // 打回重积分
	assert.ok(canTransitNmr("visually-verified", "prepared")); // 复核打回
	assert.ok(!canTransitNmr("visually-verified", "under-review"));
	assert.ok(!canTransitNmr("prepared", "approved-written"));
	assert.deepEqual(NMR_TRANSITIONS["prepared"], ["under-review"]);
});
