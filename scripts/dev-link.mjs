#!/usr/bin/env node
/**
 * dsh-lab-agent: dev dependency linker.
 *
 * Creates symlinks under ./node_modules so unit/integration tests and the
 * install/regression scripts can import the pinned harness packages (and the
 * plugin itself) without publishing anything. Resolves the harness install
 * from $DSH_HARNESS_NODE_MODULES, else from the `dsh` binary on PATH.
 *
 * Usage: node scripts/dev-link.mjs [--check]
 */

import { mkdir, readdir, rm, symlink, access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findHarnessNodeModules, harnessPackagePath } from "../src/harness-root.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const harnessLock = JSON.parse(await readFile(join(repoRoot, "harness.lock.json"), "utf8"));

const harnessRoot = findHarnessNodeModules();
if (!harnessRoot) {
	console.error("dev-link: cannot locate the harness node_modules (set DSH_HARNESS_NODE_MODULES or put dsh on PATH)");
	process.exit(1);
}

const dshPackageRoot = harnessPackagePath(harnessRoot, "@deepseek-ai/dsh");
const scopes = [join(harnessRoot, "@deepseek-ai"), join(dshPackageRoot, "node_modules", "@deepseek-ai")];
const deepseekPackages = new Set();
for (const scope of scopes) {
	if (!existsSync(scope)) continue;
	for (const name of await readdir(scope)) deepseekPackages.add(`@deepseek-ai/${name}`);
}
const targets = [
	...deepseekPackages,
	"zod",
	"js-yaml",
	"dsh-lab-agent" // self-link so `dsh-lab-agent/*` resolves in tests
];

await mkdir(join(repoRoot, "node_modules", "@deepseek-ai"), { recursive: true });

const check = process.argv.includes("--check");
let failed = false;
for (const name of targets) {
	const link = join(repoRoot, "node_modules", ...name.split("/"));
	const real = name === "dsh-lab-agent" ? repoRoot : harnessPackagePath(harnessRoot, name);
	try {
		if (!real) throw new Error("missing");
		await access(real);
	} catch {
		console.error(`dev-link: source missing in harness install: ${real}`);
		failed = true;
		continue;
	}
	if (existsSync(link) || (await access(link).then(() => true).catch(() => false))) {
		if (check) continue;
		await rm(link, { recursive: true, force: true });
	}
	if (check) {
		console.error(`dev-link: missing link: ${link}`);
		failed = true;
		continue;
	}
	await symlink(real, link, process.platform === "win32" ? "junction" : "dir");
	console.log(`linked ${name}`);
}

if (check) {
	const leftover = (await readdir(join(repoRoot, "node_modules", "@deepseek-ai"))).filter((n) => !targets.some((t) => t.endsWith(`/${n}`)) && n !== ".");
	for (const n of leftover) console.warn(`dev-link: unexpected @deepseek-ai/${n} present (not ours)`);
}
process.exit(failed ? 1 : 0);
