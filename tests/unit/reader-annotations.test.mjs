import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootLite, repoRoot } from "../helpers/boot-lite.mjs";

/** 批注问答必须只依据本文；无依据时明确说明，并返回结构化 JSON。 */
test("原文批注：提示词限定本文证据并要求结构化短答", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-annotations-"));
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
		const item = {
			id: "annotation-test",
			page: 3,
			quote: "图 3 图注仅注明 n = 3。",
			question: "误差线是 SD 还是 SEM？",
			messages: [
				{ role: "user", text: "误差线是 SD 还是 SEM？", at: new Date().toISOString() },
				{ role: "assistant", text: "图注未说明误差线类型。", at: new Date().toISOString() }
			]
		};
		const prompt = service.annotationPrompt(item, { pageText: "Figure 3. Error bars, n = 3." });
		assert.match(prompt, /第 3 页/);
		assert.match(prompt, /误差线是 SD 还是 SEM？/);
		assert.match(prompt, /原文未说明/);
		assert.match(prompt, /不要编造页码/);
		assert.match(prompt, /shortAnswer/);
		assert.match(prompt, /Figure 3/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
