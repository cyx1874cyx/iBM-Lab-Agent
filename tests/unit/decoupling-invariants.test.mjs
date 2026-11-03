import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repoRoot, "scripts/check-decoupling.mjs");

/**
 * 架构不变量：母包不得静态依赖插件、插件 manifest 必须合法、母包装配不得登记插件。
 * 这条测试把所有"拆分完成"的硬约束钉进 CI，防止后续改动悄悄反转依赖方向。
 */
test("拆分不变量：母包零插件依赖，六个插件 manifest 合法", () => {
	const out = execFileSync(process.execPath, [script], { encoding: "utf8", cwd: repoRoot });
	assert.match(out, /拆分不变量检查通过/);
	assert.match(out, /6 个插件/);
});

test("不变量检查可输出机器可读结果", () => {
	const out = execFileSync(process.execPath, [script, "--json"], { encoding: "utf8", cwd: repoRoot });
	const parsed = JSON.parse(out);
	assert.equal(parsed.ok, true);
	assert.deepEqual(parsed.plugins.sort(), ["knowledge", "literature", "nmr", "plotting", "polishing", "reagents"]);
	assert.deepEqual(parsed.failures, []);
});
