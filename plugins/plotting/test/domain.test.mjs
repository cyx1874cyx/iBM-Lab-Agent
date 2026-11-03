import { test } from "node:test";
import assert from "node:assert/strict";
import { plotTaskDomain } from "../lib/domain.js";

test("绘图任务域命名与表结构固定（迁移契约）", () => {
	assert.equal(plotTaskDomain.name, "lab_plot_tasks");
	assert.equal(plotTaskDomain.version, 0);
	assert.deepEqual(Object.keys(plotTaskDomain.tables), ["tasks"]);
});
