import { test } from "node:test";
import assert from "node:assert/strict";
import {
	classifyLiteratureQuery,
	buildPubMedQuery,
	describePaperZh,
	deduplicatePapers,
	normalizeDoi,
	searchAcademicLiterature
} from "../../src/literature/search-engine.js";

function json(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

test("identifier router recognizes DOI, PMID and arXiv IDs", () => {
	assert.deepEqual(classifyLiteratureQuery("https://doi.org/10.1038/S41586-024-07334-Y"), { kind: "doi", value: "10.1038/s41586-024-07334-y" });
	assert.deepEqual(classifyLiteratureQuery("PMID: 38212345"), { kind: "pmid", value: "38212345" });
	assert.deepEqual(classifyLiteratureQuery("arXiv:1706.03762"), { kind: "arxiv", value: "1706.03762" });
	assert.equal(classifyLiteratureQuery("base editing sickle cell disease").kind, "query");
	assert.equal(normalizeDoi("https://doi.org/10.1000/ABC.1"), "10.1000/abc.1");
});

test("PubMed natural query becomes AND-ed concept groups", () => {
	assert.equal(
		buildPubMedQuery("CRISPR base editing sickle cell disease"),
		'"sickle cell disease"[Title/Abstract] AND "base editing"[Title/Abstract] AND crispr[Title/Abstract]'
	);
});

test("paper labels require an abstract takeaway rather than a document type", () => {
	assert.equal(describePaperZh({ title: "A wearable electrochemical sensor device" }), "摘要待提炼");
	assert.equal(describePaperZh({ shortDescriptionZh: "传感器件" }), "摘要待提炼");
	assert.equal(describePaperZh({ shortDescriptionZh: "可穿戴电化学传感" }), "可穿戴电化学传感");
	assert.ok([...describePaperZh({ shortDescriptionZh: "超长自定义中文摘要核心内容" })].length < 10);
});

test("dedup uses DOI first and merges provider/OA metadata", () => {
	const results = deduplicatePapers([
		{ title: "A complete paper", doi: "10.1000/Test", authors: ["A Chemist"], journal: "Journal A", shortDescriptionZh: "增强界面稳定性", sources: ["crossref"] },
		{ title: "A complete paper", doi: "https://doi.org/10.1000/test", authors: ["A Chemist"], volume: "630", pages: "84-90", abstract: "Full abstract", isOa: true, pdfUrl: "https://example.org/paper.pdf", sources: ["openalex"] }
	]);
	assert.equal(results.length, 1);
	assert.deepEqual(new Set(results[0].sources), new Set(["crossref", "openalex"]));
	assert.equal(results[0].journal, "Journal A");
	assert.equal(results[0].volume, "630");
	assert.equal(results[0].pages, "84-90");
	assert.equal(results[0].isOa, true);
	assert.equal(results[0].shortDescriptionZh, "增强界面稳定性");
	assert.match(results[0].pdfUrl, /paper\.pdf/);
});

test("arXiv metadata wins over a later OpenAlex mirror for the same preprint", () => {
	const [paper] = deduplicatePapers([
		{ title: "Attention Is All You Need", doi: "10.65215/mirror", authors: ["Ashish Vaswani"], year: 2025, publicationDate: "2025-08-23", type: "preprint", isOa: true, sources: ["openalex"] },
		{ id: "https://arxiv.org/abs/1706.03762v7", title: "Attention Is All You Need", arxivId: "1706.03762v7", authors: ["Ashish Vaswani"], year: 2017, publicationDate: "2017-06-12", journal: "arXiv", type: "preprint", isOa: true, pdfUrl: "https://arxiv.org/pdf/1706.03762v7", sources: ["arxiv"] }
	]);
	assert.equal(paper.year, 2017);
	assert.equal(paper.doi, undefined);
	assert.equal(paper.arxivId, "1706.03762v7");
	assert.equal(paper.journal, "arXiv");
});

test("keyword OA search strictly removes closed/unknown records and merges Crossref metadata", async () => {
	const fetchImpl = async (url) => {
		const value = String(url);
		if (value.includes("api.openalex.org")) return json({ results: [
			{ id: "https://openalex.org/W1", display_name: "Open polymer paper", doi: "https://doi.org/10.1000/open", publication_year: 2024, open_access: { is_oa: true, oa_status: "gold" }, best_oa_location: { pdf_url: "https://example.org/open.pdf", landing_page_url: "https://example.org/open" }, primary_location: { source: { display_name: "Polymer Journal" } }, authorships: [{ author: { display_name: "A Author" } }] },
			{ id: "https://openalex.org/W2", display_name: "Closed polymer paper", doi: "https://doi.org/10.1000/closed", publication_year: 2024, open_access: { is_oa: false }, authorships: [] }
		] });
		if (value.includes("api.crossref.org")) return json({ message: { items: [
			{ title: ["Open polymer paper"], DOI: "10.1000/OPEN", author: [{ given: "A", family: "Author" }], "container-title": ["Polymer Journal"], abstract: "A useful polymer abstract", URL: "https://doi.org/10.1000/open", issued: { "date-parts": [[2024, 1, 2]] } },
			{ title: ["Unknown access polymer paper"], DOI: "10.1000/unknown", URL: "https://doi.org/10.1000/unknown", issued: { "date-parts": [[2023]] } }
		] } });
		throw new Error(`unexpected URL ${value}`);
	};
	const results = await searchAcademicLiterature("open polymer paper", { sources: ["openalex", "crossref"], oaOnly: true, limit: 10, fetchImpl });
	assert.equal(results.length, 1);
	assert.equal(results[0].doi, "10.1000/open");
	assert.equal(results[0].isOa, true);
	assert.equal(results[0].abstract, "A useful polymer abstract");
	assert.deepEqual(new Set(results[0].sources), new Set(["openalex", "crossref"]));
});

test("exact DOI lookup ranks the canonical match first even when it is closed", async () => {
	const fetchImpl = async (url) => {
		const value = String(url);
		if (value.includes("api.openalex.org")) return json({ id: "https://openalex.org/W3", display_name: "Exact DOI paper", doi: "https://doi.org/10.1038/example", publication_year: 2024, open_access: { is_oa: false }, primary_location: { source: { display_name: "Nature" } }, authorships: [] });
		if (value.includes("api.crossref.org")) return json({ message: { title: ["Exact DOI paper"], DOI: "10.1038/example", "container-title": ["Nature"], URL: "https://doi.org/10.1038/example", issued: { "date-parts": [[2024]] } } });
		throw new Error(`unexpected URL ${value}`);
	};
	const results = await searchAcademicLiterature("10.1038/example", { sources: ["openalex", "crossref"], oaOnly: true, limit: 10, fetchImpl });
	assert.equal(results[0].doi, "10.1038/example");
	assert.equal(results[0].isOa, false);
	assert.ok(results[0].score >= 1000);
});
