/**
 * dsh-lab-agent / labTasks — 精读报告全流程（创建、输入、模板、完成、校验、人工复核、产物与列表）。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { toPaperCardRequirements } from "../../src/goal-profile.js";
import { renderNoteContract } from "../../src/note-template.js";
import { inspectOfficePackage } from "../../src/office-package.js";
import { auditReadingNote } from "../../src/reading-note-audit.js";
import { markdownToDocx } from "../md2docx.js";
import { entryFileName, literatureEntryLayout } from "../entry-layout.js";
import { readingReportSchema } from "../../src/task-models.js";
import { atomicWrite, isPathInside, normalizeJournalShortCitation } from "./shared.js";

export const readingReportsMethods = {

	/** 200字概览卡片：优先登记时的 summary，缺省从 paper-card 推导。 */
	async readingReportOverview(reportId) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		const bundle = this.table("bundles").get(report.bundleId);
		const shortCitation = normalizeJournalShortCitation(report.shortCitation, bundle?.title) || report.shortCitation || bundle?.title || report.id;
		const titleZh = report.titleZh || bundle?.title || shortCitation;
		let summary = report.summary;
		if (!summary && report.paperCardPath && existsSync(report.paperCardPath)) {
			summary = await this.deriveCardSummary(report.paperCardPath);
		}
		if (!summary && bundle?.abstract) summary = bundle.abstract;
		if (!summary && bundle?.acquisitionStatus === "awaiting-pdf") summary = "已从微信公众号文章提取文献元数据；等待研究人员手工下载并上传 PDF 后开始全文精读。";
		if (!summary) summary = "暂无概览：完成 paper card 精读登记后自动生成。";
		return { reportId, shortCitation, titleZh, summary };
	},


	/** 从 paper-card markdown 推导一段约 200 字的概览（body 首段，过滤元信息/标题/表格）。 */
	async deriveCardSummary(paperCardPath, budget = 200) {
		const markdown = await readFile(paperCardPath, "utf8");
		const kept = [];
		for (const raw of markdown.split(/\r?\n/)) {
			const line = raw.trim();
			if (line === "") continue;
			if (line.startsWith(">")) continue; // 元信息块
			if (/^#{1,6}\s/.test(line)) continue; // 标题
			if (/^\|.*\|$/.test(line)) continue; // 表格行
			kept.push(line);
		}
		let text = kept.join(" ").replace(/\s+/g, " ").trim();
		if (text.length > budget) text = text.slice(0, budget).replace(/\s+\S*$/, "") + "…";
		return text;
	},


	/** 生成或接收一次性的实际 DOCX 暂存文件；预览和最终下载始终读取同一文件。
	 *  DOCX 固化到文献条目目录（<entryStem> 精读报告.docx），与正文/SI 同目录。 */
	async materializeReadingDocx(report, providedPath) {
		if (!report.paperCardPath || !existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath ?? "(empty path)"}`);
		const bundle = this.table("bundles").get(report.bundleId);
		const workspace = await this.ensureProjectWorkspace(report.projectId);
		const layout = literatureEntryLayout(workspace.path, bundle, report);
		let buffer;
		if (providedPath) {
			if (!existsSync(providedPath)) throw new Error(`docx file missing: ${providedPath}`);
			buffer = await readFile(providedPath);
		} else {
			const content = await readFile(report.paperCardPath, "utf8");
			buffer = await markdownToDocx(content, { title: report.titleZh || report.shortCitation || report.id });
		}
		const docxPath = await atomicWrite(join(layout.entryDir, entryFileName(layout.entryStem, "report-docx")), buffer);
		const integrity = await inspectOfficePackage(buffer, "docx");
		return { docxPath, buffer, integrity };
	},


	/** 构造精读报告文件；生成完成后即可打开/下载，不设人工审核门禁。 */
	async readingReportFile(reportId, format = "md", { requireApproved = false } = {}) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card yet`);
		if (!existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath}`);
		if (!report.docxPath || !existsSync(report.docxPath)) throw new Error(`reading report '${reportId}' has no staged DOCX yet`);
		const docxBuffer = await readFile(report.docxPath);
		const docxIntegrity = await inspectOfficePackage(docxBuffer, "docx");
		if (requireApproved) this.assertApprovedArtifact(report, `reading report '${reportId}'`, docxIntegrity.sha256);
		const bundle = this.table("bundles").get(report.bundleId);
		const base = bundle?.entryStem
			? entryFileName(bundle.entryStem, format === "docx" ? "report-docx" : "report-md").replace(/\.(docx|md)$/i, "")
			: reportId;
		if (format === "docx") {
			return {
				fileName: `${base}.docx`,
				mime: docxIntegrity.mime,
				buffer: docxBuffer,
				format: "docx",
				byteLength: docxIntegrity.byteLength,
				sha256: docxIntegrity.sha256
			};
		}
		const content = await readFile(report.paperCardPath, "utf8");
		const buffer = Buffer.from(content, "utf8");
		return {
			fileName: `${base}.md`,
			mime: "text/markdown;charset=utf-8",
			buffer,
			text: content,
			format: "md",
			byteLength: buffer.length,
			sha256: createHash("sha256").update(buffer).digest("hex")
		};
	},


	/** RPC 兼容接口；Web 面板使用 /api/lab-artifacts 二进制流，不再走这里的 base64。 */
	async readingReportDownload(reportId, format = "md") {
		const file = await this.readingReportFile(reportId, format);
		if (file.format === "docx") {
			return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
		}
		return { ...file, buffer: undefined };
	},


	// ── §六 接口：精读报告 ───────────────────────────────────────────────────

	/** createReadingReport：目标快照 + 阅读笔记模板（Nature card 仅作无模板回退）。 */
	async createReadingReport({ projectId, bundleId, goalProfileId, goalProfileVersion, noteTemplateId, noteTemplateVersion, reportId, model, shortCitation, titleZh, summary }) {
		this.requireProject(projectId);
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		// 可开始精读：preparePaper 成功（succeeded）、元数据占位待 PDF（awaiting-pdf）、
		// 或手工捕获已把 PDF 登记进 bundle（ready + pdfPath）——捕获只登记原文，
		// 不自动生成报告，但允许用户随后开始精读。
		const captureReady = bundle.acquisitionStatus === "ready" && bundle.pdfPath;
		if (bundle.status !== "succeeded" && bundle.acquisitionStatus !== "awaiting-pdf" && !captureReady) {
			throw new Error(`source bundle '${bundleId}' is ${bundle.status}, expected succeeded`);
		}
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const requirements = toPaperCardRequirements(goal);
		// 阅读笔记模板快照：可选；缺省用内置 note-default（仅当 labNoteTemplates
		// 已注册时快照；未注册的服务不阻塞既有流程）。
		let noteTemplateSnapshot;
		let noteRequirements;
		try {
			const noteService = this.ctx.labNoteTemplates;
			const noteId = noteTemplateId ?? "note-default";
			const note = await noteService.snapshotForTask(noteId, noteTemplateVersion);
			noteTemplateSnapshot = note;
			noteRequirements = note;
			noteRequirements = noteService.toNoteRequirements(note);
		} catch (error) {
			this.ctx.logger.warn(`createReadingReport: note template snapshot skipped: ${String(error)}`);
		}
		const id = reportId ?? `report-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const report = readingReportSchema.parse({
			id,
			projectId,
			bundleId,
			goalSnapshot: goal,
			paperCardRequirements: requirements,
			noteTemplateSnapshot,
			noteRequirements,
			locatorMode: bundle.locatorMode,
			status: "pending",
			shortCitation: normalizeJournalShortCitation(shortCitation, bundle.title) ?? shortCitation ?? bundle.title ?? undefined,
			titleZh,
			summary,
			createdAt: now,
			updatedAt: now
		});
		await this.table("reports").put(id, report);
		return report;
	},


	/**
	 * 精读前输入盘点：列出当前正文/SI/source-map，并解析本次应优先采用的
	 * 阅读笔记模板。此方法只读取资源，不解析文献内容；Agent 必须随后逐个读取
	 * available=true 的资源，PDF/Office 先走 lab_convert_document。
	 */
	async readingReportInputs({ projectId, bundleId, reportId, noteTemplateId, noteTemplateVersion }) {
		this.requireProject(projectId);
		let report = reportId ? this.getReadingReport(reportId) : undefined;
		if (report && report.projectId !== projectId) throw new Error(`reading report '${reportId}' belongs to another project`);
		if (report && bundleId && report.bundleId !== bundleId) throw new Error("reportId and bundleId do not refer to the same paper");
		const resolvedBundleId = bundleId ?? report?.bundleId;
		if (!resolvedBundleId) throw new Error("bundleId or reportId is required");
		const bundle = this.getBundle(resolvedBundleId);
		if (!bundle) throw new Error(`source bundle '${resolvedBundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${resolvedBundleId}' belongs to another project`);
		if (!report) report = this.listReadingReports(projectId).find((row) => row.bundleId === resolvedBundleId && !row.paperCardPath);

		let noteTemplateSnapshot = report?.noteTemplateSnapshot;
		let noteRequirements = report?.noteRequirements;
		if (noteTemplateId || noteTemplateVersion || (!noteTemplateSnapshot && this.ctx.labNoteTemplates)) {
			const noteId = noteTemplateId ?? noteTemplateSnapshot?.id ?? "note-default";
			noteTemplateSnapshot = await this.ctx.labNoteTemplates.snapshotForTask(noteId, noteTemplateVersion);
			noteRequirements = this.ctx.labNoteTemplates.toNoteRequirements(noteTemplateSnapshot);
		}
		const fallbackRequirements = report?.paperCardRequirements
			?? toPaperCardRequirements(report?.goalSnapshot ?? this.getProject(projectId)?.goalProfile?.snapshot);
		const resource = (kind, path, sha256) => ({
			kind,
			registered: Boolean(path),
			available: Boolean(path && existsSync(path)),
			path,
			fileName: path ? basename(path) : undefined,
			sha256
		});
		const resources = [
			resource("main-pdf", bundle.pdfPath, bundle.pdfSha256),
			resource("si", bundle.siPath, bundle.siSha256),
			resource("source-map", bundle.sourceMapPath)
		];
		const formatSource = noteRequirements ? "reading-note-template" : "nature-paper-card-fallback";
		return {
			bundleId: bundle.id,
			reportId: report?.id,
			title: bundle.title,
			resources,
			mustReadPaths: resources.filter((row) => row.available).map((row) => row.path),
			formatSource,
			templateId: noteTemplateSnapshot?.id,
			templateVersion: noteTemplateSnapshot?.version,
			templateName: noteTemplateSnapshot?.name,
			generationRequirements: noteRequirements ?? fallbackRequirements,
			instructions: [
				"生成精读报告前，逐个读取 mustReadPaths 中现有的正文、SI 和 source-map；不得只看元数据或公众号导读。",
				"PDF/Office 资源先用 lab_convert_document 转为 Markdown，再读取转换结果；正文和 SI 的证据要区分标注。",
				noteRequirements
					? "报告章节与格式严格采用 reading-note-template；Nature paper-card 只用于证据提取参考，不得覆盖模板结构。"
					: "当前没有可用阅读笔记模板，才允许回退到 Nature paper-card 结构。"
			]
		};
	},


	/**
	 * 把本次精读的生成契约落盘到文献条目目录，返回文件路径。
	 *
	 * Agent 用 read 分块读取契约，而不是把整篇模板塞进一次工具结果：preset 的
	 * tool-result-pruner（thresholdChars=8192）会把超长结果中段裁掉，导致同一
	 * 模板两次生成看到的要求不同。模板缺失（回退 Nature paper-card）时不落盘。
	 */
	async materializeReadingContract(inputs) {
		if (inputs.formatSource !== "reading-note-template") return undefined;
		const bundle = this.table("bundles").get(inputs.bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${inputs.bundleId}' not found`);
		const markdown = renderNoteContract({
			template: {
				id: inputs.templateId,
				version: inputs.templateVersion,
				name: inputs.templateName
			},
			requirements: inputs.generationRequirements,
			resources: inputs.resources ?? [],
			mustReadPaths: inputs.mustReadPaths ?? [],
			formatSource: inputs.formatSource,
			bundleId: inputs.bundleId,
			reportId: inputs.reportId,
			title: inputs.title
		});
		const buffer = Buffer.from(markdown, "utf8");
		const staged = await this.stageFileIntoEntry({
			projectId: bundle.projectId,
			bundleId: bundle.id,
			kind: "report-contract",
			buffer,
			allowExisting: true
		});
		return {
			contractPath: staged.filePath,
			sha256: createHash("sha256").update(buffer).digest("hex"),
			characters: markdown.length,
			sectionCount: (inputs.generationRequirements?.sections ?? []).length
		};
	},


	/** 待精读条目可在产物生成前切换并固化所选阅读笔记模板。
	 *  已暂存（paperCardPath 固化）后：同模板（id + version 与快照一致）视为
	 *  幂等重放，直接返回原报告不报错；请求不同模板才拒绝并给出可操作提示
	 *  （P1 修复 #5：二次 register_report 带相同 noteTemplateId/Version 不再误报）。 */
	async selectReadingReportTemplate({ reportId, noteTemplateId, noteTemplateVersion }) {
		const report = this.getReadingReport(reportId);
		if (!report) throw new Error(`reading report '${reportId}' not found`);
		const snapshot = report.noteTemplateSnapshot;
		const noteId = noteTemplateId ?? snapshot?.id ?? "note-default";
		const sameTemplate = Boolean(snapshot)
			&& String(snapshot.id) === String(noteId)
			&& (noteTemplateVersion === undefined || String(snapshot.version) === String(noteTemplateVersion));
		if (report.paperCardPath) {
			if (sameTemplate) return report; // 幂等：模板已固化且未变化
			throw new Error(
				`reading report template cannot change after the report artifact is staged：` +
				`已固化模板 ${snapshot ? `${snapshot.id}@${snapshot.version}` : "(无)"}` +
				`，请求 ${noteId}@${noteTemplateVersion ?? "(latest)"}。` +
				`如需更换模板请新建报告（新的 reportId）；更新已暂存报告时请勿传模板参数。`
			);
		}
		const fresh = await this.ctx.labNoteTemplates.snapshotForTask(noteId, noteTemplateVersion);
		const requirements = this.ctx.labNoteTemplates.toNoteRequirements(fresh);
		const next = readingReportSchema.parse({
			...report,
			noteTemplateSnapshot: fresh,
			noteRequirements: requirements,
			updatedAt: new Date().toISOString()
		});
		await this.table("reports").put(reportId, next);
		return next;
	},


	/** completeReadingReport：把实际 DOCX 自动暂存到文献条目，再运行非阻断自查。 */
	async completeReadingReport({ reportId, paperCardPath, docxPath, locatorMode, model, shortCitation, titleZh, summary }) {
		const existing = this.table("reports").get(reportId);
		if (existing === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!paperCardPath || !existsSync(paperCardPath)) throw new Error(`paper card file missing: ${paperCardPath ?? "(empty path)"}`);
		const patch = {
			status: "under-review",
			progress: "DOCX staged; lightweight self-check pending",
			paperCardPath,
			locatorMode: locatorMode ?? existing.locatorMode,
			audit: { ok: false, errors: 0, warnings: 0, summary: "" },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		};
		if (shortCitation !== undefined) patch.shortCitation = normalizeJournalShortCitation(shortCitation, existing.shortCitation, this.table("bundles").get(existing.bundleId)?.title) ?? shortCitation;
		if (titleZh !== undefined) patch.titleZh = titleZh;
		if (summary !== undefined) patch.summary = summary;
		// 精读 Markdown 固化到文献条目目录（<entryStem> 精读报告.md），与正文/SI 同目录。
		const mdBuffer = await readFile(paperCardPath, "utf8");
		const stagedMd = await this.stageFileIntoEntry({
			projectId: existing.projectId,
			bundleId: existing.bundleId,
			kind: "report-md",
			buffer: Buffer.from(mdBuffer, "utf8"),
			allowExisting: true
		});
		patch.paperCardPath = stagedMd.filePath;
		const staged = await this.materializeReadingDocx({ ...existing, ...patch }, docxPath);
		patch.docxPath = staged.docxPath;
		patch.artifactSha256 = staged.integrity.sha256;
		const report = await this.transit("reports", reportId, patch);
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { paperCardPath: stagedMd.filePath, locatorMode },
			model
		});
		return await this.validateReadingReport({ reportId, model });
	},


	/** 机器自查：只提供提醒；无论发现多少问题，实际产物都留在人工审阅暂存区。 */
	async validateReadingReport({ reportId, locatorMode, auditReportPath, model }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card; complete it first`);
		await this.transit("reports", reportId, { status: "under-review", progress: "running lightweight self-check; human review remains available" });
		const cardText = await readFile(report.paperCardPath, "utf8");
		const declaredMode = cardText.match(/locator[ _-]*mode[^\n]*(page-grounded|structure-grounded|source-limited)/i)?.[1]?.toLowerCase();
		const mode = locatorMode ?? declaredMode ?? report.locatorMode;
		const reportOut = auditReportPath ?? join(dirname(report.paperCardPath), `${reportId}-audit-report.json`);
		let result;
		try {
			const bundlePath = this.table("bundles").get(report.bundleId)?.sourceMapPath;
			result = /^##\s+01\b/m.test(cardText)
				? await this.executor.auditPaperCard({ card: report.paperCardPath, bundle: bundlePath, locatorMode: mode, report: reportOut })
				: await auditReadingNote({ cardPath: report.paperCardPath, bundlePath, locatorMode: mode, noteRequirements: report.noteRequirements, reportPath: reportOut });
		} catch (error) {
			return await this.transit("reports", reportId, {
				status: "under-review",
				progress: "self-check unavailable; awaiting human review",
				auditReportPath: reportOut,
				audit: { ok: false, errors: 0, warnings: 1, summary: `自查未完成：${error.message}` },
				error: undefined
			});
		}
		const next = await this.transit("reports", reportId, {
			status: "under-review",
			progress: result.ok ? "self-check completed; awaiting human review" : `self-check found ${result.errors} issue(s); awaiting human review`,
			locatorMode: mode,
			auditReportPath: reportOut,
			audit: { ok: result.ok, errors: result.errors, warnings: result.warnings, summary: result.summary }
		});
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { audit: reportOut, locatorMode: mode },
			model,
			source: "audit_paper_card.py"
		});
		return next;
	},


	/** 人工审阅精读报告：机器自查不设门槛；通过时绑定实际 DOCX 哈希。 */
	async reviewReadingReport({ reportId, decision, note, reviewer = "human-ui" }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (report.status !== "under-review") throw new Error(`reading report '${reportId}' is ${report.status}; only under-review can be reviewed`);
		if (!report.paperCardPath || !existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const staged = await this.materializeReadingDocx(report, report.docxPath);
		const reviewedAt = new Date().toISOString();
		return await this.transit("reports", reportId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: staged.integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: staged.integrity.sha256 }
		}, reviewedAt);
	},


	listReadingReports(projectId) {
		return [...this.table("reports").keys()]
			.map((k) => this.table("reports").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},


	/**
	 * 删除一个精读条目及其派生产物。若没有其他报告继续引用同一 bundle，
	 * 同时删除该文献 bundle 和课题工作区内的整条归档目录。
	 */
	async deleteReadingReport(reportId, projectId) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (report.projectId !== projectId) throw new Error(`reading report '${reportId}' belongs to another project`);

		const bundle = this.table("bundles").get(report.bundleId);
		const presentationIds = this.listPresentationsForReport(reportId).map((row) => row.id);
		const otherBundleReports = this.listReadingReports(projectId)
			.filter((row) => row.id !== reportId && row.bundleId === report.bundleId);
		const deleteBundle = Boolean(bundle && bundle.projectId === projectId && otherBundleReports.length === 0);

		if (deleteBundle) {
			const project = this.requireProject(projectId);
			const workspacePath = resolve(project.workspacePath ?? join(this.projectsRoot, projectId));
			const entryDir = resolve(bundle.entryDir ?? literatureEntryLayout(workspacePath, bundle, report).entryDir);
			if (!isPathInside(workspacePath, entryDir) || entryDir === workspacePath) {
				throw new Error(`refusing to delete literature entry outside '${workspacePath}': ${entryDir}`);
			}
			await rm(entryDir, { recursive: true, force: true });
		}

		let presentations = 0;
		for (const id of presentationIds) if (await this.table("presentations").delete(id)) presentations += 1;
		const provenanceRunIds = new Set([reportId, ...presentationIds, ...(deleteBundle ? [report.bundleId] : [])]);
		let provenance = 0;
		for (const key of [...this.table("provenance").keys()]) {
			const row = this.table("provenance").get(key);
			if (row?.projectId === projectId && provenanceRunIds.has(row.runId) && await this.table("provenance").delete(key)) provenance += 1;
		}
		const reports = await this.table("reports").delete(reportId) ? 1 : 0;
		const bundles = deleteBundle && await this.table("bundles").delete(report.bundleId) ? 1 : 0;
		return { reportId, bundleId: report.bundleId, deleted: { reports, presentations, provenance, bundles } };
	},


	getReadingReport(id) {
		return this.table("reports").get(id);
	}
};
