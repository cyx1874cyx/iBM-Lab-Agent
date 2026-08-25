/**
 * Minimal visible-browser broker inspired by InstSci's persistent publisher
 * sessions. Authentication remains inside Chrome/Edge. The broker sees page
 * state and PDF response bytes, but never exports cookies, localStorage or
 * credentials.
 */

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const PDF_LINK_RE = /(?:\.pdf(?:$|[?#])|\/pdf(?:direct)?(?:\/|$)|\/pdfft(?:$|[?#])|stamp\/stamp\.jsp|download[^?#]*pdf)/i;
const LOGIN_TEXT_RE = /log[ -]?in|sign[ -]?in|institution(?:al)? access|shibboleth|openathens|carsi|统一身份认证|机构登录|身份验证/i;
const CHALLENGE_TEXT_RE = /captcha|verify you are human|are you a robot|cloudflare|安全验证|机器人验证/i;
const ACCESS_TEXT_RE = /purchase|rent this article|buy article|access denied|not entitled|no access|购买|无权访问|未订阅/i;

export function normalizePaperIdentifier(value) {
	const input = String(value ?? "").trim();
	if (!input) throw new Error("请输入 DOI、论文链接或 PDF 链接");
	const doiMatch = input.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)?(10\.\d{4,9}\/[\w.()/:;-]+)/i);
	if (doiMatch) {
		const doi = doiMatch[1].replace(/[.,;]+$/, "");
		return { identifier: doi, doi, landingUrl: `https://doi.org/${doi}` };
	}
	let url;
	try { url = new URL(input); } catch { throw new Error("无法识别该文献标识；请粘贴 DOI 或 http/https 链接"); }
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("文献链接只支持 http/https");
	if (url.username || url.password) throw new Error("文献链接不能包含用户名或密码");
	return { identifier: url.href, landingUrl: url.href };
}

export function validatePdfBuffer(value, { minBytes = 8 * 1024, maxBytes = 100 * 1024 * 1024 } = {}) {
	const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
	if (buffer.byteLength < minBytes) throw new Error(`PDF 文件过小（${buffer.byteLength} 字节），疑似错误页`);
	if (buffer.byteLength > maxBytes) throw new Error(`PDF 超过 ${Math.round(maxBytes / 1024 / 1024)} MB 安全上限`);
	if (!buffer.subarray(0, Math.min(buffer.byteLength, 1024)).includes(Buffer.from("%PDF-"))) {
		throw new Error("下载内容不是有效 PDF（缺少 PDF 文件头）");
	}
	if (!buffer.subarray(Math.max(0, buffer.byteLength - 4096)).includes(Buffer.from("%%EOF"))) {
		throw new Error("PDF 结尾不完整（缺少 EOF 标记）");
	}
	const text = buffer.toString("latin1");
	const pageEstimate = Math.max(0, (text.match(/\/Type\s*\/Page\b/g) ?? []).length) || undefined;
	return {
		buffer,
		byteLength: buffer.byteLength,
		sha256: createHash("sha256").update(buffer).digest("hex"),
		pageEstimate
	};
}

export function safePdfFileName({ doi, title, suggestedName } = {}) {
	const raw = suggestedName || title || doi || "paper";
	const stem = String(raw)
		.replace(/\.pdf$/i, "")
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 150) || "paper";
	return `${stem}.pdf`;
}

export function inferSourceIdFromUrl(value) {
	let host;
	try { host = new URL(value).hostname.toLowerCase(); } catch { return undefined; }
	if (host.includes("nature.com") || host.includes("springer.com")) return "nature-portfolio";
	if (host.includes("acs.org")) return "acs";
	if (host.includes("sciencedirect.com") || host.includes("elsevier.com")) return "sciencedirect";
	if (host.includes("ieee.org")) return "ieee-xplore";
	if (host.includes("cnki.net") || host.includes("cnki.com.cn")) return "cnki";
	if (host.includes("wanfangdata.com.cn")) return "wanfang";
	return undefined;
}

class CdpClient {
	constructor(url, timeoutMs = 12_000) {
		this.url = url;
		this.timeoutMs = timeoutMs;
		this.sequence = 0;
		this.pending = new Map();
		this.listeners = new Set();
	}

	async connect() {
		this.socket = new WebSocket(this.url);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("连接浏览器调试会话超时")), this.timeoutMs);
			this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
			this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("无法连接浏览器调试会话")); }, { once: true });
		});
		this.socket.addEventListener("message", (event) => this.#message(event.data));
		this.socket.addEventListener("close", () => {
			for (const { reject, timer } of this.pending.values()) {
				clearTimeout(timer);
				reject(new Error("浏览器调试会话已关闭"));
			}
			this.pending.clear();
		});
	}

	#message(raw) {
		let packet;
		try { packet = JSON.parse(String(raw)); } catch { return; }
		if (packet.id) {
			const pending = this.pending.get(packet.id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(packet.id);
			if (packet.error) pending.reject(new Error(packet.error.message || "浏览器命令失败"));
			else pending.resolve(packet.result ?? {});
			return;
		}
		if (packet.method) for (const listener of this.listeners) listener(packet.method, packet.params ?? {});
	}

	onEvent(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	call(method, params = {}, timeoutMs = this.timeoutMs) {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("浏览器调试会话未连接"));
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close() {
		try { this.socket?.close(); } catch { /* ignore */ }
	}
}

function headerValue(headers, name) {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers ?? {})) if (key.toLowerCase() === wanted) return String(value);
	return "";
}

function suggestedNameFromHeaders(headers, url) {
	const disposition = headerValue(headers, "content-disposition");
	const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
	const plain = disposition.match(/filename="?([^";]+)"?/i);
	if (utf) try { return decodeURIComponent(utf[1]); } catch { return utf[1]; }
	if (plain) return plain[1];
	try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "paper.pdf"); } catch { return "paper.pdf"; }
}

async function pageSnapshot(client) {
	const result = await client.call("Runtime.evaluate", {
		expression: `(() => ({ title: document.title || '', url: location.href, text: (document.body?.innerText || '').slice(0, 6000) }))()`,
		returnByValue: true
	}).catch(() => ({ result: { value: {} } }));
	return result.result?.value ?? {};
}

async function bestPdfCandidate(client) {
	const result = await client.call("Runtime.evaluate", {
		expression: `(() => {
			const score = (a) => {
				const href = a.href || '';
				const text = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim();
				let n = 0;
				if (/\\.pdf(?:$|[?#])|\\/pdf(?:direct)?(?:\\/|$)|\\/pdfft(?:$|[?#])|stamp\\/stamp\\.jsp/i.test(href)) n += 8;
				if (/download.*pdf|view.*pdf|full.?text.*pdf|PDF/i.test(text)) n += 5;
				if (/supp|supporting|citation|reference/i.test(text + ' ' + href)) n -= 8;
				return n;
			};
			return Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, score: score(a) }))
				.filter(x => /^https?:/.test(x.href) && x.score > 0).sort((a,b) => b.score-a.score)[0]?.href || '';
		})()`,
		returnByValue: true
	});
	return result.result?.value || "";
}

/** Capture a legitimate PDF response in a visible persistent browser tab. */
export async function capturePublisherPdf({ webSocketDebuggerUrl, landingUrl, timeoutMs = 65_000 }) {
	const client = new CdpClient(webSocketDebuggerUrl, Math.min(timeoutMs, 15_000));
	await client.connect();
	let resolvePdf;
	let rejectPdf;
	const pdfPromise = new Promise((resolve, reject) => { resolvePdf = resolve; rejectPdf = reject; });
	const candidates = new Map();
	let settled = false;
	const finish = (value, error) => {
		if (settled) return;
		settled = true;
		if (error) rejectPdf(error); else resolvePdf(value);
	};
	const off = client.onEvent((method, params) => {
		if (method === "Network.responseReceived") {
			const response = params.response ?? {};
			const mime = String(response.mimeType ?? headerValue(response.headers, "content-type")).toLowerCase();
			if (mime.includes("pdf") || PDF_LINK_RE.test(response.url ?? "")) candidates.set(params.requestId, response);
		}
		if (method === "Network.loadingFinished" && candidates.has(params.requestId)) {
			const response = candidates.get(params.requestId);
			void client.call("Network.getResponseBody", { requestId: params.requestId }, 30_000).then((body) => {
				const buffer = Buffer.from(body.body ?? "", body.base64Encoded ? "base64" : "latin1");
				finish({ buffer, url: response.url, suggestedName: suggestedNameFromHeaders(response.headers, response.url) });
			}).catch(() => { /* a later candidate may still be readable */ });
		}
		if (method === "Network.loadingFailed" && candidates.has(params.requestId)) candidates.delete(params.requestId);
	});
	try {
		await Promise.all([client.call("Network.enable"), client.call("Page.enable"), client.call("Runtime.enable")]);
		await client.call("Page.navigate", { url: landingUrl });
		await Promise.race([pdfPromise, delay(5_000)]);
		if (settled) return await pdfPromise;

		const first = await pageSnapshot(client);
		if (CHALLENGE_TEXT_RE.test(`${first.title} ${first.text}`)) throw new Error("verification-required: 页面要求人工完成安全验证");
		if (LOGIN_TEXT_RE.test(`${first.title} ${first.text}`) && !PDF_LINK_RE.test(first.url ?? "")) {
			throw new Error("waiting-login: 机构登录尚未完成");
		}
		const pdfUrl = await bestPdfCandidate(client);
		if (!pdfUrl) {
			if (ACCESS_TEXT_RE.test(first.text ?? "")) throw new Error("no-access: 当前学校订阅不包含该全文");
			throw new Error("no-access: 页面未发现可用的主文 PDF 入口");
		}
		await client.call("Page.navigate", { url: pdfUrl });
		return await Promise.race([
			pdfPromise,
			delay(Math.max(10_000, timeoutMs - 5_000)).then(async () => {
				const final = await pageSnapshot(client);
				if (CHALLENGE_TEXT_RE.test(`${final.title} ${final.text}`)) throw new Error("verification-required: 页面要求人工完成安全验证");
				if (LOGIN_TEXT_RE.test(`${final.title} ${final.text}`)) throw new Error("waiting-login: 机构登录已失效");
				if (ACCESS_TEXT_RE.test(final.text ?? "")) throw new Error("no-access: 当前学校订阅不包含该全文");
				throw new Error("no-access: 未捕获到有效 PDF 响应");
			})
		]);
	} finally {
		off();
		client.close();
	}
}
