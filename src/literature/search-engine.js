/** Public academic-search providers with a canonical result contract. */
import { XMLParser } from "fast-xml-parser";

export const DEFAULT_SOURCES = ["openalex", "crossref", "pubmed", "arxiv"];
const STOPWORDS = new Set(["a", "an", "the", "in", "of", "for", "on", "to", "and", "with", "by", "et", "al"]);
const DOI_RE = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
const ARXIV_RE = /(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?)/i;
const SCIENTIFIC_PHRASES = [
	"sickle cell disease", "continuous in vivo monitoring", "electrochemical aptamer", "perovskite solar cell",
	"base editing", "prime editing", "gene editing", "gene therapy", "drug delivery", "solar cell",
	"in vivo", "in vitro", "machine learning", "deep learning", "large language model"
].sort((a, b) => b.length - a.length);

const asList = (value) => value == null ? [] : (Array.isArray(value) ? value : [value]);
const rawText = (value) => {
	if (value == null) return undefined;
	const primitive = typeof value === "object" ? value["#text"] ?? value._ ?? value.value : value;
	return primitive == null ? undefined : String(primitive);
};
const clean = (value) => rawText(value)?.replace(/\s+/g, " ").trim() || undefined;

function safeUrl(value) {
	if (!value) return undefined;
	try {
		const url = new URL(String(value));
		return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
	} catch { return undefined; }
}

export function normalizeDoi(value) {
	if (!value) return undefined;
	const match = String(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").match(DOI_RE);
	return match?.[0].replace(/[.,;:)\]]+$/, "").toLowerCase();
}

export function classifyLiteratureQuery(query) {
	const value = String(query ?? "").trim();
	const strippedDoi = value.replace(/^(?:doi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, "");
	const doi = normalizeDoi(strippedDoi);
	if (doi && strippedDoi.match(DOI_RE)?.[0] === strippedDoi) return { kind: "doi", value: doi };
	const pmid = value.match(/^(?:pmid\s*:?\s*)?(\d{6,9})$/i);
	if (pmid) return { kind: "pmid", value: pmid[1] };
	const arxiv = value.match(ARXIV_RE);
	if (arxiv && arxiv[0].trim().length === value.length) return { kind: "arxiv", value: arxiv[1] };
	return { kind: "query", value };
}

export function normalizeTitle(value) {
	return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/).filter((token) => token && !STOPWORDS.has(token)).join(" ");
}

const GENERIC_PAPER_LABELS = new Set([
	"相关研究", "相关综述", "传感器件", "成像方法", "制备方法", "治疗方法",
	"递送体系", "稳定性研究", "作用机制", "研究方法"
]);

/** AI-authored abstract takeaway for a paper card (strictly fewer than 10 chars). */
export function describePaperZh(record) {
	const provided = String(record?.shortDescriptionZh ?? "").replace(/[（）()\s]/g, "").trim();
	if (provided && !GENERIC_PAPER_LABELS.has(provided)) return [...provided].slice(0, 9).join("");
	return "摘要待提炼";
}

/** Build conservative PubMed Title/Abstract AND groups from a natural query. */
export function buildPubMedQuery(query) {
	const original = String(query ?? "").trim();
	if (!original || /\[[a-z/ ]+\]|\b(?:AND|OR|NOT)\b/.test(original)) return original;
	let remainder = ` ${original.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ")} `;
	const concepts = [];
	for (const phrase of SCIENTIFIC_PHRASES) {
		if (!remainder.includes(` ${phrase} `)) continue;
		concepts.push(phrase);
		remainder = remainder.replace(` ${phrase} `, " ");
	}
	for (const token of remainder.split(/\s+/).filter(Boolean)) {
		if (!STOPWORDS.has(token) && token.length > 1) concepts.push(token);
	}
	const unique = [...new Set(concepts)].slice(0, 8);
	if (unique.length < 2) return original;
	return unique.map((concept) => concept.includes(" ") ? `\"${concept}\"[Title/Abstract]` : `${concept}[Title/Abstract]`).join(" AND ");
}

export function titleSimilarity(a, b) {
	const left = new Set(normalizeTitle(a).split(" ").filter(Boolean));
	const right = new Set(normalizeTitle(b).split(" ").filter(Boolean));
	const union = new Set([...left, ...right]);
	if (!union.size) return 0;
	let intersection = 0;
	for (const token of left) if (right.has(token)) intersection += 1;
	return intersection / union.size;
}

/** 作者姓氏：兼容 "Given Family" 与 "Family, Given" 两种写法，返回小写纯字母数字姓氏。 */
export function authorSurname(author) {
	const value = String(author ?? "").toLowerCase().trim();
	if (!value) return "";
	return (value.includes(",") ? value.split(",")[0] : value.split(/\s+/).at(-1))?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
}

function firstAuthorSurname(paper) {
	return authorSurname(paper.authors?.[0]);
}

/**
 * 用外部来源元数据（如公众号页面提取的题名/作者/年份）校验一篇检索候选是否
 * 是同一篇论文。返回 0–1 标题相似度、作者姓氏重合数与年份差值，以及加权评分
 * （标题 60%、作者最多 2 位各 25%、年份吻合 15%）。纯函数，供 DOI 检索校验与
 * 去重之外的匹配场景复用。
 */
export function verifyPaperMatch(paper, { title, authors = [], year } = {}) {
	const expectedTitle = normalizeTitle(title);
	const titleScore = expectedTitle ? titleSimilarity(paper.title ?? "", expectedTitle) : undefined;
	const surnames = new Set((Array.isArray(authors) ? authors : []).map(authorSurname).filter(Boolean));
	const matchedAuthors = (paper.authors ?? []).filter((author) => surnames.has(authorSurname(author)));
	const expectedYear = year == null || year === "" ? undefined : Number(year);
	const yearMatch = Number.isInteger(expectedYear) && Number.isInteger(paper.year) ? Math.abs(paper.year - expectedYear) : undefined;
	const score = (titleScore ?? 0) * 60 + Math.min(matchedAuthors.length, 2) * 25 + (yearMatch === 0 ? 15 : yearMatch === 1 ? 5 : 0);
	return { titleScore, matchedAuthors, yearMatch, score };
}

/**
 * 对一次检索结果做 DOI 匹配校验：保留有 DOI 且标题相似度 ≥ 0.5 的候选，
 * 按「标题 ≥0.9 且有作者/年份佐证（或无作者线索）→ high；标题 ≥0.7 且有
 * 佐证 → medium；其余 → low」分级，并先按置信度再按标题相似度排序。
 * 纯函数，供微信公众号 DOI 检索校验（resolveWechatPaperDoi）使用。
 */
export function rankDoiCandidates(results, { title, authors = [], year } = {}) {
	const normalizedAuthors = (Array.isArray(authors) ? authors : []).map(authorSurname).filter(Boolean);
	const candidates = [];
	for (const paper of results ?? []) {
		const match = verifyPaperMatch(paper, { title, authors, year });
		if (!paper.doi || (match.titleScore ?? 0) < 0.5) continue;
		const authorBacked = match.matchedAuthors.length > 0;
		const yearBacked = match.yearMatch === 0;
		let confidence = "low";
		if ((match.titleScore ?? 0) >= 0.9 && (authorBacked || yearBacked || normalizedAuthors.length === 0)) confidence = "high";
		else if ((match.titleScore ?? 0) >= 0.7 && (authorBacked || yearBacked || match.yearMatch === 1)) confidence = "medium";
		candidates.push({
			doi: paper.doi,
			title: paper.title,
			authors: paper.authors ?? [],
			journal: paper.journal,
			year: paper.year,
			volume: paper.volume,
			issue: paper.issue,
			pages: paper.pages,
			publicationDate: paper.publicationDate,
			confidence,
			titleScore: Math.round((match.titleScore ?? 0) * 1000) / 1000,
			matchedAuthors: match.matchedAuthors,
			yearMatch: match.yearMatch
		});
	}
	const rank = { high: 3, medium: 2, low: 1 };
	candidates.sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.titleScore - a.titleScore);
	return candidates;
}

function abstractFromIndex(index) {
	if (!index || typeof index !== "object") return undefined;
	const words = [];
	for (const [word, positions] of Object.entries(index)) for (const position of positions ?? []) words[position] = word;
	return clean(words.join(" "));
}

const canonicalSources = (value, fallback) => [...new Set([...(Array.isArray(value) ? value : []), ...(fallback ? [fallback] : [])].filter(Boolean).map(String))];

export function canonicalizePaper(record, fallbackSource = "openalex") {
	const journal = clean(record.journal ?? record.containerTitle ?? record.primary_location?.source?.display_name ?? (record.sources ? undefined : record.source));
	const sources = canonicalSources(record.sources, record.provider ?? fallbackSource);
	const doi = normalizeDoi(record.doi ?? record.DOI);
	const rawAuthors = record.authors ?? record.authorships ?? [];
	const authors = asList(rawAuthors).map((author) => clean(author?.author?.display_name ?? author?.name ?? author)).filter(Boolean);
	const rawYear = Number(record.year ?? record.publication_year);
	const rawCitations = Number(record.citations ?? record.cited_by_count);
	const pdfUrl = safeUrl(record.pdfUrl ?? record.pdf_url ?? record.best_oa_location?.pdf_url);
	return {
		id: clean(record.id), title: clean(record.title ?? record.display_name) ?? "untitled", doi,
		pmid: clean(record.pmid), arxivId: clean(record.arxivId ?? record.arxiv_id), authors,
		year: Number.isInteger(rawYear) ? rawYear : undefined,
		publicationDate: clean(record.publicationDate ?? record.publication_date ?? record.published),
		journal, volume: clean(record.volume), issue: clean(record.issue), pages: clean(record.pages ?? record.page),
		abstract: clean(record.abstract), citations: Number.isFinite(rawCitations) ? Math.max(0, rawCitations) : undefined,
		type: clean(record.type), source: journal ?? sources[0] ?? fallbackSource, sources,
		isOa: typeof record.isOa === "boolean" ? record.isOa : record.open_access?.is_oa,
		oaStatus: clean(record.oaStatus ?? record.oa_status ?? record.open_access?.oa_status), pdfUrl,
		landingUrl: safeUrl(record.landingUrl ?? record.landing_url ?? record.url ?? record.best_oa_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : undefined)),
		license: clean(record.license), version: clean(record.version ?? record.best_oa_location?.version),
		pdfStatus: clean(record.pdfStatus) ?? (pdfUrl ? "candidate" : "unavailable"),
		shortDescriptionZh: describePaperZh(record),
		score: Number.isFinite(Number(record.score ?? record.relevance_score)) ? Number(record.score ?? record.relevance_score) : undefined,
		_providerRank: Number.isFinite(record._providerRank) ? record._providerRank : 999
	};
}

export function normalizeOpenAlexWork(work, rank = 0) {
	const location = work.best_oa_location ?? work.primary_location ?? {};
	return canonicalizePaper({ id: work.id, title: work.display_name ?? work.title, doi: work.doi, authors: work.authorships,
		year: work.publication_year, publicationDate: work.publication_date, journal: work.primary_location?.source?.display_name,
		volume: work.biblio?.volume, issue: work.biblio?.issue,
		pages: work.biblio?.first_page ? `${work.biblio.first_page}${work.biblio.last_page && work.biblio.last_page !== work.biblio.first_page ? `-${work.biblio.last_page}` : ""}` : undefined,
		abstract: abstractFromIndex(work.abstract_inverted_index), citations: work.cited_by_count, type: work.type,
		isOa: work.open_access?.is_oa, oaStatus: work.open_access?.oa_status, pdfUrl: location.pdf_url,
		landingUrl: location.landing_page_url ?? work.id, license: location.license, version: location.version,
		provider: "openalex", _providerRank: rank }, "openalex");
}

export function normalizeCrossrefWork(work, rank = 0) {
	const licenses = asList(work.license);
	const isOa = licenses.some((item) => /creativecommons\.org/i.test(item?.URL ?? item?.url ?? item));
	const pdf = asList(work.link).find((item) => /pdf/i.test(item?.["content-type"] ?? ""));
	const date = work.published?.["date-parts"]?.[0] ?? work.issued?.["date-parts"]?.[0] ?? [];
	return canonicalizePaper({ id: work.URL, title: asList(work.title)[0], doi: work.DOI,
		authors: asList(work.author).map((a) => clean([a.given, a.family].filter(Boolean).join(" "))).filter(Boolean),
		year: date[0], publicationDate: date.length ? date.map((part, i) => String(part).padStart(i ? 2 : 4, "0")).join("-") : undefined,
		journal: asList(work["container-title"])[0], volume: work.volume, issue: work.issue, pages: work.page,
		abstract: work.abstract?.replace(/<[^>]+>/g, " "),
		citations: work["is-referenced-by-count"], type: work.type, isOa: isOa || undefined,
		oaStatus: isOa ? "publisher" : undefined, pdfUrl: isOa ? pdf?.URL : undefined, landingUrl: work.URL,
		license: licenses[0]?.URL, provider: "crossref", _providerRank: rank }, "crossref");
}

function pubmedIds(article) {
	const ids = {};
	for (const item of asList(article?.PubmedData?.ArticleIdList?.ArticleId)) {
		const kind = item?.["@_IdType"] ?? item?.IdType;
		if (kind) ids[kind.toLowerCase()] = clean(item);
	}
	return ids;
}

export function normalizePubMedArticle(article, rank = 0) {
	const citation = article?.MedlineCitation ?? {}, body = citation.Article ?? {}, journal = body.Journal ?? {}, ids = pubmedIds(article);
	const authors = asList(body.AuthorList?.Author).map((a) => clean(a.CollectiveName ?? [a.ForeName, a.LastName].filter(Boolean).join(" "))).filter(Boolean);
	const abstract = asList(body.Abstract?.AbstractText).map(clean).filter(Boolean).join(" ") || undefined;
	const date = journal.JournalIssue?.PubDate ?? {}, year = Number(date.Year ?? String(date.MedlineDate ?? "").match(/\d{4}/)?.[0]);
	const pmid = clean(citation.PMID) ?? ids.pubmed, pmc = ids.pmc;
	return canonicalizePaper({ id: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
		title: body.ArticleTitle, doi: ids.doi, pmid, authors, year: Number.isInteger(year) ? year : undefined,
		journal: journal.Title ?? journal.ISOAbbreviation, volume: journal.JournalIssue?.Volume,
		issue: journal.JournalIssue?.Issue, pages: body.Pagination?.MedlinePgn,
		abstract, type: clean(asList(body.PublicationTypeList?.PublicationType)[0]),
		isOa: pmc ? true : undefined, oaStatus: pmc ? "repository" : undefined,
		pdfUrl: pmc ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/pdf/` : undefined,
		landingUrl: pmc ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/` : (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined),
		version: pmc ? "publishedVersion" : undefined, provider: "pubmed", _providerRank: rank }, "pubmed");
}

export function normalizeArxivEntry(entry, rank = 0) {
	const id = clean(entry.id)?.split("/").at(-1);
	const pdf = asList(entry.link).find((link) => link?.["@_title"] === "pdf" || link?.["@_type"] === "application/pdf");
	return canonicalizePaper({ id: clean(entry.id), title: entry.title, arxivId: id, doi: clean(entry["arxiv:doi"]),
		authors: asList(entry.author).map((a) => clean(a?.name)).filter(Boolean), year: Number(clean(entry.published)?.slice(0, 4)),
		publicationDate: clean(entry.published), journal: "arXiv", abstract: entry.summary, type: "preprint",
		isOa: true, oaStatus: "green", pdfUrl: pdf?.["@_href"] ?? (id ? `https://arxiv.org/pdf/${id}` : undefined),
		landingUrl: clean(entry.id), license: clean(entry["arxiv:license"]), version: "submittedVersion",
		provider: "arxiv", _providerRank: rank }, "arxiv");
}

const completeness = (paper) => [paper.doi, paper.pmid, paper.arxivId, paper.journal, paper.volume, paper.pages, paper.abstract, paper.publicationDate, paper.pdfUrl, paper.license].filter(Boolean).length;

function mergePaper(left, right) {
	const preferred = completeness(right) > completeness(left) ? right : left;
	const secondary = preferred === left ? right : left;
	const merged = { ...secondary, ...preferred };
	for (const key of ["id", "doi", "pmid", "arxivId", "year", "publicationDate", "journal", "volume", "issue", "pages", "abstract", "citations", "type", "pdfUrl", "landingUrl", "license", "version", "shortDescriptionZh"])
		if (merged[key] == null || merged[key] === "") merged[key] = secondary[key];
	if (merged.shortDescriptionZh === "摘要待提炼" && secondary.shortDescriptionZh !== "摘要待提炼") {
		merged.shortDescriptionZh = secondary.shortDescriptionZh;
	}
	if ((secondary.abstract?.length ?? 0) > (merged.abstract?.length ?? 0)) merged.abstract = secondary.abstract;
	merged.sources = canonicalSources([...left.sources, ...right.sources]);
	merged.authors = preferred.authors?.length ? preferred.authors : secondary.authors;
	merged.isOa = left.isOa === true || right.isOa === true ? true : (left.isOa === false || right.isOa === false ? false : undefined);
	merged.oaStatus = preferred.oaStatus ?? secondary.oaStatus;
	merged.pdfUrl = preferred.pdfUrl ?? secondary.pdfUrl;
	merged.pdfStatus = merged.pdfUrl ? "candidate" : "unavailable";
	merged._providerRank = Math.min(left._providerRank ?? 999, right._providerRank ?? 999);
	// arXiv is authoritative for a preprint's original identifier/date. OpenAlex
	// can merge later mirror deposits into the same work and thereby replace 2017
	// metadata with a recently minted third-party DOI/date.
	const arxivRecord = left.arxivId ? left : (right.arxivId ? right : undefined);
	const otherRecord = arxivRecord === left ? right : left;
	if (arxivRecord && otherRecord?.type === "preprint" && normalizeTitle(arxivRecord.title) === normalizeTitle(otherRecord.title)) {
		merged.id = arxivRecord.id;
		merged.arxivId = arxivRecord.arxivId;
		merged.doi = arxivRecord.doi;
		merged.year = arxivRecord.year;
		merged.publicationDate = arxivRecord.publicationDate;
		merged.journal = "arXiv";
		merged.source = "arXiv";
		merged.type = "preprint";
		merged.pdfUrl = arxivRecord.pdfUrl;
		merged.landingUrl = arxivRecord.landingUrl;
		merged.version = arxivRecord.version;
	}
	return merged;
}

export function deduplicatePapers(records) {
	const output = [];
	for (const input of records) {
		const paper = canonicalizePaper(input, input.sources?.[0] ?? "openalex");
		const doi = normalizeDoi(paper.doi), author = firstAuthorSurname(paper);
		const index = output.findIndex((existing) => {
			const existingDoi = normalizeDoi(existing.doi);
			if (doi && existingDoi === doi) return true;
			return (!doi || !existingDoi) && author && firstAuthorSurname(existing) === author && titleSimilarity(existing.title, paper.title) >= 0.9;
		});
		if (index < 0) output.push(paper); else output[index] = mergePaper(output[index], paper);
	}
	return output;
}

function rankPapers(records, query, sort, identifier) {
	const normalizedQuery = normalizeTitle(query), queryTokens = normalizedQuery.split(" ").filter(Boolean);
	for (const paper of records) {
		const title = normalizeTitle(paper.title), haystack = `${title} ${normalizeTitle(paper.abstract)}`;
		const coverage = queryTokens.length ? queryTokens.filter((token) => haystack.includes(token)).length / queryTokens.length : 0;
		const titleCoverage = queryTokens.length ? queryTokens.filter((token) => title.includes(token)).length / queryTokens.length : 0;
		const idMatch = identifier.kind === "doi" ? normalizeDoi(paper.doi) === identifier.value :
			identifier.kind === "pmid" ? paper.pmid === identifier.value :
			identifier.kind === "arxiv" ? paper.arxivId?.replace(/v\d+$/i, "") === identifier.value.replace(/v\d+$/i, "") : false;
		paper.score = (idMatch ? 1000 : 0) + (normalizedQuery && title === normalizedQuery ? 500 : 0) + titleCoverage * 200 + coverage * 60 + Math.max(0, 20 - (paper._providerRank ?? 20));
	}
	const compare = sort === "cited_by_count" ? (a, b) => (b.citations ?? 0) - (a.citations ?? 0) || b.score - a.score :
		["publication_date", "recent", "newest"].includes(sort) ? (a, b) => String(b.publicationDate ?? b.year ?? "").localeCompare(String(a.publicationDate ?? a.year ?? "")) || b.score - a.score :
		(a, b) => b.score - a.score || (b.citations ?? 0) - (a.citations ?? 0);
	return records.sort(compare).map(({ _providerRank, ...paper }) => paper);
}

async function response(fetchImpl, url, accept = "application/json") {
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
	try {
		const result = await fetchImpl(url, { headers: { Accept: accept, "User-Agent": "dsh-lab-agent/0.1 academic-search" }, signal: controller.signal, redirect: "follow" });
		if (!result.ok) throw new Error(`HTTP ${result.status}`);
		return result;
	} finally { clearTimeout(timer); }
}
const fetchJson = async (fetchImpl, url) => await (await response(fetchImpl, url)).json();
const fetchXml = async (fetchImpl, url) => new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(await (await response(fetchImpl, url, "application/xml, text/xml")).text());

async function openalex(fetchImpl, query, options, identifier) {
	if (!["query", "doi"].includes(identifier.kind)) return [];
	let url;
	if (identifier.kind === "doi") url = `https://api.openalex.org/works/https://doi.org/${identifier.value}${options.mailto ? `?mailto=${encodeURIComponent(options.mailto)}` : ""}`;
	else {
		url = new URL("https://api.openalex.org/works"); url.searchParams.set("search", query); url.searchParams.set("per-page", String(options.limit));
		const filters = []; if (options.yearFrom) filters.push(`from_publication_date:${options.yearFrom}-01-01`); if (options.oaOnly) filters.push("open_access.is_oa:true");
		if (filters.length) url.searchParams.set("filter", filters.join(","));
		if (options.sort === "cited_by_count") url.searchParams.set("sort", "cited_by_count:desc");
		else if (["publication_date", "recent", "newest"].includes(options.sort)) url.searchParams.set("sort", "publication_date:desc");
		if (options.mailto) url.searchParams.set("mailto", options.mailto);
	}
	const data = await fetchJson(fetchImpl, String(url));
	return asList(data.results ?? data).map(normalizeOpenAlexWork);
}

async function crossref(fetchImpl, query, options, identifier) {
	let url;
	if (identifier.kind === "doi") url = `https://api.crossref.org/works/${encodeURIComponent(identifier.value)}`;
	else if (identifier.kind === "query") {
		url = new URL("https://api.crossref.org/works"); url.searchParams.set("query.bibliographic", query); url.searchParams.set("rows", String(options.limit));
		if (options.yearFrom) url.searchParams.set("filter", `from-pub-date:${options.yearFrom}-01-01`);
		if (options.sort === "cited_by_count") { url.searchParams.set("sort", "is-referenced-by-count"); url.searchParams.set("order", "desc"); }
		else if (["publication_date", "recent", "newest"].includes(options.sort)) { url.searchParams.set("sort", "published"); url.searchParams.set("order", "desc"); }
		if (options.mailto) url.searchParams.set("mailto", options.mailto);
	} else return [];
	const data = await fetchJson(fetchImpl, String(url));
	return asList(data.message?.items ?? data.message).map(normalizeCrossrefWork);
}

async function pubmedIdsSearch(fetchImpl, term, limit, sort = "relevance_score") {
	const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
	url.searchParams.set("db", "pubmed"); url.searchParams.set("term", term); url.searchParams.set("retmax", String(limit)); url.searchParams.set("retmode", "json");
	url.searchParams.set("sort", ["publication_date", "recent", "newest"].includes(sort) ? "pub date" : "relevance");
	return (await fetchJson(fetchImpl, url.href)).esearchresult?.idlist ?? [];
}

async function pubmed(fetchImpl, query, options, identifier) {
	let ids = [];
	if (identifier.kind === "pmid") ids = [identifier.value];
	else if (identifier.kind === "doi") ids = await pubmedIdsSearch(fetchImpl, `${identifier.value}[doi]`, options.limit, options.sort);
	else if (identifier.kind === "query") {
		const structured = buildPubMedQuery(query);
		ids = await pubmedIdsSearch(fetchImpl, options.yearFrom ? `(${structured}) AND ${options.yearFrom}:3000[dp]` : structured, options.limit, options.sort);
	}
	else return [];
	if (!ids.length) return [];
	const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
	url.searchParams.set("db", "pubmed"); url.searchParams.set("id", ids.join(",")); url.searchParams.set("retmode", "xml");
	return asList((await fetchXml(fetchImpl, url.href)).PubmedArticleSet?.PubmedArticle).map(normalizePubMedArticle);
}

async function arxiv(fetchImpl, query, options, identifier) {
	if (!["query", "arxiv"].includes(identifier.kind)) return [];
	const makeUrl = ({ id, search }) => {
		const url = new URL("https://export.arxiv.org/api/query");
		if (id) url.searchParams.set("id_list", id); else url.searchParams.set("search_query", search);
		url.searchParams.set("start", "0"); url.searchParams.set("max_results", String(options.limit));
		url.searchParams.set("sortBy", ["publication_date", "recent", "newest"].includes(options.sort) ? "submittedDate" : "relevance");
		url.searchParams.set("sortOrder", "descending");
		return url.href;
	};
	if (identifier.kind === "arxiv") return asList((await fetchXml(fetchImpl, makeUrl({ id: identifier.value }))).feed?.entry).map(normalizeArxivEntry);
	const phrase = query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
	const searches = phrase.split(" ").length >= 3 && phrase.split(" ").length <= 18
		? [`ti:\"${phrase}\"`, `all:${phrase}`]
		: [`all:${phrase}`];
	const feeds = await Promise.all(searches.map((search) => fetchXml(fetchImpl, makeUrl({ search }))));
	return feeds.flatMap((feed) => asList(feed.feed?.entry)).map(normalizeArxivEntry);
}

const PROVIDERS = { openalex, crossref, pubmed, arxiv };

export async function searchAcademicLiterature(query, { sources = DEFAULT_SOURCES, limit = 10, sort = "relevance_score", yearFrom, oaOnly = true, mailto, fetchImpl = globalThis.fetch } = {}) {
	if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable for academic search");
	const identifier = classifyLiteratureQuery(query), selected = [...new Set(sources)].filter((source) => PROVIDERS[source]);
	const options = { limit: Math.max(limit, 10), sort, yearFrom, oaOnly, mailto };
	const settled = await Promise.allSettled(selected.map(async (source) => ({ source, results: await PROVIDERS[source](fetchImpl, identifier.value, options, identifier) })));
	const failures = [], raw = [];
	for (let i = 0; i < settled.length; i += 1) {
		const item = settled[i];
		if (item.status === "fulfilled") raw.push(...item.value.results.map((paper, rank) => ({ ...paper, _providerRank: rank })));
		else failures.push({ source: selected[i], message: item.reason?.message ?? String(item.reason) });
	}
	let results = deduplicatePapers(raw);
	// Exact identifiers remain visible even when closed; keyword OA mode is strict.
	if (oaOnly && identifier.kind === "query") results = results.filter((paper) => paper.isOa === true);
	results = rankPapers(results, identifier.value, sort, identifier).slice(0, limit);
	Object.defineProperty(results, "meta", { value: { identifier, sources: selected, failures, oaOnly }, enumerable: false });
	return results;
}
