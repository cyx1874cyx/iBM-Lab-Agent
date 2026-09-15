import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../../lib/tasks-tool.js";

function hasUndefinedValue(value) {
	if (Array.isArray(value)) return value.some(hasUndefinedValue);
	if (value !== null && typeof value === "object") {
		return Object.values(value).some((child) => child === undefined || hasUndefinedValue(child));
	}
	return false;
}

function doiTool(resolveWechatPaperDoi) {
	const registered = [];
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: {
			getProject: () => ({ id: "proj-test" }),
			resolveWechatPaperDoi
		}
	});
	const tool = registered.find((item) => item.name === "lab_tasks_resolve_wechat_doi");
	assert.ok(tool);
	return tool;
}

test("lab_tasks_resolve_wechat_doi returns lossless JSON when optional metadata is absent", async () => {
	const tool = doiTool(async () => ({
		title: "TRI-611, a selective molecular glue degrader of ALK",
		candidates: [{
			doi: "10.1038/s41586-026-10998-3",
			title: "TRI-611, a selective molecular glue degrader of ALK",
			authors: [],
			volume: undefined,
			issue: undefined,
			pages: undefined,
			yearMatch: undefined,
			confidence: "high",
			titleScore: 1,
			matchedAuthors: []
		}]
	}));
	const output = await tool.execute({ projectId: "proj-test", title: "TRI-611" }, {});
	assert.equal(output.ok, true);
	assert.equal(hasUndefinedValue(output), false);
	assert.deepEqual(Object.keys(output.candidates[0]).sort(), ["authors", "confidence", "doi", "matchedAuthors", "title", "titleScore"].sort());
});

test("lab_tasks_resolve_wechat_doi reports an empty-candidate error as normal JSON", async () => {
	const tool = doiTool(async () => { throw new Error("no DOI candidate passed verification for TRI-611"); });
	const output = await tool.execute({ projectId: "proj-test", title: "TRI-611" }, {});
	assert.deepEqual(output, { ok: false, error: "no DOI candidate passed verification for TRI-611" });
});

test("lab_nature_browser_download queues an existing Nature bundle without exposing a token", async () => {
	const registered = [];
	let request;
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: {
			getProject: () => ({ id: "proj-test" }),
			getBundle: (id) => id === "bundle-nature" ? { id, projectId: "proj-test", doi: "10.1038/s41551-023-01022-4" } : undefined
		},
		labCapture: {
			getDesktopWebVpnStatus: () => ({ state: "closed", ready: false, iwanReady: false, stale: false }),
			createAgentCaptureTask: async (value) => {
				request = value;
				return { id: "capture-agent123", bundleId: value.bundleId, kind: value.kind, token: "must-not-leak" };
			}
		}
	});
	const tool = registered.find((item) => item.name === "lab_nature_browser_download");
	assert.ok(tool);
	const output = await tool.execute({ projectId: "proj-test", bundleId: "bundle-nature", kind: "si" }, {});
	assert.deepEqual(request, { projectId: "proj-test", bundleId: "bundle-nature", kind: "si" });
	assert.deepEqual(output, { ok: true, taskId: "capture-agent123", bundleId: "bundle-nature", kind: "si", publisher: "Nature Portfolio", status: "queued", accessMode: "direct" });
	assert.equal(JSON.stringify(output).includes("must-not-leak"), false);
});

test("generic publisher download applies VPN and direct-SI rules", async () => {
	const registered = [];
	let bundle = { id: "bundle-publisher", projectId: "proj-test", doi: "10.1016/j.example.2026.1" };
	let loginRequested = false;
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: { getProject: () => ({ id: "proj-test" }), getBundle: () => bundle },
		labCapture: {
			getDesktopWebVpnStatus: () => ({ state: "closed", ready: false, stale: false }),
			requestDesktopWebVpnLogin: () => { loginRequested = true; },
			createAgentCaptureTask: async (value) => ({ id: "capture-generic", ...value })
		}
	});
	const tool = registered.find((item) => item.name === "lab_publisher_browser_download");
	assert.ok(tool);
	assert.ok(registered.find((item) => item.name === "lab_publisher_browser_download_status"));
	const elsevierSi = await tool.execute({ projectId: "proj-test", bundleId: bundle.id, kind: "si" }, {});
	assert.equal(elsevierSi.requiresUserAction, true);
	assert.equal(elsevierSi.publisher, "Elsevier");
	assert.equal(loginRequested, true);
	bundle = { ...bundle, doi: "10.1007/s00125-026-01234-5" };
	const springerSi = await tool.execute({ projectId: "proj-test", bundleId: bundle.id, kind: "si" }, {});
	assert.equal(springerSi.status, "queued");
	assert.equal(springerSi.publisher, "SpringerLink");
	bundle = { ...bundle, doi: "10.1002/example.1" };
	const wiley = await tool.execute({ projectId: "proj-test", bundleId: bundle.id, kind: "pdf" }, {});
	assert.equal(wiley.ok, false);
	assert.match(wiley.error, /Wiley.*iWAN/);
	bundle = { ...bundle, doi: "10.1109/example.1" };
	const iwanRegistered = [];
	apply({
		tools: { register: (registeredTool) => iwanRegistered.push(registeredTool) },
		labTasks: { getProject: () => ({ id: "proj-test" }), getBundle: () => bundle },
		labCapture: {
			getDesktopWebVpnStatus: () => ({ state: "closed", ready: false, stale: false, iwanReady: true }),
			createAgentCaptureTask: async (value) => ({ id: "capture-iwan", ...value })
		}
	});
	const iwanTool = iwanRegistered.find((item) => item.name === "lab_publisher_browser_download");
	const iwanDownload = await iwanTool.execute({ projectId: "proj-test", bundleId: bundle.id, kind: "pdf" }, {});
	assert.equal(iwanDownload.status, "queued");
	assert.equal(iwanDownload.accessMode, "iwan");
});

test("Nature main PDF is not queued until the desktop WebVPN session is ready", async () => {
	const registered = [];
	let createCalls = 0;
	let loginRequest;
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: {
			getProject: () => ({ id: "proj-test" }),
			getBundle: () => ({ id: "bundle-nature", projectId: "proj-test", doi: "10.1038/s41551-023-01022-4" })
		},
		labCapture: {
			getDesktopWebVpnStatus: () => ({ state: "closed", ready: false, stale: false }),
			requestDesktopWebVpnLogin: (projectId) => { loginRequest = projectId; },
			createAgentCaptureTask: async () => { createCalls += 1; }
		}
	});
	const tool = registered.find((item) => item.name === "lab_nature_browser_download");
	const output = await tool.execute({ projectId: "proj-test", bundleId: "bundle-nature", kind: "pdf" }, {});
	assert.equal(output.ok, true);
	assert.equal(output.status, "webvpn-login-required");
	assert.equal(output.requiresUserAction, true);
	assert.match(output.question, /右侧.*WebVPN.*我已登录/);
	assert.equal(loginRequest, "proj-test");
	assert.equal(createCalls, 0);
});

test("Nature main PDF continues only after the user confirms WebVPN login", async () => {
	const registered = [];
	let request;
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: {
			getProject: () => ({ id: "proj-test" }),
			getBundle: () => ({ id: "bundle-nature", projectId: "proj-test", doi: "10.1038/s41551-023-01022-4" })
		},
		labCapture: {
			getDesktopWebVpnStatus: () => ({ state: "waiting-login", ready: false, stale: false, windowOpen: true }),
			createAgentCaptureTask: async (value) => {
				request = value;
				return { id: "capture-confirmed", bundleId: value.bundleId, kind: value.kind };
			}
		}
	});
	const tool = registered.find((item) => item.name === "lab_nature_browser_download");
	const output = await tool.execute({ projectId: "proj-test", bundleId: "bundle-nature", kind: "pdf", loginConfirmed: true }, {});
	assert.deepEqual(request, { projectId: "proj-test", bundleId: "bundle-nature", kind: "pdf", loginConfirmedByUser: true });
	assert.equal(output.taskId, "capture-confirmed");
});

test("Nature browser download status exposes progress without raw storage access", async () => {
	const registered = [];
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: { getProject: () => ({ id: "proj-test" }) },
		labCapture: {
			sweepExpired: async () => {},
			getTask: () => ({ id: "capture-agent123", projectId: "proj-test", bundleId: "bundle-nature", kind: "pdf", status: "armed", updatedAt: "2026-09-13T00:00:00.000Z" }),
			listTasks: () => [
				{ id: "capture-older", projectId: "proj-test", requestedBy: "agent", status: "armed", createdAt: "2026-09-12T00:00:00.000Z" },
				{ id: "capture-agent123", projectId: "proj-test", requestedBy: "agent", status: "armed", createdAt: "2026-09-13T00:00:00.000Z" }
			],
			getDesktopWebVpnStatus: () => ({ state: "downloading", stale: false, pendingTaskId: "capture-agent123", downloadedBytes: 4096 })
		}
	});
	const tool = registered.find((item) => item.name === "lab_nature_browser_download_status");
	assert.ok(tool);
	const output = await tool.execute({ projectId: "proj-test", taskId: "capture-agent123" }, {});
	assert.equal(output.ok, true);
	assert.equal(output.phase, "downloading");
	assert.equal(output.downloadedBytes, 4096);
	assert.equal(output.queuePosition, 2);
	assert.match(output.message, /正在下载/);
	assert.equal(Object.hasOwn(output, "tokenSha256"), false);
});
