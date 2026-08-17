/**
 * Integration test: skill discovery of the vendored nature skills.
 *
 * Mounts a host `skill-filesystem` provider exactly like the bundle patch
 * (providerName lab-nature, includeDefaultRoots false, customSkillDirs ->
 * the repo's vendored nature-skills skills dir) and asserts the registry
 * catalog exposes the pinned skills to the model-facing loader.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";

const skillsDir = fileURLToPath(new URL("../../vendor/nature-skills/skills", import.meta.url));

test("nature skills are discovered through the lab provider", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-skill-"));
	try {
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [
				{ id: "skills", name: "@deepseek-ai/dsh-skill" },
				{
					id: "lab-skill-filesystem",
					name: "@deepseek-ai/dsh-skill-filesystem",
					config: {
						providerName: "lab-nature",
						includeDefaultRoots: false,
						customSkillDirs: [skillsDir]
					}
				}
			]
		});
		try {
			const catalog = await handle.ctx.skills.list({});
			const candidates = Array.isArray(catalog) ? catalog : catalog.candidates;
			const names = candidates.map((c) => c.name);
			for (const expected of ["nature-reader", "nature-paper-card", "nature-paper2ppt", "nature-academic-search", "nature-shared"]) {
				assert.ok(names.includes(expected), `catalog must include ${expected}; got ${names.join(", ")}`);
			}
			// the full body of a pinned skill loads through the registry
			const loaded = await handle.ctx.skills.get("nature-reader");
			assert.ok(loaded, "nature-reader loads");
			assert.equal(loaded.provider, "lab-nature");
			assert.match(loaded.content ?? "", /Full-Paper|reader|Reader/);
		} finally {
			await handle.dispose();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
