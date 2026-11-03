import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

const fileUrl = relative => pathToFileURL(join(repoRoot, relative)).href;

async function docxBuffer() {
	const zip = new JSZip();
	zip.file("word/document.xml", "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>");
	return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * 核磁任务全流程：草稿 → 启动 → 取消 → 再启动 → 失败 → 重试 → 完成登记 → 读取产物。
 * 数据集服务用母包 labNmr（插件经 root 取用），验证跨服务协作而非代码依赖。
 */
test("核磁插件可完成 启动/取消/重试/完成 全流程", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-nmr-flow-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [
			{ id: "lab-nmr", name: fileUrl("lib/nmr.js"), inject: ["storageDomain"] },
			{ id: "lab-nmr-tasks", name: fileUrl("plugins/nmr/lib/index.js"), inject: ["storageDomain", "ibmCore"] }
		]
	});
	try {
		const service = handle.ctx.get("labNmrTasks");
		assert.ok(service);
		const project = await handle.ctx.ibmCore.createProject({ id: "nmr-flow", name: "核磁流程" });
		const workspace = await handle.ctx.ibmCore.ensureProjectWorkspace(project.id);
		await writeFile(join(workspace.path, "raw.mnova"), Buffer.from("fake-mnova"));
		await writeFile(join(workspace.path, "mol.mol"), Buffer.from("C1\n  test\n"));
		await writeFile(join(workspace.path, "spectrum.mnova"), Buffer.from("processed-mnova"));
		await writeFile(join(workspace.path, "report.docx"), await docxBuffer());

		await service.saveNmrDraft({ taskId: "nmr-flow-1", projectId: project.id, inputPath: "raw.mnova", structurePath: "mol.mol", compound: { name: "P1" } });
		const started = await service.startNmr("nmr-flow-1", project.id);
		assert.equal(started.task.status, "queued");

		const cancelled = await service.cancelNmr("nmr-flow-1", project.id, started.task.attempt);
		assert.equal(cancelled.status, "draft");
		assert.equal(cancelled.attempt, 2);

		const restarted = await service.startNmr("nmr-flow-1", project.id);
		await service.update("nmr-flow-1", project.id, restarted.task.attempt, "failed", "Mnova 未启动");
		const retried = await service.retry("nmr-flow-1", project.id);
		assert.equal(retried.task.status, "queued");
		assert.equal(retried.task.attempt, 3);

		const completed = await service.complete("nmr-flow-1", project.id, {
			attempt: retried.task.attempt,
			assessment: { verdict: "match", confidence: "high", summary: "峰位与积分吻合" },
			spectrumPath: "spectrum.mnova",
			reportPath: "report.docx"
		});
		assert.equal(completed.status, "completed");
		assert.ok(completed.artifacts.spectrum.sha256);
		assert.ok(completed.artifacts.report.sha256);
		assert.equal(completed.assessment.verdict, "match");

		const spectrum = await service.artifactFile("nmr-flow-1", project.id, "spectrum");
		assert.equal(spectrum.fileName, "spectrum.mnova");
		assert.equal(spectrum.buffer.toString(), "processed-mnova");
		assert.match(spectrum.sha256, /^[a-f0-9]{64}$/);

		// 结构来源：插件直接读取课题目录里的 MOL。
		const structure = await service.nmrStructureSource("nmr-flow-1", project.id);
		assert.equal(structure.format, "mol");
		assert.match(structure.source, /C1/);

		// 模拟谱：只登记任务（不跑 worker），派发失败可如实记录。
		const simulation = await service.startSimulation(project.id, "nmr-flow-1", { nucleus: "1H", frequencyMHz: 400, solvent: "CDCl3" });
		assert.equal(simulation.job.status, "queued");
		assert.match(simulation.prompt, /lab_nmr_simulation_structure/);
		const failed = await service.simulationDispatchFailed(project.id, "nmr-flow-1", simulation.job.id, "会话创建失败");
		assert.equal(failed.simulationJob.status, "failed");
		assert.deepEqual((await service.listNmrSimulations(project.id)).simulations, []);

		// 删除语义：先只清产物（条目保留），再整体删除（行与数据集一起走）。
		const cleared = await service.remove("nmr-flow-1", project.id, "nmr", ["spectrum", "report"], "outputs");
		assert.equal(cleared.entryPreserved, true);
		assert.equal(cleared.deletedFiles.length, 2);
		const kept = service.get("nmr-flow-1", project.id);
		assert.deepEqual(kept.artifacts, {});
		await assert.rejects(readFile(join(workspace.path, "spectrum.mnova")), /ENOENT/);

		const wiped = await service.remove("nmr-flow-1", project.id, "nmr", [], "all");
		assert.equal(wiped.id, "nmr-flow-1");
		assert.deepEqual(service.list(project.id), []);
		await assert.rejects(readFile(join(workspace.path, "raw.mnova")), /ENOENT/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
