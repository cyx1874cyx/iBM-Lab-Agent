/**
 * Integration: ReadingGoalProfile (ctx.labGoals) and PptTemplateProfile
 * (ctx.labTemplates) end to end — versioning, snapshots, deletion semantics,
 * PPTX import → suggestion → confirm → validate, and invalid-template
 * rejection (§八 goal/template tests).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";
import { buildThreeTemplates } from "../fixtures/pptx-builder.mjs";
import { LAYOUT_ROLES } from "../../src/ppt-template.js";
import { PAPER_CARD_SECTION_CONTRACT } from "../../src/goal-profile.js";

async function bootProfiles() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-profiles-"));
	const templatesDir = join(dir, "templates");
	await mkdir(templatesDir, { recursive: true });
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir } }
		]
	});
	return { handle, dir, templatesDir };
}

test("goal profiles: seed, create, update, snapshot, copy, delete", async () => {
	const { handle, dir } = await bootProfiles();
	try {
		const goals = handle.ctx.labGoals;

		// builtin default seeded
		const seeded = await goals.list();
		assert.ok(seeded.some((g) => g.id === "default-prodrug-polymer"));
		const def = await goals.resolve("default-prodrug-polymer");
		assert.equal(def.name, "聚前药/高分子精读（默认）");

		// create v1
		const created = await goals.create("prodrug-advanced", {
			name: "聚前药进阶",
			researchQuestions: ["Q1"],
			reviewSections: ["01-polymer-design"],
			language: "zh",
			depth: "detailed"
		});
		assert.equal(created.version, "1");

		// update → v2, v1 snapshot unchanged
		const updated = await goals.update("prodrug-advanced", { researchQuestions: ["Q2"] });
		assert.equal(updated.version, "2");
		assert.deepEqual((await goals.resolve("prodrug-advanced", "1")).researchQuestions, ["Q1"]);
		assert.deepEqual((await goals.resolve("prodrug-advanced", "2")).researchQuestions, ["Q2"]);
		assert.deepEqual((await goals.resolve("prodrug-advanced")).researchQuestions, ["Q2"]);

		// task snapshot is a deep copy and stable across later updates
		const snapshot = await goals.snapshotForTask("prodrug-advanced", "1");
		assert.deepEqual(snapshot.researchQuestions, ["Q1"]);
		await goals.update("prodrug-advanced", { researchQuestions: ["Q3"] });
		assert.deepEqual(snapshot.researchQuestions, ["Q1"]);

		// copy
		const copy = await goals.copy("prodrug-advanced", "prodrug-copy", "副本");
		assert.equal(copy.version, "1");
		assert.equal(copy.name, "副本");

		// paper-card requirements conversion keeps the 01-16 contract
		const req = goals.toPaperCardRequirements(await goals.resolve("default-prodrug-polymer"));
		assert.equal(req.paperCardContract.sections, PAPER_CARD_SECTION_CONTRACT);

		// delete: removed from list, history + snapshot still readable
		await goals.deleteProfile("prodrug-advanced");
		assert.ok(!(await goals.list()).some((g) => g.id === "prodrug-advanced"));
		assert.ok(await goals.resolve("prodrug-advanced", "1"));
		assert.ok(await goals.snapshotForTask("prodrug-advanced", "2"));
		await assert.rejects(() => goals.create("prodrug-advanced", { name: "again" }), /already exists|not found/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("templates: import three templates, suggest, confirm, validate, preview, delete", async () => {
	const { handle, dir, templatesDir } = await bootProfiles();
	try {
		const templates = handle.ctx.labTemplates;

		// nature-default seeded
		assert.ok((await templates.list()).some((t) => t.id === "nature-default"));

		const [a, b, c] = await buildThreeTemplates();
		const fixturePaths = [];
		for (const [i, t] of [a, b, c].entries()) {
			const p = join(dir, `tmpl-${i}.pptx`);
			await writeFile(p, t.buffer);
			fixturePaths.push(p);
		}

		// import all three → draft with 11-role suggestions
		const imported = [];
		for (let i = 0; i < 3; i++) {
			const result = await templates.importPptx(`lab-template-${i + 1}`, { pptxPath: fixturePaths[i], meta: { name: `模板${i + 1}` } });
			assert.equal(result.profile.status, "draft");
			assert.equal(Object.keys(result.suggestions).length, LAYOUT_ROLES.length);
			imported.push(result.profile);
		}
		assert.equal(imported[0].pageSize.ratio, "16:9");
		assert.equal(imported[1].pageSize.ratio, "4:3");
		assert.equal(imported[2].pageSize.ratio, "16:9");
		assert.ok(imported[0].theme.colors.accent1);

		// source file + parse.json written under templatesDir
		const first = imported[0];
		const parseJson = JSON.parse(await readFile(join(dirname(first.source.file), "parse.json"), "utf8"));
		assert.ok(parseJson.layouts.length >= 3);

		// confirm with the suggested mapping → ready, validate ok
		const suggested = await templates.preview("lab-template-1");
		const mapping = Object.fromEntries(suggested.roles.map((r) => [r.role, { layoutId: r.layoutId }]));
		const confirmed = await templates.confirmMapping("lab-template-1", "1", mapping);
		assert.equal(confirmed.ok, true);
		assert.equal(confirmed.profile.status, "ready");
		assert.deepEqual(await templates.validate("lab-template-1"), { ok: true, problems: [] });

		// invalid mapping is rejected, template stays draft
		const badMapping = { ...mapping, cover: { layoutId: "does-not-exist" } };
		const rejected = await templates.confirmMapping("lab-template-2", "1", badMapping);
		assert.equal(rejected.ok, false);
		assert.ok(rejected.problems.some((p) => p.includes("cover")));
		assert.equal((await templates.resolve("lab-template-2")).status, "draft");

		// preview lists every role with a layout + placeholders
		const preview = await templates.preview("lab-template-1");
		assert.equal(preview.roles.length, LAYOUT_ROLES.length);
		for (const role of preview.roles) {
			assert.ok(role.layoutId, `role ${role.role} has a layout`);
			assert.ok(Array.isArray(role.placeholders));
		}

		// delete: removed from list, history still readable
		await templates.deleteProfile("lab-template-3");
		assert.ok(!(await templates.list()).some((t) => t.id === "lab-template-3"));
		assert.ok(await templates.resolve("lab-template-3", "1"));
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
