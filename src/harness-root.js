/**
 * dsh-lab-agent: locate the harness installation's node_modules.
 *
 * Shared by dev-link, the harness-pin regression case, and tests. Resolution:
 *  1. $DSH_HARNESS_NODE_MODULES
 *  2. the node_modules dir owning the `dsh` binary on PATH
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function findHarnessNodeModules(env = process.env) {
	if (env.DSH_HARNESS_NODE_MODULES) {
		const fromEnv = resolve(env.DSH_HARNESS_NODE_MODULES);
		if (existsSync(join(fromEnv, "@deepseek-ai", "dsh"))) return fromEnv;
	}
	const bin = spawnSync("which", ["dsh"], { encoding: "utf8", env });
	if (bin.status === 0 && bin.stdout.trim()) {
		// npx:   .../node_modules/.bin/dsh → .../node_modules
		// global: ~/.local/bin/dsh → ~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
		const realBin = realpathSync(bin.stdout.trim());
		const dshPackage = resolve(dirname(realBin), "..");
		const candidate = resolve(dshPackage, "..", "..");
		if (existsSync(join(candidate, "@deepseek-ai", "dsh"))) return candidate;
	}
	return undefined;
}

/** Resolve a package from either a flat npx tree or npm's global nested tree. */
export function harnessPackagePath(nodeModules, name) {
	const relative = name.split("/");
	const direct = join(nodeModules, ...relative);
	if (existsSync(join(direct, "package.json"))) return direct;
	const nested = join(nodeModules, "@deepseek-ai", "dsh", "node_modules", ...relative);
	if (existsSync(join(nested, "package.json"))) return nested;
	return undefined;
}

/** Read one package's version from a harness node_modules root. */
export function harnessPackageVersion(nodeModules, name) {
	const packageRoot = harnessPackagePath(nodeModules, name);
	if (!packageRoot) return undefined;
	const path = join(packageRoot, "package.json");
	return JSON.parse(readFileSync(path, "utf8")).version;
}
