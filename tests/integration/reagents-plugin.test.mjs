import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/**
 * 试剂子插件独立性验收：
 * 只装 core + 插件，不装任何业务域或桌面桥，插件必须能启动并服务检索；
 * 需要桌面能力的方法必须以 feature-unavailable 明确失败，而不是把宿主拖垮。
 */
test("试剂子插件可独立装配：无桌面桥也能启动并检索，选择清单明确返回 feature-unavailable", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-reagents-plugin-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [{
			id: "lab-reagents",
			name: pathToFileURL(join(repoRoot, "plugins/reagents/lib/index.js")).href,
			config: { root: join(dir, "reagents") }
		}]
	});
	try {
		const service = handle.ctx.get("labReagents");
		assert.ok(service, "labReagents 应在没有桌面桥的情况下启动");
		const result = await service.search({});
		assert.deepEqual(result.sources.map(source => source.id).sort(), ["biological", "cells", "chemical"]);
		assert.equal(result.total, 0);
		assert.deepEqual(result.sources.map(source => source.configured), [false, false, false]);
		await assert.rejects(service.chooseSource({ id: "chemical" }), error => error.code === "feature-unavailable");
		await assert.rejects(service.chooseSource({ id: "unknown" }), /未知清单类型/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

/**
 * 兼容面验收：母插件的 lab.reagents_* 必须委托到插件服务，
 * 不能自己再建一份 catalog（否则同一进程出现两套缓存与两份 stale 判定）。
 */
test("母插件的 lab.reagents_* 委托到插件服务，共用同一个 catalog 实例", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-reagents-bridge-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [
			{
				id: "lab-reagents",
				name: pathToFileURL(join(repoRoot, "plugins/reagents/lib/index.js")).href,
				config: { root: join(dir, "reagents") }
			},
			{
				id: "lab-remote",
				name: pathToFileURL(join(repoRoot, "lib/remote.js")).href,
				inject: ["ibmCore"]
			}
		]
	});
	try {
		const plugin = handle.ctx.get("labReagents");
		const lab = handle.ctx.get("lab");
		assert.ok(plugin && lab);
		assert.equal(lab.reagentCatalog(), plugin.catalog(), "母插件必须复用插件的 catalog 实例");
		const result = await lab.reagents_search({});
		assert.equal(result.total, 0);
		assert.deepEqual(result.sources.map(source => source.configured), [false, false, false]);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
