/**
 * Integration test: the lab-research agent preset composes.
 *
 * Boots the agent-presets roster over the repo's shipped presets/ directory
 * and asserts `lab-research` is discovered, not broken, and resolvable — the
 * "skill routing" seam of the plugin.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";

const presetsRoot = fileURLToPath(new URL("../../presets", import.meta.url));

test("lab-research preset is discoverable and composes", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-preset-"));
	try {
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [
				{
					id: "agent-presets",
					name: "@deepseek-ai/dsh-agent-presets",
					config: {
						default: "lab-research",
						roots: [{ path: presetsRoot, trust: "user" }],
						includeUserRoot: false
					}
				}
			]
		});
		try {
			const presets = await handle.ctx.agentPresets.list();
			const lab = presets.find((p) => p.id === "lab-research");
			assert.ok(lab, "lab-research discovered");
			assert.equal(lab.broken, undefined, `lab-research should compose, got: ${lab.broken}`);
			assert.equal(lab.trust, "user");

			const resolved = await handle.ctx.agentPresets.resolve("lab-research");
			assert.ok(resolved.path.endsWith("agent.cordis.yml"));
			assert.equal(handle.ctx.agentPresets.defaultId, "lab-research");

			// the composition must contain the skill-routing rows
			const text = await handle.ctx.agentPresets.read("lab-research");
			assert.match(text, /tool-skill/);
			assert.match(text, /skill-filesystem/);
			assert.match(text, /@deepseek-ai\/dsh-skill-filesystem/);
			assert.match(text, /id: convert-document/);
			assert.match(text, /dsh-lab-agent\/convert-tool/);
		} finally {
			await handle.dispose();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
