/**
 * dsh-lab-agent / labTasks — 多个任务领域共用的 module-level helper。
 */

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";


/**
 * 面板短引用统一为“期刊 卷, 页码 (年份).”。兼容登记时夹带作者，或原文
 * 标题末尾使用 “Nature 630:84-90, 2024” 的旧数据。
 */
export function normalizeJournalShortCitation(...values) {
	const pattern = /\*?([A-Z][A-Za-z.&' -]*?)\*?\s+(\d+[A-Za-z]?)\s*[,：:]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)\s*(?:\((\d{4})\)|,\s*(\d{4}))/g;
	for (const value of values) {
		const matches = [...String(value ?? "").matchAll(pattern)];
		const match = matches.at(-1);
		if (!match) continue;
		const journal = match[1].trim();
		const pages = match[3].replace(/\s*[-–—]\s*/g, "–");
		return `${journal} ${match[2]}, ${pages} (${match[4] || match[5]}).`;
	}
	return undefined;
}


/** target 是否位于 root 之下（含 root 自身；Windows 大小写不敏感）。 */
export function isPathInside(root, target) {
	const r = resolve(root).toLowerCase();
	const t = resolve(target).toLowerCase();
	return t === r || t.startsWith(r + sep.toLowerCase());
}


/** 原子写入：临时文件 + rename（Windows 目标已存在时先移除再重试）。 */
export async function atomicWrite(targetPath, buffer) {
	await mkdir(dirname(targetPath), { recursive: true });
	const tmpPath = join(dirname(targetPath), `.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
	await writeFile(tmpPath, buffer);
	try {
		await rename(tmpPath, targetPath);
	} catch (error) {
		await rm(targetPath, { force: true });
		await rename(tmpPath, targetPath);
	}
	return targetPath;
}


export function cleanStringList(value) {
	if (value === undefined) return undefined;
	return [...new Set((Array.isArray(value) ? value : [value]).map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}


export function inferredPublicationYear(year, publicationDate) {
	if (year !== undefined && year !== null && year !== "") return Number(year);
	const match = String(publicationDate ?? "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
	return match ? Number(match[1]) : undefined;
}
