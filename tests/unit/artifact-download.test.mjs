import { test } from "node:test";
import assert from "node:assert/strict";
import { createArtifactDownloadHandler } from "../../lib/artifact-download.js";

function responseCapture() {
	return {
		status: 0,
		headers: {},
		body: Buffer.alloc(0),
		writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
		end(body = "") { this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); }
	};
}

test("artifact endpoint streams verified binary bytes with integrity headers", async () => {
	const expected = Buffer.from("PK\x03\x04binary-office", "latin1");
	const tasks = {
		async readingReportFile(id, format) {
			assert.equal(id, "report-1");
			assert.equal(format, "docx");
			return { fileName: "阅读笔记.docx", mime: "application/docx", buffer: expected, byteLength: expected.length, sha256: "a".repeat(64) };
		}
	};
	const handler = createArtifactDownloadHandler(tasks);
	const res = responseCapture();
	await handler({ method: "GET", url: "/api/lab-artifacts?kind=report&format=docx&reportId=report-1", headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } }, res);
	assert.equal(res.status, 200);
	assert.equal(res.headers["content-length"], String(expected.length));
	assert.equal(res.headers["x-content-sha256"], "a".repeat(64));
	assert.deepEqual(res.body, expected);
});

test("PDF and SI artifact endpoints validate bundleId without requiring reportId", async () => {
	for (const kind of ["pdf", "si"]) {
		const expected = Buffer.from(kind === "pdf" ? "%PDF-1.7\n%%EOF" : "supplementary-data");
		const tasks = {
			async bundleFile(id, requestedKind) {
				assert.equal(id, "bundle-1");
				assert.equal(requestedKind, kind);
				return { fileName: kind === "pdf" ? "paper.pdf" : "supporting.zip", mime: kind === "pdf" ? "application/pdf" : "application/zip", buffer: expected, byteLength: expected.length, sha256: "e".repeat(64) };
			}
		};
		const handler = createArtifactDownloadHandler(tasks);
		const res = responseCapture();
		await handler({ method: "GET", url: `/api/lab-artifacts?kind=${kind}&bundleId=bundle-1`, headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" } }, res);
		assert.equal(res.status, 200);
		assert.equal(res.headers["content-length"], String(expected.length));
		assert.deepEqual(res.body, expected);
	}
});

test("preview endpoint renders the actual unapproved Office bytes as inline PDF", async () => {
	const source = Buffer.from("PK\x03\x04staged-pptx", "latin1");
	const pdf = Buffer.from("%PDF-1.7\npreview");
	const tasks = {
		async presentationFile(id, options) {
			assert.equal(id, "report-1");
			assert.deepEqual(options, { requireApproved: false });
			return { fileName: "deck.pptx", buffer: source, sha256: "b".repeat(64) };
		}
	};
	const handler = createArtifactDownloadHandler(tasks, {
		renderPreview: async ({ buffer, kind, sha256 }) => {
			assert.deepEqual(buffer, source);
			assert.equal(kind, "pptx");
			assert.equal(sha256, "b".repeat(64));
			return { buffer: pdf, byteLength: pdf.length, sha256: "c".repeat(64), sourceSha256: sha256 };
		}
	});
	const res = responseCapture();
	await handler({ method: "GET", url: "/api/lab-artifacts?preview=1&kind=ppt&reportId=report-1", headers: { host: "localhost" } }, res);
	assert.equal(res.status, 200);
	assert.equal(res.headers["content-type"], "application/pdf");
	assert.match(res.headers["content-disposition"], /^inline;/);
	assert.equal(res.headers["x-source-sha256"], "b".repeat(64));
	assert.deepEqual(res.body, pdf);
});

test("preview endpoint never falls back to extracted text when Office rendering is unavailable", async () => {
	const tasks = {
		async readingReportFile(_id, format, options) {
			assert.equal(format, "docx");
			assert.deepEqual(options, { requireApproved: false });
			return { fileName: "note.docx", buffer: Buffer.from("PK\x03\x04", "latin1"), sha256: "d".repeat(64) };
		}
	};
	const handler = createArtifactDownloadHandler(tasks, {
		renderPreview: async () => { throw new Error("Office preview renderer unavailable (soffice)"); }
	});
	const res = responseCapture();
	await handler({ method: "GET", url: "/api/lab-artifacts?preview=1&kind=report&reportId=report-1", headers: { host: "localhost" } }, res);
	assert.equal(res.status, 503);
	assert.match(res.headers["content-type"], /^text\/html/);
	assert.match(res.body.toString("utf8"), /不使用文本或近似预览/);
	assert.doesNotMatch(res.body.toString("utf8"), /PK\\x03/);
});

test("artifact endpoint rejects cross-site and invalid ids", async () => {
	const handler = createArtifactDownloadHandler({});
	const crossSite = responseCapture();
	await handler({ method: "GET", url: "/api/lab-artifacts?kind=ppt&reportId=report-1", headers: { host: "localhost", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }, crossSite);
	assert.equal(crossSite.status, 403);
	const invalid = responseCapture();
	await handler({ method: "GET", url: "/api/lab-artifacts?kind=ppt&reportId=../../etc", headers: { host: "localhost" } }, invalid);
	assert.equal(invalid.status, 400);
	const invalidBundle = responseCapture();
	await handler({ method: "GET", url: "/api/lab-artifacts?kind=pdf&bundleId=../../etc", headers: { host: "localhost" } }, invalidBundle);
	assert.equal(invalidBundle.status, 400);
	assert.match(invalidBundle.body.toString("utf8"), /invalid bundleId/);
});
