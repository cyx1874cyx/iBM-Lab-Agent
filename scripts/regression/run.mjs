#!/usr/bin/env node
/**
 * dsh-lab-agent: regression runner.
 *
 * Discovers cases in tests/regression/cases/*.mjs, runs them against the
 * pinned vendor tree + locks, prints a PASS/FAIL/SKIP table. Cases declare
 * `required` resources (vendor / harness / python / registry); unavailable
 * resources SKIP the case rather than failing.
 *
 * Usage:
 *   node scripts/regression/run.mjs                    # all cases
 *   node scripts/regression/run.mjs --case catalog     # one case
 *   node scripts/regression/run.mjs --tag nature       # filter by tag
 *   node scripts/regression/run.mjs --record-pass      # mark the pinned
 *                                                      # versions regression-
 *                                                      # passed (only when
 *                                                      # everything passed)
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readVendorLock, readHarnessLock, writeVendorLock } from "../../src/lockfile.js";
import { scanSkillsRoot } from "../../src/skill-catalog.js";
import { bootLite } from "../../tests/helpers/boot-lite.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const casesDir = join(repoRoot, "tests", "regression", "cases");

export async function loadLock() {
	return {
		vendor: await readVendorLock(join(repoRoot, "vendor.lock.json")),
		harness: await readHarnessLock(join(repoRoot, "harness.lock.json"))
	};
}

/** Boot a throwaway registry over a temp store (used by `registry` cases). */
export async function withTempRegistry(vendorDir, lockFile, fn) {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir,
		lockFile,
		includePython: false
	});
	try {
		return await fn(handle.ctx.labVersions);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
}

function parseArgs(argv) {
	const flags = { case: undefined, tag: undefined, recordPass: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--case") flags.case = argv[++i];
		else if (argv[i] === "--tag") flags.tag = argv[++i];
		else if (argv[i] === "--record-pass") flags.recordPass = true;
		else if (argv[i] === "--help") {
			console.log("usage: run.mjs [--case <name>] [--tag <tag>] [--record-pass]");
			process.exit(0);
		}
	}
	return flags;
}

async function collectCases() {
	const files = (await readdir(casesDir)).filter((f) => f.endsWith(".mjs")).sort();
	const cases = [];
	for (const file of files) {
		const mod = await import(pathToFileURL(join(casesDir, file)).href);
		cases.push(mod.default);
	}
	return cases;
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	const { vendor, harness } = await loadLock();
	const vendorRoot = join(repoRoot, "vendor", "nature-skills");
	const skillsRoot = join(vendorRoot, "skills");

	const ctx = {
		repoRoot,
		vendorRoot,
		skillsRoot,
		vendorLock: vendor,
		harnessLock: harness,
		scanned: undefined, // lazy: { skills, diagnostics }
		async scan() {
			if (this.scanned === undefined) this.scanned = await scanSkillsRoot(skillsRoot);
			return this.scanned;
		},
		withTempRegistry(fn) {
			return withTempRegistry(join(vendorRoot), join(repoRoot, "vendor.lock.json"), fn);
		},
		resources: {
			vendor: true, // repo vendor tree always present post-pin
			harness: true,
			python: false
		}
	};

	let cases = await collectCases();
	if (flags.case) cases = cases.filter((c) => c.name === flags.case);
	if (flags.tag) cases = cases.filter((c) => c.tags.includes(flags.tag));
	if (cases.length === 0) {
		console.error(`no cases match (case=${flags.case}, tag=${flags.tag})`);
		process.exit(2);
	}

	const results = [];
	for (const c of cases) {
		const missing = (c.required ?? []).filter((r) => !ctx.resources[r]);
		if (missing.length > 0) {
			results.push({ name: c.name, status: "SKIP", reason: `requires: ${missing.join(", ")}` });
			continue;
		}
		try {
			const outcome = await c.run(ctx);
			results.push({ name: c.name, status: outcome.pass ? "PASS" : "FAIL", reason: outcome.details ?? "" });
		} catch (error) {
			results.push({ name: c.name, status: "FAIL", reason: error.message });
		}
	}

	let width = Math.max(...results.map((r) => r.name.length)) + 2;
	console.log(`\n${"case".padEnd(width)}status  details`);
	console.log("-".repeat(width + 60));
	for (const r of results) {
		console.log(`${r.name.padEnd(width)}${r.status.padEnd(7)}${r.reason}`);
	}
	const failed = results.filter((r) => r.status === "FAIL");
	const skipped = results.filter((r) => r.status === "SKIP");
	console.log(`\n${results.length - failed.length - skipped.length}/${results.length} passed, ${failed.length} failed, ${skipped.length} skipped`);

	if (failed.length === 0 && flags.recordPass) {
		await ctx.withTempRegistry(async (labVersions) => {
			await labVersions.bootstrapFromVendor();
			const n = await labVersions.markRegressionPassed();
			console.log(`registry marked regression-passed for ${n} skill version rows`);
		});
		const now = new Date().toISOString();
		const next = {
			...vendor,
			regression: { lastPassedAt: now, lastRunAt: now, caseCount: results.filter((r) => r.status === "PASS").length }
		};
		await writeVendorLock(join(repoRoot, "vendor.lock.json"), next);
		console.log("vendor.lock.json regression facts updated (repo). Deploy copy refreshes on next install.");
	}

	process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error(`regression run failed: ${error.message}`);
	process.exit(1);
});
