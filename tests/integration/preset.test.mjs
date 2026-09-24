/**
 * Integration test: the lab-research agent preset composes.
 *
 * DSH 0.1.7 declares presets as `@deepseek-ai/dsh-agent-preset` rows carried by
 * bundle patches, so this boots the real declaration file from
 * `presets/lab-research/preset.patch.yml` through the Loader overlay path and
 * asserts the registry accepts it — the "skill routing" seam of the plugin.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { bootLite } from "../helpers/boot-lite.mjs";

const presetPatch = fileURLToPath(new URL("../../presets/lab-research/preset.patch.yml", import.meta.url));

test("lab-research preset declaration is registered and composes", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-preset-"));
	try {
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [
				{ id: "session-projection", name: "@deepseek-ai/dsh-session-projection" },
				{
					id: "agent-preset-registry",
					name: "@deepseek-ai/dsh-agent-preset-registry",
					config: { default: "lab-research" }
				}
			],
			extraPatches: loadOverlayPatches("dsh-lab-agent-test", presetPatch)
		});
		try {
			const presets = await handle.ctx.agentPresets.list();
			const lab = presets.find((preset) => preset.id === "lab-research");
			assert.ok(lab, "lab-research declared");
			assert.equal(lab.name, "iBM科研Agent");
			assert.match(lab.description, /Nature Skills/);
			assert.equal(handle.ctx.agentPresets.defaultId, "lab-research");
			// bootLite 只有 storage + lab 行，没有 dsh-base 的 tools/systemPrompt/skills
			// 等宿主服务，所以声明里的行会停在 "waiting for"；这恰好证明 Loader 接受
			// 了声明并真的逐行激活。真正要红的是结构性错误：包解析不到、配置非法。
			if (lab.broken !== undefined) {
				assert.doesNotMatch(
					lab.broken,
					/Cannot find package|invalid config|no plugin|not a plugin row/,
					`preset 声明必须结构合法，实际诊断：${lab.broken}`
				);
				assert.match(lab.broken, /waiting for /);
			}

			// the declared composition must contain the skill-routing rows
			const document = await handle.ctx.agentPresets.readDocument("lab-research");
			assert.equal(document.agentPreset, "lab-research");
			const text = document.content;
			assert.match(text, /tool-skill/);
			assert.match(text, /skill-filesystem/);
			assert.match(text, /@deepseek-ai\/dsh-skill-filesystem/);
			// 课题工具（文档转换 + 核心记忆）挂在 preset 工具层，仅科研会话可见
			assert.match(text, /lab-convert-tool/);
			assert.match(text, /lab-memory-tool/);
			assert.match(text, /dsh-lab-agent\/convert-tool/);
			assert.match(text, /dsh-lab-agent\/memory-tool/);
		} finally {
			await handle.dispose();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
