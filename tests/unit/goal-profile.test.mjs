import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createDefaultProdrugPolymerGoal,
	toPaperCardRequirements,
	cloneGoal,
	nextVersion,
	goalKey,
	PAPER_CARD_SECTION_CONTRACT
} from "../../src/goal-profile.js";

test("default prodrug/polymer goal covers the plan's seven groups", () => {
	const goal = createDefaultProdrugPolymerGoal();
	assert.equal(goal.id, "default-prodrug-polymer");
	assert.equal(goal.version, "1");
	assert.ok(goal.researchQuestions.some((q) => q.includes("骨架")));
	assert.ok(goal.researchQuestions.some((q) => q.includes("连接")));
	assert.ok(goal.metricsToExtract.includes("Mn, Mw, Đ"));
	assert.ok(goal.metricsToExtract.some((m) => m.includes("载药量")));
	assert.ok(goal.metricsToExtract.some((m) => m.includes("CMC")));
	assert.ok(goal.requiredEvidenceTypes.some((e) => e.includes("GPC")));
	assert.ok(goal.customTerms["聚前药"]);
	assert.ok(goal.excludedContent.length > 0);
});

test("toPaperCardRequirements preserves the 01-16 contract and carries goal emphasis", () => {
	const goal = createDefaultProdrugPolymerGoal();
	const req = toPaperCardRequirements(goal);
	assert.equal(req.paperCardContract.sections, PAPER_CARD_SECTION_CONTRACT);
	assert.deepEqual(req.emphasisSections, goal.reviewSections);
	assert.deepEqual(req.researchQuestions, goal.researchQuestions);
	assert.equal(req.depth, "detailed");
	assert.equal(req.language, "zh");
});

test("two different goals produce different emphasis but same section contract", () => {
	const g1 = createDefaultProdrugPolymerGoal();
	const g2 = { ...g1, id: "other", version: "1", name: "其他目标", researchQuestions: ["完全不同的问题A"], reviewSections: ["99-custom"] };
	const r1 = toPaperCardRequirements(g1);
	const r2 = toPaperCardRequirements(g2);
	assert.notDeepEqual(r1.researchQuestions, r2.researchQuestions);
	assert.notDeepEqual(r1.emphasisSections, r2.emphasisSections);
	assert.equal(r1.paperCardContract.sections, r2.paperCardContract.sections);
	assert.equal(r1.paperCardContract.sections, PAPER_CARD_SECTION_CONTRACT);
});

test("cloneGoal copies a goal to a new id as v1", () => {
	const source = createDefaultProdrugPolymerGoal();
	const copy = cloneGoal(source, "prodrug-advanced", "聚前药进阶");
	assert.equal(copy.id, "prodrug-advanced");
	assert.equal(copy.version, "1");
	assert.equal(copy.name, "聚前药进阶");
	assert.deepEqual(copy.researchQuestions, source.researchQuestions);
});

test("nextVersion is max+1 and goalKey composes id@version", () => {
	assert.equal(nextVersion([]), "1");
	assert.equal(nextVersion(["1", "3", "2"]), "4");
	assert.equal(goalKey("x", "2"), "x@2");
});
