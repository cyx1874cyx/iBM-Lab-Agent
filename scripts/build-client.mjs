#!/usr/bin/env node
/**
 * dsh-lab-agent client 单文件构建管线（Doc2 客户端工程化，rc1 起步）。
 *
 * 背景：client/index.js 是 2000+ 行手维护的单文件 bundle（React.createElement
 * + 内联 CSS/PNG），由 DSH 以单文件注入（dsh.client.inject）。本脚本：
 *   1. 校验入口仍是单个自包含文件（无 import/export，能单文件注入）；
 *   2. 若安装了 esbuild 则产出压缩/去注释的 dist 单文件（等注入形态）；
 *   3. 未安装 esbuild 时退化为“原样拷贝 + 标记头”，保证任何环境可运行。
 * 后续拆分（CSS 独立、JSX 源、多模块）以本管线为出口，产物保持单文件，
 * 不改变运行时注入路径。
 *
 * 用法：npm run build:client
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, "..", "client");
const entry = join(clientRoot, "index.js");
const outDir = join(clientRoot, "dist");
const outFile = join(outDir, "lab-client.bundle.js");

// 单文件注入约束：入口不得出现顶层 import/export（静态校验）。
const FORBIDDEN_TOP_LEVEL = /^\s*(import\s|export\s)/m;

const source = await readFile(entry, "utf8");
if (FORBIDDEN_TOP_LEVEL.test(source)) {
  console.error(`[build:client] ${entry} 含顶层 import/export，不符合单文件注入约束`);
  process.exit(1);
}
if (source.includes("import(")) {
  console.warn("[build:client] 入口含动态 import()——单文件注入形态下不会被 resolve，请确认其为注释/字符串");
}

await mkdir(outDir, { recursive: true });
let used = "copy-fallback";
let body = source;
try {
  const esbuild = await import("esbuild");
  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: false, // 单文件自包含：不打包依赖（当前无模块依赖）
    minify: true,
    write: false,
    charset: "utf8",
    target: ["chrome110"]
  });
  body = built.outputFiles[0].text;
  used = "esbuild";
} catch {
  body = `/* dsh-lab-agent client bundle — 构建管线回退拷贝（未安装 esbuild）\n * 源：../index.js；请勿手工编辑本产物。\n */\n${source}`;
}
await writeFile(outFile, body, "utf8");
console.log(`[build:client] ${used === "esbuild" ? "esbuild 构建" : "原样拷贝（回退）"} → ${outFile}（${body.length} 字节）`);
