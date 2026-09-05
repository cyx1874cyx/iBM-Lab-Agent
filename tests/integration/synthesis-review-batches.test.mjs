/**
 * Integration: 0.4.0 WP4 事实核验批次与路线锁定门禁。
 * 覆盖：批次提交门禁（全部人工决定才能提交）、uncertain 缺省推导、
 * Agent 只能更新不确定项且不得覆盖人工确认/修正、回写进入下一轮 pending、
 * 新轮自动关闭旧 open 批次、锁定三条件（无待审 / 无运行批次 / 必需截图
 * 审核有效）与结构化阻断、锁定后批次写拒绝。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

async function bootWorkspace() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-review-batch-"));
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

/** 一条带原文截图像依据（bundleId+page）的字段级证据。 */
function evidenceFields(overrides = {}) {
	return {
		stepId: "s1",
		supportsField: "procedure.temperature",
		sourceType: "paper-si",
		sourceTier: 1,
		sourceName: "SI",
		page: "S12",
		bundleId: "bundle-rev-1",
		excerpt: "heated at 70 °C",
		extractionMethod: "text",
		confidence: "high",
		...overrides
	};
}

async function seedRoute(synth) {
	await synth.createTarget({ id: "tgt-batch", projectId: "prj-batch", name: "批次目标" });
	await synth.createRoute({ id: "rt-batch", projectId: "prj-batch", targetId: "tgt-batch", name: "批次路线" });
	await synth.addRouteStep("rt-batch", { step: 1, reaction: "聚合", reactants: ["HEMA"], products: ["PHEMA"] });
}

/** 模拟截图端点真实渲染成功（服务端唯一把 shotVerification 置 ready 的入口）。 */
async function markShotReady(synth, evidenceId, { digest = "sim-digest-1", page = "S12", bundleId = "bundle-rev-1" } = {}) {
	return synth.registerEvidenceShotVerification(evidenceId, { status: "ready", bundleId, page, sourceDigest: digest });
}

test("review batch: full human decision required before submit; round and uncertain derived", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await seedRoute(synth);
		const ai = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields() });
		const temp = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.time", excerpt: "12 h" }) });

		// 仍有 pending 项 → 拒绝提交批次
		await assert.rejects(() => synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1", createdBy: "user" }), /still pending human review/);

		// 人工决定：ai 确认（先登记截图 ready）、temp 无法确认（rejected）
		await markShotReady(synth, ai.id);
		await synth.reviewEvidence(ai.id, "confirmed");
		await synth.reviewEvidence(temp.id, "rejected");

		const batch = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1", createdBy: "user" });
		assert.equal(batch.status, "pending");
		assert.equal(batch.routeId, "rt-batch");
		assert.equal(batch.stepId, "s1");
		assert.equal(batch.round, 1, "批次轮次 = 本批证据最大 reviewRound（人工点击不推进）");
		assert.equal(batch.itemIds.length, 2);
		assert.deepEqual(batch.uncertainItemIds, [temp.id], "uncertain 缺省 = 人工无法确认（rejected）项");
		assert.equal(batch.createdBy, "user");
		assert.ok(batch.createdAt);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("agent uncertain apply: only uncertain items, never confirmed/corrected; writes enter next pending round", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await seedRoute(synth);
		const confirmed = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields() });
		const uncertain = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.time", excerpt: "12 h" }) });
		await markShotReady(synth, confirmed.id);
		await synth.reviewEvidence(confirmed.id, "confirmed");
		await synth.reviewEvidence(uncertain.id, "rejected");
		const batch = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });

		// Agent 试图覆盖人工确认项 → 拒绝（服务端硬门禁，不静默跳过）
		await assert.rejects(
			() => synth.applyUncertainBatch(batch.id, { by: "agent", updates: [{ evidenceId: confirmed.id, excerpt: "overwrite" }] }),
			/cannot be overwritten/
		);

		// 只更新不确定项：excerpt 由 Agent 复核为 70 °C，进入下一轮 pending
		const applied = await synth.applyUncertainBatch(batch.id, { by: "agent", updates: [{ evidenceId: uncertain.id, excerpt: "75 °C（复核）" }] });
		assert.deepEqual(applied.applied, [uncertain.id]);
		assert.equal(applied.batch.status, "applied");
		assert.ok(applied.batch.appliedAt);

		const after = synth.evidenceById(uncertain.id);
		assert.equal(after.reviewStatus, "pending", "Agent 新事实进入下一轮 pending，不得自动视为已确认");
		assert.equal(after.reviewRound, 2, "轮次推进 +1");
		assert.equal(after.excerpt, "75 °C（复核）");
		assert.equal(after.userCorrection, undefined, "agent 回写不产生人工修正值");

		// 人工确认项未被覆盖
		const confirmedAfter = synth.evidenceById(confirmed.id);
		assert.equal(confirmedAfter.reviewStatus, "confirmed");
		assert.equal(confirmedAfter.excerpt, "heated at 70 °C");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("review batch lifecycle: complete closes batch; new round replaces open batches", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await seedRoute(synth);
		const e1 = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields() });
		const e2 = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.time", excerpt: "12 h" }) });
		await markShotReady(synth, e1.id);
		await synth.reviewEvidence(e1.id, "confirmed");
		await synth.reviewEvidence(e2.id, "rejected");
		const batch1 = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });

		// Agent 应用后，用户显式关闭该批
		await synth.applyUncertainBatch(batch1.id, { updates: [{ evidenceId: e2.id, excerpt: "16 h" }] });
		const closed = await synth.completeReviewBatch(batch1.id);
		assert.equal(closed.status, "completed");
		assert.ok(closed.completedAt);
		// completed 批次不能再 apply
		await assert.rejects(() => synth.applyUncertainBatch(batch1.id, { updates: [{ evidenceId: e2.id, excerpt: "x" }] }), /only pending/);

		// 新一轮：Agent 回写的 e2 现为 pending round 2 → 用户确认后开新批，旧 open 批自动关闭
		await markShotReady(synth, e2.id, { digest: "sim-digest-2" });
		await synth.reviewEvidence(e2.id, "confirmed");
		const batch2 = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });
		assert.equal(batch2.round, 2, "Agent 回写后新事实进入第 2 轮，新批对应第 2 轮");
		assert.equal(batch2.status, "pending");
		const openAfter = synth.listReviewBatches("rt-batch").filter((row) => ["pending", "applied"].includes(row.status));
		assert.equal(openAfter.length, 1, "新轮批次取代旧轮，同 step 只留一个 open 批次");
		assert.equal(openAfter[0].id, batch2.id);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("route lock gate (rc.4): pending evidence, open batch and shot-not-ready block with structured reasons", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await seedRoute(synth);

		// ① 待审事实阻断（结构化错误携带 evidenceIds）
		const pending = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields() });
		const caught1 = await synth.lockRoute("rt-batch", { by: "user" }).then(() => null, (error) => error);
		assert.equal(caught1?.code, "ROUTE_LOCK_BLOCKED");
		assert.ok(caught1.blockers.some((b) => b.code === "pending-evidence" && b.evidenceIds.includes(pending.id)));

		// ② 截图核验门禁：截图端点渲染失败（缺原文/文件损坏）→ 不能确认
		const failed = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.time", excerpt: "12 h", bundleId: "bundle-missing", page: "S99" }) });
		await synth.registerEvidenceShotVerification(failed.id, { status: "failed", bundleId: "bundle-missing", page: "S99", error: "原文未归档或不可读：no pdf file" });
		const rejectShot = await synth.reviewEvidence(failed.id, "confirmed").then(() => null, (error) => error);
		assert.match(String(rejectShot?.message ?? ""), /cannot be confirmed/);
		assert.match(String(rejectShot?.message ?? ""), /渲染失败|不可读/);
		await synth.reviewEvidence(failed.id, "rejected");

		// ③ ready 后被标记 stale（原 PDF 被替换）→ 不能确认；锁定被 shot-not-ready 阻断
		const good = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.solvents", excerpt: "DMF", bundleId: "bundle-stale", page: "S13" }) });
		await markShotReady(synth, good.id, { digest: "digest-v1", bundleId: "bundle-stale", page: "S13" });
		await synth.reviewEvidence(good.id, "confirmed");
		await synth.registerEvidenceShotVerification(good.id, { status: "stale", bundleId: "bundle-stale", page: "S13", sourceDigest: "digest-v2", error: "原 PDF 内容已变化" });
		const caught2 = await synth.lockRoute("rt-batch", { by: "user" }).then(() => null, (error) => error);
		assert.ok(caught2.blockers.some((b) => b.code === "shot-not-ready" && b.evidenceIds.includes(good.id)), "stale 截图使锁定被 shot-not-ready 阻断");
		// 重新渲染成功（新 digest ready）后才能确认 → 锁定不再被截图阻断
		await markShotReady(synth, good.id, { digest: "digest-v2", bundleId: "bundle-stale", page: "S13" });

		// ④ 已确认但无 bundle/page 的旧式证据不能直接确认（reviewEvidence 拒绝）
		const noShot = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.yield", excerpt: "85%", bundleId: undefined, page: undefined }) });
		const noShotReject = await synth.reviewEvidence(noShot.id, "confirmed").then(() => null, (error) => error);
		assert.ok(noShotReject, "无 bundle/page 的自动提取证据不能无截图确认");
		assert.match(String(noShotReject?.message ?? ""), /截图|原文/);

		// ⑤ 全部人工决定（pending 确认、rejected 进批次）后，运行中批次阻断锁定：
		// pending 与 applied 都算 open（§4.3）
		await markShotReady(synth, pending.id, { digest: "digest-p0" });
		await synth.reviewEvidence(pending.id, "confirmed");
		await synth.reviewEvidence(noShot.id, "rejected");
		const batch = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });
		const caught3 = await synth.lockRoute("rt-batch", { by: "user" }).then(() => null, (error) => error);
		assert.ok(caught3.blockers.some((b) => b.code === "open-review-batch" && b.batchIds.includes(batch.id)), "pending 批次阻断锁定");
		await synth.applyUncertainBatch(batch.id, { updates: [{ evidenceId: noShot.id, excerpt: "83%（复核）", bundleId: "bundle-rev-2", page: "S15" }] });
		const caught4 = await synth.lockRoute("rt-batch", { by: "user" }).then(() => null, (error) => error);
		assert.ok(caught4.blockers.some((b) => b.code === "open-review-batch"), "applied 批次同样阻断锁定（§4.3）");

		// Agent 回写的新事实 round2 → 人工确认（先截图 ready）→ 关闭批次 → 锁定成功（仅 user）
		const round2 = synth.evidenceById(noShot.id);
		await markShotReady(synth, round2.id, { digest: "digest-v3", bundleId: "bundle-rev-2", page: "S15" });
		await synth.reviewEvidence(round2.id, "confirmed");
		await synth.completeReviewBatch(batch.id);
		// rc.4 review §5.3：缺省 actor 拒绝（不再默认 user）；幂等只对合法 user
		// 动作成立——非法调用（无 by / 伪造 by）即使针对已锁定版本也拒绝，不借
		// “已锁定再次锁定返回成功”的幂等响应泄露授权旁路。
		await assert.rejects(() => synth.lockRoute("rt-batch"), /missing actor|only an explicit user action/);
		await assert.rejects(() => synth.lockRoute("rt-batch", { by: "root" }), /only an explicit user action/);
		const locked = await synth.lockRoute("rt-batch", { by: "user" });
		assert.equal(locked.locked, true);
		assert.equal(locked.lockedBy, "user");
		await assert.rejects(() => synth.lockRoute("rt-batch", { by: "agent" }), /only an explicit user action/, "已锁定版本对伪造主体仍拒绝（幂等不泄露旁路）");
		await assert.rejects(() => synth.lockRoute("rt-batch"), /missing actor|only an explicit user action/, "已锁定版本对缺省主体仍拒绝");

		// 锁定后所有写接口被服务端拒绝（含状态/证据/批次/结构/开放数据）
		await assert.rejects(() => synth.applyUncertainBatch(batch.id, { updates: [{ evidenceId: round2.id, excerpt: "x" }] }), /is locked/);
		await assert.rejects(() => synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" }), /is locked/);
		await assert.rejects(() => synth.updateRouteStatus("rt-batch", "rejected"), /is locked/);
		await assert.rejects(() => synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.atmosphere", excerpt: "N2" }) }), /is locked/);
		await assert.rejects(() => synth.collectEvidence("rt-batch", { want: ["patent"], deps: { fetchImpl: async () => ({ ok: true, json: async () => ({ patents: [] }) }), literature: [] } }), /is locked/);
		await assert.rejects(() => synth.setStepStructure("rt-batch", "s1", "X", "C"), /is locked/);
		// 复制 locked 路线得到新 ID 且新版本可写、源版本保持只读
		const copied = await synth.createRouteRevision("rt-batch", { changeNotes: "审计复制", origin: "human-edited" });
		assert.notEqual(copied.id, "rt-batch");
		assert.equal(copied.locked, false, "复制的新版本默认未锁定");
		const writable = await synth.updateRouteStep(copied.id, "s1", { reaction: "聚合（修订）" });
		assert.equal(writable.steps[0].reaction, "聚合（修订）");
		assert.equal(synth.getRoute("rt-batch").locked, true, "源版本保持锁定只读");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("rc.4 review §4: location snapshot binding — page/bbox/bundle change stales ready; legacy ready migrates; digest mismatch blocks lock", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await seedRoute(synth);

		// ① ready 登记携带 locationDigest（bundle/page/bbox/digest 快照）
		const ev = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields() });
		const ready = await markShotReady(synth, ev.id, { digest: "digest-A" });
		await synth.reviewEvidence(ev.id, "confirmed");
		assert.equal(ready.shotVerification.status, "ready");
		assert.equal(ready.shotVerification.sourceDigest, "digest-A");
		assert.ok(ready.shotVerification.locationDigest, "ready 必须携带定位快照摘要");
		assert.ok(ready.shotVerification.bundleId === "bundle-rev-1" && ready.shotVerification.page === "S12");

		// ② Agent 批次回写修改 page → 同一写事务内 ready 立即置 stale
		const rejected = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.time", excerpt: "12 h" }) });
		await markShotReady(synth, rejected.id, { digest: "digest-B" });
		await synth.reviewEvidence(rejected.id, "rejected");
		const batch = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });
		await synth.applyUncertainBatch(batch.id, { updates: [{ evidenceId: rejected.id, page: "S14", excerpt: "14 h" }] });
		const moved = synth.evidenceById(rejected.id);
		assert.equal(moved.page, "S14");
		assert.equal(moved.shotVerification.status, "stale", "page 变更必须同事务把 ready 置 stale（§4.3）");
		assert.match(moved.shotVerification.error, /定位.*变更/);
		// stale 后不能确认（重新渲染后才恢复）
		const gateAfterMove = synth.evidenceShotGate(moved);
		assert.equal(gateAfterMove.ok, false);
		assert.match(gateAfterMove.reason, /stale|失效|重新渲染/);
		// Agent 回写后 moved 进入下一轮 pending：下一批前须人工决定（rejected 不依赖截图）
		await synth.reviewEvidence(moved.id, "rejected");

		// ③ bbox 变化同样置 stale（人工/Agent 回写路径同规则）
		const evBbox = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.solvents", excerpt: "DMF" }) });
		await markShotReady(synth, evBbox.id, { digest: "digest-C" });
		await synth.reviewEvidence(evBbox.id, "rejected");
		const batch2 = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });
		await synth.applyUncertainBatch(batch2.id, { updates: [{ evidenceId: evBbox.id, bbox: [10, 20, 30, 40], excerpt: "DMAc" }] });
		assert.equal(synth.evidenceById(evBbox.id).shotVerification.status, "stale", "bbox 变更必须置 stale");
		// Agent 回写后 evBbox 进入下一轮 pending：④ 开批前人工决定
		await synth.reviewEvidence(evBbox.id, "rejected");

		// ④ bundle/documentId 替换 → 置 stale
		const evBundle = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.yield", excerpt: "85%" }) });
		await markShotReady(synth, evBundle.id, { digest: "digest-D" });
		await synth.reviewEvidence(evBundle.id, "rejected");
		const batch3 = await synth.createReviewBatch({ routeId: "rt-batch", stepId: "s1" });
		await synth.applyUncertainBatch(batch3.id, { updates: [{ evidenceId: evBundle.id, bundleId: "bundle-new-2", excerpt: "86%（复核）" }] });
		assert.equal(synth.evidenceById(evBundle.id).shotVerification.status, "stale", "bundleId 替换必须置 stale");

		// ⑤ 旧版无 locationDigest 的 ready（模拟 legacy 数据）→ 迁移 stale、gate 拒绝、不能确认
		const legacy = await synth.addStepEvidence({ routeId: "rt-batch", ...evidenceFields({ supportsField: "procedure.atmosphere", excerpt: "N2" }) });
		const legacyRow = synth.evidenceById(legacy.id);
		await synth.table("evidence").put(legacy.id, {
			...legacyRow,
			shotVerification: { status: "ready", bundleId: "bundle-rev-1", page: "S12", sourceDigest: "legacy-digest" } // 无 locationDigest
		});
		const legacyGate = synth.evidenceShotGate(synth.evidenceById(legacy.id));
		assert.equal(legacyGate.ok, false, "旧版无 locationDigest 的 ready 不得静默放行");
		assert.match(legacyGate.reason, /locationDigest|旧版|重新渲染/);
		await assert.rejects(() => synth.reviewEvidence(legacy.id, "confirmed"), /locationDigest|旧版|重新渲染/);
		// 不依赖截图的写（rejected）落库时触发旧数据迁移为 stale
		await synth.reviewEvidence(legacy.id, "rejected");
		const migrated = synth.evidenceById(legacy.id);
		assert.equal(migrated.shotVerification.status, "stale", "legacy ready 写路径自动迁移为 stale");

		// ⑥ stale 后重新渲染成功（新 digest + 同一定位）→ ready 恢复，且 digest 一致性可锁
		const stale = synth.evidenceById(rejected.id);
		await markShotReady(synth, stale.id, { digest: "digest-B2", page: "S14" });
		assert.equal(synth.evidenceById(rejected.id).shotVerification.status, "ready");

		// ⑦ 已归档 SI 被替换时，无需用户再次打开截图端点也要主动失效旧 ready。
		const invalidated = await synth.invalidateEvidenceShotsForBundle("bundle-rev-1", "si", "digest-B3");
		assert.ok(invalidated >= 1);
		assert.equal(synth.evidenceById(rejected.id).shotVerification.status, "stale", "源 SI 更新应主动使关联截图失效");
		await markShotReady(synth, rejected.id, { digest: "digest-B3", page: "S14" });

		// ⑧ ready 但 Evidence 当前定位已与快照不一致 → gate 拒绝（人为改 row 定位模拟漂移）
		const drifted = synth.evidenceById(rejected.id);
		await synth.table("evidence").put(rejected.id, { ...drifted, page: "S99" });
		const driftGate = synth.evidenceShotGate(synth.evidenceById(rejected.id));
		assert.equal(driftGate.ok, false, "定位漂移后旧 ready 快照不匹配 → 拒绝");
		assert.match(driftGate.reason, /变化|重新渲染/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
