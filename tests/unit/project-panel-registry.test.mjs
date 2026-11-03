import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerProjectPanel, projectPanelFor, listProjectPanels } from "../../client/src/panel-registry.js";

const REGISTRY_KEY = Symbol.for("ibm.lab.project-panels");
const reset = () => { delete globalThis[REGISTRY_KEY]; };
const panel = (id, extra = {}) => ({ id, render: () => null, ...extra });

test("项目面板注册 / 查询 / 注销", () => {
	reset();
	const dispose = registerProjectPanel(panel("plotting", { label: "科研绘图" }));
	assert.equal(projectPanelFor("plotting")?.label, "科研绘图");
	assert.equal(listProjectPanels().length, 1);
	dispose();
	assert.equal(projectPanelFor("plotting"), undefined);
	assert.equal(listProjectPanels().length, 0);
});

test("同 id 替换后旧注销函数不得移除新版本", () => {
	reset();
	const first = registerProjectPanel(panel("characterization"));
	registerProjectPanel(panel("characterization", { label: "核磁解析" }));
	first();
	assert.equal(projectPanelFor("characterization")?.label, "核磁解析");
});

test("缺 id/render 时明确拒绝", () => {
	reset();
	assert.throws(() => registerProjectPanel(null), /对象/);
	assert.throws(() => registerProjectPanel({ render: () => null }), /id/);
	assert.throws(() => registerProjectPanel({ id: "x" }), /render/);
});
