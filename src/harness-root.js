/**
 * dsh-lab-agent: locate the harness installation's node_modules.
 *
 * Shared by dev-link, the harness-pin regression case, and tests. Resolution:
 *  1. $DSH_HARNESS_NODE_MODULES
 *  2. the node_modules dir owning the `dsh` binary on PATH
 *     (`which` on POSIX, `where` on Windows)
 *  3. the tree this plugin itself resolves `@deepseek-ai/dsh` from
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DSH_PACKAGE = join("@deepseek-ai", "dsh");

function isHarnessRoot(dir) {
	return Boolean(dir) && existsSync(join(dir, DSH_PACKAGE));
}

/** PATH lookup. Windows has no `which`; `where` is its counterpart. */
function lookupDshOnPath(env) {
	const command = process.platform === "win32" ? "where" : "which";
	const found = spawnSync(command, ["dsh"], { encoding: "utf8", env });
	if (found.status !== 0 || !found.stdout) return undefined;
	const first = found.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)[0];
	return first || undefined;
}

/**
 * The harness tree this plugin itself resolves `@deepseek-ai/dsh` from.
 * Needed when neither the env var nor PATH yields a `dsh` binary (in-repo
 * development on Windows, where `which` does not exist).
 */
function localHarnessNodeModules() {
	try {
		const require = createRequire(import.meta.url);
		// <node_modules>/@deepseek-ai/dsh/package.json → <node_modules>
		return resolve(dirname(require.resolve(`${DSH_PACKAGE}/package.json`)), "..", "..");
	} catch {
		return undefined;
	}
}

export function findHarnessNodeModules(env = process.env) {
	if (env.DSH_HARNESS_NODE_MODULES) {
		const fromEnv = resolve(env.DSH_HARNESS_NODE_MODULES);
		if (isHarnessRoot(fromEnv)) return fromEnv;
	}
	const binPath = lookupDshOnPath(env);
	if (binPath) {
		// pnpm writes an executable wrapper (not a symlink) at
		// <node_modules>/.bin/dsh. Resolve its adjacent package tree first.
		const adjacent = resolve(dirname(binPath), "..");
		if (isHarnessRoot(adjacent)) return adjacent;
		// npm global shim on Windows: %APPDATA%\npm\dsh.cmd → %APPDATA%\npm\node_modules
		const globalShim = join(dirname(binPath), "node_modules");
		if (isHarnessRoot(globalShim)) return globalShim;
		// npx:   .../node_modules/.bin/dsh → .../node_modules
		// global: ~/.local/bin/dsh → ~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
		try {
			const realBin = realpathSync(binPath);
			const dshPackage = resolve(dirname(realBin), "..");
			const candidate = resolve(dshPackage, "..", "..");
			if (isHarnessRoot(candidate)) return candidate;
		} catch {
			// Unresolvable shim: fall through to the local resolution fallback.
		}
	}
	return localHarnessNodeModules();
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
