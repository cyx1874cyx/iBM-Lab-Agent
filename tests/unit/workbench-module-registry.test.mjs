import { test } from "node:test";
import assert from "node:assert/strict";
import {
	registerWorkbenchModule,
	listWorkbenchModules,
	subscribeWorkbenchModules
} from "../../client/src/module-registry.js";

const REGISTRY_KEY = Symbol.for("ibm.lab.workbench");
const reset = () => { delete globalThis[REGISTRY_KEY]; };
const module = (id, extra = {}) => ({ id, label: `模块 ${id}`, render: () => null, ...extra });

test("注册模块后可按 order/label 列出，并补齐默认字段", () => {
	reset();
	registerWorkbenchModule(module("b", { order: 50 }));
	registerWorkbenchModule(module("a", { caption: "说明", icon: "flask", order: 10 }));
	const rows = listWorkbenchModules();
	assert.deepEqual(rows.map(row => row.id), ["a", "b"]);
	assert.equal(rows[0].caption, "说明");
	assert.equal(rows[0].icon, "flask");
	assert.equal(rows[1].caption, "");
	assert.equal(rows[1].icon, "file");
	assert.equal(rows[1].order, 50);
});

test("同 id 重复注册视为替换；旧注销函数不得删除新版本", () => {
	reset();
	const dispose = registerWorkbenchModule(module("x", { order: 1 }));
	registerWorkbenchModule(module("x", { order: 2, caption: "新" }));
	assert.equal(listWorkbenchModules().length, 1);
	assert.equal(listWorkbenchModules()[0].caption, "新");
	dispose();
	assert.equal(listWorkbenchModules().length, 1, "旧版本的注销函数不应移除新注册");
});

test("注销函数移除注册并通知订阅者", () => {
	reset();
	let calls = 0;
	const unsubscribe = subscribeWorkbenchModules(() => { calls++; });
	const dispose = registerWorkbenchModule(module("y"));
	assert.equal(calls, 1);
	dispose();
	assert.equal(calls, 2);
	assert.deepEqual(listWorkbenchModules(), []);
	unsubscribe();
	registerWorkbenchModule(module("z"));
	assert.equal(calls, 2, "取消订阅后不应再收到通知");
});

test("缺失 id/label/render 时明确拒绝", () => {
	reset();
	assert.throws(() => registerWorkbenchModule(null), /对象/);
	assert.throws(() => registerWorkbenchModule({ label: "x", render: () => null }), /id/);
	assert.throws(() => registerWorkbenchModule({ id: "x", render: () => null }), /label/);
	assert.throws(() => registerWorkbenchModule({ id: "x", label: "x" }), /render/);
	assert.deepEqual(listWorkbenchModules(), []);
});
