#!/usr/bin/env node
/**
 * dsh-lab-agent: 把 vendor.manifest.json 的体积白名单应用到工作区。
 *
 * 幂等：已在清单里的路径不存在时也算成功（重复运行安全）。
 * pin-vendor.mjs 在每次 pin/升级后会自动调用同一模块；本脚本用于：
 *   - 首次把清单落到已有工作区；
 *   - 树被意外恢复后重新修剪；
 *   - 交付前核对（--check：只报告，不删除，有残留则非零退出）。
 *
 * Usage:
 *   node scripts/prune-vendor.mjs            # 应用（幂等）
 *   node scripts/prune-vendor.mjs --dry-run  # 只报告将删除什么
 *   node scripts/prune-vendor.mjs --check    # 只校验是否已修剪（CI/预检用）
 *   node scripts/prune-vendor.mjs --json
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	excludedPaths,
	findPresentExclusions,
	pruneVendorTree,
	readVendorManifest
} from "../src/vendor-manifest.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST = resolve(repoRoot, "vendor.manifest.json");

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);

function mb(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
	const manifest = await readVendorManifest(MANIFEST);
	const asJson = hasFlag("--json");

	if (hasFlag("--check")) {
		const present = await findPresentExclusions({ repoRoot, manifest });
		const ok = present.length === 0;
		if (asJson) {
			console.log(JSON.stringify({ ok, present, excluded: excludedPaths(manifest) }, null, 2));
		} else if (ok) {
			console.log(`vendor 白名单已生效：${excludedPaths(manifest).length} 个排除项均不在树中`);
		} else {
			console.error(`vendor 白名单未生效，以下路径仍在树中（运行 node scripts/prune-vendor.mjs 修复）：`);
			for (const path of present) console.error(`  - ${path}`);
		}
		process.exit(ok ? 0 : 1);
	}

	if (hasFlag("--dry-run")) {
		const present = await findPresentExclusions({ repoRoot, manifest });
		if (asJson) {
			console.log(JSON.stringify({ dryRun: true, wouldRemove: present }, null, 2));
			return;
		}
		console.log(`将剔除 ${present.length} 个路径：`);
		for (const path of present) console.log(`  - ${path}`);
		return;
	}

	const result = await pruneVendorTree({ repoRoot, manifest });
	if (asJson) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	console.log(`=== vendor 白名单应用结果（${manifest.vendorRoot}）===`);
	for (const entry of result.results) {
		const detail = entry.existed ? `${mb(entry.bytes)} / ${entry.files} 文件` : "已不存在（幂等）";
		console.log(`  ${entry.existed ? "−" : "="} ${entry.path}  ${detail}`);
	}
	console.log(`合计回收：${mb(result.removedBytes)}（${result.removedFiles} 文件）`);
}

main().catch((error) => {
	console.error(`prune-vendor failed: ${error.message}`);
	process.exit(1);
});
