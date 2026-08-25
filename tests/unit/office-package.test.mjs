import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToDocx } from "../../lib/md2docx.js";
import { inspectOfficePackage } from "../../src/office-package.js";
import { buildPptx } from "../fixtures/pptx-builder.mjs";

test("Office package validator accepts generated DOCX and exposes integrity metadata", async () => {
	const buffer = await markdownToDocx("# 阅读笔记\n\nWindows compatibility");
	const result = await inspectOfficePackage(buffer, "docx");
	assert.equal(result.kind, "docx");
	assert.equal(result.byteLength, buffer.length);
	assert.match(result.sha256, /^[0-9a-f]{64}$/);
	assert.match(result.mime, /wordprocessingml/);
});

test("Office package validator accepts PPTX with slides", async () => {
	const { buffer } = await buildPptx({ name: "windows", slides: 2 });
	const result = await inspectOfficePackage(buffer, "pptx");
	assert.equal(result.slides, 2);
	assert.equal(result.byteLength, buffer.length);
	assert.match(result.mime, /presentationml/);
});

test("Office package validator rejects renamed or truncated files", async () => {
	await assert.rejects(() => inspectOfficePackage(Buffer.from("not office"), "docx"), /not a ZIP/);
	const buffer = await markdownToDocx("# test");
	await assert.rejects(() => inspectOfficePackage(buffer.subarray(0, Math.floor(buffer.length / 2)), "docx"), /unreadable/);
});
