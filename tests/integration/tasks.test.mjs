/**
 * Integration: ctx.labTasks — 文献→PPT 任务编排（§五 流程 + §六 接口）。
 *
 * 机械化步骤调用 nature-skills 真实脚本（prepare_paper.py / audit_paper_card.py /
 * audit_pptx_quality.py，全部 stdlib，系统 python3）；searchLiterature 的网络
 * 路径用 stub executor（OpenAlex 依赖外网，不在自动化测试中跑）。
 * 审计门禁：报告审计失败阻止进入 PPT 阶段；PPTX QA 高严重度失败标记 failed。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";
import { buildPptx } from "../fixtures/pptx-builder.mjs";
import { PAPER_CARD_SECTION_CONTRACT } from "../../src/goal-profile.js";

const skillsRoot = fileURLToPath(new URL("../../vendor/nature-skills/skills", import.meta.url));
const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));
const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

async function bootTasks() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-tasks-"));
	const templatesDir = join(dir, "templates");
	await mkdir(templatesDir, { recursive: true });
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: vendorRoot,
		lockFile: fileURLToPath(new URL("../../vendor.lock.json", import.meta.url)),
		includePython: false,
		extraRows: [
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir } },
			{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labNoteTemplates", "labTemplates", "labVersions"], config: { skillsRoot, projectsRoot: join(dir, "projects") } }
		]
	});
	// 真实 vendor 树 → registry 有 NatureSkillVersion，provenance 才能记录 skill 版本
	await handle.ctx.labVersions.bootstrapFromVendor();
	// 输入副本放到临时目录：preparePaper/audit 的输出写到输入所在目录，
	// 避免污染仓库 fixtures
	const fxDir = join(dir, "fx");
	await mkdir(fxDir, { recursive: true });
	for (const f of ["min-source-map.json", "min-source-bundle.json", "paper-card-pass.md", "paper-card-fail.md"]) {
		await copyFile(join(fixtures, f), join(fxDir, f));
	}
	return { handle, dir, fxDir };
}

/** stub 掉需要外网的 executor 方法。 */
function stubNetwork(executor) {
	executor.search = async (query, opts) => [
		{ title: "Prodrug-conjugated polymers for drug delivery", doi: "10.1000/fake.1", authors: ["A. Chemist"], year: 2024, cited_by_count: 12 },
		{ title: "RAFT polymerization of methacrylate prodrugs", doi: "10.1000/fake.2", authors: ["B. Polymer"], year: 2023, cited_by_count: 5 }
	];
	executor.exportCitations = async () => ({ format: "ris", stdout: "TY  - JOUR\nTI  - Fake\nER  -" });
}

test("full flow: search → prepare → report → audit gate → presentation → qa gate", async () => {
	const { handle, dir, fxDir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		stubNetwork(tasks.executor);

		// §五 步骤 1：项目 + 目标/模板版本
		const project = await tasks.createProject({
			id: "proj-1",
			name: "聚前药组会",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});
		assert.equal(project.goalProfile.id, "default-prodrug-polymer");
		await assert.rejects(() => tasks.createProject({ id: "proj-1", name: "重复项目" }), /already exists/);
		assert.equal(project.memoryVersion, "1");
		assert.match(tasks.getProjectMemory("proj-1").markdown, /聚前药组会/);

		// 课题专属工作区目录：创建项目时自动 mkdir，可被 workspace.create 采纳
		assert.ok(project.workspacePath, "project carries a workspace path");
		assert.match(project.workspacePath, /proj-1$/);
		await assert.doesNotReject(() => mkdir(project.workspacePath, { recursive: true }), "workspace dir usable");

		// 工作区级绑定：一个课题一个 workspace，空间内所有会话共享课题
		const wsBinding = await tasks.bindProjectWorkspace({ projectId: "proj-1", workspaceId: "ws-proj-1" });
		assert.equal(wsBinding.workspaceId, "ws-proj-1");
		await tasks.bindProjectSession({ projectId: "proj-1", sessionId: "session-a", workspaceId: "ws-proj-1" });
		await tasks.bindProjectSession({ projectId: "proj-1", sessionId: "session-b", workspaceId: "ws-proj-1" });
		// 会话追加幂等
		await tasks.bindProjectSession({ projectId: "proj-1", sessionId: "session-a", workspaceId: "ws-proj-1" });
		assert.deepEqual(tasks.getProjectSession("proj-1").sessionIds, ["session-a", "session-b"]);
		// 会话 → 课题反查（每个绑定过的会话都能识别课题）
		assert.equal(tasks.getProjectBySession("session-b").project.id, "proj-1");
		assert.equal(tasks.getProjectBySession("session-unknown"), undefined);
		// 工作区 → 课题反查（空间内所有会话共享课题标识）
		const byWs = tasks.getProjectByWorkspace("ws-proj-1");
		assert.equal(byWs.project.id, "proj-1");
		assert.deepEqual(byWs.sessionIds, ["session-a", "session-b"]);
		// cwd 路径 → 课题反查（不依赖绑定：手动新建的对话也能识别课题）
		const byCwd = tasks.getProjectByCwd(project.workspacePath);
		assert.equal(byCwd.project.id, "proj-1");
		assert.equal(byCwd.workspaceId, "ws-proj-1");
		assert.equal(tasks.getProjectByCwd("/nonexistent/path"), undefined);
		assert.equal(tasks.getProjectByCwd(""), undefined);

		const memoryV2 = await tasks.updateProjectMemory({
			projectId: "proj-1",
			markdown: "# 聚前药组会\n\n## 当前进展\n- 已明确候选单体",
			changeNote: "补充候选单体"
		});
		assert.equal(memoryV2.version, "2");
		assert.equal(tasks.getProject("proj-1").memoryVersion, "2");
		assert.deepEqual(tasks.listProjectMemoryVersions("proj-1").map((row) => row.version), ["2", "1"]);
		assert.match(tasks.getProjectMemory("proj-1", "1").markdown, /请在此描述研究问题/);

		// 步骤 2：检索
		const search = await tasks.searchLiterature({ projectId: "proj-1", query: "prodrug polymer delivery", limit: 5 });
		assert.equal(search.status, "succeeded");
		assert.equal(search.results.length, 2);
		const exportRes = await tasks.exportSearchCitations(search.id, { format: "ris" });
		assert.match(exportRes.text, /TY  - JOUR/);

		// 步骤 3/4：论文准备（真实 prepare_paper.py，source_map 输入）
		const sourceMapPath = join(fxDir, "min-source-map.json");
		const bundle = await tasks.preparePaper({ projectId: "proj-1", sourceMapPath, title: "Prodrug polymers" });
		assert.equal(bundle.status, "succeeded");
		assert.ok(bundle.sourceMapPath, "source bundle written");
		const bundleJson = JSON.parse(await readFile(bundle.sourceMapPath, "utf8"));
		assert.equal(bundleJson.source_type, "source_map");

		// 步骤 5：精读报告（目标快照 + paper-card 审查要求）
		const report = await tasks.createReadingReport({
			projectId: "proj-1",
			bundleId: bundle.id,
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1"
		});
		assert.equal(report.status, "pending");
		assert.equal(report.paperCardRequirements.paperCardContract.sections, PAPER_CARD_SECTION_CONTRACT);
		assert.equal(report.goalSnapshot.id, "default-prodrug-polymer");
		// 默认按内置 note-default 阅读笔记模板快照（报告保存引用，后续模板修改不影响旧报告）
		assert.equal(report.noteTemplateSnapshot?.id, "note-default");
		assert.equal(report.noteTemplateSnapshot?.version, "1");
		assert.ok(report.noteRequirements?.sections?.length > 0, "reading report carries note template requirements");
		// 显式指定自定义阅读笔记模板时同样快照
		const customNote = await handle.ctx.labNoteTemplates.create("proj-note-custom", { name: "自定义笔记模板", sections: [{ key: "takeaways", title: "要点", required: true, hint: "" }] });
		const reportCustom = await tasks.createReadingReport({ projectId: "proj-1", bundleId: bundle.id, goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1", noteTemplateId: "proj-note-custom", noteTemplateVersion: "1" });
		assert.equal(reportCustom.noteTemplateSnapshot?.id, "proj-note-custom");
		assert.equal(reportCustom.noteRequirements.sections[0].key, "takeaways");

		// 步骤 7：agent 完成精读（fixture 通过版）
		const completed = await tasks.completeReadingReport({ reportId: report.id, paperCardPath: join(fxDir, "paper-card-pass.md") });
		assert.equal(completed.status, "running");

		// 步骤 6：审计门禁（真实 audit_paper_card.py）
		const audited = await tasks.validateReadingReport({ reportId: report.id });
		assert.equal(audited.status, "succeeded");
		assert.equal(audited.audit.ok, true);
		assert.equal(audited.audit.errors, 0);

		// 步骤 8：PPT 生成（仅审计通过可进入）
		const pres = await tasks.createPresentation({
			projectId: "proj-1",
			reportId: report.id,
			templateId: "nature-default",
			templateVersion: "1"
		});
		assert.equal(pres.status, "pending");
		assert.equal(pres.templateSnapshot.id, "nature-default");

		// 步骤 9/10：agent 完成 PPT（fixture pptx）+ 质量审计（真实 audit_pptx_quality.py）
		const { buffer } = await buildPptx({ name: "deck", slides: 2 });
		const pptxPath = join(dir, "deck.pptx");
		await writeFile(pptxPath, buffer);
		const done = await tasks.completePresentation({ runId: pres.id, pptxPath, outlinePath: join(dir, "outline.json"), speechNotesPath: join(dir, "notes.md") });
		assert.equal(done.status, "running");
		const qa = await tasks.validatePresentation({ runId: pres.id });
		assert.equal(qa.status, "succeeded");
		assert.equal(qa.qa.ok, true);
		assert.deepEqual(qa.qa.high, 0);

		// provenance：每个产物都记录了输入哈希与 skill 版本
		const provenance = tasks.listProvenance("proj-1");
		const kinds = new Set(provenance.map((p) => p.kind));
		assert.deepEqual([...kinds].sort(), ["presentation", "reading-report", "search", "source-bundle"]);
		for (const p of provenance) {
			assert.ok(p.inputsSha256.length === 64, "inputs hash recorded");
			assert.ok(p.skillVersions.length >= 1, `skill version recorded for ${p.kind}`);
		}
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("audit gate blocks presentation when the reading report fails validation", async () => {
	const { handle, dir, fxDir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		stubNetwork(tasks.executor);

		await tasks.createProject({
			id: "proj-2",
			name: "门禁测试",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});
		const bundle = await tasks.preparePaper({ projectId: "proj-2", sourceMapPath: join(fxDir, "min-source-map.json") });
		const report = await tasks.createReadingReport({
			projectId: "proj-2",
			bundleId: bundle.id,
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1"
		});
		await tasks.completeReadingReport({ reportId: report.id, paperCardPath: join(fxDir, "paper-card-fail.md") });

		// 审计失败 → 抛错 + report failed
		await assert.rejects(() => tasks.validateReadingReport({ reportId: report.id }), /audit failed/);
		const failed = tasks.getReadingReport(report.id);
		assert.equal(failed.status, "failed");
		assert.equal(failed.audit.ok, false);
		assert.ok(failed.audit.errors > 0);

		// 门禁：未通过审计 → createPresentation 明确拒绝
		await assert.rejects(
			() => tasks.createPresentation({ projectId: "proj-2", reportId: report.id, templateId: "nature-default", templateVersion: "1" }),
			/has not passed audit/
		);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("panel helpers: search RIS, overview, report download, ppt download, sessionId", async () => {
	const { handle, dir, fxDir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		stubNetwork(tasks.executor);

		await tasks.createProject({
			id: "proj-panel",
			name: "面板数据",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});

		// 检索带 sessionId：面板点击记录可跳回会话
		const search = await tasks.searchLiterature({
			projectId: "proj-panel",
			query: "prodrug polymer",
			limit: 2,
			sessionId: "session-x"
		});
		assert.equal(search.status, "succeeded");
		assert.equal(search.sessionId, "session-x");

		// 检索 run 的离线 RIS：包含该次检索登记到的文献（标题/作者/年份/DOI/source）
		const ris = tasks.searchRunRis(search.id);
		assert.equal(ris.format, "ris");
		assert.equal(ris.count, 2);
		assert.match(ris.text, /TY  - JOUR/);
		assert.match(ris.text, /Prodrug-conjugated polymers for drug delivery/);
		assert.match(ris.text, /A\. Chemist/);
		assert.match(ris.text, /10\.1000\/fake\.1/);
		assert.match(ris.text, /2024/);

		// 精读报告：bundle + paper-card（通过版 fixture，含短引用字段登记）
		const bundle = await tasks.preparePaper({ projectId: "proj-panel", sourceMapPath: join(fxDir, "min-source-map.json"), title: "Prodrug polymers（原文）" });
		const created = await tasks.createReadingReport({
			projectId: "proj-panel",
			bundleId: bundle.id,
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			shortCitation: "Zhu et al., 2024",
			titleZh: "聚前药高分子给药平台",
			summary: "这是一段约两百字的预设概览正文，用于面板「文献概览」卡片直接展示，不依赖 paper card 推导。"
		});
		const report = await tasks.completeReadingReport({
			reportId: created.id,
			paperCardPath: join(fxDir, "paper-card-pass.md")
		});
		assert.equal(report.shortCitation, "Zhu et al., 2024");
		assert.equal(report.titleZh, "聚前药高分子给药平台");

		// 概览：优先用登记时的 summary（不读网络/不解析文件）
		const overview = await tasks.readingReportOverview(report.id);
		assert.equal(overview.shortCitation, "Zhu et al., 2024");
		assert.equal(overview.titleZh, "聚前药高分子给药平台");
		assert.match(overview.summary, /预设概览正文/);

		// 未登记 summary 时：从 paper-card 推导 200 字概览
		const noSummary = await tasks.createReadingReport({ projectId: "proj-panel", bundleId: bundle.id, goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1" });
		await tasks.completeReadingReport({ reportId: noSummary.id, paperCardPath: join(fxDir, "paper-card-pass.md") });
		const derived = await tasks.readingReportOverview(noSummary.id);
		assert.ok(derived.summary.length <= 204, "derived summary roughly 200 chars");
		assert.ok(derived.summary.length > 0);
		assert.match(derived.summary, /polymer platform/i, "derived from paper-card body");

		// 精读报告下载：返回 paper-card Markdown
		const download = await tasks.readingReportDownload(report.id);
		assert.equal(download.fileName, `${report.id}.md`);
		assert.match(download.mime, /text\/markdown/);
		assert.match(download.text, /1 Overview|^#/m, "markdown content returned");

		// PPT 下载：为该 report 生成含 pptx 的 run → base64 返回
		await tasks.validateReadingReport({ reportId: report.id });
		const pres = await tasks.createPresentation({ projectId: "proj-panel", reportId: report.id, templateId: "nature-default", templateVersion: "1" });
		const { buffer } = await buildPptx({ name: "p", slides: 1 });
		const pptxPath = join(dir, "deck-panel.pptx");
		await writeFile(pptxPath, buffer);
		const done = await tasks.completePresentation({ runId: pres.id, pptxPath });
		const ppt = await tasks.presentationDownload(report.id);
		assert.equal(ppt.fileName, `${pres.id}.pptx`);
		assert.match(ppt.mime, /presentationml\.presentation/);
		assert.ok(ppt.base64.length > 0);
		// 解析回二进制与源一致
		const bytes = Buffer.from(ppt.base64, "base64");
		assert.deepEqual(bytes, buffer, "pptx bytes round-trip");

		// 无 PPT 的 report：错误信息明确
		await assert.rejects(() => tasks.presentationDownload(noSummary.id), /no downloadable PPTX/);
		// 无结果检索：RIS 导出也明确报错
		const originalSearch = tasks.executor.search;
		tasks.executor.search = async () => [];
		const emptySearch = await tasks.searchLiterature({ projectId: "proj-panel", query: "empty probe", limit: 1 });
		tasks.executor.search = originalSearch;
		await assert.rejects(async () => tasks.searchRunRis(emptySearch.id), /no results/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
