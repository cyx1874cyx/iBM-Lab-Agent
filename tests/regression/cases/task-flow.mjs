/**
 * Regression case: literature→PPT task flow (§五) with real audit gates.
 *
 * 覆盖 §八 领域验证的一部分 + §五 流程：项目创建（目标/模板快照）→ 论文准备
 * （真实 prepare_paper.py）→ 精读报告（fixture）→ 真实 audit_paper_card.py
 * 门禁 → PPT 生成 → 真实 audit_pptx_quality.py 门禁 → ArtifactProvenance。
 * 检索的网络路径以 stub 代替（OpenAlex 依赖外网）。
 */

import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { buildPptx } from "../../../tests/fixtures/pptx-builder.mjs";
import { PAPER_CARD_SECTION_CONTRACT } from "../../../src/goal-profile.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillsRoot = join(repoRoot, "vendor", "nature-skills", "skills");
const fixtures = join(repoRoot, "tests", "fixtures");

export default {
	name: "task-flow",
	description: "search→prepare→report→audit gate→presentation→qa gate + provenance",
	tags: ["tasks"],
	required: [],
	async run() {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-task-"));
		const templatesDir = join(dir, "templates");
		await mkdir(templatesDir, { recursive: true });
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(repoRoot, "vendor", "nature-skills"),
			lockFile: join(repoRoot, "vendor.lock.json"),
			includePython: false,
			extraRows: [
				{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
				{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir } },
				{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labTemplates", "labVersions"], config: { skillsRoot } }
			]
		});
		try {
			const tasks = handle.ctx.labTasks;
			await handle.ctx.labVersions.bootstrapFromVendor();
			const fxDir = join(dir, "fx");
			await mkdir(fxDir, { recursive: true });
			for (const f of ["min-source-map.json", "paper-card-pass.md"]) {
				await copyFile(join(fixtures, f), join(fxDir, f));
			}
			tasks.executor.search = async () => [{ title: "fixture paper", doi: "10.1/fake" }];
			const problems = [];

			const project = await tasks.createProject({
				id: "reg-proj",
				name: "回归",
				goalProfileId: "default-prodrug-polymer",
				goalProfileVersion: "1",
				templateId: "nature-default",
				templateVersion: "1"
			});
			if (project.goalProfile.version !== "1") problems.push("project goal snapshot wrong");

			const search = await tasks.searchLiterature({ projectId: "reg-proj", query: "prodrug polymer" });
			if (search.status !== "succeeded") problems.push("search failed");

			const bundle = await tasks.preparePaper({ projectId: "reg-proj", sourceMapPath: join(fxDir, "min-source-map.json") });
			if (bundle.status !== "succeeded") problems.push("bundle failed");

			const report = await tasks.createReadingReport({
				projectId: "reg-proj",
				bundleId: bundle.id,
				goalProfileId: "default-prodrug-polymer",
				goalProfileVersion: "1"
			});
			if (report.paperCardRequirements.paperCardContract.sections !== PAPER_CARD_SECTION_CONTRACT) problems.push("01-16 contract lost");

			await tasks.completeReadingReport({ reportId: report.id, paperCardPath: join(fxDir, "paper-card-pass.md") });
			const audited = await tasks.validateReadingReport({ reportId: report.id });
			if (!audited.audit.ok) problems.push(`audit failed: ${audited.audit.summary}`);

			const pres = await tasks.createPresentation({ projectId: "reg-proj", reportId: report.id, templateId: "nature-default", templateVersion: "1" });
			const { buffer } = await buildPptx({ name: "reg", slides: 2 });
			const pptxPath = join(dir, "reg.pptx");
			await writeFile(pptxPath, buffer);
			await tasks.completePresentation({ runId: pres.id, pptxPath });
			const qa = await tasks.validatePresentation({ runId: pres.id });
			if (!qa.qa.ok || qa.qa.high > 0) problems.push(`qa failed: high=${qa.qa.high}`);

			const provenance = tasks.listProvenance("reg-proj");
			const kinds = new Set(provenance.map((p) => p.kind));
			if (provenance.length !== 4) problems.push(`provenance rows ${provenance.length}, expected 4 (one per run kind)`);
			for (const expected of ["search", "source-bundle", "reading-report", "presentation"]) {
				if (!kinds.has(expected)) problems.push(`provenance kind '${expected}' missing`);
			}
			if (!provenance.every((p) => p.inputsSha256.length === 64)) problems.push("provenance hash missing");

			return { pass: problems.length === 0, details: problems.length === 0 ? "full flow ok with real audit gates" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
