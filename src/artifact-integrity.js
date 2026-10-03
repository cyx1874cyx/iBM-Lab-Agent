import { createHash } from "node:crypto";

export function validatePdfBuffer(value, { minBytes = 8 * 1024, maxBytes = 250 * 1024 * 1024 } = {}) {
	const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
	if (buffer.byteLength < minBytes) throw new Error(`PDF 文件过小（${buffer.byteLength} 字节），疑似错误页`);
	if (buffer.byteLength > maxBytes) throw new Error(`PDF 超过 ${Math.round(maxBytes / 1024 / 1024)} MB 安全上限`);
	if (!buffer.subarray(0, Math.min(buffer.byteLength, 1024)).includes(Buffer.from("%PDF-"))) {
		throw new Error("下载内容不是有效 PDF（缺少 PDF 文件头）");
	}
	if (!buffer.subarray(Math.max(0, buffer.byteLength - 4096)).includes(Buffer.from("%%EOF"))) {
		throw new Error("PDF 结尾不完整（缺少 EOF 标记）");
	}
	const text = buffer.toString("latin1");
	const pageEstimate = Math.max(0, (text.match(/\/Type\s*\/Page\b/g) ?? []).length) || undefined;
	return {
		buffer,
		byteLength: buffer.byteLength,
		sha256: createHash("sha256").update(buffer).digest("hex"),
		pageEstimate
	};
}
