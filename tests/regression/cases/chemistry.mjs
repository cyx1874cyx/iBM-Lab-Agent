/**
 * Regression case: chemistry & experiment plans (§四).
 *
 * 分子式→分子量、聚合物派生指标（Đ/DP/DL/DS）、带来源性质
 * （db-measured/computed/model-predicted 区分）、实验计划完整性与
 * 人工审核-only 状态机（无 executing/自动采购）。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { molecularWeightFromFormula } from "../../../src/chemistry/elements.js";
import { polydispersity, drugLoading, substitutionDegree } from "../../../src/chemistry/polymer-calc.js";

export default {
	name: "chemistry",
	description: "分子式/MW、Đ/DP/载药量/取代度、来源区分、实验计划门禁",
	tags: ["chemistry"],
	required: [],
	async run() {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-chem-"));
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [{ id: "lab-chemistry", name: "dsh-lab-agent/chemistry", inject: ["storageDomain"] }]
		});
		try {
			const chem = handle.ctx.labChemistry;
			const problems = [];

			// 纯计算层（离线）
			if (Math.abs(molecularWeightFromFormula("C27H29NO11") - 543.52) > 0.05) problems.push("doxorubicin MW wrong");
			const d = polydispersity(24000, 20000);
			if (d.value !== 1.2 || d.sourceKind !== "computed") problems.push("Đ wrong");
			if (Math.abs(drugLoading({ polymerMw: 20000, drugMw: 543.5, drugCount: 10 }).value - 21.37) > 0.1) problems.push("drug loading wrong");
			if (substitutionDegree({ drugCount: 10, availableSites: 40 }).value !== 25) problems.push("substitution degree wrong");

			// 实体 + 带来源性质
			await chem.createEntity({ id: "reg-dox", kind: "small-molecule", name: "dox", formula: "C27H29NO11" });
			await chem.addProperty({ entityId: "reg-dox", property: "molecularWeight", value: 543.52, unit: "g/mol", sourceKind: "db-measured", source: "PubChem CID 31703" });
			await chem.addProperty({ entityId: "reg-dox", property: "molecularWeight", value: 543.5, unit: "g/mol", sourceKind: "computed", source: "RDKit" });
			const sources = chem.queryProperty("reg-dox", "molecularWeight");
			if (sources.length !== 2) problems.push("property sources missing");
			if (!sources.every((r) => ["db-measured", "computed", "model-predicted"].includes(r.sourceKind))) problems.push("sourceKind invalid");

			// 实验计划：完整创建 + 缺安全拒绝 + 无 executing
			await chem.createExperimentPlan({
				id: "reg-plan", title: "t", objective: "o", scale: "1 g",
				reagents: [{ name: "r", amount: "1 g" }],
				steps: [{ step: "s", description: "d" }],
				measurementTable: [{ metric: "m", method: "mm" }],
				safety: ["gloves"], characterization: ["NMR"]
			});
			let incompleteRejected = false;
			try {
				await chem.createExperimentPlan({
					id: "reg-plan-bad", title: "t", objective: "o", scale: "1 g",
					reagents: [{ name: "r", amount: "1 g" }],
					steps: [{ step: "s", description: "d" }],
					measurementTable: [{ metric: "m", method: "mm" }],
					safety: [], characterization: []
				});
			} catch {
				incompleteRejected = true;
			}
			if (!incompleteRejected) problems.push("incomplete plan accepted");
			let executingRejected = false;
			try {
				await chem.updatePlanStatus("reg-plan", "executing");
			} catch {
				executingRejected = true;
			}
			if (!executingRejected) problems.push("plan reached executing state (must be human-review only)");

			return { pass: problems.length === 0, details: problems.length === 0 ? "chemistry + experiment plan gates ok" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
