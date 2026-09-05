/**
 * Integration: 0.3.0 合成路线工作台服务（SYN-001..004 / FR-20..24 /
 * ANA-001/002 / PLAN-001 / §6.4 版本复制）。
 * 覆盖：lazy hydrate、Evidence 独立表、修订版本、可行性规则、Route→Plan。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";
import { buildPlanDraftFields } from "../../src/synthesis/plan-draft.js";

async function bootWorkspace() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-synth-ws-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "lab-chemistry", name: "dsh-lab-agent/chemistry", inject: ["storageDomain"] },
			{ id: "lab-synthesis", name: "dsh-lab-agent/synthesis", inject: ["storageDomain"] }
		]
	});
	return { handle, dir };
}

/** 结构化步骤（0.3.0 procedure）。 */
function structuredStep(stepNo, overrides = {}) {
	return {
		step: stepNo,
		reaction: "RAFT 聚合",
		reactants: ["HEMA"],
		products: ["PHEMA"],
		procedure: {
			reagents: [{ name: "AIBN", amount: "5 mg", equivalent: "0.1 eq", role: "initiator" }],
			solvents: [{ name: "DMF" }],
			temperature: [{ value: "70 °C" }],
			time: { text: "12 h" },
			atmosphere: "N2",
			yield: { value: "85" },
			workup: ["冷却、稀释、萃取"],
			purification: ["甲醇沉淀"],
			monitoring: ["GPC"],
			notes: ["严格无水无氧操作"]
		},
		...overrides
	};
}

test("workspace: hydrate, project routes, evidence and review gate", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-ws", projectId: "prj-ws", name: "工作台目标" });

		// 旧式步骤（无 id / procedure）→ hydrate 出 s1 + label
		const route = await synth.createRoute({ id: "rt-ws", projectId: "prj-ws", targetId: "tgt-ws", name: "文献路线" });
		await synth.addRouteStep("rt-ws", { step: 1, reaction: "RAFT 聚合", reactants: ["HEMA"], products: ["PHEMA"], reagents: ["AIBN"], conditions: "70 °C, N2" });
		const detailed = synth.getRoute("rt-ws");
		assert.equal(detailed.steps[0].id, "s1");
		assert.equal(detailed.steps[0].label, "RAFT 聚合");
		assert.equal(detailed.version, 1);
		assert.equal(detailed.origin, "human-edited");

		// 追加结构化步骤 + 字段级 Evidence
		await synth.addRouteStep("rt-ws", structuredStep(2, { step: 2, reaction: "偶联" }));
		const evidence = await synth.addStepEvidence({
			routeId: "rt-ws", stepId: "s1", supportsField: "procedure.temperature",
			sourceType: "paper-si", sourceTier: 1, sourceName: "Supporting Information",
			title: "Synthesis of PHEMA", doi: "10.1000/example", page: 12, bundleId: "bundle-ws-1",
			excerpt: "The mixture was heated at 70 °C for 12 h.",
			extractionMethod: "text", confidence: "high"
		});
		assert.equal(evidence.stepId, "s1");
		assert.ok(evidence.id.startsWith("ev-rt-ws-"));

		const rows = synth.listStepEvidence("rt-ws", "s1");
		assert.equal(rows.length, 1);
		assert.equal(rows[0].relation, "supports");
		// 0.4.0-rc.4：确认/修正前必须先经截图端点真实渲染成功（登记 shotVerification ready）
		await synth.registerEvidenceShotVerification(evidence.id, { status: "ready", bundleId: "bundle-ws-1", page: 12, sourceDigest: "abc123" });
		const reviewed = await synth.reviewEvidence(evidence.id, "confirmed");
		assert.equal(reviewed.reviewStatus, "confirmed");
		assert.equal(reviewed.shotVerification.status, "ready", "确认保留可追溯截图核验状态");

		// 项目路线查询（SYN-004）
		const projectRoutes = synth.getProjectRoutes("prj-ws");
		assert.equal(projectRoutes.length, 1);
		assert.equal(projectRoutes[0].id, "rt-ws");

		// 0.4.0：approved 未锁定仍可修改（锁定与审核状态独立）；locked 后才拒绝
		const approved = await synth.updateRouteStatus("rt-ws", "under-review");
		assert.equal(approved.status, "under-review");
		await synth.updateRouteStatus("rt-ws", "approved");
		const edited = await synth.updateRouteStep("rt-ws", "s1", { procedure: { atmosphere: "Ar" } });
		assert.equal(edited.steps[0].procedure.atmosphere, "Ar");
		await synth.lockRoute("rt-ws", { by: "user" });
		await assert.rejects(() => synth.updateRouteStep("rt-ws", "s1", { procedure: { atmosphere: "N2" } }), /is locked/);
		await assert.rejects(() => synth.reviewEvidence(evidence.id, "rejected"), /is locked/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("route revision: new draft version with parent + copied evidence", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-rev", name: "修订目标" });
		await synth.createRoute({ id: "rt-rev", projectId: "prj-rev", targetId: "tgt-rev", name: "路线 A" });
		await synth.addRouteStep("rt-rev", structuredStep(1, { step: 1, reaction: "RAFT 聚合" }));
		const ev = await synth.addStepEvidence({ routeId: "rt-rev", stepId: "s1", supportsField: "procedure.reagents", sourceType: "paper-main", sourceTier: 2, sourceName: "Main Text", page: 3 });

		const revision = await synth.createRouteRevision("rt-rev", { changeNotes: "人工把温度改为室温", origin: "human-edited" });
		assert.notEqual(revision.id, "rt-rev");
		assert.equal(revision.parentRouteId, "rt-rev");
		assert.equal(revision.version, 2);
		assert.equal(revision.status, "draft");
		assert.match(revision.name, /版本 2/);

		// 原版本仍在（不被静默覆盖）
		assert.equal(synth.getRoute("rt-rev").status, "draft");

		// 新版本能看到复制的证据（routeId 已切换）
		const copied = synth.listRouteEvidence(revision.id);
		assert.equal(copied.length, 1);
		assert.equal(copied[0].routeId, revision.id);
		assert.notEqual(copied[0].id, ev.id);

		// 编辑新版本成功后证据不丢
		const edited = await synth.updateRouteStep(revision.id, "s1", { procedure: { atmosphere: "Ar" } });
		assert.equal(edited.steps[0].procedure.atmosphere, "Ar");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("feasibility: step-level and route-level rules (ANA-001/002)", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-fe", name: "可行性目标" });
		await synth.createRoute({ id: "rt-fe", projectId: "prj-fe", targetId: "tgt-fe", name: "可行路线" });
		await synth.addRouteStep("rt-fe", { step: 1, reaction: "旧式步骤", reactants: ["A"], products: ["B"], conditions: "rt" });
		await synth.addRouteStep("rt-fe", structuredStep(2, { step: 2, reaction: "结构化步骤" }));

		// 步骤 1 无 procedure 无证据 → 关键字段缺失：证据完整度 unknown/red（不绿）
		const step1 = synth.assessStep("rt-fe", "s1");
		assert.equal(step1.stepId, "s1");
		assert.ok(["green", "yellow", "red", "unknown"].includes(step1.assessment.overall));
		assert.ok(step1.assessment.dimensions.some((d) => d.key === "literature-precedent" && d.level === "unknown"));
		assert.ok(step1.assessment.dimensions.some((d) => d.key === "evidence-completeness" && d.level !== "green"));
		assert.equal(step1.assessment.method, "rule-based + evidence (0.3.0, 无 LLM 补值)");

		// 部分结构化（只登记了试剂）→ 完整度低 → red
		await synth.addRouteStep("rt-fe", {
			step: 3, reaction: "残缺步骤", reactants: ["C"], products: ["D"],
			procedure: { reagents: [{ name: "K2CO3", equivalent: "2 eq" }] }
		});
		const step3 = synth.assessStep("rt-fe", "s3");
		assert.ok(step3.completeness < 50);
		assert.ok(step3.assessment.dimensions.some((d) => d.key === "evidence-completeness" && d.level === "red"));
		assert.ok(step3.assessment.uncertainties.some((item) => /缺少来源/.test(item.text)));

		// 步骤 2 结构化完整 + 无证据 → literature unknown、coverage 高
		const step2 = synth.assessStep("rt-fe", "s2");
		assert.equal(step2.completeness, 100);

		// 无伪精确概率（不输出百分比概率字段）
		assert.ok(!("probability" in step2.assessment));

		const routeAssessment = synth.assessRoute("rt-fe");
		assert.equal(routeAssessment.stepAssessments.length, 3);
		assert.ok(Array.isArray(routeAssessment.bottlenecks));
		assert.ok(Array.isArray(routeAssessment.lowEvidenceSteps));

		// 替代方法接口存在且不自动覆盖（未配置 Provider 明确返回）
		const alternatives = synth.searchStepAlternatives({ routeId: "rt-fe", stepId: "s1" });
		assert.equal(alternatives.available, false);
		assert.equal(alternatives.alternatives.length, 0);
		assert.match(alternatives.reason, /AlternativeSearchProvider/);

		// 多模态提取未配置 → capability 明确
		const capability = synth.extractionCapability();
		assert.equal(capability.available, false);
		assert.match(capability.reason, /MultimodalExtractionProvider/);
		await assert.rejects(() => synth.createExtractionJob({ id: "ext-x", projectId: "prj-fe" }), /not configured/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("plan draft: route → experiment plan fields (PLAN-001)", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		const chemistry = handle.ctx.labChemistry;
		await synth.createTarget({ id: "tgt-plan", name: "计划目标" });
		await synth.createRoute({ id: "rt-plan", projectId: "prj-plan", targetId: "tgt-plan", name: "计划路线", origin: "literature-extracted" });
		await synth.addRouteStep("rt-plan", structuredStep(1));
		await synth.addStepEvidence({ routeId: "rt-plan", stepId: "s1", supportsField: "procedure.reagents", sourceType: "paper-si", sourceTier: 1, sourceName: "SI", page: 4 });

		// 纯函数映射
		const fields = buildPlanDraftFields(synth.getRoute("rt-plan"), synth.getTarget("tgt-plan"), { evidence: synth.listRouteEvidence("rt-plan") });
		assert.equal(fields.requiresReview, true);
		assert.equal(fields.status, "draft");
		assert.ok(fields.reagents.length >= 1);
		assert.ok(fields.steps.length === 1);
		assert.ok(fields.safety.length >= 1);
		assert.ok(fields.literatureEvidence.length === 1);
		assert.match(fields.literatureEvidence[0].reference, /p\.4/);

		// 落库（chemistry 侧校验必须通过）
		const plan = await chemistry.createExperimentPlan({ id: "plan-rt-plan", ...fields, title: "计划" });
		assert.equal(plan.status, "draft");
		assert.equal(plan.requiresReview, true);

		// 空路线 → 明确错误，不产出半成品
		await synth.createRoute({ id: "rt-empty", projectId: "prj-plan", targetId: "tgt-plan", name: "空路线" });
		assert.throws(() => buildPlanDraftFields(synth.getRoute("rt-empty"), null, {}), /还没有任何步骤/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("evidence rounds: human correction retained and batch overwrite rejected", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-rd", name: "轮次目标" });
		await synth.createRoute({ id: "rt-rd", projectId: "prj-rd", targetId: "tgt-rd", name: "轮次路线" });
		await synth.addRouteStep("rt-rd", { step: 1, reaction: "聚合", reactants: ["HEMA"], products: ["PHEMA"] });

		// AI 提取 → originalExtract 保留原始抽取值（自动提取类证据确认/修正前
		// 必须先登记原文截图 ready —— §5 截图核验门禁）
		const ai = await synth.addStepEvidence({
			routeId: "rt-rd", stepId: "s1", supportsField: "procedure.temperature",
			sourceType: "paper-si", sourceTier: 1, sourceName: "SI", extractionMethod: "text",
			excerpt: "heated at 70 °C", confidence: "high", bundleId: "bundle-rd-1", page: "S3"
		});
		assert.equal(ai.originalExtract, "heated at 70 °C");
		assert.equal(ai.reviewRound, 1);
		await synth.registerEvidenceShotVerification(ai.id, { status: "ready", bundleId: "bundle-rd-1", page: "S3", sourceDigest: "dig-rd" });

		// 人工修正 → corrected + userCorrection；人工点击不推进轮次（0.4.0 §3）
		const fixed = await synth.reviewEvidence(ai.id, "corrected", { correction: "75 °C" });
		assert.equal(fixed.reviewStatus, "corrected");
		assert.equal(fixed.userCorrection, "75 °C");
		assert.equal(fixed.reviewRound, 1, "人工修正不开启新审核轮");
		assert.equal(fixed.originalExtract, "heated at 70 °C");

		// 无修正值的 corrected 拒绝
		await assert.rejects(() => synth.reviewEvidence(ai.id, "corrected"), /requires a human correction/);

		// Agent 批量回写不允许覆盖已确认/已修正的同 id 记录
		await assert.rejects(() => synth.addStepEvidence({
			id: ai.id, routeId: "rt-rd", stepId: "s1", supportsField: "procedure.temperature",
			sourceType: "paper-si", sourceTier: 1, sourceName: "SI", extractionMethod: "text", excerpt: "overwrite attempt"
		}), /cannot be overwritten/);

		// Agent 新建记录可进入下一审核轮（reviewRound 显式传入，不视为已确认）
		const round2 = await synth.addStepEvidence({
			routeId: "rt-rd", stepId: "s1", supportsField: "procedure.temperature",
			sourceType: "paper-si", sourceTier: 1, sourceName: "SI", extractionMethod: "text",
			excerpt: "50 °C", confidence: "medium", reviewRound: 2, bundleId: "bundle-rd-2", page: "S5"
		});
		assert.equal(round2.reviewRound, 2);
		assert.equal(round2.reviewStatus, "pending");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
