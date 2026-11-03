#!/usr/bin/env node
/**
 * 把仓库里的子插件登记进一个 DSH profile（开发/自建部署用）。
 *
 * 做三件事：
 *   1. 把 plugins/<name>/ 复制（默认 junction 链接，可用 --copy 强制复制）到
 *      <home>/profiles/<profile>/node_modules/@ibm-lab/<name>；
 *   2. 在 profile 的 package.json dependencies 里写入 `file:<repo>/plugins/<name>`；
 *      DSH 会把声明了 dsh.bundle.patch 的依赖当作 bundle 自动激活；
 *   3. 移除已停用插件的依赖与目录（--disable a,b），停用不删数据。
 *
 * 幂等：重复执行不改变结果；`--check` 只校验不写入。
 *
 * 用法：
 *   node scripts/register-plugins.mjs --home <dsh-home> [--profile ibm-lab]
 *        [--plugins reagents,knowledge] [--disable polishing] [--copy] [--check]
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, cpSync, rmSync, lstatSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = name => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
const check = argv.includes("--check");
const forceCopy = argv.includes("--copy");

const home = arg("--home");
if (!home) {
	console.error("用法：node scripts/register-plugins.mjs --home <dsh-home> [--profile ibm-lab] [--plugins a,b] [--disable c] [--copy] [--check]");
	process.exit(2);
}
const profileName = arg("--profile") ?? "ibm-lab";
const profileDir = join(resolve(home), "profiles", profileName);
const manifestPath = join(profileDir, "package.json");
if (!existsSync(manifestPath)) {
	console.error(`profile 不存在：${manifestPath}`);
	process.exit(2);
}

const available = readdirSync(join(repoRoot, "plugins"), { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => entry.name)
	.filter(name => existsSync(join(repoRoot, "plugins", name, "package.json")));
const selected = arg("--plugins") ? arg("--plugins").split(",").map(item => item.trim()).filter(Boolean) : available;
const disabled = new Set(arg("--disable") ? arg("--disable").split(",").map(item => item.trim()).filter(Boolean) : []);
for (const name of selected) if (!available.includes(name)) {
	console.error(`未知插件：${name}（可用：${available.join(", ")}）`);
	process.exit(2);
}
const enabled = selected.filter(name => !disabled.has(name));

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.dependencies ??= {};
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : [];
const changes = [];

function packageOf(name) {
	const dir = join(repoRoot, "plugins", name);
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

for (const name of available) {
	const pkgName = packageOf(name).name;
	const target = join(profileDir, "node_modules", ...pkgName.split("/"));
	const wanted = enabled.includes(name);
	if (wanted) {
		const reference = "file:" + join(repoRoot, "plugins", name).replaceAll("\\", "/");
		if (manifest.dependencies[pkgName] !== reference) {
			manifest.dependencies[pkgName] = reference;
			changes.push(`dependency ${pkgName}`);
		}
		// DSH 只激活 manifest.dsh.profile.bundles 里登记的包；只加依赖不会生效。
		if (!bundles.includes(pkgName)) {
			bundles.push(pkgName);
			changes.push(`activate ${pkgName}`);
		}
		if (!existsSync(target)) {
			if (!check) {
				mkdirSync(dirname(target), { recursive: true });
				if (forceCopy) cpSync(join(repoRoot, "plugins", name), target, { recursive: true });
				else symlinkSync(join(repoRoot, "plugins", name), target, process.platform === "win32" ? "junction" : "dir");
			}
			changes.push(`install ${pkgName}`);
		}
	} else if (Object.hasOwn(manifest.dependencies, pkgName) || bundles.includes(pkgName)) {
		delete manifest.dependencies[pkgName];
		const index = bundles.indexOf(pkgName);
		if (index >= 0) bundles.splice(index, 1);
		changes.push(`disable ${pkgName}`);
		if (!check && existsSync(target)) {
			try {
				if (lstatSync(target).isSymbolicLink() || lstatSync(target).isDirectory()) {
					// 只摘除链接/目录本身；插件数据在 $DSH_HOME 其它位置，不受影响。
					rmSync(target, { recursive: !lstatSync(target).isSymbolicLink(), force: true });
				}
			} catch (error) {
				console.warn(`移除 ${target} 失败：${error.message}`);
			}
		}
	}
}

// 包名列表写回 manifest；DSH 用它决定激活哪些 bundle。
manifest.dsh.profile.bundles = bundles;

if (check) {
	if (changes.length) {
		console.error(`插件登记不完整：${changes.join("，")}`);
		process.exit(1);
	}
	console.log(`插件登记一致（${enabled.length} 个启用：${enabled.join(", ")}）`);
	process.exit(0);
}

if (changes.length) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`插件登记完成：${enabled.length} 个启用（${enabled.join(", ") || "无"}）${disabled.size ? `；停用 ${[...disabled].join(", ")}` : ""}`);
console.log(changes.length ? `变更：${changes.join("，")}` : "无变更（已是最新）");
