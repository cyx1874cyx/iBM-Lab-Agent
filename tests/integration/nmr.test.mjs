/**
 * Integration: ctx.labNmr — NMR 工作流（§五）。
 *
 * 准备—人工审核—写回—视觉质检状态机；原始 FID/结构路径与已审核积分计划
 * 不可覆盖；聚合物积分计算只接受已审核积分。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

async function bootNmr() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-nmr-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [{ id: "lab-nmr", name: "dsh-lab-agent/nmr", inject: ["storageDomain"] }]
	});
	return { handle, dir };
}

const INTEGRALS = [
	{ peak: "7.4 ppm", integral: 2, protons: 2, assignment: "aromatic (drug)", notes: "阿霉素芳氢" },
	{ peak: "4.8 ppm", integral: 2, protons: 1, assignment: "O-CH2 polymer", notes: "骨架-OCH2" },
	{ peak: "3.6 ppm", integral: 1, protons: 3, assignment: "OCH3 residual monomer", notes: "残留单体甲氧基" },
	{ peak: "0.9 ppm", integral: 1, protons: 3, assignment: "end-group CH3", notes: "RAFT 端基" }
];

test("nmr workflow: prepare → review → approve(freeze) → write-back → visual verify", async () => {
	const { handle, dir } = await bootNmr();
	try {
		const nmr = handle.ctx.labNmr;

		// 准备：登记原始 FID/结构
		const ds = await nmr.createDataset({
			id: "nmr-prodrug-1", name: "聚前药-1 1H NMR", fidPath: "/data/pd-1.fid", structurePath: "/data/pd-1.mol", solvent: "CDCl3"
		});
		assert.equal(ds.status, "prepared");
		assert.equal(ds.fidPath, "/data/pd-1.fid");

		// 提交草稿积分 → 人工审核
		const reviewed = await nmr.setDraftIntegrals("nmr-prodrug-1", INTEGRALS);
		assert.equal(reviewed.status, "under-review");
		assert.equal(reviewed.draftIntegrals.length, 4);

		// 审核通过 → 冻结（approved-written + 写回记录）
		const approved = await nmr.approveIntegrals("nmr-prodrug-1", { note: "积分核对无误" });
		assert.equal(approved.status, "approved-written");
		assert.equal(approved.approvedIntegrals.length, 4);
		assert.ok(approved.writeBack.at);

		// 已审核计划不可覆盖：再次 approve / 修改草稿均拒绝
		await assert.rejects(() => nmr.approveIntegrals("nmr-prodrug-1"), /cannot be overwritten|only under-review/);
		await assert.rejects(() => nmr.setDraftIntegrals("nmr-prodrug-1", [INTEGRALS[0]]), /cannot be changed/);

		// 写回（agent 通过 mcp__mnova__* 执行后登记）与视觉质检
		const written = await nmr.markWrittenBack("nmr-prodrug-1", { note: "积分已写回 Mnova" });
		assert.equal(written.status, "approved-written");
		const verified = await nmr.visualVerify("nmr-prodrug-1", { note: "图谱渲染核对通过" });
		assert.equal(verified.status, "visually-verified");
		assert.ok(verified.visualCheck.at);

		// 视觉质检后不可再打回修改已审核计划（无非法流转）
		await assert.rejects(() => nmr.setDraftIntegrals("nmr-prodrug-1", []), /cannot be changed/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("nmr workflow: reopen review keeps approved history and recalculates from approved integrals", async () => {
	const { handle, dir } = await bootNmr();
	try {
		const nmr = handle.ctx.labNmr;
		await nmr.createDataset({ id: "nmr-2", name: "共聚物", fidPath: "/data/cp.fid" });
		await nmr.setDraftIntegrals("nmr-2", INTEGRALS);
		await nmr.approveIntegrals("nmr-2");

		// 计算门禁：已审核积分可用
		const composition = await nmr.calculate("nmr-2", "composition", { aIntegral: 2, aProtons: 2, bIntegral: 1, bProtons: 3 });
		assert.equal(composition.sourceKind, "computed");
		assert.ok(composition.value > 0 && composition.value < 1);

		const conversion = await nmr.calculate("nmr-2", "conversion", { polyIntegral: 9, polyProtons: 1, residualIntegral: 1, residualProtons: 1 });
		assert.equal(conversion.value, 0.9);

		const ds = nmr.getDataset("nmr-2");
		assert.ok(ds.results.composition);
		assert.ok(ds.results.conversion);

		// 打回：draftIntegrals 清空、approvedIntegrals 保留（不被覆盖）
		const reopened = await nmr.reopenReview("nmr-2", { note: "发现积分基线问题，重新积分" });
		assert.equal(reopened.status, "prepared");
		assert.equal(reopened.draftIntegrals.length, 0);
		assert.equal(reopened.approvedIntegrals.length, 4);

		// 打回后（prepared）计算被拒绝——已审核积分仍存在但状态不允许？计算以 approvedIntegrals 为输入，
		// 打回只重拟草稿，旧已审核积分仍在；为防误导，calculate 在非 approved-written 状态拒绝
		const nmr2 = nmr.getDataset("nmr-2");
		assert.equal(nmr2.status, "prepared");
		// 计算仍可用旧已审核积分？语义上"只接受已审核积分"——已审核积分存在，允许计算但注明旧计划。
		// 此处验证：计算不依赖状态，只依赖 approvedIntegrals 存在。
		const again = await nmr.calculate("nmr-2", "conversion", { polyIntegral: 9, polyProtons: 1, residualIntegral: 1, residualProtons: 1 });
		assert.equal(again.value, 0.9);

		// 未审核数据集计算拒绝
		await nmr.createDataset({ id: "nmr-3", name: "未审核", fidPath: "/data/x.fid" });
		await assert.rejects(() => nmr.calculate("nmr-3", "conversion", { polyIntegral: 1, polyProtons: 1, residualIntegral: 1, residualProtons: 1 }), /no approved integrals/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
