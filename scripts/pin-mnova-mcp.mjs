#!/usr/bin/env node
/**
 * dsh-lab-agent: pin / refresh the vendored mnova-mcp 0.3.1 component.
 *
 * Materializes the pinned commit's *needed subset* into
 *   vendor/mnova-mcp/  (src + skill/nmr-analyze-simulate + mnova/bridge.qs
 *                       + pyproject.toml + LICENSE + README.md)
 * and writes the component lock
 *   vendor/mnova-mcp.lock.json
 *
 * examples/ (DEGMA raw FID ~12 MB) is intentionally NOT vendored into this
 * repo; real E2E runs against the upstream mnova-mcp checkout itself.
 *
 * No network access at Desktop boot — this is an offline, build-time tool.
 *
 * Usage:
 *   node scripts/pin-mnova-mcp.mjs --sha <40-hex>   # pin an exact commit
 *   node scripts/pin-mnova-mcp.mjs                  # re-verify + refresh from lock's pinnedCommit
 *
 * Forbidden: main / latest / >=0.3.1 — this tool never resolves branches.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchBuffer, fetchJson, TREE_URL } from "./vendor-fetch.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const destDir = join(repoRoot, "vendor", "mnova-mcp");
const lockPath = join(repoRoot, "vendor", "mnova-mcp.lock.json");
const markerPath = join(destDir, ".dsh-lab-agent-commit");

const USER_REPO = "cyx1874cyx/mnova-mcp";
const REPO_URL = "https://github.com/cyx1874cyx/mnova-mcp.git";
const EXPECTED_VERSION = "0.3.1";

/** Paths (repo-root relative, dir prefix allowed) kept in the vendor tree. */
const KEEP_PREFIXES = [
	"src/mnova_mcp/",
	"skill/nmr-analyze-simulate/",
	"mnova/",
	"pyproject.toml",
	"LICENSE",
	"README.md",
	".gitignore"
];

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

function parseArgs(argv) {
	let sha;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--sha") sha = argv[++i];
		else if (argv[i] === "--help") {
			console.log("usage: pin-mnova-mcp.mjs [--sha <40-hex>]");
			process.exit(0);
		}
	}
	return sha;
}

async function readLockedCommit() {
	try {
		const lock = JSON.parse(await readFile(lockPath, "utf8"));
		if (!COMMIT_SHA_RE.test(lock.pinnedCommit)) throw new Error("lock pinnedCommit invalid");
		return lock.pinnedCommit;
	} catch {
		return undefined;
	}
}

/** Fetch the jsdelivr flat tree for a commit. */
async function listTree(sha) {
	const tree = await fetchJson(TREE_URL(USER_REPO, sha));
	return tree.files.filter((f) => f.type !== "directory");
}

/** Keep only paths this repo vendors. jsdelivr flat names start with '/'. */
function selectFiles(files) {
	return files.filter((f) => {
		const name = f.name.startsWith("/") ? f.name.slice(1) : f.name;
		return KEEP_PREFIXES.some((p) => name === p || name.startsWith(p.endsWith("/") ? p : p + "/"));
	});
}

/** sha256 over the sorted list of vendored relative paths (no leading '/'). */
function contentHash(files) {
	const hash = createHash("sha256");
	for (const f of files.map((f) => f.name.replace(/^\//, "")).sort()) {
		hash.update(`${f}\n`);
	}
	return hash.digest("hex");
}

async function main() {
	const argSha = parseArgs(process.argv.slice(2));
	const locked = await readLockedCommit();
	const sha = argSha ?? locked;
	if (!sha) {
		throw new Error("no pinned commit yet — run: node scripts/pin-mnova-mcp.mjs --sha <40-hex>");
	}
	if (!COMMIT_SHA_RE.test(sha)) throw new Error(`bad commit sha: ${sha}`);
	console.log(`mnova-mcp pin target: ${sha.slice(0, 12)} (${USER_REPO})`);

	// 1) resolve the tree (404 => commit unknown / not on GitHub)
	let files;
	try {
		files = await listTree(sha);
	} catch (error) {
		throw new Error(`commit ${sha.slice(0, 12)} not resolvable on jsdelivr: ${error.message}`);
	}
	if (files.length === 0) throw new Error("tree has no files");

	// 2) select + materialize the vendored subset
	const selected = selectFiles(files);
	console.log(`vendoring ${selected.length}/${files.length} files (${sha.slice(0, 12)})`);
	if (!selected.some((f) => f.name === "/src/mnova_mcp/__init__.py" || f.name === "src/mnova_mcp/__init__.py")) {
		throw new Error("vendored subset missing src/mnova_mcp/__init__.py — layout unexpected");
	}

	await rm(destDir, { recursive: true, force: true });
	await mkdir(destDir, { recursive: true });
	for (const file of selected) {
		const rel = file.name.startsWith("/") ? file.name.slice(1) : file.name;
		const target = join(destDir, rel);
		await mkdir(dirname(target), { recursive: true });
		const buffer = await fetchBuffer(`https://cdn.jsdelivr.net/gh/${USER_REPO}@${sha}${file.name}`);
		await writeFile(target, buffer);
	}
	await writeFile(markerPath, `${sha}\n`, "utf8");
	console.log(`materialized -> vendor/mnova-mcp/ (${selected.length} files)`);

	// 3) version gate: pyproject version == 0.3.1
	const pyproject = await readFile(join(destDir, "pyproject.toml"), "utf8");
	const versionMatch = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
	if (!versionMatch || versionMatch[1] !== EXPECTED_VERSION) {
		throw new Error(`pyproject version gate failed: expected ${EXPECTED_VERSION}, got ${versionMatch?.[1] ?? "none"}`);
	}
	console.log(`pyproject version OK: ${EXPECTED_VERSION}`);

	// 4) LICENSE gate (MIT)
	const license = await readFile(join(destDir, "LICENSE"), "utf8");
	if (!/MIT/i.test(license.slice(0, 200))) throw new Error("LICENSE gate failed: not MIT");

	// 5) bridge asset gate
	const bridge = join(destDir, "src", "mnova_mcp", "assets", "bridge.qs");
	try {
		const text = await readFile(bridge, "utf8");
		if (!text.trim()) throw new Error("empty");
	} catch {
		throw new Error("bridge asset gate failed: src/mnova_mcp/assets/bridge.qs missing");
	}
	console.log("bridge.qs OK: src/mnova_mcp/assets/bridge.qs");

	// 6) skill gate
	const skill = join(destDir, "skill", "nmr-analyze-simulate", "SKILL.md");
	try {
		const text = await readFile(skill, "utf8");
		if (!text.trim()) throw new Error("empty");
	} catch {
		throw new Error("skill gate failed: skill/nmr-analyze-simulate/SKILL.md missing");
	}
	console.log("skill OK: skill/nmr-analyze-simulate/SKILL.md");

	// 7) write component lock
	const lock = {
		schema: "dsh-lab-agent/vendor-component-lock/v1",
		name: "mnova-mcp",
		version: EXPECTED_VERSION,
		repo: REPO_URL,
		pinnedCommit: sha,
		pinnedAt: new Date().toISOString(),
		license: "MIT",
		mcpPackage: "mnova-mcp",
		skill: "skill/nmr-analyze-simulate",
		vendoredFileCount: selected.length,
		contentHash: contentHash(selected)
	};
	await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
	console.log(`lock written: vendor/mnova-mcp.lock.json (${sha.slice(0, 12)}, ${selected.length} files)`);
}

main().catch((error) => {
	console.error(`pin-mnova-mcp failed: ${error.message}`);
	process.exit(1);
});
