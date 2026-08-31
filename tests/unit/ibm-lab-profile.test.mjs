import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfileManifest, resolveProfileDir } from "@deepseek-ai/dsh-app-boot";
import {
	ensureIbmLabProfile,
	IBM_LAB_BASE_BUNDLES,
	IBM_LAB_PLUGIN_BUNDLE,
	IBM_LAB_PROFILE,
	validateIbmLabProfile
} from "../../src/ibm-lab-profile.js";

test("ibm-lab profile keeps one web stack and one lab bundle", async () => {
	const home = await mkdtemp(join(tmpdir(), "dsh-ibm-lab-profile-"));
	try {
		const dir = resolveProfileDir(IBM_LAB_PROFILE, home);
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({
				name: "dsh-profile-ibm-lab",
				private: true,
				dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", IBM_LAB_PLUGIN_BUNDLE, "@deepseek-ai/dsh-web-app", IBM_LAB_PLUGIN_BUNDLE] } }
			}),
			"utf8"
		);
		await writeFile(join(dir, "cordis.patch.yml"), "[]\n", "utf8");

		const result = ensureIbmLabProfile({ dshHome: home });
		assert.deepEqual(result.bundles, [...IBM_LAB_BASE_BUNDLES, IBM_LAB_PLUGIN_BUNDLE]);
		assert.deepEqual(result.failures, []);
		assert.deepEqual(validateIbmLabProfile(readProfileManifest("test", dir)), []);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
