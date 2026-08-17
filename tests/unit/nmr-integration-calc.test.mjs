import { test } from "node:test";
import assert from "node:assert/strict";
import {
	compositionFromIntegrals,
	conversionFromIntegrals,
	endGroupDp,
	substitutionFromIntegrals,
	drugLoadingFromSubstitution,
	normalizedMol,
	NmrCalcError
} from "../../src/nmr/integration-calc.js";

test("normalizedMol divides integral by protons", () => {
	assert.equal(normalizedMol(2, 1), 2);
	assert.equal(normalizedMol(10, 2), 5);
	assert.throws(() => normalizedMol(0, 1), NmrCalcError);
	assert.throws(() => normalizedMol(1, 0), NmrCalcError);
});

test("composition: molar fraction from integrals", () => {
	// A: I=2 (1H), B: I=1 (1H) → f_A = 2/3
	const r = compositionFromIntegrals({ aIntegral: 2, aProtons: 1, bIntegral: 1, bProtons: 1 });
	assert.ok(Math.abs(r.value - 2 / 3) < 1e-9);
	assert.equal(r.sourceKind, "computed");
	// 质子数归一：A 峰 2H 但实际每单元 2H → 与 B 等摩尔
	const r2 = compositionFromIntegrals({ aIntegral: 4, aProtons: 2, bIntegral: 2, bProtons: 1 });
	assert.ok(Math.abs(r2.value - 0.5) < 1e-9);
});

test("conversion from polymer vs residual integrals", () => {
	const r = conversionFromIntegrals({ polyIntegral: 9, polyProtons: 1, residualIntegral: 1, residualProtons: 1 });
	assert.equal(r.value, 0.9);
	const r2 = conversionFromIntegrals({ polyIntegral: 8, polyProtons: 2, residualIntegral: 2, residualProtons: 1 });
	// poly normalized = 4, residual normalized = 2 → p = 4/6 = 2/3
	assert.ok(Math.abs(r2.value - 2 / 3) < 1e-9);
});

test("end-group DP", () => {
	// 重复单元峰 100 (2H)，端基峰 2 (2H) → DP = 50
	const r = endGroupDp({ repeatIntegral: 100, repeatProtons: 2, endGroupIntegral: 2, endGroupProtons: 2 });
	assert.equal(r.value, 50);
	assert.throws(() => endGroupDp({ repeatIntegral: 100, repeatProtons: 2, endGroupIntegral: 0, endGroupProtons: 2 }), NmrCalcError);
});

test("substitution degree from drug vs polymer integrals", () => {
	// 药物峰 0.5 (1H)，聚合物峰 10 (2H)，每链可接位点 4
	// drug normalized = 0.5, polymer normalized = 5, sites 4 → 0.5/(5×4)×100 = 2.5%
	const r = substitutionFromIntegrals({ drugIntegral: 0.5, drugProtons: 1, polymerIntegral: 10, polymerProtons: 2, sitesPerChain: 4 });
	assert.equal(r.value, 2.5);
	assert.equal(r.unit, "%");
	assert.throws(() => substitutionFromIntegrals({ drugIntegral: 50, drugProtons: 1, polymerIntegral: 10, polymerProtons: 2, sitesPerChain: 4 }), NmrCalcError);
});

test("drug loading from substitution degree", () => {
	// DS 2.5%, sites 4 → drugCount 0.1; polymerMw 20000, drugMw 543.52
	const r = drugLoadingFromSubstitution({ dsPercent: 2.5, sitesPerChain: 4, polymerMw: 20000, drugMw: 543.52 });
	assert.ok(Math.abs(r.value - (54.352 / 20054.352) * 100) < 1e-9);
	assert.match(r.source, /drugCount = sites×DS%/);
	assert.throws(() => drugLoadingFromSubstitution({ dsPercent: 150, sitesPerChain: 4, polymerMw: 20000, drugMw: 543.52 }), NmrCalcError);
});
