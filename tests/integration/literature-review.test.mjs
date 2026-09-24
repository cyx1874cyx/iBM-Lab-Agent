/**
 * Integration: 文献综述（检索条目 → 综述文档 + 综述 PPT）。
 *
 * 断言：综述模板来自 kind=review 的模板域；生成契约与产物全部落在
 * <workspace>/literature/reviews/<runStem>/；同一 runId 重复登记是覆盖式重新提交。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";
import { literatureSearchRunSchema } from "../../src/task-models.js";

const skillsRoot = fileURLToPath(new URL("../../vendor/nature-skills/skills", import.meta.url));
const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));

async function bootTasks() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-review-"));
	const templatesDir = join(dir, "templates");
	await mkdir(templatesDir, { recursive: true });
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: vendorRoot,
		lockFile: fileURLToPath(new URL("../../vendor.lock.json", import.meta.url)),
		includePython: false,
		extraRows: [
			{ id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
			{ id: "tools", name: "@deepseek-ai/dsh-tools" },
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir } },
			{
				id: "lab-tasks",
				name: "dsh-lab-agent/tasks",
				inject: ["storageDomain", "labGoals", "labNoteTemplates", "labTemplates", "labVersions"],
				config: { skillsRoot, projectsRoot: join(dir, "projects") }
			}
		]
	});
	await handle.ctx.labVersions.bootstrapFromVendor();
	return { handle, dir };
}

async function seedSearchRun(tasks) {
	const project = await tasks.createProject({
		id: "proj-review",
		name: "综述写作",
		goalProfileId: "default-prodrug-polymer",
		goalProfileVersion: "1",
		templateId: "nature-default",
		templateVersion: "1"
	});
	const now = new Date().toISOString();
	const run = literatureSearchRunSchema.parse({
		id: "search-review1",
		projectId: project.id,
		title: "聚前药递送综述",
		query: "prodrug polymer delivery",
		queries: ["prodrug polymer delivery"],
		sources: ["openalex", "crossref"],
		results: [
			{ id: "W1", title: "A prodrug polymer platform", doi: "10.1000/a", year: 2023, journal: "JACS", authors: ["Zhang San"], abstract: "Abstract A", shortDescriptionZh: "前药平台" },
			{ id: "W2", title: "Bioresponsive nanoarray", doi: "10.1000/b", year: 2024, journal: "AM", authors: ["Li Si"], abstract: "Abstract B", shortDescriptionZh: "响应性阵列" }
		],
		status: "succeeded",
		createdAt: now,
		updatedAt: now
	});
	await tasks.table("searches").put(run.id, run);
	return { project, run };
}

test("综述模板：kind=review 与阅读笔记模板同域但分开列出", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const reviewTemplates = await handle.ctx.labNoteTemplates.listReviewTemplates();
		assert.ok(reviewTemplates.length >= 1, "种子综述模板存在");
		assert.equal(reviewTemplates[0].id, "review-default");
		assert.equal(reviewTemplates[0].kind, "review");
		const all = await handle.ctx.labNoteTemplates.list();
		assert.ok(all.some((row) => row.kind === "note"), "阅读笔记模板仍在");
		assert.ok(all.some((row) => row.kind === "review"), "综述模板进入同一列表");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("综述写作：契约与报告落在检索条目自己的目录，可覆盖重提", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		const { project, run } = await seedSearchRun(tasks);

		const inputs = await tasks.readingReviewInputs({ projectId: project.id, runId: run.id });
		assert.equal(inputs.resultCount, 2);
		assert.equal(inputs.formatSource, "review-template");
		assert.equal(inputs.template.id, "review-default");
		assert.deepEqual(inputs.papers.map((paper) => paper.summaryZh), ["前药平台", "响应性阵列"]);
		assert.ok(inputs.archiveDir.includes(join("literature", "reviews", "聚前药递送综述")), `实际归档目录 ${inputs.archiveDir}`);

		const contract = await tasks.materializeReviewContract(inputs);
		assert.ok(existsSync(contract.contractPath), "综述生成契约已落盘");
		assert.ok(contract.contractPath.includes("综述生成契约"), contract.contractPath);
		assert.ok(contract.templateSectionCount >= 5, "契约带模板章节数");

		const first = await tasks.registerReview({
			projectId: project.id,
			runId: run.id,
			markdown: "# 综述\n\n第一版"
		});
		assert.equal(first.run.review.status, "ready");
		assert.equal(first.markdownPath, join(inputs.archiveDir, "聚前药递送综述 综述报告.md"));
		assert.ok(existsSync(first.markdownPath));

		// 重新提交：覆盖同一文件，不新建目录
		const second = await tasks.registerReview({
			projectId: project.id,
			runId: run.id,
			markdown: "# 综述\n\n第二版（按审核意见修改）"
		});
		assert.equal(second.markdownPath, first.markdownPath, "同一路径覆盖");
		assert.notEqual(second.run.review.sha256, first.run.review.sha256, "哈希已刷新");
		assert.match(await (await import("node:fs/promises")).readFile(second.markdownPath, "utf8"), /第二版/);

		// 综述 PPT：复制进同一归档目录
		const pptxSource = join(dir, "deck.pptx");
		await (await import("node:fs/promises")).writeFile(pptxSource, Buffer.from("PK\u0003\u0004fake-pptx"));
		const deck = await tasks.registerReviewPresentation({ projectId: project.id, runId: run.id, pptxPath: pptxSource });
		assert.equal(deck.pptxPath, join(inputs.archiveDir, "聚前药递送综述 综述PPT.pptx"));
		assert.ok(existsSync(deck.pptxPath));

		const file = await tasks.reviewFile(run.id, "report");
		assert.ok(file.byteLength > 0);
		assert.match(file.fileName, /综述报告\.md$/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
