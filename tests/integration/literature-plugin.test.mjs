import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/**
 * 文献插件独立性：只装 core + runtime + 插件即可启动，并能完成最基础的组织操作。
 * 文档转换/模板/精读目标属于可选能力，未安装时相关方法应报 feature-unavailable。
 */
test("文献子插件可独立装配：core + runtime 即可管理精读文件夹", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-literature-plugin-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [
			{
				id: "ibm-runtime",
				name: pathToFileURL(join(repoRoot, "lib/runtime.js")).href,
				inject: ["ibmCore"],
				config: { skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), venvDir: join(dir, "venv") }
			},
			{
				id: "lab-literature",
				name: pathToFileURL(join(repoRoot, "plugins/literature/lib/index.js")).href,
				inject: ["ibmCore", "ibmRuntime"],
				config: { skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), venvDir: join(dir, "venv") }
			}
		]
	});
	try {
		const service = handle.ctx.get("labLiteratureTasks");
		assert.ok(service, "labLiteratureTasks 应能独立启动");
		const project = await handle.ctx.ibmCore.createProject({ id: "lit-plugin", name: "文献插件课题" });
		const folder = await service.saveReadingFolder({ projectId: project.id, name: "待精读" });
		assert.equal(folder.name, "待精读");
		assert.deepEqual(service.listReadingFolders(project.id).map(row => row.name), ["待精读"]);
		assert.deepEqual(service.listReadingReports(project.id), []);
		assert.equal(handle.ctx.get("ibmDocuments"), undefined, "不应被动拉起文档域");
		assert.equal(handle.ctx.get("labGoalProfiles"), undefined);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
