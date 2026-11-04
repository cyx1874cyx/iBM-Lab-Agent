/**
 * 文献精读上传的分块暂存。
 *
 * 前端把文件切成固定大小的块，服务端逐块追加到临时文件，最后一次性读取
 * 并复用现有的导入流程。这样不再把整份文件放进一个 base64 请求里，
 * 内存峰值只与单块大小有关，也不再设置文件大小上限。
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { decodeUploadBase64 } from "dsh-lab-agent/convert";

export const READING_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_ID = /^upload-[0-9a-f-]{36}$/i;

export class ReadingUploadStaging {
	constructor(root) {
		this.root = root;
	}

	#dir(uploadId) {
		if (!UPLOAD_ID.test(String(uploadId ?? ""))) throw Error("上传会话无效");
		return join(this.root, String(uploadId));
	}

	async begin({ name } = {}) {
		const uploadId = "upload-" + randomUUID();
		const dir = join(this.root, uploadId);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "meta.json"), JSON.stringify({ uploadId, name: String(name ?? ""), received: 0, createdAt: new Date().toISOString() }), "utf8");
		await writeFile(join(dir, "data.bin"), Buffer.alloc(0));
		return { uploadId, chunkBytes: READING_UPLOAD_CHUNK_BYTES };
	}

	async append({ uploadId, index, base64 } = {}) {
		if (!Number.isInteger(index) || index < 0) throw Error("分块序号无效");
		const dir = this.#dir(uploadId);
		const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
		if (index !== meta.received) throw Error("分块顺序错误，请重新上传");
		// 单块仍做 base64 合法性与大小校验（4 MB 块，留 2 倍余量）。
		const chunk = decodeUploadBase64(base64, { maxBytes: READING_UPLOAD_CHUNK_BYTES * 2 });
		if (!chunk.length) throw Error("分块为空");
		await appendFile(join(dir, "data.bin"), chunk);
		meta.received += 1;
		await writeFile(join(dir, "meta.json"), JSON.stringify(meta), "utf8");
		return { received: meta.received };
	}

	async assemble({ uploadId } = {}) {
		const dir = this.#dir(uploadId);
		const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
		const buffer = await readFile(join(dir, "data.bin"));
		if (!buffer.length) throw Error("上传内容为空");
		return { name: meta.name, buffer };
	}

	async abort({ uploadId } = {}) {
		await rm(this.#dir(uploadId), { recursive: true, force: true });
	}

	/** 清理超过 maxAgeMs 未完成的上传会话（默认 24 小时）。 */
	async cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
		if (!existsSync(this.root)) return 0;
		let removed = 0;
		for (const entry of await readdir(this.root, { withFileTypes: true })) {
			if (!entry.isDirectory() || !UPLOAD_ID.test(entry.name)) continue;
			const info = await stat(join(this.root, entry.name)).catch(() => null);
			if (info === null || Date.now() - info.mtimeMs <= maxAgeMs) continue;
			await rm(join(this.root, entry.name), { recursive: true, force: true }).catch(() => {});
			removed += 1;
		}
		return removed;
	}
}
