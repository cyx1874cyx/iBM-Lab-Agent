/**
 * dsh-lab-agent / labTasks — 文献检索、检索记录、paper metadata、preparePaper、暂存文件登记与引用导出。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validatePdfBuffer } from "../literature-browser.js";
import { captureValidationError } from "../../src/manual-capture.js";
import {
	canonicalizePaper,
	deduplicatePapers,
	DEFAULT_SOURCES,
	normalizeDoi
} from "../../src/literature/search-engine.js";
import { literatureEntryLayout, mergeEntryNaming } from "../entry-layout.js";
import {
	literatureSearchRunSchema,
	paperSourceBundleSchema,
	readingReportSchema
} from "../../src/task-models.js";
import { cleanStringList, inferredPublicationYear, isPathInside, normalizeJournalShortCitation } from "./shared.js";


function cleanSearchPaper(record) {
	const { _providerRank, ...paper } = canonicalizePaper(record, record.sources?.[0] ?? "openalex");
	return paper;
}


function searchEntryTitle(value, query) {
	const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
	return normalized ? [...normalized].slice(0, 80).join("") : `${String(query).trim()}相关文献`;
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
	if (hanChars.length === 0) throw new Error(`摘要概括必须包含中文（仅统计汉字，拉丁字母、数字和标点不计入）：${value}`);
	if (hanChars.length < 2 || hanChars.length > 9) {
		throw new Error(`摘要概括必须为 2–9 个汉字（实际 ${hanChars.length} 个汉字）：${value}（仅统计汉字，拉丁字母、数字和标点不计入）`);
	}
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

export const literatureMethods = {

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
	},


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
	},


	/** 删除一条检索记录；用于在课题面板清理误登记或低相关性批次。 */
	async deleteSearchRun(runId, projectId) {
		const table = this.table("searches");
		const stored = table.get(runId);
		if (stored === undefined) throw new Error(`search run '${runId}' not found`);
		if (projectId && stored.projectId !== projectId) throw new Error("检索条目不存在或不属于当前课题");
		const keys = [...table.keys()].filter((key) => {
			const row = table.get(key);
			return row?.projectId === stored.projectId && (stored.sessionId ? row.sessionId === stored.sessionId : key === runId);
		});
		let deleted = 0;
		for (const key of keys) if (await table.delete(key)) deleted += 1;
		return { id: runId, projectId: stored.projectId, deleted };
	},


	/** 检索结果导出（format-converter.py；需网络访问 PubMed/CrossRef/arXiv）。 */
	async exportSearchCitations(runId, { format = "ris" } = {}) {
		const run = this.getSearchRun(runId);
		if (run === undefined) throw new Error(`search run '${runId}' not found`);
		const dois = run.results.map((r) => r.doi).filter(Boolean).slice(0, 10);
		if (dois.length === 0) throw new Error("no DOIs to export");
		const result = await this.executor.exportCitations({ doi: dois.join(",") }, { format });
		return { format, text: result.stdout };
	},


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
	},


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
		noteTemplateId, noteTemplateVersion, model, naming
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
			noteTemplateId, noteTemplateVersion, model, naming
		}, type === "doi" ? "doi-ai-extraction" : "publisher-ai-extraction");
	},


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
		noteTemplateId, noteTemplateVersion, model, naming
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
			keywords: normalizedKeywords,
			// 命名各段是可累加的：先登记的 summaryZh 不应被后一次只给 journalAbbrev 的调用抹掉。
			naming: mergeEntryNaming(existing?.naming, naming)
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
		const persisted = paperSourceBundleSchema.parse({
			...bundle,
			entryStem: bundle.entryStem ?? layout.entryStem,
			entryDir: bundle.entryDir ?? layout.entryDir,
			updatedAt: now
		});
		await this.table("bundles").put(id, persisted);

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
		// 返回**已固化**的那一行：调用方（工具/面板/测试）需要看到 entryStem/entryDir，
		// 而不是 put 之前的中间对象。
		return { bundle: persisted, report, created: existing === undefined };
	},


	/**
	 * preparePaper：登记原文（PDF 或 nature-reader 的 source_map JSON），计算
	 * 哈希，调用 prepare_paper.py 生成规范化 source_bundle.json。
	 * PDF 输入需要 PyMuPDF（prepare_paper.py 依赖；python/requirements.lock 已
	 * 固定 PyMuPDF==1.28.2，venv/bootstrap 与 bundled python 均会带上）；source_map
	 * 输入仅 stdlib。PDF 与 sourceMap 至少给一个。
	 */
	async preparePaper({ projectId, pdfPath, sourceMapPath, title, bundleId, renderDir, model, doi, journal, siPath, naming }) {
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
		const mergedNaming = mergeEntryNaming(placeholder?.naming, naming);
		const entrySeed = { ...(placeholder ?? {}), id, title: normalizedTitle || placeholder?.title || "", doi: normalizedDoi ?? placeholder?.doi, authors: placeholder?.authors ?? [], year: placeholder?.year, naming: mergedNaming };
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
			naming: mergedNaming,
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
	},


	/**
	 * registerCapturedFile：手工浏览器捕获的原始文件登记（provenance
	 * source = manual-browser-capture）。复用原有 bundleId/reportId，不新建
	 * 文献；只登记原始文件（pdfPath/siPath + 哈希 + acquisitionStatus），
	 * 不冒充已经完成的全文精读（不动 report 状态机、不生成 paper card）。
	 * 文件必须已由 labCapture 服务校验并原子写入课题条目目录。
	 */
	async registerCapturedFile({ projectId, bundleId, kind, filePath, fileName, size, fileSha256, tokenSha256, replaced }) {
		const bundle = this.table("bundles").get(bundleId);
		// R4：与 labCapture 保持同一个 code —— 条目没了/不属于本课题，调用方应放弃重试。
		if (bundle === undefined) throw captureValidationError("bundle-missing", `source bundle '${bundleId}' not found`);
		if (bundle.projectId !== projectId) throw captureValidationError("bundle-missing", `source bundle '${bundleId}' belongs to another project`);
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
			inputs: {
				kind, fileName, size, sha256: fileSha256, tokenSha256,
				captureSource: "manual-browser-capture",
				// R3：用户确认替换时，旧文件被改名留证——把这条关系写进审计链，
				// 否则"这份 PDF 是哪来的、上一版去哪了"事后无从查起。
				...(replaced ? { replacedFileName: replaced.fileName, replacedSha256: replaced.sha256 } : {})
			},
			source: "manual-browser-capture",
			// R3：替换关系同时记在 provenance 的可读字段上（inputsSha256 只存哈希，
			// 光靠它查不出"替换了谁"）。
			...(replaced ? { replaced: { fileName: replaced.fileName, sha256: replaced.sha256 } } : {})
		});
		return next;
	},


	getSearchRun(id) {
		const row = this.table("searches").get(id);
		if (!row?.sessionId) return row;
		const related = [...this.table("searches").keys()]
			.map((key) => this.table("searches").get(key))
			.filter((candidate) => candidate.projectId === row.projectId && candidate.sessionId === row.sessionId);
		return mergeSessionSearchRows(related);
	},


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
	},


	listBundles(projectId) {
		return [...this.table("bundles").keys()]
			.map((k) => this.table("bundles").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},


	getBundle(id) {
		return this.table("bundles").get(id);
	}
};
