#!/usr/bin/env node
/**
 * 插件包"按包名安装后可加载"冒烟测试。
 *
 * 模拟部署形态：临时 profile 里放 node_modules/@ibm-lab/<name> 链接，
 * 再以**包名**（而不是仓库相对路径）import 每个插件，验证 package.json exports、
 * 入口文件与依赖解析在真实安装布局下成立。
 *
 * 用法：node scripts/smoke-plugin-packages.mjs [--keep]
 */
import { mkdtemp, mkdir, symlink, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");

const pluginDirs = (await readdir(join(repoRoot, "plugins"), { withFileTypes: true }))
	.filter(entry => entry.isDirectory())
	.map(entry => join(repoRoot, "plugins", entry.name));
const plugins = [];
for (const dir of pluginDirs) {
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) continue;
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const patchPath = join(dir, "cordis.patch.yml");
	const patch = existsSync(patchPath) ? await readFile(patchPath, "utf8") : "";
	if (!patch.includes(`'${manifest.name}'`)) {
		console.error(`${manifest.name}: cordis.patch.yml 未用包名装配（缺少 '${manifest.name}'）`);
		process.exit(1);
	}
	plugins.push({ name: manifest.name, dir });
}
if (plugins.length === 0) {
	console.error("没有找到任何插件包");
	process.exit(1);
}

const home = await mkdtemp(join(tmpdir(), "ibm-plugin-smoke-"));
const modules = join(home, "node_modules");
await mkdir(join(modules, "@ibm-lab"), { recursive: true });
const linkType = process.platform === "win32" ? "junction" : "dir";
await symlink(join(repoRoot, "node_modules", "@deepseek-ai"), join(modules, "@deepseek-ai"), linkType);
for (const plugin of plugins) {
	const short = plugin.name.split("/").at(-1);
	await symlink(plugin.dir, join(modules, "@ibm-lab", short), linkType);
}

const runner = join(home, "runner.mjs");
await writeFile(runner, `
const names = ${JSON.stringify(plugins.map(plugin => plugin.name))};
for (const name of names) {
	const module = await import(name);
	const entry = module.default;
	if (typeof entry !== "function") throw new Error(name + ": 默认导出不是类/构造函数");
	const instance = Object.create(entry.prototype);
	console.log("ok", name);
}
`, "utf8");

try {
	const output = execFileSync(process.execPath, [runner], { encoding: "utf8", cwd: home });
	process.stdout.write(output);
	console.log(`插件包冒烟通过：${plugins.length} 个（按包名解析）`);
} catch (error) {
	console.error("插件包冒烟失败：");
	console.error(error.stdout ?? "");
	console.error(error.stderr ?? error.message);
	process.exitCode = 1;
} finally {
	if (keep) console.log(`（已保留临时目录：${home}）`);
	else await rm(home, { recursive: true, force: true });
}
