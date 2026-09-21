/**
 * dsh-lab-agent / labTasks — 文献汇报 PPT 全流程（创建、完成、校验、人工复核、产物与 run 列表）。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { inspectOfficePackage } from "../../src/office-package.js";
import { presentationRunSchema } from "../../src/task-models.js";

export const presentationsMethods = {

	/** 该 report 的全部 PPT run，按时间倒序（最新在前）。 */
	listPresentationsForReport(reportId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.reportId === reportId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},


	/** 文献汇报 PPT 文件：找到该 report 最新的含 pptx 的 run并验证 OOXML。 */
	async presentationFile(reportId, { requireApproved = false } = {}) {
		const run = this.listPresentationsForReport(reportId).find((r) => r.pptxPath && existsSync(r.pptxPath));
		if (run === undefined) throw new Error(`reading report '${reportId}' has no downloadable PPTX yet`);
		const buffer = await readFile(run.pptxPath);
		const integrity = await inspectOfficePackage(buffer, "pptx");
		if (requireApproved) this.assertApprovedArtifact(run, `presentation '${run.id}'`, integrity.sha256);
		return {
			fileName: `${run.id}.pptx`,
			mime: integrity.mime,
			buffer,
			byteLength: integrity.byteLength,
			sha256: integrity.sha256
		};
	},


	/** RPC 兼容接口；Web 面板改用二进制 HTTP 流。 */
	async presentationDownload(reportId) {
		const file = await this.presentationFile(reportId);
		return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
	},


	// ── §六 接口：PPT 生成 ───────────────────────────────────────────────────

	/** createPresentation：报告已有暂存产物即可制作；模板只作格式参考，不作阻断门禁。 */
	async createPresentation({ projectId, reportId, templateId, templateVersion, runId, model, skipAudit = false }) {
		this.requireProject(projectId);
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath || !report.docxPath) throw new Error(`reading report '${reportId}' has no staged report artifact yet`);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		try {
			const templateValidation = await this.ctx.labTemplates.validate(templateId, templateVersion);
			if (!templateValidation.ok) this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} has advisory issues: ${templateValidation.problems.join("; ")}`);
		} catch (error) {
			this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} advisory validation unavailable: ${error.message}`);
		}
		const id = runId ?? `pres-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const run = presentationRunSchema.parse({
			id,
			projectId,
			reportId,
			templateSnapshot: template,
			auditSkipped: skipAudit,
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("presentations").put(id, run);
		return run;
	},


	/** completePresentation：实际 PPTX 完整即可暂存；版面 QA 只作非阻断提醒。
	 *  PPTX 及配套 outline/notes/figures 固化到文献条目目录，与正文/SI 同目录。 */
	async completePresentation({ runId, pptxPath, outlinePath, speechNotesPath, figureSourcesPath, model }) {
		if (!pptxPath || !existsSync(pptxPath)) throw new Error(`pptx file missing: ${pptxPath ?? "(empty path)"}`);
		const integrity = await inspectOfficePackage(await readFile(pptxPath), "pptx");
		const current = this.table("presentations").get(runId);
		if (current === undefined) throw new Error(`presentation run '${runId}' not found`);
		const report = this.table("reports").get(current.reportId);
		if (report === undefined) throw new Error(`reading report '${current.reportId}' not found`);
		const stage = async (kind, path, fileName) => {
			if (!path || !existsSync(path)) return undefined;
			return (await this.stageFileIntoEntry({
				projectId: current.projectId,
				bundleId: report.bundleId,
				kind,
				buffer: await readFile(path),
				fileName,
				allowExisting: true
			})).filePath;
		};
		const pptxStaged = await stage("ppt", pptxPath);
		const outlineStaged = await stage("outline", outlinePath, outlinePath ? basename(outlinePath) : undefined);
		const notesStaged = await stage("speech-notes", speechNotesPath, speechNotesPath ? basename(speechNotesPath) : undefined);
		const figuresStaged = await stage("figure-sources", figureSourcesPath, figureSourcesPath ? basename(figureSourcesPath) : undefined);
		const run = await this.transit("presentations", runId, {
			status: "under-review",
			progress: "PPTX staged; lightweight self-check pending",
			pptxPath: pptxStaged,
			artifactSha256: integrity.sha256,
			outlinePath: outlineStaged,
			speechNotesPath: notesStaged,
			figureSourcesPath: figuresStaged,
			qa: { ok: false, high: 0, medium: 0, low: 0 },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptxPath: pptxStaged, outlinePath: outlineStaged },
			model
		});
		return await this.validatePresentation({ runId, model });
	},


	/** 机器 QA：只给人工审阅提供提醒，高风险项也不阻断预览和人工决定。 */
	async validatePresentation({ runId, failOn = "high", qaReportPath, qaJsonPath, model }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (!run.pptxPath) throw new Error(`presentation run '${runId}' has no pptx; complete it first`);
		await this.transit("presentations", runId, { status: "under-review", progress: "running lightweight PPT self-check; human review remains available" });
		const base = dirname(run.pptxPath);
		const report = qaReportPath ?? join(base, `${runId}-qa-report.md`);
		const json = qaJsonPath ?? join(base, `${runId}-qa.json`);
		let result;
		try {
			result = await this.executor.auditPptx({ pptx: run.pptxPath, report, json, failOn });
		} catch (error) {
			return await this.transit("presentations", runId, {
				status: "under-review",
				progress: "PPT self-check unavailable; awaiting human review",
				qa: { ok: false, high: 0, medium: 1, low: 0, reportPath: report, jsonPath: json },
				error: undefined
			});
		}
		const next = await this.transit("presentations", runId, {
			status: "under-review",
			progress: result.ok ? "PPT self-check completed; awaiting human review" : `PPT self-check found ${result.findingCounts.high} high-risk item(s); awaiting human review`,
			qa: { ok: result.ok, ...result.findingCounts, reportPath: report, jsonPath: json }
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptx: run.pptxPath, failOn },
			model,
			source: "audit_pptx_quality.py"
		});
		return next;
	},


	/** 人工审阅 PPT：以实际 PPTX 完整性和哈希绑定为硬条件，QA 提醒不设门槛。 */
	async reviewPresentation({ runId, decision, note, reviewer = "human-ui" }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (run.status !== "under-review") throw new Error(`presentation run '${runId}' is ${run.status}; only under-review can be reviewed`);
		if (!run.pptxPath || !existsSync(run.pptxPath)) throw new Error(`pptx file missing: ${run.pptxPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const integrity = await inspectOfficePackage(await readFile(run.pptxPath), "pptx");
		const reviewedAt = new Date().toISOString();
		return await this.transit("presentations", runId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: integrity.sha256 }
		}, reviewedAt);
	},


	listPresentationRuns(projectId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},


	getPresentationRun(id) {
		return this.table("presentations").get(id);
	}
};
