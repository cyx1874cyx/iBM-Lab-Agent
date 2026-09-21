/**
 * 打包验证脚本里的硬编码模块路径守卫。
 *
 * 背景（真实事故）：`desktop/scripts/verify-package.ps1` 会往打包后的插件树里写一个
 * `.package-import-probe.mjs`，其中**硬编码**一串 `./lib/*.js` 路径，用于验证打包布局
 * 下能真的 import 到每个入口（"仅仅检查文件存在"抓不到 pnpm link 背后的缺失传递依赖）。
 *
 * 把 `lib/tasks.js` 拆成 `lib/tasks/index.js` 之后，这个探针仍然指向旧路径，
 * 于是 Windows 发布流水线在 `verify-runtime` 阶段报
 * `Packaged plugin import probe failed`（ERR_MODULE_NOT_FOUND）。Linux 侧的 5 道闸门
 * 完全看不到它 —— 该脚本只在 Windows 发布线里执行。
 *
 * 所以这里做一条**静态交叉校验**：解析探针里的路径，逐个确认在仓库里真实存在。
 * 搬家/改名后立刻在 Linux 上红，而不是等到出包跑到 90% 才发现。
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const verifyPackage = readFileSync(join(repoRoot, "desktop", "scripts", "verify-package.ps1"), "utf8");

/** 取出探针里的相对模块路径（形如 './lib/remote.js'）。 */
function probeRelativeImports() {
	const paths = [...verifyPackage.matchAll(/import\('(\.\/[^']+)'\)/g)].map((m) => m[1]);
	assert.ok(paths.length > 0, "未从 verify-package.ps1 里解析出任何相对 import（探针格式变了？）");
	return paths;
}

/** 取出探针里的裸包名（形如 import('zod')）。 */
function probeBareImports() {
	return [...verifyPackage.matchAll(/import\('([^.'][^']*)'\)/g)].map((m) => m[1]);
}

test("探针里的每个 ./lib/* 路径都真实存在（防止搬家后静默失效）", () => {
	const missing = [];
	for (const rel of probeRelativeImports()) {
		const abs = join(repoRoot, rel.replace(/^\.\//, ""));
		if (!existsSync(abs)) missing.push(rel);
	}
	assert.deepEqual(missing, [], `verify-package.ps1 的导入探针指向已不存在的文件：\n  ${missing.join("\n  ")}`);
});

test("探针必须覆盖 tasks 的真实入口（它就是这次事故的那一条）", () => {
	const paths = probeRelativeImports();
	assert.ok(
		paths.includes("./lib/tasks/index.js"),
		`探针缺少 tasks 的真实入口 './lib/tasks/index.js'；当前为：${paths.filter((p) => p.includes("tasks")).join(", ") || "（无）"}`
	);
	// 反向确认：守卫不是恒真 —— 旧路径确实会不存在
	assert.equal(existsSync(join(repoRoot, "lib/tasks.js")), false, "lib/tasks.js 已拆分，不应再存在");
});

test("探针里的裸包名都声明在 dependencies 里", () => {
	const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	const deps = new Set(Object.keys(pkg.dependencies ?? {}));
	const missing = probeBareImports().filter((name) => !deps.has(name));
	assert.deepEqual(missing, [], `打包探针导入了未声明的依赖：${missing.join(", ")}`);
});
