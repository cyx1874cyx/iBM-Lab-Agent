import { test } from "node:test";
import assert from "node:assert/strict";
import { polishingStatus } from "../lib/service.js";

test("占位状态明确标注未实现，且不注册任何执行能力", () => {
	const status = polishingStatus();
	assert.equal(status.implemented, false);
	assert.equal(status.label, "论文润色");
	assert.match(status.reason, /尚未实现/);
	assert.ok(Array.isArray(status.planned) && status.planned.length > 0);
	assert.equal(status.tools, undefined, "占位插件不得声明工具");
});

test("polishingStatus 返回副本，调用方修改不影响常量", () => {
	polishingStatus().planned.push("越权修改");
	assert.equal(polishingStatus().planned.includes("越权修改"), false);
});
