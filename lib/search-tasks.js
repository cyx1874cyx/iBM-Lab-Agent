/**
 * Literature search tasks: persisted task/round/candidate store plus the Scopus
 * adapter. This is intentionally independent from labLiteratureTasks so the
 * workspace panel keeps working when the optional literature service is not
 * active in a given deployment.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const SCOPUS_SEARCH = "https://api.elsevier.com/content/search/scopus";
const storeCache = new Map();
const responseCache = new Map();

const STOP_WORDS = new Set(["the","and","for","with","from","that","this","are","was","were","into","using","based","study","paper","research","review","文献","研究","方法","以及","用于","通过","不同","相关"]);
function toScopusQuery(raw) {
	const text = safeText(raw);
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
	if (cached) return cached;
	const store = await readJson(path, { version: 1, activeTaskId: "", tasks: [] });
	if (!Array.isArray(store.tasks)) store.tasks = [];
	storeCache.set(path, store);
	return store;
}

export async function saveSearchTaskStore(core, projectId, store) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	store.updatedAt = now();
	await writeJson(projectStorePath(workspace), store);
	storeCache.set(projectStorePath(workspace), store);
	return store;
}

export async function resolveScopusKey(core, projectId) {
	if (process.env.SCOPUS_API_KEY) return process.env.SCOPUS_API_KEY.trim();
	if (process.env.ELSEVIER_API_KEY) return process.env.ELSEVIER_API_KEY.trim();
	try {
		const workspace = (await core.ensureProjectWorkspace(projectId)).path;
		const config = await readJson(scopusConfigPath(workspace), {});
		if (config.apiKey) return String(config.apiKey).trim();
	} catch { /* optional */ }
	return "";
}

export async function saveScopusKey(core, projectId, apiKey) {
	const workspace = (await core.ensureProjectWorkspace(projectId)).path;
	await writeJson(scopusConfigPath(workspace), { apiKey: String(apiKey || "").trim(), updatedAt: now() });
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
			if (!response.ok) throw scopusError(response.status);
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
	const value = await scopusRequest(SCOPUS_SEARCH, { apiKey, params: { query, count: limit, start: (page - 1) * limit } });
	const entries = value?.["search-results"]?.entry;
	const papers = (Array.isArray(entries) ? entries : entries ? [entries] : []).map(scopusEntry).filter(validPaper);
	for (const paper of papers.slice(0, 8)) {
		if (paper.abstract || !paper.doi) continue;
			try {
			const detail = await scopusRequest(`https://api.elsevier.com/content/abstract/doi/${encodeURIComponent(paper.doi)}`, { apiKey });
			const abstract = findAbstract(detail);
			if (abstract) { paper.abstract = abstract; paper.abstractStatus = "available"; paper.reasonBasis = "abstract"; }
		} catch { paper.abstractStatus = "missing"; }
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
