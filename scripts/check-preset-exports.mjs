#!/usr/bin/env node
/**
 * 校验：presets 中所有 dsh-lab-agent/* 工具 loader 挂载都已在「根 package.json」
 * （dsh-lab-agent 插件包本体）的 exports 声明。
 *
 * 注意：desktop/src-tauri/resources/plugin/dsh-lab-agent/package.json 只是
 * prepare-runtime.ps1 从根 package.json 拷贝的生成产物（整树 gitignore），
 * 手工改它会被下一次 prepare-runtime 覆盖——本校验必须以根 package.json 为准。
 *
 * 背景（2026-09-04 rc1 真机事故 ×2）：lab-synthesis-tool 挂入 agent.cordis.yml
 * 但 exports 漏登记 "./synthesis-tool"（resources 副本与安装实例手工补了，
 * 根 package.json 一度仍缺），导致 preset mount 失败 → 模型列表空/
 * 会话历史 Failed to fetch。此脚本把该类漏声明变成构建期报错。
 *
 * 用法：node scripts/check-preset-exports.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, out);
    else if (/\.(cordis\.yml|cordis\.yaml|yml|yaml)$/.test(name)) out.push(full);
  }
  return out;
}

const presetFiles = collectFiles(join(root, "presets")).filter((f) =>
  readFileSync(f, "utf8").includes("dsh-lab-agent/")
);
if (!presetFiles.length) {
  console.log("check-preset-exports: no preset references dsh-lab-agent — nothing to check");
  process.exit(0);
}

// 真源头：根 package.json 即 dsh-lab-agent 插件包（prepare-runtime 据此生成
// resources/plugin/dsh-lab-agent/package.json 与安装副本）。
const pluginPkgPath = join(root, "package.json");
const pluginPkg = JSON.parse(readFileSync(pluginPkgPath, "utf8"));
const declared = new Set(Object.keys(pluginPkg.exports ?? {}));

const referenced = new Set();
for (const file of presetFiles) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/dsh-lab-agent\/([A-Za-z0-9._-]+)/g)) {
    referenced.add({ entry: `./${m[1]}`, file });
  }
}

const missing = [...new Map([...referenced].map((r) => [r.entry, r])).values()]
  .filter((r) => !declared.has(r.entry));

if (missing.length) {
  console.error("check-preset-exports FAILED — preset 挂载了未在 exports 声明的 loader：");
  for (const { entry, file } of missing) {
    console.error(`  ${entry}  (referenced by ${file.replace(root, ".")})`);
    console.error(`    → 请在 ${pluginPkgPath.replace(root, ".")} 的 exports 补：`);
    console.error(`      "${entry}": { "default": "./lib${entry.slice(1)}.js" }`);
  }
  process.exit(1);
}

console.log(
  `check-preset-exports OK: ${referenced.size} preset loader entries (${presetFiles.length} preset files) ⊆ ${pluginPkg.name} exports`
);
