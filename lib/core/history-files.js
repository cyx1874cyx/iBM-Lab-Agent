import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { inspectOfficePackage } from "../../src/office-package.js";
import { entryFileName } from "../entry-layout.js";
export const historyFileMethods = {
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
	async readingReportDownload(reportId, format = "md") {
		const file = await this.readingReportFile(reportId, format);
		if (file.format === "docx") {
			return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
		}
		return { ...file, buffer: undefined };
	},
	listPresentationsForReport(reportId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.reportId === reportId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},
	async presentationFile(reportId, { requireApproved = false } = {}) {
		const run = this.listPresentationsForReport(reportId).find((r) => r.pptxPath && existsSync(r.pptxPath));
		if (run === undefined) throw new Error(`reading report '${reportId}' has no downloadable PPTX yet`);
		const buffer = await readFile(run.pptxPath);
		const integrity = await inspectOfficePackage(buffer, "pptx");
		if (requireApproved) this.assertApprovedArtifact(run, `presentation '${run.id}'`, integrity.sha256);
		const bundle = this.table("bundles").get(run.bundleId);
		// 归档时已按 entryFileName 落盘，所以兜底用磁盘上的文件名（而不是 run id）也不会脱离规范。
		return {
			fileName: bundle?.entryStem ? entryFileName(bundle.entryStem, "ppt") : basename(run.pptxPath),
			mime: integrity.mime,
			buffer,
			byteLength: integrity.byteLength,
			sha256: integrity.sha256
		};
	},
	async presentationDownload(reportId) {
		const file = await this.presentationFile(reportId);
		return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
	},
	async reviewFile(runId, kind = "report") {
		const run = this.table("searches").get(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const filePath = kind === "ppt" ? run.reviewPresentation?.pptxPath : run.review?.markdownPath;
		if (!filePath) throw new Error(`search run '${runId}' has no review ${kind === "ppt" ? "presentation" : "report"}`);
		if (!existsSync(filePath)) throw new Error(`review file missing: ${filePath}`);
		const buffer = await readFile(filePath);
		return { fileName: filePath.split(/[\\/]/).pop(), buffer, byteLength: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
	}
};
