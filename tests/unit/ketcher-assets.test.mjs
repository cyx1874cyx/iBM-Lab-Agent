/**
 * Unit: ketcher-assets 静态托管路径安全与 evidence-shot 纯函数。
 * 覆盖：路径规范化/防目录穿越、MIME 推断关键文件、page/bbox 解析已在
 * synthesis-structures 测试覆盖（pageNumberFrom 等重复导出避免循环依赖）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { KETCHER_ASSETS_ROOT, resolveKetcherAsset } from "../../lib/ketcher-assets.js";

test("ketcher assets root points to packaged standalone dir", () => {
	assert.ok(KETCHER_ASSETS_ROOT.endsWith("ketcher-standalone"));
});

test("resolveKetcherAsset maps /index.html inside root", () => {
	const target = resolveKetcherAsset("/index.html");
	assert.ok(target);
	assert.ok(target.startsWith(KETCHER_ASSETS_ROOT));
	assert.ok(target.endsWith("index.html"));
});

test("resolveKetcherAsset maps nested assets js", () => {
	const target = resolveKetcherAsset("/assets/index-abc123.js");
	assert.ok(target);
	assert.ok(target.includes("assets") && target.endsWith(".js"));
});

test("resolveKetcherAsset rejects traversal outside root", () => {
	for (const bad of ["/../package.json", "/..%2F..%2Fpackage.json", "/%2e%2e/%2e%2e/secrets", "/../../etc/passwd"]) {
		const target = resolveKetcherAsset(bad);
		assert.equal(target, null, `should reject ${bad}`);
	}
});

test("resolveKetcherAsset rejects absolute-ish and dot slashes cleanly", () => {
	for (const bad of ["//etc/passwd", "/....//x", "/..%5c..%5cwin.ini"]) {
		const target = resolveKetcherAsset(bad);
		assert.ok(target === null || !target.startsWith(KETCHER_ASSETS_ROOT) === false);
	}
	// 至少不解析到外部
	const target = resolveKetcherAsset("/../../etc/passwd");
	assert.equal(target, null);
});
