/**
 * dsh-lab-agent: nature-skills catalog scanner.
 *
 * Scans a vendored nature-skills tree and extracts, per skill, the manifest
 * version and the actual top-level directory/file entries — the facts
 * recorded in vendor.lock.json (`requiredFiles` = the entries the skill
 * shipped at pin time) and bootstrapped into the NatureSkillVersion registry.
 *
 * Discovery mirrors the harness `dsh-skill-filesystem` contract: skills are
 * one level deep, `<root>/<name>/SKILL.md`. The catalog case then verifies
 * that every entry recorded at pin time still exists (the "keep the complete
 * skill directory" requirement), so upstream layout changes fail loudly
 * instead of silently dropping resources.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";

/** Entries every nature skill must ship regardless of upstream layout. */
export const MANDATORY_ENTRIES = ["SKILL.md", "manifest.yaml"];

/** Split SKILL.md into { frontmatter (parsed object), body (markdown) }. */
export function parseSkillDoc(text) {
	if (!text.startsWith("---")) return { frontmatter: {}, body: text };
	const end = text.indexOf("\n---", 3);
	if (end === -1) return { frontmatter: {}, body: text };
	const raw = text.slice(3, end).trim();
	const body = text.slice(end + 4).replace(/^\n+/, "");
	let frontmatter = {};
	try {
		const parsed = yaml.load(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) frontmatter = parsed;
	} catch {
		// Malformed frontmatter degrades to {} — the catalog case reports it.
	}
	return { frontmatter, body };
}

/** Read manifest.yaml leniently; returns {} when absent or unparsable. */
export async function readManifest(dir) {
	try {
		const text = await readFile(join(dir, "manifest.yaml"), "utf8");
		const parsed = yaml.load(text);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (error) {
		if (error?.code === "ENOENT") return {};
		throw error;
	}
}

/** Top-level entries of a skill dir: name → "dir" | "file". */
export async function listSkillEntries(skillDir) {
	const entries = {};
	for (const entry of await readdir(skillDir, { withFileTypes: true })) {
		entries[entry.name] = entry.isDirectory() ? "dir" : "file";
	}
	return entries;
}

/** Version precedence: manifest.yaml `version` > SKILL.md frontmatter `version` > `unknown`. */
export function pickManifestVersion(manifest, skillDoc) {
	if (typeof manifest.version === "string" && manifest.version.trim()) return manifest.version.trim();
	if (typeof skillDoc.frontmatter.version === "string" && skillDoc.frontmatter.version.trim()) return skillDoc.frontmatter.version.trim();
	if (typeof skillDoc.frontmatter.metadata?.version === "string") return skillDoc.frontmatter.metadata.version.trim();
	return "unknown";
}

/** One scanned skill: id, manifest version, actual entries, health. */
export async function scanSkill(skillsRoot, name) {
	const skillDir = join(skillsRoot, name);
	const skillText = await readFile(join(skillDir, "SKILL.md"), "utf8");
	const skillDoc = parseSkillDoc(skillText);
	const manifest = await readManifest(skillDir);
	const entries = await listSkillEntries(skillDir);
	const missing = MANDATORY_ENTRIES.filter((entry) => !(entry in entries));
	const frontmatterName = typeof skillDoc.frontmatter.name === "string" ? skillDoc.frontmatter.name : undefined;
	return {
		name,
		manifestVersion: pickManifestVersion(manifest, skillDoc),
		dir: `skills/${name}`,
		requiredFiles: Object.keys(entries).sort(),
		entries,
		// frontmatter-name mismatch is informational (upstream quirks exist,
		// e.g. nature-proposal-writer); only mandatory-entry misses fail.
		frontmatterName,
		health: { missing }
	};
}

/** Scan the whole skills root; returns entries + per-skill diagnostics. */
export async function scanSkillsRoot(skillsRoot, names) {
	const dirEntries = await readdir(skillsRoot, { withFileTypes: true });
	const skillDirs = dirEntries
		.filter((entry) => entry.isDirectory() && (names === undefined || names.includes(entry.name)))
		.map((entry) => entry.name)
		.sort();

	const skills = [];
	const diagnostics = [];
	for (const name of skillDirs) {
		try {
			const scanned = await scanSkill(skillsRoot, name);
			if (scanned.health.missing.length > 0) diagnostics.push({ skill: name, missing: scanned.health.missing });
			skills.push({
				name: scanned.name,
				manifestVersion: scanned.manifestVersion,
				dir: scanned.dir,
				requiredFiles: scanned.requiredFiles,
				entries: scanned.entries,
				health: scanned.health
			});
		} catch (error) {
			diagnostics.push({ skill: name, error: error.message });
		}
	}
	return { skills, diagnostics };
}
