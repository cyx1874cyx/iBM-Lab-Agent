import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";
import { PROJECT_ID } from "../fixtures/legacy-task-owner.mjs";

const fileUrl = relative => pathToFileURL(join(repoRoot, relative)).href;
const fixtureUrl = relative => pathToFileURL(join(repoRoot, "tests/fixtures", relative)).href;

/** 六个插件 + 一个历史任务所有者夹具。 */
function compositionRows(dir) {
	return [
		{ id: "ibm-runtime", name: fileUrl("lib/runtime.js"), inject: ["ibmCore"], config: { skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), venvDir: join(dir, "venv") } },
		{ id: "lab-knowledge", name: fileUrl("plugins/knowledge/lib/index.js"), inject: ["ibmCore"], config: { root: join(dir, "knowledge") } },
		{ id: "lab-literature", name: fileUrl("plugins/literature/lib/index.js"), inject: ["ibmCore", "ibmRuntime"], config: { skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), venvDir: join(dir, "venv") } },
		{ id: "lab-nmr-tasks", name: fileUrl("plugins/nmr/lib/index.js"), inject: ["storageDomain", "ibmCore"] },
		{ id: "lab-plot-tasks", name: fileUrl("plugins/plotting/lib/index.js"), inject: ["storageDomain", "ibmCore"] },
		{ id: "lab-reagents", name: fileUrl("plugins/reagents/lib/index.js"), config: { root: join(dir, "reagents") } },
		{ id: "lab-polishing", name: fileUrl("plugins/polishing/lib/index.js") },
		{ id: "legacy-owner", name: fixtureUrl("legacy-task-owner.mjs") }
	];
}

const SERVICES = ["labKnowledge", "labLiteratureTasks", "labNmrTasks", "labPlotTasks", "labReagents", "labPolishing"];
const ROW_OF = {
	labKnowledge: "lab-knowledge",
	labLiteratureTasks: "lab-literature",
	labNmrTasks: "lab-nmr-tasks",
	labPlotTasks: "lab-plot-tasks",
	labReagents: "lab-reagents",
	labPolishing: "lab-polishing"
};

async function waitFor(condition, timeout = 5000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (condition()) return true;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	return condition();
}

/**
 * 装配验收：六个插件同时启动、互不覆盖；任意一个缺席时其余照常工作；
 * 两个任务插件都能从历史所有者拉取并只认领自己 kind 的行。
 */
test("六个子插件可同时装配，且单个缺席不影响其余插件", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-plugin-composition-"));
	const storageRoot = join(dir, "storage");
	try {
		let handle = await bootLite({ storageRoot, coreOnly: true, extraRows: compositionRows(dir) });
		try {
			for (const name of SERVICES) assert.ok(handle.ctx.get(name), `${name} 应已启动`);
			assert.ok(handle.ctx.get("labCharacterization"), "历史所有者夹具应在场");
			assert.equal(handle.ctx.get("ibmLiteratureWorkflows"), undefined, "旧文献壳不应被插件拉起");

			const ok = await waitFor(() => {
				const nmr = handle.ctx.labNmrTasks.list(PROJECT_ID).map(row => row.id).join();
				const plot = handle.ctx.labPlotTasks.list(PROJECT_ID).map(row => row.id).join();
				return nmr === "legacy-nmr-c" && plot === "legacy-plot-c";
			});
			assert.ok(ok, "两个插件应在启动后从历史所有者拉取各自任务");
			assert.deepEqual(handle.ctx.labNmrTasks.list(PROJECT_ID).map(row => row.kind), ["nmr"]);
			assert.deepEqual(handle.ctx.labPlotTasks.list(PROJECT_ID).map(row => row.kind), ["plot"]);
		} finally {
			await handle.dispose();
		}

		// 逐个停用：其余五个必须照常启动（历史所有者仍在）。
		for (const dropped of SERVICES) {
			const rows = compositionRows(dir).filter(row => row.id !== ROW_OF[dropped]);
			const other = await bootLite({ storageRoot, coreOnly: true, extraRows: rows });
			try {
				for (const name of SERVICES.filter(name => name !== dropped)) {
					assert.ok(other.ctx.get(name), `停用 ${dropped} 后 ${name} 应仍启动`);
				}
				assert.equal(other.ctx.get(dropped), undefined);
			} finally {
				await other.dispose();
			}
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
