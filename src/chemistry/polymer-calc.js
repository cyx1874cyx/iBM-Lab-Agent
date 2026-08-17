/**
 * dsh-lab-agent: 聚合物/聚前药派生指标计算（纯 JS 公式层）。
 *
 * 计划 §四 需要输出的带来源指标：Mn/Mw/Đ/DP、取代度、载药量、释放机制。
 * 公式：
 *   Đ   = Mw / Mn
 *   DP  = (Mn - initiatorFragmentMass) / repeatUnitMw   （数均聚合度）
 *   DL% = drugMass / (polymerMass + drugMass) × 100      （载药量）
 *   DS% = drugCount / availableSites × 100               （取代度）
 * 所有结果标记 sourceKind: "computed" 并注明公式来源。
 */

import { computedResult } from "./elements.js";

export class PolymerCalcError extends Error {
	name = "PolymerCalcError";
}

/** 输入校验与单位辅助。 */
function requirePositive(value, name) {
	if (!Number.isFinite(value) || value <= 0) throw new PolymerCalcError(`${name} must be a positive number`);
	return value;
}
function requireNonNegative(value, name) {
	if (!Number.isFinite(value) || value < 0) throw new PolymerCalcError(`${name} must be a non-negative number`);
	return value;
}

/** Đ = Mw/Mn（分散度）。 */
export function polydispersity(Mw, Mn) {
	requirePositive(Mn, "Mn");
	requirePositive(Mw, "Mw");
	if (Mw < Mn) throw new PolymerCalcError("Mw must be >= Mn");
	return computedResult(Mw / Mn, "dimensionless", "Đ = Mw/Mn");
}

/** 数均聚合度 DP = (Mn - initiatorFragmentMass) / repeatUnitMw。 */
export function degreeOfPolymerization({ Mn, repeatUnitMw, initiatorFragmentMass = 0 }) {
	requirePositive(Mn, "Mn");
	requirePositive(repeatUnitMw, "repeatUnitMw");
	requireNonNegative(initiatorFragmentMass, "initiatorFragmentMass");
	if (initiatorFragmentMass >= Mn) throw new PolymerCalcError("initiatorFragmentMass must be < Mn");
	if (Mn - initiatorFragmentMass < repeatUnitMw) {
		throw new PolymerCalcError("Mn too small for the repeat unit mass (DP < 1)");
	}
	return computedResult((Mn - initiatorFragmentMass) / repeatUnitMw, "dimensionless", "DP = (Mn - initiator)/repeatUnitMw");
}

/**
 * 载药量 DL%（简化偶联物模型：总质量 = 聚合物质量 + 载药质量）。
 * @param polymerMw 聚合物（未载药）分子量
 * @param drugMw 药物分子量
 * @param drugCount 每链载药数
 */
export function drugLoading({ polymerMw, drugMw, drugCount }) {
	requirePositive(polymerMw, "polymerMw");
	requirePositive(drugMw, "drugMw");
	requireNonNegative(drugCount, "drugCount");
	const drugMass = drugMw * drugCount;
	const total = polymerMw + drugMass;
	return computedResult((drugMass / total) * 100, "%", "DL% = drugMass/(polymerMass+drugMass)×100");
}

/** 取代度 DS% = drugCount / availableSites × 100。 */
export function substitutionDegree({ drugCount, availableSites }) {
	requireNonNegative(drugCount, "drugCount");
	requirePositive(availableSites, "availableSites");
	if (drugCount > availableSites) throw new PolymerCalcError("drugCount must be <= availableSites");
	return computedResult((drugCount / availableSites) * 100, "%", "DS% = drugCount/availableSites×100");
}

/** 由 Mn 与 Đ 反推 Mw。 */
export function weightAverageFrom({ Mn, dispersity }) {
	requirePositive(Mn, "Mn");
	requirePositive(dispersity, "dispersity");
	if (dispersity < 1) throw new PolymerCalcError("dispersity must be >= 1");
	return computedResult(Mn * dispersity, "g/mol", "Mw = Mn × Đ");
}

/** 理论分子量 = 重复单元质量 × DP + 端基修正。 */
export function theoreticalMn({ repeatUnitMw, dp, initiatorFragmentMass = 0 }) {
	requirePositive(repeatUnitMw, "repeatUnitMw");
	requirePositive(dp, "dp");
	requireNonNegative(initiatorFragmentMass, "initiatorFragmentMass");
	return computedResult(repeatUnitMw * dp + initiatorFragmentMass, "g/mol", "Mn = repeatUnitMw×DP + initiator");
}

/** 单体转化率 p = 1 - (Mn_target / Mn_observed) 的倒置由 NMR 阶段给出；此处提供定义占位。 */
export function conversionFromMn({ targetMn, observedMn }) {
	requirePositive(targetMn, "targetMn");
	requirePositive(observedMn, "observedMn");
	if (observedMn < targetMn) throw new PolymerCalcError("observedMn must be >= targetMn");
	return computedResult(1 - targetMn / observedMn, "fraction", "p ≈ 1 - targetMn/observedMn (end-group assumption)");
}
