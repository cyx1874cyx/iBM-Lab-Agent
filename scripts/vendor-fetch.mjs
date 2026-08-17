#!/usr/bin/env node
/**
 * dsh-lab-agent: vendor tree fetcher (jsdelivr CDN, no GitHub rate limits).
 *
 * Downloads a nature-skills commit's complete tree from the jsdelivr CDN
 * (file list via data.jsdelivr.com, contents via cdn.jsdelivr.net). Used by
 * pin-vendor.mjs; also runnable standalone.
 *
 * Usage:
 *   node scripts/vendor-fetch.mjs <repo> <sha> <destDir> [--concurrency N]
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TREE_URL = (userRepo, sha) => `https://data.jsdelivr.com/v1/packages/gh/${userRepo}@${sha}?structure=flat`;
export const FILE_URL = (userRepo, sha, path) => `https://cdn.jsdelivr.net/gh/${userRepo}@${sha}${path}`;

export async function fetchJson(url, retries = 3) {
	let lastError;
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url, { redirect: "follow" });
			if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
			return await response.json();
		} catch (error) {
			lastError = error;
			await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
		}
	}
	throw lastError;
}

export async function fetchBuffer(url, retries = 4) {
	let lastError;
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url, { redirect: "follow" });
			if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
			const buffer = Buffer.from(await response.arrayBuffer());
			if (buffer.length === 0) throw new Error(`empty body: ${url}`);
			return buffer;
		} catch (error) {
			lastError = error;
			await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
		}
	}
	throw lastError;
}

/** Download a full tree; returns { downloaded, bytes, expected, files }. */
export async function fetchTree(userRepo, sha, destDir, concurrency = 16) {
	const tree = await fetchJson(TREE_URL(userRepo, sha));
	const files = tree.files.filter((f) => f.type !== "directory");
	let downloaded = 0;
	let bytes = 0;

	await rm(destDir, { recursive: true, force: true });
	await mkdir(destDir, { recursive: true });

	const queue = [...files];
	async function worker() {
		while (queue.length > 0) {
			const file = queue.shift();
			const target = join(destDir, file.name);
			await mkdir(dirname(target), { recursive: true });
			const buffer = await fetchBuffer(FILE_URL(userRepo, sha, file.name));
			await writeFile(target, buffer);
			downloaded++;
			bytes += buffer.length;
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

	const expected = files.reduce((sum, f) => sum + f.size, 0);
	return { downloaded, bytes, expected, files };
}

async function main() {
	const userRepo = process.argv[2] ?? "Yuan1z0825/nature-skills";
	const sha = process.argv[3];
	const dest = resolve(process.argv[4] ?? ".");
	const concurrency = Number(process.argv.find((a, i) => process.argv[i - 1] === "--concurrency") ?? 16);
	if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
		console.error("usage: vendor-fetch.mjs <repo> <sha> <destDir> [--concurrency N]");
		process.exit(2);
	}
	console.log(`fetching tree ${userRepo}@${sha.slice(0, 12)} (jsdelivr)`);
	const result = await fetchTree(userRepo, sha, dest, concurrency);
	console.log(`downloaded ${result.downloaded}/${result.files.length} files, ${(result.bytes / 1048576).toFixed(1)} MB (tree expects ${(result.expected / 1048576).toFixed(1)} MB)`);
	if (result.downloaded !== result.files.length || result.bytes !== result.expected) {
		console.error("WARNING: download does not match the jsdelivr tree exactly");
		process.exit(1);
	}
	console.log(`tree materialized -> ${dest}`);
}

// Run standalone only (not when imported by pin-vendor / golden-diff).
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((error) => {
		console.error(`vendor-fetch failed: ${error.message}`);
		process.exit(1);
	});
}
