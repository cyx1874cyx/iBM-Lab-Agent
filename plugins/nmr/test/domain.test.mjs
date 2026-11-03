import { test } from "node:test";
import assert from "node:assert/strict";
import { nmrTaskDomain } from "../lib/domain.js";

test("核磁任务域命名与表结构固定（迁移契约）", () => {
	assert.equal(nmrTaskDomain.name, "lab_nmr_tasks");
	assert.equal(nmrTaskDomain.version, 0);
	assert.deepEqual(Object.keys(nmrTaskDomain.tables), ["tasks"]);
});
