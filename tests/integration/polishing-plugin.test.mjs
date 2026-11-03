import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/** 润色占位插件：只装 core + 插件即可启动，且如实报告"未实现"。 */
test("润色占位插件可独立装配并如实报告未实现", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-polishing-plugin-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [{
			id: "lab-polishing",
			name: pathToFileURL(join(repoRoot, "plugins/polishing/lib/index.js")).href
		}]
	});
	try {
		const service = handle.ctx.get("labPolishing");
		assert.ok(service, "labPolishing 应能独立启动");
		const status = service.status();
		assert.equal(status.implemented, false);
		assert.match(status.reason, /尚未实现/);
		assert.equal(service.ctx.get("ibmLiteratureWorkflows"), undefined, "占位插件不应拉起文献域");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
