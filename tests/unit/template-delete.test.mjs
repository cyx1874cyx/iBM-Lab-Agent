import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

const templatesPath = join(repoRoot, "client/src/components-templates.js");
const remotePath = join(repoRoot, "lib/remote.js");
const expServicePath = join(repoRoot, "lib/experiment-plan-templates.js");

test("模板界面：分类侧栏、场景标签、双击重命名，无归档/编辑菜单", async () => {
	const ui = await readFile(templatesPath, "utf8");
	const remote = await readFile(remotePath, "utf8");
	assert.match(ui, /模板分类/);
	assert.match(ui, /Template Preview/);
	assert.match(ui, /双击重命名/);
	assert.match(ui, /适用场景|设置场景/);
	assert.match(ui, /模板导入/);
	assert.doesNotMatch(ui, /onClick: \(\) => void archive/);
	assert.doesNotMatch(ui, /归档 PPT 模板|归档实验计划模板/);
	assert.doesNotMatch(ui, /更多操作/);
	assert.match(remote, /async templates_delete/);
	assert.match(remote, /async experiment_plan_templates_delete/);
});

test("实验计划模板可删除（全部版本）", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-template-delete-"));
	const handle = await bootLite({ storageRoot: join(dir, "storage") });
	try {
		const service = handle.ctx.get("labExperimentPlanTemplates");
		assert.ok(service, "实验计划模板服务应启动");
		await service.create("tpl-delete-me", { name: "待删除模板" });
		await service.update("tpl-delete-me", { name: "待删除模板 v2" });
		assert.equal((await service.list()).some(row => row.id === "tpl-delete-me"), true);
		assert.equal(await service.remove("tpl-delete-me"), true);
		assert.equal((await service.list()).some(row => row.id === "tpl-delete-me"), false);
		await assert.rejects(() => service.remove("tpl-delete-me"), /not found/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
