/**
 * dsh-lab-agent: nature-skills 机械化脚本执行器。
 *
 * nature skills 是 agentic（LLM 驱动），但含一批 stdlib-only 的机械化脚本，
 * 可由插件直接调用（计划 §五 的检索/准备/审计步骤）：
 *   - academic_search.py     OpenAlex 搜索（无 key，stdlib）
 *   - format-converter.py    引用导出 ris/bib/enw/nbib（PubMed/CrossRef/arXiv）
 *   - prepare_paper.py       PDF → source_bundle.json（stdlib）
 *   - audit_paper_card.py    精读报告审计（--card --bundle --locator-mode --report）
 *   - audit_pptx_quality.py  PPTX 质量审计（--report --json --fail-on）
 *
 * Python 解析：优先 labPython 的 venv python；不可用则回退系统 python3
 * （win32 用 py -3）。所有脚本仅依赖 stdlib，故系统 Python 即可运行。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** nature-skills 脚本相对 skills 根目录的路径。 */
export const SKILL_SCRIPTS = {
	search: "nature-academic-search/scripts/academic_search.py",
	exportCitations: "nature-academic-search/scripts/format-converter.py",
	preparePaper: "nature-paper-card/scripts/prepare_paper.py",
	auditPaperCard: "nature-paper-card/scripts/audit_paper_card.py",
	auditPptx: "nature-paper2ppt/scripts/audit_pptx_quality.py"
};

/** 系统 python 命令（平台感知）。 */
export function systemPython(platform = process.platform) {
	return platform === "win32" ? "py" : "python3";
}

export class SkillExecutor {
	/** @param config {{ skillsRoot: string, venvPython?: string, platform?: string }} */
	constructor(config) {
		this.skillsRoot = config.skillsRoot;
		this.venvPython = config.venvPython;
		this.platform = config.platform ?? process.platform;
	}

	/** 实际 python 命令：venv python 优先，否则系统 python。 */
	pythonCommand() {
		if (this.venvPython && existsSync(this.venvPython)) return this.venvPython;
		return systemPython(this.platform);
	}

	scriptPath(name) {
		const rel = SKILL_SCRIPTS[name];
		if (!rel) throw new Error(`unknown skill script '${name}'`);
		const path = join(this.skillsRoot, rel);
		if (!existsSync(path)) throw new Error(`skill script not found: ${path} (run scripts/install.mjs)`);
		return path;
	}

	/**
	 * 运行一个脚本，收集 stdout/stderr；支持超时与中止。
	 * @returns {{ code: number, stdout: string, stderr: string, timedOut: boolean }}
	 */
	run(name, args, { timeoutMs = 120000, signal } = {}) {
		const python = this.pythonCommand();
		const script = this.scriptPath(name);
		return new Promise((resolve, reject) => {
			const child = spawn(python, [script, ...args], {
				env: { ...process.env },
				stdio: ["ignore", "pipe", "pipe"],
				shell: this.platform === "win32"
			});
			let stdout = "";
			let stderr = "";
			let settled = false;
			const timer = timeoutMs
				? setTimeout(() => {
						child.kill("SIGKILL");
						settle({ code: -1, stdout, stderr, timedOut: true });
					}, timeoutMs)
				: undefined;
			const settle = (value) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				resolve(value);
			};
			child.stdout.on("data", (chunk) => (stdout += chunk));
			child.stderr.on("data", (chunk) => (stderr += chunk));
			child.on("error", reject);
			child.on("exit", (code) => settle({ code, stdout, stderr, timedOut: false }));
			signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
		});
	}

	/** OpenAlex 搜索（nature-academic-search）。 */
	async search(query, { limit = 10, sort = "relevance_score", yearFrom, author, mailto } = {}) {
		const args = [];
		if (author) {
			args.push("--author", author);
			if (query) args.push(query);
		} else {
			args.push(query);
		}
		if (limit) args.push("--limit", String(limit));
		if (sort) args.push("--sort", sort);
		if (yearFrom) args.push("--year-from", String(yearFrom));
		if (mailto) args.push("--mailto", mailto);
		const result = await this.run("search", args);
		if (result.code !== 0) {
			throw new Error(`search failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 400)}`);
		}
		try {
			const parsed = JSON.parse(result.stdout);
			return Array.isArray(parsed) ? parsed : parsed.results ?? [];
		} catch {
			throw new Error(`search output not JSON: ${result.stdout.slice(0, 200)}`);
		}
	}

	/** 引用导出（format-converter.py）。 */
	async exportCitations(ids, { format = "ris", outDir } = {}) {
		const args = [];
		for (const [kind, value] of Object.entries(ids)) {
			args.push(`--${kind}`, value);
		}
		if (format) args.push("--format", format);
		const result = await this.run("exportCitations", args);
		if (result.code !== 0) {
			throw new Error(`citation export failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 400)}`);
		}
		return { format, stdout: result.stdout };
	}

	/** PDF → source_bundle.json（nature-paper-card 的 prepare_paper.py）。 */
	async preparePaper(input, output, { renderDir } = {}) {
		const args = [input, "--output", output];
		if (renderDir) args.push("--render-dir", renderDir);
		const result = await this.run("preparePaper", args);
		if (result.code !== 0) {
			throw new Error(`prepare paper failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 400)}`);
		}
		return JSON.parse(await readFile(output, "utf8"));
	}

	/** 精读报告审计（audit_paper_card.py）。退出码：0 通过 / 1 有 errors / 2 参数错误。 */
	async auditPaperCard({ card, bundle, locatorMode, report }) {
		const args = ["--card", card, "--locator-mode", locatorMode];
		if (bundle) args.push("--bundle", bundle);
		if (report) args.push("--report", report);
		const result = await this.run("auditPaperCard", args);
		const audit = report ? JSON.parse(await readFile(report, "utf8")) : undefined;
		return {
			ok: result.code === 0,
			code: result.code,
			errors: audit?.summary?.errors ?? (result.code === 0 ? 0 : 1),
			warnings: audit?.summary?.warnings ?? 0,
			summary: audit?.summary?.text ?? (result.stderr || result.stdout).slice(0, 300),
			report
		};
	}

	/** PPTX 质量审计（nature-paper2ppt 的 audit_pptx_quality.py）。 */
	async auditPptx({ pptx, report, json, failOn = "high" }) {
		const args = [pptx];
		if (report) args.push("--report", report);
		if (json) args.push("--json", json);
		args.push("--fail-on", failOn);
		const result = await this.run("auditPptx", args);
		const data = json ? JSON.parse(await readFile(json, "utf8")) : undefined;
		return {
			ok: result.code === 0,
			code: result.code,
			findingCounts: data?.finding_counts ?? { high: 0, medium: 0, low: 0 },
			slideCount: data?.slide_count,
			report
		};
	}
}
