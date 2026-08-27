import { test } from "node:test";
import assert from "node:assert/strict";
import { authorSurname, normalizeTitle, rankDoiCandidates, titleSimilarity, verifyPaperMatch } from "../../src/literature/search-engine.js";

test("title similarity and author surname helpers support DOI verification", () => {
	assert.equal(normalizeTitle("A Prodrug Polymer Platform for Targeted Delivery"), "prodrug polymer platform targeted delivery");
	assert.equal(authorSurname("Alice Zhang"), "zhang");
	assert.equal(authorSurname("Zhang, Alice"), "zhang");
	assert.equal(authorSurname("王小明"), "王小明");
	assert.ok(titleSimilarity("A prodrug polymer platform", "A prodrug polymer platform") === 1);
	assert.ok(titleSimilarity("A prodrug polymer platform", "Unrelated review article") < 0.5);
});

test("verifyPaperMatch scores title, author surnames and year tolerance", () => {
	const paper = { title: "A prodrug polymer platform for targeted delivery", doi: "10.1000/prodrug.1", authors: ["Alice Zhang", "Bo Li"], year: 2025 };
	const exact = verifyPaperMatch(paper, { title: "A prodrug polymer platform for targeted delivery", authors: ["Alice Zhang", "Bo Li"], year: 2025 });
	assert.equal(exact.titleScore, 1);
	assert.deepEqual(exact.matchedAuthors, ["Alice Zhang", "Bo Li"]);
	assert.equal(exact.yearMatch, 0);
	assert.ok(exact.score >= 95);

	const yearOffByOne = verifyPaperMatch(paper, { title: "A prodrug polymer platform for targeted delivery", authors: ["Alice Zhang"], year: 2026 });
	assert.equal(yearOffByOne.yearMatch, 1);
	assert.equal(yearOffByOne.matchedAuthors.length, 1);

	const differentWork = verifyPaperMatch(paper, { title: "Unrelated review article", authors: ["Xavier Unknown"], year: 2019 });
	assert.ok(differentWork.titleScore < 0.5);
	assert.equal(differentWork.matchedAuthors.length, 0);
});

test("rankDoiCandidates keeps a verified candidate as high and drops unrelated hits", () => {
	const candidates = rankDoiCandidates([
		{ title: "A prodrug polymer platform for targeted drug delivery", doi: "10.1000/prodrug.1", authors: ["Alice Zhang", "Bo Li"], year: 2025, journal: "Biomaterials", volume: "320", pages: "100-112", sources: ["openalex"] },
		{ title: "Unrelated polymer chemistry review", doi: "10.1000/other.1", authors: ["Someone Else"], year: 2020, sources: ["openalex"] }
	], { title: "A prodrug polymer platform for targeted drug delivery", authors: ["Alice Zhang", "Bo Li"], year: 2025 });
	assert.equal(candidates.length, 1);
	const [top] = candidates;
	assert.equal(top.doi, "10.1000/prodrug.1");
	assert.equal(top.confidence, "high");
	assert.equal(top.titleScore, 1);
	assert.deepEqual(top.matchedAuthors, ["Alice Zhang", "Bo Li"]);
	assert.equal(top.yearMatch, 0);
	assert.equal(top.journal, "Biomaterials");
	assert.equal(top.volume, "320");
});

test("rankDoiCandidates sorts by confidence and marks near matches as medium", () => {
	const candidates = rankDoiCandidates([
		{ title: "Prodrug polymer platforms for targeted drug delivery", doi: "10.1000/prodrug.2", authors: ["Alice Zhang", "Bo Li"], year: 2024, sources: ["crossref"] },
		{ title: "A prodrug polymer platform for targeted drug delivery", doi: "10.1000/prodrug.1", authors: ["Alice Zhang", "Bo Li"], year: 2025, journal: "Biomaterials", sources: ["openalex"] }
	], { title: "A prodrug polymer platform for targeted drug delivery", authors: ["Alice Zhang", "Bo Li"], year: 2025 });
	assert.equal(candidates[0].doi, "10.1000/prodrug.1");
	assert.equal(candidates[0].confidence, "high");
	assert.equal(candidates[1].doi, "10.1000/prodrug.2");
	assert.equal(candidates[1].confidence, "medium");
});

test("rankDoiCandidates skips candidates without DOI and tolerates missing author/year hints", () => {
	const candidates = rankDoiCandidates([
		{ title: "A prodrug polymer platform for targeted drug delivery", doi: "10.1000/prodrug.1", authors: ["Alice Zhang"], year: 2025, sources: ["openalex"] },
		{ title: "A prodrug polymer platform for targeted drug delivery", authors: ["Alice Zhang"], year: 2025, sources: ["crossref"] }
	], { title: "A prodrug polymer platform for targeted drug delivery" });
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].confidence, "high");
	assert.equal(candidates[0].doi, "10.1000/prodrug.1");
});
