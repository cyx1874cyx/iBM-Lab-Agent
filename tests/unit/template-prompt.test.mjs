import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

/** 生成要求 = 对模型的结构化要求 + 可直接使用的 prompt。 */
test("精读模板生成要求返回 prompt 与结构化 requirements", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-template-prompt-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		extraRows: [{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] }]
	});
	try {
		const service = handle.ctx.get("labNoteTemplates");
		const result = await service.prompt("note-default");
		assert.equal(result.kind, "note");
		assert.match(result.prompt, /请严格按照模板/);
		assert.match(result.prompt, /章节结构/);
		assert.match(result.prompt, /输出格式：Markdown/);
		assert.match(result.prompt, new RegExp(result.requirements.sections[0].title));
		assert.match(result.prompt, /必填|可选/);
		assert.equal(Array.isArray(result.requirements.sections), true);
		assert.ok(result.requirements.sections.length > 0);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
