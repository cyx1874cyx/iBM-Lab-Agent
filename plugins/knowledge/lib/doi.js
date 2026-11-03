/**
 * DOI 归一化（插件内副本）。
 *
 * 与母包 `src/literature/search-engine.js` 的 normalizeDoi 保持逐字等价；
 * tests 里有 parity 测试防止两边漂移。知识库只做标识比对，不承担文献检索。
 */
const DOI_RE = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;

export function normalizeDoi(value) {
	if (!value) return undefined;
	const match = String(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").match(DOI_RE);
	return match?.[0].replace(/[.,;:)\]]+$/, "").toLowerCase();
}
