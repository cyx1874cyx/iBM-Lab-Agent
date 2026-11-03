import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

const fileUrl = relative => pathToFileURL(join(repoRoot, relative)).href;

/**
 * 远程路由验收：`lab.characterization_*` 现在按行归属把新任务写进插件域，
 * 同时 list 必须合并母包历史行，绘图/旧数据不受影响。
 */
test("characterization_* 远程接口把新任务路由到核磁插件域", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-remote-routing-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [
			{ id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
			{ id: "api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
			{ id: "lab-nmr", name: fileUrl("lib/nmr.js"), inject: ["storageDomain"] },
			{ id: "lab-plot-records", name: fileUrl("lib/plot-records.js"), inject: ["storageDomain"] },
			{ id: "lab-characterization", name: fileUrl("lib/characterization.js"), inject: ["storageDomain", "ibmCore", "labNmr", "labPlotRecords"] },
			{ id: "lab-nmr-tasks", name: fileUrl("plugins/nmr/lib/index.js"), inject: ["storageDomain", "ibmCore"] },
			{ id: "lab-plot-tasks", name: fileUrl("plugins/plotting/lib/index.js"), inject: ["storageDomain", "ibmCore"] },
			{ id: "lab-remote", name: fileUrl("lib/remote.js"), inject: ["ibmCore"] }
		]
	});
	const invoke = (method, request) => handle.ctx.typertGateway.invoke({ namespace: "lab", method, args: request === undefined ? {} : { request } });
	try {
		const project = await handle.ctx.ibmCore.createProject({ id: "route-project", name: "路由验收" });
		const workspace = await handle.ctx.ibmCore.ensureProjectWorkspace(project.id);
		await writeFile(join(workspace.path, "raw.mnova"), Buffer.from("raw"));
		await writeFile(join(workspace.path, "mol.mol"), Buffer.from("C1\n  mol\n"));

		const saved = await invoke("characterization_nmr_save", { projectId: project.id, taskId: "route-nmr-1", inputPath: "raw.mnova", structurePath: "mol.mol", compound: { name: "P1" } });
		assert.equal(saved.task.id, "route-nmr-1", JSON.stringify(saved));
		assert.equal(handle.ctx.labNmrTasks.has("route-nmr-1"), true, "新草稿必须落在插件域");
		assert.equal(handle.ctx.get("labCharacterization").list(project.id).some(row => row.id === "route-nmr-1"), false, "不应再写旧表");

		const listed = await invoke("characterization_list", { projectId: project.id });
		assert.ok(listed.tasks.some(row => row.id === "route-nmr-1"), "list 必须包含插件域任务");

		const started = await invoke("characterization_nmr_start", { projectId: project.id, taskId: "route-nmr-1" });
		assert.equal(started.task.status, "queued");

		const cancelled = await invoke("characterization_nmr_cancel", { projectId: project.id, taskId: "route-nmr-1", attempt: started.task.attempt });
		assert.equal(cancelled.task.status, "draft");

		const restarted = await invoke("characterization_nmr_start", { projectId: project.id, taskId: "route-nmr-1" });
		const failed = await invoke("characterization_dispatch_failed", { projectId: project.id, taskId: "route-nmr-1", attempt: restarted.task.attempt, error: "会话创建失败" });
		assert.equal(failed.task.status, "failed");

		const retried = await invoke("characterization_retry", { projectId: project.id, taskId: "route-nmr-1" });
		assert.equal(retried.task.status, "queued");
		assert.equal(retried.task.attempt, restarted.task.attempt + 1);

		// 绘图任务走同一条路由：submit(kind=plot) 落绘图插件域，列表可见，重试可用。
		const plotSubmit = await invoke("characterization_submit", { projectId: project.id, kind: "plot", taskId: "route-plot-1", inputPath: "data.csv", title: "粒径分布" });
		assert.equal(plotSubmit.task.kind, "plot");
		assert.equal(handle.ctx.labPlotTasks.has("route-plot-1"), true, "绘图任务必须落在绘图插件域");
		const listedAfter = await invoke("characterization_list", { projectId: project.id });
		assert.ok(listedAfter.tasks.some(row => row.id === "route-plot-1"));
		const plotRetried = await invoke("characterization_retry", { projectId: project.id, taskId: "route-plot-1" });
		assert.equal(plotRetried.task.kind, "plot");
		assert.equal(plotRetried.task.attempt, 2);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
