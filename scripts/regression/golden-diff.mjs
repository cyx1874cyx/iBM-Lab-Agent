#!/usr/bin/env node
/**
 * dsh-lab-agent: golden diff across nature-skills commits.
 *
 * The upgrade scaffold for the "升级前后使用相同论文比较结构、证据、引用和PPT
 * 质量" requirement: materialize two commits' trees, run the same collection
 * against each, and diff the structured outputs.
 *
 * Phase 1 ships the catalog-level collection (per-skill manifest version and
 * directory health). Evidence-level collections (paper-card sections,
 * source_map entries, pptx QA counts) plug in here as later cases — each
 * case exports `collect(ctx)` returning JSON-serializable data and
 * `diff(old, new)` returning human-readable difference lines.
 *
 * Usage:
 *   node scripts/regression/golden-diff.mjs --old <sha> --new <sha>
 *   node scripts/regression/golden-diff.mjs --old <sha> --new <sha> --case catalog
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSkillsRoot } from "../../src/skill-catalog.js";
import { COMMIT_SHA_RE } from "../../src/lockfile.js";
import { fetchTree } from "../vendor-fetch.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const USER_REPO = "Yuan1z0825/nature-skills";

function parseArgs(argv) {
	const flags = { old: undefined, next: undefined, case: "catalog" };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--old") flags.old = argv[++i];
		else if (argv[i] === "--new") flags.next = argv[++i];
		else if (argv[i] === "--case") flags.case = argv[++i];
		else if (argv[i] === "--help") {
			console.log("usage: golden-diff.mjs --old <sha> --new <sha> [--case <name>]");
			process.exit(0);
		}
	}
	if (!COMMIT_SHA_RE.test(flags.old ?? "") || !COMMIT_SHA_RE.test(flags.next ?? "")) {
		throw new Error("--old and --new must be full 40-hex commit SHAs");
	}
	return flags;
}

/** Materialize one commit's tree (jsdelivr CDN) into a fresh temp dir. */
async function materialize(sha) {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-golden-"));
	try {
		const tree = join(dir, "tree");
		const result = await fetchTree(USER_REPO, sha, tree, 16);
		if (result.skipped.length > 0) {
			console.warn(`  ! ${sha.slice(0, 12)}: ${result.skipped.length} file(s) unavailable from the CDN (first: ${result.skipped[0].name}); diff proceeds on the available tree`);
		}
		return { dir, tree, sha };
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}

async function collectCatalog(treeRoot) {
	const { skills, diagnostics } = await scanSkillsRoot(join(treeRoot, "skills"));
	return {
		skills: skills
			.map((s) => ({ name: s.name, manifestVersion: s.manifestVersion, missing: s.health.missing }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		diagnostics
	};
}

function diffCatalog(oldData, newData) {
	const lines = [];
	const byName = (data) => new Map(data.skills.map((s) => [s.name, s]));
	const oldMap = byName(oldData);
	const newMap = byName(newData);
	for (const [name, next] of newMap) {
		const prev = oldMap.get(name);
		if (!prev) {
			lines.push(`+ skill added: ${name} (${next.manifestVersion})`);
			continue;
		}
		if (prev.manifestVersion !== next.manifestVersion) {
			lines.push(`~ ${name}: manifest version ${prev.manifestVersion} -> ${next.manifestVersion}`);
		}
		const missingDiff = (prev.missing ?? []).filter((m) => !(next.missing ?? []).includes(m));
		if (missingDiff.length) lines.push(`~ ${name}: fixed missing entries ${missingDiff.join(", ")}`);
	}
	for (const name of oldMap.keys()) {
		if (!newMap.has(name)) lines.push(`- skill removed: ${name}`);
	}
	if (oldData.diagnostics.length !== newData.diagnostics.length) {
		lines.push(`~ diagnostics count ${oldData.diagnostics.length} -> ${newData.diagnostics.length}`);
	}
	return lines;
}

const COLLECTORS = {
	catalog: { collect: collectCatalog, diff: diffCatalog }
};

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	const collector = COLLECTORS[flags.case];
	if (!collector) throw new Error(`unknown case '${flags.case}' (have: ${Object.keys(COLLECTORS).join(", ")})`);

	const oldHandle = await materialize(flags.old);
	const newHandle = await materialize(flags.next);
	try {
		const [oldData, newData] = await Promise.all([
			collector.collect(oldHandle.tree),
			collector.collect(newHandle.tree)
		]);
		const lines = collector.diff(oldData, newData);
		console.log(`golden-diff [${flags.case}] ${oldHandle.sha.slice(0, 12)} -> ${newHandle.sha.slice(0, 12)}`);
		console.log(lines.length === 0 ? "  no differences" : lines.map((l) => `  ${l}`).join("\n"));
		await writeFile(
			join(repoRoot, "golden-diff-report.json"),
			`${JSON.stringify({ case: flags.case, old: oldHandle.sha, new: newHandle.sha, diffs: lines, oldData, newData }, null, 2)}\n`,
			"utf8"
		);
		console.log("report -> golden-diff-report.json");
	} finally {
		await rm(oldHandle.dir, { recursive: true, force: true });
		await rm(newHandle.dir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(`golden-diff failed: ${error.message}`);
	process.exit(1);
});
