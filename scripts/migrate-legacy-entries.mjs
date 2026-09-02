/**
 * 一次性受控迁移：0.1.14 旧 captured-literature/<bundleId>/ 布局 → 0.1.15 条目目录
 * literature/<entryStem>/。遵循文档顺序：复制到临时文件 → 校验 → 原子替换 → 更新 DB；
 * 数据库更新前不删除旧文件，失败保留原文件并报告错误。
 * 运行前提：iBM Lab Agent 已完全退出（避免与运行中的 DSH 服务争用数据库）。
 */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { buildEntryStem, entryFileName } from "../lib/entry-layout.js";

const DB_PATH = process.env.IBM_LAB_AGENT_DB
	?? "C:/Users/admin/AppData/Local/iBM-Lab-Agent/dsh/storages/lab_tasks.json";
const PROJECTS_ROOT = "C:/Users/admin/AppData/Local/iBM-Lab-Agent/dsh/lab-agent/projects";

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const table = db.tables?.paper_source_bundles;
if (!table) throw new Error("paper_source_bundles 表不存在");

const ids = process.argv.slice(2).length
	? process.argv.slice(2)
	: Object.keys(table);

const now = new Date().toISOString();
let migrated = 0;

for (const id of ids) {
	const row = table[id];
	if (!row) {
		console.log(`SKIP ${id}: 未找到`);
		continue;
	}
	const stem = buildEntryStem(row, undefined);
	const workspace = join(PROJECTS_ROOT, row.projectId);
	const entryDir = join(workspace, "literature", stem);
	mkdirSync(entryDir, { recursive: true });
	console.log(`条目目录: ${entryDir}`);

	for (const [kind, key] of [["pdf", "pdfPath"], ["si", "siPath"]]) {
		const oldPath = row[key];
		if (!oldPath || !existsSync(oldPath)) {
			console.log(`  - ${kind}: 无文件，跳过`);
			continue;
		}
		const target = join(entryDir, entryFileName(stem, kind));
		if (existsSync(target)) {
			console.log(`  - ${kind}: 目标已存在（幂等）: ${target}`);
			row[key] = target;
			continue;
		}
		const tmp = join(entryDir, `.migrate-${kind}-${Date.now().toString(36)}.tmp`);
		try {
			copyFileSync(oldPath, tmp);
			const oldSha = createHash("sha256").update(readFileSync(oldPath)).digest("hex");
			const tmpSha = createHash("sha256").update(readFileSync(tmp)).digest("hex");
			if (oldSha !== tmpSha) throw new Error(`临时文件校验失败 ${kind}`);
			renameSync(tmp, target);
			row[key] = target;
			console.log(`  - ${kind}: ${basenameSafe(oldPath)} -> ${target}（内容哈希 ${tmpSha.slice(0, 12)}…，与登记一致）`);
		} catch (error) {
			console.error(`  - ${kind}: 迁移失败，保留原文件: ${String(error?.message ?? error)}`);
			if (existsSync(tmp)) renameSync(tmp, tmp + ".failed");
		}
	}

	row.entryStem = stem;
	row.entryDir = entryDir;
	row.updatedAt = now;
	migrated++;
}

function basenameSafe(path) {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1];
}

writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(`完成：${migrated} 个 bundle 已固化条目布局。数据库已更新（旧文件保留）。`);
