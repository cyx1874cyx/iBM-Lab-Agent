/**
 * Unit: 可信用户动作端点（rc.4 review §5.2）——路线锁定唯一通道。
 * 覆盖：非 POST/跨站/缺意图 header 拒绝；有效 user 动作调 lockRoute(by:"user")
 * 通过；服务端门禁阻断转 409+blockers；服务错误转 500；不读取/信任请求体身份。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LabUserActionService } from "../../lib/user-action.js";

/** 极简 http req mock（支持 async body 读取）。 */
function mockReq({ method = "POST", path = "/api/lab-user-action/lock-route", headers = {}, body = {} } = {}) {
	const raw = JSON.stringify(body);
	let consumed = false;
	return {
		method,
		url: path,
		headers,
		[Symbol.asyncIterator]() {
			return {
				next: () => (consumed ? Promise.resolve({ done: true }) : ((consumed = true), Promise.resolve({ done: false, value: raw })))
			};
		}
	};
}

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
	const service = Object.create(LabUserActionService.prototype);
	service.ctx = ctx;
	service.config = {};
	return service;
}

const route = { id: "rt-1", name: "锁定目标", locked: true, lockedBy: "user", steps: [] };

test("user-action: non-POST rejected with 405", async () => {
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: {} }).handle(mockReq({ method: "GET" }), res);
	assert.equal(state.status, 405);
});

test("user-action: cross-site request denied with 403", async () => {
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: {} }).handle(mockReq({ headers: { "sec-fetch-site": "cross-site", "x-lab-user-action": "lock-route" } }), res);
	assert.equal(state.status, 403);
	assert.match(state.body, /cross-site user action denied/);
});

test("user-action: missing intent header rejected with 400", async () => {
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: {} }).handle(mockReq({ headers: {} }), res);
	assert.equal(state.status, 400);
	assert.match(state.body, /x-lab-user-action/);
});

test("user-action: unknown path rejected with 404", async () => {
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: {} }).handle(mockReq({ path: "/api/lab-user-action/other", headers: { "x-lab-user-action": "lock-route" } }), res);
	assert.equal(state.status, 404);
});

test("user-action: missing routeId rejected with 400", async () => {
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: {} }).handle(mockReq({ body: {}, headers: { "x-lab-user-action": "lock-route" } }), res);
	assert.equal(state.status, 400);
	assert.match(state.body, /routeId/);
});

test("user-action: valid user action locks via lockRoute(by=user); request body identity never trusted", async () => {
	let lockedBy = null;
	const synth = {
		async lockRoute(id, { by }) {
			lockedBy = by;
			return { ...route, id };
		}
	};
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle(mockReq({
		body: { routeId: "rt-1", by: "agent", actor: { kind: "agent" } }, // 请求体夹带伪造身份
		headers: { "x-lab-user-action": "lock-route" }
	}), res);
	assert.equal(state.status, 200);
	assert.equal(lockedBy, "user", "服务端固定以可信 user 主体锁定，不读请求体 by/actor");
	const parsed = JSON.parse(state.body);
	assert.equal(parsed.ok, true);
	assert.equal(parsed.route.id, "rt-1");
	assert.deepEqual(parsed.blockers, []);
});

test("user-action: service-side lock gate blockers surface as 409 with structured reasons", async () => {
	const synth = {
		async lockRoute() {
			const error = new Error("route lock blocked: 1 条事实仍待人工审核");
			error.code = "ROUTE_LOCK_BLOCKED";
			error.blockers = [{ code: "pending-evidence", message: "1 条事实仍待人工审核（确认/修正/无法确认）", evidenceIds: ["ev-1"], stepIds: ["s1"] }];
			throw error;
		}
	};
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle(mockReq({ body: { routeId: "rt-1" }, headers: { "x-lab-user-action": "lock-route" } }), res);
	assert.equal(state.status, 409);
	const parsed = JSON.parse(state.body);
	assert.equal(parsed.ok, false);
	assert.equal(parsed.blockers[0].code, "pending-evidence");
});

test("user-action: unexpected service error yields 500", async () => {
	const synth = { async lockRoute() { throw new Error("boom"); } };
	const { res, state } = mockRes();
	await serviceWith({ labSynthesis: synth }).handle(mockReq({ body: { routeId: "rt-1" }, headers: { "x-lab-user-action": "lock-route" } }), res);
	assert.equal(state.status, 500);
	assert.match(state.body, /boom/);
});
