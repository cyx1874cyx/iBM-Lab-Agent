import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficePreviewRenderer, resolveSofficeExecutable } from "../../lib/office-preview.js";

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

// ---- P1-3 LibreOffice 可执行文件解析 ----

test("resolveSofficeExecutable reports an explicit missing renderer without silent fallback", async () => {
	const resolved = await resolveSofficeExecutable({ explicit: "C:\\definitely-missing\\soffice.exe", platform: "win32" });
	assert.equal(resolved.source, "explicit-missing");
	assert.equal(resolved.command, null);
	assert.match(resolved.detail, /不存在/);
	assert.ok(resolved.hint.length > 0);
});

test("resolveSofficeExecutable flags an explicit non-executable renderer", async () => {
	const dir = await mkdtemp(join(tmpdir(), "office-preview-explicit-"));
	try {
		const fake = join(dir, "soffice.exe");
		await writeFile(fake, "not an executable");
		const resolved = await resolveSofficeExecutable({ explicit: fake, platform: "win32" });
		assert.equal(resolved.source, "explicit-missing");
		assert.equal(resolved.command, null);
		assert.match(resolved.detail, /不可执行|不存在/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveSofficeExecutable returns a consistent structure without explicit config", async () => {
	const resolved = await resolveSofficeExecutable({ platform: "win32" });
	assert.ok(["explicit", "paths", "path", "unavailable"].includes(resolved.source), resolved.source);
	if (resolved.command) {
		assert.ok(resolved.version, "a found renderer must carry its version");
		assert.equal(resolved.source === "paths" || resolved.source === "explicit", resolved.command.includes("soffice"));
	} else {
		assert.equal(resolved.source, "unavailable");
		assert.match(resolved.detail, /未找到 LibreOffice/);
		assert.match(resolved.hint, /libreoffice\.org/);
	}
});

test("a legacy bare soffice command does not suppress normal renderer discovery", async () => {
	const resolved = await resolveSofficeExecutable({ explicit: "soffice", platform: "win32" });
	assert.notEqual(resolved.source, "explicit-missing");
	assert.doesNotMatch(resolved.detail, /配置的渲染器不存在: soffice/);
});

test("renderer status surfaces the resolver diagnostic", async () => {
	const dir = await mkdtemp(join(tmpdir(), "office-preview-status-"));
	try {
		const renderer = new OfficePreviewRenderer({ cacheDir: dir, sofficePath: join(dir, "missing-soffice") });
		const status = await renderer.status();
		assert.equal(status.command, null);
		assert.equal(status.source, "explicit-missing");
		assert.ok(status.detail && status.hint);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
