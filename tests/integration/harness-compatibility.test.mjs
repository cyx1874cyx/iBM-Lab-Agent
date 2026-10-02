import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { inspectFakeInvokePatch } from "../../src/dsh-runtime-patch.js";
import { inspectDshWebFrontendPatch } from "../../src/dsh-web-frontend-patch.js";

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

test("rc.2 agent loop stays pristine and rejects the legacy runtime patch", async () => {
 const target = require.resolve("@deepseek-ai/dsh-agent-loop");
 const before = await readFile(target, "utf8");
 assert.equal(inspectFakeInvokePatch(before).patched, false);
 const result = spawnSync(process.execPath, ["scripts/patch-dsh-runtime.mjs", "patch", "--target", target], {encoding:"utf8"});
 assert.notEqual(result.status, 0);
 assert.match(result.stderr, /legacy patch does not support.*0\.2\.0-rc\.2/);
 assert.equal(await readFile(target, "utf8"), before);
});

test("rc.2 frontend stays pristine, parses and rejects the legacy clipboard patch", async () => {
 const root = dirname(require.resolve("@deepseek-ai/dsh-web-frontend/package.json"));
 const assets = join(root,"dist","assets");
 const files = (await readdir(assets)).filter(name => /^index-[\w-]+\.js$/.test(name));
 assert.ok(files.length);
 const before = await Promise.all(files.map(name=>readFile(join(assets,name),"utf8")));
 const result=spawnSync(process.execPath,["scripts/patch-dsh-web-frontend.mjs","patch","--root",root],{encoding:"utf8"});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/legacy patch does not support.*0\.2\.0-rc\.2/);
 for (let i=0;i<files.length;i++) {
   assert.equal(inspectDshWebFrontendPatch(before[i]).patched,false);
   assert.equal(await readFile(join(assets,files[i]),"utf8"),before[i]);
   const checked=spawnSync(process.execPath,["--check",join(assets,files[i])],{encoding:"utf8"});
   assert.equal(checked.status,0,checked.stderr);
 }
});
