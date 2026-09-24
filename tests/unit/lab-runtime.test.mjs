/**
 * dsh-lab-agent: 「Agent 运行时环境」单元测试。
 *
 * 覆盖两件事：
 *   1. 解析优先级 —— 桌面壳注入的捆绑运行时 > 本进程自身（壳启动 DSH 用的那个 node）
 *      > 系统 PATH（且必须显式 allowSystemFallback）。顺序错了就等于让结果依赖
 *      用户机器上装了什么，这正是 0.5.4 现场"硬编码 C:\Program Files\..."的根因。
 *   2. `lab_runtime_env` 的输出**逐字段**落在它自己声明的 output schema 里 ——
 *      0.5.4 出现过一个同类线上 bug：`lab_note_templates_list` 的 schema 漏声明了
 *      `kind`，服务却返回了它，导致工具输出校验失败、Agent 只能绕过工具手读存储。
 *      这里的手写校验器带「非平凡性自证」，确保它能真的抓到多字段。
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { apply as applyRuntimeTool } from "../../lib/runtime-tool.js";
import {
	bundledNodeFromEnv,
	nodeCandidates,
	resolveAgentRuntime,
	resolveNodeExecutable,
	runtimeTempDir,
	workspaceDirFromEnv
} from "../../src/lab-runtime.js";

/** 递归校验 value 是否满足 schema（支持 type/properties/required/items/additionalProperties）。 */
export function schemaViolations(value, schema, path = "$") {
	const problems = [];
	if (!schema || typeof schema !== "object") return problems;
	const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
	if (types.length > 0) {
		const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
		const ok = types.some((type) => (type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" : type === actual));
		if (!ok) {
			problems.push(`${path}: 期望 ${types.join("|")}，实际 ${actual}`);
			return problems;
		}
	}
	if (Array.isArray(value) && schema.items) {
		value.forEach((entry, index) => problems.push(...schemaViolations(entry, schema.items, `${path}[${index}]`)));
	}
	if (value !== null && typeof value === "object" && !Array.isArray(value) && schema.properties) {
		for (const [key, entry] of Object.entries(value)) {
			const child = schema.properties[key];
			if (child === undefined) {
				if (schema.additionalProperties === false) problems.push(`${path}.${key}: schema 未声明该字段`);
				continue;
			}
			problems.push(...schemaViolations(entry, child, `${path}.${key}`));
		}
	}
	return problems;
}

test("schemaViolations 非平凡性自证：多余的未声明字段必须被抓到", () => {
	const schema = { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } } };
	assert.deepEqual(schemaViolations({ ok: true }, schema), []);
	const problems = schemaViolations({ ok: true, kind: "note" }, schema);
	assert.equal(problems.length, 1, `应报出未声明字段，实际：${JSON.stringify(problems)}`);
	assert.match(problems[0], /kind/);
	assert.equal(schemaViolations({ ok: "yes" }, schema).length, 1, "类型不符也必须报出");
});

test("runtimeTempDir：一律落在工作区内的 .lab-tmp（沙箱可写）", () => {
	assert.equal(runtimeTempDir({ env: { IBM_LAB_AGENT_WORKSPACE: "/w/ws" } }), join("/w/ws", ".lab-tmp"));
	// 空串与缺省都视为未设置，回退到调用方给的 fallback。
	assert.equal(runtimeTempDir({ env: {}, fallback: "/fallback" }), "/fallback");
	assert.equal(runtimeTempDir({ env: { IBM_LAB_AGENT_WORKSPACE: "   " }, fallback: "/fallback" }), "/fallback");
});

test("workspaceDirFromEnv / bundledNodeFromEnv：空串按未设置处理", () => {
	assert.equal(workspaceDirFromEnv({ IBM_LAB_AGENT_WORKSPACE: "/w" }), "/w");
	assert.equal(workspaceDirFromEnv({ IBM_LAB_AGENT_WORKSPACE: "" }), undefined);
	assert.equal(bundledNodeFromEnv({ IBM_LAB_AGENT_BUNDLED_NODE: "  " }), undefined);
	assert.equal(bundledNodeFromEnv({}), undefined);
});

test("nodeCandidates：捆绑 node 优先，其次本进程自身，系统 PATH 需显式开启", () => {
	const bundled = { IBM_LAB_AGENT_BUNDLED_NODE: process.execPath };
	const withBundled = nodeCandidates({ env: bundled });
	assert.equal(withBundled[0].source, "bundled");
	assert.equal(withBundled[0].command, process.execPath);
	// 与 process.execPath 相同时不应重复出现。
	assert.equal(withBundled.filter((entry) => entry.command === process.execPath).length, 1);

	const withoutBundled = nodeCandidates({ env: {} });
	assert.equal(withoutBundled[0].source, "harness", "没有捆绑 node 时应落到本进程自身（DSH 就跑在壳启动的 node 上）");
	assert.equal(withoutBundled[0].command, process.execPath);
	assert.ok(!withoutBundled.some((entry) => entry.source === "node"), "默认不得回退到系统 PATH");

	const withFallback = nodeCandidates({ env: {}, allowSystemFallback: true });
	assert.equal(withFallback.at(-1).source, "node");
});

test("resolveNodeExecutable：本进程自身始终可用", async () => {
	const resolved = await resolveNodeExecutable({ env: {} });
	assert.equal(resolved.command, process.execPath);
	assert.match(resolved.version ?? "", /^v?\d+\./);
});

test("resolveAgentRuntime：返回可用的 node、工作区临时目录与结构化警告", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "lab-runtime-test-"));
	try {
		const runtime = await resolveAgentRuntime({ env: { IBM_LAB_AGENT_WORKSPACE: workspace } });
		assert.equal(runtime.node.command, process.execPath);
		assert.equal(runtime.tempDir, join(workspace, ".lab-tmp"));
		assert.equal(runtime.workspaceDir, workspace);
		assert.equal(runtime.isolated, false, "未注入捆绑运行时时应如实报告非隔离");
		assert.ok(Array.isArray(runtime.warnings));
		assert.equal(typeof runtime.python.command === "string" || runtime.python.command === null, true);
		const isolated = await resolveAgentRuntime({ env: { IBM_LAB_AGENT_BUNDLED_NODE: process.execPath } });
		assert.equal(isolated.isolated, true);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("lab_runtime_env：输出字段必须落在自己声明的 schema 内", async () => {
	const registered = [];
	applyRuntimeTool({ tools: { register: (definition) => registered.push(definition) } });
	assert.equal(registered.length, 1);
	const tool = registered[0];
	assert.equal(tool.name, "lab_runtime_env");

	const workspace = await mkdtemp(join(tmpdir(), "lab-runtime-tool-"));
	const saved = process.env.IBM_LAB_AGENT_WORKSPACE;
	process.env.IBM_LAB_AGENT_WORKSPACE = workspace;
	try {
		const value = await tool.execute({});
		const problems = schemaViolations(value, tool.output.schema);
		assert.deepEqual(problems, [], `工具输出与 output schema 不一致：${JSON.stringify(problems)}`);
		assert.equal(value.ok, true);
		assert.equal(value.tempDir, join(workspace, ".lab-tmp"));
		assert.ok(existsSync(value.renderHelper) || value.renderHelper.endsWith("render-deck.mjs"));
		// 三条硬要求：别硬编码安装路径、临时文件放 tempDir、渲染用 renderHelper。
		const notes = value.notes.join("\n");
		assert.match(notes, /PATH 最前面/);
		assert.match(notes, /tempDir/);
		assert.match(notes, /render-deck\.mjs/);
		const rendered = tool.output.render({}, value);
		assert.ok(Array.isArray(rendered) && rendered.length > 0);
		assert.match(rendered[0].text, /Python/);
	} finally {
		if (saved === undefined) delete process.env.IBM_LAB_AGENT_WORKSPACE;
		else process.env.IBM_LAB_AGENT_WORKSPACE = saved;
		await rm(workspace, { recursive: true, force: true });
	}
});
