#!/usr/bin/env node
/**
 * dsh-lab-agent: pin / upgrade the vendored nature-skills commit.
 *
 * The manual upgrade tool. Materializes the pinned commit's tree (tarball
 * from codeload — no git history kept), rescans the skill catalog, recomputes
 * the python lock hash, and rewrites vendor.lock.json plus the in-tree commit
 * marker `.dsh-lab-agent-commit`. Regression results reset to null — record a
 * pass after the suite runs (`node scripts/regression/run.mjs --record-pass`).
 *
 * Usage:
 *   node scripts/pin-vendor.mjs --latest          # pin origin/main HEAD
 *   node scripts/pin-vendor.mjs --sha <40-hex>    # pin an exact commit
 *
 * Note: upgrades first run on a candidate branch, the golden suite must pass,
 * then this tool updates the locked version.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMIT_SHA_RE, createVendorLock } from "../src/lockfile.js";
import { scanSkillsRoot } from "../src/skill-catalog.js";
import { fetchTree } from "./vendor-fetch.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vendor = join(repoRoot, "vendor", "nature-skills");
const REPO_URL = "https://github.com/Yuan1z0825/nature-skills.git";
const USER_REPO = "Yuan1z0825/nature-skills";

function parseArgs(argv) {
	let sha;
	let latest = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--latest") latest = true;
		else if (argv[i] === "--sha") sha = argv[++i];
		else if (argv[i] === "--help") {
			console.log("usage: pin-vendor.mjs --latest | --sha <40-hex>");
			process.exit(0);
		}
	}
	if (!latest && !sha) throw new Error("pass --latest or --sha <40-hex>");
	if (sha && !COMMIT_SHA_RE.test(sha)) throw new Error(`bad commit sha: ${sha}`);
	return { sha, latest };
}

/** Resolve origin/main HEAD via the git smart protocol (single request). */
function resolveLatest() {
	const result = spawnSync("git", ["ls-remote", REPO_URL, "HEAD"], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ls-remote failed: ${result.stderr || result.stdout}`);
	const sha = result.stdout.trim().split(/\s+/)[0];
	if (!COMMIT_SHA_RE.test(sha)) throw new Error(`ls-remote returned unexpected HEAD: ${sha}`);
	return sha;
}

async function pythonLockSha256() {
	const path = join(repoRoot, "python", "requirements.lock");
	const buffer = await readFile(path);
	return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
	const { sha, latest } = parseArgs(process.argv.slice(2));
	const resolved = latest ? resolveLatest() : sha;

	// skip re-download when the tree already matches the target commit
	const markerPath = join(vendor, ".dsh-lab-agent-commit");
	let marker = undefined;
	try {
		marker = (await readFile(markerPath, "utf8")).trim();
	} catch {
		// absent — fetch
	}
	if (marker === resolved) {
		console.log(`vendor tree already at ${resolved.slice(0, 12)}; skipping fetch`);
	} else {
		console.log(`materializing ${resolved.slice(0, 12)} (jsdelivr)`);
		const result = await fetchTree(USER_REPO, resolved, vendor, 16);
		if (result.skipped.length > 0) {
			throw new Error(`pinning requires a COMPLETE tree; ${result.skipped.length} file(s) unavailable from the CDN (first: ${result.skipped[0].name})`);
		}
		if (result.downloaded !== result.files.length || result.bytes !== result.expected) {
			throw new Error(`tree download mismatch (${result.downloaded}/${result.files.length} files, ${result.bytes}/${result.expected} bytes)`);
		}
	}

	const skillsRoot = join(vendor, "skills");
	const { skills, diagnostics } = await scanSkillsRoot(skillsRoot);
	for (const d of diagnostics) console.warn(`  ! ${d.skill}: ${d.error ?? d.missing?.join(", ")}`);

	const lock = createVendorLock({
		repo: REPO_URL,
		pinnedCommit: resolved,
		pinnedAt: new Date().toISOString(),
		license: "Apache-2.0",
		skills,
		pythonDepsSha256: await pythonLockSha256(),
		pythonDepsFile: "requirements.lock"
	});

	await writeFile(join(vendor, ".dsh-lab-agent-commit"), `${resolved}\n`, "utf8");
	await writeFile(join(repoRoot, "vendor.lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
	console.log(`pinned nature-skills @ ${resolved.slice(0, 12)} (${skills.length} skills)`);
	console.log("vendor.lock.json written. Run: node scripts/regression/run.mjs, then --record-pass after the suite passes.");
}

main().catch((error) => {
	console.error(`pin-vendor failed: ${error.message}`);
	process.exit(1);
});

