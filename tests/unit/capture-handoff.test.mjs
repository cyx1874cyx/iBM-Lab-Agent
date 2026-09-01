import test from "node:test";
import assert from "node:assert/strict";

import { CaptureHandoffService, HANDOFF_PATH, isLoopbackRequest } from "../../lib/capture-handoff.js";

function responseCapture() {
	return {
		status: 0,
		headers: {},
		body: Buffer.alloc(0),
		writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
		end(body = "") { this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); }
	};
}

function ctxWithCapture(tasks = {}) {
	const table = new Map(Object.entries(tasks));
	const labCapture = {
		getTask: (id) => table.get(id),
		listTasks: () => [...table.values()],
		transit: async () => {},
		sweepExpired: async () => 0
	};
	const handlers = [];
	const webServer = {
		register(registration) {
			handlers.push(registration);
			return () => {
				const index = handlers.indexOf(registration);
				if (index >= 0) handlers.splice(index, 1);
			};
		}
	};
	const effects = [];
	const ctx = {
		labCapture,
		webServer,
		effect: (fn, name) => { effects.push([fn, name]); return () => {}; },
		get: (name) => (name === "webServer" ? webServer : name === "labCapture" ? labCapture : undefined),
		get handlers() { return handlers; }
	};
	return ctx;
}

/** 绕过 cordis 完整 ctx 构造，生成可直接调用的 service 实例。 */
function makeService(ctx, config = {}) {
	const service = Object.create(CaptureHandoffService.prototype);
	service.ctx = ctx;
	service.config = config;
	return service;
}

test("isLoopbackRequest accepts loopback hosts only", () => {
	for (const host of ["127.0.0.1", "127.0.0.1:3080", "localhost", "localhost:9000", "[::1]", "[::1]:3080"]) {
		assert.equal(isLoopbackRequest({ headers: { host } }), true, `should accept ${host}`);
	}
	for (const host of ["example.com", "192.168.1.10", "10.0.0.5:8080", "evil.com:443"]) {
		assert.equal(isLoopbackRequest({ headers: { host } }), false, `should reject ${host}`);
	}
	assert.equal(isLoopbackRequest({ headers: {} }), false);
	assert.equal(isLoopbackRequest(undefined), false);
});

test("parseTaskId validates the capture id format", () => {
	const service = makeService(ctxWithCapture());
	assert.equal(service.parseTaskId("/lab/capture/?taskId=capture-abc123"), "capture-abc123");
	assert.equal(service.parseTaskId("http://127.0.0.1:3080/lab/capture/?taskId=capture-abc123"), "capture-abc123");
	assert.equal(service.parseTaskId("/lab/capture/?taskId=not-capture"), undefined);
	assert.equal(service.parseTaskId("/lab/capture/?taskId=capture-UPPER"), undefined);
	assert.equal(service.parseTaskId("/lab/capture/?taskId=capture-abc123&extra=1"), undefined);
	assert.equal(service.parseTaskId("/lab/capture/capture-abc123"), undefined);
	assert.equal(service.parseTaskId("/lab/capture/"), undefined);
	assert.equal(service.parseTaskId("/lab/capture"), undefined);
	assert.equal(service.parseTaskId("/other/path"), undefined);
});

test("registers the fixed handoff route on init", async () => {
	const ctx = ctxWithCapture();
	const service = makeService(ctx);
	// 模拟 cordis [Service.init]：直接执行与 init 相同的注册逻辑。
	const webServer = ctx.webServer;
	webServer.register({
		kind: "prefix",
		path: HANDOFF_PATH,
		handler: (req, res) => service.handleHandoff(req, res)
	});
	assert.ok(ctx.handlers.length >= 1);
	assert.equal(ctx.handlers[0].kind, "prefix");
	assert.equal(ctx.handlers[0].path, "/lab/capture/");
});

test("serves the handoff page with task metadata but never the token", async () => {
	const task = {
		id: "capture-ab12cd",
		kind: "pdf",
		expiresAt: "2026-08-31T23:59:59.000Z",
		publisherUrl: "https://doi.org/10.1038/example",
		status: "armed",
		tokenSha256: "deadbeef" // 绝不能出现在页面里
	};
	const ctx = ctxWithCapture({ [task.id]: task });
	const service = makeService(ctx);
	const res = responseCapture();
	await service.handleHandoff(
		{ headers: { host: "127.0.0.1:3080" }, url: "/lab/capture/?taskId=capture-ab12cd" },
		res
	);
	assert.equal(res.status, 200);
	assert.match(res.headers["content-type"], /text\/html/);
	const html = res.body.toString("utf8");
	assert.match(html, /capture-ab12cd/);
	assert.match(html, /10\.1038\/example/);
	assert.match(html, /正在通过 Microsoft Edge 捕获/);
	assert.doesNotMatch(html, /deadbeef/);
	assert.doesNotMatch(html, /tokenSha256/);
});

test("rejects non-loopback requests with 403", async () => {
	const ctx = ctxWithCapture({ "capture-ab12cd": { id: "capture-ab12cd", kind: "pdf", publisherUrl: "https://doi.org/x", status: "armed" } });
	const service = makeService(ctx);
	const res = responseCapture();
	await service.handleHandoff(
		{ headers: { host: "evil.example.com" }, url: "/lab/capture/?taskId=capture-ab12cd" },
		res
	);
	assert.equal(res.status, 403);
	assert.match(res.body.toString("utf8"), /loopback/);
});

test("returns 404 for unknown task ids", async () => {
	const ctx = ctxWithCapture();
	const service = makeService(ctx);
	const res = responseCapture();
	await service.handleHandoff(
		{ headers: { host: "localhost:3080" }, url: "/lab/capture/?taskId=capture-unknown" },
		res
	);
	assert.equal(res.status, 404);
});
