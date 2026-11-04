import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeUploadBase64, MAX_UPLOAD_BYTES, UNLIMITED_UPLOAD_BYTES } from "../../lib/convert.js";
import { validatePdfBuffer } from "../../src/artifact-integrity.js";

/** 文献精读 PDF/SI 不设大小上限；其它上传通道保留默认 25 MB。 */
test("文献上传：默认通道仍有 25 MB 限制，显式 maxBytes 时不再限制", () => {
	const size = 26 * 1024 * 1024;
	const buffer = Buffer.alloc(size, 0x41);
	const base64 = buffer.toString("base64");
	assert.equal(MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
	assert.throws(() => decodeUploadBase64(base64), /25 MB/);
	const decoded = decodeUploadBase64(base64, { maxBytes: UNLIMITED_UPLOAD_BYTES });
	assert.equal(decoded.length, size);
	assert.equal(decoded[0], 0x41);
});

test("文献上传：大 PDF 通过校验证书时不因大小被拒", () => {
	const pdf = Buffer.concat([
		Buffer.from("%PDF-1.4\n"),
		Buffer.alloc(26 * 1024 * 1024, 0x20),
		Buffer.from("%%EOF\n")
	]);
	const integrity = validatePdfBuffer(pdf, { minBytes: 5, maxBytes: UNLIMITED_UPLOAD_BYTES });
	assert.match(integrity.sha256, /^[0-9a-f]{64}$/);
	assert.throws(() => validatePdfBuffer(pdf, { minBytes: 5, maxBytes: MAX_UPLOAD_BYTES }), /MB|大|size/i);
});
