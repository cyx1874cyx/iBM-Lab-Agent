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

		// 0.4.0：非 draft 未锁定仍可修改（锁定与审核状态独立）；locked 后才拒绝
		await synth.updateRouteStatus("rt-st", "under-review");
		const unlockedWrite = await synth.setStepStructure("rt-st", "s1", "GMA", "CC(=C)C(=O)OCC1CO1");
		assert.ok(unlockedWrite.steps[0].structures.some((s) => s.name === "GMA"), "under-review 未锁定版本允许写结构");
		const unlockedResolve = await synth.resolveStepStructures("rt-st", "s1", { lookup: stubLookup });
		assert.ok(Array.isArray(unlockedResolve.resolved));
		await synth.lockRoute("rt-st", { by: "user" });
		await assert.rejects(() => synth.setStepStructure("rt-st", "s1", "X", "C"), /is locked/);
		await assert.rejects(() => synth.resolveStepStructures("rt-st", "s1", { lookup: stubLookup }), /is locked/);
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

test("structure service: dual resolve is read-only and register carries verification", async () => {
	const { handle, dir } = await bootWorkspace();
	try {
		const synth = handle.ctx.labSynthesis;
		await synth.createTarget({ id: "tgt-dual", name: "双源目标" });
		await synth.createRoute({ id: "rt-dual", projectId: "prj-dual", targetId: "tgt-dual", name: "双源路线" });
		await synth.addRouteStep("rt-dual", { step: 1, reaction: "共聚", reactants: ["HEMA", "PHEMA", "GMA"] });
		const pub = {
			HEMA: { canonicalSmiles: "C=C(C)C(=O)OCC", inchiKey: "APFVFJFRJDLVQX-UHFFFAOYSA-N", casNumber: "868-77-9" },
			PHEMA: { canonicalSmiles: "CCC(C(=O)OCC)(C)C", inchiKey: "PHEMAHEMAHEMAH-UHFFFAOYSA-N" },
			GMA: { canonicalSmiles: "CC(=C)C(=O)OCC1CO1", inchiKey: "GMAGMAGMAGMAGM-UHFFFAOYSA-N" }
		};
		// CACTUS stub 携带标准 InChIKey（0.4.0-rc.4：双源按化学身份比较，不等价
		// 于原始字符串比较；HEMA 两源 key 一致、PHEMA key 不同、GMA 单源）。
		const cac = {
			HEMA: { smiles: "C=C(C)C(=O)OCC", inchiKey: "APFVFJFRJDLVQX-UHFFFAOYSA-N" },
			PHEMA: { smiles: "C(=C)(C)C(=O)OCCC", inchiKey: "PHEMAOTHERKEYX-UHFFFAOYSA-N" }
		};
		const deps = {
			pubchem: async (name) => { if (pub[name]) return pub[name]; throw new Error(`pubchem miss ${name}`); },
			cactus: async (name) => { if (cac[name]) return cac[name]; throw new Error(`cactus miss ${name}`); }
		};

		// 双源核验：只查不写，返回四态
		const dual = await synth.resolveStepCompoundsDual("rt-dual", "s1", deps);
		const byName = Object.fromEntries(dual.results.map((r) => [r.name, r]));
		assert.equal(byName.HEMA.status, "dual-confirmed", "两源一致 → dual-confirmed");
		assert.equal(byName.HEMA.smiles, "C=C(C)C(=O)OCC");
		assert.equal(byName.PHEMA.status, "conflict", "两源冲突 → 不选结构");
		assert.equal(byName.PHEMA.smiles, undefined);
		assert.equal(byName.GMA.status, "single-source", "单源成功 → 标记单源");
		assert.equal(byName.GMA.smiles, "CC(=C)C(=O)OCC1CO1");
		// 只查不写：路线内对应结构仍无 smiles
		const afterRead = synth.getRoute("rt-dual");
		const gmaEntry = afterRead.steps[0].structures.find((s) => s.name === "GMA");
		assert.equal(gmaEntry.smiles, undefined, "核验不写入路线");

		// 单源候选登记携带 verification
		const saved = await synth.setStepStructure("rt-dual", "s1", "GMA", "CC(=C)C(=O)OCC1CO1", { status: "single-source", sources: ["pubchem"], checkedAt: "2026-09-05T00:00:00.000Z" });
		const savedGma = saved.steps[0].structures.find((s) => s.name === "GMA");
		assert.equal(savedGma.smiles, "CC(=C)C(=O)OCC1CO1");
		assert.equal(savedGma.verification.status, "single-source");
		assert.deepEqual(savedGma.verification.sources, ["pubchem"]);

		// WP3：最终结构记录持久化 name/casNumber/smiles/inchiKey/source/verification
		const savedCas = await synth.setStepStructure(
			"rt-dual", "s1", "HEMA", "C=C(C)C(=O)OCC",
			{ status: "manual", sources: ["manual"], checkedAt: "2026-09-05T00:00:00.000Z" },
			{ casNumber: "868-77-9", inchiKey: "APFVFJFRJDLVQX-UHFFFAOYSA-N" }
		);
		const hemaSaved = savedCas.steps[0].structures.find((s) => s.name === "HEMA");
		assert.equal(hemaSaved.casNumber, "868-77-9");
		assert.equal(hemaSaved.inchiKey, "APFVFJFRJDLVQX-UHFFFAOYSA-N");
		assert.equal(hemaSaved.source, "manual");

		// 锁定路线的双源核验被服务端拒绝
		await synth.lockRoute("rt-dual", { by: "user" });
		await assert.rejects(() => synth.resolveStepCompoundsDual("rt-dual", "s1", deps), /is locked/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
