/**
 * Integration: lab_convert_document 模型工具注册与执行。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

async function bootConvertTool() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-ctool-"));
	const convertedDir = join(dir, "converted");
	await mkdir(convertedDir, { recursive: true });
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
			{ id: "tools", name: "@deepseek-ai/dsh-tools" },
			{ id: "lab-convert", name: "dsh-lab-agent/convert", inject: ["storageDomain"], config: { convertedDir } },
			{ id: "convert-document", name: "dsh-lab-agent/convert-tool", inject: ["tools", "labConvert"] }
		]
	});
	return { handle, dir };
}

test("convert-document registers the lab_convert_document tool", async () => {
	const { handle, dir } = await bootConvertTool();
	try {
		const schemas = handle.ctx.tools.schemas();
		const tool = schemas.find((t) => t.name === "lab_convert_document");
		assert.ok(tool, "lab_convert_document registered");
		const paramPath = tool.parameters?.properties?.path ?? tool.parameters?.path;
		assert.ok(paramPath, "path parameter required");

		// 执行路径（mock 转换服务）
		const labConvert = handle.ctx.labConvert;
		labConvert.convert = async (path, opts) => ({ available: true, text: "# 文档内容\n第二行", code: 0 });
		const src = join(dir, "paper.docx");
		await writeFile(src, "dummy docx bytes");
		const definition = handle.ctx.tools.get("lab_convert_document");
		const result = await definition.execute({ path: src, previewChars: 100 });
		assert.equal(result.ok, true);
		assert.match(result.preview, /文档内容/);
		assert.ok(result.mdPath.endsWith(".md"));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
