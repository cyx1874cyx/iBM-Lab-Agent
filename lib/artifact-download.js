/**
 * Same-origin binary download endpoint for DOCX/PPTX artifacts.
 * Large Office files must not cross the Typert JSON boundary as base64: a
 * partial/truncated JSON payload can still be saved with an Office extension
 * and Windows then reports that the file is corrupt. This endpoint streams the
 * validated bytes and exposes size/SHA-256 headers for client-side verification.
 */

import { Service } from "@deepseek-ai/cordis";
import { join } from "node:path";
import { OfficePreviewRenderer } from "./office-preview.js";
import { labAgentRoot, resolveDshHome } from "../src/paths.js";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function denyCrossSite(req) {
	const fetchSite = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
	if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return true;
	const origin = req.headers.origin;
	const host = req.headers.host;
	if (!origin || !host) return false;
	try {
		return new URL(String(origin)).host !== String(host);
	} catch {
		return true;
	}
}

function sendError(res, status, message) {
	const body = Buffer.from(String(message), "utf8");
	res.writeHead(status, {
		"content-type": "text/plain;charset=utf-8",
		"content-length": String(body.length),
		"cache-control": "no-store"
	});
	res.end(body);
}

function sendPreviewError(res, status, message) {
	const escaped = String(message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>Office 预览不可用</title><style>body{margin:0;background:#eef3f1;color:#17382f;font:14px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}.box{max-width:560px;margin:15vh auto;padding:28px;border:1px solid #cbdcd6;border-radius:16px;background:white;box-shadow:0 14px 45px #163a2c18}h1{margin:0 0 10px;font-size:18px}p{margin:0;color:#607b71}code{display:block;margin-top:14px;padding:10px;border-radius:9px;background:#f3f7f5;color:#76542d;word-break:break-word}</style><div class="box"><h1>Office 分页预览环境未就绪</h1><p>本产品不使用文本或近似预览。请安装打包清单中的 LibreOffice 运行时后重新打开。</p><code>${escaped}</code></div>`, "utf8");
	res.writeHead(status, { "content-type": "text/html;charset=utf-8", "content-length": String(body.length), "cache-control": "no-store", "x-content-type-options": "nosniff" });
	res.end(body);
}

/** Exported for focused unit tests without booting the whole web profile. */
export function createArtifactDownloadHandler(tasks, { renderPreview } = {}) {
	return async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405, { allow: "GET" });
			res.end("method not allowed");
			return;
		}
		if (denyCrossSite(req)) {
			sendError(res, 403, "cross-site artifact download denied");
			return;
		}
		const url = new URL(req.url ?? "/api/lab-artifacts", "http://localhost");
		const kind = url.searchParams.get("kind");
		const preview = url.searchParams.get("preview") === "1";
		const reportId = url.searchParams.get("reportId") ?? "";
		if (!ID_RE.test(reportId)) {
			sendError(res, 400, "invalid reportId");
			return;
		}
		try {
			let file;
			if (kind === "report") {
				const format = url.searchParams.get("format") === "docx" ? "docx" : "md";
				file = await tasks.readingReportFile(reportId, preview ? "docx" : format, { requireApproved: !preview });
			} else if (kind === "ppt") {
				file = await tasks.presentationFile(reportId, { requireApproved: !preview });
			} else if (kind === "pdf" || kind === "si") {
				// 文献条目 PDF/SI 原文：按 bundleId 出流（bundle 登记时固化的哈希/文件名）。
				const bundleId = url.searchParams.get("bundleId") ?? "";
				if (!ID_RE.test(bundleId)) {
					sendError(res, 400, "invalid bundleId");
					return;
				}
				file = await tasks.bundleFile(bundleId, kind);
			} else {
				sendError(res, 400, "kind must be report, ppt, pdf or si");
				return;
			}
			if (preview) {
				if (typeof renderPreview !== "function") throw new Error("Office preview renderer is not configured");
				const rendered = await renderPreview({ buffer: file.buffer, kind: kind === "report" ? "docx" : "pptx", sha256: file.sha256 });
				res.writeHead(200, {
					"content-type": "application/pdf",
					"content-length": String(rendered.byteLength),
					"content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName.replace(/\.(docx|pptx)$/i, ".pdf"))}`,
					"x-source-sha256": rendered.sourceSha256,
					"x-content-sha256": rendered.sha256,
					"cache-control": "no-store, max-age=0",
					"x-content-type-options": "nosniff"
				});
				res.end(rendered.buffer);
				return;
			}
			res.writeHead(200, {
				"content-type": file.mime,
				"content-length": String(file.byteLength),
				"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
				"x-file-name": encodeURIComponent(file.fileName),
				"x-content-sha256": file.sha256,
				"cache-control": "no-store, max-age=0",
				"x-content-type-options": "nosniff"
			});
			res.end(file.buffer);
		} catch (error) {
			const status = preview && /renderer|LibreOffice|soffice/i.test(error.message || "") ? 503 : 404;
			if (preview) sendPreviewError(res, status, error.message || "artifact unavailable");
			else sendError(res, status, error.message || "artifact unavailable");
		}
	};
}

export class LabArtifactDownloadService extends Service {
	static inject = ["labTasks", "webServer"];

	constructor(ctx, config = {}) {
		super(ctx, "labArtifactDownload");
		this.config = config;
	}

	async [Service.init]() {
		const renderer = new OfficePreviewRenderer({
			cacheDir: this.config.previewDir ?? join(labAgentRoot(resolveDshHome()), "previews"),
			sofficePath: this.config.sofficePath,
			timeoutMs: this.config.timeoutMs
		});
		const handler = createArtifactDownloadHandler(this.ctx.labTasks, { renderPreview: (file) => renderer.render(file) });
		this.ctx.effect(() => this.ctx.webServer.register({
			kind: "prefix",
			path: "/api/lab-artifacts",
			handler
		}), "lab-agent.artifact-download");
	}
}

export default LabArtifactDownloadService;
