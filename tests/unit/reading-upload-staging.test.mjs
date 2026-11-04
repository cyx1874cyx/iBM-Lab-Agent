import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadingUploadStaging } from "../../plugins/literature/lib/tasks/upload-staging.js";

test("分块暂存：按序追加、组装、中止与清理", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-reading-upload-"));
	try {
		const staging = new ReadingUploadStaging(dir);
		const { uploadId, chunkBytes } = await staging.begin({ name: "paper.pdf" });
		assert.ok(uploadId.startsWith("upload-"));
		assert.ok(chunkBytes >= 1024 * 1024);

		await staging.append({ uploadId, index: 0, base64: Buffer.from("%PDF-1.4\n").toString("base64") });
		await staging.append({ uploadId, index: 1, base64: Buffer.from("%%EOF\n").toString("base64") });
		const assembled = await staging.assemble({ uploadId });
		assert.equal(assembled.name, "paper.pdf");
		assert.equal(assembled.buffer.toString(), "%PDF-1.4\n%%EOF\n");

		await assert.rejects(() => staging.append({ uploadId, index: 5, base64: "QQ==" }), /顺序/);
		await assert.rejects(() => staging.assemble({ uploadId: "../escape" }), /无效/);
		await assert.rejects(() => staging.append({ uploadId, index: 2, base64: "%%%" }), /base64/);

		await staging.abort({ uploadId });
		assert.equal(existsSync(join(dir, uploadId)), false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("分块暂存：过期会话会被清理", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ibm-reading-upload-clean-"));
	try {
		const staging = new ReadingUploadStaging(dir);
		const stale = await staging.begin({ name: "old.pdf" });
		const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
		await utimes(join(dir, stale.uploadId), old, old);
		const fresh = await staging.begin({ name: "new.pdf" });
		assert.equal(await staging.cleanup(), 1);
		assert.equal(existsSync(join(dir, stale.uploadId)), false);
		assert.equal(existsSync(join(dir, fresh.uploadId)), true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
