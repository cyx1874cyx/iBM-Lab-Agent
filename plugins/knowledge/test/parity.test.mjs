import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDoi as pluginDoi } from "../lib/doi.js";
import { normalizeDoi as coreDoi } from "../../../src/literature/search-engine.js";
import { validateReadingFolderName as pluginFolder } from "../lib/folder.js";
import { validateReadingFolderName as coreFolder } from "../../../lib/tasks/organization.js";

/**
 * 插件内副本与母包实现的等价性：这些纯函数一旦漂移，
 * 知识库与文献域就会对"同一篇论文/同一个文件夹名"产生不同判断。
 */
test("DOI 归一化与母包逐字等价", () => {
	const cases = [
		"10.1021/ACS.MACROMOL.0C01234",
		"https://doi.org/10.1038/nature12373",
		"doi:10.1000/xyz123.",
		"10.5555/(SICI)1099-0844(199912)17:4<275::AID-CBF850>3.0.CO;2-E",
		"",
		"不是 DOI"
	];
	for (const value of cases) assert.equal(pluginDoi(value), coreDoi(value), `DOI 不一致：${value}`);
});

test("精读文件夹名校验与母包行为一致", () => {
	// 空白会被折叠成单个空格，因此换行不会被当作非法字符；两边必须同样处理。
	const accepted = ["课题组-2024", "  A   B  ", "line\nbreak"];
	for (const value of accepted) assert.equal(pluginFolder(value), coreFolder(value), `接受结果不一致：${JSON.stringify(value)}`);
	const rejected = ["", "全部", "未分类", "a/b", "x".repeat(81), "\u0001abc"];
	for (const value of rejected) {
		let pluginError, coreError;
		try { pluginFolder(value); } catch (error) { pluginError = error.message; }
		try { coreFolder(value); } catch (error) { coreError = error.message; }
		assert.equal(pluginError, coreError, `拒绝原因不一致：${JSON.stringify(value)}`);
		assert.ok(pluginError, `应当拒绝：${JSON.stringify(value)}`);
	}
});
