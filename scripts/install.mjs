#!/usr/bin/env node
/**
 * dsh-lab-agent: deployment installer.
 *
 * Materializes the pinned nature-skills tree, lock files, the lab-research
 * agent preset, the NatureSkillVersion registry, and (optionally) the Python
 * venv under the deployment data dir:
 *
 *   $DSH_HOME/lab-agent/{vendor/nature-skills, vendor.lock.json, requirements.lock, .venv}
 *   $DSH_HOME/.agent-presets/lab-research/
 *   $DSH_HOME/storages/...            (registry rows via the domain store)
 *
 * Prereq: `node scripts/dev-link.mjs` once (resolves harness packages), and a
 * pinned vendor tree (scripts/pin-vendor.mjs).
 *
 * Usage:
 *   node scripts/install.mjs [--skip-python] [--force-preset] [--force-vendor]
 *                            [--strict] [--dsh-home <path>]
 */

import { cp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	resolveDshHome,
	layoutSummary,
	natureSkillsDir,
	vendorLockPath,
	requirementsLockPath,
	venvDir
} from "../src/paths.js";
import { readVendorLock, writeVendorLock } from "../src/lockfile.js";
import { bootLite } from "../tests/helpers/boot-lite.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);

/** Office 真实分页预览是产品硬依赖；安装时缺失即失败，不启用近似预览。 */
async function assertOfficePreviewRuntime() {
	const renderer = process.env.LAB_OFFICE_RENDERER || "soffice";
	try {
		const { stdout } = await execFileAsync(renderer, ["--headless", "--version"], { timeout: 15000, windowsHide: true });
		console.log(`Office preview renderer ready: ${(stdout || renderer).trim()}`);
	} catch (error) {
		throw new Error(`Office preview runtime is required but unavailable (${renderer}). Package the dependencies listed in runtime/apt-packages.txt before installing. ${error.message}`);
	}
}

function parseArgs(argv) {
	const flags = new Set();
	let dshHome;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dsh-home") dshHome = argv[++i];
		else flags.add(arg);
	}
	return { flags, dshHome };
}

const { flags, dshHome } = parseArgs(process.argv.slice(2));
const dsh = dshHome ? resolve(dshHome) : resolveDshHome();
const layout = layoutSummary(dsh);

/** Verify the repo vendor tree matches the pinned lock; error otherwise. */
async function verifyRepoVendor(lock) {
	const marker = join(repoRoot, "vendor", "nature-skills", ".dsh-lab-agent-commit");
	if (!existsSync(marker)) {
		throw new Error(
			"repo vendor tree missing or unpinned — run: node scripts/pin-vendor.mjs (network needed once)"
		);
	}
	const head = (await readFile(marker, "utf8")).trim();
	if (head !== lock.pinnedCommit) {
		throw new Error(
			`repo vendor marker ${head.slice(0, 12)} does not match vendor.lock.json pinnedCommit ${lock.pinnedCommit.slice(0, 12)} — run: node scripts/pin-vendor.mjs`
		);
	}
}

/** Recursive copy of the vendored tree, skipping VCS metadata. */
async function syncVendorTree(lock) {
	const src = join(repoRoot, "vendor", "nature-skills");
	const dest = natureSkillsDir(dsh);
	const marker = join(dest, "..", ".nature-skills.commit");
	const markerOk = existsSync(marker) && (await readFile(marker, "utf8")).trim() === lock.pinnedCommit;
	if (markerOk && !flags.has("--force-vendor")) {
		console.log(`vendor tree up to date (${lock.pinnedCommit.slice(0, 12)})`);
		return;
	}
	if (flags.has("--force-vendor") && existsSync(dest)) await rm(dest, { recursive: true, force: true });
	await mkdir(dirname(dest), { recursive: true });
	await cp(src, dest, {
		recursive: true,
		force: true,
		filter: (path) => !path.split(sep).includes(".git")
	});
	await writeFile(marker, `${lock.pinnedCommit}\n`, "utf8");
	console.log(`vendor tree synced -> ${dest}`);
}

async function installPreset() {
	const presetDir = join(dsh, ".agent-presets", "lab-research");
	if (existsSync(presetDir) && !flags.has("--force-preset")) {
		console.log(`preset already installed (${presetDir}); use --force-preset to replace`);
		return;
	}
	if (flags.has("--force-preset")) await rm(presetDir, { recursive: true, force: true });
	await mkdir(dirname(presetDir), { recursive: true });
	await cp(join(repoRoot, "presets", "lab-research"), presetDir, { recursive: true });
	console.log(`preset installed -> ${presetDir}`);
}

async function bootstrapRegistry(lock) {
	const storageRoot = join(dsh, "storages");
	const handle = await bootLite({
		storageRoot,
		vendorDir: natureSkillsDir(dsh),
		lockFile: vendorLockPath(dsh),
		includePython: false
	});
	try {
		const result = await handle.ctx.labVersions.bootstrapFromVendor();
		console.log(`registry bootstrapped: ${result.registered.length} skill versions registered`);
		for (const r of result.registered) {
			console.log(`  - ${r.skillName}@${r.commitSha.slice(0, 12)} manifest=${r.manifestVersion} license=${r.license}`);
		}
		for (const diag of result.diagnostics) console.warn(`  ! ${diag.skill}: ${diag.error ?? diag.missing?.join(", ")}`);
		return result;
	} finally {
		await handle.dispose();
	}
}

async function bootstrapPython() {
	const handle = await bootLite({
		storageRoot: join(dsh, "storages"),
		vendorDir: natureSkillsDir(dsh),
		lockFile: vendorLockPath(dsh),
		venvDir: venvDir(dsh),
		requirementsLock: requirementsLockPath(dsh),
		includePython: true
	});
	try {
		const result = await handle.ctx.labPython.bootstrap();
		const version = await handle.ctx.labPython.pythonVersion();
		console.log(`python venv ready: ${result.python} (${version})`);
		return result;
	} finally {
		await handle.dispose();
	}
}

async function main() {
	console.log(`dsh-lab-agent install -> DSH_HOME=${dsh}`);
	await assertOfficePreviewRuntime();
	const lock = await readVendorLock(join(repoRoot, "vendor.lock.json"));
	await verifyRepoVendor(lock);

	await mkdir(dirname(vendorLockPath(dsh)), { recursive: true });
	await syncVendorTree(lock);
	await writeVendorLock(vendorLockPath(dsh), lock);

	await mkdir(dirname(requirementsLockPath(dsh)), { recursive: true });
	await cp(join(repoRoot, "python", "requirements.lock"), requirementsLockPath(dsh), { force: true });
	console.log(`requirements.lock -> ${requirementsLockPath(dsh)}`);

	await installPreset();

	await bootstrapRegistry(lock);

	if (flags.has("--skip-python")) {
		console.log("python venv skipped (--skip-python)");
	} else {
		try {
			await bootstrapPython();
		} catch (error) {
			console.warn(`python venv bootstrap failed: ${error.message}`);
			if (flags.has("--strict")) throw error;
			console.warn("continuing (use --strict to fail the install); retry later with: node scripts/install.mjs --skip-python 已建部分 + 手动 pip install -r <lock>");
		}
	}

	console.log("\nnext steps:");
	console.log("  1. restart the web profile so the bundle rows activate:");
	console.log("     dsh plugin --profile web add <path-to-this-repo>   # once");
	console.log("     dsh web");
	console.log("  2. pick the iBM科研Agent preset for new sessions; nature skills appear in the skill catalog.");
	console.log("  3. verify: node scripts/regression/run.mjs");
}

main().catch((error) => {
	console.error(`install failed: ${error.message}`);
	process.exit(1);
});
