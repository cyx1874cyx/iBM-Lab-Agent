/**
 * Integration: ctx.labChemistry — 化学实体/带来源性质/计算/实验计划（§四）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

async function bootChemistry() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-chem-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "lab-chemistry", name: "dsh-lab-agent/chemistry", inject: ["storageDomain"], config: {} }
		]
	});
	return { handle, dir };
}

test("chemistry: entities, sourced properties, computations", async () => {
	const { handle, dir } = await bootChemistry();
	try {
		const chem = handle.ctx.labChemistry;

		// 实体：小分子（阿霉素）与聚前药
		const dox = await chem.createEntity({
			id: "doxorubicin", kind: "small-molecule", name: "阿霉素",
			formula: "C27H29NO11", smiles: "CC1=C(C(=O)C2=C(C1=O)C(=C(C3=C2C=CC(=C3O)OC)O)OC(=O)CO)N"
		});
		assert.equal(dox.kind, "small-molecule");
		const prodrug = await chem.createEntity({
			id: "pd-polymer", kind: "prodrug-polymer", name: "阿霉素聚前药",
			formula: "(C6H8O2)10", polymerization: "RAFT", backboneType: "methacrylate",
			linkageType: "ester", linker: "C3-ester", releaseMechanism: "hydrolysis (pH-sensitive)"
		});
		assert.equal(prodrug.linkageType, "ester");
		await assert.rejects(() => chem.createEntity({ id: "doxorubicin", kind: "small-molecule", name: "x", formula: "C1" }), /already exists/);

		// 带来源性质：三种来源类别严格区分
		await chem.addProperty({ entityId: "doxorubicin", property: "molecularWeight", value: 543.52, unit: "g/mol", sourceKind: "db-measured", source: "PubChem CID 31703", sourceId: "pubchem-31703" });
		await chem.addProperty({ entityId: "doxorubicin", property: "molecularWeight", value: 543.52, unit: "g/mol", sourceKind: "computed", source: "RDKit MolWt", sourceId: "rdkit-1" });
		await chem.addProperty({ entityId: "doxorubicin", property: "logP", value: 1.2, unit: "", sourceKind: "model-predicted", source: "group-contribution model", sourceId: "model-1" });

		const mwSources = chem.queryProperty("doxorubicin", "molecularWeight");
		assert.equal(mwSources.length, 2);
		assert.deepEqual(new Set(mwSources.map((r) => r.sourceKind)), new Set(["db-measured", "computed"]));
		const logP = chem.queryProperty("doxorubicin", "logP");
		assert.equal(logP[0].sourceKind, "model-predicted");

		// 分子式计算（纯 JS，computed）
		const formula = chem.computeFromFormula("C27H29NO11");
		assert.ok(Math.abs(formula.molecularWeight - 543.52) < 0.05);
		assert.equal(formula.sourceKind, "computed");

		// 聚合物派生指标
		const metrics = chem.computePolymerMetrics({
			Mn: 20000, Mw: 24000, repeatUnitMw: 200, polymerMw: 20000, drugMw: 543.52, drugCount: 10, availableSites: 40
		});
		assert.equal(metrics.Đ.value, 1.2);
		assert.equal(metrics.DP.value, 100);
		assert.ok(Math.abs(metrics.drugLoading.value - (5435.2 / 25435.2) * 100) < 1e-6);
		assert.equal(metrics.substitutionDegree.value, 25);
		assert.equal(metrics.Đ.sourceKind, "computed");

		// PubChem 导入（stub 网络）
		const stubFetch = async () => ({
			ok: true,
			json: async () => ({ PropertyTable: { Properties: [{ CID: 999, MolecularFormula: "C8H9NO2", MolecularWeight: 151.16, CanonicalSMILES: "CC(=O)Nc1ccccc1", IUPACName: "acetaminophen" }] } })
		});
		const imported = await chem.importFromPubChem("acetaminophen", { fetchImpl: stubFetch });
		assert.equal(imported.entity.id, "pubchem-999");
		assert.equal(imported.properties[0].sourceKind, "db-measured");
		assert.equal(imported.properties[0].source, "PubChem CID 999");

		// RDKit 可选路径：不可用时明确降级，不静默给出数值
		const rdkit = await chem.rdkitProperties("CC(=O)Oc1ccccc1C(=O)O");
		if (rdkit.available) {
			assert.ok(rdkit.result.molecularWeight > 0);
		} else {
			assert.ok(rdkit.error);
		}
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("experiment plans: validation gate and human-review-only state machine", async () => {
	const { handle, dir } = await bootChemistry();
	try {
		const chem = handle.ctx.labChemistry;

		// 完整计划 → 创建成功（draft）
		const plan = await chem.createExperimentPlan({
			id: "plan-synth", projectId: "proj-1", title: "聚前药合成", objective: "合成阿霉素聚前药 1 g", scale: "1 g",
			reagents: [
				{ name: "甲基丙烯酸羟乙酯", formula: "C6H10O3", cas: "868-77-9", amount: "5 mL", role: "单体" },
				{ name: "RAFT 试剂", amount: "50 mg", role: "链转移剂" },
				{ name: "阿霉素盐酸盐", formula: "C27H29NO11", amount: "100 mg", role: "药物" }
			],
			instruments: ["磁力搅拌器", "氮气线", "旋转蒸发仪"],
			literatureEvidence: [{ reference: "DOI 10.1000/polymer-prodrug", notes: "合成条件参考" }],
			measurementTable: [
				{ metric: "转化率", method: "1H NMR", target: ">90%" },
				{ metric: "载药量", method: "UV-Vis", target: "15-20%" }
			],
			steps: [
				{ step: "聚合", description: "氮气下 70 °C 聚合 12 h", monitoring: "每 2 h 取样 GPC" },
				{ step: "偶联", description: "EDC/NHS 活化后与阿霉素偶联", monitoring: "TLC 监测" }
			],
			workup: "冰浴沉淀，乙醚洗涤三次",
			purification: ["透析（MWCO 3.5 kDa）", "冻干"],
			characterization: ["1H NMR", "GPC", "DLS", "UV-Vis 载药量"],
			safety: ["阿霉素为细胞毒性药物，佩戴手套/护目镜", "有机溶剂通风橱操作"],
			alternatives: ["偶联失败时可改用 NHS 酯连接臂"]
		});
		assert.equal(plan.status, "draft");
		assert.equal(plan.requiresReview, true);
		assert.deepEqual(chem.validatePlan("plan-synth"), { ok: true, problems: [] });

		// 缺安全/表征 → 创建拒绝（不静默放行）
		await assert.rejects(
			() => chem.createExperimentPlan({
				id: "plan-incomplete", projectId: "p", title: "t", objective: "o", scale: "1 g",
				reagents: [{ name: "r", amount: "1 g" }],
				steps: [{ step: "s", description: "d" }],
				measurementTable: [{ metric: "m", method: "mm" }],
				safety: [], characterization: []
			}),
			/safety|characterization/
		);

		// 状态机：仅人工审核路径
		const reviewed = await chem.updatePlanStatus("plan-synth", "under-review");
		assert.equal(reviewed.status, "under-review");
		const approved = await chem.updatePlanStatus("plan-synth", "approved");
		assert.equal(approved.status, "approved");
		// 无 executing：不控制仪器、不自动采购
		await assert.rejects(() => chem.updatePlanStatus("plan-synth", "executing"), /invalid plan transition/);
		// 非法跳跃
		await assert.rejects(() => chem.updatePlanStatus("plan-synth", "draft"), /invalid plan transition/);
		// 驳回路径
		const rejected = await chem.updatePlanStatus("plan-synth", "rejected");
		assert.equal(rejected.status, "rejected");
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
