import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesisTargetSchema, synthesisRouteSchema, routeStepSchema, canTransitRoute, ROUTE_TRANSITIONS } from "../../src/synthesis/models.js";

test("target and route schemas parse", () => {
	const target = synthesisTargetSchema.parse({
		id: "tgt-1", name: "阿霉素聚前药", smiles: "CC1=C(...)", createdAt: "now", updatedAt: "now"
	});
	assert.equal(target.id, "tgt-1");
	const step = routeStepSchema.parse({
		step: 1, reaction: "RAFT 聚合", reactants: ["HEMA"], products: ["polymer"],
		reagents: ["AIBN"], conditions: "70°C", references: ["DOI 10.1000/x"]
	});
	assert.equal(step.step, 1);
	const route = synthesisRouteSchema.parse({
		id: "rt-1", targetId: "tgt-1", name: "路线 A", steps: [step], createdAt: "now", updatedAt: "now"
	});
	assert.equal(route.status, "draft");
});

test("route state machine is human-review only", () => {
	assert.deepEqual(ROUTE_TRANSITIONS["draft"], ["under-review", "rejected"]);
	assert.ok(canTransitRoute("draft", "under-review"));
	assert.ok(canTransitRoute("under-review", "approved"));
	assert.ok(canTransitRoute("approved", "rejected"));
	assert.ok(!canTransitRoute("approved", "under-review"));
	assert.ok(!canTransitRoute("draft", "approved"));
	assert.ok(!canTransitRoute("under-review", "executing"));
});
