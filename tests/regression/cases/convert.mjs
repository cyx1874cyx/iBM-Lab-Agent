/**
 * Regression case: markitdown 文档转换（可选依赖）。
 * 成功路径 mock 执行器 + 降级路径（markitdown 未安装时清晰报错）。
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { buildDocx } from "../../../tests/fixtures/office-builder.mjs";

export default {
	name: "convert",
	description: "markitdown 转换：上传→MD 保存→记录；未安装时降级",
	tags: ["convert"],
	required: [],
	async run() {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-conv-"));
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
		try {
			const convert = handle.ctx.labConvert;
			const problems = [];

			// 成功路径（mock 执行器）
			convert.convert = async (path, opts) => ({ available: true, text: "# md 结果", code: 0 });
			const docx = await buildDocx();
			const result = await convert.convertUpload({ name: "a.docx", base64: docx.buffer.toString("base64") });
			if (result.run.status !== "succeeded") problems.push("convert success path broken");
			if (result.run.inputsSha256.length !== 64) problems.push("inputs hash missing");

			// 降级路径（未安装）
			convert.convert = async () => ({ available: false, error: "markitdown not installed; run: python -m pip install markitdown" });
			const p = join(dir, "b.docx");
			await writeFile(p, docx.buffer);
			let degraded = false;
			try {
				await convert.convertToMarkdown({ path: p });
			} catch {
				degraded = true;
			}
			if (!degraded) problems.push("unavailable converter did not fail cleanly");
			if (convert.listRuns().length !== 2) problems.push("convert run records incomplete");

			return { pass: problems.length === 0, details: problems.length === 0 ? "convert success + degrade paths ok" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
