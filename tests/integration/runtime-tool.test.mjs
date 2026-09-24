/**
 * Integration: 运行时环境工具（`lab_runtime_env`）在真实 harness 上下文里注册并可用。
 *
 * 为什么需要它：`defineTool` 会在 **apply 阶段**校验 schema 形状（例如
 * `additionalProperties` 必须显式声明），schema 写错等于把预设挂载搞坏 —— 单元测试
 * 用桩 ctx 抓不到"注册进真实 tools 服务"这一层。这里用 `bootLite` 起一个真实上下文，
 * 断言工具确实进入了 tools registry，并且 `execute` 的输出结构稳定。
 *
 * 注意：不断言 `ok === true` —— 没有捆绑 Python 的开发机上 `python.available` 可能为
 * false（此时 `ok` 为 false 且带 warnings 是**正确**行为）。断言的是结构与口径。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { bootLite } from "../helpers/boot-lite.mjs";

test("runtime-tool: lab_runtime_env 注册成功并返回运行时事实源", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-runtime-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
			{ id: "tools", name: "@deepseek-ai/dsh-tools" },
			{ id: "lab-runtime-tool", name: "dsh-lab-agent/runtime-tool", inject: ["tools"] }
		]
	});
	try {
		const names = handle.ctx.tools.schemas().map((tool) => tool.name);
		assert.ok(names.includes("lab_runtime_env"), `运行时工具应已注册，实际：${names.join(", ")}`);

		const tool = handle.ctx.tools.get("lab_runtime_env");
		assert.equal(typeof tool.execute, "function");
		const value = await tool.execute({});

		assert.equal(typeof value.ok, "boolean");
		assert.equal(typeof value.isolated, "boolean");
		for (const key of ["python", "node"]) {
			assert.equal(typeof value[key].available, "boolean", `${key}.available 必须是布尔`);
			assert.equal(typeof value[key].command, "string", `${key}.command 必须是字符串（不是 argv 数组）`);
			assert.ok(Array.isArray(value[key].argv), `${key}.argv 必须是数组（spawn 前缀）`);
			assert.equal(typeof value[key].source, "string");
			assert.equal(typeof value[key].version, "string");
		}
		assert.equal(typeof value.soffice.available, "boolean");
		assert.match(value.tempDir, /\.lab-tmp$/, "临时目录必须在工作区内的 .lab-tmp 下");
		assert.match(value.renderHelper, /render-deck\.mjs$/);
		// 体检器同样是绝对路径：Agent 的 cwd 是课题工作区，相对路径会找不到。
		assert.match(value.inspector, /inspect_deck\.py$/);
		// 人话侧的要求：别硬编码安装路径、临时文件放 tempDir、渲染走 renderHelper。
		const notes = value.notes.join("\n");
		assert.match(notes, /PATH 最前面/);
		assert.match(notes, /tempDir/);
		assert.match(notes, /render-deck\.mjs/);
		assert.ok(Array.isArray(value.warnings));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
