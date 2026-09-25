import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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
	assert.match(observation, /rows\.length >= 30/);
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
});
