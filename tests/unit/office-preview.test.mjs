import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficePreviewRenderer } from "../../lib/office-preview.js";

test("Office preview cache is keyed by the exact source hash and must contain a real PDF", async () => {
	const dir = await mkdtemp(join(tmpdir(), "office-preview-test-"));
	try {
		const source = Buffer.from("staged-office-file");
		const sourceSha256 = createHash("sha256").update(source).digest("hex");
		const pdf = Buffer.from("%PDF-1.7\nexact rendered pages");
		await writeFile(join(dir, `${sourceSha256}.pdf`), pdf);
		const renderer = new OfficePreviewRenderer({ cacheDir: dir, sofficePath: "definitely-not-used" });
		const result = await renderer.render({ buffer: source, kind: "docx", sha256: sourceSha256 });
		assert.equal(result.sourceSha256, sourceSha256);
		assert.deepEqual(result.buffer, pdf);

		await writeFile(join(dir, `${"a".repeat(64)}.pdf`), Buffer.from("not a pdf"));
		await assert.rejects(() => renderer.render({ buffer: source, kind: "pptx", sha256: "a".repeat(64) }), /invalid rendered preview PDF/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Office preview has no approximate fallback when LibreOffice is unavailable", async () => {
	const dir = await mkdtemp(join(tmpdir(), "office-preview-preflight-"));
	try {
		const renderer = new OfficePreviewRenderer({ cacheDir: dir, sofficePath: join(dir, "missing-soffice") });
		await assert.rejects(() => renderer.preflight(), /renderer unavailable/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
