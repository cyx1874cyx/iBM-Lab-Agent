import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/configure-default-preset.mjs", import.meta.url));

test("default-preset configurator preserves unrelated settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "ibm-lab-settings-"));
	try {
		await writeFile(join(root, "settings.yaml"), "llm:\n  provider: test\nagent-presets:\n  default: standard\n", "utf8");
		const result = spawnSync(process.execPath, [script, "--dsh-home", root], { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		const source = await readFile(join(root, "settings.yaml"), "utf8");
		assert.match(source, /llm:\n {2}provider: test/);
		assert.match(source, /agent-presets:\n {2}default: lab-research/);
		assert.equal(spawnSync(process.execPath, [script, "--dsh-home", root]).status, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
