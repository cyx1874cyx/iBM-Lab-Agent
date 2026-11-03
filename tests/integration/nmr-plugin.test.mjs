import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/**
 * 核磁插件：自有任务域 + 历史数据迁移 + 草稿/启动/删除全链路，
 * 并且只装 core + 插件即可运行（不依赖 characterization / 绘图域）。
 */
test("核磁子插件独立装配：草稿→启动→失败→删除，并迁移历史 nmr 任务", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-nmr-plugin-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [{
			id: "lab-nmr-tasks",
			name: pathToFileURL(join(repoRoot, "plugins/nmr/lib/index.js")).href,
			inject: ["storageDomain", "ibmCore"]
		}]
	});
	try {
		const service = handle.ctx.get("labNmrTasks");
		assert.ok(service, "labNmrTasks 应能独立启动");
		assert.equal(handle.ctx.get("labCharacterization"), undefined, "不应拉起旧 characterization 服务");

		const project = await handle.ctx.ibmCore.createProject({ id: "nmr-project", name: "核磁课题" });
		const workspace = await handle.ctx.ibmCore.ensureProjectWorkspace(project.id);
		await writeFile(join(workspace.path, "raw.mnova"), Buffer.from("fake-mnova"));
		await writeFile(join(workspace.path, "mol.mol"), Buffer.from("P1\n  test\n"));

		const draft = await service.saveNmrDraft({ taskId: "nmr-task-1", projectId: project.id, inputPath: "raw.mnova", structurePath: "mol.mol", compound: { name: "P1" } });
		assert.equal(draft.task.status, "draft");
		assert.equal(draft.task.kind, "nmr");
		assert.match(draft.task.inputSha256, /^[a-f0-9]{64}$/);

		const started = await service.startNmr("nmr-task-1", project.id);
		assert.equal(started.task.status, "queued");
		assert.match(started.prompt, /核磁/);

		await service.update("nmr-task-1", project.id, started.task.attempt, "failed", "mnova 不可用");
		const removed = await service.remove("nmr-task-1", project.id);
		assert.equal(removed.id, "nmr-task-1");
		assert.equal(removed.kind, "nmr");
		assert.deepEqual(service.list(project.id), []);

		// 历史行迁移：只搬 kind=nmr，且旧行保留在历史表（这里用快照模拟读取）。
		const base = { projectId: project.id, date: "2026-11-01", instructions: "迁移验证", attempt: 1, artifacts: {}, artifactHistory: [], createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
		const moved = await service.importLegacyRows([
			{ ...base, id: "legacy-nmr-1", kind: "nmr", title: "历史核磁", status: "failed" },
			{ ...base, id: "legacy-plot-1", kind: "plot", title: "历史绘图", status: "failed" }
		]);
		assert.equal(moved, 1);
		assert.deepEqual(service.list(project.id).map(row => row.id), ["legacy-nmr-1"]);
		assert.equal(await service.importLegacyRows([{ ...base, id: "legacy-nmr-1", kind: "nmr", title: "历史核磁", status: "failed" }]), 0, "重复迁移应幂等");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
