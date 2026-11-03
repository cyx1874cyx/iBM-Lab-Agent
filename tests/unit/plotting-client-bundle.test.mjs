import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * 绘图插件 bundle 的静态契约（不执行 bundle：它连带通用 UI 组件，
 * 需要完整浏览器环境；实际注册行为由浏览器回归覆盖）。
 * 这里保证：产物确实以唯一 id 自注册、确实调用项目面板注册表、导出 apply/inject。
 */
test("绘图插件 bundle 注册项目面板并导出 apply/inject", async () => {
	const code = await readFile(new URL("../../plugins/plotting/client/index.js", import.meta.url), "utf8");
	assert.equal((code.match(/__ModuleLoader__\.load\s*\(/g) ?? []).length, 1);
	assert.ok(code.includes('id: "@ibm-lab/plotting"'));
	assert.ok(code.includes("registerProjectPanel"));
	assert.ok(code.includes("exports.apply = apply"));
	assert.ok(code.includes('"plotting"'));
	assert.ok(code.includes("ibm-lab-plotting-style"));
});
