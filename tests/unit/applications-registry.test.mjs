/**
 * 外部应用注册表的单元测试（路线书 3.4）。
 *
 * 原型是 desktop/src-tauri/src/runtime/mcp.rs 的 MCP_APPS 静态表。本测试除了校验
 * JS 表自身，还**直接解析 Rust 源码**做逐项比对：那张 Rust 表才是真正的启动依据
 * （dsh.rs 用它生成 MCP patch），JS 侧只是跨形态的只读视图；两者一旦漂移，
 * 服务端/桌面端对「哪些应用可用、用什么启动」的理解就会分叉，且不会有任何报错。
 *
 * 安全约束（路线书 3.4 验收③）：启动方式必须由代码里的 app_key → launch 映射决定，
 * 不能被用户配置覆盖，否则任意 executable 都可能被 MCP manager 启动。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	APPLICATIONS,
	APPLICATION_LAUNCH_KINDS,
	applicationSpec,
	applicationsFor,
	describeApplications
} from "../../lib/applications/registry.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 从 mcp.rs 解析出 Rust 侧的 MCP_APPS 表（app_key/server_name/requires_directory/module）。 */
function rustApplications() {
	const text = readFileSync(join(repoRoot, "desktop/src-tauri/src/runtime/mcp.rs"), "utf8");
	const start = text.indexOf("pub static MCP_APPS");
	assert.ok(start >= 0, "mcp.rs 中未找到 MCP_APPS");
	const open = text.indexOf("[", start);
	const close = text.indexOf("];", open);
	assert.ok(open >= 0 && close > open, "MCP_APPS 数组结构无法解析");
	const body = text.slice(open, close);
	const chunks = body.split("McpAppSpec {").slice(1);
	assert.ok(chunks.length > 0, "MCP_APPS 中未解析出任何 McpAppSpec");
	return chunks.map((chunk) => {
		const pick = (re, label) => {
			const m = re.exec(chunk);
			assert.ok(m, `McpAppSpec 缺少 ${label}：${chunk.slice(0, 120)}`);
			return m[1];
		};
		return {
			appKey: pick(/app_key:\s*"([^"]+)"/, "app_key"),
			serverName: pick(/server_name:\s*"([^"]+)"/, "server_name"),
			requiresDirectory: pick(/requires_directory:\s*(true|false)/, "requires_directory") === "true",
			module: pick(/module:\s*"([^"]+)"/, "module")
		};
	});
}

test("注册表条目自洽：appKey 唯一、启动方式受支持、描述符冻结", () => {
	const keys = APPLICATIONS.map((spec) => spec.appKey);
	assert.equal(new Set(keys).size, keys.length, "appKey 必须唯一");
	assert.ok(Object.isFrozen(APPLICATIONS), "注册表必须冻结");
	for (const spec of APPLICATIONS) {
		assert.ok(Object.isFrozen(spec), `${spec.appKey} 规格未冻结`);
		assert.ok(Object.isFrozen(spec.launch), `${spec.appKey} 的 launch 未冻结`);
		assert.equal(spec.launch.kind, APPLICATION_LAUNCH_KINDS.BUNDLED_PYTHON_MODULE);
		assert.equal(typeof spec.launch.module, "string");
		assert.ok(spec.launch.module.length > 0);
		assert.ok(Array.isArray(spec.availableOn) && spec.availableOn.length > 0);
	}
});

test("未知 app_key 抛错，不静默返回", () => {
	assert.throws(() => applicationSpec("bogus"), /未知的外部应用/);
	assert.throws(() => applicationSpec(undefined), /未知的外部应用/);
});

// ── 验收①②：形态过滤 ─────────────────────────────────────────────────────

test("验收①：服务端形态不提供 Mnova / Origin", () => {
	const server = applicationsFor("server");
	assert.deepEqual(server, []);
	assert.deepEqual(
		server.map((spec) => spec.appKey),
		[]
	);
	// 人类可读汇总里也必须如实说明不可用，而不是静默省略
	const described = describeApplications({ form: "server" });
	assert.equal(described.form, "server");
	assert.deepEqual(described.available, []);
	assert.deepEqual(described.unavailable.map((a) => a.appKey).sort(), ["mnova", "origin"]);
});

test("验收②：桌面形态行为不变，两个应用都可用", () => {
	const desktop = applicationsFor("desktop");
	assert.deepEqual(desktop.map((spec) => spec.appKey).sort(), ["mnova", "origin"]);
	assert.deepEqual(
		desktop.map((spec) => [spec.serverName, spec.launch.kind, spec.launch.module]),
		[
			["mnova", "bundled-python-module", "mnova_mcp"],
			["origin", "bundled-python-module", "origin_mcp"]
		]
	);
	const described = describeApplications({ form: "desktop" });
	assert.equal(described.unavailable.length, 0);
});

// ── 验收③：启动方式不可被用户配置覆盖 ─────────────────────────────────────

test("验收③：启动方式只由 app_key 决定，额外参数无法改写", () => {
	// 只接受 appKey 一个参数：传入伪造的配置对象/额外实参都不改变结果。
	const forged = { launch: { kind: "arbitrary-executable", module: "../../evil" }, serverName: "evil" };
	assert.equal(applicationSpec("mnova", forged), applicationSpec("mnova"));
	assert.equal(applicationSpec("mnova", forged).launch.kind, APPLICATION_LAUNCH_KINDS.BUNDLED_PYTHON_MODULE);
	assert.equal(applicationSpec("mnova", forged).launch.module, "mnova_mcp");
	assert.equal(applicationSpec("mnova", forged).serverName, "mnova");
	// 注册表本身不可被改写
	assert.throws(() => {
		APPLICATIONS[0] = { appKey: "mnova", serverName: "evil", launch: { kind: "arbitrary-executable" } };
	}, TypeError);
	assert.equal(applicationSpec("mnova").serverName, "mnova");
});

// ── 跨语言漂移守卫 ────────────────────────────────────────────────────────

test("JS 注册表与 Rust MCP_APPS 逐项一致（跨语言漂移守卫）", () => {
	const rust = rustApplications().map((spec) => ({
		appKey: spec.appKey,
		serverName: spec.serverName,
		requiresDirectory: spec.requiresDirectory,
		kind: APPLICATION_LAUNCH_KINDS.BUNDLED_PYTHON_MODULE,
		module: spec.module
	}));
	const js = APPLICATIONS.map((spec) => ({
		appKey: spec.appKey,
		serverName: spec.serverName,
		requiresDirectory: spec.requiresDirectory,
		kind: spec.launch.kind,
		module: spec.launch.module
	}));
	assert.deepEqual(js, rust, "JS 注册表与 Rust MCP_APPS 已漂移；两侧必须同步修改");
});

// ── 消费者接线守卫 ────────────────────────────────────────────────────────

test("lab-doctor 消费注册表并输出 applications 段", () => {
	const text = readFileSync(join(repoRoot, "scripts/lab-doctor.mjs"), "utf8");
	assert.match(text, /from "\.\.\/lib\/applications\/registry\.js"/, "lab-doctor 未引用注册表");
	assert.match(text, /applications:\s*describeApplications\(\)/, "lab-doctor 未把 applications 写入报告");
	assert.match(text, /report\.applications\.form/, "lab-doctor 未在人类可读输出中展示形态");
});
