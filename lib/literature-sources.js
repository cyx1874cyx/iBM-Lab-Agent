/**
 * 文献数据库状态与授权浏览器会话服务（ctx.labLiterature）。
 *
 * 安全边界：
 * - 密码、Cookie、localStorage 与会话令牌不进入 storage domain；
 * - Cookie 只由独立 Chrome/Edge user-data-dir 自身加密并持久化；
 * - 服务通过本机 CDP 的 tab URL/title 判断是否仍停在登录/验证页；
 * - CAPTCHA、二维码、短信/OTP 与机器人验证一律交给用户。
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
	LITERATURE_SOURCES,
	literatureDownloadSchema,
	literatureSessionSchema,
	literatureSourceStatusSchema,
	requireLiteratureSource,
	normalizeResourceUrl,
	sourcePublicView
} from "../src/literature/data-sources.js";
import {
	capturePublisherPdf,
	inferSourceIdFromUrl,
	normalizePaperIdentifier,
	safePdfFileName,
	validatePdfBuffer
} from "./literature-browser.js";

export const labLiteratureDomainSpec = defineDomain({
	name: "lab_literature_sources",
	version: 0,
	tables: {
		literature_sessions: domainTable(literatureSessionSchema),
		literature_downloads: domainTable(literatureDownloadSchema)
	}
});

const CHALLENGE_RE = /captcha|cloudflare|are you a robot|机器人|安全验证|verify you are human|challenge/i;
const LOGIN_RE = /\blog[ -]?in\b|\bsign[ -]?in\b|统一身份认证|机构登录|身份验证|shibboleth|openathens|authserver|carsi/i;
const AGREEMENT_RE = /用户协议|使用协议|服务协议|授权协议|我已阅读|同意协议|\bagree(?:ment)?\b|\bconsent\b/i;
const execFileAsync = promisify(execFile);
const DOWNLOAD_TERMINAL = new Set(["completed", "no-access", "verification-required", "failed", "waiting-login"]);

function now() {
	return new Date().toISOString();
}

function portFor(sourceId) {
	let hash = 0;
	for (const char of sourceId) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
	return 9320 + (hash % 400);
}

function hostMatches(hostname, patterns = []) {
	const host = hostname.toLowerCase();
	return patterns.some((pattern) => {
		const value = pattern.toLowerCase();
		return host === value || host.endsWith(`.${value}`) || host.includes(value);
	});
}

function defaultBrowserCandidates() {
	const local = process.env.LOCALAPPDATA;
	const programFiles = process.env.PROGRAMFILES;
	const programFilesX86 = process.env["PROGRAMFILES(X86)"];
	return [
		process.env.LIT_BROWSER_PATH,
		local && join(local, "Google", "Chrome", "Application", "chrome.exe"),
		programFiles && join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
		programFilesX86 && join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
		local && join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
		programFilesX86 && join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
	].filter(Boolean);
}

export function classifyProbe({ response, error, authMode, checkedAt, latencyMs, label }) {
	if (error) {
		return { state: "unavailable", message: `${label}探测失败：${error.message}`, checkedAt, latencyMs };
	}
	const status = response.status;
	if ((status >= 200 && status < 400) || status === 405) {
		return { state: "available", message: `${label}入口可达`, checkedAt, latencyMs, httpStatus: status };
	}
	if (status === 401 || status === 403) {
		return {
			state: authMode === "public" ? "degraded" : "auth-required",
			message: authMode === "public" ? `${label}受限（HTTP ${status}）` : `${label}入口可达，需机构授权`,
			checkedAt, latencyMs, httpStatus: status
		};
	}
	if (status === 429) return { state: "degraded", message: `${label}限流中`, checkedAt, latencyMs, httpStatus: status };
	return { state: "unavailable", message: `${label}异常（HTTP ${status}）`, checkedAt, latencyMs, httpStatus: status };
}

export function classifyBrowserTargets(source, session, targets) {
	const checkedAt = now();
	if (!targets.length) return { state: "browser-open", message: "授权浏览器已启动，等待页面加载", checkedAt };
	const expectedHosts = [...source.expectedHosts];
	for (const target of targets) {
		const text = `${target.title ?? ""} ${target.url ?? ""}`;
		if (CHALLENGE_RE.test(text)) {
			return { state: "verification-required", message: "页面需要人工完成安全验证", checkedAt };
		}
		if (AGREEMENT_RE.test(text)) {
			return { state: "agreement-required", message: "等待你阅读并确认学校资源使用协议", checkedAt };
		}
	}
	for (const target of targets) {
		let parsed;
		try { parsed = new URL(target.url); } catch { continue; }
		if (hostMatches(parsed.hostname, expectedHosts)) {
			return { state: "connected", message: "已回到数据库页面，浏览器会话可复用", checkedAt };
		}
	}
	for (const target of targets) {
		let parsed;
		try { parsed = new URL(target.url); } catch { continue; }
		if (hostMatches(parsed.hostname, source.loginHosts) || LOGIN_RE.test(target.title ?? "")) {
			return { state: "waiting-user", message: "正在等待你在浏览器中完成登录", checkedAt };
		}
	}
	return { state: "browser-open", message: "浏览器已打开，但尚未检测到目标数据库页面", checkedAt };
}

export class LabLiteratureSourcesService extends Service {
	static inject = ["storageDomain"];
	table;
	downloadTable;
	statusCache = new Map();
	downloadQueue = [];
	queueRunning = false;

	constructor(ctx, config = {}) {
		super(ctx, "labLiterature");
		this.config = config ?? {};
		this.sessionsDir = this.config.sessionsDir ?? join(homedir(), ".ibm-lab-agent", "literature-sessions");
		this.downloadsDir = this.config.downloadsDir ?? join(homedir(), ".ibm-lab-agent", "literature-downloads");
		this.fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
		this.spawnImpl = this.config.spawnImpl ?? spawn;
		this.execFileImpl = this.config.execFileImpl ?? execFileAsync;
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labLiteratureDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.literature.domainClose");
		this.domain = domain;
		this.table = domain.table("literature_sessions");
		this.downloadTable = domain.table("literature_downloads");
		mkdirSync(this.sessionsDir, { recursive: true });
		mkdirSync(this.downloadsDir, { recursive: true });
		const webServer = this.ctx.get("webServer");
		if (webServer) {
			this.ctx.effect(() => webServer.register({
				kind: "prefix",
				path: "/api/lab-literature-download",
				handler: (req, res) => void this.handleDownloadRequest(req, res)
			}), "lab-agent.literature-download");
		}
		// A process restart must not strand jobs in an in-progress state.
		for (const key of this.downloadTable.keys()) {
			const job = this.downloadTable.get(key);
			if (job && !DOWNLOAD_TERMINAL.has(job.state)) {
				await this.downloadTable.put(key, { ...job, state: "queued", message: "服务重启后已重新排队", updatedAt: now() });
				this.downloadQueue.push(key);
			}
		}
		this.kickQueue();
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labLiterature is not started yet");
		return this.table;
	}

	getSession(sourceId) {
		return this.requireTable().get(sourceId);
	}

	async persistSession(sourceId, patch = {}) {
		const previous = this.getSession(sourceId);
		const timestamp = now();
		const row = literatureSessionSchema.parse({
			id: sourceId,
			sourceId,
			state: "idle",
			createdAt: previous?.createdAt ?? timestamp,
			updatedAt: timestamp,
			...previous,
			...patch,
			updatedAt: timestamp
		});
		await this.requireTable().put(sourceId, row);
		return row;
	}

	listSources() {
		return LITERATURE_SOURCES.map((source) => sourcePublicView(source, this.getSession(source.id)));
	}

	async configure(sourceId, resourceUrl) {
		const source = requireLiteratureSource(sourceId);
		if (!source.configurable && !resourceUrl) throw new Error(`数据源 '${source.name}' 不需要配置入口`);
		const normalized = normalizeResourceUrl(resourceUrl);
		await this.persistSession(sourceId, { resourceUrl: normalized, state: "idle", lastError: undefined });
		this.statusCache.delete(sourceId);
		return sourcePublicView(source, this.getSession(sourceId));
	}

	async probe(url, source, label) {
		const checkedAt = now();
		if (!url) {
			return { state: "not-supported", message: `${label}需在文献级别验证`, checkedAt };
		}
		const started = Date.now();
		try {
			const response = await this.fetchImpl(url, {
				method: "HEAD",
				redirect: "manual",
				signal: AbortSignal.timeout(this.config.probeTimeoutMs ?? 8000),
				headers: { "user-agent": "iBM-Lab-Agent/0.1 literature-health" }
			});
			return classifyProbe({ response, authMode: source.authMode, checkedAt, latencyMs: Date.now() - started, label });
		} catch (error) {
			return classifyProbe({ error, authMode: source.authMode, checkedAt, latencyMs: Date.now() - started, label });
		}
	}

	connectionStatus(source, session) {
		if (source.authMode === "public") return { state: "connected", message: "无需登录" };
		if (!session) return { state: "idle", message: "尚未连接机构数据库" };
		return {
			state: session.state,
			message: session.lastError || ({
				idle: "尚未连接机构数据库",
				"browser-open": "授权浏览器已打开",
				"waiting-user": "等待人工登录",
				"agreement-required": "等待人工确认资源使用协议",
				connected: "浏览器登录会话可复用",
				"verification-required": "需要人工完成安全验证",
				expired: "登录会话已过期",
				error: "连接失败"
			}[session.state] ?? session.state),
			lastOpenedAt: session.lastOpenedAt,
			lastVerifiedAt: session.lastVerifiedAt
		};
	}

	async sourceStatus(source, force = false) {
		const cached = this.statusCache.get(source.id);
		if (!force && cached && Date.now() - cached.cachedAt < (this.config.cacheTtlMs ?? 30000)) return cached.value;
		const session = this.getSession(source.id);
		let search;
		let download;
		if (source.authMode === "institutional" && session?.debuggingPort && force) {
			try {
				const live = classifyBrowserTargets(source, session, await this.browserTargets(session.debuggingPort));
				if (live.state !== session.state) await this.persistSession(source.id, {
					state: live.state,
					lastVerifiedAt: now(),
					lastError: live.state === "expired" || live.state === "error" ? live.message : undefined
				});
			} catch {
				await this.persistSession(source.id, { state: "expired", lastVerifiedAt: now(), lastError: "受控检索浏览器已关闭" });
			}
		}
		const liveSession = this.getSession(source.id);
		const lastDownload = this.listDownloads({ sourceId: source.id, limit: 1 }).jobs[0];
		if (source.authMode === "institutional" && liveSession?.state === "connected") {
			const checkedAt = now();
			search = { state: "connected", message: "将复用已验证浏览器会话检索", checkedAt };
			download = source.supportsDownload
				? lastDownload?.state === "completed"
					? { state: "available", message: `最近一次 PDF 已验证（${lastDownload.byteLength} 字节）`, checkedAt }
					: { state: "verification-required", message: "会话就绪；全文权限按具体文献验证", checkedAt }
				: { state: "not-supported", message: "该库用于检索/全文路由，不直接提供 PDF", checkedAt };
		} else if (source.authMode === "institutional") {
			const entry = session?.resourceUrl ?? source.searchProbe ?? source.entryUrl;
			const reachability = await this.probe(entry, source, "数据库");
			search = reachability.state === "available"
				? { ...reachability, state: "auth-required", message: "入口可达，登录后验证检索" }
				: reachability;
			download = source.supportsDownload
				? { state: "auth-required", message: "需登录并按学校订阅验证全文权限", checkedAt: now() }
				: { state: "not-supported", message: "该库不直接提供 PDF", checkedAt: now() };
		} else {
			[search, download] = await Promise.all([
				this.probe(source.searchProbe, source, "检索"),
				source.supportsDownload
					? this.probe(source.downloadProbe, source, "下载")
					: Promise.resolve({ state: "not-supported", message: "元数据源不直接提供全文", checkedAt: now() })
			]);
		}
		const value = literatureSourceStatusSchema.parse({
			id: source.id,
			name: source.name,
			tier: source.tier,
			authMode: source.authMode,
			search,
			download,
			connection: this.connectionStatus(source, liveSession),
			entryUrl: liveSession?.resourceUrl ?? source.entryUrl,
			institutionEntryUrl: source.institutionEntryUrl,
			supportsDownload: source.supportsDownload,
			restrictedAutomation: source.restrictedAutomation === true
		});
		this.statusCache.set(source.id, { cachedAt: Date.now(), value });
		return value;
	}

	async statuses({ sourceIds, force = false } = {}) {
		const selected = sourceIds?.length
			? sourceIds.map(requireLiteratureSource)
			: LITERATURE_SOURCES;
		const statuses = await Promise.all(selected.map((source) => this.sourceStatus(source, force)));
		return { checkedAt: now(), sources: statuses };
	}

	findBrowser() {
		if (this.config.browserExecutable && existsSync(this.config.browserExecutable)) return this.config.browserExecutable;
		return defaultBrowserCandidates().find((candidate) => existsSync(candidate));
	}

	async openExistingBrowser(port, url) {
		try {
			if (this.config.windowsCdpBridge) {
				await this.windowsCdpRequest(port, `/json/new?${encodeURIComponent(url)}`, "PUT");
				return true;
			}
			const response = await this.fetchImpl(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
				method: "PUT",
				signal: AbortSignal.timeout(1500)
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async windowsCdpRequest(port, path, method = "GET") {
		const executable = this.config.windowsCurlExecutable ?? "/mnt/c/Windows/System32/curl.exe";
		const { stdout } = await this.execFileImpl(executable, [
			"--silent", "--show-error", "--fail", "--request", method,
			`http://127.0.0.1:${port}${path}`
		], { timeout: this.config.browserProbeTimeoutMs ?? 2500, maxBuffer: 4 * 1024 * 1024 });
		return JSON.parse(stdout);
	}

	async connect(sourceId, resourceUrl, { mode } = {}) {
		const source = requireLiteratureSource(sourceId);
		if (source.authMode !== "institutional") throw new Error(`${source.name} 无需人工登录`);
		let session = this.getSession(sourceId);
		if (resourceUrl) session = await this.persistSession(sourceId, { resourceUrl: normalizeResourceUrl(resourceUrl) });
		// 未显式指定资源地址时先进入学校图书馆门户，让用户从官方入口选择
		// 数据库并完成统一身份认证/协议确认，避免误入出版商个人账号登录页。
		const entryUrl = resourceUrl
			? normalizeResourceUrl(resourceUrl)
			: (source.institutionEntryUrl ?? session?.resourceUrl ?? source.entryUrl ?? this.config.institutionPortalUrl);
		if (!entryUrl) throw new Error("请先填写学校图书馆电子资源入口链接");
		const selectedMode = mode ?? (this.config.clientManagedBrowser ? "current" : "managed");
		if (selectedMode === "current") {
			const updated = await this.persistSession(sourceId, {
				resourceUrl: entryUrl,
				browser: "current-browser",
				debuggingPort: undefined,
				state: "browser-open",
				lastOpenedAt: now(),
				lastError: undefined
			});
			this.statusCache.delete(sourceId);
			return {
				entryUrl,
				source: sourcePublicView(source, updated),
				connection: this.connectionStatus(source, updated),
				message: "请在当前 DSH 浏览器的新标签页完成人工登录。此模式复用该浏览器 Cookie，但不支持后台自动捕获 PDF。"
			};
		}
		if (selectedMode !== "managed") throw new Error("未知的浏览器连接模式");
		const browser = this.findBrowser();
		if (!browser) throw new Error("未找到 Chrome 或 Edge；可通过 LIT_BROWSER_PATH 指定浏览器路径");
		// 所有机构库共用一个持久化 profile：登录一次学校 SSO/CARSI 后，
		// 可在同一浏览器上下文继续打开不同数据库，同时与用户日常浏览器隔离。
		const port = session?.debuggingPort ?? portFor("institutional");
		const opened = await this.openExistingBrowser(port, entryUrl);
		if (!opened) {
			const profileDir = join(this.sessionsDir, "institutional");
			mkdirSync(profileDir, { recursive: true });
			// WSL 启动 Windows 浏览器时，文件检查使用 /mnt/c 路径，而 Edge 参数
			// 必须使用 Windows 路径；两者可分别配置。
			const browserProfileArgument = this.config.browserProfileArgument ?? profileDir;
			const child = this.spawnImpl(browser, [
				`--user-data-dir=${browserProfileArgument}`,
				"--profile-directory=Default",
				`--remote-debugging-port=${port}`,
				"--remote-debugging-address=127.0.0.1",
				"--no-first-run",
				"--no-default-browser-check",
				"--new-window",
				entryUrl
			], { detached: true, stdio: "ignore", windowsHide: true });
			child.unref?.();
		}
		const updated = await this.persistSession(sourceId, {
			resourceUrl: entryUrl,
			browser,
			debuggingPort: port,
			state: "waiting-user",
			lastOpenedAt: now(),
			lastError: undefined
		});
		this.statusCache.delete(sourceId);
		return {
			source: sourcePublicView(source, updated),
			connection: this.connectionStatus(source, updated),
			entryUrl,
			message: "受控检索浏览器已打开。请在可见窗口中完成登录/协议/验证码，再点击“验证登录”。"
		};
	}

	async browserTargets(port) {
		if (this.config.windowsCdpBridge) {
			const rows = await this.windowsCdpRequest(port, "/json/list");
			return rows.filter((row) => row.type === undefined || row.type === "page");
		}
		const response = await this.fetchImpl(`http://127.0.0.1:${port}/json/list`, {
			signal: AbortSignal.timeout(this.config.browserProbeTimeoutMs ?? 2500)
		});
		if (!response.ok) throw new Error(`浏览器状态接口返回 HTTP ${response.status}`);
		const rows = await response.json();
		return rows.filter((row) => row.type === undefined || row.type === "page");
	}

	async verify(sourceId) {
		const source = requireLiteratureSource(sourceId);
		const session = this.getSession(sourceId);
		if (session?.browser === "current-browser") {
			if (!session?.lastOpenedAt) throw new Error("请先点击“连接数据库”打开学校图书馆");
			const updated = await this.persistSession(sourceId, {
				state: "connected",
				lastVerifiedAt: now(),
				lastError: undefined
			});
			this.statusCache.delete(sourceId);
			return {
				manualConfirmation: true,
				connection: this.connectionStatus(source, updated),
				message: "已按你的人工确认记录为已登录；实际检索与全文权限仍会在具体操作时验证。"
			};
		}
		if (!session?.debuggingPort) throw new Error("请先点击“连接数据库”打开授权浏览器");
		let result;
		try {
			result = classifyBrowserTargets(source, session, await this.browserTargets(session.debuggingPort));
		} catch (error) {
			result = { state: "expired", message: `无法连接授权浏览器：${error.message}` };
		}
		const updated = await this.persistSession(sourceId, {
			state: result.state,
			lastVerifiedAt: now(),
			lastError: result.state === "expired" || result.state === "error" ? result.message : undefined
		});
		this.statusCache.delete(sourceId);
		// 不把当前 URL 返回到 UI；SSO 回调 URL 可能含一次性参数。
		return { connection: this.connectionStatus(source, updated) };
	}

	listDownloads({ sourceId, limit = 20 } = {}) {
		const jobs = [...this.downloadTable.keys()]
			.map((key) => this.downloadTable.get(key))
			.filter((job) => job && (!sourceId || job.sourceId === sourceId))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))
			.map(({ filePath, ...job }) => ({ ...job, downloadUrl: job.state === "completed" ? `/api/lab-literature-download?id=${encodeURIComponent(job.id)}` : undefined }));
		return { jobs };
	}

	async updateDownload(id, patch) {
		const previous = this.downloadTable.get(id);
		if (!previous) throw new Error(`全文任务 '${id}' 不存在`);
		const row = literatureDownloadSchema.parse({ ...previous, ...patch, updatedAt: now() });
		await this.downloadTable.put(id, row);
		if (row.sourceId) this.statusCache.delete(row.sourceId);
		return row;
	}

	async queueDownload({ identifier, sourceId } = {}) {
		const normalized = normalizePaperIdentifier(identifier);
		if (sourceId) requireLiteratureSource(sourceId);
		const timestamp = now();
		const job = literatureDownloadSchema.parse({
			id: randomUUID(),
			identifier: normalized.identifier,
			doi: normalized.doi,
			sourceId,
			state: "queued",
			message: "已进入全文获取队列；将先检查开放获取版本",
			landingUrl: normalized.landingUrl,
			createdAt: timestamp,
			updatedAt: timestamp
		});
		await this.downloadTable.put(job.id, job);
		this.downloadQueue.push(job.id);
		this.kickQueue();
		return this.listDownloads({ limit: 100 }).jobs.find((row) => row.id === job.id);
	}

	async retryDownload(id) {
		const job = this.downloadTable.get(id);
		if (!job) throw new Error(`全文任务 '${id}' 不存在`);
		if (!DOWNLOAD_TERMINAL.has(job.state)) return this.listDownloads({ limit: 100 }).jobs.find((row) => row.id === id);
		await this.updateDownload(id, { state: "queued", message: "已重新排队，将复用当前浏览器会话" });
		if (!this.downloadQueue.includes(id)) this.downloadQueue.push(id);
		this.kickQueue();
		return this.listDownloads({ limit: 100 }).jobs.find((row) => row.id === id);
	}

	kickQueue() {
		if (this.queueRunning || this.downloadQueue.length === 0) return;
		this.queueRunning = true;
		queueMicrotask(() => void this.drainQueue());
	}

	async drainQueue() {
		try {
			while (this.downloadQueue.length) {
				const id = this.downloadQueue.shift();
				try { await this.runDownload(id); }
				catch (error) {
					const message = String(error?.message ?? error);
					let state = "failed";
					if (message.startsWith("waiting-login:")) state = "waiting-login";
					else if (message.startsWith("verification-required:")) state = "verification-required";
					else if (message.startsWith("no-access:")) state = "no-access";
					await this.updateDownload(id, { state, message: message.replace(/^[a-z-]+:\s*/, "") });
				}
			}
		} finally {
			this.queueRunning = false;
			if (this.downloadQueue.length) this.kickQueue();
		}
	}

	async fetchPdf(url) {
		const parsed = new URL(url);
		if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("不安全的 PDF 地址");
		if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) throw new Error("拒绝访问本机或私有网络地址");
		const response = await this.fetchImpl(parsed, {
			redirect: "follow",
			signal: AbortSignal.timeout(this.config.pdfFetchTimeoutMs ?? 60_000),
			headers: { "user-agent": "iBM-Lab-Agent/0.1 legitimate-fulltext" }
		});
		if (!response.ok) throw new Error(`PDF 请求返回 HTTP ${response.status}`);
		const declared = Number(response.headers.get("content-length"));
		const max = this.config.maxPdfBytes ?? 100 * 1024 * 1024;
		if (Number.isFinite(declared) && declared > max) throw new Error("PDF 超过 100 MB 安全上限");
		return {
			buffer: Buffer.from(await response.arrayBuffer()),
			url: response.url,
			suggestedName: decodeURIComponent(new URL(response.url).pathname.split("/").pop() || "paper.pdf")
		};
	}

	async resolveOpenAccess(job) {
		const candidates = [];
		let title;
		// 用户直接粘贴的网页地址可能是无 .pdf 后缀的 PDF 路由（典型如
		// arXiv /pdf/<id>）。先请求并做 PDF 文件级校验；若实际返回 HTML，
		// 再无副作用地进入出版商/机构浏览器后备路径。
		if (!job.doi && job.landingUrl) candidates.push(job.landingUrl);
		if (job.doi) {
			try {
				const workId = encodeURIComponent(`https://doi.org/${job.doi}`);
				const response = await this.fetchImpl(`https://api.openalex.org/works/${workId}`, {
					signal: AbortSignal.timeout(this.config.metadataTimeoutMs ?? 15_000),
					headers: { "user-agent": "iBM-Lab-Agent/0.1 (mailto:library-access@localhost)" }
				});
				if (response.ok) {
					const work = await response.json();
					title = work.title || undefined;
					for (const location of [work.best_oa_location, work.primary_location, ...(work.locations ?? [])]) {
						if (location?.pdf_url && !candidates.includes(location.pdf_url)) candidates.push(location.pdf_url);
					}
				}
			} catch { /* OA service failure must not block institutional fallback. */ }
		}
		for (const url of candidates.slice(0, 5)) {
			try { return { ...(await this.fetchPdf(url)), title }; } catch { /* try next legitimate OA location */ }
		}
		return { title };
	}

	async resolveLandingUrl(job) {
		if (!job.doi) return job.landingUrl;
		try {
			const response = await this.fetchImpl(`https://doi.org/${job.doi}`, {
				method: "HEAD",
				redirect: "follow",
				signal: AbortSignal.timeout(this.config.metadataTimeoutMs ?? 15_000),
				headers: { "user-agent": "iBM-Lab-Agent/0.1 legitimate-fulltext" }
			});
			return response.url || job.landingUrl;
		} catch { return job.landingUrl; }
	}

	managedSession(sourceId) {
		const direct = sourceId && this.getSession(sourceId);
		if (direct?.debuggingPort && direct.browser !== "current-browser") return direct;
		for (const key of this.table.keys()) {
			const session = this.table.get(key);
			if (session?.debuggingPort && session.browser !== "current-browser") return session;
		}
		return undefined;
	}

	async createBrowserTarget(port, url = "about:blank") {
		if (this.config.windowsCdpBridge) return this.windowsCdpRequest(port, `/json/new?${encodeURIComponent(url)}`, "PUT");
		const response = await this.fetchImpl(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
			method: "PUT",
			signal: AbortSignal.timeout(2500)
		});
		if (!response.ok) throw new Error(`无法创建检索标签页（HTTP ${response.status}）`);
		return response.json();
	}

	async persistPdf(job, captured, route, patch = {}) {
		const checked = validatePdfBuffer(captured.buffer, { maxBytes: this.config.maxPdfBytes ?? 100 * 1024 * 1024 });
		const fileName = safePdfFileName({ doi: job.doi, title: patch.title || job.title, suggestedName: captured.suggestedName });
		const filePath = join(this.downloadsDir, `${job.id}-${fileName}`);
		await writeFile(filePath, checked.buffer, { flag: "wx" });
		return this.updateDownload(job.id, {
			...patch,
			state: "completed",
			message: route === "open-access" ? "已获取并验证开放获取 PDF" : "已通过学校授权会话获取并验证 PDF",
			route,
			filePath,
			fileName,
			byteLength: checked.byteLength,
			sha256: checked.sha256,
			pageEstimate: checked.pageEstimate,
			completedAt: now()
		});
	}

	async runDownload(id) {
		let job = this.downloadTable.get(id);
		if (!job) return;
		await this.updateDownload(id, { state: "resolving-oa", message: "正在检查 OpenAlex 等开放获取位置" });
		const oa = await this.resolveOpenAccess(job);
		if (oa.buffer) return this.persistPdf(job, oa, "open-access", { title: oa.title });

		const landingUrl = await this.resolveLandingUrl(job);
		const inferred = inferSourceIdFromUrl(landingUrl);
		const sourceId = inferred ?? job.sourceId;
		const source = sourceId ? requireLiteratureSource(sourceId) : undefined;
		job = await this.updateDownload(id, {
			title: oa.title,
			landingUrl,
			sourceId,
			state: "opening-publisher",
			message: "未发现开放版本，正在转入学校授权的出版商页面"
		});
		if (source?.restrictedAutomation) throw new Error("no-access: 该数据库未获自动化授权，仅允许人工使用");
		const session = this.managedSession(sourceId);
		if (!session?.debuggingPort) throw new Error("waiting-login: 请先在数据库卡片中启动“受控检索浏览器”并完成人工登录");
		let target;
		try { target = await this.createBrowserTarget(session.debuggingPort); }
		catch { throw new Error("waiting-login: 受控检索浏览器已关闭，请重新连接数据库"); }
		if (!target?.webSocketDebuggerUrl) throw new Error("failed: 浏览器未返回可控制的检索标签页");
		await this.updateDownload(id, { state: "locating-pdf", message: "正在可见浏览器中定位主文 PDF；不会读取 Cookie 值" });
		const captured = await capturePublisherPdf({
			webSocketDebuggerUrl: target.webSocketDebuggerUrl,
			landingUrl,
			timeoutMs: this.config.publisherTimeoutMs ?? 65_000
		});
		await this.updateDownload(id, { state: "downloading", message: "已捕获 PDF 响应，正在校验文件头、结尾、大小与哈希" });
		return this.persistPdf(job, captured, "institutional-browser", { landingUrl, sourceId });
	}

	async handleDownloadRequest(req, res) {
		const fetchSite = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
		if (req.method !== "GET" || (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite))) {
			res.writeHead(req.method === "GET" ? 403 : 405, { "content-type": "text/plain;charset=utf-8" });
			res.end("download denied");
			return;
		}
		const url = new URL(req.url ?? "/api/lab-literature-download", "http://localhost");
		const id = url.searchParams.get("id") ?? "";
		const job = /^[a-f0-9-]{36}$/i.test(id) ? this.downloadTable.get(id) : undefined;
		if (!job || job.state !== "completed" || !job.filePath) {
			res.writeHead(404, { "content-type": "text/plain;charset=utf-8", "cache-control": "no-store" });
			res.end("validated PDF not found");
			return;
		}
		try {
			const buffer = await readFile(job.filePath);
			const checked = validatePdfBuffer(buffer, { maxBytes: this.config.maxPdfBytes ?? 100 * 1024 * 1024 });
			if (checked.sha256 !== job.sha256 || checked.byteLength !== job.byteLength) throw new Error("stored PDF integrity mismatch");
			res.writeHead(200, {
				"content-type": "application/pdf",
				"content-length": String(buffer.byteLength),
				"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.fileName)}`,
				"x-file-name": encodeURIComponent(job.fileName),
				"x-content-sha256": job.sha256,
				"cache-control": "no-store, max-age=0",
				"x-content-type-options": "nosniff"
			});
			res.end(buffer);
		} catch (error) {
			res.writeHead(500, { "content-type": "text/plain;charset=utf-8", "cache-control": "no-store" });
			res.end(error.message || "PDF integrity check failed");
		}
	}
}

export default LabLiteratureSourcesService;
