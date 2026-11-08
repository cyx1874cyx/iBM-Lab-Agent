import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { labAgentRoot } from "../src/paths.js";

const DIRECTORY = () => join(labAgentRoot(), "journal-covers");
const INDEX = () => join(DIRECTORY(), "index.json");
const memory = new Map();

async function readIndex() {
	try { return JSON.parse(await readFile(INDEX(), "utf8")); } catch { return {}; }
}

async function writeIndex(index) {
	await mkdir(DIRECTORY(), { recursive: true });
	const temporary = `${INDEX()}.tmp`;
	await writeFile(temporary, JSON.stringify(index, null, 2), "utf8");
	await rename(temporary, INDEX());
}

async function execute(service, journal, explicitUrl = "") {
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
	await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_INTERVAL - (Date.now() - lastFetchAt))));
	lastFetchAt = Date.now();
	if (!coverUrl && service?.journalMetrics) {
		try { coverUrl = (await service.journalMetrics({ journal: name }))?.coverUrl || ""; } catch { /* ignore */ }
	}
	if (!coverUrl) return null;
	try {
		const response = await fetch(coverUrl, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.letpub.com.cn/" }, signal: AbortSignal.timeout(15000) });
		if (!response.ok) return null;
		const type = response.headers.get("content-type") || "image/jpeg";
		if (!/^image\//i.test(type)) return null;
		const bytes = Buffer.from(await response.arrayBuffer());
		if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;
		const extension = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
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

export function getJournalCover(service, journal, explicitUrl = "") {
	const key = String(journal || "").trim().toLowerCase();
	if (!key) return Promise.resolve(null);
	if (inFlight.has(key)) return inFlight.get(key);
	const result = new Promise((resolve) => pending.push({ resolve, run: () => execute(service, journal, explicitUrl) }));
	inFlight.set(key, result);
	result.finally(() => inFlight.delete(key)).catch(() => {});
	pump();
	return result;
}