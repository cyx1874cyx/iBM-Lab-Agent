/**
 * vendor 体积白名单（vendor.manifest.json）的单元测试（路线书 1.3）。
 *
 * 两类断言：
 * 1) **模块语义**：清单校验、路径安全边界（防 `..` 逃逸）、幂等剔除、字节统计。
 * 2) **仓库级不变量**：清单声明的排除项在**当前仓库树里确实不存在**，且
 *    vendor.lock.json 记录的排除集与清单一致。前者是"白名单真的生效了"的唯一证据，
 *    后者防"改了清单忘了更新锁文件"。
 *
 * 第 2 类必须存在：剔除是不可逆的文件删除，若清单与树/锁三者不一致，上游升级时
 * 会把 33 MB 静默带回来，而没有任何测试会红。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseVendorLock } from "../../src/lockfile.js";
import {
	excludedPaths,
	findPresentExclusions,
	measurePath,
	parseVendorManifest,
	pruneVendorTree,
	readVendorManifest,
	resolveExcludedPath
} from "../../src/vendor-manifest.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_PATH = join(repoRoot, "vendor.manifest.json");

/** 造一棵临时 vendor 树：a/big（2 文件）、a/keep、top。 */
function makeTempTree() {
	const root = mkdtempSync(join(tmpdir(), "vendor-prune-"));
	mkdirSync(join(root, "vendor", "tree", "a", "big"), { recursive: true });
	mkdirSync(join(root, "vendor", "tree", "a", "keep"), { recursive: true });
	mkdirSync(join(root, "vendor", "tree", "top"), { recursive: true });
	writeFileSync(join(root, "vendor", "tree", "a", "big", "1.bin"), Buffer.alloc(1024));
	writeFileSync(join(root, "vendor", "tree", "a", "big", "2.bin"), Buffer.alloc(2048));
	writeFileSync(join(root, "vendor", "tree", "a", "keep", "k.txt"), "keep");
	writeFileSync(join(root, "vendor", "tree", "top", "t.txt"), "top");
	return root;
}

const tempManifest = (exclude) => parseVendorManifest({
	schema: "dsh-lab-agent/vendor-manifest/v1",
	vendorRoot: "vendor/tree",
	exclude
});

// ── 1) 模块语义 ────────────────────────────────────────────────────────────

test("清单 schema：拒绝错误 schema 与缺少理由的排除项", () => {
	assert.throws(() => parseVendorManifest({ schema: "wrong", vendorRoot: "v", exclude: [] }));
	assert.throws(() => parseVendorManifest({
		schema: "dsh-lab-agent/vendor-manifest/v1",
		vendorRoot: "v",
		exclude: [{ path: "x" }] // 缺 reason
	}));
});

test("路径安全边界：拒绝绝对路径、逃逸与 root 本身", () => {
	const vendorRoot = "/repo/vendor/tree";
	assert.throws(() => resolveExcludedPath({ vendorRoot, entry: { path: "/etc/passwd" } }), /相对路径/);
	assert.throws(() => resolveExcludedPath({ vendorRoot, entry: { path: "../outside" } }), /逃出 vendorRoot/);
	assert.throws(() => resolveExcludedPath({ vendorRoot, entry: { path: "a/../../outside" } }), /逃出 vendorRoot/);
	assert.throws(() => resolveExcludedPath({ vendorRoot, entry: { path: "." } }), /vendorRoot 本身/);
	assert.throws(() => resolveExcludedPath({ vendorRoot, entry: { path: "" } }), /缺少 path/);
	// 正常相对路径被接受（含子目录）
	assert.equal(resolveExcludedPath({ vendorRoot, entry: { path: "a/big" } }), "/repo/vendor/tree/a/big");
});

test("measurePath 统计字节与文件数", async () => {
	const root = makeTempTree();
	const measured = await measurePath(join(root, "vendor", "tree", "a", "big"));
	assert.equal(measured.files, 2);
	assert.equal(measured.bytes, 3072);
});

test("pruneVendorTree 只删清单内的路径，且幂等", async () => {
	const root = makeTempTree();
	const manifest = tempManifest([
		{ path: "a/big", reason: "测试用" },
		{ path: "top", reason: "测试用" }
	]);

	const first = await pruneVendorTree({ repoRoot: root, manifest });
	assert.equal(first.removedFiles, 3);
	assert.equal(first.removedBytes, 1024 + 2048 + 3);
	assert.deepEqual(first.results.map((r) => r.existed), [true, true]);
	// 未声明的路径必须留下 —— 白名单是"默认保留"
	assert.equal(await measurePath(join(root, "vendor", "tree", "a", "keep")).then((m) => m.files), 1);

	const second = await pruneVendorTree({ repoRoot: root, manifest });
	assert.equal(second.removedBytes, 0);
	assert.equal(second.removedFiles, 0);
	assert.deepEqual(second.results.map((r) => r.existed), [false, false]);
});

test("findPresentExclusions 报告尚未剔除的路径", async () => {
	const root = makeTempTree();
	const manifest = tempManifest([{ path: "a/big", reason: "x" }, { path: "missing", reason: "y" }]);
	assert.deepEqual(await findPresentExclusions({ repoRoot: root, manifest }), ["a/big"]);
	await pruneVendorTree({ repoRoot: root, manifest });
	assert.deepEqual(await findPresentExclusions({ repoRoot: root, manifest }), []);
});

// ── 2) 仓库级不变量 ────────────────────────────────────────────────────────

test("清单声明的排除项在当前仓库树里确实不存在（白名单已生效）", async () => {
	const manifest = await readVendorManifest(MANIFEST_PATH);
	assert.ok(manifest.exclude.length > 0, "清单不应为空，否则这条断言会变成恒真式");
	const present = await findPresentExclusions({ repoRoot, manifest });
	assert.deepEqual(present, [], `以下排除项仍在树中（运行 node scripts/prune-vendor.mjs）：${present.join(", ")}`);
});

test("vendor.lock.json 记录的排除集与清单一致", async () => {
	const manifest = await readVendorManifest(MANIFEST_PATH);
	const lock = parseVendorLock(readFileSync(join(repoRoot, "vendor.lock.json"), "utf8"));
	assert.ok(lock.vendorManifest, "vendor.lock.json 缺少 vendorManifest 记录");
	assert.equal(lock.vendorManifest.file, "vendor.manifest.json");
	assert.deepEqual(lock.vendorManifest.excludedPaths, excludedPaths(manifest));
});

test("清单的排除项带有理由与恢复方式（可审计、可回滚）", async () => {
	const manifest = await readVendorManifest(MANIFEST_PATH);
	for (const entry of manifest.exclude) {
		assert.ok(entry.reason && entry.reason.length > 20, `${entry.path} 的 reason 过短，无法审计`);
		assert.ok(entry.restore, `${entry.path} 缺少 restore 说明，无法回滚`);
	}
});

test("prune-vendor 脚本与 pin-vendor 都接入了清单（防只在一边生效）", () => {
	const prune = readFileSync(join(repoRoot, "scripts/prune-vendor.mjs"), "utf8");
	const pin = readFileSync(join(repoRoot, "scripts/pin-vendor.mjs"), "utf8");
	assert.match(prune, /from "\.\.\/src\/vendor-manifest\.js"/);
	assert.match(pin, /from "\.\.\/src\/vendor-manifest\.js"/);
	// pin 必须在每次升级后都应用（幂等），否则上游会把剔除项带回来
	assert.match(pin, /pruneVendorTree\(\{ repoRoot, manifest \}\)/);
	assert.match(pin, /vendorManifest:/);
});
