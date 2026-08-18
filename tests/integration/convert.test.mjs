/**
 * Integration: ctx.labConvert — markitdown 文档转换（§七 扩展）。
 * 成功路径 mock 执行器；真实 probe 验证降级；base64 上传流程。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";
import { buildDocx } from "../fixtures/office-builder.mjs";

async function bootConvert() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-convert-"));
	const convertedDir = join(dir, "converted");
	await mkdir(convertedDir, { recursive: true });
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "lab-convert", name: "dsh-lab-agent/convert", inject: ["storageDomain"], config: { convertedDir } }
		]
	});
	return { handle, dir, convertedDir };
}

test("labConvert: upload docx -> markdown saved with provenance record (mocked converter)", async () => {
	const { handle, dir } = await bootConvert();
	try {
		const convert = handle.ctx.labConvert;
		// mock 执行器（成功路径）
		convert.convert = async (path, opts) => ({ available: true, text: "# 转换结果\n来自 mock", code: 0 });

		const docx = await buildDocx({ title: "Prodrug Polymer" });
		const base64 = docx.toString("base64");
		const result = await convert.convertUpload({ name: "paper.docx", base64 });

		assert.equal(result.run.status, "succeeded");
		assert.match(result.text, /# 转换结果/);
		assert.ok(result.mdPath.endsWith(".md"));
		assert.equal(result.run.fileName, "paper.docx");
		assert.equal(result.run.inputsSha256.length, 64);

		const runs = convert.listRuns();
		assert.equal(runs.length, 1);
		assert.equal(runs[0].status, "succeeded");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("labConvert: real probe degrades cleanly and conversion of missing file fails", async () => {
	const { handle, dir } = await bootConvert();
	try {
		const convert = handle.ctx.labConvert;
		const available = await convert.markitdownAvailable();
		assert.equal(typeof available.available, "boolean");

		// 文件不存在 → 明确报错（不进入转换）
		await assert.rejects(() => convert.convertToMarkdown({ path: join(dir, "missing.docx") }), /not found/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("labConvert: unavailable converter produces a clear failure", async () => {
	const { handle, dir } = await bootConvert();
	try {
		const convert = handle.ctx.labConvert;
		convert.convert = async () => ({ available: false, error: "markitdown not installed; run: python -m pip install markitdown" });

		const docx = await buildDocx();
		const p = join(dir, "paper.docx");
		await writeFile(p, docx);
		await assert.rejects(() => convert.convertToMarkdown({ path: p }), /markitdown 不可用/);
		const runs = convert.listRuns();
		assert.equal(runs[0].status, "failed");
		assert.match(runs[0].error, /markitdown/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
