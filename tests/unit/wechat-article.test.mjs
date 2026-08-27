import { test } from "node:test";
import assert from "node:assert/strict";
import { extractWechatArticlePage, LabTasksService, normalizeWechatArticleUrl } from "../../lib/tasks.js";

test("WeChat URL validation accepts article links and removes share-only parameters", () => {
	const normalized = normalizeWechatArticleUrl("https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1&sn=xyz&scene=21&from=timeline#wechat_redirect");
	assert.equal(normalized, "https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1&sn=xyz");
	assert.throws(() => normalizeWechatArticleUrl("https://example.com/s?mid=123"), /mp\.weixin\.qq\.com/);
	assert.throws(() => normalizeWechatArticleUrl("http://mp.weixin.qq.com/s?mid=123"), /https/);
	assert.throws(() => normalizeWechatArticleUrl("https://mp.weixin.qq.com/mp/profile_ext?action=home"), /article URL/);
});

test("WeChat page extraction returns visible article text without script noise", () => {
	const page = extractWechatArticlePage(`<!doctype html>
		<html><head>
		<meta content="A&amp;B 文献导读" property="og:title">
		<meta property="og:description" content="页面摘要">
		<meta name="author" content="iBM 课题组">
		<title>fallback title</title>
		<script>var ct = "1751328000"; window.secret = "do not expose";</script>
		</head><body>
		<div id="js_content" class="rich_media_content">
			<h2>论文信息</h2>
			<p>Title: Targeted prodrug polymer</p>
			<div><p>DOI: 10.1000/example.1</p></div>
			<p>结论：提高递送效率&nbsp;并降低毒性。</p>
			<script>hidden()</script>
		</div>
		<footer>页面导航噪声</footer>
		</body></html>`);
	assert.equal(page.pageTitle, "A&B 文献导读");
	assert.equal(page.description, "页面摘要");
	assert.equal(page.accountName, "iBM 课题组");
	assert.match(page.wechatPublishedAt, /^2025-/);
	assert.match(page.content, /Targeted prodrug polymer/);
	assert.match(page.content, /10\.1000\/example\.1/);
	assert.match(page.content, /提高递送效率 并降低毒性/);
	assert.doesNotMatch(page.content, /do not expose|hidden|页面导航噪声/);
});

test("dedicated WeChat fetch accepts textual article pages and blocks cross-site redirects", async () => {
	const originalFetch = globalThis.fetch;
	try {
		let request;
		globalThis.fetch = async (url, options) => {
			request = { url, options };
			return new Response(`<meta property="og:title" content="文献导读"><div id="js_content"><p>Title: Safe article body with DOI 10.1000/safe.1</p></div>`, {
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" }
			});
		};
		const page = await LabTasksService.prototype.fetchWechatArticle.call({}, { sourceUrl: "https://mp.weixin.qq.com/s/valid-token" });
		assert.equal(request.url, "https://mp.weixin.qq.com/s/valid-token");
		assert.equal(request.options.redirect, "manual");
		assert.match(request.options.headers["user-agent"], /Android.*Mobile.*MicroMessenger/);
		assert.match(page.content, /10\.1000\/safe\.1/);

		globalThis.fetch = async () => new Response("", {
			status: 302,
			headers: { location: "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=test" }
		});
		await assert.rejects(
			() => LabTasksService.prototype.fetchWechatArticle.call({}, { sourceUrl: "https://mp.weixin.qq.com/s/challenged" }),
			/human verification/
		);

		globalThis.fetch = async () => new Response("", { status: 302, headers: { location: "https://example.com/private" } });
		await assert.rejects(() => LabTasksService.prototype.fetchWechatArticle.call({}, { sourceUrl: "https://mp.weixin.qq.com/s/redirect" }), /mp\.weixin\.qq\.com/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
