import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { labAgentRoot } from "../src/paths.js";

const DIRECTORY = () => join(labAgentRoot(), "journal-covers");
const INDEX = () => join(DIRECTORY(), "index.json");
const memory = new Map();
const MIN_INTERVAL = 250;
let lastFetchAt = 0;

async function readIndex() {
	try { return JSON.parse(await readFile(INDEX(), "utf8")); } catch { return {}; }
}

async function writeIndex(index) {
	await mkdir(DIRECTORY(), { recursive: true });
	const temporary = `${INDEX()}.tmp`;
	await writeFile(temporary, JSON.stringify(index, null, 2), "utf8");
	await rename(temporary, INDEX());
}

function normalizeIssn(value) {
	const digits = String(value || "").replace(/[^0-9Xx]/g, "");
	return /^\d{7}[\dXx]$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : "";
}

async function issnForJournal(apiKey, name) {
	const direct = normalizeIssn(name);
	if (direct) return direct;
	try {
		const query = encodeURIComponent(`SRCTITLE("${name}")`);
		const response = await fetch(`https://api.elsevier.com/content/search/scopus?query=${query}&count=1&field=issn`, {
			headers: { "X-ELS-APIKey": apiKey, Accept: "application/json" },
			signal: AbortSignal.timeout(12000)
		});
		if (!response.ok) return "";
		const value = await response.json();
		const entry = value?.["search-results"]?.entry?.[0];
		const issn = normalizeIssn(entry?.["prism:issn"] || entry?.["prism:eIssn"] || "");
		if (issn) return issn;
	} catch { /* try OpenAlex below */ }
	try {
		const response = await fetch(`https://api.openalex.org/sources?search=${encodeURIComponent(name)}&per-page=1`, { signal: AbortSignal.timeout(12000) });
		if (!response.ok) return "";
		const value = await response.json();
		const source = value?.results?.[0];
		return normalizeIssn(source?.issn_l || source?.issn?.[0] || "");
	} catch { return ""; }
}

async function execute(service, journal, explicitUrl = "", apiKey = "") {
	const name = String(journal || "").replace(/\s+/g, " ").trim();
	if (!name) return null;
	const key = createHash("sha1").update(name.toLowerCase()).digest("hex");
	const cached = memory.get(key);
	if (cached) return { cover: cached, source: "memory" };
	const index = await readIndex();
	const record = index[name];
	if (record?.file) {
		try {
			const bytes = await readFile(join(DIRECTORY(), record.file));
			const cover = `data:${record.mime || "image/jpeg"};base64,${bytes.toString("base64")}`;
			memory.set(key, cover);
			return { cover, source: "local", journal: name, bytes: bytes.length };
		} catch { /* re-fetch below */ }
	}
	let coverUrl = explicitUrl;
	let headers = { "user-agent": "Mozilla/5.0" };
	await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_INTERVAL - (Date.now() - lastFetchAt))));
	lastFetchAt = Date.now();
	if (!coverUrl && apiKey) {
		const issn = await issnForJournal(apiKey, name);
		if (issn) {
			coverUrl = `https://api.elsevier.com/content/serial/title/issn/${issn}?view=COVERIMAGE`;
			headers = { "X-ELS-APIKey": apiKey, Accept: "image/gif,image/jpeg,image/png" };
		}
	}
	if (!coverUrl && service?.journalMetrics) {
		try {
			coverUrl = (await service.journalMetrics({ journal: name }))?.coverUrl || "";
			headers = { "user-agent": "Mozilla/5.0", referer: "https://www.letpub.com.cn/" };
		} catch { /* ignore */ }
	}
	if (!coverUrl) return null;
	try {
		let response = await fetch(coverUrl, { headers, signal: AbortSignal.timeout(15000) });
		if (!response.ok && coverUrl.includes("api.elsevier.com") && service?.journalMetrics) {
			try {
				const fallback = (await service.journalMetrics({ journal: name }))?.coverUrl;
				if (fallback) { coverUrl = fallback; headers = { "user-agent": "Mozilla/5.0", referer: "https://www.letpub.com.cn/" }; response = await fetch(coverUrl, { headers, signal: AbortSignal.timeout(15000) }); }
			} catch { /* ignore */ }
		}
		if (!response.ok) return null;
		const declared = response.headers.get("content-type") || "image/jpeg";
		if (!/^image\//i.test(declared)) return null;
		const bytes = Buffer.from(await response.arrayBuffer());
		if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;
		const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes.slice(0, 3).toString() === "GIF" ? "image/gif" : declared;
		const extension = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : type.includes("gif") ? ".gif" : ".jpg";
		const file = `${key}${extension}`;
		await mkdir(DIRECTORY(), { recursive: true });
		await writeFile(join(DIRECTORY(), file), bytes);
		index[name] = { file, mime: type, sourceUrl: coverUrl, fetchedAt: new Date().toISOString(), bytes: bytes.length };
		await writeIndex(index);
		const cover = `data:${type};base64,${bytes.toString("base64")}`;
		memory.set(key, cover);
		return { cover, source: "fetched", journal: name, bytes: bytes.length };
	} catch { return null; }
}

const pending = [];
const inFlight = new Map();
let active = 0;
function pump() {
	while (active < 1 && pending.length) {
		const job = pending.shift();
		active += 1;
		job.run().then(job.resolve, () => job.resolve(null)).finally(() => { active -= 1; pump(); });
	}
}

export function getJournalCover(service, journal, explicitUrl = "", apiKey = "") {
	const key = String(journal || "").trim().toLowerCase();
	if (!key) return Promise.resolve(null);
	if (inFlight.has(key)) return inFlight.get(key);
	const result = new Promise((resolve) => pending.push({ resolve, run: () => execute(service, journal, explicitUrl, apiKey) }));
	inFlight.set(key, result);
	result.finally(() => inFlight.delete(key)).catch(() => {});
	pump();
	return result;
}

export function syncJournalCovers(service, journals = [], apiKey = "") {
	const queued = [];
	const seen = new Set();
	for (const value of journals) {
		const journal = String(value || "").replace(/\s+/g, " ").trim();
		if (!journal || seen.has(journal.toLowerCase())) continue;
		seen.add(journal.toLowerCase());
		queued.push(journal);
		void getJournalCover(service, journal, "", apiKey).catch(() => {});
	}
	return { queued: queued.length, journals: queued };
}
