/**
 * Literature search tasks: persisted task/round/candidate store plus the Scopus
 * adapter. This is intentionally independent from labLiteratureTasks so the
 * workspace panel keeps working when the optional literature service is not
 * active in a given deployment.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { projectRegisteredSearches } from "./search-registration-projection.js";

const SCOPUS_SEARCH = "https://api.elsevier.com/content/search/scopus";
const storeCache = new Map();
const responseCache = new Map();

const STOP_WORDS = new Set(["the","and","for","with","from","that","this","are","was","were","into","using","based","study","paper","research","review","文献","研究","方法","以及","用于","通过","不同","相关"]);
const ZH_QUERY_TERMS = {
	"糖尿病足":"diabetic foot", "水凝胶":"hydrogel", "贴片":"patch", "血栓":"thrombus", "体外":"in vitro",
	"模型":"model", "纳米":"nanoparticle", "药物递送":"drug delivery", "缺血":"ischemia", "卒中":"stroke",
	"肿瘤":"tumor", "免疫":"immune", "炎症":"inflammation", "支架":"stent", "传感器":"sensor",
	"组织工程":"tissue engineering", "伤口愈合":"wound healing", "抗菌":"antibacterial", "抗氧化":"antioxidant",
	"可注射":"injectable", "自愈合":"self-healing", "微针":"microneedle", "生物材料":"biomaterial",
	"制备":"fabrication", "表征":"characterization", "临床":"clinical", "治疗":"treatment", "诊断":"diagnosis",
	"靶向":"targeted", "释放":"release", "细胞":"cell", "蛋白":"protein", "基因":"gene", "影像":"imaging"
};
function toScopusQuery(raw) {
	let text = safeText(raw);
	if (/[\u3400-\u9fff]/.test(text)) {
		for (const [zh, en] of Object.entries(ZH_QUERY_TERMS)) text = text.split(zh).join(` ${en} `);
		text = text.replace(/[检索查询相关文献研究进展综述方面的论文文章建议优先保留排除条件内容]/g, " ");
		if (/[\u3400-\u9fff]/.test(text)) {
			throw Object.assign(new Error("Scopus 需要英文关键词；当前需求仍包含无法识别的中文术语，请补充英文检索词或使用英文研究需求。"), { code: "query-language" });
		}
	}
	if (!text) return "";
	if (/\b(?:TITLE-ABS-KEY|TITLE|ABS|KEY|AUTH|DOI|SRCTITLE|ALL)\s*\(/i.test(text) || /\b(?:AND|OR|NOT)\b/.test(text)) return text;
	const terms = [...new Set(text.replace(/[，。；;、]/g, " ").split(/\s+/).map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter((term) => term.length >= 3 && !STOP_WORDS.has(term.toLowerCase())).slice(0, 8))];
	if (!terms.length) return text;
	return `TITLE-ABS-KEY(${terms.map((term) => `"${term}"`).join(" AND ")})`;
}
function now() { return new Date().toISOString(); }
function safeText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function projectStorePath(workspace) { return join(workspace, "search-tasks.json"); }
function scopusConfigPath(workspace) { return join(workspace, "search-tasks.config.json"); }

async function readJson(path, fallback) {
	try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

export async function readSearchTaskStore(core, projectId) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	const path = projectStorePath(workspace);
	const cached = storeCache.get(path);
	const store = cached || await readJson(path, { version: 1, activeTaskId: "", tasks: [] });
	if (!Array.isArray(store.tasks)) store.tasks = [];
	storeCache.set(path, store);
	if (projectRegisteredSearches(core, projectId, store)) await saveSearchTaskStore(core, projectId, store);
	return store;
}

export async function saveSearchTaskStore(core, projectId, store) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	store.updatedAt = now();
	await writeJson(projectStorePath(workspace), store);
	storeCache.set(projectStorePath(workspace), store);
	core.projectUpdates?.publish(projectId);
	return store;
}

export async function resolveScopusKey(core, projectId) {
	if (process.env.SCOPUS_API_KEY) return process.env.SCOPUS_API_KEY.trim();
	if (process.env.ELSEVIER_API_KEY) return process.env.ELSEVIER_API_KEY.trim();
	try {
		const workspace = (await core.ensureProjectWorkspace(projectId)).path;
		const config = await readJson(scopusConfigPath(workspace), {});
		if (config.scopusApiKey || config.apiKey) return String(config.scopusApiKey || config.apiKey).trim();
	} catch { /* optional */ }
	return "";
}

export const DATABASE_IDS = ["scopus", "wos", "openalex", "semanticscholar", "core", "pubmed", "crossref", "arxiv"];
export async function getDatabaseKeys(core, projectId) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	const config = await readJson(scopusConfigPath(workspace), {});
	const keys = config.keys || {};
	return {
		keys: {
			scopus: String(keys.scopus || config.scopusApiKey || config.apiKey || ""),
			wos: String(keys.wos || config.wosApiKey || ""),
			openalex: String(keys.openalex || ""),
			semanticscholar: String(keys.semanticscholar || ""),
			core: String(keys.core || ""),
			pubmed: String(keys.pubmed || ""),
			crossref: String(keys.crossref || ""),
			arxiv: String(keys.arxiv || "")
		}
	};
}
export async function saveDatabaseKey(core, projectId, database, apiKey) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	const config = await readJson(scopusConfigPath(workspace), {});
	const id = String(database || "").trim();
	if (!DATABASE_IDS.includes(id)) throw new Error("未知数据库");
	const keys = { ...(config.keys || {}), [id]: String(apiKey || "").trim() };
	const next = { ...config, keys, updatedAt: now() };
	if (id === "scopus") { next.apiKey = keys[id]; next.scopusApiKey = keys[id]; }
	if (id === "wos") next.wosApiKey = keys[id];
	await writeJson(scopusConfigPath(workspace), next);
	return { saved: true, database: id };
}
async function probeDatabase(id, key) {
	const timeout = AbortSignal.timeout(15000);
	const check = async (url, options = {}) => {
		try {
			const response = await fetch(url, { ...options, signal: timeout });
			return { ok: response.ok, message: response.ok ? "可用" : `HTTP ${response.status}` };
		} catch (error) { return { ok: false, message: error.message }; }
	};
	if (id === "scopus") {
		if (!key) return { ok: false, message: "未配置 Key" };
		return check(`https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent("all(science)")}&count=1`, { headers: { "X-ELS-APIKey": key, Accept: "application/json" } });
	}
	if (id === "wos") {
		if (!key) return { ok: false, message: "未配置 Key" };
		return check(`https://api.clarivate.com/apis/wos-starter/v1/documents?q=${encodeURIComponent("TS=(science)")}&limit=1`, { headers: { "X-ApiKey": key, Accept: "application/json" } });
	}
	if (id === "openalex") {
		const suffix = key ? `&api_key=${encodeURIComponent(key)}` : "";
		return check(`https://api.openalex.org/works?search=science&per-page=1${suffix}`, { headers: { Accept: "application/json" } });
	}
	if (id === "semanticscholar") {
		return check("https://api.semanticscholar.org/graph/v1/paper/search?query=science&limit=1", { headers: key ? { "x-api-key": key, Accept: "application/json" } : { Accept: "application/json" } });
	}
	if (id === "core") {
		if (!key) return { ok: false, message: "未配置 Key" };
		return check("https://api.core.ac.uk/v3/search/works?q=science&limit=1", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
	}
	if (id === "pubmed") {
		const suffix = key ? `&api_key=${encodeURIComponent(key)}` : "";
		return check(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=science&retmode=json&retmax=1${suffix}`);
	}
	if (id === "crossref") {
		return check("https://api.crossref.org/works?query=science&rows=1", { headers: { "user-agent": "iBM-Lab/0.1 (mailto:ibm-lab@example.org)" } });
	}
	if (id === "arxiv") return check("https://export.arxiv.org/api/query?search_query=all:science&max_results=1");
	return { ok: false, message: "未知数据库" };
}
export async function testDatabases(core, projectId) {
	const { keys } = await getDatabaseKeys(core, projectId);
	const results = [];
	for (const id of DATABASE_IDS) results.push({ id, ...(await probeDatabase(id, keys[id])) });
	return { keys, results };
}
export async function getSearchKeys(core, projectId) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	const config = await readJson(scopusConfigPath(workspace), {});
	return { scopusApiKey: String(config.scopusApiKey || config.apiKey || ""), wosApiKey: String(config.wosApiKey || "") };
}
export async function saveScopusKey(core, projectId, apiKey) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	const config = await readJson(scopusConfigPath(workspace), {});
	await writeJson(scopusConfigPath(workspace), { ...config, apiKey: String(apiKey || "").trim(), scopusApiKey: String(apiKey || "").trim(), updatedAt: now() });
}

function scopusError(status) {
	if (status === 401) return Object.assign(new Error("Scopus API Key 无效或已过期"), { code: "invalid-key" });
	if (status === 403) return Object.assign(new Error("当前机构/Key 没有 Scopus 接口权限"), { code: "forbidden" });
	if (status === 429) return Object.assign(new Error("Scopus 请求额度已耗尽或被限流"), { code: "quota" });
	return Object.assign(new Error(`Scopus 请求失败（HTTP ${status}）`), { code: "http" });
}

export async function scopusRequest(path, { apiKey, params = {} } = {}) {
	const query = new URLSearchParams(params).toString();
	const url = path + (query ? `?${query}` : "");
	const key = String(apiKey || "").trim();
	if (!key) throw Object.assign(new Error("未配置 Scopus API Key"), { code: "missing-key" });
	const cacheKey = url;
	const cached = responseCache.get(cacheKey);
	if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.value;
	let lastError;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const response = await fetch(url, { headers: { "X-ELS-APIKey": key, Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
			if (response.status === 429 || response.status >= 500) {
				lastError = scopusError(response.status);
				if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1))); continue; }
				throw lastError;
			}
			if (!response.ok) { const body = await response.text().catch(() => ""); throw Object.assign(scopusError(response.status), { responseBody: body.slice(0, 1200), message: `${scopusError(response.status).message}${body ? `：${body.slice(0, 500)}` : ""}` }); }
			const value = await response.json();
			responseCache.set(cacheKey, { at: Date.now(), value });
			while (responseCache.size > 200) responseCache.delete(responseCache.keys().next().value);
			return value;
		} catch (error) {
			lastError = error;
			if (error?.code && error.code !== "http") throw error;
			if (attempt === 2) throw Object.assign(new Error(`Scopus 网络请求失败：${error.message}`), { code: "network" });
			await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
		}
	}
	throw lastError;
}

export async function scopusTest(core, projectId) {
	const apiKey = await resolveScopusKey(core, projectId);
	if (!apiKey) return { ok: false, code: "missing-key", message: "未配置 Scopus API Key" };
	try {
		const value = await scopusRequest(SCOPUS_SEARCH, { apiKey, params: { query: "all(science)", count: 1 } });
		return { ok: true, total: Number(value?.["search-results"]?.["opensearch:totalResults"] || 0), message: "Scopus 连接正常" };
	} catch (error) {
		return { ok: false, code: error.code || "error", message: error.message };
	}
}

function findAbstract(value, depth = 0) {
	if (!value || depth > 5) return "";
	if (typeof value === "string") return value.length > 120 && /[.!?。]/.test(value) ? value : "";
	if (Array.isArray(value)) { for (const item of value) { const found = findAbstract(item, depth + 1); if (found) return found; } return ""; }
	if (typeof value === "object") {
		for (const key of ["dc:description", "abstract", "description"]) {
			if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
		}
		for (const item of Object.values(value)) { const found = findAbstract(item, depth + 1); if (found) return found; }
	}
	return "";
}
async function openAlexAbstract(doi) {
	try {
		const response = await fetch(`https://api.openalex.org/works/https://doi.org/${doi}?mailto=ibm-lab@example.org`, { signal: AbortSignal.timeout(12000) });
		if (!response.ok) return "";
		const work = await response.json();
		const index = work?.abstract_inverted_index;
		if (!index || typeof index !== "object") return "";
		const words = [];
		for (const [word, positions] of Object.entries(index)) for (const position of positions || []) words[position] = word;
		return words.filter(Boolean).join(" ").trim();
	} catch { return ""; }
}
async function semanticScholarAbstract(doi) {
	try {
		const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract,tldr`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
		if (!response.ok) return "";
		const value = await response.json();
		return String(value?.abstract || value?.tldr?.text || "").trim();
	} catch { return ""; }
}
async function crossrefAbstract(doi) {
	try {
		const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { "user-agent": "iBM-Lab/0.1 (mailto:ibm-lab@example.org)", Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
		if (!response.ok) return "";
		const value = await response.json();
		return String(value?.message?.abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	} catch { return ""; }
}
export async function abstractForDoi(doi) {
	const value = String(doi || "").trim();
	if (!value) return null;
	const openAlex = await openAlexAbstract(value);
	if (openAlex) return { text: openAlex, source: "openalex" };
	const pmc = await europePmcAbstract(value);
	if (pmc) return { text: pmc, source: "europepmc" };
	const semantic = await semanticScholarAbstract(value);
	if (semantic) return { text: semantic, source: "semanticscholar" };
	const crossref = await crossrefAbstract(value);
	if (crossref) return { text: crossref, source: "crossref" };
	return null;
}
export async function enrichTaskAbstracts(core, projectId, request = {}) {
	const store = await readSearchTaskStore(core, projectId);
	const task = store.tasks.find((row) => row.id === request.taskId) || store.tasks[0];
	if (!task) throw new Error("检索任务不存在");
	let filled = 0;
	let checked = 0;
	for (const paper of task.candidates || []) {
		if (paper.abstract || !paper.doi) continue;
		checked += 1;
		const found = await abstractForDoi(paper.doi);
		if (found) {
			paper.abstract = found.text;
			paper.abstractStatus = "available";
			paper.reasonBasis = "abstract";
			paper.abstractSource = found.source;
			filled += 1;
		} else paper.abstractStatus = "missing";
	}
	task.updatedAt = now();
	await saveSearchTaskStore(core, projectId, store);
	return { taskId: task.id, checked, filled, missing: checked - filled, total: (task.candidates || []).length };
}
async function europePmcAbstract(doi) {
	try {
		const response = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:${encodeURIComponent(doi)}&format=json&resultType=core`, { signal: AbortSignal.timeout(12000) });
		if (!response.ok) return "";
		const value = await response.json();
		const abstract = value?.resultList?.result?.[0]?.abstractText;
		return typeof abstract === "string" ? abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
	} catch { return ""; }
}
function scopusEntry(entry) {
	const doi = safeText(entry["prism:doi"]).replace(/^https?:\/\/doi\.org\//i, "");
	const eid = safeText(entry.eid || entry["dc:identifier"]);
	const authors = Array.isArray(entry.author)
		? entry.author.map((author) => safeText(author["authname"] || author.preferredName || author.name)).filter(Boolean)
		: [safeText(entry["dc:creator"])].filter(Boolean);
	const title = safeText(entry["dc:title"]);
	const journal = safeText(entry["prism:publicationName"] || entry["prism:aggregationType"]);
	const year = Number(String(entry["prism:coverDate"] || "").slice(0, 4)) || undefined;
	const abstract = safeText(entry["dc:description"] || entry.abstract);
	return {
		id: eid || doi || `scopus-${randomUUID()}`,
		source: "scopus",
		eid: eid || undefined,
		doi: doi || undefined,
		title,
		authors,
		journal,
		year,
		volume: safeText(entry["prism:volume"]) || undefined,
		issue: safeText(entry["prism:issueIdentifier"]) || undefined,
		pages: safeText(entry["prism:pageRange"]) || undefined,
		abstract: abstract || undefined,
		citedBy: Number(entry["citedby-count"] || 0) || 0,
		sourceUrl: doi ? `https://doi.org/${doi}` : (safeText(entry.link?.find?.((item) => item["@rel"] === "self")?.["@href"]) || undefined),
		abstractStatus: abstract ? "available" : "missing"
	};
}

function validPaper(paper) {
	return Boolean(paper && (paper.title || paper.doi || paper.eid));
}

function mergeCandidate(existing, incoming, roundId) {
	const sources = [...new Set([...(existing.sources || []), "scopus"])];
	return {
		...existing,
		...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined && value !== "")),
		sources,
		firstRound: existing.firstRound || roundId,
		feedback: existing.feedback || "",
		selected: Boolean(existing.selected)
	};
}

function samePaper(a, b) {
	if (a.doi && b.doi) return a.doi.toLowerCase() === b.doi.toLowerCase();
	if (a.eid && b.eid) return a.eid === b.eid;
	return safeText(a.title).toLowerCase() === safeText(b.title).toLowerCase() && (a.year || 0) === (b.year || 0);
}

export async function runScopusSearch(core, projectId, request = {}) {
	const store = await readSearchTaskStore(core, projectId);
	const task = store.tasks.find((row) => row.id === request.taskId) || store.tasks[0];
	if (!task) throw new Error("检索任务不存在");
	const apiKey = await resolveScopusKey(core, projectId);
	if (!apiKey) throw Object.assign(new Error("未配置 Scopus API Key"), { code: "missing-key" });
	const query = toScopusQuery(request.query || task.requirement || task.title);
	if (!query) throw new Error("检索式不能为空");
	const limit = Math.max(1, Math.min(100, Number(request.limit) || 25));
	const page = Math.max(1, Number(request.page) || 1);
	const roundId = `round-${Date.now().toString(36)}`;
	let value;
	try { value = await scopusRequest(SCOPUS_SEARCH, { apiKey, params: { query, count: limit, start: (page - 1) * limit } }); }
	catch (error) {
		const failed = { id: roundId, index: (task.rounds?.length || 0) + 1, label: `第${(task.rounds?.length || 0) + 1}轮`, query, queries: [query], source: "scopus", page, limit, fetched: 0, createdAt: now(), status: "failed", error: error.message, candidateIds: [] };
		task.rounds = [...(task.rounds || []), failed];
		task.messages = [...(task.messages || []), { role: "assistant", text: `Scopus 本轮失败：${error.message}`, at: now() }];
		task.updatedAt = now();
		await saveSearchTaskStore(core, projectId, store);
	}
	const entries = value?.["search-results"]?.entry;
	const papers = (Array.isArray(entries) ? entries : entries ? [entries] : []).map(scopusEntry).filter(validPaper);
	for (const paper of papers) {
		if (paper.abstract || !paper.doi) continue;
		try {
			const detail = await scopusRequest(`https://api.elsevier.com/content/abstract/doi/${encodeURIComponent(paper.doi)}`, { apiKey });
			const abstract = findAbstract(detail);
			if (abstract) { paper.abstract = abstract; paper.abstractStatus = "available"; paper.reasonBasis = "abstract"; paper.abstractSource = "scopus"; }
		} catch { /* open libraries below */ }
		if (!paper.abstract) {
			const openAlex = await openAlexAbstract(paper.doi);
			if (openAlex) { paper.abstract = openAlex; paper.abstractStatus = "available"; paper.reasonBasis = "abstract"; paper.abstractSource = "openalex"; }
		}
		if (!paper.abstract) {
			const pmc = await europePmcAbstract(paper.doi);
			if (pmc) { paper.abstract = pmc; paper.abstractStatus = "available"; paper.reasonBasis = "abstract"; paper.abstractSource = "europepmc"; }
		}
		if (!paper.abstract) paper.abstractStatus = "missing";
	}
	const round = {
		id: roundId, index: (task.rounds?.length || 0) + 1, label: `第${(task.rounds?.length || 0) + 1}轮`,
		query, queries: [query], source: "scopus", page, limit,
		totalAvailable: Number(value?.["search-results"]?.["opensearch:totalResults"] || 0),
		fetched: papers.length, createdAt: now(), status: "succeeded", candidateIds: []
	};
	let added = 0;
	for (const paper of papers) {
		const existing = (task.candidates || []).find((row) => samePaper(row, paper));
		if (existing) {
			Object.assign(existing, mergeCandidate(existing, paper, roundId));
		} else {
			task.candidates = task.candidates || [];
			task.candidates.push({
				...paper, firstRound: roundId, sources: ["scopus"], feedback: "", selected: false,
				recommendation: "", matchReason: "", reasonBasis: paper.abstract ? "abstract" : "title"
			});
			added += 1;
		}
		round.candidateIds.push((existing || task.candidates[task.candidates.length - 1]).id);
	}
	round.newCount = added;
	round.totalAfter = task.candidates.length;
	task.rounds = [...(task.rounds || []), round];
	task.messages = [...(task.messages || []), {
		role: "assistant",
		text: `本轮从 Scopus 获取 ${papers.length} 篇，新增 ${added} 篇，去重后候选 ${task.candidates.length} 篇。`,
		at: now()
	}];
	task.updatedAt = now();
	task.status = "ready";
	await saveSearchTaskStore(core, projectId, store);
	return { task, round, total: round.totalAvailable, fetched: papers.length, added };
}

const WOS_SEARCH = "https://api.clarivate.com/apis/wos-starter/v1/documents";
function wosConfigPath(workspace) { return join(workspace, "search-tasks.config.json"); }
export async function resolveWosKey(core, projectId) {
	if (process.env.WOS_API_KEY) return process.env.WOS_API_KEY.trim();
	if (process.env.WOS_STARTER_API_KEY) return process.env.WOS_STARTER_API_KEY.trim();
	try {
		const workspace = (await core.ensureProjectWorkspace(projectId)).path;
		const config = await readJson(wosConfigPath(workspace), {});
		if (config.wosApiKey) return String(config.wosApiKey).trim();
	} catch { /* optional */ }
	return "";
}
export async function saveWosKey(core, projectId, apiKey) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	const config = await readJson(wosConfigPath(workspace), {});
	await writeJson(wosConfigPath(workspace), { ...config, wosApiKey: String(apiKey || "").trim(), updatedAt: now() });
}
function toWosQuery(raw) {
	const text = safeText(raw);
	if (/^\s*(TS|TI|AU|DO|PY|SO)\s*=/i.test(text)) return text;
	const scopus = toScopusQuery(text);
	const inner = scopus.match(/^TITLE-ABS-KEY\((.*)\)$/i)?.[1] || scopus;
	return `TS=(${inner})`;
}
function wosEntry(hit) {
	const doi = hit?.identifiers?.doi;
	const pages = hit?.source?.pages?.range;
	return {
		id: doi ? `doi:${String(doi).toLowerCase()}` : `wos:${hit?.uid || randomUUID()}`,
		wosUid: hit?.uid,
		doi: doi || undefined,
		title: hit?.title || "",
		authors: (hit?.names?.authors || []).map((row) => row.displayName).filter(Boolean),
		journal: hit?.source?.sourceTitle || "",
		year: Number(hit?.source?.publishYear) || undefined,
		volume: hit?.source?.volume || undefined,
		issue: hit?.source?.issue || undefined,
		pages: pages || undefined,
		citedBy: hit?.citations?.[0]?.count ?? undefined,
		type: hit?.types?.[0] || undefined,
		sourceUrl: hit?.links?.record || (doi ? `https://doi.org/${doi}` : undefined),
		abstractStatus: "missing"
	};
}
export async function wosTest(core, projectId) {
	const apiKey = await resolveWosKey(core, projectId);
	if (!apiKey) return { ok: false, message: "未配置 WoS Starter API Key" };
	const started = Date.now();
	try {
		const response = await fetch(`${WOS_SEARCH}?q=${encodeURIComponent("TS=(science)")}&limit=1`, { headers: { "X-ApiKey": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
		if (!response.ok) return { ok: false, message: response.status === 401 ? "WoS API Key 无效" : `WoS 请求失败（HTTP ${response.status}）` };
		const value = await response.json();
		return { ok: true, message: `WoS 可用（命中 ${value?.metadata?.total ?? 0} 条）`, ms: Date.now() - started };
	} catch (error) { return { ok: false, message: error.message }; }
}
export async function runWosSearch(core, projectId, request = {}) {
	const store = await readSearchTaskStore(core, projectId);
	const task = store.tasks.find((row) => row.id === request.taskId) || store.tasks[0];
	if (!task) throw new Error("检索任务不存在");
	const apiKey = await resolveWosKey(core, projectId);
	if (!apiKey) throw Object.assign(new Error("未配置 WoS Starter API Key"), { code: "missing-key" });
	const query = toWosQuery(request.query || task.requirement || task.title);
	const limit = Math.max(1, Math.min(50, Number(request.limit) || 25));
	const page = Math.max(1, Number(request.page) || 1);
	const roundId = `round-${Date.now().toString(36)}`;
	let response;
	try { response = await fetch(`${WOS_SEARCH}?q=${encodeURIComponent(query)}&limit=${limit}&page=${page}`, { headers: { "X-ApiKey": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); }
	catch (error) {
		const failed = { id: roundId, index: (task.rounds?.length || 0) + 1, label: `第${(task.rounds?.length || 0) + 1}轮`, query, queries: [query], source: "wos", page, limit, fetched: 0, createdAt: now(), status: "failed", error: error.message, candidateIds: [] };
		task.rounds = [...(task.rounds || []), failed];
		await saveSearchTaskStore(core, projectId, store);
		throw error;
	}
	if (!response.ok) {
		const message = response.status === 401 ? "WoS API Key 无效或已过期" : `WoS 请求失败（HTTP ${response.status}）`;
		const failed = { id: roundId, index: (task.rounds?.length || 0) + 1, label: `第${(task.rounds?.length || 0) + 1}轮`, query, queries: [query], source: "wos", page, limit, fetched: 0, createdAt: now(), status: "failed", error: message, candidateIds: [] };
		task.rounds = [...(task.rounds || []), failed];
		await saveSearchTaskStore(core, projectId, store);
		throw Object.assign(new Error(message), { code: "wos-http", status: response.status });
	}
	const value = await response.json();
	const papers = (value.hits || []).map(wosEntry).filter(validPaper);
	for (const paper of papers) {
		if (!paper.doi) { paper.abstractStatus = "missing"; continue; }
		const openAlex = await openAlexAbstract(paper.doi);
		if (openAlex) { paper.abstract = openAlex; paper.abstractStatus = "available"; paper.reasonBasis = "abstract"; paper.abstractSource = "openalex"; continue; }
		const pmc = await europePmcAbstract(paper.doi);
		if (pmc) { paper.abstract = pmc; paper.abstractStatus = "available"; paper.reasonBasis = "abstract"; paper.abstractSource = "europepmc"; }
	}
	const round = {
		id: roundId, index: (task.rounds?.length || 0) + 1, label: `第${(task.rounds?.length || 0) + 1}轮`,
		query, queries: [query], source: "wos", page, limit,
		totalAvailable: Number(value?.metadata?.total || 0), fetched: papers.length, createdAt: now(), status: "succeeded", candidateIds: []
	};
	let added = 0;
	for (const paper of papers) {
		const existing = (task.candidates || []).find((row) => samePaper(row, paper));
		if (existing) Object.assign(existing, mergeCandidate(existing, paper, roundId));
		else {
			task.candidates = task.candidates || [];
			task.candidates.push({ ...paper, firstRound: roundId, sources: ["wos"], feedback: "", selected: false, recommendation: "", matchReason: "", reasonBasis: paper.abstract ? "abstract" : "title" });
			added += 1;
		}
		round.candidateIds.push((existing || task.candidates[task.candidates.length - 1]).id);
	}
	round.newCount = added;
	round.totalAfter = task.candidates.length;
	task.rounds = [...(task.rounds || []), round];
	task.messages = [...(task.messages || []), { role: "assistant", text: `本轮从 Web of Science 获取 ${papers.length} 篇，新增 ${added} 篇，去重后候选 ${task.candidates.length} 篇。`, at: now() }];
	task.updatedAt = now();
	task.status = "ready";
	await saveSearchTaskStore(core, projectId, store);
	return { task, round, total: round.totalAvailable, fetched: papers.length, added };
}
export function parseRis(text) {
	const records = String(text || "").replace(/\r\n/g, "\n").split(/\n(?=TY  -)/i).map((block) => {
		const fields = {};
		let current = "";
		for (const line of block.split("\n")) {
			const match = line.match(/^([A-Z0-9]{2})  - ?(.*)$/);
			if (match) { current = match[1]; fields[current] = fields[current] || []; fields[current].push(match[2].trim()); }
			else if (current && line.trim()) fields[current][fields[current].length - 1] += " " + line.trim();
		}
		const first = (key) => fields[key]?.[0] || "";
		if (!fields.TY && !first("TI")) return null;
		const doi = first("DO") || (first("UR").match(/10\.\d{4,9}\/\S+/)?.[0] || "");
		return {
			id: doi ? `doi:${doi.toLowerCase()}` : `ris-${randomUUID()}`,
			source: "ris", doi: doi || undefined, title: first("TI") || first("T1"),
			authors: [...(fields.AU || []), ...(fields.A1 || [])].filter(Boolean),
			journal: first("JO") || first("JF") || first("T2") || first("JA"),
			year: Number(String(first("PY") || first("Y1") || "").slice(0, 4)) || undefined,
			volume: first("VL") || undefined, issue: first("IS") || undefined, pages: first("SP") || undefined,
			abstract: first("AB") || first("N2") || undefined,
			sourceUrl: first("UR") || (doi ? `https://doi.org/${doi}` : undefined),
			abstractStatus: first("AB") ? "available" : "missing"
		};
	}).filter(Boolean);
	return records;
}

export async function importRisTask(core, projectId, request = {}) {
	const store = await readSearchTaskStore(core, projectId);
	let task = request.taskId ? store.tasks.find((row) => row.id === request.taskId) : null;
	if (!task) {
		task = { id: `search-${Date.now().toString(36)}`, title: safeText(request.title || request.fileName || "RIS 导入"), requirement: "", rounds: [], candidates: [], messages: [], createdAt: now(), updatedAt: now(), status: "ready" };
		store.tasks.unshift(task);
	}
	const parsed = parseRis(request.text);
	const round = { id: `round-${Date.now().toString(36)}`, index: (task.rounds?.length || 0) + 1, label: `第${(task.rounds?.length || 0) + 1}轮`, query: "RIS 导入", queries: [], source: "ris", createdAt: now(), status: "succeeded", fetched: parsed.length, candidateIds: [], totalAvailable: parsed.length };
	let added = 0, duplicate = 0;
	for (const record of parsed) {
		const existing = (task.candidates || []).find((row) => samePaper(row, record));
		if (existing) { duplicate += 1; round.candidateIds.push(existing.id); continue; }
		task.candidates = task.candidates || [];
		task.candidates.push({ ...record, firstRound: round.id, sources: ["ris"], feedback: "", selected: false, recommendation: "", matchReason: "", reasonBasis: record.abstract ? "abstract" : "title" });
		added += 1;
		round.candidateIds.push(task.candidates[task.candidates.length - 1].id);
	}
	round.newCount = added;
	task.rounds = [...(task.rounds || []), round];
	task.updatedAt = now();
	store.activeTaskId = task.id;
	await saveSearchTaskStore(core, projectId, store);
	return { task, imported: parsed.length, added, duplicate, failed: 0 };
}

export function taskRis(task, candidateIds = []) {
	const wanted = new Set(candidateIds);
	const candidates = (task.candidates || []).filter((row) => wanted.size === 0 || wanted.has(row.id));
	const lines = [];
	for (const paper of candidates) {
		lines.push("TY  - JOUR");
		for (const author of paper.authors || []) lines.push(`AU  - ${author}`);
		if (paper.title) lines.push(`TI  - ${paper.title}`);
		if (paper.journal) lines.push(`JO  - ${paper.journal}`);
		if (paper.year) lines.push(`PY  - ${paper.year}`);
		if (paper.volume) lines.push(`VL  - ${paper.volume}`);
		if (paper.issue) lines.push(`IS  - ${paper.issue}`);
		if (paper.pages) lines.push(`SP  - ${paper.pages}`);
		if (paper.doi) lines.push(`DO  - ${paper.doi}`);
		if (paper.abstract) lines.push(`AB  - ${paper.abstract}`);
		if (paper.sourceUrl) lines.push(`UR  - ${paper.sourceUrl}`);
		lines.push("ER  -", "");
	}
	return lines.join("\n");
}

export async function publicSourcesTest() {
	const checks = [
		["openalex", "https://api.openalex.org/works?search=science&per-page=1"],
		["crossref", "https://api.crossref.org/works?query=science&rows=1"],
		["pubmed", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=science&retmode=json&retmax=1"],
		["arxiv", "https://export.arxiv.org/api/query?search_query=all:science&max_results=1"]
	];
	const publicSources = await Promise.all(checks.map(async ([id, url]) => {
		const started = Date.now();
		try {
			const response = await fetch(url, { headers: { "user-agent": "iBM-Lab/0.1" }, signal: AbortSignal.timeout(8000) });
			return { id, ok: response.ok, status: response.status, ms: Date.now() - started, message: response.ok ? "可用" : `HTTP ${response.status}` };
		} catch (error) {
			return { id, ok: false, status: 0, ms: Date.now() - started, message: error.message };
		}
	}));
	return { scopus: null, publicSources };
}
export async function listSearchTasks(core, projectId) {
	const store = await readSearchTaskStore(core, projectId);
	return { tasks: store.tasks, activeTaskId: store.activeTaskId || "" };
}

export async function upsertSearchTask(core, projectId, task) {
	const store = await readSearchTaskStore(core, projectId);
	const clean = { ...task, id: task.id || `search-${Date.now().toString(36)}`, createdAt: task.createdAt || now(), updatedAt: now() };
	const index = store.tasks.findIndex((row) => row.id === clean.id);
	if (index >= 0) store.tasks[index] = clean; else store.tasks.unshift(clean);
	store.activeTaskId = clean.id;
	await saveSearchTaskStore(core, projectId, store);
	return clean;
}

export async function deleteSearchTask(core, projectId, taskId) {
	const store = await readSearchTaskStore(core, projectId);
	const removed = store.tasks.find(row => row.id === taskId);
	if (removed?.legacySearchKey) store.dismissedRegistrationKeys = [...new Set([...(store.dismissedRegistrationKeys || []), removed.legacySearchKey])];
	store.tasks = store.tasks.filter((row) => row.id !== taskId);
	if (store.activeTaskId === taskId) store.activeTaskId = store.tasks[0]?.id || "";
	await saveSearchTaskStore(core, projectId, store);
	return { deleted: taskId };
}

export async function patchTaskCandidate(core, projectId, { taskId, candidateId, patch = {} } = {}) {
	const store = await readSearchTaskStore(core, projectId);
	const task = store.tasks.find((row) => row.id === taskId);
	if (!task) throw new Error("检索任务不存在");
	const candidate = (task.candidates || []).find((row) => row.id === candidateId);
	if (!candidate) throw new Error("候选文献不存在");
	Object.assign(candidate, patch, { updatedAt: now() });
	task.updatedAt = now();
	await saveSearchTaskStore(core, projectId, store);
	return { task, candidate };
}
