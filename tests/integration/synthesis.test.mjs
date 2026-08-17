/**
 * Integration: ctx.labSynthesis — 合成路线分析（开放数据首版）+ CAS 边界（§七）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";
import { CasAuthorizationError } from "../../src/cas/boundary.js";

async function bootSynthesis() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-synth-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [{ id: "lab-synthesis", name: "dsh-lab-agent/synthesis", inject: ["storageDomain"] }]
	});
	return { handle, dir };
}

test("synthesis: target, route, open-data evidence, review gate", async () => {
	const { handle, dir } = await bootSynthesis();
	try {
		const synth = handle.ctx.labSynthesis;

		// 目标
		const target = await synth.createTarget({
			id: "tgt-dox-polymer", name: "阿霉素-聚合物偶联物", smiles: "CC1=C(...)O", formula: "C27H29NO11"
		});
		assert.equal(target.id, "tgt-dox-polymer");

		// 路线 + 步骤
		const route = await synth.createRoute({ id: "rt-dox", targetId: "tgt-dox-polymer", name: "RAFT 聚合偶联路线" });
		assert.equal(route.status, "draft");
		const withStep = await synth.addRouteStep("rt-dox", {
			step: 1, reaction: "RAFT 聚合", reactants: ["HEMA"], products: ["PHEMA"],
			reagents: ["AIBN", "RAFT CTA"], conditions: "70 °C, N2"
		});
		assert.equal(withStep.steps.length, 1);

		// 开放数据证据（stub 网络）
		const stubFetch = async () => ({
			ok: true,
			json: async () => ({ patents: [{ patent_id: "US1234567B2", patent_title: "Prodrug polymer", patent_date: "2024-01-01", patent_abstract: "prodrug polymer" }] })
		});
		const evidence = await synth.collectEvidence("rt-dox", {
			query: "prodrug polymer doxorubicin",
			want: ["compound", "patent", "literature"],
			deps: { fetchImpl: stubFetch, literature: [{ title: "A prodrug review", doi: "10.1/rev" }] }
		});
		const types = evidence.map((e) => e.type);
		assert.ok(types.includes("patent"));
		assert.ok(types.includes("compound"));
		assert.ok(types.includes("literature"));
		assert.ok(evidence.some((e) => e.reference === "US1234567B2"));

		// 审核门禁（人工审核；无 executing）
		const reviewed = await synth.updateRouteStatus("rt-dox", "under-review");
		assert.equal(reviewed.status, "under-review");
		const approved = await synth.updateRouteStatus("rt-dox", "approved");
		assert.equal(approved.status, "approved");
		await assert.rejects(() => synth.updateRouteStatus("rt-dox", "executing"), /invalid route transition/);
		await assert.rejects(() => synth.addRouteStep("rt-dox", { step: 2, reaction: "x", reactants: [], products: [] }), /only be edited in draft/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("CAS boundary: prepare-only queries and authorization gate", async () => {
	const { handle, dir } = await bootSynthesis();
	try {
		const synth = handle.ctx.labSynthesis;

		// 政策：未授权
		const policy = synth.casPolicy();
		assert.equal(policy.policy.autoAccess, false);
		assert.equal(policy.authorizationGranted, false);

		// 只准备查询/登录入口，不执行
		const q = synth.casPrepareQuery({ name: "doxorubicin", casRn: "23214-92-8" });
		assert.equal(q.executed, false);
		assert.match(q.commonChemistry, /cas_rn=23214-92-8/);
		const entry = synth.casLoginEntry();
		assert.match(entry.url, /scifinder-n\.cas\.org/);

		// 未授权门禁：任何 CAS 操作被拒绝
		assert.throws(() => synth.casRequireAuthorization(), CasAuthorizationError);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
