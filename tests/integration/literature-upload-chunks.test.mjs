import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/** 分块上传：begin/chunk/finish 组装后交给现有导入流程，并清理临时目录。 */
test("文献分块上传：begin/chunk/finish 组装完成后清理暂存", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-literature-chunks-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storage"),
		coreOnly: true,
		extraRows: [
			{
				id: "ibm-runtime",
				name: pathToFileURL(join(repoRoot, "lib/runtime.js")).href,
				inject: ["ibmCore"],
				config: { skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), venvDir: join(dir, "venv") }
			},
			{
				id: "lab-literature",
				name: pathToFileURL(join(repoRoot, "plugins/literature/lib/index.js")).href,
				inject: ["ibmCore", "ibmRuntime"],
				config: { skillsRoot: join(repoRoot, "vendor/nature-skills/skills"), venvDir: join(dir, "venv") }
			}
		]
	});
	try {
		const service = handle.ctx.get("labLiteratureTasks");
		const project = await handle.ctx.ibmCore.createProject({ id: "lit-chunks", name: "分块上传课题" });
		const pdf = Buffer.from("%PDF-1.4\n% large upload\n%%EOF\n");
		const begin = await service.uploadReadingBegin({ name: "big-paper.pdf" });
		assert.ok(begin.uploadId);
		const half = Math.floor(pdf.length / 2);
		await service.uploadReadingChunk({ uploadId: begin.uploadId, index: 0, base64: pdf.subarray(0, half).toString("base64") });
		await service.uploadReadingChunk({ uploadId: begin.uploadId, index: 1, base64: pdf.subarray(half).toString("base64") });

		let assembled;
		service.uploadReadingPdfBuffer = async args => {
			assembled = args;
			return { bundle: { id: "bundle-chunks" }, reused: false };
		};
		const result = await service.uploadReadingFinish({ uploadId: begin.uploadId, projectId: project.id });
		assert.equal(result.bundle.id, "bundle-chunks");
		assert.equal(assembled.buffer.toString(), pdf.toString());
		assert.equal(assembled.extension, "pdf");

		const stagingRoot = join(dirname(service.projectsRoot), "reading-uploads");
		assert.equal(existsSync(join(stagingRoot, begin.uploadId)), false, "完成后应清理暂存目录");

		const aborted = await service.uploadReadingBegin({ name: "cancel.pdf" });
		await service.uploadReadingAbort({ uploadId: aborted.uploadId });
		assert.equal(existsSync(join(stagingRoot, aborted.uploadId)), false);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
