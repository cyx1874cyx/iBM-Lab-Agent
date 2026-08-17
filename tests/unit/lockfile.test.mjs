import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createVendorLock,
	parseVendorLock,
	parseHarnessLock,
	vendorLockSchema,
	COMMIT_SHA_RE
} from "../../src/lockfile.js";

const SHA = "c171989db699bd601d4373912b3fb8db96ecc95b";

test("createVendorLock produces a valid vendor lock", () => {
	const lock = createVendorLock({
		repo: "https://github.com/Yuan1z0825/nature-skills.git",
		pinnedCommit: SHA,
		pinnedAt: "2026-08-17T00:00:00.000Z",
		license: "Apache-2.0",
		skills: [{ name: "nature-reader", manifestVersion: "0.1.0", dir: "skills/nature-reader", requiredFiles: ["SKILL.md"] }],
		pythonDepsSha256: "ab".repeat(32)
	});
	assert.equal(lock.schema, "dsh-lab-agent/vendor-lock/v1");
	assert.equal(lock.regression.caseCount, 0);
	assert.equal(lock.regression.lastPassedAt, null);
	assert.equal(lock.pythonDeps.file, "requirements.lock");
});

test("vendor lock round-trips through parse", () => {
	const lock = createVendorLock({
		repo: "r",
		pinnedCommit: SHA,
		pinnedAt: "2026-08-17T00:00:00.000Z",
		license: "Apache-2.0",
		skills: [],
		pythonDepsSha256: "cd".repeat(32)
	});
	const parsed = parseVendorLock(JSON.stringify(lock));
	assert.deepEqual(parsed, lock);
});

test("vendor lock rejects a bad commit sha", () => {
	try {
		createVendorLock({
			repo: "r",
			pinnedCommit: "not-a-sha",
			pinnedAt: "2026-08-17T00:00:00.000Z",
			license: "Apache-2.0",
			skills: [],
			pythonDepsSha256: "ef".repeat(32)
		});
		assert.fail("expected ZodError");
	} catch (error) {
		assert.ok(error.issues?.some((i) => i.path.join(".") === "pinnedCommit"), "path pinnedCommit reported");
	}
});

test("vendor lock rejects a non-kebab skill name", () => {
	try {
		vendorLockSchema.parse({
			schema: "dsh-lab-agent/vendor-lock/v1",
			repo: "r",
			pinnedCommit: SHA,
			pinnedAt: "2026-08-17T00:00:00.000Z",
			license: "Apache-2.0",
			skills: [{ name: "Bad Name", manifestVersion: "1", dir: "x" }],
			pythonDeps: { file: "requirements.lock", sha256: "ab".repeat(32) }
		});
		assert.fail("expected ZodError");
	} catch (error) {
		assert.ok(error.issues?.some((i) => i.path.join(".") === "skills.0.name"), "path skills.0.name reported");
	}
});

test("harness lock schema validates", () => {
	const parsed = parseHarnessLock(
		JSON.stringify({
			schema: "dsh-lab-agent/harness-lock/v1",
			repo: "https://github.com/deepseek-ai/deepseek-harness",
			cli: "0.1.0-rc.6",
			packages: { "@deepseek-ai/dsh-base": "0.1.0-rc.7" },
			recordedAt: "2026-08-17T00:00:00.000Z"
		})
	);
	assert.equal(parsed.cli, "0.1.0-rc.6");
});

test("COMMIT_SHA_RE accepts 40-hex only", () => {
	assert.equal(COMMIT_SHA_RE.test(SHA), true);
	assert.equal(COMMIT_SHA_RE.test(SHA.slice(0, 39)), false);
	assert.equal(COMMIT_SHA_RE.test(SHA.toUpperCase()), false);
});
