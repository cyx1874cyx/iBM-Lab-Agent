import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { LabCaptureService } from "../../lib/manual-capture.js";

const source = () => readFile(new URL("../../desktop/src-tauri/src/webvpn.rs", import.meta.url), "utf8");

test("Agent 页面脚本可解析且只含候选入口，不读取认证资料", async () => {
	const rust = await source();
	for (const name of ["AGENT_OBSERVE_SCRIPT", "AGENT_CLICK_SCRIPT"]) {
		const script = rust.match(new RegExp('const ' + name + ': &str = r#"([\\s\\S]*?)"#;'))?.[1];
		assert.ok(script, name + " missing");
		const runnable = script.replaceAll("__OBSERVATION_ID__", '"sample"').replaceAll("__ELEMENT_ID__", '"e1"');
		assert.doesNotThrow(() => new Function(runnable));
	}
	const observation = rust.match(/const AGENT_OBSERVE_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1];
	assert.doesNotMatch(observation, /document\.body\.innerText|document\.cookie|localStorage|sessionStorage/);
	assert.match(observation, /found\.slice\(0, 30\)/);
});

test("浏览器动作只接受当前课题的活动 Agent 捕获任务", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map();
	service.getTask = (id) => id === "capture-1"
		? { id, projectId: "p1", requestedBy: "agent", status: "armed" } : null;
	service.getDesktopWebVpnStatus = () => ({ stale: false, pendingTaskId: "capture-1" });
	assert.throws(() => service.createBrowserOperation({
		projectId: "p2", taskId: "capture-1", action: "observe"
	}), /当前课题/);
	const created = service.createBrowserOperation({
		projectId: "p1", taskId: "capture-1", action: "observe"
	});
	assert.equal(created.status, "queued");
	assert.throws(() => service.createBrowserOperation({
		projectId: "p1", taskId: "capture-1", action: "click", observationId: "abcdefgh", elementId: "e1"
	}), /尚未结束/);
	const claimed = service.claimBrowserOperation("p1");
	assert.equal(claimed.id, created.id);
	assert.equal(service.claimBrowserOperation("p1"), null);
	service.completeBrowserOperation({ projectId: "p1", id: created.id, result: { candidates: [] } });
	assert.equal(service.getBrowserOperation(created.id, "p1").status, "completed");
	assert.equal(service.getBrowserOperation(created.id, "p2"), null);
	const stale = service.createBrowserOperation({
		projectId: "p1", taskId: "capture-1", action: "observe"
	});
	service.browserOperations.get(stale.id).expiresAt = Date.now() - 1;
	const retry = service.createBrowserOperation({
		projectId: "p1", taskId: "capture-1", action: "observe"
	});
	assert.equal(retry.status, "queued");
	assert.equal(service.getBrowserOperation(stale.id, "p1").status, "failed");
});

test("scope 与受限 Science 导航参数从队列完整传给桌面壳", () => {
	const service = Object.create(LabCaptureService.prototype);
	service.browserOperations = new Map();
	service.getTask = () => ({ id: "capture-1", projectId: "p1", kind: "pdf", requestedBy: "agent", status: "armed", publisherUrl: "https://doi.org/10.1126/science.adz5300" });
	service.getDesktopWebVpnStatus = () => ({ stale: false, pendingTaskId: "capture-1", pageSeq: 14, pageUrl: "https://www.science.org/doi/epdf/10.1126/science.adz5300" });
	const observed = service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "observe", scope: "all" });
	assert.equal(service.claimBrowserOperation("p1").scope, "all");
	service.completeBrowserOperation({ projectId: "p1", id: observed.id, result: { candidates: [] } });
	assert.throws(() => service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "navigate", routeId: "science-pdf", expectedPageSeq: 13 }), /失效/);
	const navigation = service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "navigate", routeId: "science-pdf", expectedPageSeq: 14 });
	const claimed = service.claimBrowserOperation("p1");
	assert.deepEqual({ routeId: claimed.routeId, expectedPageSeq: claimed.expectedPageSeq }, { routeId: "science-pdf", expectedPageSeq: 14 });
	service.completeBrowserOperation({ projectId: "p1", id: navigation.id, result: { navigated: true } });
	service.getDesktopWebVpnStatus = () => ({ stale: false, pendingTaskId: "capture-1", pageSeq: 15, pageUrl: "https://www.science.org/doi/epdf/10.1126/science.other" });
	assert.throws(() => service.createBrowserOperation({ projectId: "p1", taskId: "capture-1", action: "navigate", routeId: "science-pdf", expectedPageSeq: 15 }), /不支持/);
});

test("scope=all 的页面观察能看到同源 iframe 内的下载按钮", async () => {
	const rust = await source();
	const script = rust.match(/const AGENT_OBSERVE_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1]
		.replace("__OBSERVE_SCOPE__", "'all'");
	const button = {
		tagName: "BUTTON", innerText: "Download PDF", textContent: "Download PDF", shadowRoot: null,
		getBoundingClientRect: () => ({ width: 80, height: 20 }),
		getAttribute: () => null, closest: () => null, hasAttribute: () => false
	};
	const frameDocument = { querySelectorAll: (selector) => selector === "*" ? [] : [button] };
	const frame = { shadowRoot: null, matches: () => true, contentDocument: frameDocument };
	const document = {
		querySelector: () => null,
		querySelectorAll: (selector) => selector === "*" ? [frame] : [],
		contentType: "text/html", readyState: "complete", title: "Science",
		body: { innerText: "Article" }, documentElement: { scrollHeight: 100 }
	};
	const location = { href: "https://www.science.org/doi/10.1126/science.adz5300", hostname: "www.science.org" };
	const result = runInNewContext(script, {
		document, location, window: { scrollY: 0 },
		getComputedStyle: () => ({ display: "block", visibility: "visible" }),
		crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000001" }, URL
	});
	assert.equal(result.candidates.length, 1);
	assert.equal(result.candidates[0].label, "Download PDF");
});

test("Nature 长页面不会让导航和作者链接占满前 30 个候选", async () => {
	const rust = await source();
	const script = rust.match(/const AGENT_OBSERVE_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1]
		.replace("__OBSERVE_SCOPE__", "'all'");
	const link = (label, href, top) => ({
		tagName: "A", innerText: label, textContent: label, shadowRoot: null,
		getBoundingClientRect: () => ({ width: 120, height: 20, top, left: 20 }),
		getAttribute: (name) => name === "href" ? href : null,
		closest: () => null, hasAttribute: () => false
	});
	const authors = Array.from({ length: 35 }, (_, index) => link(`Author ${index}`, `/authors/${index}`, -100000));
	const supplement = link("Supplementary information", "https://media.springernature.com/full/springer-static/41586_2026_11032_MOESM1_ESM.pdf", 120);
	const document = {
		querySelector: () => null,
		querySelectorAll: (selector) => selector === "*" ? [] : [...authors, supplement],
		contentType: "text/html", readyState: "complete", title: "Nature article",
		body: { innerText: "Article with many authors" }, documentElement: { scrollHeight: 105000 }
	};
	const result = runInNewContext(script, {
		document, location: { href: "https://www.nature.com/articles/s41586-026-11032", hostname: "www.nature.com" },
		window: { scrollY: 103435, innerWidth: 1280, innerHeight: 800 },
		getComputedStyle: () => ({ display: "block", visibility: "visible" }),
		crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000002" }, URL
	});
	assert.equal(result.candidateCount, 36);
	assert.equal(result.truncated, true);
	assert.equal(result.candidates[0].label, "Supplementary information");
	assert.equal(result.candidates[0].inViewport, true);
	assert.equal(result.candidates[0].likely, "si");
});
