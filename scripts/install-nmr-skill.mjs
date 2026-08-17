#!/usr/bin/env node
/**
 * dsh-lab-agent: 安装 mnova-mcp 的 nmr-analyze-simulate skill。
 *
 * 计划 §五：通过 Harness MCP Client 集成 mnova-mcp，并安装其
 * nmr-analyze-simulate Skill 到 $DSH_HOME/skills/nmr-analyze-simulate/
 * （harness skill-filesystem 的用户根，agent 可直接加载）。
 *
 * 源：GitHub raw（限流时退避重试）。记录来源文件
 * `.dsh-lab-agent-source.json`（repo/ref/安装日期）——技能内容不自动更新。
 *
 * Usage:
 *   node scripts/install-nmr-skill.mjs [--ref main] [--dsh-home <path>]
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "../src/paths.js";

const REPO = "cyx1874cyx/mnova-mcp";
const SKILL_DIR = "skill/nmr-analyze-simulate";
const RAW = (ref, path) => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;

/** 需要安装的文件（SKILL.md + 完整子目录资源）。 */
const FILES = [
	"SKILL.md",
	"agents/.keep",
	"references/.keep",
	"scripts/.keep"
];

function parseArgs(argv) {
	const flags = { ref: "main", dshHome: undefined };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--ref") flags.ref = argv[++i];
		else if (argv[i] === "--dsh-home") flags.dshHome = argv[++i];
	}
	return flags;
}

async function fetchWithRetry(url, retries = 6) {
	let lastError;
	for (let i = 0; i < retries; i++) {
		const response = await fetch(url);
		if (response.ok) return Buffer.from(await response.arrayBuffer());
		if (response.status === 429) {
			const retryAfter = Number(response.headers.get("retry-after") ?? 20);
			console.warn(`GitHub rate-limited; waiting ${retryAfter}s (attempt ${i + 1}/${retries})`);
			await new Promise((r) => setTimeout(r, retryAfter * 1000));
			continue;
		}
		if (response.status === 404) {
			throw new Error(`404: ${url} (does ${REPO}@${arguments[1]} have ${SKILL_DIR}?)`);
		}
		lastError = new Error(`GET ${url} -> ${response.status}`);
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw lastError ?? new Error(`fetch failed after retries: ${url}`);
}

async function main() {
	const { ref, dshHome } = parseArgs(process.argv.slice(2));
	const dsh = dshHome ? resolve(dshHome) : resolveDshHome();
	const dest = join(dsh, "skills", "nmr-analyze-simulate");

	console.log(`installing nmr-analyze-simulate -> ${dest} (ref ${ref})`);
	await mkdir(join(dest, "agents"), { recursive: true });
	await mkdir(join(dest, "references"), { recursive: true });
	await mkdir(join(dest, "scripts"), { recursive: true });

	for (const rel of FILES) {
		const buffer = await fetchWithRetry(RAW(ref, `${SKILL_DIR}/${rel}`));
		await writeFile(join(dest, rel), buffer);
		console.log(`  ok ${rel} (${buffer.length} B)`);
	}

	// 记录来源（固定版本信息，不自动更新）
	const source = { repo: REPO, ref, installedAt: new Date().toISOString(), skillDir: SKILL_DIR };
	await writeFile(join(dest, ".dsh-lab-agent-source.json"), `${JSON.stringify(source, null, 2)}\n`, "utf8");
	console.log("source recorded -> .dsh-lab-agent-source.json");
	console.log("done. agent 可在会话中加载 nmr-analyze-simulate skill；");
	console.log("Mnova 交互通过 mcp__mnova__* 工具（见 presets/mcp/mnova-mcp.patch.yml）。");
}

main().catch((error) => {
	console.error(`install-nmr-skill failed: ${error.message}`);
	process.exit(1);
});
