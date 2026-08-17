/**
 * dsh-lab-agent: 化学基础计算（纯 JS，离线可测）。
 *
 * 元素质量表 + 分子式解析 → 平均分子量。RDKit 不可用时仍能提供
 * 分子式级的 MW/元素组成；RDKit（venv）提供 SMILES 级高级性质。
 */

/** 常用元素平均原子量（g/mol）；覆盖药学/高分子常见元素。 */
export const ELEMENTS = {
	H: 1.008, He: 4.003, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011, N: 14.007,
	O: 15.999, F: 18.998, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974,
	S: 32.06, Cl: 35.45, K: 39.098, Ca: 40.078, Ti: 47.867, V: 50.942, Cr: 51.996,
	Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
	Se: 78.971, Br: 79.904, Zr: 91.224, Mo: 95.95, Ag: 107.868, Sn: 118.71,
	I: 126.904, Ba: 137.327, Pt: 195.084, Au: 196.967, Hg: 200.592, Pb: 207.2
};

/** 分子式正则：元素（大写字母+可选小写）+ 可选计数；支持括号组（重复单元）。 */
const TOKEN_RE = /([A-Z][a-z]?)(\d*)/g;
const GROUP_RE = /\(([A-Z][A-Za-z0-9]*)\)(\d*)/g;

export class FormulaParseError extends Error {
	name = "FormulaParseError";
}

/**
 * 解析分子式（如 "C10H12N2O3"、"C6H8O2"），支持平级括号组与下标倍数
 * （如 "(C6H8O2)10" 表示 10 个重复单元）；嵌套括号拒绝。
 * @returns 元素计数对象（键为大写元素符号，值为计数）。
 */
export function parseFormula(formula) {
	if (typeof formula !== "string" || !formula.trim()) throw new FormulaParseError("empty formula");
	let expanded = formula.trim();

	// 嵌套括号拒绝（展开会错误地化解嵌套结构，先整体检查）
	if (/\([^()]*\(/.test(expanded) || /\)[^()]*\)/.test(expanded)) {
		throw new FormulaParseError(`nested parentheses not supported in '${formula}'`);
	}

	// 循环展开所有平级括号组（每轮展开一组；嵌套括号残留会在最终校验时被拒绝）
	let guard = 0;
	while (true) {
		const paren = GROUP_RE.exec(expanded);
		if (!paren) break;
		if (++guard > 20) throw new FormulaParseError(`too many parenthesis groups in '${formula}'`);
		const [, inner, timesRaw] = paren;
		if (inner.includes("(")) throw new FormulaParseError(`nested parentheses not supported in '${formula}'`);
		const times = timesRaw ? Number(timesRaw) : 1;
		if (!Number.isFinite(times) || times <= 0) throw new FormulaParseError(`bad group multiplier in '${formula}'`);
		const expandedInner = inner.replace(TOKEN_RE, (m, el, n) => `${el}${n ? Number(n) * times : times}`);
		expanded = expanded.replace(paren[0], expandedInner);
		GROUP_RE.lastIndex = 0;
	}

	const counts = {};
	let match;
	TOKEN_RE.lastIndex = 0;
	let consumed = 0;
	while ((match = TOKEN_RE.exec(expanded)) !== null) {
		const [, element, countRaw] = match;
		consumed += match[0].length;
		if (ELEMENTS[element] === undefined) throw new FormulaParseError(`unknown element '${element}' in '${formula}'`);
		const count = countRaw ? Number(countRaw) : 1;
		if (!Number.isFinite(count) || count <= 0) throw new FormulaParseError(`bad element count in '${formula}'`);
		counts[element] = (counts[element] ?? 0) + count;
	}
	if (consumed !== expanded.length) throw new FormulaParseError(`cannot fully parse '${formula}'`);
	return counts;
}

/** 平均分子量（g/mol）。 */
export function molecularWeightFromFormula(formula) {
	const counts = parseFormula(formula);
	return Object.entries(counts).reduce((sum, [el, n]) => sum + ELEMENTS[el] * n, 0);
}

/** 分子式 → 可读元素组成（如 "C10H12N2O3"）。 */
export function formulaToString(counts) {
	const order = Object.keys(counts).sort((a, b) => {
		// 碳、氢优先，其余按字母
		const rank = (el) => (el === "C" ? 0 : el === "H" ? 1 : 2);
		return rank(a) - rank(b) || a.localeCompare(b);
	});
	return order.map((el) => `${el}${counts[el] > 1 ? counts[el] : ""}`).join("");
}

/** 规范化分子式：解析后重排（忽略括号/顺序差异）。 */
export function normalizeFormula(formula) {
	return formulaToString(parseFormula(formula));
}

/** 计算结果的统一返回：数值 + 单位 + 派生自（来源说明）。 */
export function computedResult(value, unit, from) {
	return { value, unit, sourceKind: "computed", source: `formula/mass calculation (${from})` };
}
