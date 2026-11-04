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

test("模板条目统一为名称/状态/操作三列，归档按钮改为删除", async () => {
	const ui = await readFile(templatesPath, "utf8");
	const remote = await readFile(remotePath, "utf8");
	assert.match(ui, /"名称"\), h\("span", \{ className: "ib-tm-status" \}, "状态"\), h\("span", \{ className: "ib-tm-actions" \}, "操作"\)/);
	assert.doesNotMatch(ui, /onClick: \(\) => void archive/);
	assert.doesNotMatch(ui, /归档 PPT 模板|归档实验计划模板/);
	assert.match(ui, /templates_delete/);
	assert.match(ui, /experiment_plan_templates_delete/);
	assert.match(remote, /async templates_delete/);
	assert.match(remote, /async experiment_plan_templates_delete/);
	assert.match(remote, /markRemote\(LabRemoteService\.prototype, "templates_delete"\)/);
	assert.match(remote, /markRemote\(LabRemoteService\.prototype, "experiment_plan_templates_delete"\)/);
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
