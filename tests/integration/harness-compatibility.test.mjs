import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyFakeInvokePatch, inspectFakeInvokePatch, revertFakeInvokePatch } from "../../src/dsh-runtime-patch.js";
import { applyDshWebFrontendPatch, inspectDshWebFrontendPatch, revertDshWebFrontendPatch } from "../../src/dsh-web-frontend-patch.js";

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

test("clipboard fallback patch matches the pinned DSH web frontend, parses and is reversible", async () => {
	const packageRoot = dirname(require.resolve("@deepseek-ai/dsh-web-frontend/package.json"));
	const assetsRoot = join(packageRoot, "dist", "assets");
	let source;
	for (const name of await readdir(assetsRoot)) {
		if (!/^index-[\w-]+\.js$/.test(name)) continue;
		const candidate = await readFile(join(assetsRoot, name), "utf8");
		if (inspectDshWebFrontendPatch(candidate).pristineAnchors) { source = candidate; break; }
	}
	assert.ok(source, "pinned DSH web frontend clipboard anchors found");
	const patched = applyDshWebFrontendPatch(source);
	assert.equal(inspectDshWebFrontendPatch(patched).patchedAnchors, true);

	// 出包时 prepare-runtime 会对补丁后的前端跑 `node --check`，但它要等
	// robocopy + 补丁跑完（约 40 分钟流水线）才暴露语法错误。这里用同一条
	// 检查提前拦住：锚点是压缩产物，替换片段少一个分隔符就会编译不过
	// （2026-09-24：`catch{G="failed"}const ee=...` 换成表达式语句后缺分号）。
	const scratch = await mkdtemp(join(tmpdir(), "dsh-frontend-syntax-"));
	try {
		const asset = join(scratch, "index.js");
		await writeFile(asset, patched, "utf8");
		const checked = spawnSync(process.execPath, ["--check", asset], { encoding: "utf8" });
		assert.equal(checked.status, 0, `patched DSH web frontend is invalid JavaScript:\n${checked.stderr}`);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}

	assert.equal(revertDshWebFrontendPatch(patched), source);
});
