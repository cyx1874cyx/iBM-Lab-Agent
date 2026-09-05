/**
 * dsh-lab-agent: 文献→PPT 任务编排服务（Cordis host service, ctx.labTasks）。
 *
 * 计划 §五 流程 + §六 任务接口。机械化步骤直接调用 nature-skills 的 stdlib
 * 脚本（SkillExecutor）；LLM 驱动的步骤（精读报告、PPT 内容）由 agent 在会话
 * 中执行对应 skill 后调用 complete* 登记产物，再走审计门禁。
 *
 * 产物流程：实际 DOCX/PPTX 生成后先进入课题文献条目暂存区；自动自查仅提示，
 * 不阻断人工审核。只有人工审核绑定到当前文件哈希后，原文件下载才开放。
 * 每个产物记录 ArtifactProvenance（输入哈希 / skill 版本 / 模型 / 时间）。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { SkillExecutor } from "../src/skill-executor.js";
import { validatePdfBuffer } from "./literature-browser.js";
import { venvPythonPath } from "../src/python-env.js";
import { resolveDshHome, labAgentRoot } from "../src/paths.js";
import { toPaperCardRequirements } from "../src/goal-profile.js";
import { inspectOfficePackage } from "../src/office-package.js";
import { auditReadingNote } from "../src/reading-note-audit.js";
import { canonicalizePaper, deduplicatePapers, DEFAULT_SOURCES, normalizeDoi, rankDoiCandidates } from "../src/literature/search-engine.js";
import { markdownToDocx } from "./md2docx.js";
import { entryFileName, literatureEntryLayout } from "./entry-layout.js";
import {
	labProjectSchema,
	projectMemoryVersionSchema,
	projectMemoryKey,
	projectSessionSchema,
	projectSessionKey,
	literatureSearchRunSchema,
	paperSourceBundleSchema,
	readingReportSchema,
	presentationRunSchema,
	artifactProvenanceSchema,
	canTransit,
	RUN_STATUS
} from "../src/task-models.js";

export const labTasksDomainSpec = defineDomain({
	name: "lab_tasks",
	version: 0,
	tables: {
		lab_projects: domainTable(labProjectSchema),
		project_memory_versions: domainTable(projectMemoryVersionSchema),
		project_sessions: domainTable(projectSessionSchema),
		literature_search_runs: domainTable(literatureSearchRunSchema),
		paper_source_bundles: domainTable(paperSourceBundleSchema),
		reading_reports: domainTable(readingReportSchema),
		presentation_runs: domainTable(presentationRunSchema),
		artifact_provenance: domainTable(artifactProvenanceSchema)
	}
});

/** 产物 kind → 关联 nature skill 名。 */
export const KIND_TO_SKILL = {
	search: "nature-academic-search",
	"source-bundle": "nature-reader",
	"reading-report": "nature-paper-card",
	presentation: "nature-paper2ppt"
};

function cleanSearchPaper(record) {
	const { _providerRank, ...paper } = canonicalizePaper(record, record.sources?.[0] ?? "openalex");
	return paper;
}

/** target 是否位于 root 之下（含 root 自身；Windows 大小写不敏感）。 */
function isPathInside(root, target) {
	const r = resolve(root).toLowerCase();
	const t = resolve(target).toLowerCase();
	return t === r || t.startsWith(r + sep.toLowerCase());
}

/** 原子写入：临时文件 + rename（Windows 目标已存在时先移除再重试）。 */
async function atomicWrite(targetPath, buffer) {
	await mkdir(dirname(targetPath), { recursive: true });
	const tmpPath = join(dirname(targetPath), `.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
	await writeFile(tmpPath, buffer);
	try {
		await rename(tmpPath, targetPath);
	} catch (error) {
		await rm(targetPath, { force: true });
		await rename(tmpPath, targetPath);
	}
	return targetPath;
}

function searchEntryTitle(value, query) {
	const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
	return normalized ? [...normalized].slice(0, 80).join("") : `${String(query).trim()}相关文献`;
}

/**
 * 面板短引用统一为“期刊 卷, 页码 (年份).”。兼容登记时夹带作者，或原文
 * 标题末尾使用 “Nature 630:84-90, 2024” 的旧数据。
 */
export function normalizeJournalShortCitation(...values) {
	const pattern = /\*?([A-Z][A-Za-z.&' -]*?)\*?\s+(\d+[A-Za-z]?)\s*[,：:]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)\s*(?:\((\d{4})\)|,\s*(\d{4}))/g;
	for (const value of values) {
		const matches = [...String(value ?? "").matchAll(pattern)];
		const match = matches.at(-1);
		if (!match) continue;
		const journal = match[1].trim();
		const pages = match[3].replace(/\s*[-–—]\s*/g, "–");
		return `${journal} ${match[2]}, ${pages} (${match[4] || match[5]}).`;
	}
	return undefined;
}

/** 仅接受微信公众号正文链接；去掉分享场景参数，便于模型工具重试时幂等登记。 */
export function normalizeWechatArticleUrl(value) {
	let url;
	try { url = new URL(String(value ?? "").trim()); }
	catch { throw new Error("sourceUrl must be a valid WeChat article URL"); }
	if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "mp.weixin.qq.com" || !/^\/s(?:\/|$)/.test(url.pathname)) {
		throw new Error("sourceUrl must be an https://mp.weixin.qq.com/s... article URL");
	}
	url.hash = "";
	for (const key of ["scene", "subscene", "clicktime", "enterid", "ascene", "devicetype", "version", "lang", "session_us", "exportkey", "pass_ticket", "wx_header", "from"]) {
		url.searchParams.delete(key);
	}
	return url.href;
}

function cleanStringList(value) {
	if (value === undefined) return undefined;
	return [...new Set((Array.isArray(value) ? value : [value]).map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function inferredPublicationYear(year, publicationDate) {
	if (year !== undefined && year !== null && year !== "") return Number(year);
	const match = String(publicationDate ?? "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
	return match ? Number(match[1]) : undefined;
}

function decodeHtmlEntities(value) {
	const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
	return String(value ?? "")
		.replace(/&#x([0-9a-f]+);/gi, (_all, hex) => {
			try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return ""; }
		})
		.replace(/&#(\d+);/g, (_all, decimal) => {
			try { return String.fromCodePoint(Number.parseInt(decimal, 10)); } catch { return ""; }
		})
		.replace(/&([a-z]+);/gi, (all, key) => named[key.toLowerCase()] ?? all);
}

function htmlAttribute(tag, name) {
	const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
	if (quoted) return decodeHtmlEntities(quoted[2]).trim();
	const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"));
	return bare ? decodeHtmlEntities(bare[1]).trim() : undefined;
}

function htmlMeta(html, key) {
	for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
		const label = htmlAttribute(tag, "property") ?? htmlAttribute(tag, "name");
		if (label?.toLowerCase() === key.toLowerCase()) return htmlAttribute(tag, "content");
	}
	return undefined;
}

function elementHtmlById(html, id) {
	const opener = new RegExp(`<div\\b[^>]*\\bid\\s*=\\s*(["'])${id}\\1[^>]*>`, "i").exec(html);
	if (!opener) return undefined;
	const tags = /<\/?div\b[^>]*>/gi;
	tags.lastIndex = opener.index;
	let depth = 0;
	for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
		if (/^<\/div/i.test(tag[0])) depth -= 1;
		else depth += 1;
		if (depth === 0) return html.slice(opener.index, tags.lastIndex);
	}
	return html.slice(opener.index);
}

function visibleHtmlText(html) {
	const withoutNoise = String(html ?? "")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote)\s*>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "\n- ")
		.replace(/<[^>]+>/g, " ");
	const lines = decodeHtmlEntities(withoutNoise).replace(/\r/g, "").split("\n")
		.map((line) => line.replace(/[\t\f\v ]+/g, " ").trim()).filter(Boolean);
	return lines.filter((line, index) => index === 0 || line !== lines[index - 1]).join("\n");
}

/** 提取公众号页面中 AI 可见的正文；不在这里推断论文元数据。 */
export function extractWechatArticlePage(html) {
	const titleTag = String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const articleHtml = elementHtmlById(String(html ?? ""), "js_content") ?? String(html ?? "");
	const timestamp = String(html ?? "").match(/\bct\s*=\s*["'](\d{10})["']/)?.[1];
	return {
		pageTitle: htmlMeta(html, "og:title") ?? (titleTag ? visibleHtmlText(titleTag) : undefined),
		description: htmlMeta(html, "og:description") ?? htmlMeta(html, "description"),
		accountName: htmlMeta(html, "og:article:author") ?? htmlMeta(html, "author"),
		wechatPublishedAt: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : undefined,
		content: visibleHtmlText(articleHtml).slice(0, 50_000)
	};
}

async function boundedResponseText(response, maxBytes = 5_000_000) {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes) throw new Error("WeChat article response is too large");
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8");
	let total = 0;
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error("WeChat article response is too large");
		}
		text += decoder.decode(value, { stream: true });
	}
	return text + decoder.decode();
}

const GENERIC_PAPER_SUMMARIES = new Set([
	"相关研究", "相关综述", "传感器件", "成像方法", "制备方法", "治疗方法",
	"递送体系", "稳定性研究", "作用机制", "研究方法", "摘要待提炼"
]);

/** SI 补充材料常见扩展名 → MIME（未知一律 octet-stream，保留原文件名扩展）。 */
function mimeForPath(filePath) {
	const ext = filePath.toLowerCase().split(".").pop();
	return ({
		pdf: "application/pdf",
		zip: "application/zip",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		doc: "application/msword",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		xls: "application/vnd.ms-excel",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		ppt: "application/vnd.ms-powerpoint",
		txt: "text/plain;charset=utf-8",
		csv: "text/csv;charset=utf-8",
		md: "text/markdown;charset=utf-8"
	})[ext] ?? "application/octet-stream";
}

function normalizePaperLookup(value) {
	let normalized = String(value ?? "").trim().toLowerCase();
	if (!normalized) return "";
	normalized = normalized.replace(/^(?:paperid|paper_id|doi|id|openalex|pmid|arxiv)\s*:\s*/i, "").trim();
	const doi = normalizeDoi(normalized);
	if (doi) return doi;
	const openAlex = normalized.match(/(?:https?:\/\/openalex\.org\/)?(w\d+)(?:[/?#].*)?$/i);
	if (openAlex) return openAlex[1].toLowerCase();
	try {
		const url = new URL(normalized);
		url.hash = "";
		url.search = "";
		return url.href.replace(/\/$/, "").toLowerCase();
	} catch { return normalized.replace(/\s+/g, " "); }
}

export function publicSearchPaperId(paper) {
	return String(paper.doi ?? paper.pmid ?? paper.arxivId ?? paper.id ?? paper.landingUrl ?? paper.title ?? "").trim();
}

export function searchPaperAliases(paper) {
	return new Set([
		paper.doi, paper.pmid, paper.arxivId, paper.id, paper.landingUrl, paper.title,
		paper.doi ? `https://doi.org/${paper.doi}` : undefined
	].filter(Boolean).map(normalizePaperLookup).filter(Boolean));
}

export function searchPaperMatches(paper, value) {
	return searchPaperAliases(paper).has(normalizePaperLookup(value));
}

function normalizeAbstractSummary(value) {
	const normalized = String(value ?? "").replace(/[（）()\s，。；：、,.!?！？]/g, "").trim();
	// P2 修复 #6：按“汉字数”判定 2–9 字，而不是 UTF-16/码点长度——
	// 例如 9 个汉字不应被误判为超限；报错带实际汉字数便于模型纠正。
	const hanChars = [...normalized].filter((ch) => /\p{Script=Han}/u.test(ch));
	if (hanChars.length < 2 || hanChars.length > 9) {
		throw new Error(`摘要概括必须为 2–9 个汉字（实际 ${hanChars.length} 个汉字）：${value}`);
	}
	if (hanChars.length === 0) throw new Error(`摘要概括必须包含中文：${value}`);
	if (GENERIC_PAPER_SUMMARIES.has(normalized)) throw new Error(`摘要概括不能只是文章类型：${value}`);
	return normalized;
}

/** Merge legacy/multiple rows into one read model without deleting stored results. */
export function mergeSessionSearchRows(rows) {
	if (!rows.length) return undefined;
	const ordered = rows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const base = ordered[0];
	const queries = [...new Set(ordered.flatMap((row) => row.queries?.length ? row.queries : [row.query]).filter(Boolean))];
	const sources = [...new Set(ordered.flatMap((row) => row.sources ?? []))];
	const sourceFailures = [...new Map(ordered.flatMap((row) => row.sourceFailures ?? []).map((failure) => [`${failure.source}\n${failure.message}`, failure])).values()];
	const results = deduplicatePapers(ordered.flatMap((row) => row.results ?? [])).map(cleanSearchPaper);
	const latestTitle = ordered.slice().reverse().find((row) => row.title?.trim())?.title;
	const status = ordered.some((row) => row.status === "running") ? "running"
		: ordered.some((row) => row.status === "succeeded") ? "succeeded"
			: ordered.at(-1).status;
	return {
		...base,
		title: latestTitle ?? searchEntryTitle(undefined, base.query),
		queries,
		sources,
		results,
		sourceFailures,
		status,
		progress: `${results.length} references from ${queries.length} queries`,
		identifier: queries.length === 1 ? ordered.at(-1).identifier : undefined,
		updatedAt: ordered.map((row) => row.updatedAt).sort().at(-1)
	};
}

export class LabTasksService extends Service {
	static inject = ["storageDomain", "labGoals", "labTemplates", "labNoteTemplates", "labVersions"];
	/** 课题工作区里的核心记忆文件（agent 在对话中直接读取，不预填输入框）。 */
	static PROJECT_MEMORY_FILE = "项目记忆.md";
	tables = {};
	executor;

	/** @param config {{ skillsRoot?: string, venvDir?: string, projectsRoot?: string, researchPreset?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labTasks");
		this.config = config;
		// 每个课题一个独立工作区目录：$DSH_HOME/lab-agent/projects/<projectId>。
		this.projectsRoot = config.projectsRoot ?? join(labAgentRoot(resolveDshHome()), "projects");
		// 课题创建后自动启用的科研 Agent 预设（preset id = preset 目录名）。
		this.researchPreset = config.researchPreset ?? "lab-research";
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labTasksDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.tasks.domainClose");
		this.domain = domain;
		this.tables = {
			projects: domain.table("lab_projects"),
			memories: domain.table("project_memory_versions"),
			sessions: domain.table("project_sessions"),
			searches: domain.table("literature_search_runs"),
			bundles: domain.table("paper_source_bundles"),
			reports: domain.table("reading_reports"),
			presentations: domain.table("presentation_runs"),
			provenance: domain.table("artifact_provenance")
		};
		this.executor = new SkillExecutor({
			skillsRoot: this.config.skillsRoot,
			venvPython: this.config.venvDir ? venvPythonPath(this.config.venvDir) : undefined
		});
		await this.migrateLegacySessionBindings();
		await this.migrateLegacyReviewGates();
		await this.resumePendingMachineReviews();
	}

	/**
	 * 升级迁移：只要实际产物已登记，就进入人工审阅暂存区。机器审计/QA 仅作
	 * 提示，不再把旧产物卡在 running/failed，也不替代研究人员决策。
	 */
	async migrateLegacyReviewGates() {
		const now = new Date().toISOString();
		for (const [tableName, pathField] of [
			["reports", "paperCardPath"],
			["presentations", "pptxPath"]
		]) {
			const table = this.table(tableName);
			for (const key of table.keys()) {
				let row = table.get(key);
				if (!row[pathField]) continue;
				if (tableName === "reports" && (!row.docxPath || !existsSync(row.docxPath))) {
					try {
						const staged = await this.materializeReadingDocx(row);
						row = { ...row, docxPath: staged.docxPath, artifactSha256: staged.integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy reading report '${key}' DOCX staging failed: ${error.message}`);
						continue;
					}
				}
				if (tableName === "reports" && row.docxPath && !row.artifactSha256) {
					try {
						const integrity = await inspectOfficePackage(await readFile(row.docxPath), "docx");
						row = { ...row, artifactSha256: integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy reading report '${key}' DOCX integrity migration failed: ${error.message}`);
						continue;
					}
				}
				if (tableName === "presentations" && (!row.artifactSha256 || !row.review?.artifactSha256)) {
					try {
						const integrity = await inspectOfficePackage(await readFile(row.pptxPath), "pptx");
						row = { ...row, artifactSha256: integrity.sha256 };
						await table.put(key, row);
					} catch (error) {
						this.ctx.logger.warn(`legacy presentation '${key}' PPTX staging failed: ${error.message}`);
						continue;
					}
				}
				const approvedHashMatches = row.review?.status === "approved" && row.review?.artifactSha256 === row.artifactSha256;
				if (approvedHashMatches || row.review?.status === "rejected") continue;
				if (row.status !== "under-review" || row.review?.status !== "pending") await table.put(key, { ...row, status: "under-review", progress: "artifact staged; awaiting human review", review: { status: "pending", reviewer: "human-ui" }, updatedAt: now });
			}
		}
	}

	/** 启动时补跑被旧状态机跳过的机器评审；失败留在 failed，不开放人工按钮。 */
	async resumePendingMachineReviews() {
		for (const key of this.table("reports").keys()) {
			const row = this.table("reports").get(key);
			if (row.status !== "running" || !row.paperCardPath || row.audit?.ok) continue;
			try { await this.validateReadingReport({ reportId: key }); }
			catch (error) { this.ctx.logger.warn(`legacy reading report '${key}' machine review failed: ${error.message}`); }
		}
		for (const key of this.table("presentations").keys()) {
			const row = this.table("presentations").get(key);
			if (row.status !== "running" || !row.pptxPath || row.qa?.ok) continue;
			try { await this.validatePresentation({ runId: key }); }
			catch (error) { this.ctx.logger.warn(`legacy presentation '${key}' machine QA failed: ${error.message}`); }
		}
	}

	/**
	 * 升级迁移：旧版 project_sessions 行是 `{ projectId, sessionId, workspaceId }`
	 * （单会话绑定）；新版为工作区级 `{ projectId, workspaceId, sessionIds[] }`。
	 * 启动时把旧 `sessionId` 收进 `sessionIds`，保证既有会话继续可反查。
	 */
	async migrateLegacySessionBindings() {
		const table = this.table("sessions");
		for (const key of table.keys()) {
			const row = table.get(key);
			if (row.sessionId !== undefined && Array.isArray(row.sessionIds) === false) {
				await table.put(key, {
					projectId: row.projectId,
					workspaceId: row.workspaceId,
					sessionIds: [row.sessionId],
					createdAt: row.createdAt ?? new Date().toISOString()
				});
			}
		}
	}

	table(name) {
		const t = this.tables[name];
		if (t === undefined) throw new Error("labTasks is not started yet");
		return t;
	}

	requireProject(id) {
		const project = this.table("projects").get(id);
		if (project === undefined) throw new Error(`project '${id}' not found`);
		return project;
	}

	/** 更新一行并校验状态迁移。 */
	async transit(tableName, id, patch, now = new Date().toISOString()) {
		const table = this.table(tableName);
		const row = table.get(id);
		if (row === undefined) throw new Error(`${tableName} '${id}' not found`);
		if (patch.status && patch.status !== row.status) {
			if (!canTransit(row.status, patch.status)) {
				throw new Error(`invalid transition ${row.status} -> ${patch.status} for ${tableName} '${id}'`);
			}
		}
		const next = { ...row, ...patch, updatedAt: now };
		await table.put(id, next);
		return next;
	}

	/** 记录 ArtifactProvenance。 */
	async recordProvenance({ projectId, kind, runId, inputs, model, source }) {
		const skillName = KIND_TO_SKILL[kind];
		const skill = skillName ? await this.ctx.labVersions.resolveNatureSkill(skillName) : undefined;
		const now = new Date().toISOString();
		const id = `${kind}-${runId}`;
		const record = artifactProvenanceSchema.parse({
			id,
			projectId,
			kind,
			runId,
			inputsSha256: createHash("sha256").update(JSON.stringify(inputs ?? {})).digest("hex"),
			skillVersions: skill
				? [{ skillName: skill.skillName, commitSha: skill.commitSha, manifestVersion: skill.manifestVersion }]
				: [],
			model,
			source: source ?? "labTasks",
			createdAt: now
		});
		await this.table("provenance").put(id, record);
		return record;
	}

	// ── 项目 ────────────────────────────────────────────────────────────────

	/** 创建项目：保存所选目标/模板版本快照 + 创建专属工作区目录（§五 步骤 1）。 */
	async createProject({ id, name, coreMarkdown, memoryChangeNote, goalProfileId, goalProfileVersion, templateId, templateVersion }) {
		if (this.table("projects").get(id) !== undefined) throw new Error(`project '${id}' already exists`);
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		const now = new Date().toISOString();
		// 课题专属工作区目录：workspace.create 采纳一个已存在目录。
		const workspacePath = join(this.projectsRoot, id);
		await mkdir(workspacePath, { recursive: true });
		const project = labProjectSchema.parse({
			id,
			name,
			goalProfile: { id: goal.id, version: goal.version, snapshot: goal },
			template: { id: template.id, version: template.version, snapshot: template },
			status: "active",
			memoryVersion: "1",
			workspacePath,
			createdAt: now,
			updatedAt: now
		});
		const markdown = coreMarkdown?.trim() || [
			`# ${name}`,
			"",
			"## 核心课题",
			"请在此描述研究问题、核心假设和预期目标。",
			"",
			"## 当前进展",
			"- 项目已创建"
		].join("\n");
		const memory = projectMemoryVersionSchema.parse({
			id: projectMemoryKey(id, "1"),
			projectId: id,
			version: "1",
			markdown,
			changeNote: memoryChangeNote?.trim() || "创建课题核心记忆",
			contentSha256: createHash("sha256").update(markdown).digest("hex"),
			createdAt: now
		});
		await this.table("projects").put(id, project);
		await this.table("memories").put(memory.id, memory);
		await this.writeProjectMemoryFile(id);
		return project;
	}

	listProjects() {
		return [...this.table("projects").keys()].sort().map((k) => this.table("projects").get(k));
	}

	/**
	 * 彻底删除课题：先校验并删除插件专属 projects/<id> 工作区目录，再级联
	 * 删除任务域中的课题数据。Harness 工作区注册由浏览器侧 WorkspaceRuntime
	 * 删除；这里不接触 `.dsh/sessions` 中由 Harness 自己管理的会话日志。
	 */
	async deleteProject(projectId) {
		const project = this.requireProject(projectId);
		const projectsRoot = resolve(this.projectsRoot);
		const expectedPath = resolve(projectsRoot, projectId);
		const workspacePath = resolve(project.workspacePath ?? expectedPath);
		if (workspacePath !== expectedPath || workspacePath === projectsRoot) {
			throw new Error(`refusing to delete project workspace outside '${projectsRoot}': ${workspacePath}`);
		}

		// 先删文件；若权限等原因失败则保留登记，修正后可安全重试。
		await rm(workspacePath, { recursive: true, force: true });

		const deleted = {};
		for (const tableName of ["provenance", "presentations", "reports", "bundles", "searches", "memories", "sessions"]) {
			const table = this.table(tableName);
			let count = 0;
			for (const key of [...table.keys()]) {
				const row = table.get(key);
				if (row?.projectId !== projectId) continue;
				if (await table.delete(key)) count += 1;
			}
			deleted[tableName] = count;
		}
		deleted.projects = await this.table("projects").delete(projectId) ? 1 : 0;
		return { projectId, workspacePath, deleted };
	}

	/** 确保课题有专属工作区目录（升级前的旧项目可能没有 workspacePath）：
	 *  有则返回原路径；没有则建默认目录并写回项目行。同时确保核心记忆文件
	 *  「项目记忆.md」存在（旧项目缺文件时补写）。返回 { path }。 */
	async ensureProjectWorkspace(projectId) {
		const project = this.requireProject(projectId);
		let workspacePath = project.workspacePath;
		if (!workspacePath) {
			workspacePath = join(this.projectsRoot, projectId);
			await mkdir(workspacePath, { recursive: true });
			const updated = { ...project, workspacePath };
			await this.table("projects").put(projectId, updated);
		}
		const memoryFile = join(workspacePath, LabTasksService.PROJECT_MEMORY_FILE);
		if (!existsSync(memoryFile)) await this.writeProjectMemoryFile(projectId);
		return { path: workspacePath };
	}

	/** 把当前版本核心记忆落盘到课题工作区 `项目记忆.md`（无工作区则跳过）。
	 *  文件头带版本与变更说明，供 agent 读取时识别当前版本。 */
	async writeProjectMemoryFile(projectId) {
		const project = this.requireProject(projectId);
		if (!project.workspacePath) return;
		const memory = this.getProjectMemory(projectId);
		if (memory === undefined) return;
		const header = [
			`# ${project.name} — 课题核心记忆`,
			"",
			`> 版本 v${memory.version} · 更新于 ${memory.createdAt} · ${memory.changeNote ?? ""}`,
			"> 本文件是课题的长期记忆，由「课题核心记忆」面板/`lab_project_memory_update` 维护，",
			"> 每次提交新版本会整体重写。阅读时以文件内容为准，勿参考其他孤立文件。",
			""
		].join("\n");
		await writeFile(join(project.workspacePath, LabTasksService.PROJECT_MEMORY_FILE), header + memory.markdown + "\n", "utf8");
	}

	/** 记录课题 ↔ 工作区绑定（工作区级：该空间内所有会话归属同一课题）。 */
	async bindProjectWorkspace({ projectId, workspaceId }) {
		this.requireProject(projectId);
		const existing = this.getProjectSession(projectId);
		const now = new Date().toISOString();
		const row = projectSessionSchema.parse(existing ?? { projectId, workspaceId, sessionIds: [], createdAt: now });
		row.workspaceId = workspaceId;
		if (existing === undefined) row.createdAt = now;
		await this.table("sessions").put(projectSessionKey(projectId), row);
		return row;
	}

	/** 记录某个会话归属课题（追加进 sessionIds；重复调用幂等）。 */
	async bindProjectSession({ projectId, sessionId, workspaceId }) {
		this.requireProject(projectId);
		const existing = this.getProjectSession(projectId);
		const now = new Date().toISOString();
		const row = projectSessionSchema.parse(existing ?? { projectId, workspaceId, sessionIds: [], createdAt: now });
		if (existing === undefined) row.createdAt = now;
		if (workspaceId !== undefined) row.workspaceId = workspaceId;
		if (!row.sessionIds.includes(sessionId)) row.sessionIds = [...row.sessionIds, sessionId];
		await this.table("sessions").put(projectSessionKey(projectId), row);
		return row;
	}

	/** 查询某课题的工作区/会话绑定（无则返回 undefined）。 */
	getProjectSession(projectId) {
		return this.table("sessions").get(projectSessionKey(projectId));
	}

	/** 反查：某 Harness 会话属于哪个课题（launch 绑定过的会话；无则返回 undefined）。 */
	getProjectBySession(sessionId) {
		for (const key of this.table("sessions").keys()) {
			const row = this.table("sessions").get(key);
			if ((row.sessionIds ?? []).includes(sessionId) || row.sessionId === sessionId) {
				const project = this.table("projects").get(row.projectId);
				if (project !== undefined) return { project, sessionId, workspaceId: row.workspaceId };
			}
		}
		return undefined;
	}

	/** 反查：某工作区属于哪个课题（该空间内所有会话都共享课题标识与记忆）。 */
	getProjectByWorkspace(workspaceId) {
		for (const key of this.table("sessions").keys()) {
			const row = this.table("sessions").get(key);
			if (row.workspaceId === workspaceId) {
				const project = this.table("projects").get(row.projectId);
				if (project !== undefined) return { project, workspaceId, sessionIds: row.sessionIds ?? [] };
			}
		}
		return undefined;
	}

	/** 反查：某工作目录（cwd）属于哪个课题。匹配 project.workspacePath，
	 *  不依赖绑定记录——同一课题空间里手动新建的会话也能识别课题。 */
	getProjectByCwd(path) {
		if (!path) return undefined;
		const normalized = String(path).replace(/[\\/]+$/, "");
		for (const id of this.table("projects").keys()) {
			const project = this.table("projects").get(id);
			if (project.workspacePath && String(project.workspacePath).replace(/[\\/]+$/, "") === normalized) {
				const row = this.getProjectSession(id);
				return { project, workspaceId: row?.workspaceId, sessionIds: row?.sessionIds ?? [] };
			}
		}
		return undefined;
	}

	getProjectMemory(projectId, version) {
		const project = this.requireProject(projectId);
		const resolvedVersion = version ?? project.memoryVersion;
		return this.table("memories").get(projectMemoryKey(projectId, resolvedVersion));
	}

	listProjectMemoryVersions(projectId) {
		this.requireProject(projectId);
		return [...this.table("memories").keys()]
			.map((key) => this.table("memories").get(key))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => Number(b.version) - Number(a.version));
	}

	async updateProjectMemory({ projectId, markdown, changeNote }) {
		const project = this.requireProject(projectId);
		const normalized = markdown?.trim();
		if (!normalized) throw new Error("project core markdown must not be empty");
		const current = this.getProjectMemory(projectId);
		if (current?.markdown === normalized) throw new Error("project core markdown has not changed");
		// 兼容升级前已存在、尚无 memory 行的项目：第一次提交从 v1 开始。
		const version = current === undefined ? "1" : String(Number(project.memoryVersion) + 1);
		const now = new Date().toISOString();
		const memory = projectMemoryVersionSchema.parse({
			id: projectMemoryKey(projectId, version),
			projectId,
			version,
			markdown: normalized,
			changeNote: changeNote?.trim() || "更新课题核心记忆",
			contentSha256: createHash("sha256").update(normalized).digest("hex"),
			createdAt: now
		});
		await this.table("memories").put(memory.id, memory);
		await this.table("projects").put(projectId, { ...project, memoryVersion: version, updatedAt: now });
		await this.writeProjectMemoryFile(projectId);
		return memory;
	}

	// ── §六 接口：文献检索 ───────────────────────────────────────────────────

	/** searchLiterature：多源检索、统一字段、去重排序并严格过滤主题检索的 OA 结果。 */
	async searchLiterature({ projectId, query, title, sources, limit, sort, yearFrom, oaOnly = true, runId, mailto, model, sessionId }) {
		this.requireProject(projectId);
		const selectedSources = sources?.length ? sources : DEFAULT_SOURCES;
		const sessionRows = sessionId ? [...this.table("searches").keys()].map((key) => this.table("searches").get(key)).filter((row) => row.projectId === projectId && row.sessionId === sessionId) : [];
		const explicit = runId ? this.table("searches").get(runId) : undefined;
		const prior = explicit ?? mergeSessionSearchRows(sessionRows);
		const id = runId ?? prior?.id ?? `search-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const queries = [...new Set([...(prior?.queries?.length ? prior.queries : (prior?.query ? [prior.query] : [])), query])];
		const run = literatureSearchRunSchema.parse({
			...prior,
			id,
			projectId,
			title: searchEntryTitle(title ?? prior?.title, query),
			query,
			queries,
			sources: [...new Set([...(prior?.sources ?? []), ...selectedSources])],
			oaOnly,
			limit: limit ?? 10,
			sort: sort ?? "relevance_score",
			yearFrom,
			status: "running",
			progress: `searching ${selectedSources.join(", ")}`,
			sessionId,
			createdAt: prior?.createdAt ?? now,
			updatedAt: now
		});
		await this.table("searches").put(id, run);
		try {
			const results = await this.executor.search(query, { sources: selectedSources, limit: limit ?? 10, sort: sort ?? "relevance_score", yearFrom, mailto, oaOnly });
			const meta = results.meta ?? { failures: [], identifier: undefined };
			if (results.length === 0 && meta.failures?.length === selectedSources.length) {
				throw new Error(`all literature sources failed: ${meta.failures.map((failure) => `${failure.source}: ${failure.message}`).join("; ")}`);
			}
			const normalized = results.map(cleanSearchPaper);
			const combined = deduplicatePapers([...(prior?.results ?? []), ...normalized]).map(cleanSearchPaper);
			const failures = [...new Map([...(prior?.sourceFailures ?? []), ...(meta.failures ?? [])].map((failure) => [`${failure.source}\n${failure.message}`, failure])).values()];
			const next = literatureSearchRunSchema.parse({
				...run,
				status: "succeeded",
				progress: `${combined.length} references from ${queries.length} queries${meta.failures?.length ? `; ${meta.failures.length} source(s) degraded` : ""}`,
				results: combined,
				sourceFailures: failures,
				identifier: queries.length === 1 ? meta.identifier : undefined,
				updatedAt: new Date().toISOString()
			});
			await this.table("searches").put(id, next);
			await this.recordProvenance({ projectId, kind: "search", runId: id, inputs: { queries, sources: next.sources, limit, sort, yearFrom, oaOnly }, model });
			return next;
		} catch (error) {
			await this.table("searches").put(id, literatureSearchRunSchema.parse({
				...run,
				status: prior?.results?.length ? "succeeded" : "failed",
				error: error.message,
				progress: prior?.results?.length ? `${prior.results.length} references; latest query failed` : "failed",
				updatedAt: new Date().toISOString()
			}));
			throw error;
		}
	}

	/** 用 Agent 对摘要/标题的理解，为检索结果写入九字内核心内容概括。 */
	async updateSearchSummaries({ runId, summaries }) {
		const aggregate = this.getSearchRun(runId);
		if (aggregate === undefined) throw new Error(`search run '${runId}' not found`);
		const accepted = [];
		const rejected = [];
		for (const item of summaries ?? []) {
			const paperId = String(item?.paperId ?? "").trim();
			try {
				if (!paperId) throw new Error("paperId 为空");
				accepted.push({ paperId, lookup: normalizePaperLookup(paperId), summaryZh: normalizeAbstractSummary(item?.summaryZh ?? item?.summary) });
			} catch (error) {
				rejected.push({ paperId, reason: error.message });
			}
		}
		if (!accepted.length && !rejected.length) throw new Error("summaries must not be empty");
		const table = this.table("searches");
		const rows = [...table.keys()].map((key) => table.get(key)).filter((row) =>
			row.id === runId || (aggregate.sessionId && row.projectId === aggregate.projectId && row.sessionId === aggregate.sessionId));
		const matched = new Set();
		for (const row of rows) {
			let changed = false;
			const results = (row.results ?? []).map((paper) => {
				const entry = accepted.find((item) => searchPaperMatches(paper, item.lookup));
				if (!entry) return paper;
				changed = true;
				matched.add(entry.paperId);
				return { ...paper, shortDescriptionZh: entry.summaryZh };
			});
			if (changed) await table.put(row.id, literatureSearchRunSchema.parse({ ...row, results, updatedAt: new Date().toISOString() }));
		}
		const unmatched = accepted.filter((item) => !matched.has(item.paperId)).map((item) => item.paperId);
		return {
			run: this.getSearchRun(runId),
			updated: matched.size,
			unmatched,
			rejected,
			availablePaperIds: aggregate.results.map(publicSearchPaperId)
		};
	}

	/** 检索结果导出（format-converter.py；需网络访问 PubMed/CrossRef/arXiv）。 */
	async exportSearchCitations(runId, { format = "ris" } = {}) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const dois = run.results.map((r) => r.doi).filter(Boolean).slice(0, 10);
		if (dois.length === 0) throw new Error("no DOIs to export");
		const result = await this.executor.exportCitations({ doi: dois.join(",") }, { format });
		return { format, text: result.stdout };
	}

	// ── §六·面板 接口：检索 .ris / 精读概览 / 产物下载 ────────────────────────

	/**
	 * 把一条检索 run 的 results 离线重建为 RIS 文本（不依赖网络导出）。
	 * 条目面板的 .ris 按钮据此在浏览器触发下载，RIS 内就是该检索登记到的文献。
	 */
	searchRunRis(runId) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const results = run.results ?? [];
		if (results.length === 0) throw new Error(`search run '${runId}' has no results to export`);
		const lines = [];
		for (const r of results) {
			lines.push("TY  - JOUR");
			for (const author of (r.authors ?? [])) lines.push(`AU  - ${author}`);
			if (r.title) lines.push(`TI  - ${r.title}`);
			if (r.year) lines.push(`PY  - ${r.year}`);
			if (r.doi) lines.push(`DO  - ${r.doi}`);
			if (r.journal || (r.source && r.source !== "openalex")) lines.push(`JO  - ${r.journal ?? r.source}`);
			if (r.volume) lines.push(`VL  - ${r.volume}`);
			if (r.issue) lines.push(`IS  - ${r.issue}`);
			if (r.pages) {
				const [startPage, endPage] = String(r.pages).split(/[-–]/, 2);
				if (startPage) lines.push(`SP  - ${startPage}`);
				if (endPage) lines.push(`EP  - ${endPage}`);
			}
			if (r.abstract) lines.push(`AB  - ${r.abstract}`);
			if (r.pdfUrl) lines.push(`UR  - ${r.pdfUrl}`);
			lines.push("ER  -");
			lines.push("");
		}
		return { format: "ris", fileName: `${run.id}.ris`, text: lines.join("\n"), count: results.length };
	}

	/** 200字概览卡片：优先登记时的 summary，缺省从 paper-card 推导。 */
	async readingReportOverview(reportId) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		const bundle = this.table("bundles").get(report.bundleId);
		const shortCitation = normalizeJournalShortCitation(report.shortCitation, bundle?.title) || report.shortCitation || bundle?.title || report.id;
		const titleZh = report.titleZh || bundle?.title || shortCitation;
		let summary = report.summary;
		if (!summary && report.paperCardPath && existsSync(report.paperCardPath)) {
			summary = await this.deriveCardSummary(report.paperCardPath);
		}
		if (!summary && bundle?.abstract) summary = bundle.abstract;
		if (!summary && bundle?.acquisitionStatus === "awaiting-pdf") summary = "已从微信公众号文章提取文献元数据；等待研究人员手工下载并上传 PDF 后开始全文精读。";
		if (!summary) summary = "暂无概览：完成 paper card 精读登记后自动生成。";
		return { reportId, shortCitation, titleZh, summary };
	}

	/** 从 paper-card markdown 推导一段约 200 字的概览（body 首段，过滤元信息/标题/表格）。 */
	async deriveCardSummary(paperCardPath, budget = 200) {
		const markdown = await readFile(paperCardPath, "utf8");
		const kept = [];
		for (const raw of markdown.split(/\r?\n/)) {
			const line = raw.trim();
			if (line === "") continue;
			if (line.startsWith(">")) continue; // 元信息块
			if (/^#{1,6}\s/.test(line)) continue; // 标题
			if (/^\|.*\|$/.test(line)) continue; // 表格行
			kept.push(line);
		}
		let text = kept.join(" ").replace(/\s+/g, " ").trim();
		if (text.length > budget) text = text.slice(0, budget).replace(/\s+\S*$/, "") + "…";
		return text;
	}

	/** 下载门禁：人工审核必须绑定到当前实际 Office 文件的 SHA-256。 */
	assertApprovedArtifact(row, label, sha256) {
		if (row.review?.status !== "approved") throw new Error(`${label} is awaiting human review; preview it and approve before download`);
		if (!row.review?.artifactSha256 || row.review.artifactSha256 !== sha256) {
			throw new Error(`${label} changed after review; preview and approve the current version again`);
		}
	}

	/** 生成或接收一次性的实际 DOCX 暂存文件；预览和最终下载始终读取同一文件。
	 *  DOCX 固化到文献条目目录（<entryStem> 精读报告.docx），与正文/SI 同目录。 */
	async materializeReadingDocx(report, providedPath) {
		if (!report.paperCardPath || !existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath ?? "(empty path)"}`);
		const bundle = this.table("bundles").get(report.bundleId);
		const workspace = await this.ensureProjectWorkspace(report.projectId);
		const layout = literatureEntryLayout(workspace.path, bundle, report);
		let buffer;
		if (providedPath) {
			if (!existsSync(providedPath)) throw new Error(`docx file missing: ${providedPath}`);
			buffer = await readFile(providedPath);
		} else {
			const content = await readFile(report.paperCardPath, "utf8");
			buffer = await markdownToDocx(content, { title: report.titleZh || report.shortCitation || report.id });
		}
		const docxPath = await atomicWrite(join(layout.entryDir, entryFileName(layout.entryStem, "report-docx")), buffer);
		const integrity = await inspectOfficePackage(buffer, "docx");
		return { docxPath, buffer, integrity };
	}

	/** 构造精读报告文件；生成完成后即可打开/下载，不设人工审核门禁。 */
	async readingReportFile(reportId, format = "md", { requireApproved = false } = {}) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card yet`);
		if (!existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath}`);
		if (!report.docxPath || !existsSync(report.docxPath)) throw new Error(`reading report '${reportId}' has no staged DOCX yet`);
		const docxBuffer = await readFile(report.docxPath);
		const docxIntegrity = await inspectOfficePackage(docxBuffer, "docx");
		if (requireApproved) this.assertApprovedArtifact(report, `reading report '${reportId}'`, docxIntegrity.sha256);
		const bundle = this.table("bundles").get(report.bundleId);
		const base = bundle?.entryStem
			? entryFileName(bundle.entryStem, format === "docx" ? "report-docx" : "report-md").replace(/\.(docx|md)$/i, "")
			: reportId;
		if (format === "docx") {
			return {
				fileName: `${base}.docx`,
				mime: docxIntegrity.mime,
				buffer: docxBuffer,
				format: "docx",
				byteLength: docxIntegrity.byteLength,
				sha256: docxIntegrity.sha256
			};
		}
		const content = await readFile(report.paperCardPath, "utf8");
		const buffer = Buffer.from(content, "utf8");
		return {
			fileName: `${base}.md`,
			mime: "text/markdown;charset=utf-8",
			buffer,
			text: content,
			format: "md",
			byteLength: buffer.length,
			sha256: createHash("sha256").update(buffer).digest("hex")
		};
	}

	/** RPC 兼容接口；Web 面板使用 /api/lab-artifacts 二进制流，不再走这里的 base64。 */
	async readingReportDownload(reportId, format = "md") {
		const file = await this.readingReportFile(reportId, format);
		if (file.format === "docx") {
			return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
		}
		return { ...file, buffer: undefined };
	}

	/** 该 report 的全部 PPT run，按时间倒序（最新在前）。 */
	listPresentationsForReport(reportId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.reportId === reportId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/** 文献汇报 PPT 文件：找到该 report 最新的含 pptx 的 run并验证 OOXML。 */
	async presentationFile(reportId, { requireApproved = false } = {}) {
		const run = this.listPresentationsForReport(reportId).find((r) => r.pptxPath && existsSync(r.pptxPath));
		if (run === undefined) throw new Error(`reading report '${reportId}' has no downloadable PPTX yet`);
		const buffer = await readFile(run.pptxPath);
		const integrity = await inspectOfficePackage(buffer, "pptx");
		if (requireApproved) this.assertApprovedArtifact(run, `presentation '${run.id}'`, integrity.sha256);
		return {
			fileName: `${run.id}.pptx`,
			mime: integrity.mime,
			buffer,
			byteLength: integrity.byteLength,
			sha256: integrity.sha256
		};
	}

	/** RPC 兼容接口；Web 面板改用二进制 HTTP 流。 */
	async presentationDownload(reportId) {
		const file = await this.presentationFile(reportId);
		return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
	}

	/**
	 * bundleFile：读取已登记原文（PDF）或 SI 补充材料文件，供 /api/lab-artifacts
	 * 二进制流下载（kind=pdf|si）。PDF 直接复用登记时的 pdfSha256；SI 若登记时
	 * 已固化 siSha256 则复用，否则现场计算。
	 */
	async bundleFile(bundleId, which) {
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		const rel = which === "pdf" ? "pdfPath" : which === "si" ? "siPath" : null;
		if (!rel || !bundle[rel]) throw new Error(`source bundle '${bundleId}' has no ${which} file`);
		const filePath = bundle[rel];
		if (!existsSync(filePath)) throw new Error(`${which} file missing: ${filePath}`);
		const buffer = await readFile(filePath);
		// 正文与 SI 在本版本都必须是 PDF：签名/EOF/大小/SHA-256 校验，MIME 恒为 application/pdf。
		const integrity = validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
		const expectedSha256 = which === "pdf" ? bundle.pdfSha256 : bundle.siSha256;
		if (expectedSha256 && integrity.sha256 !== expectedSha256) throw new Error(`${which} file changed after registration`);
		return { fileName: basename(filePath), mime: "application/pdf", buffer, byteLength: buffer.length, sha256: integrity.sha256 };
	}

	// ── §六 接口：论文准备 ───────────────────────────────────────────────────

	/**
	 * 读取用户明确提供的公众号正文，供模型提取文献元数据。入口严格限制为
	 * mp.weixin.qq.com/s，且拒绝跨站重定向、二进制响应和超大正文；不会下载 PDF。
	 */
	async fetchWechatArticle({ sourceUrl }) {
		let currentUrl = normalizeWechatArticleUrl(sourceUrl);
		const signal = AbortSignal.timeout(30_000);
		for (let hop = 0; hop <= 3; hop++) {
			const response = await fetch(currentUrl, {
				redirect: "manual",
				signal,
				headers: {
					accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
					"accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
					// 微信会把桌面 Chrome 的无 Cookie 请求重定向到
					// /mp/wappoc_appmsgcaptcha；公开正文对微信 Android WebView
					// 正常返回。这里只改变客户端标识，不携带登录态或绕过验证码。
					"user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49"
				}
			});
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) throw new Error(`WeChat article redirect ${response.status} has no location`);
				if (hop === 3) throw new Error("WeChat article redirected too many times");
				const redirected = new URL(location, currentUrl);
				if (redirected.hostname.toLowerCase() === "mp.weixin.qq.com" && redirected.pathname === "/mp/wappoc_appmsgcaptcha") {
					throw new Error("WeChat requested human verification for this server IP; retry later or paste the visible article text into the conversation");
				}
				currentUrl = normalizeWechatArticleUrl(redirected.href);
				continue;
			}
			if (!response.ok) throw new Error(`WeChat article returned HTTP ${response.status}`);
			const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
			if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.startsWith("text/")) {
				throw new Error(`WeChat article returned unsupported content type: ${contentType}`);
			}
			const page = extractWechatArticlePage(await boundedResponseText(response));
			if (!page.content || page.content.length < 20) throw new Error("WeChat article body is unavailable or requires verification");
			return { sourceUrl: currentUrl, ...page };
		}
		throw new Error("WeChat article could not be fetched");
	}

	/**
	 * 检索校验：用公众号页面提取的题名/作者/年份到 OpenAlex + Crossref 检索，
	 * 校验候选并返回带置信度分级的 DOI 列表，供 lab_tasks_register_wechat_paper
	 * 补全权威 DOI（公众号页面常不展示 DOI）。页面已明确展示 DOI 时可跳过本步；
	 * 检索全源失败或无候选通过校验时抛错，调用方降级为只登记页面字段，不猜测。
	 */
	async resolveWechatPaperDoi({ projectId, title, authors, journal, year, model }) {
		const normalizedTitle = String(title ?? "").replace(/\s+/g, " ").trim();
		if (!normalizedTitle) throw new Error("paper title must not be empty");
		const normalizedAuthors = cleanStringList(authors);
		const normalizedYear = inferredPublicationYear(year, undefined);
		// 精确匹配不受 OA 限制；公众号导读的论文常有订阅制原文，因此关闭 OA 过滤。
		const results = await this.executor.search(normalizedTitle, {
			sources: ["openalex", "crossref"],
			limit: 5,
			oaOnly: false
		});
		const candidates = rankDoiCandidates(results, { title: normalizedTitle, authors: normalizedAuthors, year: normalizedYear });
		if (candidates.length === 0) throw new Error(`no DOI candidate passed verification for "${normalizedTitle}"`);
		if (projectId) {
			await this.recordProvenance({
				projectId,
				kind: "search",
				runId: `verify-${Date.now().toString(36)}`,
				inputs: {
					title: normalizedTitle,
					authors: normalizedAuthors,
					year: normalizedYear,
					journal: journal === undefined ? undefined : String(journal).replace(/\s+/g, " ").trim() || undefined
				},
				model,
				source: "wechat-doi-verify"
			});
		}
		return { title: normalizedTitle, candidates };
	}

	/**
	 * 把 AI 从微信公众号文章中提取的论文元数据登记为“待上传 PDF”的精读条目。
	 * 同一公众号链接或 DOI 重试时更新原条目，避免模型工具重放产生重复记录。
	 * 链接必须为 https://mp.weixin.qq.com/s...（硬校验）；登记/更新逻辑与
	 * 通用入口共享 [intakePaperMetadata]。
	 */
	async registerWechatPaper({
		projectId, sourceUrl, title, authors, doi, journal, year, publicationDate,
		volume, issue, pages, abstract, keywords, shortCitation, titleZh, summary,
		goalProfileId = "default-prodrug-polymer", goalProfileVersion = "1",
		noteTemplateId, noteTemplateVersion, model
	}) {
		this.requireProject(projectId);
		const normalizedUrl = normalizeWechatArticleUrl(sourceUrl);
		return this.intakePaperMetadata(projectId, {
			sourceType: "wechat",
			sourceUrl: normalizedUrl,
			title, authors, doi, journal, year, publicationDate,
			volume, issue, pages, abstract, keywords, shortCitation, titleZh, summary,
			goalProfileId, goalProfileVersion,
			noteTemplateId, noteTemplateVersion, model
		}, "wechat-ai-extraction");
	}

	/**
	 * 通用“仅元数据 → 待上传 PDF”登记入口（P0 修复 #1）：接受 publisher 页面 /
	 * DOI 直达页 / 用户直接提供的题名元数据，不再要求微信公众号链接。sourceType
	 * 决定入口语义与溯源标签：
	 *   - wechat    → 委托 [registerWechatPaper]，链接须为 mp.weixin.qq.com/s；
	 *   - publisher → 出版方/摘要页链接（sourceUrl 可选 http(s)）或纯题名元数据；
	 *   - doi       → DOI 直达页登记（doi 建议必填；sourceUrl 可选）。
	 * 校验保留：title 必填；DOI 若给出需 normalizeDoi 合法。无 PDF 时创建
	 * acquisitionStatus=awaiting-pdf 的精读占位（bundleId/reportId 返回给调用方），
	 * 后续用 lab_tasks_register_bundle 传回该 bundleId 补齐原文。
	 */
	async registerPaperMeta({
		projectId, sourceType = "publisher", sourceUrl, doi, title, authors, journal,
		year, publicationDate, volume, issue, pages, abstract, keywords,
		shortCitation, titleZh, summary, goalProfileId, goalProfileVersion,
		noteTemplateId, noteTemplateVersion, model
	}) {
		this.requireProject(projectId);
		const type = String(sourceType ?? "publisher").toLowerCase();
		if (!["wechat", "publisher", "doi"].includes(type)) {
			throw new Error(`unsupported sourceType: ${sourceType}（支持 wechat | publisher | doi）`);
		}
		if (type === "wechat") {
			if (!sourceUrl) throw new Error("sourceType=wechat 时必须提供公众号链接 sourceUrl");
			return this.registerWechatPaper({
				projectId, sourceUrl, title, authors, doi, journal, year, publicationDate,
				volume, issue, pages, abstract, keywords, shortCitation, titleZh, summary,
				goalProfileId, goalProfileVersion, noteTemplateId, noteTemplateVersion, model
			});
		}
		let normalizedUrl;
		if (sourceUrl) {
			let parsed;
			try { parsed = new URL(String(sourceUrl).trim()); } catch { parsed = undefined; }
			if (parsed === undefined || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
				throw new Error("sourceUrl must be a valid http(s) URL");
			}
			parsed.hash = "";
			normalizedUrl = parsed.href;
		}
		const normalizedDoi = normalizeDoi(doi);
		if (doi && !normalizedDoi) throw new Error(`invalid DOI: ${doi}`);
		return this.intakePaperMetadata(projectId, {
			sourceType: type,
			sourceUrl: normalizedUrl,
			doi: normalizedDoi,
			title, authors, journal, year, publicationDate,
			volume, issue, pages, abstract, keywords, shortCitation, titleZh, summary,
			goalProfileId, goalProfileVersion,
			noteTemplateId, noteTemplateVersion, model
		}, type === "doi" ? "doi-ai-extraction" : "publisher-ai-extraction");
	}

	/**
	 * 元数据占位共核（registerWechatPaper / registerPaperMeta 共用）：
	 * 校验 → 去重（sourceUrl / DOI / 无标识时的同题名 awaiting-pdf）→ 写占位
	 * bundle + 固化条目布局 → 报告占位/补丁 → provenance。重复登记幂等更新，
	 * 不产生第二条记录；existing 的来源语义（sourceType/sourceUrl）不被覆盖。
	 */
	async intakePaperMetadata(projectId, {
		sourceType, sourceUrl, title, authors, doi, journal, year, publicationDate,
		volume, issue, pages, abstract, keywords, shortCitation, titleZh, summary,
		goalProfileId = "default-prodrug-polymer", goalProfileVersion = "1",
		noteTemplateId, noteTemplateVersion, model
	}, provenanceSource) {
		const normalizedTitle = String(title ?? "").replace(/\s+/g, " ").trim();
		if (!normalizedTitle) throw new Error("paper title must not be empty");
		const normalizedDoi = normalizeDoi(doi);
		const normalizedYear = inferredPublicationYear(year, publicationDate);
		const normalizedAuthors = cleanStringList(authors);
		const normalizedKeywords = cleanStringList(keywords);
		const now = new Date().toISOString();
		const bundles = this.listBundles(projectId);
		const existing = bundles.find((row) =>
			(sourceUrl && row.sourceUrl === sourceUrl) ||
			(normalizedDoi && row.doi === normalizedDoi) ||
			(!normalizedDoi && !sourceUrl && row.acquisitionStatus === "awaiting-pdf"
				&& row.title.trim().toLowerCase() === normalizedTitle.toLowerCase())
		);
		const id = existing?.id ?? `bundle-${sourceType}-${Date.now().toString(36)}`;
		const metadataPatch = Object.fromEntries(Object.entries({
			doi: normalizedDoi,
			journal: journal === undefined ? undefined : String(journal).replace(/\s+/g, " ").trim() || undefined,
			authors: normalizedAuthors,
			year: normalizedYear,
			publicationDate: publicationDate === undefined ? undefined : String(publicationDate).trim() || undefined,
			volume: volume === undefined ? undefined : String(volume).trim() || undefined,
			issue: issue === undefined ? undefined : String(issue).trim() || undefined,
			pages: pages === undefined ? undefined : String(pages).trim() || undefined,
			abstract: abstract === undefined ? undefined : String(abstract).trim() || undefined,
			keywords: normalizedKeywords
		}).filter(([, value]) => value !== undefined));
		const workspace = await this.ensureProjectWorkspace(projectId);
		const bundle = paperSourceBundleSchema.parse({
			...existing,
			...metadataPatch,
			id,
			projectId,
			title: normalizedTitle,
			sourceType: existing?.sourceType ?? sourceType,
			sourceUrl: existing?.sourceUrl ?? sourceUrl,
			acquisitionStatus: existing?.acquisitionStatus === "ready" ? "ready" : "awaiting-pdf",
			locatorMode: existing?.locatorMode ?? "source-limited",
			status: existing?.status ?? "pending",
			metadataExtractedAt: now,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		});
		// 占位创建时固化条目布局：后续正文/SI/报告/PPT 全部落到同一条目目录。
		const layout = literatureEntryLayout(workspace.path, bundle, undefined);
		await this.table("bundles").put(id, paperSourceBundleSchema.parse({
			...bundle,
			entryStem: bundle.entryStem ?? layout.entryStem,
			entryDir: bundle.entryDir ?? layout.entryDir,
			updatedAt: now
		}));

		let report = this.listReadingReports(projectId).find((row) => row.bundleId === id && !row.paperCardPath);
		if (report === undefined) {
			report = await this.createReadingReport({
				projectId,
				bundleId: id,
				goalProfileId,
				goalProfileVersion,
				noteTemplateId,
				noteTemplateVersion,
				shortCitation,
				titleZh,
				summary: summary ?? abstract
			});
		} else {
			const reportPatch = Object.fromEntries(Object.entries({
				shortCitation: normalizeJournalShortCitation(shortCitation, report.shortCitation) ?? shortCitation ?? report.shortCitation,
				titleZh: titleZh ?? report.titleZh,
				summary: summary ?? abstract ?? report.summary
			}).filter(([, value]) => value !== undefined));
			report = readingReportSchema.parse({ ...report, ...reportPatch, locatorMode: bundle.locatorMode, updatedAt: now });
			await this.table("reports").put(report.id, report);
		}
		await this.recordProvenance({
			projectId,
			kind: "metadata-intake",
			runId: id,
			inputs: { ...(sourceUrl ? { sourceUrl } : {}), title: normalizedTitle, ...metadataPatch },
			model,
			source: provenanceSource ?? "metadata-intake"
		});
		return { bundle, report, created: existing === undefined };
	}

	/**
	 * preparePaper：登记原文（PDF 或 nature-reader 的 source_map JSON），计算
	 * 哈希，调用 prepare_paper.py 生成规范化 source_bundle.json。
	 * PDF 输入需要 PyMuPDF（prepare_paper.py 依赖；python/requirements.lock 已
	 * 固定 PyMuPDF==1.28.2，venv/bootstrap 与 bundled python 均会带上）；source_map
	 * 输入仅 stdlib。PDF 与 sourceMap 至少给一个。
	 */
	async preparePaper({ projectId, pdfPath, sourceMapPath, title, bundleId, renderDir, model, doi, journal, siPath }) {
		this.requireProject(projectId);
		if (!pdfPath && !sourceMapPath) throw new Error("preparePaper requires pdfPath or sourceMapPath");
		if (pdfPath && !existsSync(pdfPath)) throw new Error(`pdf not found: ${pdfPath}`);
		if (sourceMapPath && !existsSync(sourceMapPath)) throw new Error(`source map not found: ${sourceMapPath}`);
		if (siPath && !existsSync(siPath)) throw new Error(`SI file not found: ${siPath}`);
		const inputPath = sourceMapPath ?? pdfPath;
		const inputBuffer = await readFile(inputPath);
		const inputSha256 = createHash("sha256").update(inputBuffer).digest("hex");
		const pdfBuffer = pdfPath ? (pdfPath === inputPath ? inputBuffer : await readFile(pdfPath)) : undefined;
		const pdfSha256 = pdfPath
			? validatePdfBuffer(pdfBuffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER }).sha256
			: undefined;
		const normalizedDoi = doi ? normalizeDoi(doi) : undefined;
		if (doi && !normalizedDoi) throw new Error(`invalid DOI: ${doi}`);
		const normalizedTitle = String(title ?? "").replace(/\s+/g, " ").trim();
		const placeholder = bundleId ? this.table("bundles").get(bundleId) : this.listBundles(projectId).find((row) =>
			row.acquisitionStatus === "awaiting-pdf" && (
				(normalizedDoi && row.doi === normalizedDoi) ||
				(!normalizedDoi && normalizedTitle && row.title.trim().toLowerCase() === normalizedTitle.toLowerCase())
			)
		);
		if (placeholder && placeholder.projectId !== projectId) throw new Error(`source bundle '${placeholder.id}' belongs to another project`);
		const id = bundleId ?? placeholder?.id ?? `bundle-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		// 固化条目布局（占位创建或补齐）；同一 bundle 后续存档复用同一条目目录。
		const workspace = await this.ensureProjectWorkspace(projectId);
		const entrySeed = { ...(placeholder ?? {}), id, title: normalizedTitle || placeholder?.title || "", doi: normalizedDoi ?? placeholder?.doi, authors: placeholder?.authors ?? [], year: placeholder?.year };
		const entryLayout = literatureEntryLayout(workspace.path, entrySeed, undefined);
		// 工程外输入的 PDF/SI 必须归档到条目目录，再登记归一化后的路径。
		let finalPdfPath = pdfPath;
		let finalSiPath = siPath;
		if (pdfPath && !isPathInside(workspace.path, pdfPath)) {
			finalPdfPath = (await this.stageFileIntoEntry({ projectId, bundleId: id, kind: "pdf", buffer: pdfBuffer, entry: entryLayout })).filePath;
		}
		if (siPath && !isPathInside(workspace.path, siPath)) {
			finalSiPath = (await this.stageFileIntoEntry({ projectId, bundleId: id, kind: "si", buffer: await readFile(siPath), entry: entryLayout })).filePath;
		}
		const inputForPython = sourceMapPath ?? finalPdfPath;
		const bundle = paperSourceBundleSchema.parse({
			...placeholder,
			id,
			projectId,
			title: normalizedTitle || placeholder?.title || "",
			doi: normalizedDoi ?? placeholder?.doi,
			journal: journal ?? placeholder?.journal,
			pdfPath: finalPdfPath,
			pdfSha256,
			siPath: finalSiPath,
			siSha256: finalSiPath ? createHash("sha256").update(await readFile(finalSiPath)).digest("hex") : undefined,
			sourceMapPath,
			entryStem: placeholder?.entryStem ?? entryLayout.entryStem,
			entryDir: placeholder?.entryDir ?? entryLayout.entryDir,
			acquisitionStatus: "ready",
			locatorMode: sourceMapPath ? "structure-grounded" : "page-grounded",
			status: "pending",
			createdAt: placeholder?.createdAt ?? now,
			updatedAt: now
		});
		await this.table("bundles").put(id, bundle);
		try {
			await this.transit("bundles", id, { status: "running", progress: "preparing source bundle" });
			const output = join(dirname(inputForPython), `${id}-source_bundle.json`);
			const sourceMap = await this.executor.preparePaper(inputPath, output, { renderDir });
			const next = await this.transit("bundles", id, {
				status: "succeeded",
				progress: "source bundle ready",
				sourceMapPath: output,
				acquisitionStatus: "ready",
				locatorMode: sourceMap.locator_mode ?? (sourceMapPath ? "structure-grounded" : "page-grounded")
			});
			for (const report of this.listReadingReports(projectId).filter((row) => row.bundleId === id && !row.paperCardPath)) {
				await this.table("reports").put(report.id, readingReportSchema.parse({ ...report, locatorMode: next.locatorMode, updatedAt: new Date().toISOString() }));
			}
			await this.recordProvenance({ projectId, kind: "source-bundle", runId: id, inputs: { input: inputSha256, pdf: pdfSha256, title }, model });
			return next;
		} catch (error) {
			await this.transit("bundles", id, { status: "failed", error: error.message, progress: "failed" });
			throw error;
		}
	}

	/**
	 * ensureBundleEntryLayout：固化文献条目标识与条目目录（entryStem/entryDir）。
	 *
	 * 同一 bundle 的 entryStem 必须稳定：正文与 SI 分批存档、精读报告与 PPT 固化
	 * 都必须复用同一目录。占位创建时（registerFromWechat / preparePaper）首次调用，
	 * 之后所有阶段读取 bundle.entryStem/entryDir 不再重新推导。
	 *
	 * 旧数据迁移：bundle 缺少 entryStem/entryDir 时按当前元数据推导；若旧
	 * captured-literature/<bundleId>/ 目录下已登记正文/SI，复制到条目目录并更新
	 * 数据库路径（临时文件 → 校验 → 原子替换 → 更新 DB；失败保留原文件并报错）。
	 */
	async ensureBundleEntryLayout(bundle, report) {
		const workspace = await this.ensureProjectWorkspace(bundle.projectId);
		const layout = literatureEntryLayout(workspace.path, bundle, report);
		const patch = {};
		if (!bundle.entryStem || bundle.entryStem !== layout.entryStem) patch.entryStem = layout.entryStem;
		if (!bundle.entryDir || bundle.entryDir !== layout.entryDir) patch.entryDir = layout.entryDir;
		if (Object.keys(patch).length === 0) return bundle;
		const next = paperSourceBundleSchema.parse({ ...bundle, ...patch, updatedAt: new Date().toISOString() });
		await this.table("bundles").put(bundle.id, next);
		// 旧 captured-literature/<bundleId>/ 数据受控迁移（正文与 SI 都是 PDF）。
		for (const kind of ["pdf", "si"]) {
			const oldPath = next[kind === "pdf" ? "pdfPath" : "siPath"];
			if (!oldPath || !existsSync(oldPath)) continue;
			const legacyDir = join(workspace.path, "captured-literature", bundle.id);
			if (!isPathInside(legacyDir, oldPath)) continue;
			const buffer = await readFile(oldPath);
			validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
			const staged = await this.stageFileIntoEntry({
				projectId: bundle.projectId,
				bundleId: bundle.id,
				kind,
				buffer,
				allowExisting: true
			});
			const migrated = paperSourceBundleSchema.parse({
				...next,
				[kind === "pdf" ? "pdfPath" : "siPath"]: staged.filePath,
				updatedAt: new Date().toISOString()
			});
			await this.table("bundles").put(bundle.id, migrated);
		}
		return this.table("bundles").get(bundle.id);
	}

	/**
	 * stageFileIntoEntry：把任意产物字节固化到文献条目目录。
	 * 目录与文件名全部由服务端决定（entryFileName），不接受外部文件名；
	 * allowExisting=true 时允许覆盖已存在的同名产物（同 bundle 分批存档幂等）。
	 * @returns {{ filePath: string, fileName: string }}
	 */
	async stageFileIntoEntry({ projectId, bundleId, kind, buffer, fileName, allowExisting = false, entry }) {
		const bundle = this.table("bundles").get(bundleId);
		// entry：调用方已算好的条目布局。preparePaper 归档工程外输入时 bundle 尚未落库，
		// 此时按预计算布局写入，随后 bundle 以相同的 entryStem/entryDir 落库，路径一致。
		if (bundle === undefined && !entry) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle && bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		const settled = entry
			? { ...bundle, entryStem: entry.entryStem, entryDir: entry.entryDir }
			: await this.ensureBundleEntryLayout(bundle);
		const targetName = fileName ?? entryFileName(settled.entryStem, kind);
		const filePath = await atomicWrite(join(settled.entryDir, targetName), buffer);
		if (!allowExisting) {
			// 同一 bundle 出现两个不同内容的目标名（理论上不应发生）时拒绝，避免目录漂移。
			const registered = kind === "pdf" ? settled.pdfPath : kind === "si" ? settled.siPath : undefined;
			if (registered && registered !== filePath && existsSync(registered)) {
				throw new Error(`entry '${bundleId}' already registered ${kind} at a different path`);
			}
		}
		return { filePath, fileName: targetName };
	}

	/**
	 * stageArtifactIntoEntry：正文/SI 捕获固化的统一入口。
	 * 先做 PDF 签名/EOF/大小/SHA-256 校验，再原子写入条目目录；扩展名强制 .pdf。
	 */
	async stageArtifactIntoEntry({ projectId, bundleId, kind, buffer }) {
		if (!["pdf", "si"].includes(kind)) throw new Error(`kind must be pdf or si, got '${kind}'`);
		const integrity = validatePdfBuffer(buffer, { minBytes: 5, maxBytes: Number.MAX_SAFE_INTEGER });
		const staged = await this.stageFileIntoEntry({ projectId, bundleId, kind, buffer });
		return { ...staged, ...integrity };
	}

	/**
	 * registerCapturedFile：手工浏览器捕获的原始文件登记（provenance
	 * source = manual-browser-capture）。复用原有 bundleId/reportId，不新建
	 * 文献；只登记原始文件（pdfPath/siPath + 哈希 + acquisitionStatus），
	 * 不冒充已经完成的全文精读（不动 report 状态机、不生成 paper card）。
	 * 文件必须已由 labCapture 服务校验并原子写入课题条目目录。
	 */
	async registerCapturedFile({ projectId, bundleId, kind, filePath, fileName, size, fileSha256, tokenSha256 }) {
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${bundleId}' belongs to another project`);
		if (!["pdf", "si"].includes(kind)) throw new Error(`kind must be pdf or si, got '${kind}'`);
		const now = new Date().toISOString();
		const patch = kind === "pdf"
			? { pdfPath: filePath, pdfSha256: fileSha256, acquisitionStatus: "ready" }
			: { siPath: filePath, siSha256: fileSha256 };
		// 固化条目布局：首次登记时按当前元数据生成 entryStem/entryDir 并落库，
		// 之后正文与 SI 分批存档复用同一目录，不因元数据后补而产生第二个文件夹。
		const workspace = await this.ensureProjectWorkspace(projectId);
		const layout = literatureEntryLayout(workspace.path, bundle);
		const next = paperSourceBundleSchema.parse({
			...bundle,
			...patch,
			entryStem: bundle.entryStem ?? layout.entryStem,
			entryDir: bundle.entryDir ?? layout.entryDir,
			updatedAt: now
		});
		const previousDigest = kind === "pdf" ? bundle.pdfSha256 : bundle.siSha256;
		if (previousDigest && previousDigest !== fileSha256 && this.ctx.labSynthesis?.invalidateEvidenceShotsForBundle) {
			await this.ctx.labSynthesis.invalidateEvidenceShotsForBundle(bundleId, kind, fileSha256);
		}
		await this.table("bundles").put(bundleId, next);
		await this.recordProvenance({
			projectId,
			kind: "source-bundle",
			runId: bundleId,
			inputs: { kind, fileName, size, sha256: fileSha256, tokenSha256, captureSource: "manual-browser-capture" },
			source: "manual-browser-capture"
		});
		return next;
	}

	// ── §六 接口：精读报告 ───────────────────────────────────────────────────

	/** createReadingReport：目标快照 + 阅读笔记模板（Nature card 仅作无模板回退）。 */
	async createReadingReport({ projectId, bundleId, goalProfileId, goalProfileVersion, noteTemplateId, noteTemplateVersion, reportId, model, shortCitation, titleZh, summary }) {
		this.requireProject(projectId);
		const bundle = this.table("bundles").get(bundleId);
		if (bundle === undefined) throw new Error(`source bundle '${bundleId}' not found`);
		// 可开始精读：preparePaper 成功（succeeded）、元数据占位待 PDF（awaiting-pdf）、
		// 或手工捕获已把 PDF 登记进 bundle（ready + pdfPath）——捕获只登记原文，
		// 不自动生成报告，但允许用户随后开始精读。
		const captureReady = bundle.acquisitionStatus === "ready" && bundle.pdfPath;
		if (bundle.status !== "succeeded" && bundle.acquisitionStatus !== "awaiting-pdf" && !captureReady) {
			throw new Error(`source bundle '${bundleId}' is ${bundle.status}, expected succeeded`);
		}
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const requirements = toPaperCardRequirements(goal);
		// 阅读笔记模板快照：可选；缺省用内置 note-default（仅当 labNoteTemplates
		// 已注册时快照；未注册的服务不阻塞既有流程）。
		let noteTemplateSnapshot;
		let noteRequirements;
		try {
			const noteService = this.ctx.labNoteTemplates;
			const noteId = noteTemplateId ?? "note-default";
			const note = await noteService.snapshotForTask(noteId, noteTemplateVersion);
			noteTemplateSnapshot = note;
			noteRequirements = note;
			noteRequirements = noteService.toNoteRequirements(note);
		} catch (error) {
			this.ctx.logger.warn(`createReadingReport: note template snapshot skipped: ${String(error)}`);
		}
		const id = reportId ?? `report-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const report = readingReportSchema.parse({
			id,
			projectId,
			bundleId,
			goalSnapshot: goal,
			paperCardRequirements: requirements,
			noteTemplateSnapshot,
			noteRequirements,
			locatorMode: bundle.locatorMode,
			status: "pending",
			shortCitation: normalizeJournalShortCitation(shortCitation, bundle.title) ?? shortCitation ?? bundle.title ?? undefined,
			titleZh,
			summary,
			createdAt: now,
			updatedAt: now
		});
		await this.table("reports").put(id, report);
		return report;
	}

	/**
	 * 精读前输入盘点：列出当前正文/SI/source-map，并解析本次应优先采用的
	 * 阅读笔记模板。此方法只读取资源，不解析文献内容；Agent 必须随后逐个读取
	 * available=true 的资源，PDF/Office 先走 lab_convert_document。
	 */
	async readingReportInputs({ projectId, bundleId, reportId, noteTemplateId, noteTemplateVersion }) {
		this.requireProject(projectId);
		let report = reportId ? this.getReadingReport(reportId) : undefined;
		if (report && report.projectId !== projectId) throw new Error(`reading report '${reportId}' belongs to another project`);
		if (report && bundleId && report.bundleId !== bundleId) throw new Error("reportId and bundleId do not refer to the same paper");
		const resolvedBundleId = bundleId ?? report?.bundleId;
		if (!resolvedBundleId) throw new Error("bundleId or reportId is required");
		const bundle = this.getBundle(resolvedBundleId);
		if (!bundle) throw new Error(`source bundle '${resolvedBundleId}' not found`);
		if (bundle.projectId !== projectId) throw new Error(`source bundle '${resolvedBundleId}' belongs to another project`);
		if (!report) report = this.listReadingReports(projectId).find((row) => row.bundleId === resolvedBundleId && !row.paperCardPath);

		let noteTemplateSnapshot = report?.noteTemplateSnapshot;
		let noteRequirements = report?.noteRequirements;
		if (noteTemplateId || noteTemplateVersion || (!noteTemplateSnapshot && this.ctx.labNoteTemplates)) {
			const noteId = noteTemplateId ?? noteTemplateSnapshot?.id ?? "note-default";
			noteTemplateSnapshot = await this.ctx.labNoteTemplates.snapshotForTask(noteId, noteTemplateVersion);
			noteRequirements = this.ctx.labNoteTemplates.toNoteRequirements(noteTemplateSnapshot);
		}
		const fallbackRequirements = report?.paperCardRequirements
			?? toPaperCardRequirements(report?.goalSnapshot ?? this.getProject(projectId)?.goalProfile?.snapshot);
		const resource = (kind, path, sha256) => ({
			kind,
			registered: Boolean(path),
			available: Boolean(path && existsSync(path)),
			path,
			fileName: path ? basename(path) : undefined,
			sha256
		});
		const resources = [
			resource("main-pdf", bundle.pdfPath, bundle.pdfSha256),
			resource("si", bundle.siPath, bundle.siSha256),
			resource("source-map", bundle.sourceMapPath)
		];
		const formatSource = noteRequirements ? "reading-note-template" : "nature-paper-card-fallback";
		return {
			bundleId: bundle.id,
			reportId: report?.id,
			title: bundle.title,
			resources,
			mustReadPaths: resources.filter((row) => row.available).map((row) => row.path),
			formatSource,
			templateId: noteTemplateSnapshot?.id,
			templateVersion: noteTemplateSnapshot?.version,
			templateName: noteTemplateSnapshot?.name,
			generationRequirements: noteRequirements ?? fallbackRequirements,
			instructions: [
				"生成精读报告前，逐个读取 mustReadPaths 中现有的正文、SI 和 source-map；不得只看元数据或公众号导读。",
				"PDF/Office 资源先用 lab_convert_document 转为 Markdown，再读取转换结果；正文和 SI 的证据要区分标注。",
				noteRequirements
					? "报告章节与格式严格采用 reading-note-template；Nature paper-card 只用于证据提取参考，不得覆盖模板结构。"
					: "当前没有可用阅读笔记模板，才允许回退到 Nature paper-card 结构。"
			]
		};
	}

	/** 待精读条目可在产物生成前切换并固化所选阅读笔记模板。
	 *  已暂存（paperCardPath 固化）后：同模板（id + version 与快照一致）视为
	 *  幂等重放，直接返回原报告不报错；请求不同模板才拒绝并给出可操作提示
	 *  （P1 修复 #5：二次 register_report 带相同 noteTemplateId/Version 不再误报）。 */
	async selectReadingReportTemplate({ reportId, noteTemplateId, noteTemplateVersion }) {
		const report = this.getReadingReport(reportId);
		if (!report) throw new Error(`reading report '${reportId}' not found`);
		const snapshot = report.noteTemplateSnapshot;
		const noteId = noteTemplateId ?? snapshot?.id ?? "note-default";
		const sameTemplate = Boolean(snapshot)
			&& String(snapshot.id) === String(noteId)
			&& (noteTemplateVersion === undefined || String(snapshot.version) === String(noteTemplateVersion));
		if (report.paperCardPath) {
			if (sameTemplate) return report; // 幂等：模板已固化且未变化
			throw new Error(
				`reading report template cannot change after the report artifact is staged：` +
				`已固化模板 ${snapshot ? `${snapshot.id}@${snapshot.version}` : "(无)"}` +
				`，请求 ${noteId}@${noteTemplateVersion ?? "(latest)"}。` +
				`如需更换模板请新建报告（新的 reportId）；更新已暂存报告时请勿传模板参数。`
			);
		}
		const fresh = await this.ctx.labNoteTemplates.snapshotForTask(noteId, noteTemplateVersion);
		const requirements = this.ctx.labNoteTemplates.toNoteRequirements(fresh);
		const next = readingReportSchema.parse({
			...report,
			noteTemplateSnapshot: fresh,
			noteRequirements: requirements,
			updatedAt: new Date().toISOString()
		});
		await this.table("reports").put(reportId, next);
		return next;
	}

	/** completeReadingReport：把实际 DOCX 自动暂存到文献条目，再运行非阻断自查。 */
	async completeReadingReport({ reportId, paperCardPath, docxPath, locatorMode, model, shortCitation, titleZh, summary }) {
		const existing = this.table("reports").get(reportId);
		if (existing === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!paperCardPath || !existsSync(paperCardPath)) throw new Error(`paper card file missing: ${paperCardPath ?? "(empty path)"}`);
		const patch = {
			status: "under-review",
			progress: "DOCX staged; lightweight self-check pending",
			paperCardPath,
			locatorMode: locatorMode ?? existing.locatorMode,
			audit: { ok: false, errors: 0, warnings: 0, summary: "" },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		};
		if (shortCitation !== undefined) patch.shortCitation = normalizeJournalShortCitation(shortCitation, existing.shortCitation, this.table("bundles").get(existing.bundleId)?.title) ?? shortCitation;
		if (titleZh !== undefined) patch.titleZh = titleZh;
		if (summary !== undefined) patch.summary = summary;
		// 精读 Markdown 固化到文献条目目录（<entryStem> 精读报告.md），与正文/SI 同目录。
		const mdBuffer = await readFile(paperCardPath, "utf8");
		const stagedMd = await this.stageFileIntoEntry({
			projectId: existing.projectId,
			bundleId: existing.bundleId,
			kind: "report-md",
			buffer: Buffer.from(mdBuffer, "utf8"),
			allowExisting: true
		});
		patch.paperCardPath = stagedMd.filePath;
		const staged = await this.materializeReadingDocx({ ...existing, ...patch }, docxPath);
		patch.docxPath = staged.docxPath;
		patch.artifactSha256 = staged.integrity.sha256;
		const report = await this.transit("reports", reportId, patch);
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { paperCardPath: stagedMd.filePath, locatorMode },
			model
		});
		return await this.validateReadingReport({ reportId, model });
	}

	/** 机器自查：只提供提醒；无论发现多少问题，实际产物都留在人工审阅暂存区。 */
	async validateReadingReport({ reportId, locatorMode, auditReportPath, model }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath) throw new Error(`reading report '${reportId}' has no paper-card; complete it first`);
		await this.transit("reports", reportId, { status: "under-review", progress: "running lightweight self-check; human review remains available" });
		const cardText = await readFile(report.paperCardPath, "utf8");
		const declaredMode = cardText.match(/locator[ _-]*mode[^\n]*(page-grounded|structure-grounded|source-limited)/i)?.[1]?.toLowerCase();
		const mode = locatorMode ?? declaredMode ?? report.locatorMode;
		const reportOut = auditReportPath ?? join(dirname(report.paperCardPath), `${reportId}-audit-report.json`);
		let result;
		try {
			const bundlePath = this.table("bundles").get(report.bundleId)?.sourceMapPath;
			result = /^##\s+01\b/m.test(cardText)
				? await this.executor.auditPaperCard({ card: report.paperCardPath, bundle: bundlePath, locatorMode: mode, report: reportOut })
				: await auditReadingNote({ cardPath: report.paperCardPath, bundlePath, locatorMode: mode, noteRequirements: report.noteRequirements, reportPath: reportOut });
		} catch (error) {
			return await this.transit("reports", reportId, {
				status: "under-review",
				progress: "self-check unavailable; awaiting human review",
				auditReportPath: reportOut,
				audit: { ok: false, errors: 0, warnings: 1, summary: `自查未完成：${error.message}` },
				error: undefined
			});
		}
		const next = await this.transit("reports", reportId, {
			status: "under-review",
			progress: result.ok ? "self-check completed; awaiting human review" : `self-check found ${result.errors} issue(s); awaiting human review`,
			locatorMode: mode,
			auditReportPath: reportOut,
			audit: { ok: result.ok, errors: result.errors, warnings: result.warnings, summary: result.summary }
		});
		await this.recordProvenance({
			projectId: report.projectId,
			kind: "reading-report",
			runId: reportId,
			inputs: { audit: reportOut, locatorMode: mode },
			model,
			source: "audit_paper_card.py"
		});
		return next;
	}

	/** 人工审阅精读报告：机器自查不设门槛；通过时绑定实际 DOCX 哈希。 */
	async reviewReadingReport({ reportId, decision, note, reviewer = "human-ui" }) {
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (report.status !== "under-review") throw new Error(`reading report '${reportId}' is ${report.status}; only under-review can be reviewed`);
		if (!report.paperCardPath || !existsSync(report.paperCardPath)) throw new Error(`paper card file missing: ${report.paperCardPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const staged = await this.materializeReadingDocx(report, report.docxPath);
		const reviewedAt = new Date().toISOString();
		return await this.transit("reports", reportId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: staged.integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: staged.integrity.sha256 }
		}, reviewedAt);
	}

	// ── §六 接口：PPT 生成 ───────────────────────────────────────────────────

	/** createPresentation：报告已有暂存产物即可制作；模板只作格式参考，不作阻断门禁。 */
	async createPresentation({ projectId, reportId, templateId, templateVersion, runId, model, skipAudit = false }) {
		this.requireProject(projectId);
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath || !report.docxPath) throw new Error(`reading report '${reportId}' has no staged report artifact yet`);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		try {
			const templateValidation = await this.ctx.labTemplates.validate(templateId, templateVersion);
			if (!templateValidation.ok) this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} has advisory issues: ${templateValidation.problems.join("; ")}`);
		} catch (error) {
			this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} advisory validation unavailable: ${error.message}`);
		}
		const id = runId ?? `pres-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const run = presentationRunSchema.parse({
			id,
			projectId,
			reportId,
			templateSnapshot: template,
			auditSkipped: skipAudit,
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("presentations").put(id, run);
		return run;
	}

	/** completePresentation：实际 PPTX 完整即可暂存；版面 QA 只作非阻断提醒。
	 *  PPTX 及配套 outline/notes/figures 固化到文献条目目录，与正文/SI 同目录。 */
	async completePresentation({ runId, pptxPath, outlinePath, speechNotesPath, figureSourcesPath, model }) {
		if (!pptxPath || !existsSync(pptxPath)) throw new Error(`pptx file missing: ${pptxPath ?? "(empty path)"}`);
		const integrity = await inspectOfficePackage(await readFile(pptxPath), "pptx");
		const current = this.table("presentations").get(runId);
		if (current === undefined) throw new Error(`presentation run '${runId}' not found`);
		const report = this.table("reports").get(current.reportId);
		if (report === undefined) throw new Error(`reading report '${current.reportId}' not found`);
		const stage = async (kind, path, fileName) => {
			if (!path || !existsSync(path)) return undefined;
			return (await this.stageFileIntoEntry({
				projectId: current.projectId,
				bundleId: report.bundleId,
				kind,
				buffer: await readFile(path),
				fileName,
				allowExisting: true
			})).filePath;
		};
		const pptxStaged = await stage("ppt", pptxPath);
		const outlineStaged = await stage("outline", outlinePath, outlinePath ? basename(outlinePath) : undefined);
		const notesStaged = await stage("speech-notes", speechNotesPath, speechNotesPath ? basename(speechNotesPath) : undefined);
		const figuresStaged = await stage("figure-sources", figureSourcesPath, figureSourcesPath ? basename(figureSourcesPath) : undefined);
		const run = await this.transit("presentations", runId, {
			status: "under-review",
			progress: "PPTX staged; lightweight self-check pending",
			pptxPath: pptxStaged,
			artifactSha256: integrity.sha256,
			outlinePath: outlineStaged,
			speechNotesPath: notesStaged,
			figureSourcesPath: figuresStaged,
			qa: { ok: false, high: 0, medium: 0, low: 0 },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptxPath: pptxStaged, outlinePath: outlineStaged },
			model
		});
		return await this.validatePresentation({ runId, model });
	}

	/** 机器 QA：只给人工审阅提供提醒，高风险项也不阻断预览和人工决定。 */
	async validatePresentation({ runId, failOn = "high", qaReportPath, qaJsonPath, model }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (!run.pptxPath) throw new Error(`presentation run '${runId}' has no pptx; complete it first`);
		await this.transit("presentations", runId, { status: "under-review", progress: "running lightweight PPT self-check; human review remains available" });
		const base = dirname(run.pptxPath);
		const report = qaReportPath ?? join(base, `${runId}-qa-report.md`);
		const json = qaJsonPath ?? join(base, `${runId}-qa.json`);
		let result;
		try {
			result = await this.executor.auditPptx({ pptx: run.pptxPath, report, json, failOn });
		} catch (error) {
			return await this.transit("presentations", runId, {
				status: "under-review",
				progress: "PPT self-check unavailable; awaiting human review",
				qa: { ok: false, high: 0, medium: 1, low: 0, reportPath: report, jsonPath: json },
				error: undefined
			});
		}
		const next = await this.transit("presentations", runId, {
			status: "under-review",
			progress: result.ok ? "PPT self-check completed; awaiting human review" : `PPT self-check found ${result.findingCounts.high} high-risk item(s); awaiting human review`,
			qa: { ok: result.ok, ...result.findingCounts, reportPath: report, jsonPath: json }
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptx: run.pptxPath, failOn },
			model,
			source: "audit_pptx_quality.py"
		});
		return next;
	}

	/** 人工审阅 PPT：以实际 PPTX 完整性和哈希绑定为硬条件，QA 提醒不设门槛。 */
	async reviewPresentation({ runId, decision, note, reviewer = "human-ui" }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (run.status !== "under-review") throw new Error(`presentation run '${runId}' is ${run.status}; only under-review can be reviewed`);
		if (!run.pptxPath || !existsSync(run.pptxPath)) throw new Error(`pptx file missing: ${run.pptxPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const integrity = await inspectOfficePackage(await readFile(run.pptxPath), "pptx");
		const reviewedAt = new Date().toISOString();
		return await this.transit("presentations", runId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: integrity.sha256 }
		}, reviewedAt);
	}

	// ── 查询 ────────────────────────────────────────────────────────────────

	getProject(id) {
		return this.table("projects").get(id);
	}

	/** 返回机器评审的结构化详情，供课题面板解释错误/提醒，避免只显示红绿状态。 */
	async machineReviewDetails({ reportId, runId }) {
		if ((reportId ? 1 : 0) + (runId ? 1 : 0) !== 1) throw new Error("provide exactly one of reportId or runId");
		if (reportId) {
			const report = this.getReadingReport(reportId);
			if (!report) throw new Error(`reading report '${reportId}' not found`);
			let detail;
			if (report.auditReportPath && existsSync(report.auditReportPath)) {
				try { detail = JSON.parse(await readFile(report.auditReportPath, "utf8")); } catch { detail = undefined; }
			}
			return { kind: "reading-report", id: reportId, ok: report.audit?.ok === true, status: report.status, summary: report.audit, reportPath: report.auditReportPath, findings: detail?.findings ?? [], metrics: detail?.metrics, auditMode: detail?.audit_mode ?? "paper-card" };
		}
		const run = this.getPresentationRun(runId);
		if (!run) throw new Error(`presentation run '${runId}' not found`);
		let detail;
		if (run.qa?.jsonPath && existsSync(run.qa.jsonPath)) {
			try { detail = JSON.parse(await readFile(run.qa.jsonPath, "utf8")); } catch { detail = undefined; }
		}
		return { kind: "presentation", id: runId, ok: run.qa?.ok === true, status: run.status, summary: run.qa, reportPath: run.qa?.reportPath, findings: detail?.findings ?? [], slideCount: detail?.slide_count };
	}

	getSearchRun(id) {
		const row = this.table("searches").get(id);
		if (!row?.sessionId) return row;
		const related = [...this.table("searches").keys()]
			.map((key) => this.table("searches").get(key))
			.filter((candidate) => candidate.projectId === row.projectId && candidate.sessionId === row.sessionId);
		return mergeSessionSearchRows(related);
	}

	listSearchRuns(projectId) {
		const rows = [...this.table("searches").keys()]
			.map((k) => this.table("searches").get(k))
			.filter((r) => r.projectId === projectId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const groups = new Map();
		for (const row of rows) {
			const key = row.sessionId ? `session:${row.sessionId}` : `run:${row.id}`;
			groups.set(key, [...(groups.get(key) ?? []), row]);
		}
		return [...groups.values()].map(mergeSessionSearchRows).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	listBundles(projectId) {
		return [...this.table("bundles").keys()]
			.map((k) => this.table("bundles").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	listReadingReports(projectId) {
		return [...this.table("reports").keys()]
			.map((k) => this.table("reports").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	listPresentationRuns(projectId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	getBundle(id) {
		return this.table("bundles").get(id);
	}

	getReadingReport(id) {
		return this.table("reports").get(id);
	}

	getPresentationRun(id) {
		return this.table("presentations").get(id);
	}

	listProvenance(projectId) {
		return [...this.table("provenance").keys()]
			.map((k) => this.table("provenance").get(k))
			.filter((p) => p.projectId === projectId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}
}

export default LabTasksService;
