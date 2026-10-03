/**
 * dsh-lab-agent: 文献→PPT 任务编排服务（Cordis host service, ctx.labTasks）。
 *
 * 计划 §五 流程 + §六 任务接口。机械化步骤直接调用 nature-skills 的 stdlib
 * 脚本（SkillExecutor）；LLM 驱动的步骤（精读报告、PPT 内容）由 agent 在会话
 * 中执行对应 skill 后调用 complete* 登记产物，再走审计门禁。
 *
 * 产物流程：实际 DOCX/PPTX 生成后先进入课题文献条目暂存区；自动自查仅提示，
 * 不阻断人工审核。只有人工审核绑定到当前文件哈希后，原文件下载才开放。
 * 每个产物记录 ArtifactProvenance（输入哈希 / skill 版本 / 模型 / 时间）。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Service } from "@deepseek-ai/cordis";
import { inspectOfficePackage } from "../../src/office-package.js";
import {
	canTransit
} from "../../src/task-models.js";
import { projectsMethods } from "./projects.js";
import { literatureMethods } from "./literature.js";
import { wechatMethods } from "./wechat.js";
import { readingReportsMethods } from "./reading-reports.js";
import { presentationsMethods } from "./presentations.js";
import { provenanceMethods } from "./provenance.js";
import { stagingMethods } from "./staging.js";
import { entryAdminMethods } from "./entry-admin.js";
import { reviewMethods } from "./reviews.js";


export { labTasksDomainSpec } from "../core/domain.js";

export { KIND_TO_SKILL } from "./provenance.js";
export { extractWechatArticlePage } from "./wechat.js";
export { mergeSessionSearchRows } from "./literature.js";
export { normalizeJournalShortCitation } from "./shared.js";
export { normalizeWechatArticleUrl } from "./wechat.js";
export { publicSearchPaperId } from "./literature.js";
export { searchPaperAliases } from "./literature.js";
export { searchPaperMatches } from "./literature.js";

export class LabWorkflowService extends Service {

	static inject = ["ibmCore", "ibmRuntime", "ibmDocuments", "labGoals", "labTemplates", "labNoteTemplates"];
	/** 课题工作区里的核心记忆文件（agent 在对话中直接读取，不预填输入框）。 */
	static PROJECT_MEMORY_FILE = "项目记忆.md";
	tables = {};
	executor;


	/** @param config {{ skillsRoot?: string, venvDir?: string, projectsRoot?: string, researchPreset?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "ibmLiteratureWorkflows");
		this.config = config;
		// 每个课题一个独立工作区目录：$DSH_HOME/lab-agent/projects/<projectId>。
		this.projectsRoot = ctx.ibmCore.projectsRoot;
		// 课题创建后自动启用的科研 Agent 预设（preset id = preset 目录名）。
		this.researchPreset = config.researchPreset ?? "lab-research";
	}


	async [Service.init]() {
		this.tables = this.ctx.ibmCore.repositories.scope("literature");
		this.executor = this.ctx.ibmRuntime.createExecutor(this.config);
		await this.migrateLegacySessionBindings();
		await this.migrateLegacyReviewGates();
		await this.resumePendingMachineReviews();
	}


	/**
	 * 升级迁移：只要实际产物已登记，就进入人工审阅暂存区。机器审计/QA 仅作
	 * 提示，不再把旧产物卡在 running/failed，也不替代研究人员决策。
	 */
	async migrateLegacyReviewGates() {
		const now = new Date().toISOString();
		for (const [tableName, pathField] of [
			["reports", "paperCardPath"],
			["presentations", "pptxPath"]
		]) {
			const table = this.table(tableName);
			for (const key of table.keys()) {
				let row = table.get(key);
				if (!row[pathField]) continue;
				if (tableName === "reports" && (!row.docxPath || !existsSync(row.docxPath))) {
					try {
						const staged = await this.materializeReadingDocx(row);
						row = { ...row, docxPath: staged.docxPath, artifactSha256: staged.integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy reading report '${key}' DOCX staging failed: ${error.message}`);
						continue;
					}
				}
				if (tableName === "reports" && row.docxPath && !row.artifactSha256) {
					try {
						const integrity = await inspectOfficePackage(await readFile(row.docxPath), "docx");
						row = { ...row, artifactSha256: integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy reading report '${key}' DOCX integrity migration failed: ${error.message}`);
						continue;
					}
				}
				if (tableName === "presentations" && (!row.artifactSha256 || !row.review?.artifactSha256)) {
					try {
						const integrity = await inspectOfficePackage(await readFile(row.pptxPath), "pptx");
						row = { ...row, artifactSha256: integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy presentation '${key}' PPTX staging failed: ${error.message}`);
						continue;
					}
				}
				const approvedHashMatches = row.review?.status === "approved" && row.review?.artifactSha256 === row.artifactSha256;
				if (approvedHashMatches || row.review?.status === "rejected") continue;
				if (row.status !== "under-review" || row.review?.status !== "pending") await table.put(key, { ...row, status: "under-review", progress: "artifact staged; awaiting human review", review: { status: "pending", reviewer: "human-ui" }, updatedAt: now });
			}
		}
	}


	/** 启动时补跑被旧状态机跳过的机器评审；失败留在 failed，不开放人工按钮。 */
	async resumePendingMachineReviews() {
		for (const key of this.table("reports").keys()) {
			const row = this.table("reports").get(key);
			if (row.status !== "running" || !row.paperCardPath || row.audit?.ok) continue;
			try { await this.validateReadingReport({ reportId: key }); }
			catch (error) { this.ctx.logger.warn(`legacy reading report '${key}' machine review failed: ${error.message}`); }
		}
		for (const key of this.table("presentations").keys()) {
			const row = this.table("presentations").get(key);
			if (row.status !== "running" || !row.pptxPath || row.qa?.ok) continue;
			try { await this.validatePresentation({ runId: key }); }
			catch (error) { this.ctx.logger.warn(`legacy presentation '${key}' machine QA failed: ${error.message}`); }
		}
	}


	/**
	 * 升级迁移：旧版 project_sessions 行是 `{ projectId, sessionId, workspaceId }`
	 * （单会话绑定）；新版为工作区级 `{ projectId, workspaceId, sessionIds[] }`。
	 * 启动时把旧 `sessionId` 收进 `sessionIds`，保证既有会话继续可反查。
	 */
	async migrateLegacySessionBindings() {
		return this.ctx.ibmCore.migrateLegacySessionBindings();
	}


	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labTasks is not started yet");
		return t;
	}


	requireProject(id) {
		return this.ctx.ibmCore.requireProject(id);
	}


	/** 更新一行并校验状态迁移。 */
	async transit(tableName, id, patch, now = new Date().toISOString()) {
		const table = this.table(tableName);
		const row = table.get(id);
		if (row === undefined) throw new Error(`${tableName} '${id}' not found`);
		if (patch.status && patch.status !== row.status) {
			if (!canTransit(row.status, patch.status)) {
				throw new Error(`invalid transition ${row.status} -> ${patch.status} for ${tableName} '${id}'`);
			}
		}
		const next = { ...row, ...patch, updatedAt: now };
		await table.put(id, next);
		return next;
	}


	/** 下载门禁：人工审核必须绑定到当前实际 Office 文件的 SHA-256。 */
	assertApprovedArtifact(row, label, sha256) {
		return this.ctx.ibmCore.assertApprovedArtifact(row, label, sha256);
	}


	/** 返回机器评审的结构化详情，供课题面板解释错误/提醒，避免只显示红绿状态。 */
	async machineReviewDetails({ reportId, runId }) {
		if ((reportId ? 1 : 0) + (runId ? 1 : 0) !== 1) throw new Error("provide exactly one of reportId or runId");
		if (reportId) {
			const report = this.getReadingReport(reportId);
			if (!report) throw new Error(`reading report '${reportId}' not found`);
			let detail;
			if (report.auditReportPath && existsSync(report.auditReportPath)) {
				try { detail = JSON.parse(await readFile(report.auditReportPath, "utf8")); } catch { detail = undefined; }
			}
			return { kind: "reading-report", id: reportId, ok: report.audit?.ok === true, status: report.status, summary: report.audit, reportPath: report.auditReportPath, findings: detail?.findings ?? [], metrics: detail?.metrics, auditMode: detail?.audit_mode ?? "paper-card" };
		}
		const run = this.getPresentationRun(runId);
		if (!run) throw new Error(`presentation run '${runId}' not found`);
		let detail;
		if (run.qa?.jsonPath && existsSync(run.qa.jsonPath)) {
			try { detail = JSON.parse(await readFile(run.qa.jsonPath, "utf8")); } catch { detail = undefined; }
		}
		return { kind: "presentation", id: runId, ok: run.qa?.ok === true, status: run.status, summary: run.qa, reportPath: run.qa?.reportPath, findings: detail?.findings ?? [], slideCount: detail?.slide_count };
	}

}

Object.assign(LabWorkflowService.prototype, projectsMethods, literatureMethods, wechatMethods, readingReportsMethods, presentationsMethods, provenanceMethods, stagingMethods, entryAdminMethods, reviewMethods);

export default LabWorkflowService;
