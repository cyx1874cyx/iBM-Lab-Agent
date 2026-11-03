#!/usr/bin/env node
/**
 * 拆分解耦不变量检查。
 *
 * 这些是"拆分完成"的硬约束，任何一条被破坏都意味着依赖方向反转：
 *   1. 母包代码（lib/、src/、client/src/）不得 import 任何 plugins/ 路径；
 *   2. 母包不得按包名 import @ibm-lab/*；
 *   3. 母包 cordis.patch.yml 不得静态登记 @ibm-lab/* 的行（插件由部署 profile 决定）；
 *   4. 每个 plugins/<name> 必须有合法 manifest（私有、ESM、dsh.bundle.patch、测试）；
 *   5. 插件只允许 import 母包 package.json exports 里的公开路径（verify-plugins 已覆盖）。
 *
 * 用法：node scripts/check-decoupling.mjs [--json]
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = message => failures.push(message);

function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (/\.(m?js|cjs)$/.test(entry.name)) out.push(full);
	}
	return out;
}

// 1 & 2：母包代码的 import 方向
const motherFiles = [
	...walk(join(repoRoot, "lib")),
	...walk(join(repoRoot, "src")),
	...walk(join(repoRoot, "client", "src"))
];
for (const file of motherFiles) {
	const rel = relative(repoRoot, file).replaceAll("\\", "/");
	const text = readFileSync(file, "utf8");
	for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
		const spec = match[1];
		if (spec.includes("plugins/")) fail(`${rel}: 母包 import 了插件路径 ${spec}`);
		if (spec.startsWith("@ibm-lab/")) fail(`${rel}: 母包 import 了插件包 ${spec}`);
	}
}

// 3：母包装配文件不得静态登记插件
const patchFile = join(repoRoot, "cordis.patch.yml");
if (existsSync(patchFile) && readFileSync(patchFile, "utf8").includes("@ibm-lab/")) {
	fail("cordis.patch.yml: 母包装配里静态登记了 @ibm-lab/* 插件");
}

// 4：插件 manifest 基线
const pluginsDir = join(repoRoot, "plugins");
const pluginNames = existsSync(pluginsDir)
	? readdirSync(pluginsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
	: [];
if (pluginNames.length === 0) fail("plugins/: 没有任何子插件");
for (const name of pluginNames) {
	const dir = join(pluginsDir, name);
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) { fail(`plugins/${name}: 缺少 package.json`); continue; }
	const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (!String(pkg.name).startsWith("@ibm-lab/")) fail(`plugins/${name}: 包名必须使用 @ibm-lab/ 前缀`);
	if (pkg.private !== true) fail(`plugins/${name}: 必须 private:true`);
	if (pkg.type !== "module") fail(`plugins/${name}: 必须 type:module`);
	if (!pkg.exports?.["."]) fail(`plugins/${name}: 缺少 "." 导出`);
	if (!(pkg.dsh?.bundle?.patch ?? []).some(path => path.endsWith("cordis.patch.yml"))) fail(`plugins/${name}: dsh.bundle.patch 未声明 cordis.patch.yml`);
	const testDir = join(dir, "test");
	if (!existsSync(testDir) || !statSync(testDir).isDirectory()) fail(`plugins/${name}: 缺少 test/`);
}

if (process.argv.includes("--json")) {
	console.log(JSON.stringify({ ok: failures.length === 0, failures, plugins: pluginNames }, null, 2));
} else if (failures.length) {
	console.error(`拆分不变量检查失败（${failures.length} 项）：`);
	for (const row of failures) console.error(" - " + row);
} else {
	console.log(`拆分不变量检查通过：母包零插件依赖，${pluginNames.length} 个插件 manifest 合法（${pluginNames.join(", ")}）`);
}
process.exit(failures.length ? 1 : 0);
