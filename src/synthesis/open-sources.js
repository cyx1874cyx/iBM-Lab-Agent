/**
 * dsh-lab-agent: 合成路线开放数据源适配器。
 *
 * 首版开放数据（计划 §七）：
 *   - 文献：OpenAlex（经 nature-academic-search，见 src/skill-executor.js）；
 *   - 化合物：PubChem PUG-REST（复用 src/chemistry/rdkit-pubchem.js）；
 *   - 专利：USPTO PatentsView 开放 API（无 key）。
 *
 * 注意：PatentsView 正迁移至 USPTO Open Data Portal（api.patentsview.org 已
 * 301 到 ODP 门户）；适配器保持可插拔（fetchImpl 注入、按端点封装），迁移时
 * 只替换默认端点的实现，不改变服务契约。所有网络路径在自动化测试中以 stub
 * 代替。
 */

import { lookupPubChem } from "../chemistry/rdkit-pubchem.js";

/**
 * PatentsView 查询（默认端点；无 key 开放）。
 * @param {{ fetchImpl?: typeof fetch }} options
 */
export async function searchPatents(query, { fetchImpl = fetch, perPage = 5, endpoint = "https://api.patentsview.org/patents/query" } = {}) {
	const q = encodeURIComponent(JSON.stringify({ text: { patent_abstract: query } }));
	const f = encodeURIComponent(JSON.stringify(["patent_id", "patent_title", "patent_date", "patent_abstract"]));
	const o = encodeURIComponent(JSON.stringify({ per_page: perPage }));
	const url = `${endpoint}?q=${q}&f=${f}&o=${o}`;
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`PatentsView query failed (${response.status})`);
	const body = await response.json();
	const patents = body?.patents ?? [];
	return patents.map((p) => ({
		patentId: p.patent_id,
		title: p.patent_title,
		date: p.patent_date,
		abstract: p.patent_abstract?.slice(0, 300)
	}));
}

/** 化合物开放数据查询（PubChem，db-measured）。 */
export async function lookupCompound(name, { fetchImpl = fetch } = {}) {
	return await lookupPubChem(name, { fetchImpl });
}

/** 路线证据统一入口：按证据类型分发到对应开放数据源。 */
export async function collectOpenEvidence({ query, want = ["literature", "patent", "compound"], deps = {} } = {}) {
	const evidence = [];
	if (want.includes("compound")) {
		try {
			const compound = await lookupCompound(query, deps);
			evidence.push({
				type: "compound",
				source: "PubChem",
				reference: `PubChem CID ${compound.cid}`,
				notes: compound.formula ? `${compound.formula}, MW ${compound.molecularWeight}` : ""
			});
		} catch (error) {
			evidence.push({ type: "compound", source: "PubChem", reference: "(lookup failed)", notes: error.message });
		}
	}
	if (want.includes("patent")) {
		try {
			const patents = await searchPatents(query, deps);
			for (const p of patents.slice(0, 3)) {
				evidence.push({ type: "patent", source: "PatentsView", reference: p.patentId, notes: p.title });
			}
		} catch (error) {
			evidence.push({ type: "patent", source: "PatentsView", reference: "(lookup failed)", notes: error.message });
		}
	}
	// literature（OpenAlex）由调用方经 nature-academic-search 提供或经 skill-executor
	if (deps.literature) {
		for (const item of deps.literature) {
			evidence.push({ type: "literature", source: "OpenAlex", reference: item.doi ?? item.title, notes: item.title });
		}
	}
	return evidence;
}
