/**
 * Integration: 0.3.2 合成路线化合物结构条目服务（structures/resolve/set）。
 * 覆盖：hydrate 占位与 route.compounds 回填、PubChem 解析回写（stub lookup）、
 * Ketcher 人工补绘回写、仅 draft 限制、Evidence bundleId 透传与截图端点纯函数。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

async function bootWorkspace() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-synth-struct-"));
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

/** 模拟 PubChem lookup（返回 canonicalSmiles；HEMA/DMF 可解析，其余抛错）。 */
async function stubLookup(name) {
	const table = {
		HEMA: { canonicalSmiles: "C=C(C)C(=O)OCC", cid: 25419 },
		DMF: { canonicalSmiles: "CN(C)C=O", cid: 6228 },
		AIBN: { canonicalSmiles: "CC(C)(C#N)N=NC(C)(C)C#N", cid: 6547 }
	};
	if (table[name]) return table[name];
	throw new Error(`PubChem lookup failed for '${name}'`);
}

test("structure service: hydrate + route.compounds backfill + resolve + set", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-st", name: "结构目标" });
		// legacy 步骤：名字在 reactants/products，无 structures
		const route = await synth.createRoute({ id: "rt-st", projectId: "prj-st", targetId: "tgt-st", name: "结构路线", compounds: [{ id: "c-hema", label: "HEMA", smiles: "C=C(C)C(=O)OCC", role: "starting-material" }] });
		await synth.addRouteStep("rt-st", { step: 1, reaction: "RAFT", reactants: ["HEMA", "AIBN"], products: ["PHEMA"] });

		// hydrate：读取时 structures 有占位条目；HEMA 从 route.compounds 回填
		const read1 = synth.getRoute("rt-st");
		const step1 = read1.steps[0];
		const hemaEntry = step1.structures.find((s) => s.name === "HEMA");
		assert.ok(hemaEntry, "hydrate 应补 HEMA 占位条目");
		assert.equal(hemaEntry.smiles, "C=C(C)C(=O)OCC", "route.compounds 同 label 应回填 smiles");
		assert.equal(hemaEntry.source, "entity", "回填来源标记 entity");
		const aibnEntry = step1.structures.find((s) => s.name === "AIBN");
		assert.ok(aibnEntry);
		assert.equal(aibnEntry.smiles, undefined, "AIBN 无 route 结构 → 仍待解析");
		assert.equal(step1.structures.some((s) => s.name === "PHEMA"), true, "产物也补占位");

		// PubChem 解析：AIBN 成功；PHEMA 失败
		const resolved = await synth.resolveStepStructures("rt-st", "s1", { lookup: stubLookup });
		assert.ok(resolved.resolved.some((r) => r.name === "AIBN" && r.smiles === "CC(C)(C#N)N=NC(C)(C)C#N"));
		assert.ok(resolved.failed.some((r) => r.name === "PHEMA"));
		assert.ok(resolved.missingAfter.includes("PHEMA"), "解析失败的仍在 missing");
		const read2 = synth.getRoute("rt-st");
		const aibnAfter = read2.steps[0].structures.find((s) => s.name === "AIBN");
		assert.equal(aibnAfter.smiles, "CC(C)(C#N)N=NC(C)(C)C#N");
		assert.equal(aibnAfter.source, "pubchem");

		// Ketcher 人工补绘 PHEMA
		const updated = await synth.setStepStructure("rt-st", "s1", "PHEMA", "CCC(C(=O)OCC)(C)C");
		const phemaAfter = updated.steps[0].structures.find((s) => s.name === "PHEMA");
		assert.equal(phemaAfter.smiles, "CCC(C(=O)OCC)(C)C");
		assert.equal(phemaAfter.source, "manual");

		// 路线化合物级回填仍在（无副作用覆盖）
		const finalRoute = synth.getRoute("rt-st");
		assert.equal(finalRoute.steps[0].structures.filter((s) => s.name === "HEMA")[0].source, "entity");

		// 非 draft 禁止解析/补绘
		await synth.updateRouteStatus("rt-st", "under-review");
		await assert.rejects(() => synth.resolveStepStructures("rt-st", "s1", { lookup: stubLookup }), /only allowed in draft/);
		await assert.rejects(() => synth.setStepStructure("rt-st", "s1", "X", "C"), /only allowed in draft/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("structure service: empty-missing resolve short-circuits without write", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-st2", name: "目标" });
		await synth.createRoute({ id: "rt-st2", targetId: "tgt-st2", name: "已齐全路线" });
		await synth.addRouteStep("rt-st2", { step: 1, reaction: "聚合", reactants: ["HEMA"], products: ["PHEMA"], structures: [{ name: "HEMA", smiles: "C=C(C)C(=O)OCC" }, { name: "PHEMA", smiles: "CCC(C(=O)OCC)(C)C" }] });
		const result = await synth.resolveStepStructures("rt-st2", "s1", { lookup: stubLookup });
		assert.deepEqual(result.resolved, []);
		assert.deepEqual(result.missingAfter, []);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("evidence service: documentId/bundleId persist and evidenceById works", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-ev", name: "目标" });
		await synth.createRoute({ id: "rt-ev", projectId: "prj-ev", targetId: "tgt-ev", name: "路线" });
		await synth.addRouteStep("rt-ev", { step: 1, reaction: "步骤", reactants: ["HEMA"] });
		const evidence = await synth.addStepEvidence({
			routeId: "rt-ev", stepId: "s1", supportsField: "procedure.temperature",
			sourceType: "paper-si", sourceTier: 1, sourceName: "SI", page: "S12",
			bundleId: "bundle-abc", documentId: "legacy-doc-1", excerpt: "70 °C"
		});
		assert.equal(evidence.bundleId, "bundle-abc");
		assert.equal(evidence.documentId, "legacy-doc-1");
		assert.equal(evidence.page, "S12");

		const byId = synth.evidenceById(evidence.id);
		assert.ok(byId);
		assert.equal(byId.routeId, "rt-ev");
		assert.equal(synth.evidenceById("does-not-exist"), null);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
