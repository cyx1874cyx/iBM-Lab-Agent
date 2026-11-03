import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginSettingsBackend, PLUGINS } from "../../lib/plugin-settings.js";

async function fixture() {
	const home = await mkdtemp(join(tmpdir(), "ibm-plugin-settings-"));
	const profile = join(home, "profiles", "ibm-lab");
	await mkdir(join(profile, "node_modules", "@ibm-lab"), { recursive: true });
	for (const plugin of PLUGINS) await mkdir(join(profile, "node_modules", ...plugin.package.split("/")), { recursive: true });
	await writeFile(join(profile, "package.json"), JSON.stringify({
		name: "profile", version: "0.0.0",
		dependencies: Object.fromEntries(PLUGINS.map(plugin => [plugin.package, "file:plugins"])),
		dsh: { profile: { bundles: PLUGINS.map(plugin => plugin.package) } }
	}, null, 2));
	return { home, profile };
}

test("子插件设置：默认全开，软开关落盘且不影响硬开关", async () => {
	const { home } = await fixture();
	const previous = process.env.DSH_HOME;
	process.env.DSH_HOME = home;
	try {
		const service = new PluginSettingsBackend({});
		const initial = await service.list();
		assert.equal(initial.plugins.length, 6);
		for (const row of initial.plugins) {
			assert.equal(row.soft, true);
			assert.equal(row.hard, true);
			assert.equal(row.installed, true);
		}
		const after = await service.setSoft({ id: "nmr", enabled: false });
		assert.equal(after.plugins.find(row => row.id === "nmr").soft, false);
		assert.equal(after.plugins.find(row => row.id === "nmr").hard, true, "软开关不应改装配");
		assert.equal(after.restartRequired, false);
		const flags = JSON.parse(await readFile(join(home, "lab-agent", "plugin-flags.json"), "utf8"));
		assert.equal(flags.soft.nmr, false);
	} finally {
		if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
});

test("子插件设置：硬启停改写 profile 的 bundles 并要求重启", async () => {
	const { home, profile } = await fixture();
	const previous = process.env.DSH_HOME;
	process.env.DSH_HOME = home;
	try {
		const service = new PluginSettingsBackend({});
		const after = await service.setHard({ id: "plotting", enabled: false });
		assert.equal(after.plugins.find(row => row.id === "plotting").hard, false);
		assert.equal(after.restartRequired, true);
		const manifest = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
		assert.equal(manifest.dsh.profile.bundles.includes("@ibm-lab/plotting"), false);
		assert.ok(manifest.dependencies["@ibm-lab/plotting"], "依赖保留，重新启用不需要重装");
		await service.setHard({ id: "plotting", enabled: true });
		const restored = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
		assert.ok(restored.dsh.profile.bundles.includes("@ibm-lab/plotting"));
	} finally {
		if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
});

test("子插件设置：未知 id 被拒绝", async () => {
	const service = new PluginSettingsBackend({});
	await assert.rejects(() => service.setSoft({ id: "nope", enabled: false }), /未知子插件/);
});
