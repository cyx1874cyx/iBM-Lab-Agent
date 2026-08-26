/**
 * Integration: ctx.lab（lab-remote bridge）经 Typert Gateway 可调用。
 *
 * 验证 host 侧 source-mode discovery：@Remote 标记（手写装饰器）的方法
 * 能被 ctx.typertGateway.invoke 解析并调用，参数按单个 request 对象传输，
 * 返回值经 { ok, value } 包装。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";

const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));
const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

async function bootRemote() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-remote-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: vendorRoot,
		lockFile: fileURLToPath(new URL("../../vendor.lock.json", import.meta.url)),
		includePython: false,
		extraRows: [
			{ id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
			{ id: "api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"] },
			{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labNoteTemplates", "labTemplates", "labVersions"], config: { skillsRoot: vendorRoot + "/skills", projectsRoot: join(dir, "projects") } },
			{ id: "lab-literature-sources", name: "dsh-lab-agent/literature-sources", inject: ["storageDomain"], config: { sessionsDir: join(dir, "literature-sessions"), downloadsDir: join(dir, "literature-downloads") } },
			{ id: "lab-chemistry", name: "dsh-lab-agent/chemistry", inject: ["storageDomain"] },
			{ id: "lab-nmr", name: "dsh-lab-agent/nmr", inject: ["storageDomain"] },
			{ id: "lab-synthesis", name: "dsh-lab-agent/synthesis", inject: ["storageDomain"] },
			{ id: "lab-convert", name: "dsh-lab-agent/convert", inject: ["storageDomain"] },
			{ id: "lab-python-env", name: "dsh-lab-agent/python-env", inject: [] },
			{ id: "lab-remote", name: "dsh-lab-agent/remote", inject: ["labVersions", "labGoals", "labNoteTemplates", "labTasks", "labTemplates", "labChemistry", "labNmr", "labSynthesis", "labPython", "labConvert"] }
		]
	});
	await handle.ctx.labVersions.bootstrapFromVendor();
	// 输入副本：preparePaper/audit 输出写到输入所在目录，避免污染仓库 fixtures
	const fxDir = join(dir, "fx");
	await mkdir(fxDir, { recursive: true });
	for (const f of ["min-source-map.json", "paper-card-pass.md"]) {
		await copyFile(join(fixtures, f), join(fxDir, f));
	}
	return { handle, dir, fxDir };
}

async function invoke(ctx, method, args = {}) {
	return await ctx.typertGateway.invoke({ namespace: "lab", method, args });
}

test("lab remote: gateway dispatches marked methods with request-argument contract", async () => {
	const { handle, dir, fxDir } = await bootRemote();
	try {
		const ctx = handle.ctx;
		// stub 网络检索：OpenAlex 依赖外网，不在自动化测试中跑
		const tasks = ctx.labTasks;
		tasks.executor.search = async () => [
			{ title: "Prodrug-conjugated polymers for drug delivery", doi: "10.1000/fake.1", authors: ["A. Chemist"], year: 2024, cited_by_count: 12 }
		];

		// goals_list（无参）
		const listed = await invoke(ctx, "goals_list");
		assert.ok(Array.isArray(listed.goals));
		assert.ok(listed.goals.some((g) => g.id === "default-prodrug-polymer"));

		// goals_resolve（request 对象）
		const resolved = await invoke(ctx, "goals_resolve", { request: { id: "default-prodrug-polymer", version: "1" } });
		assert.equal(resolved.goal.id, "default-prodrug-polymer");

		// goals_create + goals_delete（写路径）
		const created = await invoke(ctx, "goals_create", { request: { id: "remote-test-goal", fields: { name: "remote goal", researchQuestions: ["Q"] } } });
		assert.equal(created.goal.version, "1");
		const deleted = await invoke(ctx, "goals_delete", { request: { id: "remote-test-goal" } });
		assert.equal(deleted.ok, true);

		// versions_list
		const versions = await invoke(ctx, "versions_list");
		assert.ok(versions.rows.length >= 1);

		// 项目核心记忆 + 项目空间聚合
		const project = await invoke(ctx, "projects_create", { request: { fields: {
			id: "remote-project",
			name: "远程课题",
			coreMarkdown: "# 远程课题\n\n## 核心假设\nA",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		} } });
		assert.equal(project.project.memoryVersion, "1");
		// 课题专属工作区路径 + 科研 Agent 预设 id（launch 流程数据源）
		assert.equal(project.presetId, "lab-research");
		assert.ok(project.project.workspacePath, "workspace path returned");
		assert.match(project.project.workspacePath, /remote-project$/);
		// 存储域返回值可能带有非 plain-object 原型；列表端点必须先清洗后过 JSON 边界。
		const projects = await invoke(ctx, "projects_list");
		assert.equal(projects.projects.length, 1);
		assert.equal(projects.projects[0].id, "remote-project");

		// 工作区级绑定：bind_workspace → bind_session（多会话）→ 反查三件套
		const wsBound = await invoke(ctx, "projects_bind_workspace", { request: { projectId: "remote-project", workspaceId: "ws-r" } });
		assert.equal(wsBound.binding.workspaceId, "ws-r");
		await invoke(ctx, "projects_bind_session", { request: { projectId: "remote-project", sessionId: "session-r", workspaceId: "ws-r" } });
		await invoke(ctx, "projects_bind_session", { request: { projectId: "remote-project", sessionId: "session-r2", workspaceId: "ws-r" } });
		const binding = await invoke(ctx, "projects_binding", { request: { projectId: "remote-project" } });
		assert.equal(binding.binding.workspaceId, "ws-r");
		assert.deepEqual(binding.binding.sessionIds, ["session-r", "session-r2"]);
		const bySession = await invoke(ctx, "projects_by_session", { request: { sessionId: "session-r2" } });
		assert.equal(bySession.bound.project.id, "remote-project");
		assert.equal(bySession.bound.workspaceId, "ws-r");
		const missing = await invoke(ctx, "projects_by_session", { request: { sessionId: "session-none" } });
		assert.equal(missing.bound, null);
		// 工作区 → 课题（空间内所有对话共享课题标识）
		const byWs = await invoke(ctx, "projects_by_workspace", { request: { workspaceId: "ws-r" } });
		assert.equal(byWs.bound.project.id, "remote-project");
		assert.deepEqual(byWs.bound.sessionIds, ["session-r", "session-r2"]);
		// cwd → 课题（不依赖绑定：手动新建对话也能识别课题）
		const byCwd = await invoke(ctx, "projects_by_cwd", { request: { path: project.project.workspacePath } });
		assert.equal(byCwd.bound.project.id, "remote-project");
		assert.equal(byCwd.bound.workspaceId, "ws-r");

		const memory = await invoke(ctx, "projects_memory_update", { request: { fields: {
			projectId: "remote-project",
			markdown: "# 远程课题\n\n## 核心假设\nB",
			changeNote: "修订假设"
		} } });
		assert.equal(memory.memory.version, "2");
		const workspace = await invoke(ctx, "projects_workspace", { request: { projectId: "remote-project" } });
		assert.equal(workspace.memory.version, "2");
		assert.equal(workspace.presetId, "lab-research", "workspace returns research preset for launch");
		assert.deepEqual(Object.keys(workspace.literature).sort(), ["bundles", "presentations", "reports", "searches"]);
		assert.deepEqual(Object.keys(workspace.planning).sort(), ["plans", "routes", "targets"]);
		assert.deepEqual(Object.keys(workspace.characterization), ["nmr"]);

		// ensure_workspace：已有路径幂等返回；旧项目（无 workspacePath）补建默认目录
		const ensured = await invoke(ctx, "projects_ensure_workspace", { request: { projectId: "remote-project" } });
		assert.ok(ensured.path.endsWith("remote-project"));
		await invoke(ctx, "projects_ensure_workspace", { request: { projectId: "remote-project" } });
		const workspace2 = await invoke(ctx, "projects_workspace", { request: { projectId: "remote-project" } });
		assert.ok(workspace2.project.workspacePath, "project keeps workspacePath after ensure");

		// 核心记忆落盘：课题工作区里应有「项目记忆.md」，内容 = 当前版本记忆
		const memoryFile = join(workspace2.project.workspacePath, "项目记忆.md");
		const fileContent = await readFile(memoryFile, "utf8");
		assert.match(fileContent, /课题核心记忆/);
		assert.match(fileContent, /修订假设/, "file carries latest memory markdown");
		assert.match(fileContent, /v2/, "file header carries current version");

		// 文献写入端点：检索 → 原文 → 精读 → PPT（Agent 登记链路）
		const search = await invoke(ctx, "tasks_search_create", { request: { fields: { projectId: "remote-project", query: "prodrug polymer", limit: 2 } } });
		assert.equal(search.run.projectId, "remote-project");
		assert.ok(["succeeded", "running", "failed"].includes(search.run.status));
		// 检索后 provenance 已登记
		const prov = await invoke(ctx, "tasks_provenance", { request: { projectId: "remote-project" } });
		assert.ok(prov.provenance.some((p) => p.kind === "search"), "search provenance recorded");

		// 原文整理（preparePaper 走真实脚本，需要输入文件；用 fixture source-map 直接登记 bundle 行）
		const bundle = await invoke(ctx, "tasks_bundle_create", { request: { fields: { projectId: "remote-project", sourceMapPath: join(fxDir, "min-source-map.json"), doi: "10.1000/fake.1", title: "测试原文" } } });
		assert.equal(bundle.bundle.projectId, "remote-project");
		const wsSourceMapOnly = await invoke(ctx, "projects_workspace", { request: { projectId: "remote-project" } });
		assert.equal(wsSourceMapOnly.literature.searches[0].results[0].localPdfUrl, undefined, "source-map-only bundle keeps the PDF button unavailable");

		const pdfPath = join(fxDir, "remote-paper.pdf");
		const siPath = join(fxDir, "remote-supporting.txt");
		await writeFile(pdfPath, Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n%%EOF"));
		await writeFile(siPath, "supporting information");
		const fileBundle = await invoke(ctx, "tasks_bundle_create", { request: { fields: { projectId: "remote-project", sourceMapPath: join(fxDir, "min-source-map.json"), pdfPath, siPath, doi: "10.1000/fake.1", title: "测试原文与附件" } } });
		const wsWithFiles = await invoke(ctx, "projects_workspace", { request: { projectId: "remote-project" } });
		assert.equal(wsWithFiles.literature.searches[0].results[0].localPdfUrl, `/api/lab-artifacts?kind=pdf&bundleId=${fileBundle.bundle.id}`);
		assert.equal(wsWithFiles.literature.searches[0].results[0].localSiUrl, `/api/lab-artifacts?kind=si&bundleId=${fileBundle.bundle.id}`);

		// 精读报告：创建（草稿）→ 完成（登记 paper-card 路径）
		const report = await invoke(ctx, "tasks_report_create", { request: { fields: { projectId: "remote-project", bundleId: bundle.bundle.id, goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1" } } });
		assert.equal(report.report.status, "pending");
		const completed = await invoke(ctx, "tasks_report_complete", { request: { fields: { reportId: report.report.id, paperCardPath: join(fxDir, "paper-card-pass.md") } } });
		assert.equal(completed.report.status, "under-review");
		assert.equal(completed.report.audit.ok, true, "remote complete 自动执行机器评审");
		const reviewDetails = await invoke(ctx, "tasks_review_details", { request: { reportId: report.report.id } });
		assert.equal(reviewDetails.review.ok, true);
		assert.ok(reviewDetails.review.findings.length > 0);
		const reviewed = await invoke(ctx, "tasks_report_review", { request: { fields: { reportId: report.report.id, decision: "approved", note: "人工核对通过" } } });
		assert.equal(reviewed.report.status, "succeeded");
		assert.equal(reviewed.report.review.status, "approved");

		// 面板聚合应能看到检索与 bundle 记录
		const wsAfter = await invoke(ctx, "projects_workspace", { request: { projectId: "remote-project" } });
		assert.ok(wsAfter.literature.searches.length >= 1, "literature searches visible in panel");
		assert.ok(wsAfter.literature.bundles.length >= 1, "literature bundles visible in panel");
		assert.ok(wsAfter.literature.reports.length >= 1, "literature reports visible in panel");

		// 报告下载：默认 .md（文本）；format=docx 返回同源 Word（base64）
		const mdFile = await invoke(ctx, "tasks_report_download", { request: { reportId: report.report.id, format: "md" } });
		assert.equal(mdFile.file.format, "md");
		assert.equal(mdFile.file.mime, "text/markdown;charset=utf-8");
		assert.ok(mdFile.file.text.length > 0, "md download returns text");
		const docxFile = await invoke(ctx, "tasks_report_download", { request: { reportId: report.report.id, format: "docx" } });
		assert.equal(docxFile.file.format, "docx");
		assert.match(docxFile.file.fileName, /\.docx$/);
		assert.match(docxFile.file.mime, /wordprocessingml/);
		const docxBytes = Buffer.from(docxFile.file.base64, "base64");
		assert.deepEqual(docxBytes.subarray(0, 2).toString("latin1"), "PK", "docx 是 zip");
		assert.ok(docxBytes.length > 1000, "docx 有内容");

		// 彻底删除：物理移除课题目录，并级联清理任务域数据。
		const deletedProject = await invoke(ctx, "projects_delete", { request: { projectId: "remote-project" } });
		assert.equal(deletedProject.projectId, "remote-project");
		assert.equal(deletedProject.deleted.projects, 1);
		assert.equal(existsSync(project.project.workspacePath), false);
		assert.equal((await invoke(ctx, "projects_list")).projects.length, 0);
		assert.equal((await invoke(ctx, "projects_get", { request: { id: "remote-project" } })).project, null);
		for (const tableName of ["projects", "memories", "sessions", "searches", "bundles", "reports", "presentations", "provenance"]) {
			assert.equal(ctx.labTasks.table(tableName).size, 0, `${tableName} cascaded`);
		}

		// 未注册方法 → 报错（无静默）
		await assert.rejects(() => invoke(ctx, "not_a_method"), /no active Remote method/);

		// 参数不匹配 → 报错
		await assert.rejects(() => invoke(ctx, "goals_resolve", { req: {} }), /args fields do not match/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("project deletion refuses a workspace outside the managed projects root", async () => {
	const { handle, dir } = await bootRemote();
	try {
		const ctx = handle.ctx;
		await invoke(ctx, "projects_create", { request: { fields: {
			id: "unsafe-project",
			name: "越界目录测试",
			coreMarkdown: "# 越界目录测试",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		} } });
		const outside = join(dir, "must-survive");
		await mkdir(outside, { recursive: true });
		const row = ctx.labTasks.getProject("unsafe-project");
		await ctx.labTasks.table("projects").put("unsafe-project", { ...row, workspacePath: outside });

		await assert.rejects(
			() => invoke(ctx, "projects_delete", { request: { projectId: "unsafe-project" } }),
			/refusing to delete project workspace outside/
		);
		assert.equal(existsSync(outside), true);
		assert.ok(ctx.labTasks.getProject("unsafe-project"));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
