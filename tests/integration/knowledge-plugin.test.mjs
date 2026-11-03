import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/**
 * RAG 插件独立性：只装 core + 插件即可启动；与母插件遗留入口共用同一个实例，
 * 不允许出现两份 watcher / 两份索引缓存。
 */
test("RAG 子插件可独立装配，且与遗留 knowledgeFor 共用同一实例", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-knowledge-plugin-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [{
			id: "lab-knowledge",
			name: pathToFileURL(join(repoRoot, "plugins/knowledge/lib/index.js")).href,
			inject: ["ibmCore"],
			config: { root: join(dir, "knowledge") }
		}]
	});
	try {
		const service = handle.ctx.get("labKnowledge");
		assert.ok(service, "labKnowledge 应能独立启动");
		const instance = service.forCore();
		assert.ok(instance, "forCore 应返回知识库实例");
		assert.equal(service.forCore(), instance, "同一 core 必须复用同一实例");
		assert.equal(instance.root, join(dir, "knowledge"), "共享库根目录来自装配配置");
		assert.equal(service.ctx.get("ibmLiteratureWorkflows"), undefined, "不应被动拉起文献域");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

/** 知识库工具属于插件：服务在场时才注册，且只注册本域工具。 */
test("知识库工具随插件注册，且不注册跨模块只读工具", async () => {
	const { apply } = await import("../../plugins/knowledge/lib/tools.js");
	const tools = [];
	const ctx = {
		tools: { register: tool => tools.push(tool) },
		root: { get: name => name === "labKnowledge" ? { forCore: () => ({}) } : undefined },
		get: name => name === "ibmCore" ? { getProjectBySession: () => null, table: () => null } : undefined
	};
	apply(ctx);
	assert.deepEqual(tools.map(tool => tool.name), ["lab_knowledge_list", "lab_knowledge_search", "lab_knowledge_add_to_reading"]);
	// 服务缺席时一个工具都不注册。
	const empty = [];
	apply({ tools: { register: tool => empty.push(tool) }, root: { get: () => undefined }, get: () => undefined });
	assert.deepEqual(empty, []);
});
