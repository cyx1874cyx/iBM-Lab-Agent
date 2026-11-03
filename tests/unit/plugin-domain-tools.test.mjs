import { test } from "node:test";
import assert from "node:assert/strict";
import { registerMnovaTools as nmrMnovaTools } from "../../plugins/nmr/lib/mnova-tools.js";
import { apply as nmrSimulationTools } from "../../plugins/nmr/lib/simulation-tools.js";
import { registerPlotEditorTools as plotTools } from "../../plugins/plotting/lib/plot-tools.js";
import { apply as motherCharacterizationTools } from "../../lib/characterization-tool.js";

/** 领域工具归属：Mnova/模拟/绘图编辑工具随各自插件注册，母包不再注册它们。 */
function collect(apply) {
	const names = [];
	apply({
		tools: { register: tool => names.push(tool.name) },
		get: () => undefined,
		root: { get: () => undefined },
		ibmAnalysis: {}, labCharacterization: {},
		labTasks: { getProject: () => undefined }
	});
	return names;
}

test("Mnova 工具随核磁插件注册", () => {
	// Mnova 工具只在桌面封装环境注册；这里显式模拟桌面判据。
	const previous = process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;
	process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = "C:\\python.exe";
	try {
		const names = collect(nmrMnovaTools);
		for (const expected of ["mnova_status", "mnova_probe_runtime", "mnova_process_1d", "mnova_prepare_structure_1d"]) {
			assert.ok(names.includes(expected), `应注册 ${expected}`);
		}
	} finally {
		if (previous === undefined) delete process.env.IBM_LAB_AGENT_BUNDLED_PYTHON;
		else process.env.IBM_LAB_AGENT_BUNDLED_PYTHON = previous;
	}
});

test("模拟工具随核磁插件注册", () => {
	const names = collect(nmrSimulationTools);
	assert.deepEqual(names, ["lab_nmr_simulation_structure", "lab_nmr_simulation_run"]);
});

test("绘图编辑工具随绘图插件注册", () => {
	const names = collect(plotTools);
	assert.ok(names.includes("lab_plot_editor_state"));
	assert.ok(names.includes("lab_plot_editor_apply"));
});

test("母包 characterization-tool 不再注册领域工具，只保留通用任务工具", () => {
	const names = collect(motherCharacterizationTools);
	assert.ok(!names.some(name => name.startsWith("mnova_")), "Mnova 工具应已迁出");
	assert.ok(!names.some(name => name.startsWith("lab_nmr_simulation")), "模拟工具应已迁出");
	assert.ok(!names.some(name => name.startsWith("lab_plot_editor")), "绘图工具应已迁出");
	for (const expected of ["lab_characterization_submit", "lab_characterization_preflight", "lab_characterization_update", "lab_characterization_complete", "lab_characterization_recomplete"]) {
		assert.ok(names.includes(expected), `母包应保留 ${expected}`);
	}
});
