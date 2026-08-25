import test from "node:test";
import assert from "node:assert/strict";

import {
	inferSourceIdFromUrl,
	normalizePaperIdentifier,
	safePdfFileName,
	validatePdfBuffer
} from "../../lib/literature-browser.js";

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
