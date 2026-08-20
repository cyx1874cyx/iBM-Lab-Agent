/**
 * Unit: NoteTemplate 纯逻辑层（src/note-template.js）。
 *
 * 覆盖：内置默认模板结构、noteTemplateKey / nextNoteTemplateVersion、
 * cloneNoteTemplate、toNoteRequirements 转换（Agent 生成阅读笔记按此骨架）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	BUILTIN_NOTES,
	NOTE_LANGUAGES,
	cloneNoteTemplate,
	createDefaultNoteTemplate,
	nextNoteTemplateVersion,
	noteTemplateKey,
	noteTemplateSchema,
	toNoteRequirements
} from "../../src/note-template.js";

test("default note template defines the reading-note skeleton groups", () => {
	const tpl = createDefaultNoteTemplate();
	assert.equal(tpl.id, "note-default");
	assert.equal(tpl.version, "1");
	assert.equal(tpl.language, "zh");
	assert.ok(tpl.sections.some((s) => s.key === "citation" && s.required));
	assert.ok(tpl.sections.some((s) => s.key === "link-to-project" && s.required));
	const optional = tpl.sections.filter((s) => !s.required);
	assert.ok(optional.length > 0, "has at least one optional section");
	assert.ok(tpl.styleRules.length > 0);
	assert.ok(tpl.evidenceRequirements.length > 0);
});

test("toNoteRequirements carries sections, style and evidence contract for the agent", () => {
	const req = toNoteRequirements(createDefaultNoteTemplate());
	assert.equal(req.language, "zh");
	assert.ok(Array.isArray(req.sections) && req.sections.length >= 5);
	const citation = req.sections.find((s) => s.key === "citation");
	assert.equal(citation.title, "文献信息");
	assert.equal(citation.required, true);
	assert.ok(req.styleRules.length > 0);
	assert.ok(req.evidenceRequirements.length > 0);
	assert.match(req.contract, /note template sections in order/);
});

test("cloneNoteTemplate copies to a new id as v1 and keeps sections", () => {
	const copy = cloneNoteTemplate(createDefaultNoteTemplate(), "note-lab-v2", "课题组进阶笔记");
	assert.equal(copy.id, "note-lab-v2");
	assert.equal(copy.version, "1");
	assert.equal(copy.name, "课题组进阶笔记");
	assert.deepEqual(copy.sections, createDefaultNoteTemplate().sections);
});

test("nextNoteTemplateVersion is max+1 and noteTemplateKey composes id@version", () => {
	assert.equal(nextNoteTemplateVersion([]), "1");
	assert.equal(nextNoteTemplateVersion(["1", "3", "2"]), "4");
	assert.equal(noteTemplateKey("note-x", "2"), "note-x@2");
});

test("noteTemplateSchema parses a minimal row with defaults", () => {
	const row = noteTemplateSchema.parse({
		id: "note-min",
		version: "1",
		name: "最小模板",
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z"
	});
	assert.deepEqual(row.topics, []);
	assert.equal(row.language, "zh");
	assert.equal(row.status, "active");
	assert.ok(NOTE_LANGUAGES.includes(row.language));
});

test("BUILTIN_NOTES seeds note-default", () => {
	assert.ok(BUILTIN_NOTES.some((t) => t.id === "note-default"));
});
