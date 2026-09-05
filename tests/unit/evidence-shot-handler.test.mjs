/**
 * Unit: evidence-shot HTTP handler 错误路径（0.3.2 原文截图端点）。
 * 覆盖：参数白名单、证据缺失/路线不匹配、缺 bundleId/页码的 422、跨站拒绝；
 * rc.4 review：ready 登记先于 PNG 响应（§8）、登记失败转 5xx、子进程超时
 * 与进程树终止（§11）。真实渲染（python/fitz）不在此跑（部署环境验证）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceShotCacheName, killPythonTree, LabEvidenceShotService, renderPageToPng } from "../../lib/evidence-shot.js";

/** 极简 http res mock：收集 status/body。 */
function mockRes() {
	const state = { status: 0, body: "", headers: {} };
	const res = {
		writeHead(status, headers = {}) {
			state.status = status;
			state.headers = headers;
			return res;
		},
		end(body) {
			state.body = String(body);
			return res;
		}
	};
	return { res, state };
}

function serviceWith(ctx) {
	const service = Object.create(LabEvidenceShotService.prototype);
	service.ctx = { ...ctx, get: () => undefined };
	service.config = {};
	return service;
}

const evidenceRow = {
	id: "ev-1", routeId: "rt-1", supportsField: "procedure.temperature",
	sourceType: "paper-si", sourceTier: 1, sourceName: "SI", page: "12",
	bundleId: "bundle-1", excerpt: "heated at 70 °C", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
};

test("evidence-shot rejects missing evidence id", async () => {
	const synth = { evidenceById: () => null };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=missing", headers: {} }, res);
	assert.equal(state.status, 404);
	assert.match(state.body, /evidence not found/);
});

test("evidence-shot rejects evidence of another route", async () => {
	const synth = { evidenceById: () => ({ ...evidenceRow, routeId: "rt-other" }) };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 404);
	assert.match(state.body, /evidence not found for route/);
});

test("evidence-shot 422 when no bundleId/page", async () => {
	const synth = {
		evidenceById: () => ({ ...evidenceRow, bundleId: undefined, documentId: undefined }),
		getRoute: () => ({ id: "rt-1", projectId: "p1" })
	};
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 422);
	assert.match(state.body, /缺少 bundleId\/documentId 或页码/);
});

test("evidence-shot 422 when page unparseable", async () => {
	const synth = {
		evidenceById: () => ({ ...evidenceRow, bundleId: "bundle-1", page: "figure only" }),
		getRoute: () => ({ id: "rt-1" })
	};
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 422);
});

test("evidence-shot rejects invalid ids with 400", async () => {
	const synth = { evidenceById: () => null };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=bad%2Fid&evidenceId=../x", headers: {} }, res);
	assert.equal(state.status, 400);
});

test("evidence-shot 404 when bundle file unavailable (not captured)", async () => {
	const synth = {
		evidenceById: () => evidenceRow,
		getRoute: () => ({ id: "rt-1" }),
		registerEvidenceShotVerification: async () => {}
	};
	const tasks = { bundleFile: async () => { throw new Error("no pdf file"); } };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth, labTasks: tasks }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 404);
	assert.match(state.body, /原文未归档或不可读/);
});

test("evidence-shot records failed verification when original is missing (0.4.0-rc.4 §5)", async () => {
	let recorded = null;
	const synth = {
		evidenceById: () => evidenceRow,
		getRoute: () => ({ id: "rt-1" }),
		registerEvidenceShotVerification: async (evidenceId, shot) => { recorded = { evidenceId, shot }; }
	};
	const tasks = { bundleFile: async () => { throw new Error("no pdf file"); } };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth, labTasks: tasks }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 404);
	assert.equal(recorded.evidenceId, "ev-1");
	assert.equal(recorded.shot.status, "failed");
	assert.match(recorded.shot.error, /原文未归档或不可读/);
	assert.equal(recorded.shot.page, 12, "页码经 pageNumberFrom 规范化为数字");
});

test("evidence-shot records failed when evidence has no original location (0.4.0-rc.4 §5)", async () => {
	let recorded = null;
	const synth = {
		evidenceById: () => ({ ...evidenceRow, bundleId: undefined, documentId: undefined }),
		getRoute: () => ({ id: "rt-1" }),
		registerEvidenceShotVerification: async (evidenceId, shot) => { recorded = { evidenceId, shot }; }
	};
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 422);
	assert.equal(recorded.shot.status, "failed");
	assert.match(recorded.shot.error, /缺少 bundleId\/documentId 或页码/);
});

test("evidence-shot denies cross-site with 403", async () => {
	const synth = { evidenceById: () => evidenceRow };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle({
		method: "GET",
		url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1",
		headers: { "sec-fetch-site": "cross-site" }
	}, res);
	assert.equal(state.status, 403);
});

test("evidence-shot cache key accepts decimal bbox/zoom and separates locations/document kinds", () => {
	const common = { bundleId: "bundle-1", sourceDigest: "abcdef0123456789", page: 12 };
	const a = evidenceShotCacheName({ ...common, kind: "si", bbox: [1.25, 2.5, 30.75, 40.125], zoom: 2.5 });
	const b = evidenceShotCacheName({ ...common, kind: "si", bbox: [1.5, 2.5, 30.75, 40.125], zoom: 2.5 });
	const c = evidenceShotCacheName({ ...common, kind: "pdf", bbox: [1.25, 2.5, 30.75, 40.125], zoom: 2.5 });
	assert.match(a, /^[A-Za-z0-9_-]+\.png$/);
	assert.notEqual(a, b, "不同 bbox 不得共用缓存");
	assert.notEqual(a, c, "正文与 SI 不得共用缓存");
});

test("paper-si evidence renders the SI bundle by default", async () => {
	let requestedKind;
	const pdfBytes = Buffer.from("si bytes");
	const sha = createHash("sha256").update(pdfBytes).digest("hex").slice(0, 16);
	const cacheDir = join(tmpdir(), `evidence-shot-kind-${process.pid}`);
	await mkdir(cacheDir, { recursive: true });
	await writeFile(join(cacheDir, evidenceShotCacheName({ bundleId: "bundle-1", sourceDigest: sha, kind: "si", page: 12, zoom: 2 })), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	const synth = {
		evidenceById: () => evidenceRow,
		getRoute: () => ({ id: "rt-1" }),
		evidenceDocumentKind: () => "si",
		registerEvidenceShotVerification: async () => {}
	};
	const tasks = { bundleFile: async (_id, kind) => { requestedKind = kind; return { buffer: pdfBytes }; } };
	const service = Object.create(LabEvidenceShotService.prototype);
	service.ctx = { labSynthesis: synth, labTasks: tasks, get: () => undefined };
	service.config = { cacheDir };
	const { res, state } = mockRes();
	await service.handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 200);
	assert.equal(requestedKind, "si");
	await rm(cacheDir, { recursive: true, force: true });
});

test("rc.4 review §8: ready registration must complete BEFORE png response; registration failure yields 5xx not 200", async () => {
	const order = [];
	const synth = {
		evidenceById: () => evidenceRow,
		getRoute: () => ({ id: "rt-1" }),
		registerEvidenceShotVerification: async (evidenceId, shot) => { order.push(`register:${shot.status}`); }
	};
	const pdfBytes = Buffer.from("fake pdf bytes for §8 order test");
	const tasks = { bundleFile: async () => ({ buffer: pdfBytes }) };
	const cacheDir = join(tmpdir(), `evidence-shot-order-${process.pid}`);
	await mkdir(cacheDir, { recursive: true });
	// 预置缓存文件 → 命中缓存路径（不经真实 python），验证 ready 登记先于响应
	const sha = createHash("sha256").update(pdfBytes).digest("hex").slice(0, 16);
	await writeFile(join(cacheDir, evidenceShotCacheName({ bundleId: "bundle-1", sourceDigest: sha, kind: "si", page: 12, zoom: 2 })), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	const service = Object.create(LabEvidenceShotService.prototype);
	service.ctx = { labSynthesis: synth, labTasks: tasks, get: () => undefined };
	service.config = { cacheDir };
	const { res, state } = mockRes();
	await service.handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 200, "缓存命中返回 PNG");
	assert.deepEqual(order, ["register:ready"], "ready 登记在 PNG 响应前 await 完成且仅一次");
	await rm(cacheDir, { recursive: true, force: true });

	// 登记抛错 → 不得伪装核验成功：返回 5xx，不是 200 图片
	const synth2 = {
		evidenceById: () => evidenceRow,
		getRoute: () => ({ id: "rt-1" }),
		registerEvidenceShotVerification: async () => { throw new Error("storage down"); }
	};
	const service2 = Object.create(LabEvidenceShotService.prototype);
	service2.ctx = { labSynthesis: synth2, labTasks: tasks, get: () => undefined };
	service2.config = { cacheDir: join(tmpdir(), `evidence-shot-fail-${process.pid}`) };
	const { res: res2, state: state2 } = mockRes();
	await service2.handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res2);
	assert.ok(state2.status >= 500, `登记失败必须 5xx（实际 ${state2.status}）`);
});

test("rc.4 review §11: render subprocess times out and temp files cleaned", async () => {
	// pythonCommand 用 node 自身模拟“卡死渲染进程”（sleep 10s），timeout 500ms
	const [cmd, ...cmdArgs] = [process.execPath, "-e", "setTimeout(()=>{}, 10000)"];
	const workDir = join(tmpdir(), `evidence-shot-timeout-${process.pid}`);
	await assert.rejects(
		() => renderPageToPng({
			pdfBuffer: Buffer.from("fake pdf"), page: 3, zoom: 1, pythonCommand: [cmd, ...cmdArgs],
			workDir, timeoutMs: 500
		}),
		/timed out after 500ms/,
		"渲染子进程超时必须拒绝（不无限等待）"
	);
	// 临时 PDF/PNG 已清理
	const leftovers = await readdir(workDir).catch(() => []);
	assert.equal(leftovers.filter((name) => name.endsWith(".pdf") || name.endsWith(".png")).length, 0, "超时后临时文件被清理");
	await rm(workDir, { recursive: true, force: true });
});

test("rc.4 review §11: killPythonTree terminates the whole child process", async () => {
	const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore", windowsHide: true });
	const exited = new Promise((resolvePromise) => child.on("exit", resolvePromise));
	killPythonTree(child);
	const outcome = await Promise.race([exited.then(() => "exited"), new Promise((resolvePromise) => setTimeout(() => resolvePromise("still-running"), 3000))]);
	assert.equal(outcome, "exited", "killPythonTree 必须终止子进程");
});
