import { test } from "node:test";
import assert from "node:assert/strict";
import {
	chemicalEntitySchema,
	chemicalPropertySchema,
	experimentPlanSchema,
	validateExperimentPlan,
	canTransitPlan,
	PLAN_TRANSITIONS,
	PROPERTY_SOURCE_KINDS,
	ENTITY_KINDS,
	propertyKey
} from "../../src/chemistry/models.js";

test("entity schema accepts all five kinds", () => {
	for (const kind of ENTITY_KINDS) {
		const entity = chemicalEntitySchema.parse({
			id: `e-${kind}`, kind, name: kind, formula: "C6H8O2",
			...(kind === "polymer" || kind === "prodrug-polymer" ? { polymerization: "RAFT" } : {}),
			...(kind === "prodrug-polymer" ? { linkageType: "ester", releaseMechanism: "hydrolysis" } : {}),
			createdAt: "now", updatedAt: "now"
		});
		assert.equal(entity.kind, kind);
	}
});

test("property source kinds distinguish measured/computed/predicted", () => {
	assert.deepEqual(PROPERTY_SOURCE_KINDS, ["db-measured", "computed", "model-predicted"]);
	const prop = chemicalPropertySchema.parse({
		entityId: "e1", property: "logP", value: 1.2, unit: "",
		sourceKind: "db-measured", source: "PubChem CID 31703", createdAt: "now"
	});
	assert.equal(prop.sourceKind, "db-measured");
	assert.equal(propertyKey("e1", "logP", "pubchem-31703"), "e1@logP@pubchem-31703");
});

test("experiment plan schema requires human review", () => {
	const plan = experimentPlanSchema.parse({
		id: "plan-1", title: "t", objective: "o", scale: "1 g",
		reagents: [{ name: "r", amount: "1 g" }], steps: [{ step: "s1", description: "d" }],
		measurementTable: [{ metric: "m", method: "mm" }], safety: ["wear gloves"],
		characterization: ["NMR"], status: "draft", createdAt: "now", updatedAt: "now"
	});
	assert.equal(plan.requiresReview, true);
});

test("validateExperimentPlan requires the safety-relevant sections", () => {
	const base = {
		id: "p", title: "t", objective: "o", scale: "1 g",
		reagents: [{ name: "r", amount: "1 g" }], steps: [{ step: "s", description: "d" }],
		measurementTable: [{ metric: "m", method: "mm" }],
		characterization: ["NMR"], safety: ["gloves"]
	};
	assert.deepEqual(validateExperimentPlan(base), { ok: true, problems: [] });

	const noSafety = { ...base, safety: [] };
	assert.equal(validateExperimentPlan(noSafety).ok, false);
	assert.ok(validateExperimentPlan(noSafety).problems.some((p) => p.includes("safety")));

	const noReagents = { ...base, reagents: [] };
	assert.ok(validateExperimentPlan(noReagents).problems.some((p) => p.includes("reagent")));

	const emptyObjective = { ...base, objective: "  " };
	assert.ok(validateExperimentPlan(emptyObjective).problems.some((p) => p.includes("objective")));
});

test("plan state machine has no executing/auto state", () => {
	assert.ok(!Object.values(PLAN_TRANSITIONS).flat().includes("executing"));
	assert.deepEqual(PLAN_TRANSITIONS["draft"], ["under-review", "rejected"]);
	assert.ok(canTransitPlan("draft", "under-review"));
	assert.ok(canTransitPlan("under-review", "approved"));
	assert.ok(!canTransitPlan("approved", "executing"));
	assert.ok(!canTransitPlan("draft", "approved"));
});
