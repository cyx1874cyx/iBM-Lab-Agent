/**
 * Integration: 阅读笔记模板服务（ctx.labNoteTemplates）端到端。
 *
 * CRUD / 版本语义（key id@version，不可变） / 快照 / requirements 转换，
 * 以及模板工具（templates-tool）注册与读取。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";
import { buildPptx, defaultLayouts } from "../fixtures/pptx-builder.mjs";

async function bootNotes() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-notes-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
			{ id: "tools", name: "@deepseek-ai/dsh-tools" },
			{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir: join(dir, "templates") } },
			{ id: "lab-templates-tool", name: "dsh-lab-agent/templates-tool", inject: ["tools", "labNoteTemplates", "labTemplates"] }
		]
	});
	return { handle, dir };
}

test("note templates: seed, create, update, snapshot, copy, requirements, delete", async () => {
	const { handle, dir } = await bootNotes();
	try {
		const notes = handle.ctx.labNoteTemplates;

		// 内置默认模板种子
		const seeded = await notes.list();
		assert.ok(seeded.some((t) => t.id === "note-default"));
		const def = await notes.resolve("note-default");
		assert.equal(def.name, "课题组阅读笔记模板（默认）");

		// 新建 v1
		const created = await notes.create("note-lab-v1", {
			name: "聚前药进阶笔记",
			topics: ["聚前药"],
			sections: [{ key: "citation", title: "文献信息", required: true, hint: "规范短引用" }],
			styleRules: ["数字带来源"]
		});
		assert.equal(created.version, "1");

		// update → v2，旧版本快照不变
		const updated = await notes.update("note-lab-v1", { name: "聚前药进阶笔记 V2" });
		assert.equal(updated.version, "2");
		assert.equal((await notes.resolve("note-lab-v1", "1")).name, "聚前药进阶笔记");
		assert.equal((await notes.resolve("note-lab-v1")).name, "聚前药进阶笔记 V2");

		// 任务快照深拷贝、随后的修改不影响旧快照
		const snapshot = await notes.snapshotForTask("note-lab-v1", "1");
		assert.deepEqual(snapshot, await notes.resolve("note-lab-v1", "1"));
		await notes.update("note-lab-v1", { name: "再改" });
		assert.equal(snapshot.name, "聚前药进阶笔记");

		// requirements 转换
		const req = await notes.toNoteRequirements(await notes.resolve("note-lab-v1", "1"));
		assert.ok(Array.isArray(req.sections));
		assert.ok(req.styleRules.length > 0);

		// 复制 → v1 新 id
		const copy = await notes.copy("note-lab-v1", "note-copy", "副本");
		assert.equal(copy.version, "1");
		assert.equal(copy.name, "副本");

		// 删除：从列表移除，历史仍可读；id 不可复用
		await notes.deleteProfile("note-lab-v1");
		assert.ok(!(await notes.list()).some((t) => t.id === "note-lab-v1"));
		assert.ok(await notes.resolve("note-lab-v1", "1"));
		await assert.rejects(() => notes.create("note-lab-v1", { name: "again" }), /already exists|not found/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("templates-tool: note/ppt list + get tools registered and return requirements", async () => {
	const { handle, dir } = await bootNotes();
	try {
		const tools = handle.ctx.tools;
		const names = tools.schemas().map((t) => t.name);
		assert.ok(names.includes("lab_note_templates_list"), "note list tool registered");
		assert.ok(names.includes("lab_note_templates_get"), "note get tool registered");
		assert.ok(names.includes("lab_ppt_templates_list"), "ppt list tool registered");
		assert.ok(names.includes("lab_ppt_templates_get"), "ppt get tool registered");

		const noteList = tools.get("lab_note_templates_list");
		const noteGet = tools.get("lab_note_templates_get");
		const pptList = tools.get("lab_ppt_templates_list");
		const pptGet = tools.get("lab_ppt_templates_get");

		const listed = await noteList.execute({});
		assert.equal(listed.ok, true);
		assert.ok(listed.templates.some((t) => t.id === "note-default"));

		const got = await noteGet.execute({ id: "note-default" });
		assert.equal(got.ok, true);
		assert.ok(got.requirements.sections.length > 0);
		assert.equal(got.requirements.version, "1");

		const pptListed = await pptList.execute({});
		assert.equal(pptListed.ok, true);
		const natureSummary = pptListed.templates.find((t) => t.id === "nature-default");
		assert.equal(natureSummary.builtIn, true);
		assert.deepEqual(JSON.parse(JSON.stringify(pptListed)), pptListed, "PPT list result must be lossless JSON");

		const pptGot = await pptGet.execute({ id: "nature-default" });
		assert.equal(pptGot.ok, true);
		assert.equal(pptGot.template.id, "nature-default");
		assert.deepEqual(JSON.parse(JSON.stringify(pptGot)), pptGot, "PPT get result must be lossless JSON");

		// Imported PPTX profiles commonly contain optional fields with undefined
		// values (notably pageSize.type, logo and maxPages). Both model-facing
		// tools must clean those values before Typert validates the JSON boundary.
		const { buffer } = await buildPptx({
			name: "lab-ppt-v4",
			size: { cx: 12192000, cy: 6858000 },
			layouts: defaultLayouts()
		});
		const source = join(dir, "lab-ppt-v4.pptx");
		await writeFile(source, buffer);
		await handle.ctx.labTemplates.importPptx("lab-ppt-v4", { pptxPath: source, meta: { name: "课题组模板 v4" } });
		const importedList = await pptList.execute({});
		const importedSummary = importedList.templates.find((t) => t.id === "lab-ppt-v4");
		assert.equal(importedSummary.builtIn, false);
		assert.deepEqual(JSON.parse(JSON.stringify(importedList)), importedList);
		const importedGet = await pptGet.execute({ id: "lab-ppt-v4" });
		assert.equal(importedGet.ok, true);
		assert.equal(importedGet.template.pageSize.ratio, "16:9");
		assert.deepEqual(JSON.parse(JSON.stringify(importedGet)), importedGet);
		const renderedRequirements = pptGet.output.render({ id: "lab-ppt-v4" }, importedGet)[0].text;
		assert.match(renderedRequirements, /模板来源：已导入 PPTX 模板/);
		assert.match(renderedRequirements, /最大页数：/);
		assert.match(renderedRequirements, /讲稿备注要求：/);
		assert.match(renderedRequirements, /版式角色映射：/);

		// Repair storage written by older releases that allowed the mandatory
		// built-in template to be archived.
		const oldBuiltin = await handle.ctx.labTemplates.resolve("nature-default");
		await handle.ctx.labTemplates.table.put("nature-default@2", { ...oldBuiltin, version: "2", status: "archived" });
		const restored = await handle.ctx.labTemplates.list();
		assert.ok(restored.some((t) => t.id === "nature-default" && t.version === "3"));
		await assert.rejects(() => handle.ctx.labTemplates.deleteProfile("nature-default"), /built-in template.*cannot be archived/);

		// 不存在的 id → 明确错误
		const miss = await noteGet.execute({ id: "no-such-note" });
		assert.equal(miss.ok, false);
		assert.match(miss.error, /not found/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
