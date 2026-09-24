/**
 * Integration: 文献条目命名规范落地（课题组《文献命名及分类保存建议》）。
 *
 *   <期刊缩写> <年份> <通讯作者> <中文内容概括> <英文题目前段>
 *
 * 断言：登记元数据时接受命名段 → 占位即固化目录 → 正文/SI 落在该目录且文件名
 * 符合规范 → lab_tasks_get_reading_inputs 能回显当前命名与还缺哪几段。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";
import { entryFileName } from "../../lib/entry-layout.js";

const skillsRoot = fileURLToPath(new URL("../../vendor/nature-skills/skills", import.meta.url));
const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));

async function bootTasks() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-naming-"));
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

const SLIDE_STEM = "ACS NANO 2021 张志平 仿生纳米囊泡 化疗免疫 Immunogenic Hybrid Nanovesicles";

test("命名规范：元数据登记即固化条目目录，正文/SI 按规范落位", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		await tasks.createProject({
			id: "proj-naming",
			name: "命名规范验证",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});

		// 1) 元数据占位：Agent 一次给全命名段（幻灯片实例）
		const { bundle } = await tasks.registerPaperMeta({
			projectId: "proj-naming",
			sourceType: "publisher",
			title: "Immunogenic Hybrid Nanovesicles for Chemo-Immunotherapy",
			doi: "10.1021/acsnano.1c00001",
			journal: "ACS Nano",
			year: 2021,
			authors: ["Wang Wei", "张志平"],
			naming: {
				journalAbbrev: "ACS NANO",
				correspondingAuthor: "张志平",
				summaryZh: "仿生纳米囊泡 化疗免疫",
				titleLead: "Immunogenic Hybrid Nanovesicles"
			}
		});

		assert.equal(bundle.entryStem, SLIDE_STEM, "条目标识 = 五段规范");
		assert.equal(bundle.naming.correspondingAuthor, "张志平");
		const workspace = await tasks.ensureProjectWorkspace("proj-naming");
		assert.equal(bundle.entryDir, join(workspace.path, "literature", SLIDE_STEM), "产物存于对应命名目录");

		// 2) 正文：文件名就是 stem（幻灯片里正文名不带“正文”后缀）
		const pdf = await tasks.stageFileIntoEntry({
			projectId: "proj-naming",
			bundleId: bundle.id,
			kind: "pdf",
			buffer: Buffer.from("%PDF-1.7\n%test\n")
		});
		assert.equal(pdf.fileName, entryFileName(SLIDE_STEM, "pdf"));
		assert.equal(pdf.fileName, `${SLIDE_STEM}.pdf`);
		assert.equal(pdf.filePath, join(bundle.entryDir, `${SLIDE_STEM}.pdf`));
		assert.ok(existsSync(pdf.filePath), "正文落盘");

		// 3) SI：同一目录、加 SI、题目前段可缩短
		const si = await tasks.stageFileIntoEntry({
			projectId: "proj-naming",
			bundleId: bundle.id,
			kind: "si",
			buffer: Buffer.from("%PDF-1.7\n%si\n")
		});
		assert.equal(si.fileName, `${SLIDE_STEM} SI.pdf`);
		assert.equal(si.filePath, join(bundle.entryDir, `${SLIDE_STEM} SI.pdf`), "SI 与正文同目录");

		// 4) 精读条目盘点回显命名与缺口
		const inputs = await tasks.readingReportInputs({ projectId: "proj-naming", bundleId: bundle.id });
		assert.equal(inputs.entryStem, SLIDE_STEM);
		assert.equal(inputs.entryDir, bundle.entryDir);
		assert.deepEqual(inputs.missingNaming, [], "命名各段已齐备");
		// stageFileIntoEntry 只负责把字节写进条目目录（bundle.pdfPath 的登记由
		// registerCapturedFile / preparePaper 完成），这里的命名断言以磁盘为准。
		assert.ok(existsSync(join(bundle.entryDir, `${SLIDE_STEM}.pdf`)));
		assert.ok(existsSync(join(bundle.entryDir, `${SLIDE_STEM} SI.pdf`)));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("命名规范：命名段可后补且不互相覆盖，缺失时回显缺口", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		await tasks.createProject({
			id: "proj-patch",
			name: "命名补全",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});

		// 先只给中文概括
		const first = await tasks.registerPaperMeta({
			projectId: "proj-patch",
			sourceType: "publisher",
			title: "An Injectable Supramolecular Polymer Nanocomposite",
			journal: "Advanced Functional Materials",
			year: 2020,
			authors: ["Liu Guangwen"],
			naming: { summaryZh: "乳腺癌术后" }
		});
		assert.equal(first.bundle.entryStem, "AFM 2020 Liu Guangwen 乳腺癌术后 An Injectable Supramolecular Polymer Nanocomposite");
		assert.deepEqual(first.bundle.naming, { summaryZh: "乳腺癌术后" });

		// 同一条目再补通讯作者：既有 summaryZh 不能被抹掉。
		// 去重按 sourceUrl / DOI / （无标识时）同题名的 awaiting-pdf 条目匹配，
		// 因此这里沿用「无 DOI」的登记形态。
		const second = await tasks.registerPaperMeta({
			projectId: "proj-patch",
			sourceType: "publisher",
			title: "An Injectable Supramolecular Polymer Nanocomposite",
			naming: { correspondingAuthor: "刘广文" }
		});
		assert.equal(second.bundle.id, first.bundle.id, "同题名的待上传条目被幂等复用");
		assert.deepEqual(second.bundle.naming, { summaryZh: "乳腺癌术后", correspondingAuthor: "刘广文" });
		// entryStem 已固化：后补命名不移动既有目录（改名要显式工具）
		assert.equal(second.bundle.entryStem, first.bundle.entryStem);

		// 全新条目缺命名段时回显缺口
		const bare = await tasks.registerPaperMeta({
			projectId: "proj-patch",
			sourceType: "publisher",
			title: "Bare Metadata Paper",
			authors: []
		});
		const inputs = await tasks.readingReportInputs({ projectId: "proj-patch", bundleId: bare.bundle.id });
		assert.ok(inputs.missingNaming.includes("summaryZh"), `实际缺口 ${inputs.missingNaming.join(",")}`);
		assert.ok(inputs.missingNaming.includes("correspondingAuthor"));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
