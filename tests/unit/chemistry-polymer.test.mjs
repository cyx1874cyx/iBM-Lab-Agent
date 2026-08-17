import { test } from "node:test";
import assert from "node:assert/strict";
import {
	polydispersity,
	degreeOfPolymerization,
	drugLoading,
	substitutionDegree,
	weightAverageFrom,
	theoreticalMn,
	conversionFromMn,
	PolymerCalcError
} from "../../src/chemistry/polymer-calc.js";

test("polydispersity is Mw/Mn and marked computed", () => {
	const d = polydispersity(24000, 20000);
	assert.equal(d.value, 1.2);
	assert.equal(d.sourceKind, "computed");
	assert.match(d.source, /Mw\/Mn/);
	assert.throws(() => polydispersity(10000, 20000), PolymerCalcError);
});

test("degreeOfPolymerization uses repeat unit mass and initiator correction", () => {
	const dp = degreeOfPolymerization({ Mn: 20000, repeatUnitMw: 200, initiatorFragmentMass: 100 });
	assert.equal(dp.value, 99.5);
	assert.throws(() => degreeOfPolymerization({ Mn: 50, repeatUnitMw: 200 }), PolymerCalcError);
});

test("drugLoading and substitutionDegree", () => {
	const dl = drugLoading({ polymerMw: 20000, drugMw: 543.5, drugCount: 10 });
	assert.ok(Math.abs(dl.value - (5435 / 25435) * 100) < 1e-9);
	const ds = substitutionDegree({ drugCount: 10, availableSites: 40 });
	assert.equal(ds.value, 25);
	assert.throws(() => substitutionDegree({ drugCount: 50, availableSites: 40 }), PolymerCalcError);
});

test("weightAverageFrom and theoreticalMn", () => {
	assert.equal(weightAverageFrom({ Mn: 20000, dispersity: 1.2 }).value, 24000);
	assert.equal(theoreticalMn({ repeatUnitMw: 200, dp: 100, initiatorFragmentMass: 100 }).value, 20100);
});

test("conversionFromMn uses end-group assumption", () => {
	const c = conversionFromMn({ targetMn: 10000, observedMn: 20000 });
	assert.equal(c.value, 0.5);
	assert.throws(() => conversionFromMn({ targetMn: 20000, observedMn: 10000 }), PolymerCalcError);
});
