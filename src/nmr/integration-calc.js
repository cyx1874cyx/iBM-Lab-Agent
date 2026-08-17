/**
 * dsh-lab-agent: NMR 聚合物积分计算（纯 JS 公式层）。
 *
 * 计划 §四/§五：由已审核的 1H NMR 积分计算——
 *   组成（共聚单体摩尔分数）、聚合转化率、端基 DP、取代度、载药量。
 * 输入为"已审核积分"（人工在 Mnova 中确认后的数值），本层只做公式计算，
 * 所有结果标记 sourceKind: "computed" 并注明公式。
 *
 * 约定：积分 I 与每峰对应质子数 n（assignment 记录）一并提供；
 * 摩尔比 = I/n 归一化。
 */

import { computedResult } from "../chemistry/elements.js";

export class NmrCalcError extends Error {
	name = "NmrCalcError";
}

function requirePositive(value, name) {
	if (!Number.isFinite(value) || value <= 0) throw new NmrCalcError(`${name} must be a positive number`);
	return value;
}

/** 归一化摩尔量：积分 / 每峰质子数。 */
export function normalizedMol(integral, protons) {
	requirePositive(integral, "integral");
	requirePositive(protons, "protons");
	return integral / protons;
}

/**
 * 共聚物组成：单体 A 的摩尔分数（f_A）。
 * @param {{ aIntegral, aProtons, bIntegral, bProtons }} 两单体特征峰
 */
export function compositionFromIntegrals({ aIntegral, aProtons, bIntegral, bProtons }) {
	const a = normalizedMol(aIntegral, aProtons);
	const b = normalizedMol(bIntegral, bProtons);
	return computedResult(a / (a + b), "mole fraction of A", "f_A = (I_A/n_A) / (I_A/n_A + I_B/n_B)");
}

/**
 * 聚合转化率：由聚合物特征峰与残留单体积分。
 * p = (I_poly/n_poly) / ((I_poly/n_poly) + (I_rem/n_rem))
 */
export function conversionFromIntegrals({ polyIntegral, polyProtons, residualIntegral, residualProtons }) {
	const poly = normalizedMol(polyIntegral, polyProtons);
	const rem = normalizedMol(residualIntegral, residualProtons);
	return computedResult(poly / (poly + rem), "fraction", "p = (I_poly/n_poly)/((I_poly/n_poly)+(I_rem/n_rem))");
}

/**
 * 端基 DP：DP = (I_repeat/n_repeat) / (I_end/n_end)。
 * 端基积分对应链数（每链端基质子数 n_end）。
 */
export function endGroupDp({ repeatIntegral, repeatProtons, endGroupIntegral, endGroupProtons }) {
	const repeat = normalizedMol(repeatIntegral, repeatProtons);
	const end = normalizedMol(endGroupIntegral, endGroupProtons);
	if (end <= 0) throw new NmrCalcError("end-group normalized mol must be > 0");
	return computedResult(repeat / end, "dimensionless", "DP = (I_repeat/n_repeat)/(I_end/n_end)");
}

/**
 * 取代度 DS%：接枝药物峰 vs 聚合物骨架峰。
 * DS% = (I_drug/n_drug) / (I_polymer/n_polymer) × 100
 * @param availableSitesPerChain 每链可接位点数（用于归一；缺省按 100 占比输出）
 */
export function substitutionFromIntegrals({ drugIntegral, drugProtons, polymerIntegral, polymerProtons, sitesPerChain = 1 }) {
	requirePositive(sitesPerChain, "sitesPerChain");
	const drug = normalizedMol(drugIntegral, drugProtons);
	const polymer = normalizedMol(polymerIntegral, polymerProtons);
	if (drug > polymer * sitesPerChain) {
		throw new NmrCalcError("drug normalized mol exceeds available sites (integral values inconsistent)");
	}
	return computedResult((drug / (polymer * sitesPerChain)) * 100, "%", "DS% = (I_drug/n_drug)/(I_polymer/n_polymer)/sites×100");
}

/**
 * 由取代度推算每链载药数与载药量 DL%。
 * drugCount = sitesPerChain × DS% / 100；DL% 复用聚合物模型公式。
 */
export function drugLoadingFromSubstitution({ dsPercent, sitesPerChain, polymerMw, drugMw }) {
	requirePositive(dsPercent, "dsPercent");
	requirePositive(sitesPerChain, "sitesPerChain");
	requirePositive(polymerMw, "polymerMw");
	requirePositive(drugMw, "drugMw");
	const drugCount = (sitesPerChain * dsPercent) / 100;
	if (drugCount > sitesPerChain) throw new NmrCalcError("DS% > 100%");
	const drugMass = drugMw * drugCount;
	const total = polymerMw + drugMass;
	return computedResult((drugMass / total) * 100, "%", "DL% = drugCount×drugMw/(polymerMw+drugCount×drugMw)×100, drugCount = sites×DS%");
}
