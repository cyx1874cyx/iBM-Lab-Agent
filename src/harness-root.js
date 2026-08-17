/**
 * dsh-lab-agent: locate the harness installation's node_modules.
 *
 * Shared by dev-link, the harness-pin regression case, and tests. Resolution:
 *  1. $DSH_HARNESS_NODE_MODULES
 *  2. the node_modules dir owning the `dsh` binary on PATH
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function findHarnessNodeModules(env = process.env) {
	if (env.DSH_HARNESS_NODE_MODULES) {
		const fromEnv = resolve(env.DSH_HARNESS_NODE_MODULES);
		if (existsSync(join(fromEnv, "@deepseek-ai", "dsh"))) return fromEnv;
	}
	const bin = spawnSync("which", ["dsh"], { encoding: "utf8" });
	if (bin.status === 0 && bin.stdout.trim()) {
		// .../.npm/_npx/<hash>/node_modules/.bin/dsh → harness node_modules
		const candidate = resolve(dirname(dirname(bin.stdout.trim())));
		if (existsSync(join(candidate, "@deepseek-ai", "dsh"))) return candidate;
	}
	return undefined;
}

/** Read one package's version from a harness node_modules root. */
export function harnessPackageVersion(nodeModules, name) {
	const path = join(nodeModules, ...name.split("/"), "package.json");
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8")).version;
}
