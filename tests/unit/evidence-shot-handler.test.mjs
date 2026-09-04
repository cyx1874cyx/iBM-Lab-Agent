/**
 * Unit: evidence-shot HTTP handler 错误路径（0.3.2 原文截图端点）。
 * 覆盖：参数白名单、证据缺失/路线不匹配、缺 bundleId/页码的 422、跨站拒绝。
 * 真实渲染（python/fitz）不在此跑（需要真实 PDF/PyMuPDF，部署环境验证）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LabEvidenceShotService } from "../../lib/evidence-shot.js";

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
		getRoute: () => ({ id: "rt-1" })
	};
	const tasks = { bundleFile: async () => { throw new Error("no pdf file"); } };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth, labTasks: tasks }).handle({ method: "GET", url: "/api/lab-evidence-shot?routeId=rt-1&evidenceId=ev-1", headers: {} }, res);
	assert.equal(state.status, 404);
	assert.match(state.body, /原文未归档或不可读/);
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
