import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/** 绘图插件：自有任务域 + 历史 kind=plot 迁移，且只装 core+插件即可运行。 */
test("绘图子插件独立装配：新建/更新/删除任务并迁移历史 plot 任务", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-plot-plugin-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [{
			id: "lab-plot-tasks",
			name: pathToFileURL(join(repoRoot, "plugins/plotting/lib/index.js")).href,
			inject: ["storageDomain", "ibmCore"]
		}]
	});
	try {
		const service = handle.ctx.get("labPlotTasks");
		assert.ok(service, "labPlotTasks 应能独立启动");
		const project = await handle.ctx.ibmCore.createProject({ id: "plot-project", name: "绘图课题" });

		await assert.rejects(service.create({ projectId: project.id, title: "无数据" }), /绘图数据/);
		const created = await service.create({ projectId: project.id, title: "粒径分布", inputPath: "data.csv" });
		assert.equal(created.task.status, "queued");
		assert.equal(created.task.kind, "plot");
		assert.match(created.prompt, /绘图/);

		const failed = await service.update(created.task.id, project.id, 1, "failed", "origin 未启动");
		assert.equal(failed.status, "failed");
		await service.remove(created.task.id, project.id);
		assert.deepEqual(service.list(project.id), []);
		const base = { projectId: project.id, date: "2026-11-01", instructions: "迁移验证", attempt: 1, artifacts: {}, artifactHistory: [], createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
		const moved = await service.importLegacyRows([
			{ ...base, id: "legacy-plot-2", kind: "plot", title: "历史绘图", status: "failed" },
			{ ...base, id: "legacy-nmr-2", kind: "nmr", title: "历史核磁", status: "failed" }
		]);
		assert.equal(moved, 1);
		assert.deepEqual(service.list(project.id).map(row => row.id), ["legacy-plot-2"]);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
