import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompoundDual, validCas, normalizeCanonical, lookupCactus } from "../../src/synthesis/compound-resolve.js";

/** 测试 stub：记录被禁止的“原始字符串相等”路径（rc.4 双源只按化学身份比较）。 */
function dual(pubchem, cactus, deps = {}) {
	return resolveCompoundDual("sample", { pubchem: async () => pubchem, cactus: async () => cactus, ...deps });
}

test("CAS checksum is enforced (format alone is not enough)", () => {
	assert.equal(validCas("64-17-5"), true); // 乙醇：校验位正确
	assert.equal(validCas("7732-18-5"), true); // 水
	assert.equal(validCas("64-17-4"), false, "校验位错误必须拒绝");
	assert.equal(validCas("64-17-6"), false);
	assert.equal(validCas("50-00-0"), true); // 甲醛
	assert.equal(validCas("50-00-1"), false);
	assert.equal(validCas("ethanol"), false);
	assert.equal(validCas("23214-92-8"), true); // 阿霉素
	assert.equal(validCas("9000-000-0"), false);
});

test("dual resolver confirms only matching PubChem and CACTUS structures via standard InChIKey", async () => {
	const result = await dual(
		{ canonicalSmiles: "CCO", cid: 702, inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
		{ smiles: "CCO", inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" }
	);
	assert.equal(result.status, "dual-confirmed");
	assert.equal(result.smiles, "CCO");
	assert.equal(result.inchiKey, "LFQSCWFLJHTTHZ-UHFFFAOYSA-N");
});

test("dual resolver treats same structure with different SMILES spellings as consistent (no raw string compare)", async () => {
	// 苯：凯库勒 vs 芳香写法，同一结构（相同 InChIKey），原始字符串并不相等
	const aromatic = await dual(
		{ canonicalSmiles: "C1=CC=CC=C1", cid: 241, inchiKey: "UHOVQNZJYSORNB-UHFFFAOYSA-N" },
		{ smiles: "c1ccccc1", inchiKey: "UHOVQNZJYSORNB-UHFFFAOYSA-N" }
	);
	assert.equal(aromatic.status, "dual-confirmed", "芳香环大小写差异不应判冲突");

	// 支链顺序不同：2-甲基丙烷写法（异丁烷）vs 主链不同但同构
	const branched = await dual(
		{ canonicalSmiles: "CC(C)C", cid: 6360, inchiKey: "NNNOCUZUQCJZKI-UHFFFAOYSA-N" },
		{ smiles: "CCC(C)C", inchiKey: "NNNOCUZUQCJZKI-UHFFFAOYSA-N" }
	);
	assert.equal(branched.status, "dual-confirmed", "支链顺序不同仍为同一结构");
});

test("dual resolver detects real conflicts even when raw strings would differ or match superficially", async () => {
	// 真正冲突：乙醇 vs 二甲醚——InChIKey 不同
	const realConflict = await dual(
		{ canonicalSmiles: "CCO", cid: 702, inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
		{ smiles: "COC", inchiKey: "ARXXJIOBOMRVBT-UHFFFAOYSA-N" }
	);
	assert.equal(realConflict.status, "conflict");
	assert.equal(realConflict.smiles, undefined, "冲突不返回任何结构");
});

test("dual resolver compares canonical identity after local chemical normalization when a source lacks key", async () => {
	// CACTUS 无 key → 用注入 canonizer 规范化后比较；两个不同原始写法同构
	const canonizer = async (smiles) => {
		const table = {
			"CCO": { canonicalSmiles: "CCO", inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
			"OCC": { canonicalSmiles: "CCO", inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" }
		};
		const hit = table[String(smiles).trim()];
		if (hit) return hit;
		throw new Error(`canonizer cannot parse ${smiles}`);
	};
	const normalized = await dual(
		{ canonicalSmiles: "CCO", cid: 702, inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
		{ smiles: "OCC" },
		{ canonizer }
	);
	assert.equal(normalized.status, "dual-confirmed", "本地化学规范化后同构 → dual-confirmed");
});

test("dual resolver never fabricates agreement when normalization is unavailable", async () => {
	// CACTUS 只有原始 SMILES 且无 canonizer/rdkit → 无法化学规范化 → unresolved（不许字符串相等误判）
	const result = await dual(
		{ canonicalSmiles: "CCO", cid: 702, inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" },
		{ smiles: "CCO" }
	);
	assert.equal(result.status, "unresolved", "缺 key 且无本地规范化器 → unresolved，不因字符串相同而 dual-confirmed");
	assert.match(result.reason, /chemical normalization|InChIKey|unavailable/i);
});

test("stereochemistry differences are real conflicts", async () => {
	// L-丙氨酸 vs D-丙氨酸：InChIKey 不同（立体化学参与）
	const stereo = await dual(
		{ canonicalSmiles: "C[C@@H](C(=O)O)N", inchiKey: "QNAYBMKLOCPYGJ-REOHCLBHSA-N" },
		{ smiles: "C[C@H](C(=O)O)N", inchiKey: "QNAYBMKLOCPYGJ-SCSAIBSYSA-N" }
	);
	assert.equal(stereo.status, "conflict");
});

test("dual resolver records both sources for single-source candidates (no silent auto-write)", async () => {
	const pubchemOnly = await dual(
		{ canonicalSmiles: "CCC(C(=O)OCC)(C)C", cid: 1, inchiKey: "XYYHZMKHFUVLHY-UHFFFAOYSA-N" },
		null
	);
	assert.equal(pubchemOnly.status, "single-source");
	assert.equal(pubchemOnly.smiles, "CCC(C(=O)OCC)(C)C");
	assert.ok(pubchemOnly.sources.pubchem.smiles);
	assert.ok(pubchemOnly.sources.cactus.error);

	const cactusOnly = await dual(null, { smiles: "CC(C)(C#N)N=NC(C)(C)C#N", inchiKey: "XYYHZMKHFUVLHY-UHFFFAOYSA-N" });
	assert.equal(cactusOnly.status, "single-source");
	assert.equal(cactusOnly.smiles, "CC(C)(C#N)N=NC(C)(C)C#N");
	assert.ok(cactusOnly.sources.pubchem.error);
	assert.ok(cactusOnly.sources.cactus.smiles);
});

test("dual resolver keeps unresolved when both sources miss (nothing auto-written)", async () => {
	const manual = await resolveCompoundDual("unknown-compound", {
		pubchem: async () => { throw new Error("pubchem 404"); },
		cactus: async () => { throw new Error("cactus 404"); }
	});
	assert.equal(manual.status, "unresolved");
	assert.equal(manual.smiles, undefined);
	assert.ok(manual.sources.pubchem.error && manual.sources.cactus.error);
});

test("dual resolver rejects empty identifiers and honors CAS provenance", async () => {
	await assert.rejects(() => resolveCompoundDual("   ", { pubchem: async () => ({}), cactus: async () => ({}) }), /name or CAS required/);
	// 入参为合法 CAS → casNumber 来自 query（不自查也不改名）
	const byCas = await resolveCompoundDual("64-17-5", {
		pubchem: async () => ({ canonicalSmiles: "CCO", cid: 702, inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" }),
		cactus: async () => ({ smiles: "CCO", inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" })
	});
	assert.equal(byCas.status, "dual-confirmed");
	assert.equal(byCas.casNumber, "64-17-5");
	assert.equal(byCas.casSource, "query");
	// PubChem 携带可追溯 CAS（校验位通过）→ casSource=pubchem-synonym
	const byName = await resolveCompoundDual("ethanol", {
		pubchem: async () => ({ canonicalSmiles: "CCO", cid: 702, inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N", casNumber: "64-17-5" }),
		cactus: async () => ({ smiles: "CCO", inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" })
	});
	assert.equal(byName.casNumber, "64-17-5");
	assert.equal(byName.casSource, "pubchem-synonym");
});

test("CACTUS key lookup is optional: smiles alone still returns single-source candidate", async () => {
	let calls = 0;
	const fetchImpl = async (url) => {
		calls += 1;
		if (url.includes("/stdinchikey")) throw new Error("key endpoint down");
		return { ok: true, text: async () => "CCO" };
	};
	const out = await lookupCactus("ethanol", { fetchImpl });
	assert.equal(out.smiles, "CCO");
	assert.equal(out.inchiKey, undefined, "key 端点失败不致命");
	assert.ok(calls >= 1);
});

test("normalizeCanonical returns actionable errors without crashing on bad input", async () => {
	const missing = await normalizeCanonical("  ", { canonizer: async () => ({}) });
	assert.equal(missing.status, "error");
	const badCanon = await normalizeCanonical("CCO", { canonizer: async () => { throw new Error("boom"); } });
	assert.equal(badCanon.status, "error");
	assert.match(badCanon.error, /boom/);
	const noNorm = await normalizeCanonical("CCO");
	assert.equal(noNorm.status, "unavailable");
	assert.match(noNorm.error, /no chemical normalizer/i);
});
