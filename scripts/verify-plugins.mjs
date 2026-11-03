#!/usr/bin/env node
/**
 * 子插件体检：把一个插件包"可独立装配"的条件固化成可执行断言。
 *
 * 检查项（每个 plugins/<name>/ 一份）：
 *   1. package.json：私有包、ESM、"." 导出、dsh.bundle.patch 指向 cordis.patch.yml
 *   2. 宿主入口 lib/index.js 存在，且默认导出可实例化（静态检查 default export）
 *   3. cordis.patch.yml 存在且含 `- insert:` 行
 *   4. 前端（可选）：有 client/src/entry.js 时，client/index.js 必须存在且与源码一致
 *   5. 独立性：lib/、src/、client/src/ 里不得 import 母包内部实现，
 *      只允许 `dsh-lab-agent/client-sdk`
 *   6. 测试：test/ 或 tests/ 下至少一个 *.test.mjs
 *
 * 用法：node scripts/verify-plugins.mjs [--plugin plugins/reagents]
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const only = (() => {
	const at = process.argv.indexOf("--plugin");
	return at >= 0 ? [resolve(repoRoot, process.argv[at + 1])] : null;
})();

const pluginDirs = only ?? readdirSync(join(repoRoot, "plugins"), { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => join(repoRoot, "plugins", entry.name));

const failures = [];
const fail = (plugin, message) => failures.push(`${plugin}: ${message}`);

/**
 * 母包"公开导出面"= 插件唯一允许的依赖方向。
 * package.json 的 exports 键（含 * 模式）就是 SDK 契约；不在其中的一律视为内部实现。
 */
const motherExports = Object.keys(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).exports ?? {});
function isPublicSpecifier(specifier) {
	if (!specifier.startsWith("dsh-lab-agent")) return true;
	const subpath = "." + specifier.slice("dsh-lab-agent".length);
	return motherExports.some(key => {
		if (key === subpath) return true;
		if (!key.includes("*")) return false;
		const pattern = "^" + key.replace(/[.+?^${}()|[\]\\*]/g, "\\$&").replace(/\\\*/g, "(.+)") + "$";
		return new RegExp(pattern).test(subpath);
	});
}

function walk(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (["node_modules", "dist"].includes(entry.name)) continue;
			walk(full, out);
		} else if (/\.(m?js|cjs)$/.test(entry.name)) out.push(full);
	}
	return out;
}

for (const dir of pluginDirs) {
	const label = dir.slice(repoRoot.length + 1).replaceAll("\\", "/");
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) { fail(label, "缺少 package.json"); continue; }
	const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));

	if (pkg.private !== true) fail(label, "package.json 必须 private:true");
	if (pkg.type !== "module") fail(label, 'package.json 必须 type:"module"');
	if (!pkg.exports?.["."]) fail(label, 'package.json 缺少 "." 导出');
	const patches = pkg.dsh?.bundle?.patch ?? [];
	if (!patches.some(path => path.endsWith("cordis.patch.yml"))) fail(label, "dsh.bundle.patch 未声明 cordis.patch.yml");

	const patchPath = join(dir, "cordis.patch.yml");
	if (!existsSync(patchPath)) fail(label, "缺少 cordis.patch.yml");
	else if (!/^-\s*insert:/m.test(readFileSync(patchPath, "utf8"))) fail(label, "cordis.patch.yml 缺少 `- insert:` 行");

	const entryPath = join(dir, "lib", "index.js");
	if (!existsSync(entryPath)) fail(label, "缺少 lib/index.js");
	else {
		const source = readFileSync(entryPath, "utf8");
		if (!/export\s+default/.test(source) && !/export\s*\{[^}]*default/.test(source)) fail(label, "lib/index.js 未导出默认 Service");
	}

	const clientEntry = join(dir, "client", "src", "entry.js");
	const clientBundle = join(dir, "client", "index.js");
	if (existsSync(clientEntry)) {
		if (!existsSync(clientBundle)) fail(label, "有 client/src/entry.js 但缺少构建产物 client/index.js");
		else {
			try {
				execFileSync(process.execPath, [join(repoRoot, "scripts/build-plugin-client.mjs"), "--plugin", dir, "--check"], { stdio: "pipe" });
			} catch (error) {
				fail(label, `client/index.js 与源码不一致：${String(error.stderr ?? error.message).trim().split("\n").at(-1)}`);
			}
			if (!pkg.exports?.["./client"]) fail(label, '有前端入口但 package.json 缺少 "./client" 导出');
			if (!pkg.dsh?.client) fail(label, "有前端入口但 package.json 缺少 dsh.client（inject/platform）");
			else {
				// 与 DSH client-modules 的声明校验保持一致：platform 必填字符串、inject 为字符串数组。
				if (typeof pkg.dsh.client.platform !== "string") fail(label, "dsh.client.platform 必须是字符串");
				if (pkg.dsh.client.platform !== "web") fail(label, `dsh.client.platform 应为 "web"（当前 ${pkg.dsh.client.platform}）`);
				if (pkg.dsh.client.inject !== undefined && (!Array.isArray(pkg.dsh.client.inject) || pkg.dsh.client.inject.some(item => typeof item !== "string"))) fail(label, "dsh.client.inject 必须是字符串数组");
				for (const dependency of pkg.dsh.client.inject ?? []) {
					if (!existsSync(join(repoRoot, "node_modules", ...dependency.split("/")))) fail(label, `dsh.client.inject 引用了未安装的包 ${dependency}`);
				}
			}
			if (existsSync(clientBundle)) {
				const code = readFileSync(clientBundle, "utf8");
				if (!code.includes(`id: ${JSON.stringify(pkg.name)}`)) fail(label, `client bundle 的 __ModuleLoader__ id 必须等于包名 ${pkg.name}`);
				if (!code.includes("exports.apply = apply")) fail(label, "client bundle 未导出 apply");
				if (!code.includes("exports.inject = inject")) fail(label, "client bundle 未导出 inject");
			}
		}
	}

	for (const file of [...(existsSync(join(dir, "lib")) ? walk(join(dir, "lib")) : []), ...(existsSync(join(dir, "src")) ? walk(join(dir, "src")) : []), ...(existsSync(join(dir, "client", "src")) ? walk(join(dir, "client", "src")) : [])]) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(/from\s+["'](dsh-lab-agent[^"']*)["']/g)) {
			if (!isPublicSpecifier(match[1])) {
				fail(label, `导入了母包内部实现 ${match[1]}（${file.slice(dir.length + 1)}）`);
			}
		}
	}

	const testDir = existsSync(join(dir, "test")) ? join(dir, "test") : existsSync(join(dir, "tests")) ? join(dir, "tests") : null;
	if (!testDir) fail(label, "缺少 test/ 目录");
	else if (!readdirSync(testDir).some(name => name.endsWith(".test.mjs"))) fail(label, "test/ 下没有 *.test.mjs");

	console.log(`checked ${label} (${pkg.name})`);
}

if (failures.length) {
	console.error(`\n插件体检失败 ${failures.length} 项：`);
	for (const row of failures) console.error(` - ${row}`);
	process.exit(1);
}
console.log(`\n插件体检通过：${pluginDirs.length} 个插件`);
