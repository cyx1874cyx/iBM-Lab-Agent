/**
 * dsh-lab-agent: vendored nature-skills 树的体积白名单（vendor.manifest.json）。
 *
 * 背景（路线书 1.3）：vendor/ 固定在上游某个 commit，但其中一部分资源对运行期无用
 * 却占几十 MB（figures4papers 28 MB、仓库根 README 配图 4.6 MB）。本模块负责
 * **声明**（读取并校验清单）与**执行**（幂等地从树里剔除这些路径），供
 * scripts/pin-vendor.mjs（升级时自动应用）与 scripts/prune-vendor.mjs（工作区修复）共用。
 *
 * 安全边界：
 *   - 只接受相对路径，且必须落在 vendorRoot 之内（拒绝 `..`、绝对路径与根路径本身）；
 *     剔除是不可逆的文件删除，一个手滑的 "../" 就会删掉仓库别处的东西。
 *   - 默认「保留」：未在清单中声明的路径一律不动（新上游资源不会被静默丢弃）。
 */

import { readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const VENDOR_MANIFEST_SCHEMA = "dsh-lab-agent/vendor-manifest/v1";

const vendorManifestSchema = z.object({
	schema: z.literal(VENDOR_MANIFEST_SCHEMA),
	/** vendor 树相对仓库根的路径。 */
	vendorRoot: z.string().min(1),
	note: z.union([z.string(), z.array(z.string())]).optional(),
	exclude: z.array(z.object({
		path: z.string().min(1),
		bytesAtExclusion: z.number().int().nonnegative().optional(),
		filesAtExclusion: z.number().int().nonnegative().optional(),
		reason: z.string().min(1),
		restore: z.string().optional()
	})).default([])
});

export function parseVendorManifest(value) {
	return vendorManifestSchema.parse(value);
}

export async function readVendorManifest(path) {
	return parseVendorManifest(JSON.parse(await readFile(path, "utf8")));
}

/**
 * 校验并解析一条排除路径为绝对路径。
 * 拒绝：绝对路径、空路径、解析后等于 vendorRoot、逃出 vendorRoot。
 */
export function resolveExcludedPath({ vendorRoot, entry }) {
	const root = resolve(vendorRoot);
	const raw = String(entry?.path ?? "").trim();
	if (!raw) throw new Error("vendor manifest: 排除项缺少 path");
	if (isAbsolute(raw)) throw new Error(`vendor manifest: 排除路径必须是相对路径：${raw}`);
	const target = resolve(root, normalize(raw));
	if (target === root) throw new Error(`vendor manifest: 不允许剔除 vendorRoot 本身：${raw}`);
	const rel = relative(root, target);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`vendor manifest: 排除路径逃出 vendorRoot：${raw}`);
	}
	return target;
}

/** 递归统计目录/文件的字节数与文件数（用于报告实际回收量）。 */
export async function measurePath(target) {
	let bytes = 0;
	let files = 0;
	async function walk(path) {
		const info = await stat(path).catch(() => undefined);
		if (!info) return;
		if (info.isDirectory()) {
			for (const entry of await readdir(path, { withFileTypes: true })) {
				await walk(join(path, entry.name));
			}
			return;
		}
		bytes += info.size;
		files += 1;
	}
	await walk(target);
	return { bytes, files };
}

/**
 * 幂等地把清单里的排除项从树里删掉。
 * 返回每项的结果（存在与否、实际回收字节/文件数），便于报告与断言。
 */
export async function pruneVendorTree({ repoRoot, manifest }) {
	const vendorRoot = resolve(repoRoot, manifest.vendorRoot);
	const results = [];
	let removedBytes = 0;
	let removedFiles = 0;
	for (const entry of manifest.exclude) {
		const target = resolveExcludedPath({ vendorRoot, entry });
		const exists = await stat(target).then(() => true).catch(() => false);
		if (!exists) {
			results.push({ path: entry.path, existed: false, bytes: 0, files: 0 });
			continue;
		}
		const { bytes, files } = await measurePath(target);
		await rm(target, { recursive: true, force: true });
		removedBytes += bytes;
		removedFiles += files;
		results.push({ path: entry.path, existed: true, bytes, files });
	}
	return { vendorRoot, results, removedBytes, removedFiles };
}

/** 清单里声明的排除路径（相对 vendorRoot），用于写入 vendor.lock.json。 */
export function excludedPaths(manifest) {
	return [...new Set(manifest.exclude.map((entry) => entry.path))].sort();
}

/** 断言这些排除项当前**确实不在**树里（供回归/测试使用）。 */
export async function findPresentExclusions({ repoRoot, manifest }) {
	const vendorRoot = resolve(repoRoot, manifest.vendorRoot);
	const present = [];
	for (const entry of manifest.exclude) {
		const target = resolveExcludedPath({ vendorRoot, entry });
		if (await stat(target).then(() => true).catch(() => false)) present.push(entry.path);
	}
	return present;
}

/** 供报告使用的可读路径（避免 Windows 上出现混合分隔符）。 */
export function toPosixPath(path) {
	return path.split(sep).join("/");
}
