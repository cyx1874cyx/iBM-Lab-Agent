import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReadingFolderName as pluginValidate } from "../lib/tasks/organization.js";
import { validateReadingFolderName as coreValidate } from "../../../lib/tasks/organization.js";

/**
 * 插件与母包对文件夹名的判断必须一致：迁移期两边会同时存在，
 * 任何一处放宽/收紧都会让"同一个文件夹在两套代码里叫法不同"。
 */
test("精读文件夹名校验与母包一致", () => {
	for (const value of ["课题组-2024", "  A   B  "]) assert.equal(pluginValidate(value), coreValidate(value));
	for (const value of ["", "全部", "未分类", "a/b", "x".repeat(81)]) {
		let pluginError, coreError;
		try { pluginValidate(value); } catch (error) { pluginError = error.message; }
		try { coreValidate(value); } catch (error) { coreError = error.message; }
		assert.equal(pluginError, coreError, `拒绝原因不一致：${JSON.stringify(value)}`);
		assert.ok(pluginError);
	}
});
