import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 部署布局冒烟：在临时 profile 里以**包名**安装链接，再按包名 import 每个插件，
 * 并检查各自的 cordis.patch.yml 确实用包名装配。这覆盖了 exports/入口/装配名三件事。
 */
test("插件包按包名安装后可加载，且装配行使用包名", () => {
	const out = execFileSync(process.execPath, [join(repoRoot, "scripts/smoke-plugin-packages.mjs")], { encoding: "utf8", cwd: repoRoot });
	assert.match(out, /插件包冒烟通过：6 个/);
	for (const name of ["knowledge", "literature", "nmr", "plotting", "polishing", "reagents"]) {
		assert.match(out, new RegExp(`ok @ibm-lab/${name}`));
	}
});
