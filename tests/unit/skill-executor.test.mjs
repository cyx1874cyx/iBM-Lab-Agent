import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillExecutor, SKILL_SCRIPTS, systemPython } from "../../src/skill-executor.js";
import { buildPptx } from "../fixtures/pptx-builder.mjs";

const skillsRoot = fileURLToPath(new URL("../../vendor/nature-skills/skills", import.meta.url));
const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

test("SKILL_SCRIPTS covers the five mechanical entry points", () => {
	assert.deepEqual(Object.keys(SKILL_SCRIPTS).sort(), [
		"auditPaperCard", "auditPptx", "exportCitations", "preparePaper", "search"
	]);
	for (const rel of Object.values(SKILL_SCRIPTS)) {
		assert.ok(rel.endsWith(".py"));
	}
});

test("systemPython is platform-aware", () => {
	assert.equal(systemPython("win32"), "py");
	assert.equal(systemPython("linux"), "python3");
});

test("pythonCommand prefers the venv python when it exists", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-ex-"));
	try {
		const venvPy = join(dir, "bin", "python");
		await mkdir(join(dir, "bin"), { recursive: true });
		await writeFile(venvPy, "#!/bin/sh\n");
		const executor = new SkillExecutor({ skillsRoot, venvPython: venvPy, platform: "linux" });
		assert.equal(executor.pythonCommand(), venvPy);

		const executor2 = new SkillExecutor({ skillsRoot, venvPython: join(dir, "missing", "python"), platform: "linux" });
		assert.equal(executor2.pythonCommand(), "python3");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("scriptPath resolves and rejects unknown/missing scripts", () => {
	const executor = new SkillExecutor({ skillsRoot });
	assert.ok(executor.scriptPath("auditPaperCard").endsWith("audit_paper_card.py"));
	assert.throws(() => executor.scriptPath("nope"), /unknown skill script/);
	const missing = new SkillExecutor({ skillsRoot: join(fixtures, "empty") });
	assert.throws(() => missing.scriptPath("search"), /not found/);
});

test("auditPaperCard: passing card exits 0, broken card exits 1 (real script)", async () => {
	const executor = new SkillExecutor({ skillsRoot });
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-audit-"));
	try {
		const passReport = join(dir, "pass.json");
		const pass = await executor.auditPaperCard({
			card: join(fixtures, "paper-card-pass.md"),
			bundle: join(fixtures, "min-source-bundle.json"),
			locatorMode: "structure-grounded",
			report: passReport
		});
		assert.equal(pass.ok, true);
		assert.equal(pass.errors, 0);

		const failReport = join(dir, "fail.json");
		const fail = await executor.auditPaperCard({
			card: join(fixtures, "paper-card-fail.md"),
			bundle: join(fixtures, "min-source-bundle.json"),
			locatorMode: "structure-grounded",
			report: failReport
		});
		assert.equal(fail.ok, false);
		assert.ok(fail.errors > 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("auditPptx: clean deck passes with zero findings (real script)", async () => {
	const executor = new SkillExecutor({ skillsRoot });
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-qa-"));
	try {
		const { buffer } = await buildPptx({ name: "qa", slides: 2 });
		const pptx = join(dir, "deck.pptx");
		await writeFile(pptx, buffer);
		const json = join(dir, "qa.json");
		const result = await executor.auditPptx({ pptx, json, failOn: "high" });
		assert.equal(result.ok, true);
		assert.equal(result.slideCount, 2);
		assert.deepEqual(result.findingCounts, { high: 0, medium: 0, low: 0 });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
