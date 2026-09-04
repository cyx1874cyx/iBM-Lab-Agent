/**
 * Unit: 0.3.2 synthesis structures / pubchem-resolve 纯逻辑层。
 * 覆盖：名称收集去重、lazy hydrate 占位、合并/查找、缺 SMILES 统计、
 * PubChem 名称解析（stub lookup）、page/bbox 解析。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	collectStepCompoundNames,
	knownStepCompoundKeys,
	findStepStructure,
	mergeStepStructures,
	hydrateStepStructures,
	stepMissingStructures,
	structureLookup
} from "../../src/synthesis/structures.js";
import { namesNeedingResolve, resolveSmilesByNames } from "../../src/synthesis/pubchem-resolve.js";
import { pageNumberFrom, bboxFrom } from "../../lib/evidence-shot.js";

const LEGACY_STEP = {
	step: 1,
	reaction: "RAFT 聚合",
	reactants: ["HEMA", " AIBN "],
	products: ["PHEMA"],
	reagents: ["AIBN"],
	procedure: {
		reagents: [{ name: "AIBN", amount: "5 mg" }],
		catalysts: [{ name: "DBU" }],
		solvents: [{ name: "DMF" }]
	}
};

test("collectStepCompoundNames dedupes across sources", () => {
	const names = collectStepCompoundNames(LEGACY_STEP);
	const keys = names.map((row) => row.name);
	assert.ok(keys.includes("HEMA"));
	assert.ok(keys.includes("AIBN")); // reactants/reagents/procedure 去重
	assert.ok(keys.includes("PHEMA"));
	assert.ok(keys.includes("DBU"));
	assert.ok(!keys.includes("DMF")); // solvents 不计入化合物结构条目（溶剂一般无 SMILES 展示需要）
	assert.equal(new Set(keys).size, keys.length);
	assert.ok(!keys.some((name) => name !== name.trim()));
});

test("hydrateStepStructures fills placeholder entries without touching existing", () => {
	const step = {
		...LEGACY_STEP,
		structures: [{ name: "HEMA", smiles: "C=C(C)C(=O)OCC", source: "agent", role: "reactant" }]
	};
	const hydrated = hydrateStepStructures(step);
	const hema = hydrated.find((row) => row.name === "HEMA");
	assert.equal(hema.smiles, "C=C(C)C(=O)OCC"); // 已有条目不被覆盖
	assert.equal(hema.role, "reactant");
	const aibn = hydrated.find((row) => row.name === "AIBN");
	assert.ok(aibn);
	assert.equal(aibn.smiles, undefined); // 占位无 SMILES
	assert.equal(aibn.role, "reactant"); // reactants 第一出现 → reactant（reactants 早于 reagents）
	const phema = hydrated.find((row) => row.name === "PHEMA");
	assert.equal(phema.role, "product");
});

test("findStepStructure / structureLookup match case-insensitively", () => {
	const step = { step: 1, reactants: ["HEMA"], structures: [{ name: "hema", smiles: "x", role: "reactant" }] };
	const row = findStepStructure(step, "HEMA");
	assert.equal(row.smiles, "x");
	const lookup = structureLookup(step);
	assert.equal(lookup["hema"].smiles, "x"); // key 小写归一
	assert.equal(findStepStructure(step, "HEMA", { caseInsensitive: true }).smiles, "x"); // 查找大小写不敏感
});

test("mergeStepStructures updates by name and appends new", () => {
	const base = { name: "A", smiles: "a", source: "agent" };
	const merged = mergeStepStructures({ step: 1, structures: [base] }, [
		{ name: "A", smiles: "b", source: "manual" },
		{ name: "B", smiles: "c", source: "pubchem" }
	]);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].smiles, "b");
	assert.equal(merged[0].source, "manual");
	assert.equal(merged[1].name, "B");
});

test("stepMissingStructures reports names without smiles", () => {
	const step = hydrateStepStructures(LEGACY_STEP);
	const { missing, total } = stepMissingStructures({ ...step, structures: [{ name: "HEMA", smiles: "ok" }, ...step] });
	assert.ok(total >= 4);
	assert.ok(!missing.includes("HEMA"));
	assert.ok(missing.includes("AIBN"));
});

test("namesNeedingResolve filters already-known", () => {
	const pending = namesNeedingResolve(["HEMA", "HEMA", "PHEMA", "  "], { hasSmiles: (name) => name === "HEMA" });
	assert.deepEqual(pending, ["PHEMA"]);
});

test("resolveSmilesByNames resolves and fails per-name", async () => {
	const lookup = async (name) => {
		if (name === "HEMA") return { canonicalSmiles: "C=C(C)C(=O)OCC", cid: 1 };
		throw new Error("not found");
	};
	const { resolved, failed } = await resolveSmilesByNames(["HEMA", "PHEMA"], lookup);
	assert.equal(resolved.length, 1);
	assert.equal(resolved[0].smiles, "C=C(C)C(=O)OCC");
	assert.equal(failed.length, 1);
	assert.equal(failed[0].name, "PHEMA");
});

test("pageNumberFrom tolerates prefixes and non-numeric returns undefined", () => {
	assert.equal(pageNumberFrom("12"), 12);
	assert.equal(pageNumberFrom("S12"), 12);
	assert.equal(pageNumberFrom("p. 34"), 34);
	assert.equal(pageNumberFrom(undefined), undefined);
	assert.equal(pageNumberFrom("figure S2"), 2); // 取首个数字
	assert.equal(pageNumberFrom(""), undefined);
});

test("bboxFrom validates arrays of four finite numbers", () => {
	assert.deepEqual(bboxFrom({ bbox: [1, 2, 3, 4] }), [1, 2, 3, 4]);
	assert.equal(bboxFrom({ bbox: [1, 2, 3] }), undefined);
	assert.equal(bboxFrom({ bbox: ["a", 2, 3, 4] }), undefined);
	assert.equal(bboxFrom({}), undefined);
});
