/**
 * dsh-lab-agent: lock file models (vendor.lock.json / harness.lock.json).
 *
 * vendor.lock.json records the pinned nature-skills commit and, per skill,
 * the manifest version — the inputs the NatureSkillVersion registry is
 * bootstrapped from and the regression framework compares against.
 *
 * harness.lock.json records the pinned DeepSeek Harness package versions the
 * plugin was tested against.
 *
 * Both are plain-JSON files read/written with atomic replace; the same
 * modules serve the install script, the upgrade tool, the regression runner
 * and the Cordis services.
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

/** One pinned skill entry inside vendor.lock.json. */
export const vendorSkillEntrySchema = z.object({
	name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
	/** Version taken from the skill's manifest.yaml / SKILL.md frontmatter. */
	manifestVersion: z.string().min(1),
	/** Directory relative to the nature-skills repo root. */
	dir: z.string().min(1),
	/** Required top-level entries that must exist (SKILL.md, manifest.yaml, scripts, references, static, ...). */
	requiredFiles: z.array(z.string()).default([])
});

export const vendorLockSchema = z.object({
	schema: z.literal("dsh-lab-agent/vendor-lock/v1"),
	repo: z.string().min(1),
	pinnedCommit: z.string().regex(COMMIT_SHA_RE),
	pinnedAt: z.string(),
	license: z.string().min(1),
	skills: z.array(vendorSkillEntrySchema),
	pythonDeps: z.object({
		file: z.string().min(1),
		sha256: z.string()
	}),
	regression: z.object({
		lastPassedAt: z.string().nullable().optional(),
		lastRunAt: z.string().nullable().optional(),
		caseCount: z.number().int().nonnegative().default(0)
	})
});

/** Stable snapshot of the harness versions the plugin was tested against. */
export const harnessLockSchema = z.object({
	schema: z.literal("dsh-lab-agent/harness-lock/v1"),
	repo: z.string().min(1),
	cli: z.string().min(1),
	packages: z.record(z.string(), z.string()),
	recordedAt: z.string(),
	notes: z.string().optional()
});

/** Create a fresh vendor lock for a pinned commit. */
export function createVendorLock({ repo, pinnedCommit, pinnedAt, license, skills, pythonDepsSha256, pythonDepsFile = "requirements.lock" }) {
	return vendorLockSchema.parse({
		schema: "dsh-lab-agent/vendor-lock/v1",
		repo,
		pinnedCommit,
		pinnedAt,
		license,
		skills,
		pythonDeps: { file: pythonDepsFile, sha256: pythonDepsSha256 },
		regression: { lastPassedAt: null, lastRunAt: null, caseCount: 0 }
	});
}

export function parseVendorLock(text) {
	return vendorLockSchema.parse(JSON.parse(text));
}

export function parseHarnessLock(text) {
	return harnessLockSchema.parse(JSON.parse(text));
}

export async function readJsonFile(path, parse) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	}
	return parse(text);
}

export async function readVendorLock(path) {
	return readJsonFile(path, parseVendorLock);
}

export async function readHarnessLock(path) {
	return readJsonFile(path, parseHarnessLock);
}

/** Atomic JSON write (write temp in same dir, then rename). */
export async function writeJsonFile(path, value) {
	const payload = `${JSON.stringify(value, null, 2)}\n`;
	const tmp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
	await writeFile(tmp, payload, "utf8");
	await rename(tmp, path);
}

export async function writeVendorLock(path, lock) {
	await writeJsonFile(path, lock);
}

export async function writeHarnessLock(path, lock) {
	await writeJsonFile(path, lock);
}
