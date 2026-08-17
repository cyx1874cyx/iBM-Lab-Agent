import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPatents, lookupCompound, collectOpenEvidence } from "../../src/synthesis/open-sources.js";

test("searchPatents parses PatentsView responses", async () => {
	const fetchImpl = async () => ({
		ok: true,
		json: async () => ({
			patents: [
				{ patent_id: "US1234567B2", patent_title: "Prodrug polymer", patent_date: "2024-01-01", patent_abstract: "A prodrug-conjugated polymer for delivery." }
			]
		})
	});
	const patents = await searchPatents("prodrug polymer", { fetchImpl });
	assert.equal(patents.length, 1);
	assert.equal(patents[0].patentId, "US1234567B2");
	assert.match(patents[0].abstract, /prodrug-conjugated/);
});

test("searchPatents surfaces HTTP errors", async () => {
	const fetchImpl = async () => ({ ok: false, status: 500 });
	await assert.rejects(() => searchPatents("x", { fetchImpl }), /500/);
});

test("lookupCompound delegates to PubChem", async () => {
	const fetchImpl = async () => ({
		ok: true,
		json: async () => ({ PropertyTable: { Properties: [{ CID: 31703, MolecularFormula: "C27H29NO11", MolecularWeight: 543.5, CanonicalSMILES: "...", IUPACName: "doxorubicin" }] } })
	});
	const data = await lookupCompound("doxorubicin", { fetchImpl });
	assert.equal(data.cid, 31703);
});

test("collectOpenEvidence aggregates compound, patent and literature evidence", async () => {
	const deps = {
		fetchImpl: async () => ({
			ok: true,
			json: async () => ({ patents: [{ patent_id: "US1", patent_title: "T", patent_date: "2024", patent_abstract: "a" }] })
		}),
		literature: [{ title: "A paper", doi: "10.1/abc" }]
	};
	const evidence = await collectOpenEvidence({ query: "prodrug", want: ["compound", "patent", "literature"], deps });
	const types = evidence.map((e) => e.type);
	assert.ok(types.includes("compound"));
	assert.ok(types.includes("patent"));
	assert.ok(types.includes("literature"));
	const patent = evidence.find((e) => e.type === "patent");
	assert.equal(patent.source, "PatentsView");
	assert.equal(patent.reference, "US1");
});

test("collectOpenEvidence degrades gracefully on source failure", async () => {
	const deps = {
		fetchImpl: async () => ({ ok: false, status: 503 })
	};
	const evidence = await collectOpenEvidence({ query: "x", want: ["patent"], deps });
	assert.equal(evidence[0].reference, "(lookup failed)");
});
