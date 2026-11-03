import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repoRoot, "scripts/register-plugins.mjs");

async function makeHome() {
	const home = await mkdtemp(join(tmpdir(), "ibm-register-"));
	const profile = join(home, "profiles", "ibm-lab");
	await mkdir(join(profile, "node_modules"), { recursive: true });
	await writeFile(join(profile, "package.json"), JSON.stringify({ name: "ibm-lab-profile", version: "0.0.0", dependencies: {} }, null, 2));
	return { home, profile };
}

const run = (args, home) => {
	try {
		return { code: 0, out: execFileSync(process.execPath, [script, "--home", home, ...args], { encoding: "utf8", cwd: repoRoot }) };
	} catch (error) {
		return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
	}
};

test("注册脚本幂等：登记全部插件、重复执行无变更、--check 通过", async () => {
	const { home, profile } = await makeHome();
	try {
		const first = run([], home);
		assert.equal(first.code, 0, first.out);
		const manifest = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
		const names = Object.keys(manifest.dependencies).sort();
		assert.deepEqual(names, ["@ibm-lab/knowledge", "@ibm-lab/literature", "@ibm-lab/nmr", "@ibm-lab/plotting", "@ibm-lab/polishing", "@ibm-lab/reagents"]);
		assert.deepEqual([...manifest.dsh.profile.bundles].sort(), names, "DSH 只激活 dsh.profile.bundles 里登记的包");
		for (const name of names) assert.ok(existsSync(join(profile, "node_modules", ...name.split("/"), "package.json")), `${name} 应已安装`);

		const second = run([], home);
		assert.match(second.out, /无变更/);
		const checked = run(["--check"], home);
		assert.equal(checked.code, 0, checked.out);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("停用插件会移除依赖与目录，但不影响其它插件", async () => {
	const { home, profile } = await makeHome();
	try {
		run([], home);
		const off = run(["--disable", "polishing"], home);
		assert.equal(off.code, 0, off.out);
		const manifest = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
		assert.equal(Object.hasOwn(manifest.dependencies, "@ibm-lab/polishing"), false);
		assert.equal(manifest.dsh.profile.bundles.includes("@ibm-lab/polishing"), false, "停用后不得留在激活列表");
		assert.equal(existsSync(join(profile, "node_modules", "@ibm-lab", "polishing")), false);
		assert.ok(Object.hasOwn(manifest.dependencies, "@ibm-lab/reagents"));
		const checked = run(["--disable", "polishing", "--check"], home);
		assert.equal(checked.code, 0, checked.out);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("未知插件名直接拒绝", async () => {
	const { home } = await makeHome();
	try {
		const result = run(["--plugins", "nope"], home);
		assert.equal(result.code, 2);
		assert.match(result.out, /未知插件/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("登记结果被 DSH 识别为已启用 bundle", async () => {
	const { home, profile } = await makeHome();
	try {
		run([], home);
		const { readProfilePlugins } = await import("@deepseek-ai/dsh-app-boot");
		// DSH 用 installAnchor + profileDir 解析 bundle；这里以 profile manifest 作锚点。
		const info = readProfilePlugins({ binName: "dsh", profileDir: profile, installAnchor: join(profile, "package.json") });
		const rows = info.dependencies.filter(row => row.name.startsWith("@ibm-lab/"));
		assert.equal(rows.length, 6);
		for (const row of rows) {
			assert.equal(row.bundle, true, `${row.name} 应声明 dsh.bundle`);
			assert.equal(row.enabled, true, `${row.name} 应被 DSH 激活`);
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
