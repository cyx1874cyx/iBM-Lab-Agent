/**
 * Regression case: 合成路线与 CAS 边界（§七 阶段六，开放数据首版）。
 *
 * 目标/路线/步骤/证据（stub 网络）、人工审核状态机、CAS 未授权门禁
 * （只准备查询/登录入口，不执行、不把 CAS 内容输入模型）。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { CasAuthorizationError } from "../../../src/cas/boundary.js";
import { canTransitRoute } from "../../../src/synthesis/models.js";

export default {
	name: "synthesis",
	description: "开放数据路线分析 + 人工审核门禁 + CAS 未授权边界",
	tags: ["synthesis", "cas"],
	required: [],
	async run() {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-synth-"));
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [{ id: "lab-synthesis", name: "dsh-lab-agent/synthesis", inject: ["storageDomain"] }]
		});
		try {
			const synth = handle.ctx.labSynthesis;
			const problems = [];

			// 状态机契约
			if (!canTransitRoute("draft", "under-review")) problems.push("route state machine broken");
			if (canTransitRoute("under-review", "executing")) problems.push("route reached executing (must be human-review only)");

			// 目标 + 路线 + 步骤 + 开放数据证据（stub）
			await synth.createTarget({ id: "reg-tgt", name: "reg target", smiles: "CCO" });
			await synth.createRoute({ id: "reg-rt", targetId: "reg-tgt", name: "reg route" });
			await synth.addRouteStep("reg-rt", { step: 1, reaction: "r", reactants: ["a"], products: ["b"], reagents: ["c"] });
			const stubFetch = async () => ({ ok: true, json: async () => ({ patents: [{ patent_id: "US1", patent_title: "t", patent_date: "2024", patent_abstract: "a" }] }) });
			const evidence = await synth.collectEvidence("reg-rt", { query: "q", want: ["patent", "compound"], deps: { fetchImpl: stubFetch } });
			if (!evidence.some((e) => e.type === "patent") || !evidence.some((e) => e.type === "compound")) {
				problems.push("open evidence incomplete");
			}

			// 人工审核
			await synth.updateRouteStatus("reg-rt", "under-review");
			const approved = await synth.updateRouteStatus("reg-rt", "approved");
			if (approved.status !== "approved") problems.push("approve failed");

			// 0.3.2 化合物结构条目：PubChem stub 解析回写 + Ketcher 人工补绘
			await synth.createRoute({ id: "reg-rt-st", targetId: "reg-tgt", name: "reg route st" });
			await synth.addRouteStep("reg-rt-st", { step: 1, reaction: "s", reactants: ["HEMA", "AIBN"], products: ["PHEMA"] });
			const hydrateStructures = synth.getRoute("reg-rt-st").steps[0].structures;
			if (!Array.isArray(hydrateStructures) || hydrateStructures.length < 3) problems.push("structure hydrate missing entries");
			const stubLookup = async (name) => {
				if (name === "AIBN") return { canonicalSmiles: "CC(C)(C#N)N=NC(C)(C)C#N", cid: 6547 };
				throw new Error("not found: " + name);
			};
			const resolved = await synth.resolveStepStructures("reg-rt-st", "s1", { lookup: stubLookup });
			if (!resolved.resolved.some((r) => r.name === "AIBN")) problems.push("structure pubchem resolve failed");
			const afterResolve = synth.getRoute("reg-rt-st").steps[0].structures.find((s) => s.name === "AIBN");
			if (!afterResolve?.smiles || afterResolve.source !== "pubchem") problems.push("structure resolve not persisted");
			const manual = await synth.setStepStructure("reg-rt-st", "s1", "PHEMA", "CCC(C(=O)OCC)(C)C");
			const afterManual = manual.steps[0].structures.find((s) => s.name === "PHEMA");
			if (afterManual?.source !== "manual" || !afterManual.smiles) problems.push("structure manual set failed");

			// CAS 边界：未授权只准备查询/登录入口
			const policy = synth.casPolicy();
			if (policy.policy.autoAccess !== false || policy.policy.llmIngest !== false) problems.push("CAS policy not fail-closed");
			const q = synth.casPrepareQuery({ name: "doxorubicin" });
			if (q.executed !== false) problems.push("CAS query executed without authorization");
			let casBlocked = false;
			try {
				synth.casRequireAuthorization();
			} catch (error) {
				casBlocked = error instanceof CasAuthorizationError;
			}
			if (!casBlocked) problems.push("CAS access allowed without written authorization");

			return { pass: problems.length === 0, details: problems.length === 0 ? "open-data synthesis + CAS boundary ok" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
