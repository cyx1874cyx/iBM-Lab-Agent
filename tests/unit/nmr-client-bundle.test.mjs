import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** 核磁插件 bundle 契约：唯一 id 自注册、调用项目面板注册表、导出 apply/inject、带样式。 */
test("核磁插件 bundle 注册课题页 characterization 面板", async () => {
	const code = await readFile(new URL("../../plugins/nmr/client/index.js", import.meta.url), "utf8");
	assert.equal((code.match(/__ModuleLoader__\.load\s*\(/g) ?? []).length, 1);
	assert.ok(code.includes('id: "@ibm-lab/nmr"'));
	assert.ok(code.includes("registerProjectPanel"));
	assert.ok(code.includes('"characterization"'));
	assert.ok(code.includes("ibm-lab-nmr-style"));
	assert.ok(code.includes("exports.apply = apply"));
});
