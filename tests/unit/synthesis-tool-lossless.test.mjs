/**
 * 回归测试：lab_synth_* 工具返回体必须是无损 JSON。
 *
 * 背景（2026-09-04 rc1 验收）：lib/synthesis-tool.js 的 plainTarget 解构抽取后
 * 残留值为 undefined 的自有属性（zod parse 保留显式 undefined 的可选字段），
 * Harness 的 snapshotJsonValue 校验抛 `value is not lossless JSON`，导致
 * lab_synth_target_create / list 写入成功但返回层报错。
 *
 * 修复：工具层所有 execute 成功返回统一过 cleanJson（与 lib/remote.js 的
 * synth_* RPC 出口同一模式），服务层 createTarget 入库前也 cleanJson。
 * 本测试用「真实 zod parse 出的脏对象」stub 服务层返回，验证工具层兜底。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../../lib/synthesis-tool.js";
import { synthesisTargetSchema, synthesisEvidenceSchema, synthesisRouteSchema } from "../../src/synthesis/models.js";

/** 递归检查对象树中是否存在值为 undefined 的自有可枚举属性。 */
function hasUndefinedValue(value) {
	if (Array.isArray(value)) return value.some(hasUndefinedValue);
	if (value !== null && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			if (v === undefined || hasUndefinedValue(v)) return true;
		}
	}
	return false;
}

/** 复现 service 修复前的行为：zod parse 保留显式 undefined 字段为自有属性。 */
function dirtyParse(schema, input) {
	return schema.parse(input);
}

const now = "2026-09-04T00:00:00.000Z";

function makeDirtyTarget(overrides = {}) {
	return dirtyParse(synthesisTargetSchema, {
		id: "target-dirty1",
		projectId: "proj-test",
		name: "CPTM",
		smiles: undefined, // 可选字段显式 undefined → zod 保留为自有属性
		formula: undefined,
		entityId: undefined,
		notes: undefined,
		createdAt: now,
		updatedAt: now,
		...overrides
	});
}

function makeDirtyRoute() {
	const route = dirtyParse(synthesisRouteSchema, {
		id: "route-dirty1",
		projectId: "proj-test",
		targetId: "target-dirty1",
		name: "CPTM 合成",
		steps: [{
			step: 1,
			label: "RAFT 聚合",
			reaction: "RAFT polymerization",
			reactants: ["PEG"],
			products: ["PEG-b-PCPTM52"],
			reagents: undefined, // 步骤内可选字段也脏
			conditions: undefined,
			evidenceIds: undefined,
			references: undefined
		}],
		compounds: undefined,
		version: 1,
		origin: "literature-extracted",
		parentRouteId: undefined,
		changeNotes: undefined,
		status: "draft",
		createdAt: now,
		updatedAt: now
	});
	return route;
}

function makeDirtyEvidence() {
	return dirtyParse(synthesisEvidenceSchema, {
		id: "ev-dirty1",
		routeId: "route-dirty1",
		stepId: "s1",
		supportsField: "procedure.temperature",
		sourceType: "paper-si",
		sourceTier: 5,
		sourceName: "JACS",
		title: undefined,
		doi: undefined,
		page: undefined,
		figure: undefined,
		table: undefined,
		excerpt: undefined,
		relation: "supports",
		confidence: "unknown",
		createdAt: now,
		updatedAt: now
	});
}

function registerTools() {
	const registered = [];
	const ctx = {
		tools: { register: (tool) => registered.push(tool) },
		// resolveToolProjectId：显式 projectId 分支只依赖 getProject
		labTasks: { getProject: () => ({ id: "proj-test" }) },
		labSynthesis: null // 每个用例单独填 stub
	};
	apply(ctx);
	return { ctx, registered };
}

function findTool(registered, name) {
	const tool = registered.find((t) => t.name === name);
	assert.ok(tool, `tool ${name} registered`);
	return tool;
}

test("lab_synth_target_create 返回体无 undefined 值属性（无损 JSON）", async () => {
	const { ctx, registered } = registerTools();
	ctx.labSynthesis = {
		createTarget: async (args) => makeDirtyTarget({ id: args.id, projectId: args.projectId, name: args.name })
	};
	const tool = findTool(registered, "lab_synth_target_create");
	const out = await tool.execute({ projectId: "proj-test", name: "CPTM" }, {});
	assert.equal(out.ok, true);
	assert.equal(hasUndefinedValue(out), false, "返回体含值为 undefined 的属性");
	assert.equal(out.target.name, "CPTM");
	// 无损 JSON 往返后键值不丢
	assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("lab_synth_target_list 对含脏行的存储返回干净列表", async () => {
	const { ctx, registered } = registerTools();
	ctx.labSynthesis = {
		listTargets: () => [makeDirtyTarget(), makeDirtyTarget({ id: "target-dirty2", name: "PEG-b-PCPTM52", smiles: "CCO" })]
	};
	const tool = findTool(registered, "lab_synth_target_list");
	const out = await tool.execute({ projectId: "proj-test" }, {});
	assert.equal(out.ok, true);
	assert.equal(out.targets.length, 2);
	assert.equal(hasUndefinedValue(out), false, "返回体含值为 undefined 的属性");
	// smiles 有值的行保留，无值的剔除后不残留
	assert.equal(out.targets.find((t) => t.id === "target-dirty2").smiles, "CCO");
	assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("lab_synth_route_create 对含脏字段的路线返回干净投影", async () => {
	const { ctx, registered } = registerTools();
	ctx.labSynthesis = {
		createRoute: async (args) => makeDirtyRoute()
	};
	const tool = findTool(registered, "lab_synth_route_create");
	const out = await tool.execute(
		{ projectId: "proj-test", name: "CPTM 合成", targetId: "target-dirty1" },
		{}
	);
	assert.equal(out.ok, true);
	assert.equal(hasUndefinedValue(out), false, "返回体含值为 undefined 的属性");
	assert.equal(out.route.steps.length, 1);
	assert.equal(hasUndefinedValue(out.route.steps[0]), false, "步骤内残留 undefined 字段");
	assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("lab_synth_evidence_add 成功路径返回干净 evidence", async () => {
	const { ctx, registered } = registerTools();
	ctx.labSynthesis = {
		addStepEvidence: async () => makeDirtyEvidence()
	};
	const tool = findTool(registered, "lab_synth_evidence_add");
	const out = await tool.execute(
		{ routeId: "route-dirty1", supportsField: "procedure.temperature", sourceName: "JACS" },
		{}
	);
	assert.equal(out.ok, true);
	assert.equal(hasUndefinedValue(out), false, "返回体含值为 undefined 的属性");
	assert.equal(out.evidence.id, "ev-dirty1");
	assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("lab_synth_route_status 成功路径返回干净对象", async () => {
	const { ctx, registered } = registerTools();
	ctx.labSynthesis = {
		updateRouteStatus: async () => dirtyParse(synthesisRouteSchema, {
			id: "route-dirty1", projectId: "proj-test", targetId: "target-dirty1",
			name: "CPTM 合成", steps: [], version: 1, origin: "literature-extracted",
			parentRouteId: undefined, changeNotes: undefined,
			status: "under-review", createdAt: now, updatedAt: now
		})
	};
	const tool = findTool(registered, "lab_synth_route_status");
	const out = await tool.execute({ routeId: "route-dirty1", status: "under-review" }, {});
	assert.equal(out.ok, true);
	assert.equal(out.route.status, "under-review");
	assert.equal(hasUndefinedValue(out), false, "返回体含值为 undefined 的属性");
	assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("失败分支（业务错误）返回体同样无损", async () => {
	const { ctx, registered } = registerTools();
	ctx.labSynthesis = {
		createTarget: async () => { throw new Error("synthesis target 'x' already exists"); }
	};
	const tool = findTool(registered, "lab_synth_target_create");
	const out = await tool.execute({ projectId: "proj-test", name: "CPTM" }, {});
	assert.equal(out.ok, false);
	assert.match(out.error, /already exists/);
	assert.equal(hasUndefinedValue(out), false);
	assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});
