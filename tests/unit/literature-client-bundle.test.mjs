import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** 文献插件 bundle 契约：唯一 id、注册 literature 页签、导出 apply/inject。 */
test("文献插件 bundle 注册课题页 literature 面板", async () => {
	const code = await readFile(new URL("../../plugins/literature/client/index.js", import.meta.url), "utf8");
	assert.equal((code.match(/__ModuleLoader__\.load\s*\(/g) ?? []).length, 1);
	assert.ok(code.includes('id: "@ibm-lab/literature"'));
	assert.ok(code.includes("registerProjectPanel"));
	assert.ok(code.includes('"literature"'));
	assert.ok(code.includes("exports.apply = apply"));
	assert.ok(code.includes("exports.inject = inject"));
});
