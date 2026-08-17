import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillDoc, pickManifestVersion, scanSkillsRoot, scanSkill, MANDATORY_ENTRIES } from "../../src/skill-catalog.js";

test("parseSkillDoc splits frontmatter and body", () => {
	const { frontmatter, body } = parseSkillDoc("---\nname: nature-reader\ndescription: read\n---\n\n# Body\n");
	assert.equal(frontmatter.name, "nature-reader");
	assert.match(body, /^# Body/);
});

test("parseSkillDoc tolerates missing frontmatter", () => {
	const { frontmatter, body } = parseSkillDoc("# No frontmatter");
	assert.deepEqual(frontmatter, {});
	assert.match(body, /^# No frontmatter/);
});

test("parseSkillDoc tolerates malformed frontmatter", () => {
	const { frontmatter } = parseSkillDoc("---\nname: [unclosed\n---\nrest");
	assert.deepEqual(frontmatter, {});
});

test("pickManifestVersion prefers manifest.yaml, then frontmatter, then metadata", () => {
	assert.equal(pickManifestVersion({ version: "1.2.3" }, { frontmatter: { version: "9.9.9" } }), "1.2.3");
	assert.equal(pickManifestVersion({}, { frontmatter: { version: "9.9.9" } }), "9.9.9");
	assert.equal(pickManifestVersion({}, { frontmatter: { metadata: { version: "2.1.1" } } }), "2.1.1");
	assert.equal(pickManifestVersion({}, { frontmatter: {} }), "unknown");
});

test("MANDATORY_ENTRIES pins SKILL.md and manifest.yaml", () => {
	assert.deepEqual(MANDATORY_ENTRIES, ["SKILL.md", "manifest.yaml"]);
});

async function makeFixture() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-catalog-"));
	const skills = join(dir, "skills");
	const reader = join(skills, "nature-reader");
	await mkdir(join(reader, "scripts"), { recursive: true });
	await mkdir(join(reader, "static"), { recursive: true });
	await writeFile(join(reader, "SKILL.md"), "---\nname: nature-reader\nversion: 2.0.0\n---\nbody\n", "utf8");
	await writeFile(join(reader, "manifest.yaml"), "version: 3.1.4\n", "utf8");
	// a skill missing its manifest.yaml
	const broken = join(skills, "nature-broken");
	await mkdir(broken, { recursive: true });
	await writeFile(join(broken, "SKILL.md"), "---\nname: nature-broken\n---\nbody\n", "utf8");
	return { dir, skills };
}

test("scanSkill records actual entries and manifest version", async () => {
	const { dir, skills } = await makeFixture();
	try {
		const scanned = await scanSkill(skills, "nature-reader");
		assert.equal(scanned.manifestVersion, "3.1.4");
		assert.ok("scripts" in scanned.entries);
		assert.ok("SKILL.md" in scanned.entries);
		assert.deepEqual(scanned.health.missing, []);
		assert.ok(scanned.requiredFiles.includes("scripts"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("scanSkillsRoot reports mandatory misses as diagnostics", async () => {
	const { dir, skills } = await makeFixture();
	try {
		const { skills: found, diagnostics } = await scanSkillsRoot(skills);
		assert.equal(found.length, 2);
		assert.deepEqual(found.find((s) => s.name === "nature-reader").health.missing, []);
		assert.ok(found.find((s) => s.name === "nature-broken").health.missing.includes("manifest.yaml"));
		assert.ok(diagnostics.some((d) => d.skill === "nature-broken"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("scanSkill records frontmatter name (informational)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-catalog-"));
	try {
		const skills = join(dir, "skills");
		const s = join(skills, "nature-x");
		await mkdir(s, { recursive: true });
		await writeFile(join(s, "SKILL.md"), "---\nname: other-name\n---\nbody\n", "utf8");
		await writeFile(join(s, "manifest.yaml"), "version: 1.0.0\n", "utf8");
		const scanned = await scanSkill(skills, "nature-x");
		assert.equal(scanned.frontmatterName, "other-name");
		assert.deepEqual(scanned.health.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
