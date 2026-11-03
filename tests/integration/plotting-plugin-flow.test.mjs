import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

const fileUrl = relative => pathToFileURL(join(repoRoot, relative)).href;

/** 绘图任务全流程：创建 → 失败 → 重试 → 完成登记（写绘图记录）→ 读取产物 → 删除。 */
test("绘图插件可完成 创建/重试/完成/产物/删除 全流程", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-plot-flow-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [
			{ id: "lab-plot-records", name: fileUrl("lib/plot-records.js"), inject: ["storageDomain"] },
			{ id: "lab-plot-tasks", name: fileUrl("plugins/plotting/lib/index.js"), inject: ["storageDomain", "ibmCore"] }
		]
	});
	try {
		const service = handle.ctx.get("labPlotTasks");
		const records = handle.ctx.get("labPlotRecords");
		assert.ok(service && records);

		const project = await handle.ctx.ibmCore.createProject({ id: "plot-flow", name: "绘图流程" });
		const workspace = await handle.ctx.ibmCore.ensureProjectWorkspace(project.id);
		await writeFile(join(workspace.path, "data.csv"), Buffer.from("x,y\n1,2\n"));
		await writeFile(join(workspace.path, "chart.opju"), Buffer.from("origin-project"));

		const created = await service.create({ projectId: project.id, title: "粒径分布", inputPath: "data.csv" });
		assert.equal(created.task.status, "queued");

		await service.update(created.task.id, project.id, created.task.attempt, "failed", "origin 未启动");
		const retried = await service.retry(created.task.id, project.id);
		assert.equal(retried.task.status, "queued");
		assert.equal(retried.task.attempt, 2);

		const completed = await service.complete(created.task.id, project.id, { attempt: retried.task.attempt, originPath: "chart.opju" });
		assert.equal(completed.status, "completed");
		assert.match(completed.artifacts.origin.sha256, /^[a-f0-9]{64}$/);
		const record = await records.get(created.task.id);
		assert.equal(record.projectId, project.id);
		assert.match(record.artifactPath, /chart\.opju$/);

		const artifact = await service.artifactFile(created.task.id, project.id, "origin");
		assert.equal(artifact.fileName, "chart.opju");
		assert.equal(artifact.buffer.toString(), "origin-project");

		const cleared = await service.remove(created.task.id, project.id, "plot", [], "outputs");
		assert.equal(cleared.entryPreserved, true);
		await assert.rejects(readFile(join(workspace.path, "chart.opju")), /ENOENT/);
		assert.deepEqual(service.get(created.task.id, project.id).artifacts, {});

		const wiped = await service.remove(created.task.id, project.id, "plot", [], "record");
		assert.equal(wiped.id, created.task.id);
		assert.deepEqual(service.list(project.id), []);
		const leftover = await records.get(created.task.id).catch(() => undefined);
		assert.ok(!leftover, "绘图记录应已删除");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
