/**
 * import 可达性审计的单元测试（路线书 1.4）。
 *
 * 这个脚本存在的唯一理由是防止「把还在用的依赖当成可删」——历史上真实发生过：
 * scipy（143 MB）被误判为可删，根因是静态扫描用了 `^import`，漏掉函数体内的缩进导入。
 * 所以本测试最核心的一条不是"函数返回什么"，而是**那个正则的缩进覆盖能力**：
 * 直接拿仓库里真实存在的 process_1d.py 断言 nmrglue / scipy 必须被扫到。
 *
 * 运行期追踪部分用当前解释器 + 仅依赖标准库的临时脚本，保证确定性；
 * 解释器缺失时跳过而不是误报失败。
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	canonicalDistribution,
	compareWithLock,
	parseImportTime,
	parseLock,
	runtimeImports,
	staticImports
} from "../../scripts/audit-imports.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROCESS_1D = join(repoRoot, "vendor/mnova-mcp/skill/nmr-analyze-simulate/scripts/process_1d.py");

const pythonAvailable = () => spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

// ── 静态扫描：核心是缩进覆盖 ────────────────────────────────────────────────

test("静态扫描覆盖函数体内的缩进导入（路线书强调的那个坑）", () => {
	const source = [
		"import json",
		"def f():",
		"    try:",
		"        import nmrglue as ng",
		"    except ImportError:",
		"        raise RuntimeError('x')",
		"\tfrom scipy.signal import find_peaks",
		"        import matplotlib.pyplot as plt"
	].join("\n");
	const found = staticImports(source);
	for (const name of ["json", "nmrglue", "scipy", "matplotlib"]) {
		assert.ok(found.has(name), `未扫到 ${name}（缩进导入被漏掉）`);
	}
	// 反证：错误正则 `^import` 会漏掉缩进导入 —— 这正是 scipy 被误判的机制
	const wrong = [...source.matchAll(/^import[ \t]+([A-Za-z_][A-Za-z0-9_.]*)/gm)].map((m) => m[1]);
	assert.deepEqual(wrong, ["json"], "错误正则本应只命中顶层 import；若它命中了更多，说明测试样本不再能体现该坑");
});

test("验收：对 process_1d.py 扫描必须含 nmrglue 与 scipy，且不含 pandas", () => {
	const found = staticImports(readFileSync(PROCESS_1D, "utf8"));
	assert.ok(found.has("nmrglue"), "process_1d.py 的 nmrglue 导入未被扫到");
	assert.ok(found.has("scipy"), "process_1d.py 的 scipy 导入未被扫到");
	assert.equal(found.has("pandas"), false, "process_1d.py 不应把 pandas 作为项目自有代码依赖");
	// 同一份文件上，错误正则确实会漏掉这两个 —— 钉住"坑是真实存在的"
	const text = readFileSync(PROCESS_1D, "utf8");
	const wrong = new Set([...text.matchAll(/^import[ \t]+([A-Za-z_][A-Za-z0-9_.]*)/gm)].map((m) => m[1]));
	assert.equal(wrong.has("nmrglue"), false);
	assert.equal(wrong.has("scipy"), false);
});

test("静态扫描取顶层模块名（子模块归并到父包）", () => {
	const found = staticImports("from scipy.signal import find_peaks\nimport nmrglue.fileio.varian\n");
	assert.deepEqual([...found].sort(), ["nmrglue", "scipy"]);
});

// ── 运行期追踪：解析 ────────────────────────────────────────────────────────

test("parseImportTime 只取导入列，忽略耗时数字与噪声行", () => {
	const stderr = [
		"import time:        46 |         46 | encodings",
		"import time:       123 |       4567 | scipy.signal",
		"Traceback (most recent call last):",
		"  File \"x.py\", line 1",
		"Warning: something",
		"import time:         1 |          1 | nmrglue.fileio.varian"
	].join("\n");
	const found = parseImportTime(stderr);
	assert.deepEqual([...found].sort(), ["encodings", "nmrglue", "scipy"]);
	assert.equal(found.has("time"), false, "不应把 'import time:' 的 time 当成模块");
});

test("运行期追踪能捕获实际导入的模块（仅用标准库，保证确定性）", (t) => {
	if (!pythonAvailable()) {
		t.skip("python3 不可用");
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), "audit-imports-"));
	const script = join(dir, "target.py");
	writeFileSync(script, "import colorsys\nprint(colorsys.rgb_to_hsv(1, 0, 0))\n");
	const result = runtimeImports({ python: "python3", target: script });
	assert.equal(result.exitCode, 0, `目标脚本应正常运行：${result.errorTail}`);
	assert.ok(result.modules.has("colorsys"), "运行期追踪未捕获 colorsys");
});

test("目标脚本失败时如实报告退出码与尾部输出", (t) => {
	if (!pythonAvailable()) {
		t.skip("python3 不可用");
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), "audit-imports-"));
	const script = join(dir, "broken.py");
	writeFileSync(script, "import colorsys\nraise SystemExit('boom')\n");
	const result = runtimeImports({ python: "python3", target: script });
	assert.notEqual(result.exitCode, 0);
	assert.match(result.errorTail, /boom/);
	// 失败前的导入仍然被记录（这正是"证据不完整但仍有价值"的语义）
	assert.ok(result.modules.has("colorsys"));
});

// ── 锁文件比对：纯函数 ──────────────────────────────────────────────────────

test("canonicalDistribution 与 pip 的规范化一致", () => {
	assert.equal(canonicalDistribution("PyMuPDF"), "pymupdf");
	assert.equal(canonicalDistribution("pdfminer.six"), "pdfminer-six");
	assert.equal(canonicalDistribution("typing_extensions"), "typing-extensions");
});

test("parseLock 跳过注释与空行，兼容 extras 写法", () => {
	const locked = parseLock([
		"# comment",
		"",
		"numpy==2.4.6",
		"markitdown[pdf,docx]==0.1.7",
		"PyMuPDF==1.28.2"
	].join("\n"));
	assert.deepEqual([...locked.keys()].sort(), ["markitdown", "numpy", "pymupdf"]);
});

test("锁比对：可达的发行版不会进入「未触达」候选（scipy/nmrglue 是历史误判项）", () => {
	// 用脚本导出的纯函数，避免在测试里重实现一遍比对逻辑而与之漂移。
	const lockText = readFileSync(join(repoRoot, "python/requirements.lock"), "utf8");
	const result = compareWithLock({
		lockText,
		// 以 process_1d.py 的静态扫描结果作为「可达发行版」输入（确定性，不依赖解释器）
		reachedDistributions: [...staticImports(readFileSync(PROCESS_1D, "utf8"))]
	});
	assert.ok(result.lockedCount > 50, "锁文件解析结果异常");
	assert.ok(result.reachedCount > 0, "应至少触达 numpy/scipy/nmrglue 等");
	// 历史上被误判为可删的两个，绝不能出现在未触达候选里
	assert.equal(result.unreached.includes("scipy"), false);
	assert.equal(result.unreached.includes("nmrglue"), false);
	// 反向：与 NMR 处理路径无关的包必须出现，否则说明比对是恒真式
	assert.ok(result.unreached.includes("origin-mcp"), "origin-mcp 与 NMR 处理路径无关，应列为未触达");
	assert.equal(result.unreached.includes("numpy"), false);
});
