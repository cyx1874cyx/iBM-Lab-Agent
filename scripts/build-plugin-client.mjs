#!/usr/bin/env node
/**
 * 子插件客户端 bundle 构建（与 scripts/build-client.mjs 同一契约，入口与 id 不同）。
 *
 * 每个子插件在自己的目录里产出 `client/index.js`：
 *   window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { ... } });
 * React / ReactDOM 保持 external，由宿主 factory 的 require 解析。
 *
 * 构建期只允许通过 `dsh-lab-agent/client-sdk` 复用母包的纯前端基建；
 * 其它 `dsh-lab-agent/*` 导入一律拒绝，防止插件又悄悄耦合母包内部实现。
 *
 * 用法：node scripts/build-plugin-client.mjs --plugin plugins/reagents [--check]
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pdfDocumentStatePlugin } from "./pdfjs-document-state.mjs";
import { pdfViewerStylePlugin } from "./pdfjs-viewer-style.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const argv = process.argv.slice(2);
const at = argv.indexOf("--plugin");
const pluginDir = resolve(repoRoot, at >= 0 ? argv[at + 1] : "plugins/reagents");
const checkOnly = argv.includes("--check");

const pkg = JSON.parse(await readFile(join(pluginDir, "package.json"), "utf8"));
const id = pkg.name;
if (typeof id !== "string" || id.length === 0) throw new Error(`${pluginDir}/package.json 缺少 name`);

/**
 * 母包公开导出面就是插件的 SDK 契约：package.json 的 exports 键（含 * 模式）。
 * 不在其中的 `dsh-lab-agent/...` 一律拒绝，避免插件又悄悄耦合母包内部实现。
 */
const motherPkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const motherExports = Object.keys(motherPkg.exports ?? {});
function isPublicSpecifier(specifier) {
	const subpath = "." + specifier.slice("dsh-lab-agent".length);
	return motherExports.some(key => {
		if (key === subpath) return true;
		if (!key.includes("*")) return false;
		const pattern = "^" + key.replace(/[.+?^${}()|[\]\\*]/g, "\\$&").replace(/\\\*/g, "(.+)") + "$";
		return new RegExp(pattern).test(subpath);
	});
}
function resolvePublicSpecifier(specifier) {
	const subpath = "." + specifier.slice("dsh-lab-agent".length);
	for (const [key, value] of Object.entries(motherPkg.exports ?? {})) {
		const target = typeof value === "string" ? value : value?.default;
		if (typeof target !== "string") continue;
		if (key === subpath) return join(repoRoot, target.replace(/^\.\//, ""));
		if (key.includes("*")) {
			const source = key.replace(/[.+?^${}()|[\]\\*]/g, "\\$&").replace(/\\\*/g, "(.+)");
			const match = new RegExp("^" + source + "$").exec(subpath);
			if (match) return join(repoRoot, target.replace(/^\.\//, "").replace("*", match[1]));
		}
	}
	return undefined;
}

const entry = join(pluginDir, "client", "src", "entry.js");
const runtimeEntry = join(pluginDir, "client", "index.js");

const BANNER = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`;
const FOOTER = `exports.apply = apply; exports.inject = inject; return module.exports; } });`;

const esbuild = await import("esbuild").catch((error) => {
	throw new Error(`esbuild 不可用：${error?.message ?? error}`);
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
	alias: { "dsh-lab-agent/client-sdk": join(repoRoot, "client", "src", "sdk.js") },
	plugins: [{
		name: "plugin-isolation",
		setup(build) {
			build.onResolve({ filter: /^dsh-lab-agent(\/|$)/ }, args => {
				const target = resolvePublicSpecifier(args.path);
				if (target !== undefined) return { path: target };
				return { errors: [{ text: `子插件不得导入母包内部实现：${args.path}（只允许 package.json exports 里的公开导出）` }] };
			});
		}
	}, pdfDocumentStatePlugin(), pdfViewerStylePlugin(), {
		name: "pdf-worker-source",
		setup(build) {
			build.onLoad({ filter: /pdf\.worker\.mjs$/ }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
		}
	}],
	banner: { js: BANNER },
	footer: { js: FOOTER }
});

const body = built.outputFiles?.[0]?.text;
if (!body) throw new Error("esbuild 未返回插件客户端产物");
const registrations = body.match(/__ModuleLoader__\.load\s*\(/g) ?? [];
if (registrations.length !== 1 || !body.includes(`id: ${JSON.stringify(id)}`) || !body.includes("return module.exports")) {
	throw new Error(`插件客户端产物不符合单文件注册契约（registrations=${registrations.length}, id=${id}）`);
}

if (checkOnly) {
	const current = await readFile(runtimeEntry, "utf8");
	if (current.replace(/\r\n/g, "\n") !== body.replace(/\r\n/g, "\n")) {
		throw new Error(`${runtimeEntry} 与 client/src 不一致；请先运行本脚本重建`);
	}
	console.log(`[build-plugin-client] ${id} 一致性检查通过（${body.length} 字节）`);
} else {
	await mkdir(dirname(runtimeEntry), { recursive: true });
	const pending = runtimeEntry + "." + process.pid + ".tmp";
	await writeFile(pending, body, "utf8");
	await rename(pending, runtimeEntry);
	console.log(`[build-plugin-client] ${id} → ${runtimeEntry}（${body.length} 字节）`);
}
