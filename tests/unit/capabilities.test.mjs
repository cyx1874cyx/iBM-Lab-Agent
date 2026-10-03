/**
 * 平台能力声明的单元测试（路线书 3.2）。
 *
 * 本文件有两类断言，缺一不可：
 *
 * 1) **模块语义**：lib/capabilities.js 的判据本身对不对。
 * 2) **组合结构**：cordis.patch.yml 经**真实加载器**解析后，browserMode 确实交给
 *    运行期探测决定，没有被硬编码、也没有被 YAML 静默误解析。
 *
 * 为什么第 2 类必须用真实加载器而不是读文本正则：本项目实测踩过一次 —— 裸写的
 * `!!js cond ? 'a' : 'b'` 因为 YAML 的 "? " 是复杂映射键指示符，被解析成
 * { '[object Object]': 'b' }，而基于原文正则的断言完全看不出来（它正则匹配到原文
 * 再自行 eval，绕过了 YAML 解析），给出的是**假阳性**。所以这里断言的是
 * loadOverlayPatches() 解析后的对象结构。
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";

import {
	BROWSER_MODES,
	DESKTOP_SHELL_ENV,
	bundledPythonFromEnv,
	defaultBrowserMode,
	describeCapabilities,
	isDesktopShell
} from "../../lib/capabilities.js";
import { LabLiteratureSourcesService } from "../../lib/literature-sources.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchPath = join(repoRoot, "cordis.patch.yml");

/** 用真实加载器把 cordis.patch.yml 解析成行。 */
function composedRows() {
	return composeEntries([loadOverlayPatches("test", patchPath)]);
}

// ── 1) 模块语义 ────────────────────────────────────────────────────────────

test("isDesktopShell 只认 IBM_LAB_AGENT_BUNDLED_PYTHON", () => {
	assert.equal(isDesktopShell({}), false);
	assert.equal(isDesktopShell({ [DESKTOP_SHELL_ENV]: "" }), false);
	assert.equal(isDesktopShell({ [DESKTOP_SHELL_ENV]: "C:\\py\\python.exe" }), true);
	// 回归保护：bin/ibm-lab-agent:23 会把 IBM_LAB_AGENT_WORKSPACE 默认成 $HOME，
	// 因此它不能作为桌面判据，否则 Linux 形态会被误判为桌面端。
	assert.equal(isDesktopShell({ IBM_LAB_AGENT_WORKSPACE: "/root" }), false);
});

test("bundledPythonFromEnv 返回路径或 undefined", () => {
	assert.equal(bundledPythonFromEnv({}), undefined);
	assert.equal(bundledPythonFromEnv({ [DESKTOP_SHELL_ENV]: "/opt/py/bin/python" }), "/opt/py/bin/python");
});

test("defaultBrowserMode：桌面端 handoff，其它形态 web-current", () => {
	assert.equal(defaultBrowserMode({}), "web-current");
	assert.equal(defaultBrowserMode({ [DESKTOP_SHELL_ENV]: "/opt/py/bin/python" }), "desktop-edge-handoff");
	assert.ok(BROWSER_MODES.includes(defaultBrowserMode({})));
	assert.ok(BROWSER_MODES.includes(defaultBrowserMode({ [DESKTOP_SHELL_ENV]: "/opt/py/bin/python" })));
});

test("describeCapabilities 汇总形态且不做 IO", () => {
	assert.deepEqual(describeCapabilities({ env: {}, platform: "linux" }), {
		platform: "linux",
		desktopShell: false,
		bundledPython: null,
		defaultBrowserMode: "web-current",
		form: "server"
	});
	const desktop = describeCapabilities({ env: { [DESKTOP_SHELL_ENV]: "C:\\py\\python.exe" }, platform: "win32" });
	assert.equal(desktop.form, "desktop");
	assert.equal(desktop.defaultBrowserMode, "desktop-edge-handoff");
	assert.equal(desktop.bundledPython, "C:\\py\\python.exe");
});

test("resolveBrowserMode：显式配置优先，旧 clientManagedBrowser 语义保持，未配置才做运行期探测", () => {
	const resolve = (config) => {
		const instance = Object.create(LabLiteratureSourcesService.prototype);
		instance.config = config;
		return instance.resolveBrowserMode();
	};

	// 1) 显式 browserMode 优先；非法值被忽略并落到探测
	assert.equal(resolve({ browserMode: "desktop-edge-handoff" }), "desktop-edge-handoff");
	assert.equal(resolve({ browserMode: "managed-edge" }), "managed-edge");
	assert.equal(resolve({ browserMode: " web-current " }), "web-current");

	// 2) 旧配置的兼容语义逐项保持（有定义就按真值判断）
	assert.equal(resolve({ clientManagedBrowser: true }), "web-current");
	assert.equal(resolve({ clientManagedBrowser: false }), "managed-edge");
	assert.equal(resolve({ browserMode: "", clientManagedBrowser: false }), "managed-edge");

	// 3) 两者都未配置时才做运行期探测，而不是固定回落 managed-edge
	const previous = process.env[DESKTOP_SHELL_ENV];
	try {
		delete process.env[DESKTOP_SHELL_ENV];
		assert.equal(resolve({ browserMode: "bogus" }), "web-current");
		assert.equal(resolve({}), "web-current");
		process.env[DESKTOP_SHELL_ENV] = "/opt/py/bin/python";
		assert.equal(resolve({}), "desktop-edge-handoff");
	} finally {
		if (previous === undefined) delete process.env[DESKTOP_SHELL_ENV];
		else process.env[DESKTOP_SHELL_ENV] = previous;
	}
});

// ── 2) 组合结构（真实加载器解析后断言）──────────────────────────────────────

test("真实加载器可解析 cordis.patch.yml，且 lab-literature-sources 行存在", () => {
	const rows = composedRows();
	const row = rows.find((entry) => entry.id === "lab-literature-sources");
	assert.ok(row, "cordis.patch.yml 中未找到 lab-literature-sources 行");
	assert.equal(row.name, "dsh-lab-agent/literature-sources");
	assert.ok(row.config, "该行缺少 config");
});

test("browserMode 交给运行期探测：组合里既无 browserMode 也无 clientManagedBrowser", () => {
	for (const row of composedRows()) {
		if (!row.config) continue;
		assert.equal(
			Object.prototype.hasOwnProperty.call(row.config, "browserMode"),
			false,
			`行 ${row.id} 硬编码了 browserMode；应交给 lib/capabilities.js::defaultBrowserMode() 运行期探测`
		);
		assert.equal(
			Object.prototype.hasOwnProperty.call(row.config, "clientManagedBrowser"),
			false,
			`行 ${row.id} 配置了旧布尔 clientManagedBrowser，会遮蔽运行期探测`
		);
	}
});

test("lab-literature-sources 的 config 全部解析为字符串或 !!js 占位符（防 YAML 误解析）", () => {
	const row = composedRows().find((entry) => entry.id === "lab-literature-sources");
	for (const [key, value] of Object.entries(row.config)) {
		if (typeof value === "string") continue;
		// !!js 经加载器解析后是惰性表达式占位符，形如 { __jsExpr: "dshHomePath(...)" }。
		// 若出现别的对象形态，说明该标量被 YAML 误解析（例如三元运算符的 "? " 被当成
		// 复杂映射键，得到 { '[object Object]': '...' }），必须当成错误。
		assert.equal(typeof value, "object", `config.${key} 类型异常：${typeof value}`);
		assert.ok(
			typeof value.__jsExpr === "string",
			`config.${key} 不是字符串也不是 !!js 占位符，疑似 YAML 误解析：${JSON.stringify(value)}`
		);
	}
	assert.equal(row.config.institutionPortalUrl, "https://wvpn.ustc.edu.cn/");
	assert.equal(row.config.sessionsDir.__jsExpr, "dshHomePath('lab-agent/literature-sessions')");
});
