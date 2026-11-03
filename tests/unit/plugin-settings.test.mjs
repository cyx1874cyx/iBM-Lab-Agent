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

test("可选功能：默认全部启用，禁用会改写 bundles 并要求重启", async () => {
	const { home, profile } = await fixture();
	const previous = process.env.DSH_HOME;
	process.env.DSH_HOME = home;
	try {
		const backend = new PluginSettingsBackend({});
		const initial = await backend.list();
		assert.equal(initial.plugins.length, 6);
		for (const row of initial.plugins) {
			assert.equal(row.enabled, true);
			assert.equal(row.installed, true);
		}
		const after = await backend.setEnabled({ id: "nmr", enabled: false });
		assert.equal(after.plugins.find(row => row.id === "nmr").enabled, false);
		assert.equal(after.restartRequired, true);
		const manifest = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
		assert.equal(manifest.dsh.profile.bundles.includes("@ibm-lab/nmr"), false);
		assert.ok(manifest.dependencies["@ibm-lab/nmr"], "依赖保留，重新启用不需要重装");
		await backend.setEnabled({ id: "nmr", enabled: true });
		const restored = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
		assert.ok(restored.dsh.profile.bundles.includes("@ibm-lab/nmr"));
	} finally {
		if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
});

test("可选功能：顺序写入 order 文件并按顺序返回", async () => {
	const { home } = await fixture();
	const previous = process.env.DSH_HOME;
	process.env.DSH_HOME = home;
	try {
		const backend = new PluginSettingsBackend({});
		const after = await backend.setOrder({ order: ["plotting", "literature", "knowledge", "reagents", "nmr", "polishing"] });
		assert.deepEqual(after.order, ["plotting", "literature", "knowledge", "reagents", "nmr", "polishing"]);
		assert.equal(after.plugins[0].id, "plotting");
		const stored = JSON.parse(await readFile(join(home, "lab-agent", "plugin-order.json"), "utf8"));
		assert.deepEqual(stored.order, after.order);
		assert.equal(after.restartRequired, true);
	} finally {
		if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
});

test("可选功能：未知 id 被拒绝", async () => {
	const backend = new PluginSettingsBackend({});
	await assert.rejects(() => backend.setEnabled({ id: "nope", enabled: false }), /未知子插件/);
	await assert.rejects(() => backend.setOrder({ order: ["nope"] }), /未知子插件/);
});
