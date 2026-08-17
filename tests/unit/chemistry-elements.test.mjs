import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseFormula,
	molecularWeightFromFormula,
	normalizeFormula,
	formulaToString,
	FormulaParseError,
	ELEMENTS
} from "../../src/chemistry/elements.js";

test("parseFormula parses simple formulas", () => {
	assert.deepEqual(parseFormula("C10H12N2O3"), { C: 10, H: 12, N: 2, O: 3 });
	assert.deepEqual(parseFormula("H2O"), { H: 2, O: 1 });
	assert.deepEqual(parseFormula("C6H8O2"), { C: 6, H: 8, O: 2 });
});

test("parseFormula expands parenthesis groups with multipliers", () => {
	assert.deepEqual(parseFormula("(C6H8O2)10"), { C: 60, H: 80, O: 20 });
	assert.deepEqual(parseFormula("(C2H4)3O"), { C: 6, H: 12, O: 1 });
	// 平级多组括号合法
	assert.deepEqual(parseFormula("C1H2O3(C6)10(Cl)2"), { C: 61, H: 2, O: 3, Cl: 2 });
});

test("parseFormula rejects bad input", () => {
	for (const bad of ["", "   ", "C10Xx", "C(a)H", "(C2H4)0", "C-5", "(C2(C3)H4)2"]) {
		assert.throws(() => parseFormula(bad), FormulaParseError, `should reject '${bad}'`);
	}
});

test("molecularWeightFromFormula uses average atomic masses", () => {
	// H2O = 1.008*2 + 15.999
	assert.ok(Math.abs(molecularWeightFromFormula("H2O") - 18.015) < 1e-3);
	// 葡萄糖 C6H12O6
	assert.ok(Math.abs(molecularWeightFromFormula("C6H12O6") - 180.156) < 1e-3);
	// 阿霉素近似 C27H29NO11
	assert.ok(Math.abs(molecularWeightFromFormula("C27H29NO11") - 543.52) < 0.05);
});

test("formulaToString sorts C/H first, drops count 1", () => {
	assert.equal(formulaToString({ O: 1, H: 2, C: 6 }), "C6H2O");
	assert.equal(formulaToString({ C: 1, H: 1 }), "CH");
});

test("normalizeFormula is order-insensitive", () => {
	assert.equal(normalizeFormula("O3C10H12N2"), normalizeFormula("C10H12N2O3"));
	assert.equal(normalizeFormula("C10H12N2O3"), "C10H12N2O3");
});

test("element table covers common pharma/polymer elements", () => {
	for (const el of ["C", "H", "N", "O", "S", "P", "Cl", "F", "Na", "Fe", "Br", "I"]) {
		assert.ok(ELEMENTS[el] > 0, `${el} present`);
	}
});
