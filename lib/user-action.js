/**
 * dsh-lab-agent: 可信用户动作端点（rc.4 review §5.2）。
 *
 * 路线锁定是「只有真实 UI 用户动作可执行」的操作。锁定已从通用 Remote/Agent
 * 网关移出（remote.js 不再暴露 synth_route_lock；Agent 工具注册表无锁定方法），
 * 本服务提供唯一的 loopback user-action 通道：
 *
 *   POST /api/lab-user-action/lock-route
 *     header: x-lab-user-action: lock-route   （意图声明 + CSRF 防护：
 *             跨站表单/图片无法携带自定义 header，同源 fetch 才可附加）
 *     body:   { "routeId": "rt-xxx" }
 *     200 → { ok:true, route, blockers:[] }
 *     409 → { ok:false, route:null, blockers:[...] }（服务端三条件门禁被阻断）
 *
 * 端点同源校验（sec-fetch-site / origin）与 evidence-shot 一致；仅桌面/浏览器
 * 同源页面可达。服务端 labSynthesis.lockRoute 要求显式 actor（by:"user"），
 * 缺省/伪造主体一律拒绝；已锁定版本对非法调用同样拒绝（不借幂等泄露旁路）。
 */

import { Service } from "@deepseek-ai/cordis";

function denyCrossSite(req) {
	const fetchSite = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
	if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return true;
	const origin = req.headers.origin;
	const host = req.headers.host;
	if (!origin || !host) return false;
	try {
		return new URL(String(origin)).host !== String(host);
	} catch {
		return true;
	}
}

function sendJson(res, status, body) {
	const payload = Buffer.from(JSON.stringify(body), "utf8");
	res.writeHead(status, {
		"content-type": "application/json;charset=utf-8",
		"content-length": String(payload.length),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(payload);
}

async function readJsonBody(req, limit = 16 * 1024) {
	let raw = "";
	for await (const chunk of req) {
		raw += chunk;
		if (raw.length > limit) throw new Error("request body too large");
	}
	return JSON.parse(raw || "{}");
}

export class LabUserActionService extends Service {
	static inject = ["labSynthesis", "webServer"];

	constructor(ctx, config = {}) {
		super(ctx, "labUserAction");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const webServer = this.ctx.get?.("webServer") ?? this.ctx.webServer;
		if (webServer?.register) {
			this.ctx.effect(() => webServer.register({
				kind: "prefix",
				path: "/api/lab-user-action",
				handler: (req, res) => void this.handle(req, res)
			}), "lab-agent.user-action");
		}
	}

	async handle(req, res) {
		if (req.method !== "POST") {
			res.writeHead(405, { allow: "POST" });
			res.end("method not allowed");
			return;
		}
		if (denyCrossSite(req)) {
			sendJson(res, 403, { ok: false, error: "cross-site user action denied" });
			return;
		}
		// 意图 header：跨站表单/GET 无法携带，防止误触与非同源伪造
		if (String(req.headers["x-lab-user-action"] ?? "") !== "lock-route") {
			sendJson(res, 400, { ok: false, error: "missing x-lab-user-action intent header" });
			return;
		}
		const url = new URL(req.url ?? "/api/lab-user-action", "http://localhost");
		if (url.pathname !== "/api/lab-user-action/lock-route") {
			sendJson(res, 404, { ok: false, error: "unknown user action" });
			return;
		}
		try {
			const payload = await readJsonBody(req);
			const routeId = String(payload?.routeId ?? "").trim();
			if (!routeId) {
				sendJson(res, 400, { ok: false, error: "routeId required" });
				return;
			}
			const route = await this.ctx.labSynthesis.lockRoute(routeId, { by: "user" });
			sendJson(res, 200, { ok: true, route, blockers: [] });
		} catch (reason) {
			if (reason?.code === "ROUTE_LOCK_BLOCKED") {
				sendJson(res, 409, { ok: false, route: null, blockers: reason.blockers ?? [] });
				return;
			}
			sendJson(res, 500, { ok: false, error: reason?.message || String(reason) });
		}
	}
}

export default LabUserActionService;
