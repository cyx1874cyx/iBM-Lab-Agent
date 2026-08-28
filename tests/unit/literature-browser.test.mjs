import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	inferSourceIdFromUrl,
	normalizePaperIdentifier,
	safePdfFileName,
	validatePdfBuffer
} from "../../lib/literature-browser.js";
import { LabLiteratureSourcesService } from "../../lib/literature-sources.js";

function responseCapture() {
	return {
		status: 0,
		headers: {},
		body: Buffer.alloc(0),
		writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
		end(body = "") { this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); }
	};
}

test("normalizes DOI links without retaining resolver parameters", () => {
	assert.deepEqual(normalizePaperIdentifier("https://doi.org/10.1038/s41586-023-00000-0"), {
		identifier: "10.1038/s41586-023-00000-0",
		doi: "10.1038/s41586-023-00000-0",
		landingUrl: "https://doi.org/10.1038/s41586-023-00000-0"
	});
});

test("keeps arXiv PDF routes without requiring a .pdf suffix", () => {
	assert.deepEqual(normalizePaperIdentifier("https://arxiv.org/pdf/1706.03762"), {
		identifier: "https://arxiv.org/pdf/1706.03762",
		landingUrl: "https://arxiv.org/pdf/1706.03762"
	});
});

test("rejects identifiers that are neither DOI nor web URL", () => {
	assert.throws(() => normalizePaperIdentifier("not a paper"), /DOI/);
});

test("maps common publisher hosts to the institutional source", () => {
	assert.equal(inferSourceIdFromUrl("https://www.nature.com/articles/example"), "nature-portfolio");
	assert.equal(inferSourceIdFromUrl("https://pubs.acs.org/doi/10.1021/example"), "acs");
	assert.equal(inferSourceIdFromUrl("https://www.sciencedirect.com/science/article/pii/example"), "sciencedirect");
});

test("validates PDF signature, EOF, size and returns integrity metadata", () => {
	const buffer = Buffer.concat([
		Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n"),
		Buffer.alloc(9_000, 0x20),
		Buffer.from("\n%%EOF\n")
	]);
	const result = validatePdfBuffer(buffer);
	assert.equal(result.byteLength, buffer.byteLength);
	assert.equal(result.sha256.length, 64);
	assert.equal(result.pageEstimate, 1);
	assert.throws(() => validatePdfBuffer(Buffer.alloc(9_000)), /不是有效 PDF/);
});

test("creates a Windows-safe PDF name", () => {
	assert.equal(safePdfFileName({ title: "A/B: paper?" }), "A_B_ paper_.pdf");
});

test("completed literature PDF supports inline web preview and verified download", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-literature-preview-"));
	try {
		const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(9_000, 0x20), Buffer.from("\n%%EOF")]);
		const filePath = join(dir, "paper.pdf");
		await writeFile(filePath, pdf);
		const id = "12345678-1234-1234-1234-123456789abc";
		const job = {
			id,
			state: "completed",
			filePath,
			fileName: "paper.pdf",
			byteLength: pdf.byteLength,
			sha256: createHash("sha256").update(pdf).digest("hex")
		};
		const service = { downloadTable: new Map([[id, job]]), config: {} };

		const preview = responseCapture();
		await LabLiteratureSourcesService.prototype.handleDownloadRequest.call(service, { method: "GET", url: `/api/lab-literature-download?id=${id}&preview=1`, headers: { "sec-fetch-site": "same-origin" } }, preview);
		assert.equal(preview.status, 200);
		assert.equal(preview.headers["content-type"], "application/pdf");
		assert.match(preview.headers["content-disposition"], /^inline;/);
		assert.deepEqual(preview.body, pdf);

		const download = responseCapture();
		await LabLiteratureSourcesService.prototype.handleDownloadRequest.call(service, { method: "GET", url: `/api/lab-literature-download?id=${id}`, headers: {} }, download);
		assert.match(download.headers["content-disposition"], /^attachment;/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
