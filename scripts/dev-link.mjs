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
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const harnessLock = JSON.parse(await readFile(join(repoRoot, "harness.lock.json"), "utf8"));

function findHarnessNodeModules() {
	if (process.env.DSH_HARNESS_NODE_MODULES) return resolve(process.env.DSH_HARNESS_NODE_MODULES);
	const bin = spawnSync("which", ["dsh"], { encoding: "utf8" });
	if (bin.status === 0 && bin.stdout.trim()) {
		// .../.npm/_npx/<hash>/node_modules/.bin/dsh → harness node_modules
		const cand = resolve(dirname(dirname(bin.stdout.trim())));
		if (existsSync(join(cand, "@deepseek-ai", "dsh"))) return cand;
	}
	return undefined;
}

const harnessRoot = findHarnessNodeModules();
if (!harnessRoot) {
	console.error("dev-link: cannot locate the harness node_modules (set DSH_HARNESS_NODE_MODULES or put dsh on PATH)");
	process.exit(1);
}

const targets = [
	...(await readdir(join(harnessRoot, "@deepseek-ai"))).map((name) => `@deepseek-ai/${name}`),
	"zod",
	"js-yaml",
	"dsh-lab-agent" // self-link so `dsh-lab-agent/*` resolves in tests
];

await mkdir(join(repoRoot, "node_modules", "@deepseek-ai"), { recursive: true });

const check = process.argv.includes("--check");
let failed = false;
for (const name of targets) {
	const link = join(repoRoot, "node_modules", ...name.split("/"));
	const real = name === "dsh-lab-agent" ? repoRoot : join(harnessRoot, ...name.split("/"));
	try {
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
