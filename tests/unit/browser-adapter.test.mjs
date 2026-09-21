/**
 * 浏览器适配器（路线书 3.3：接口反转）的单元测试。
 *
 * 覆盖三类断言：
 *
 * 1) **描述符自洽**：三种模式的语义矩阵完整、互不矛盾，且词表与
 *    lib/capabilities.js 不漂移。
 * 2) **板块一不感知具体模式**：文献侧源码里不得出现任何具体模式字面量。
 *    这正是路线书 3.3 的验收①（"板块一目录内 grep desktop-edge-handoff 零命中"）；
 *    这里升级为对全部三个模式字面量的断言，并覆盖整个模块而不止一个文件。
 * 3) **部门一按描述符分支**：isDesktopEdgeHandoff() 等行为由描述符驱动。
 *
 * 为什么要有第 2 类"读源码"的断言：它测的不是逻辑而是**耦合方向**。接口反转的
 * 收益完全体现在"具体模式不再泄漏到板块一"，而这是纯行为测试观测不到的。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	browserAdapter,
	browserAdapterAvailable,
	describeBrowserAdapters,
	BROWSER_ADAPTERS
} from "../../lib/adapters/browser.js";
import {
	BROWSER_MODE_DESKTOP_HANDOFF,
	BROWSER_MODE_MANAGED_EDGE,
	BROWSER_MODES,
	BROWSER_MODE_WEB_CURRENT,
	defaultBrowserMode
} from "../../lib/capabilities.js";
import { LabLiteratureSourcesService } from "../../lib/literature-sources.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 板块一（文献检索/捕获）的宿主模块 —— 这些文件不得认识具体模式。 */
const LITERATURE_MODULE_FILES = [
	"lib/literature-sources.js",
	"lib/manual-capture.js",
	"lib/artifact-download.js",
	"src/manual-capture.js"
];

// ── 1) 描述符自洽 ──────────────────────────────────────────────────────────

test("描述符表覆盖 capabilities 的全部模式，且无多余项", () => {
	assert.deepEqual(Object.keys(BROWSER_ADAPTERS).sort(), [...BROWSER_MODES].sort());
	for (const mode of BROWSER_MODES) {
		assert.equal(browserAdapter(mode).mode, mode);
	}
});

test("描述符是冻结的（防止运行期被改写而绕过声明）", () => {
	assert.ok(Object.isFrozen(BROWSER_ADAPTERS));
	for (const mode of BROWSER_MODES) {
		assert.ok(Object.isFrozen(BROWSER_ADAPTERS[mode]), `${mode} 的描述符未冻结`);
	}
	assert.throws(() => { BROWSER_ADAPTERS[BROWSER_MODE_WEB_CURRENT].captureHandoff = true; }, TypeError);
});

test("语义矩阵：只有 handoff 需要桌面 shell 并经扩展回传", () => {
	const requiresShell = BROWSER_MODES.filter((m) => browserAdapter(m).requiresDesktopShell);
	const captureHandoff = BROWSER_MODES.filter((m) => browserAdapter(m).captureHandoff);
	assert.deepEqual(requiresShell, [BROWSER_MODE_DESKTOP_HANDOFF]);
	assert.deepEqual(captureHandoff, [BROWSER_MODE_DESKTOP_HANDOFF]);
});

test("语义矩阵：只有 managed-profile 自己启动浏览器并可 CDP 定位", () => {
	const launches = BROWSER_MODES.filter((m) => browserAdapter(m).launchesBrowser);
	const autoLocate = BROWSER_MODES.filter((m) => browserAdapter(m).autoLocate);
	assert.deepEqual(launches, [BROWSER_MODE_MANAGED_EDGE]);
	assert.deepEqual(autoLocate, [BROWSER_MODE_MANAGED_EDGE]);
});

test("sessionTarget 是唯一且封闭的线上词汇", () => {
	const targets = BROWSER_MODES.map((m) => browserAdapter(m).sessionTarget);
	assert.deepEqual([...targets].sort(), ["current", "handoff", "managed"]);
	assert.equal(new Set(targets).size, targets.length);
	// 与重构前的三元表达式语义逐一对应：
	//   web-current → current；desktop-edge-handoff → handoff；其余 → managed
	assert.equal(browserAdapter(BROWSER_MODE_WEB_CURRENT).sessionTarget, "current");
	assert.equal(browserAdapter(BROWSER_MODE_DESKTOP_HANDOFF).sessionTarget, "handoff");
	assert.equal(browserAdapter(BROWSER_MODE_MANAGED_EDGE).sessionTarget, "managed");
});

test("未知模式抛错，不静默回落", () => {
	assert.throws(() => browserAdapter("bogus"), /未知的浏览器模式/);
	assert.throws(() => browserAdapter(undefined), /未知的浏览器模式/);
});

// ── 2) 板块一不感知具体模式（路线书 3.3 验收①）──────────────────────────────

test("板块一源码内零具体模式字面量", () => {
	const offenders = [];
	for (const rel of LITERATURE_MODULE_FILES) {
		const text = readFileSync(join(repoRoot, rel), "utf8");
		for (const mode of BROWSER_MODES) {
			const hits = text.split(mode).length - 1;
			if (hits > 0) offenders.push(`${rel}: ${mode} ×${hits}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`具体浏览器模式不应出现在板块一源码中（应由 lib/adapters/browser.js 描述符驱动）：\n  ${offenders.join("\n  ")}`
	);
});

// ── 3) 板块一按描述符分支 ──────────────────────────────────────────────────

test("isDesktopEdgeHandoff 由描述符驱动", () => {
	const service = (config) => {
		const instance = Object.create(LabLiteratureSourcesService.prototype);
		instance.config = config;
		return instance;
	};
	assert.equal(service({ browserMode: BROWSER_MODE_DESKTOP_HANDOFF }).isDesktopEdgeHandoff(), true);
	assert.equal(service({ browserMode: BROWSER_MODE_WEB_CURRENT }).isDesktopEdgeHandoff(), false);
	assert.equal(service({ browserMode: BROWSER_MODE_MANAGED_EDGE }).isDesktopEdgeHandoff(), false);
});

test("验收③：managed-edge 在没有桌面 shell 时可用", () => {
	// Linux 服务端/纯 Web 形态没有 Tauri，受控检索浏览器仍必须可用。
	assert.equal(browserAdapterAvailable(BROWSER_MODE_MANAGED_EDGE, { desktopShell: false }), true);
	assert.equal(browserAdapterAvailable(BROWSER_MODE_WEB_CURRENT, { desktopShell: false }), true);
	// 而捕获回传链只有桌面端存在，不可用时必须如实报告（不静默降级）。
	assert.equal(browserAdapterAvailable(BROWSER_MODE_DESKTOP_HANDOFF, { desktopShell: false }), false);
	assert.equal(browserAdapterAvailable(BROWSER_MODE_DESKTOP_HANDOFF, { desktopShell: true }), true);
});

test("describeBrowserAdapters 暴露可用性，且与 defaultBrowserMode 无矛盾", () => {
	for (const desktopShell of [false, true]) {
		const rows = describeBrowserAdapters({ desktopShell });
		assert.equal(rows.length, BROWSER_MODES.length);
		for (const row of rows) {
			assert.equal(row.available, browserAdapterAvailable(row.mode, { desktopShell }));
		}
		// 探测出来的默认模式必须落在可用集合里 —— 否则启动即选了一个不可用的模式。
		const env = desktopShell ? { IBM_LAB_AGENT_BUNDLED_PYTHON: "/opt/py/bin/python" } : {};
		const preferred = defaultBrowserMode(env);
		assert.ok(
			browserAdapterAvailable(preferred, { desktopShell }),
			`默认模式 ${preferred} 在 desktopShell=${desktopShell} 下不可用`
		);
	}
});
