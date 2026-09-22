/**
 * 测试套件自身的可移植性守卫。
 *
 * 背景：`tests/unit/*.test.mjs` 与 `tests/integration/*.test.mjs` **在 Windows 上也会跑**
 * （desktop 发布脚本的 tests 阶段），所以测试代码必须跨平台。本仓库已经因此踩过三次：
 *
 *   1. 断言里硬编码 POSIX 绝对路径 `/repo/vendor/...` —— Windows 上解析成 `H:\repo\...`；
 *   2. 用 `split("\n")` 读一个被检出成 CRLF 的文本文件，包名带上 `\r`；
 *   3. 造一个 `#!/bin/sh` 的假解释器并 `chmod` 成可执行 —— Windows 上根本执行不了，
 *      导致 tests 阶段失败、直接阻断整个出包（实测）。
 *
 * 这里只守**能精确判定**的两条（宁可少守，也不要造出误报让守卫被绕过）：
 *   * 测试里不得 `chmod` 造可执行 fixture：那是 POSIX 专属动作。需要假解释器时用
 *     依赖注入，或把 `process.execPath` 当解释器。
 *   * 测试里不得出现硬编码的 `/repo/` 绝对路径：用 `mkdtempSync` 造平台原生假根。
 *
 * 不守 `split("\n")`：仓库里有 12 处合法用法（作用于已归一化的字符串），一律禁掉会
 * 造出误报。可移植性的边界由 Windows 的 tests 阶段做最终裁决。
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const testsRoot = join(repoRoot, "tests");

/**
 * 去掉注释后再扫描。
 *
 * 本仓库的守卫已经两次因为"匹配到注释/文档字符串里的文字"而误报（markitdown[all]、
 * --headless），所以这里先把注释剥掉再判定，而不是把注释里的示例当成违规代码。
 */
export function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * 扫描一段测试源码，返回可移植性违规。
 * @param {string} source
 * @returns {{ rule: string, excerpt: string }[]}
 */
export function scanSource(source) {
	const violations = [];
	const lines = stripComments(source).split("\n");
	lines.forEach((line, index) => {
		if (/\bchmodSync\s*\(|\bchmod\s+0?[0-7]{3}\b/.test(line)) {
			violations.push({ rule: "chmod-executable", excerpt: `line ${index + 1}: ${line.trim()}` });
		}
		if (/["'`]\/repo\//.test(line)) {
			violations.push({ rule: "posix-absolute-path", excerpt: `line ${index + 1}: ${line.trim()}` });
		}
	});
	return violations;
}

/** 本文件必须内含违规样本作为自测数据，故扫描时跳过自己。 */
const SELF = fileURLToPath(import.meta.url);

function collectTestSources(dir = testsRoot, acc = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) collectTestSources(abs, acc);
		else if (entry.isFile() && entry.name.endsWith(".mjs")) acc.push(abs);
	}
	return acc.sort();
}

test("扫描器本身有效：两类违规都能被识别，合法写法不被误报", () => {
	// 非平凡性自证：若 scanSource 恒返回空数组，这两条会失败。
	const offenders = scanSource(
		['chmodSync(fakePython, 0o755);', 'const vendorFile = "/repo/vendor/tree/a";', "chmod 0755 ./run.sh"].join("\n"),
	);
	assert.equal(offenders.filter((v) => v.rule === "chmod-executable").length, 2, "应识别两种 chmod 写法");
	assert.equal(offenders.filter((v) => v.rule === "posix-absolute-path").length, 1, "应识别硬编码 /repo/ 路径");

	// 合法写法：平台原生假根 + 只创建不执行的文件（如 skill-executor 的 venv 假 python）
	const clean = scanSource(
		[
			'const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-x-"));',
			'await writeFile(venvPy, "#!/bin/sh\\n");',
			'assert.equal(executor.pythonCommand(), venvPy);',
		].join("\n"),
	);
	assert.deepEqual(clean, [], `合法写法被误报：${JSON.stringify(clean)}`);
});

test("测试代码不依赖 POSIX 专属能力（tests 阶段在 Windows 上也要跑）", () => {
	const sources = collectTestSources();
	assert.ok(sources.length >= 20, `扫描到的测试文件过少（${sources.length}），扫描逻辑可能失效`);

	const violations = [];
	for (const abs of sources) {
		if (abs === SELF) continue;
		for (const violation of scanSource(readFileSync(abs, "utf8"))) {
			violations.push(`${relative(repoRoot, abs).split("\\").join("/")} [${violation.rule}] ${violation.excerpt}`);
		}
	}
	assert.deepEqual(
		violations,
		[],
		[
			"以下测试代码在 Windows 上会失败（tests/unit 与 tests/integration 都会在 Windows 跑）：",
			...violations,
			"",
			"修法：",
			"  * 不要 chmod 造可执行 fixture —— 用依赖注入传值，或用 process.execPath 当解释器；",
			"  * 不要硬编码 /repo/... —— 用 mkdtempSync(join(tmpdir(), ...)) 造平台原生假根。",
		].join("\n"),
	);
});
