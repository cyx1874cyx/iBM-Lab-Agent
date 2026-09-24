/**
 * Unit: 模板类工具的输出 schema 契约 + 模板解析的三处真实缺陷。
 *
 * 背景（0.5.4 真实试用，Agent 只能绕过工具手读存储）：
 *   1. `lab_note_templates_list` 的输出 schema 声明了 additionalProperties:false，却没声明
 *      `kind`，而 note-templates.js 的 list() 每行都带 kind → 工具输出校验失败，Agent 看到
 *      "templates[0].kind 未声明"；
 *   2. `resolve(id, "latest")` 直接拼出 `note-default@latest` → 永远 not found
 *      （LLM 很自然会传字面量 "latest"，历史错误文案本身也写成 '@latest'）；
 *   3. `latestActive` 只看版本最大那一行：删除会追加 archived 尾部版本，此后旧版本即使
 *      仍是 active 也被判成"不存在"（list 能列出、resolve 报 not found）。
 *
 * 这些断言都跑真实实现（服务原型方法 + 真实 storage 表替身），只有 storage 是替身，
 * 所以行字段来自 list()/resolve() 本身，能真正复现上面这类"漏声明"。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { noteTemplateSchema } from "../../src/note-template.js";
import { readingGoalProfileSchema } from "../../src/goal-profile.js";
import LabNoteTemplatesService from "../../lib/note-templates.js";
import LabGoalsService from "../../lib/goal-profiles.js";
import { apply as applyTemplatesTool } from "../../lib/templates-tool.js";
import { withRegistrationNextStep } from "../../lib/tasks-tool.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ISO = "2026-09-25T00:00:00.000Z";

/** storage 表替身：只实现服务真正用到的方法（keys/get/put）。 */
function fakeTable(rows) {
	const map = new Map(rows.map((row) => [`${row.id}@${row.version}`, row]));
	return {
		keys: () => [...map.keys()],
		get: (key) => map.get(key),
		put: async (key, value) => { map.set(key, value); }
	};
}

/** 只借原型方法，不跑 Cordis 的 Service 构造（无需真实 storage domain）。 */
function stubbedService(ServiceClass, rows) {
	const service = Object.create(ServiceClass.prototype);
	service.table = fakeTable(rows);
	service.ctx = { logger: { warn() {} } };
	return service;
}

function noteRow(overrides) {
	return noteTemplateSchema.parse({
		id: "note-default",
		version: "1",
		name: "默认阅读笔记",
		createdAt: ISO,
		updatedAt: ISO,
		...overrides
	});
}

function goalRow(overrides) {
	return readingGoalProfileSchema.parse({
		id: "default-prodrug-polymer",
		version: "1",
		name: "聚前药/聚合物目标",
		createdAt: ISO,
		updatedAt: ISO,
		...overrides
	});
}

/** 注册全部模板工具并捕获定义（apply 只用到 ctx.tools / labNoteTemplates / labTemplates）。 */
function captureTemplateTools(noteService) {
	const tools = new Map();
	applyTemplatesTool({
		tools: { register: (definition) => tools.set(definition.name, definition) },
		labNoteTemplates: noteService,
		labTemplates: {}
	});
	return tools;
}

/** 输出 schema 允许的键必须覆盖实际返回的每个键（additionalProperties:false 下漏一个就报错）。 */
function assertSchemaCovers(declaredProperties, value, label) {
	const declared = new Set(Object.keys(declaredProperties));
	for (const key of Object.keys(value)) {
		assert.ok(declared.has(key), `${label}：实际返回了未声明的字段 ${key}（additionalProperties:false 会让工具输出校验失败）`);
	}
}

test("lab_note_templates_list：schema 声明了 list() 返回的每个字段（kind 回归）", async () => {
	const service = stubbedService(LabNoteTemplatesService, [noteRow({ version: "1" })]);
	const tools = captureTemplateTools(service);
	const definition = tools.get("lab_note_templates_list");
	assert.ok(definition, "应注册 lab_note_templates_list");

	const value = await definition.execute({});
	assert.equal(value.ok, true);
	assert.ok(value.templates.length > 0, "应有可用模板");
	const items = definition.output.schema.properties.templates.items;
	assert.equal(items.additionalProperties, false);
	// 逐行核对：内置模板（note-default / review-default…）也走同一条 list()，都会带 kind
	for (const row of value.templates) {
		assertSchemaCovers(items.properties, row, `lab_note_templates_list[${row.id}]`);
	}
	assert.ok("kind" in items.properties, "kind 必须在 schema 里显式声明");
	const noteDefault = value.templates.find((row) => row.id === "note-default");
	assert.ok(noteDefault, "note-default 应在列表里");
	assert.equal(noteDefault.kind, "note");
});

test("lab_note_templates_get：schema 覆盖实际返回，且 id 缺省与 latest 都能取到", async () => {
	const service = stubbedService(LabNoteTemplatesService, [noteRow({})]);
	const tools = captureTemplateTools(service);
	const definition = tools.get("lab_note_templates_get");
	assert.ok(definition, "应注册 lab_note_templates_get");

	for (const args of [{ id: "note-default" }, { id: "note-default", version: "latest" }, { id: "note-default", version: "" }]) {
		const value = await definition.execute(args);
		assert.equal(value.ok, true, `args=${JSON.stringify(args)} 应能取到模板`);
		assertSchemaCovers(definition.output.schema.properties, value, `lab_note_templates_get ${JSON.stringify(args)}`);
		assert.equal(value.requirements.version, "1");
	}
});

test("resolve：'latest'/空白 等价于省略；显式版本可读；删除（archived 尾部）后不再可用", async () => {
	// 场景 A：只有一个 active 版本 —— 三种"未指定"写法都必须取到 v1。
	// 真实试用里 Agent 传字面量 "latest"，旧实现直接拼 key 去找 note-default@latest，
	// 必然 not found（错误文案本身也写成 '@latest'，进一步误导）。
	const live = stubbedService(LabNoteTemplatesService, [noteRow({ version: "1" })]);
	assert.equal((await live.resolve("note-default")).version, "1");
	assert.equal((await live.resolve("note-default", "latest")).version, "1", "'latest' 必须当作未指定");
	assert.equal((await live.resolve("note-default", "")).version, "1", "空串必须当作未指定");
	assert.equal((await live.resolve("note-default", "  latest  ")).version, "1", "带空白的 latest 同样当未指定");
	assert.equal(await live.resolve("note-default", "9"), undefined, "不存在的版本返回 undefined");

	// 场景 B：删除语义（v2 是 archived 尾部版本）—— 该 id 视为已删除，不能"回退"到
	// 仍 active 的 v1（那会让已删除的模板复活，并打破 notes.test.mjs 的删除断言）。
	const deleted = stubbedService(LabNoteTemplatesService, [noteRow({ version: "1" }), noteRow({ version: "2", status: "archived" })]);
	assert.equal(await deleted.resolve("note-default"), undefined);
	assert.equal(await deleted.resolve("note-default", "latest"), undefined, "'latest' 指向最新版本，而它已被删除");
	assert.equal((await deleted.resolve("note-default", "1")).version, "1", "历史版本始终可读");
});

test("snapshotForTask：not-found 信息带上可用版本，能直接指导下一步", async () => {
	// 用非内置 id：内置 id 在"没有 active 版本"时会被 ensureSeed 重新种上，掩盖 archived-only 场景。
	const service = stubbedService(LabNoteTemplatesService, [
		noteRow({ id: "note-custom", version: "1", status: "archived" })
	]);
	await assert.rejects(() => service.snapshotForTask("note-custom", "9"), /可用版本：1\(archived\)/);
	await assert.rejects(() => service.snapshotForTask("note-custom"), /没有 active 版本/);
	await assert.rejects(() => service.snapshotForTask("nope"), /没有任何版本/);
});

test("lab goals：同一套解析语义（latest 归一化 + 删除后不可用 + 历史版本可读）", async () => {
	const live = stubbedService(LabGoalsService, [goalRow({ version: "1" })]);
	assert.equal((await live.resolve("default-prodrug-polymer")).version, "1");
	assert.equal((await live.resolve("default-prodrug-polymer", "latest")).version, "1");
	assert.equal((await live.snapshotForTask("default-prodrug-polymer", "latest")).version, "1");

	const deleted = stubbedService(LabGoalsService, [
		goalRow({ version: "1" }),
		goalRow({ version: "2", status: "archived" })
	]);
	assert.equal(await deleted.resolve("default-prodrug-polymer"), undefined, "删除后不再可用");
	assert.equal((await deleted.resolve("default-prodrug-polymer", "1")).version, "1", "历史版本始终可读");
	await assert.rejects(() => deleted.snapshotForTask("default-prodrug-polymer", "9"), /可用版本：2\(archived\), 1/);
	await assert.rejects(() => deleted.snapshotForTask("default-prodrug-polymer"), /没有 active 版本/);
});

test("登记 PPT 的前置条件写进 description，且错误被翻译成可执行下一步", () => {
	const source = readFileSync(fileURLToPath(new URL("../../lib/tasks-tool.js", import.meta.url)), "utf8");
	assert.match(source, /前置依赖：必须先有已暂存的精读报告/, "description 必须写明依赖链");
	assert.match(source, /lab_tasks_register_report/, "必须点名生成精读报告的工具");
	assert.match(source, /不会自动生成精读报告/, "必须说明元数据登记不会生成报告");
	assert.match(source, /error: withRegistrationNextStep\(error\)/, "登记工具必须走错误翻译器");

	const translated = withRegistrationNextStep(new Error("reading report 'report-mufu23qp' has no staged report artifact yet"));
	assert.match(translated, /has no staged report artifact yet/, "必须保留原始信息");
	assert.match(translated, /下一步/);
	assert.match(translated, /lab_tasks_register_report/);
	assert.match(translated, /不会自动生成精读报告/);

	// 与前置条件无关的错误必须原样透传，不追加噪声
	assert.equal(withRegistrationNextStep(new Error("unknown projectId")), "unknown projectId");
});
