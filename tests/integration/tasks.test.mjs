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
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir } },
			{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labTemplates", "labVersions"], config: { skillsRoot } }
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
