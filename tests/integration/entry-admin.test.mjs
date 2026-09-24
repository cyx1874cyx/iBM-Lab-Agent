/**
 * Integration: 文献条目管理 —— 改名（搬家）、重新提交、删除。
 *
 * 这三件事都动真实文件与 DB 路径，因此断言必须**同时**看磁盘和读数：
 * 只改 DB 会留下孤儿文件，只搬文件会让面板指向不存在的位置。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";

const skillsRoot = fileURLToPath(new URL("../../vendor/nature-skills/skills", import.meta.url));
const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function bootTasks() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-entry-admin-"));
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

/** 建课题 + 一条带正文的文献条目；命名刻意留一段待补，用于测试改名。 */
async function seedEntry(tasks) {
	const project = await tasks.createProject({
		id: "proj-admin",
		name: "条目管理",
		goalProfileId: "default-prodrug-polymer",
		goalProfileVersion: "1",
		templateId: "nature-default",
		templateVersion: "1"
	});
	const { bundle } = await tasks.registerPaperMeta({
		projectId: project.id,
		sourceType: "publisher",
		title: "Implantable Bioresponsive Nanoarray for Postoperative Immunotherapy",
		journal: "Advanced Materials",
		year: 2020,
		authors: ["Wang Lei"],
		naming: { summaryZh: "可植入 术后免疫", titleLead: "Implantable Bioresponsive Nanoarray" }
	});
	const pdf = Buffer.from("%PDF-1.7\n%v1\n");
	const staged = await tasks.stageFileIntoEntry({ projectId: project.id, bundleId: bundle.id, kind: "pdf", buffer: pdf });
	await tasks.registerCapturedFile({
		projectId: project.id,
		bundleId: bundle.id,
		kind: "pdf",
		filePath: staged.filePath,
		fileName: staged.fileName,
		size: pdf.length,
		fileSha256: sha256(pdf),
		tokenSha256: "token"
	});
	return { project, bundleId: bundle.id, pdf };
}

test("改名 apply：条目目录整体搬家、产物改名、DB 路径同步", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		const { project, bundleId } = await seedEntry(tasks);
		const before = tasks.getBundle(bundleId);
		assert.equal(before.entryStem, "AM 2020 Wang Lei 可植入 术后免疫 Implantable Bioresponsive Nanoarray");
		const oldDir = before.entryDir;
		const oldPdf = before.pdfPath;
		assert.ok(existsSync(oldPdf), "初始正文存在");

		const result = await tasks.setEntryNaming({
			projectId: project.id,
			bundleId,
			mode: "apply",
			naming: { correspondingAuthor: "王蕾" }
		});
		assert.equal(result.bundle.entryStem, "AM 2020 王蕾 可植入 术后免疫 Implantable Bioresponsive Nanoarray");
		const newDir = result.bundle.entryDir;
		assert.notEqual(newDir, oldDir);
		assert.ok(!existsSync(oldDir), "旧目录已删除");
		assert.ok(existsSync(result.bundle.pdfPath), "正文随目录搬走");
		assert.ok(result.bundle.pdfPath.startsWith(newDir), "DB 路径指向新目录");
		assert.ok(result.bundle.pdfPath.endsWith(`${result.bundle.entryStem}.pdf`), "文件名随 stem 改名");
		assert.ok(result.moved.length >= 1, "返回搬家清单");
		assert.deepEqual(result.missingNaming, [], "命名段已齐备");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("重新提交正文：覆盖同目录同名产物并刷新哈希，不新建条目、不换目录", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		const { project, bundleId } = await seedEntry(tasks);
		const before = tasks.getBundle(bundleId);
		const second = Buffer.from("%PDF-1.7\n%v2-corrected\n");
		const result = await tasks.resubmitBundleFile({ projectId: project.id, bundleId, kind: "pdf", buffer: second });
		assert.equal(result.bundle.id, bundleId, "复用同一条目");
		assert.equal(result.bundle.entryDir, before.entryDir, "不换目录");
		assert.equal(result.filePath, before.pdfPath, "覆盖同一文件名");
		assert.equal(result.sha256, sha256(second), "哈希已刷新");
		assert.equal(result.replaced, before.pdfPath);
		assert.equal(tasks.getBundle(bundleId).pdfSha256, sha256(second));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("删除条目：未确认时拒绝；确认后删目录、报告、PPT 与条目行", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		const { project, bundleId } = await seedEntry(tasks);
		await assert.rejects(
			() => tasks.deleteBundle({ projectId: project.id, bundleId, confirm: false }),
			/confirm=true/,
			"未确认必须拒绝"
		);
		const before = tasks.getBundle(bundleId);
		const entryDir = before.entryDir;
		assert.ok(existsSync(entryDir));

		const result = await tasks.deleteBundle({ projectId: project.id, bundleId, confirm: true });
		assert.ok(!existsSync(entryDir), "条目目录已删除");
		assert.equal(tasks.getBundle(bundleId), undefined, "条目行已删除");
		assert.ok(result.removed.includes(bundleId));
		assert.equal(result.reports.length >= 1, true, "连带删除精读报告行");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
