import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("desktop shell routes artifact save and external URLs through Tauri", async () => {
	const [shell, main, client, manifest] = await Promise.all([
		read("desktop/src/index.html"),
		read("desktop/src-tauri/src/main.rs"),
		read("client/index.js"),
		read("package.json"),
	]);
	assert.match(shell, /event\.source !== frame\.contentWindow/);
	assert.match(shell, /event\.origin !== runtimeOrigin/);
	assert.match(shell, /invoke\('save_artifact'/);
	assert.match(main, /async fn save_artifact/);
	assert.match(main, /fn reveal_path/);
	assert.match(main, /fn open_workspace/);
	assert.match(client, /saveArtifactViaDesktop/);
	assert.match(client, /openExternalUrl/);
	assert.equal(JSON.parse(manifest).exports["./capture-handoff"].default, "./lib/capture-handoff.js");
});

test("desktop stores secrets with DPAPI, owns DSH with a Job Object, and has a CSP", async () => {
	const [config, process, tauri] = await Promise.all([
		read("desktop/src-tauri/src/runtime/config.rs"),
		read("desktop/src-tauri/src/runtime/process.rs"),
		read("desktop/src-tauri/tauri.conf.json"),
	]);
	assert.match(config, /CryptProtectData/);
	assert.match(config, /CryptUnprotectData/);
	assert.match(config, /skip_serializing/);
	assert.match(process, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
	assert.match(process, /AssignProcessToJobObject/);
	const parsed = JSON.parse(tauri);
	assert.ok(parsed.app.security.csp);
	assert.match(parsed.app.security.csp, /object-src 'none'/);
});
