#!/usr/bin/env node
/**
 * dsh-lab-agent client 单文件构建管线（Doc2 客户端工程化，rc1 起步；0.4.1 模块化）。
 *
 * 背景：client/index.js 是 DSH 以单文件注入（dsh.client.inject）的入口，
 * 契约是 `window.__ModuleLoader__.load({ id:"dsh-lab-agent", factory:(require)=>{...} })`。
 * 0.4.1 起源文件拆分为 client/src/*.js 多模块（组件/常量/工具分层），由本管线
 * 用 esbuild 重新 bundle 回单文件，保持运行时注入路径与导出契约不变。
 *
 * 打包策略：
 *   1. 入口 client/src/entry.js（顶层副作用注入 CSS + re-export apply/inject）；
 *   2. esbuild bundle:true + format:"cjs" + platform:"browser"，
 *      external:["react","react-dom"]（由 DSH factory 的 require 参数在运行时解析）；
 *   3. banner 注入 __ModuleLoader__.load(...) 开头 + factory 函数体头部
 *      （var module/exports + Symbol.toStringTag，与原手写包裹一致）；
 *   4. footer 注入 `exports.apply=apply; exports.inject=inject; return module.exports;`
 *      与 factory 收尾，闭合 load 调用。
 *   5. 产物写回 client/index.js（运行时入口），并另存 dist/lab-client.bundle.js。
 *
 * esbuild 缺失或编译失败时直接失败，禁止把旧 client/index.js 当作新产物发布。
 *
 * 用法：npm run build:client
 */

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, "..", "client");
const entry = join(clientRoot, "src", "entry.js");
const runtimeEntry = join(clientRoot, "index.js");
const outDir = join(clientRoot, "dist");
const outFile = join(outDir, "lab-client.bundle.js");

// factory 包裹的 banner / footer：把 esbuild 的 CJS 输出闭包进
// `window.__ModuleLoader__.load({ ... factory:(require)=>{ ... } })`。
const BANNER = `window.__ModuleLoader__.load({ id: "dsh-lab-agent", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`;
const FOOTER = `exports.apply = apply; exports.inject = inject; return module.exports; } });`;

const checkOnly = process.argv.slice(2).includes("--check");
const esbuild = await import("esbuild").catch((error) => {
  throw new Error(`esbuild 不可用，拒绝复用旧客户端产物：${error?.message ?? error}`);
});
const built = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "cjs",
  platform: "browser",
  external: ["react", "react-dom"],
  write: false,
  minify: false,
  charset: "utf8",
  target: ["chrome110"],
  banner: { js: BANNER },
  footer: { js: FOOTER },
});
const body = built.outputFiles?.[0]?.text;
if (!body) throw new Error("esbuild 未返回客户端产物");
const registrations = body.match(/__ModuleLoader__\.load\s*\(/g) ?? [];
if (registrations.length !== 1 || !body.includes('id: "dsh-lab-agent"') || !body.includes("return module.exports")) {
  throw new Error(`客户端产物不符合 DSH 单文件注册契约（registrations=${registrations.length}）`);
}

if (checkOnly) {
  const current = await readFile(runtimeEntry, "utf8");
  const normalizeEol = (value) => value.replace(/\r\n/g, "\n");
  if (normalizeEol(current) !== normalizeEol(body)) {
    throw new Error("client/index.js 与 client/src 不一致；请先运行 npm run build:client 并提交生成产物");
  }
  console.log(`[build:client] 一致性检查通过 → ${runtimeEntry}（${body.length} 字节）`);
} else {
  await mkdir(outDir, { recursive: true });
  await writeFile(runtimeEntry, body, "utf8");
  await copyFile(runtimeEntry, outFile);
  console.log(`[build:client] esbuild 构建（多模块 → 单文件）→ ${runtimeEntry}（${body.length} 字节）→ ${outFile}`);
}
