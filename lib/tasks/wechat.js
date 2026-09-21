/**
 * dsh-lab-agent / labTasks — 微信公众号入口及其页面解析 helper。
 */

import { rankDoiCandidates } from "../../src/literature/search-engine.js";
import { cleanStringList, inferredPublicationYear } from "./shared.js";


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

export const wechatMethods = {

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
	},


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
	},


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
};
