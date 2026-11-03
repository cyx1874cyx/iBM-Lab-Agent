#!/usr/bin/env node
/**
 * 一次重建所有含前端入口的子插件 bundle。
 *
 * 为什么需要：SDK 或共享 UI 套件变动后，每个插件的产物都会过期；
 * `verify-plugins` 会逐个判定不一致，手工一个个跑容易漏。
 *
 * 用法：node scripts/build-plugin-clients.mjs [--check]
 */
import { readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const check = process.argv.includes("--check");

const plugins = readdirSync(join(repoRoot, "plugins"), { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => join(repoRoot, "plugins", entry.name))
	.filter(dir => existsSync(join(dir, "client", "src", "entry.js")));

if (plugins.length === 0) {
	console.log("没有需要构建前端 bundle 的插件");
	process.exit(0);
}

for (const dir of plugins) {
	const args = [join(repoRoot, "scripts/build-plugin-client.mjs"), "--plugin", dir];
	if (check) args.push("--check");
	execFileSync(process.execPath, args, { stdio: "inherit", cwd: repoRoot });
}
console.log(`插件前端 bundle ${check ? "一致性检查" : "构建"}完成：${plugins.length} 个`);
