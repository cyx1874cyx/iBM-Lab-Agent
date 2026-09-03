/**
 * Unit: 0.3.0 合成路线工作台纯逻辑（models 扩展默认值 / analysis 规则 /
 * plan-draft 映射 / extraction job 状态机）。不依赖存储与网络。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	routeStepSchema,
	synthesisRouteSchema,
	synthesisEvidenceSchema,
	extractionJobSchema,
	canTransitExtractionJob,
	EXTRACTION_JOB_TRANSITIONS
} from "../../src/synthesis/models.js";
import { assessStepFeasibility, stepFieldCoverage, stepCompleteness } from "../../src/synthesis/analysis.js";
import { buildPlanDraftFields, summarizeStepConditions } from "../../src/synthesis/plan-draft.js";

test("models: legacy step/route still parse and gain additive defaults", () => {
	const step = routeStepSchema.parse({
		step: 1, reaction: "RAFT", reactants: ["HEMA"], products: ["PHEMA"], reagents: ["AIBN"], conditions: "70 °C"
	});
	assert.equal(step.id, undefined); // 服务层 hydrate，schema 层不补
	assert.deepEqual(step.evidenceIds, []);
	assert.equal(step.review.status, "pending");
	assert.equal(step.procedure, undefined);
	assert.deepEqual(step.entityRefs, { reactants: [], products: [] });

	const route = synthesisRouteSchema.parse({ id: "rt-1", targetId: "tgt-1", name: "R", steps: [step], createdAt: "now", updatedAt: "now" });
	assert.equal(route.version, 1);
	assert.equal(route.origin, "human-edited");
	assert.deepEqual(route.compounds, []);
	assert.deepEqual(route.steps[0].evidenceIds, []);
});

test("models: structured procedure parses and keeps review/confidence", () => {
	const step = routeStepSchema.parse({
		step: 2, id: "s2", label: "偶联", reaction: "A→B",
		procedure: {
			reagents: [{ name: "EDC", equivalent: "1.5 eq" }],
			catalysts: [{ name: "DMAP", loading: "5 mol%" }],
			solvents: [{ name: "DCM" }],
			temperature: [{ value: "0 °C", stage: "加料" }, { value: "rt", stage: "反应" }],
			time: { value: "4", unit: "h" },
			atmosphere: "N2",
			concentration: "0.2 M",
			yield: { value: "78", unit: "%", type: "isolated" },
			workup: ["水洗"], purification: ["柱层析"], monitoring: ["TLC"], notes: ["低温柔和加料"]
		},
		confidence: { overall: "high", missingFields: [] },
		review: { status: "confirmed", reviewedAt: "2026-01-01" }
	});
	assert.equal(step.procedure.reagents[0].equivalent, "1.5 eq");
	assert.equal(step.procedure.temperature.length, 2);
	assert.equal(step.confidence.overall, "high");
	assert.equal(step.review.status, "confirmed");
});

test("models: evidence schema enforces route binding and additive defaults", () => {
	const row = synthesisEvidenceSchema.parse({
		id: "ev-1", routeId: "rt-1", stepKey: 1, supportsField: "procedure.temperature",
		sourceType: "paper-si", sourceName: "SI", page: 12, createdAt: "now", updatedAt: "now"
	});
	assert.equal(row.sourceTier, 5); // 未指定时保守为 5（未知层）
	assert.equal(row.relation, "supports");
	assert.equal(row.reviewStatus, "pending");
	assert.equal(row.confidence, "unknown");
	assert.equal(row.stepId, undefined);
	assert.throws(() => synthesisEvidenceSchema.parse({ id: "ev-x", routeId: "rt-1", supportsField: "x", createdAt: "n", updatedAt: "n" }), /sourceName/);
	assert.throws(() => synthesisEvidenceSchema.parse({ id: "Ev-1", routeId: "rt-1", supportsField: "x", sourceName: "s", createdAt: "n", updatedAt: "n" }), /regex/);
});

test("models: extraction job state machine", () => {
	const job = extractionJobSchema.parse({ id: "ext-1", projectId: "p1", createdAt: "now", updatedAt: "now" });
	assert.equal(job.status, "queued");
	assert.deepEqual(EXTRACTION_JOB_TRANSITIONS.queued, ["parsing", "failed"]);
	assert.ok(canTransitExtractionJob("queued", "parsing"));
	assert.ok(canTransitExtractionJob("resolving", "completed"));
	assert.ok(!canTransitExtractionJob("completed", "queued"));
	assert.ok(!canTransitExtractionJob("draft", "approved"));
});

test("analysis: legacy conditions never inflate field coverage", () => {
	const legacy = { step: 1, reaction: "x", reactants: ["A"], products: ["B"], conditions: "-78 °C, 2 h, N2, then column" };
	const coverage = stepFieldCoverage(legacy);
	// reactants 缺 → 只有 0 个结构化字段
	assert.equal(coverage.filled, 0);
	assert.equal(coverage.total, 7);
	assert.ok(coverage.missing.includes("reagents"));
	assert.ok(coverage.missing.includes("temperature")); // 原文不算结构化温度
	assert.equal(stepCompleteness(legacy), 0);

	const structured = { step: 1, reaction: "x", reactants: ["A"], procedure: { reagents: [{ name: "R" }], solvents: [{ name: "THF" }], temperature: [{ value: "rt" }], time: { text: "1 h" }, atmosphere: "air", workup: ["w"], purification: ["p"] } };
	assert.equal(stepCompleteness(structured), 100);
	const partial = { step: 1, reaction: "x", procedure: { reagents: [{ name: "R" }] } };
	assert.equal(stepFieldCoverage(partial).filled, 1);
});

test("analysis: conflicting evidence never silently resolves to green", () => {
	const step = {
		step: 1, id: "s1", reaction: "x",
		procedure: { reagents: [{ name: "R" }], solvents: [{ name: "THF" }], temperature: [{ value: "0 °C" }], time: { text: "2 h" }, atmosphere: "N2", workup: ["w"], purification: ["p"] }
	};
	const conflict = assessStepFeasibility(step, {
		evidence: [
			{ id: "e1", stepId: "s1", relation: "supports", sourceTier: 1, reviewStatus: "pending" },
			{ id: "e2", stepId: "s1", relation: "conflicts", sourceTier: 1, reviewStatus: "pending" }
		]
	});
	assert.equal(conflict.overall, "red");
	assert.ok(conflict.blockingIssues.some((c) => /证据冲突/.test(c.text)));
	const litDim = conflict.dimensions.find((d) => d.key === "literature-precedent");
	assert.equal(litDim.level, "red");
});

test("analysis: no fake probability and levels are bounded", () => {
	const result = assessStepFeasibility({ step: 1, id: "s1", reaction: "x" }, { evidence: [] });
	for (const dim of result.dimensions) assert.ok(["green", "yellow", "red", "unknown"].includes(dim.level));
	assert.ok(!("probability" in result));
	assert.equal(result.method, "rule-based + evidence (0.3.0, 无 LLM 补值)");
});

test("plan-draft: summary keeps only real fields and flags unknown", () => {
	const step = {
		step: 1, reaction: "RAFT 聚合", reactants: ["HEMA"], products: ["PHEMA"],
		procedure: { reagents: [{ name: "AIBN", amount: "5 mg" }], time: { text: "12 h" }, yield: { value: "85" } },
		conditions: "70 °C, N2"
	};
	const summary = summarizeStepConditions(step);
	assert.match(summary, /AIBN/);
	assert.match(summary, /12 h/);
	assert.match(summary, /原文摘要/);
	assert.ok(!summary.includes("溶剂：")); // 未提供字段不补空

	const route = {
		id: "rt-x", name: "路线", targetId: "tgt-1", version: 1, origin: "human-edited",
		steps: [step]
	};
	const fields = buildPlanDraftFields(route, { name: "T" }, {});
	assert.equal(fields.requiresReview, true);
	assert.match(fields.objective, /待确认/); // 缺失字段保持待确认，不补值
});

test("plan-draft: refuses empty routes / zero reagents with readable errors", () => {
	const route = { id: "rt-x", name: "路线", targetId: "tgt-1", version: 1, origin: "human-edited", steps: [] };
	assert.throws(() => buildPlanDraftFields(route, null, {}), /还没有任何步骤/);

	const noReagent = { id: "rt-x", name: "路线", targetId: "tgt-1", version: 1, origin: "human-edited", steps: [{ step: 1, reaction: "x", reactants: ["A"], products: ["B"] }] };
	assert.throws(() => buildPlanDraftFields(noReagent, null, {}), /缺少任何试剂信息/);
});
