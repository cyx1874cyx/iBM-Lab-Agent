import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { applyFakeInvokePatch, inspectFakeInvokePatch, revertFakeInvokePatch } from "../../src/dsh-runtime-patch.js";

const require = createRequire(import.meta.url);
const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("all declared browser modules and Harness peers exist at the pinned release", async () => {
	const pkg = JSON.parse(await read("package.json"));
	const lock = JSON.parse(await read("harness.lock.json"));
	const launcher = JSON.parse(await read("runtime/launcher/package.json"));
	assert.equal(launcher.dependencies["@deepseek-ai/dsh"], lock.cli);
	assert.equal(pkg.devDependencies["@deepseek-ai/dsh"], lock.cli);
	for (const name of new Set([...pkg.dsh.client.inject, ...Object.keys(pkg.peerDependencies)])) {
		const installed = JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8"));
		if (name.startsWith("@deepseek-ai/dsh-")) assert.equal(installed.version, lock.cli, name);
		if (pkg.dsh.client.inject.includes(name)) assert.ok(installed.exports["./client"], `${name} has a browser entry`);
	}
});

test("fake-invoke patch matches the pristine locked DSH and reverses without changing upstream code", async () => {
	const source = await readFile(require.resolve("@deepseek-ai/dsh-agent-loop"), "utf8");
	const expected = (await read("runtime/versions.env")).match(/^DSH_AGENT_LOOP_SHA256=(\w+)$/m)[1];
	assert.equal(createHash("sha256").update(source).digest("hex"), expected);
	const patched = applyFakeInvokePatch(source);
	assert.equal(inspectFakeInvokePatch(patched).patchedAnchors, true);
	assert.equal(applyFakeInvokePatch(patched), patched);
	assert.equal(revertFakeInvokePatch(patched), source);
	assert.match(patched, /let firstAttempt = true;\n\t\tlet fakeInvokeRetries = 0;/);
});
