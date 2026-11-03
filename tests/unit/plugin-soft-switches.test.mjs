import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorkbenchModule, listWorkbenchModules } from "../../client/src/module-registry.js";
import { registerProjectPanel, projectPanelFor } from "../../client/src/panel-registry.js";
import { setPluginEnabled } from "../../client/src/plugin-switches.js";

/** 软启停必须同时作用于工作台模块与课题页签，并且回退到内置面板。 */
test("软启停隐藏工作台模块，恢复后重新出现", () => {
	const dispose = registerWorkbenchModule({ id: "reagents", label: "试剂管理", render: () => null });
	try {
		assert.ok(listWorkbenchModules().some(row => row.id === "reagents"));
		setPluginEnabled("reagents", false);
		assert.ok(!listWorkbenchModules().some(row => row.id === "reagents"));
		setPluginEnabled("reagents", true);
		assert.ok(listWorkbenchModules().some(row => row.id === "reagents"));
	} finally {
		dispose();
	}
});

test("软启停让课题页签回退内置面板（projectPanelFor 返回 undefined）", () => {
	const dispose = registerProjectPanel({ id: "characterization", pluginId: "nmr", label: "核磁解析", render: () => null });
	try {
		assert.ok(projectPanelFor("characterization"));
		setPluginEnabled("nmr", false);
		assert.equal(projectPanelFor("characterization"), undefined, "停用核磁插件后应回退母包内置面板");
		setPluginEnabled("nmr", true);
		assert.ok(projectPanelFor("characterization"));
	} finally {
		dispose();
	}
});
