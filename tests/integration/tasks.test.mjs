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
import { createHash } from "node:crypto";
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
		{ title: "Prodrug-conjugated polymers for drug delivery", doi: "10.1000/fake.1", authors: ["A. Chemist"], year: 2024, cited_by_count: 12, journal: "Biomaterials", abstract: "An OA prodrug polymer study.", isOa: true, oaStatus: "gold", pdfUrl: "https://example.org/fake.1.pdf", sources: ["openalex", "crossref"] },
		{ title: "RAFT polymerization of methacrylate prodrugs", doi: "10.1000/fake.2", authors: ["B. Polymer"], year: 2023, cited_by_count: 5, journal: "Macromolecules", isOa: true, sources: ["openalex"] }
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
		assert.equal(search.oaOnly, true);
		assert.equal(search.results[0].journal, "Biomaterials");
		assert.equal(search.results[0].abstract, "An OA prodrug polymer study.");
		assert.equal(search.results[0].isOa, true);
		assert.deepEqual(search.results[0].sources, ["openalex", "crossref"]);
		const exportRes = await tasks.exportSearchCitations(search.id, { format: "ris" });
		assert.match(exportRes.text, /TY  - JOUR/);

		// 步骤 3/4：论文准备（真实 prepare_paper.py，source_map 输入）
		const sourceMapPath = join(fxDir, "min-source-map.json");
		const bundle = await tasks.preparePaper({ projectId: "proj-1", sourceMapPath, title: "Prodrug polymers" });
		assert.equal(bundle.status, "succeeded");
		assert.ok(bundle.sourceMapPath, "source bundle written");
		assert.equal(bundle.pdfPath, undefined, "source-map-only bundles do not claim to contain a PDF");
		assert.equal(bundle.pdfSha256, undefined);
		await assert.rejects(() => tasks.bundleFile(bundle.id, "pdf"), /has no pdf file/);
		const bundleJson = JSON.parse(await readFile(bundle.sourceMapPath, "utf8"));
		assert.equal(bundleJson.source_type, "source_map");

		// When both inputs are available, source-map preparation and PDF download
		// keep separate hashes so client-side integrity verification uses PDF bytes.
		const pdfPath = join(fxDir, "paper.pdf");
		const siPath = join(fxDir, "supporting.txt");
		const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n%%EOF");
		const siBytes = Buffer.from("supplementary information");
		await writeFile(pdfPath, pdfBytes);
		await writeFile(siPath, siBytes);
		const bundleWithFiles = await tasks.preparePaper({
			projectId: "proj-1",
			sourceMapPath,
			pdfPath,
			siPath,
			doi: "https://doi.org/10.1000/fake.1"
		});
		assert.equal(bundleWithFiles.pdfSha256, createHash("sha256").update(pdfBytes).digest("hex"));
		assert.equal(bundleWithFiles.siSha256, createHash("sha256").update(siBytes).digest("hex"));
		const pdfFile = await tasks.bundleFile(bundleWithFiles.id, "pdf");
		const siFile = await tasks.bundleFile(bundleWithFiles.id, "si");
		assert.deepEqual(pdfFile.buffer, pdfBytes);
		assert.deepEqual(siFile.buffer, siBytes);
		// 精读前必须盘点全部已有资源，并优先返回阅读笔记模板要求。
		const readingInputs = await tasks.readingReportInputs({ projectId: "proj-1", bundleId: bundleWithFiles.id });
		assert.equal(readingInputs.formatSource, "reading-note-template");
		assert.equal(readingInputs.templateId, "note-default");
		assert.deepEqual(readingInputs.resources.map((row) => [row.kind, row.available]), [
			["main-pdf", true],
			["si", true],
			["source-map", true]
		]);
		assert.deepEqual(new Set(readingInputs.mustReadPaths), new Set([pdfPath, siPath, bundleWithFiles.sourceMapPath]));
		assert.match(readingInputs.instructions.join("\n"), /正文和 SI/);
		assert.match(readingInputs.instructions.join("\n"), /不得覆盖模板结构/);

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
		// 微信占位等既有待精读条目，也能在生成产物前切换并固化所选模板。
		const selectedTemplate = await tasks.selectReadingReportTemplate({ reportId: report.id, noteTemplateId: "proj-note-custom", noteTemplateVersion: "1" });
		assert.equal(selectedTemplate.noteTemplateSnapshot.id, "proj-note-custom");
		const selectedInputs = await tasks.readingReportInputs({ projectId: "proj-1", reportId: report.id });
		assert.equal(selectedInputs.templateId, "proj-note-custom");
		assert.equal(selectedInputs.generationRequirements.sections[0].title, "要点");

		// 步骤 7：agent 完成精读（fixture 通过版）
		const completed = await tasks.completeReadingReport({ reportId: report.id, paperCardPath: join(fxDir, "paper-card-pass.md") });
		assert.equal(completed.status, "under-review");
		assert.equal(completed.review.status, "pending");
		assert.equal(completed.audit.ok, true, "登记完成后自动机器评审");
		assert.equal(completed.audit.errors, 0);
		const reportReview = await tasks.machineReviewDetails({ reportId: report.id });
		assert.equal(reportReview.ok, true);
		assert.ok(reportReview.findings.length > 0, "machine review details are explainable");
		const humanApproved = await tasks.reviewReadingReport({ reportId: report.id, decision: "approved", note: "证据链已核对" });
		assert.equal(humanApproved.status, "succeeded");
		assert.equal(humanApproved.review.status, "approved");

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
		assert.equal(done.status, "under-review");
		assert.equal(done.qa.ok, true, "PPT 登记完成后自动机器 QA");
		assert.deepEqual(done.qa.high, 0);
		const pptReview = await tasks.machineReviewDetails({ runId: pres.id });
		assert.equal(pptReview.ok, true);
		assert.ok(Array.isArray(pptReview.findings));
		const pptApproved = await tasks.reviewPresentation({ runId: pres.id, decision: "approved" });
		assert.equal(pptApproved.status, "succeeded");
		assert.equal(pptApproved.review.status, "approved");

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

test("self-check findings do not block staging, human review, or PPT generation", async () => {
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
		// 登记后实际 DOCX 先暂存；即使自查发现问题也保持可人工预览/审核。
		const staged = await tasks.completeReadingReport({ reportId: report.id, paperCardPath: join(fxDir, "paper-card-fail.md") });
		assert.equal(staged.status, "under-review");
		assert.equal(staged.audit.ok, false);
		assert.ok(staged.audit.errors > 0);
		assert.ok(staged.docxPath);

		// PPT 可在报告待审时继续生成；自查结果不是流程门禁。
		const run = await tasks.createPresentation({ projectId: "proj-2", reportId: report.id, templateId: "nature-default", templateVersion: "1" });
		assert.equal(run.status, "pending");
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
			shortCitation: "Tang et al., Nature 630, 84-90 (2024)",
			titleZh: "聚前药高分子给药平台",
			summary: "这是一段约两百字的预设概览正文，用于面板「文献概览」卡片直接展示，不依赖 paper card 推导。"
		});
		const report = await tasks.completeReadingReport({
			reportId: created.id,
			paperCardPath: join(fxDir, "paper-card-pass.md")
		});
		assert.equal(report.shortCitation, "Nature 630, 84–90 (2024).");
		assert.equal(report.titleZh, "聚前药高分子给药平台");
		// 升级迁移：旧版已有产物却卡在 running 的记录自动转为待人工审阅。
		await tasks.table("reports").put(report.id, { ...report, status: "running", progress: "paper card written" });
		await tasks.migrateLegacyReviewGates();
		assert.equal(tasks.getReadingReport(report.id).status, "under-review");

		// 概览：优先用登记时的 summary（不读网络/不解析文件）
		const overview = await tasks.readingReportOverview(report.id);
		assert.equal(overview.shortCitation, "Nature 630, 84–90 (2024).");
		assert.equal(overview.titleZh, "聚前药高分子给药平台");
		assert.match(overview.summary, /预设概览正文/);

		// 未登记 summary 时：从 paper-card 推导 200 字概览
		const noSummary = await tasks.createReadingReport({ projectId: "proj-panel", bundleId: bundle.id, goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1" });
		await tasks.completeReadingReport({ reportId: noSummary.id, paperCardPath: join(fxDir, "paper-card-pass.md") });
		const derived = await tasks.readingReportOverview(noSummary.id);
		assert.ok(derived.summary.length <= 204, "derived summary roughly 200 chars");
		assert.ok(derived.summary.length > 0);
		assert.match(derived.summary, /polymer platform/i, "derived from paper-card body");

		// 审核前只能预览，不能下载原文件。
		await assert.rejects(() => tasks.readingReportDownload(report.id), /awaiting human review/);
		const approvedReport = await tasks.reviewReadingReport({ reportId: report.id, decision: "approved" });
		assert.equal(approvedReport.review.artifactSha256, approvedReport.artifactSha256);

		// 审核后精读报告下载：返回 paper-card Markdown
		const download = await tasks.readingReportDownload(report.id);
		assert.equal(download.fileName, `${report.id}.md`);
		assert.match(download.mime, /text\/markdown/);
		assert.match(download.text, /1 Overview|^#/m, "markdown content returned");

		// PPT 下载：为该 report 生成含 pptx 的 run → base64 返回
		const pres = await tasks.createPresentation({ projectId: "proj-panel", reportId: report.id, templateId: "nature-default", templateVersion: "1" });
		const { buffer } = await buildPptx({ name: "p", slides: 1 });
		const pptxPath = join(dir, "deck-panel.pptx");
		await writeFile(pptxPath, buffer);
		const done = await tasks.completePresentation({ runId: pres.id, pptxPath });
		assert.equal(done.status, "under-review");
		await assert.rejects(() => tasks.presentationDownload(report.id), /awaiting human review/);
		const approvedPpt = await tasks.reviewPresentation({ runId: pres.id, decision: "approved" });
		assert.equal(approvedPpt.review.artifactSha256, approvedPpt.artifactSha256);
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

test("createPresentation accepts a staged report before human review and records advisory skipAudit", async () => {
	const { handle, dir, fxDir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		stubNetwork(tasks.executor);

		await tasks.createProject({
			id: "proj-skip",
			name: "跳过审计登记链",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});
		const bundle = await tasks.preparePaper({ projectId: "proj-skip", sourceMapPath: join(fxDir, "min-source-map.json") });
		const report = await tasks.createReadingReport({
			projectId: "proj-skip",
			bundleId: bundle.id,
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1"
		});
		await tasks.completeReadingReport({ reportId: report.id, paperCardPath: join(fxDir, "paper-card-pass.md") });

		// 报告暂存后即可继续制作 PPT；报告和 PPT 分别在预览页人工审核。
		const run = await tasks.createPresentation({
			projectId: "proj-skip",
			reportId: report.id,
			templateId: "nature-default",
			templateVersion: "1",
			skipAudit: true
		});
		assert.equal(run.status, "pending");
		assert.equal(run.auditSkipped, true);
		assert.equal(tasks.getReadingReport(report.id).status, "under-review");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("one session aggregates multiple literature queries into one entry and one RIS", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		await tasks.createProject({
			id: "proj-session-search",
			name: "会话检索聚合",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});
		tasks.executor.search = async (query) => query.includes("sensor") ? [
			{ id: "https://openalex.org/W123456789", title: "Injectable ultrasonic sensor", doi: "10.1000/sensor", authors: ["A Author"], year: 2024, journal: "Nature", volume: "630", pages: "84-90", isOa: true, sources: ["openalex"] }
		] : [
			{ title: "Polymer delivery review", doi: "10.1000/review", authors: ["B Author"], year: 2023, journal: "Biomaterials", volume: "301", pages: "1-12", abstract: "A systematic review", isOa: true, sources: ["crossref"] }
		];
		const first = await tasks.searchLiterature({ projectId: "proj-session-search", sessionId: "session-literature-1", title: "植入式传感器研究", query: "injectable sensor" });
		const second = await tasks.searchLiterature({ projectId: "proj-session-search", sessionId: "session-literature-1", title: "植入式传感与递送材料研究", query: "polymer delivery" });
		assert.equal(second.id, first.id);
		assert.equal(tasks.listSearchRuns("proj-session-search").length, 1);
		assert.equal(second.results.length, 2);
		assert.deepEqual(second.queries, ["injectable sensor", "polymer delivery"]);
		assert.equal(second.title, "植入式传感与递送材料研究");
		assert.ok(second.results.every((paper) => paper.shortDescriptionZh === "摘要待提炼"));
		const summarized = await tasks.updateSearchSummaries({ runId: first.id, summaries: [
			{ paperId: "https://openalex.org/W123456789", summaryZh: "可注射超声监测" },
			{ paperId: "https://doi.org/10.1000/review", summary: "归纳聚合物递送" },
			{ paperId: "10.1000/invalid", summaryZh: "传感器件" }
		] });
		assert.equal(summarized.updated, 2);
		assert.equal(summarized.rejected.length, 1);
		assert.deepEqual(summarized.unmatched, []);
		assert.deepEqual(new Set(summarized.run.results.map((paper) => paper.shortDescriptionZh)), new Set(["可注射超声监测", "归纳聚合物递送"]));
		const aliasRetry = await tasks.updateSearchSummaries({ runId: first.id, summaries: [
			{ paperId: "openalex:W123456789", summaryZh: "实现无线超声监测" },
			{ paperId: "missing-paper-id", summaryZh: "验证死亡风险关联" }
		] });
		assert.equal(aliasRetry.updated, 1);
		assert.deepEqual(aliasRetry.unmatched, ["missing-paper-id"]);
		assert.deepEqual(new Set(aliasRetry.availablePaperIds), new Set(["10.1000/sensor", "10.1000/review"]));
		const ris = tasks.searchRunRis(first.id);
		assert.equal(ris.count, 2);
		assert.equal((ris.text.match(/^TY  - /gm) || []).length, 2);
		assert.match(ris.text, /VL  - 630/);
		assert.match(ris.text, /SP  - 84/);
		assert.match(ris.text, /EP  - 90/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("WeChat metadata enters the reading queue without a PDF and later reuses the same bundle/report", async () => {
	const { handle, dir, fxDir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		await tasks.createProject({
			id: "proj-wechat",
			name: "公众号文献收集",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});
		await assert.rejects(() => tasks.registerWechatPaper({
			projectId: "proj-wechat", sourceUrl: "https://example.com/article", title: "Invalid"
		}), /mp\.weixin\.qq\.com/);

		const first = await tasks.registerWechatPaper({
			projectId: "proj-wechat",
			sourceUrl: "https://mp.weixin.qq.com/s?__biz=test&mid=123&idx=1&sn=abc&scene=21#wechat_redirect",
			title: "A prodrug polymer platform for targeted delivery",
			authors: ["Alice Zhang", "Bo Li"],
			doi: "https://doi.org/10.1000/wechat.1",
			journal: "Biomaterials",
			publicationDate: "2025-06-12",
			volume: "320",
			pages: "100-112",
			abstract: "The article reports a targeted prodrug polymer platform.",
			keywords: ["prodrug", "polymer"]
		});
		assert.equal(first.created, true);
		assert.equal(first.bundle.sourceType, "wechat");
		assert.equal(first.bundle.acquisitionStatus, "awaiting-pdf");
		assert.equal(first.bundle.status, "pending");
		assert.equal(first.bundle.pdfPath, undefined);
		assert.equal(first.bundle.sourceUrl.includes("scene="), false);
		assert.equal(first.bundle.year, 2025);
		assert.deepEqual(first.bundle.authors, ["Alice Zhang", "Bo Li"]);
		assert.equal(first.report.status, "pending");
		assert.equal(first.report.locatorMode, "source-limited");
		assert.match((await tasks.readingReportOverview(first.report.id)).summary, /targeted prodrug polymer/i);

		const repeated = await tasks.registerWechatPaper({
			projectId: "proj-wechat",
			sourceUrl: "https://mp.weixin.qq.com/s?__biz=test&mid=123&idx=1&sn=abc",
			title: "A prodrug polymer platform for targeted delivery",
			doi: "10.1000/wechat.1",
			issue: "4"
		});
		assert.equal(repeated.created, false);
		assert.equal(repeated.bundle.id, first.bundle.id);
		assert.equal(repeated.report.id, first.report.id);
		assert.equal(repeated.bundle.issue, "4");
		assert.equal(tasks.listBundles("proj-wechat").length, 1);
		assert.equal(tasks.listReadingReports("proj-wechat").length, 1);

		const pdfPath = join(fxDir, "wechat-paper.pdf");
		await writeFile(pdfPath, Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n%%EOF"));
		const attached = await tasks.preparePaper({
			projectId: "proj-wechat",
			bundleId: first.bundle.id,
			sourceMapPath: join(fxDir, "min-source-map.json"),
			pdfPath
		});
		assert.equal(attached.id, first.bundle.id);
		assert.equal(attached.acquisitionStatus, "ready");
		assert.equal(attached.status, "succeeded");
		assert.equal(attached.sourceType, "wechat");
		assert.equal(attached.sourceUrl, first.bundle.sourceUrl);
		assert.equal(tasks.getReadingReport(first.report.id).locatorMode, "structure-grounded");
		assert.ok(tasks.listProvenance("proj-wechat").some((row) => row.kind === "metadata-intake" && row.source === "wechat-ai-extraction"));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("WeChat DOI verification resolves a candidate and registers the DOI into the reading queue", async () => {
	const { handle, dir } = await bootTasks();
	try {
		const tasks = handle.ctx.labTasks;
		stubNetwork(tasks.executor);
		await tasks.createProject({
			id: "proj-wechat-doi",
			name: "公众号 DOI 校验",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});

		// 页面未展示 DOI → 检索校验（stub 返回的 openalex/crossref 风格记录）
		const resolved = await tasks.resolveWechatPaperDoi({
			projectId: "proj-wechat-doi",
			title: "Prodrug-conjugated polymers for drug delivery",
			authors: ["A. Chemist"],
			year: 2024
		});
		assert.equal(resolved.candidates[0].doi, "10.1000/fake.1");
		assert.equal(resolved.candidates[0].confidence, "high");
		assert.equal(resolved.candidates[0].titleScore, 1);
		assert.ok(tasks.listProvenance("proj-wechat-doi").some((row) => row.kind === "search" && row.source === "wechat-doi-verify"));

		// 把校验得到的 DOI 提交到文献精读
		const registered = await tasks.registerWechatPaper({
			projectId: "proj-wechat-doi",
			sourceUrl: "https://mp.weixin.qq.com/s?__biz=doi&mid=1&idx=1&sn=xyz",
			title: "Prodrug-conjugated polymers for drug delivery",
			authors: ["A. Chemist"],
			doi: resolved.candidates[0].doi,
			year: 2024
		});
		assert.equal(registered.created, true);
		assert.equal(registered.bundle.doi, "10.1000/fake.1");
		assert.equal(registered.bundle.sourceType, "wechat");
		assert.equal(registered.bundle.acquisitionStatus, "awaiting-pdf");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
