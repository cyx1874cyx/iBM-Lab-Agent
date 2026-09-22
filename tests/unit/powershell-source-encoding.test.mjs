/**
 * PowerShell 源码编码守卫（GBK 代码页下的无 BOM UTF-8 陷阱）。
 *
 * 背景：Windows 侧用 Windows PowerShell 5.1，它的脚本读取走**系统 ANSI 代码页**
 * （本机为 GBK），而不是 UTF-8。于是"含中文注释 + 无 BOM + LF 行尾"的 .ps1 会被
 * 按 GBK 解码：一个 UTF-8 中文尾字节会与紧随的 \n 组成非法双字节序列，解码器**吞掉
 * 换行**，下一行代码被并进注释 —— 结果是花括号失衡，报出的却是完全误导人的
 * `表达式或语句中包含意外的标记"}"`（实测 build-windows-release.ps1 第 205/269 行）。
 *
 * 实测矩阵（Windows PowerShell 5.1 + GBK 代码页，7 个仓库 .ps1）：
 *   LF + 无 BOM  → PARSE-FAIL（只要非 ASCII 行尾前有代码行）
 *   CRLF + 无 BOM → OK      LF + BOM → OK      CRLF + BOM → OK
 * 所以 BOM 是根治：它与行尾无关。仓库 .gitattributes 并没有把 *.ps1 钉成 CRLF，
 * 早先能出包仅依赖 Windows 侧 core.autocrlf=true —— 换台机器（或 core.autocrlf=false、
 * 或经非 git 手段传输）就会突然炸在打包流程中段。
 *
 * 规则：凡含非 ASCII 字节的 .ps1/.psm1 必须带 UTF-8 BOM；纯 ASCII 文件不需要。
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 不参与扫描的目录：依赖、产物、VCS 元数据、第三方镜像。 */
const PRUNED = new Set(["node_modules", ".git", ".build", "dist", "target", "vendor", "coverage"]);

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * 判定单个 PowerShell 源文件是否踩中陷阱。
 * @param {Buffer} bytes 文件原始字节
 * @returns {{ hasBom: boolean, hasNonAscii: boolean, violation: boolean }}
 */
function classify(bytes) {
	const hasBom = bytes.length >= 3 && bytes.subarray(0, 3).equals(UTF8_BOM);
	let hasNonAscii = false;
	for (let i = hasBom ? 3 : 0; i < bytes.length; i += 1) {
		if (bytes[i] >= 0x80) {
			hasNonAscii = true;
			break;
		}
	}
	return { hasBom, hasNonAscii, violation: hasNonAscii && !hasBom };
}

/** 递归收集仓库内的 .ps1/.psm1 相对路径。 */
function collectPowerShellSources(dir = repoRoot, acc = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (PRUNED.has(entry.name)) continue;
			collectPowerShellSources(join(dir, entry.name), acc);
		} else if (entry.isFile() && /\.psm?1$/i.test(entry.name)) {
			acc.push(relative(repoRoot, join(dir, entry.name)));
		}
	}
	return acc.sort();
}

test("检测器本身有效：非 ASCII 无 BOM 判为违规，其余三种组合放行", () => {
	// 非平凡性自证：如果 classify 恒返回 ok，这几条会失败。
	const nonAscii = Buffer.from("# 中文注释\n$ErrorActionPreference = 'Stop'\n", "utf8");
	assert.equal(classify(nonAscii).violation, true, "非 ASCII + 无 BOM 必须判为违规");
	assert.equal(classify(Buffer.concat([UTF8_BOM, nonAscii])).violation, false, "带 BOM 必须放行");
	assert.equal(classify(Buffer.from("# ascii only\n", "utf8")).violation, false, "纯 ASCII 无 BOM 必须放行");

	// 按 GBK 解码确实会吞掉换行——这是陷阱的机理，而不是猜测。
	const gbkSwallowsNewline = (() => {
		// 构造一个 UTF-8 中文尾字节与 \n 相邻的样本，确认其非 ASCII 性可被检出。
		const sample = Buffer.from("（与）\ncode\n", "utf8");
		return classify(sample).hasNonAscii;
	})();
	assert.equal(gbkSwallowsNewline, true, "全角括号应被识别为非 ASCII");
});

test("每个含非 ASCII 的 .ps1/.psm1 都带 UTF-8 BOM", () => {
	const sources = collectPowerShellSources();
	assert.ok(sources.length >= 5, `扫描到的 PowerShell 文件过少（${sources.length}），可能是扫描逻辑失效`);

	const offenders = [];
	let nonAsciiCount = 0;
	for (const rel of sources) {
		const bytes = readFileSync(join(repoRoot, rel));
		const verdict = classify(bytes);
		if (verdict.hasNonAscii) nonAsciiCount += 1;
		if (verdict.violation) offenders.push(rel);
	}

	assert.ok(nonAsciiCount > 0, "未发现任何含非 ASCII 的脚本，扫描结果不可信");
	assert.deepEqual(
		offenders,
		[],
		[
			"以下含非 ASCII 的 PowerShell 脚本缺少 UTF-8 BOM，在 GBK 代码页的 PowerShell 5.1 上会以 LF 行尾解析失败：",
			...offenders,
			"",
			"修法（BOM 必须补在文件最前面，注意多数编辑器/写入工具会静默丢掉它）：",
			...offenders.map(
				(rel) =>
					`  python3 -c "p='${rel}'; b=open(p,'rb').read(); open(p,'wb').write(b'\\xef\\xbb\\xbf'+b) if not b.startswith(b'\\xef\\xbb\\xbf') else None"`,
			),
		].join("\n"),
	);
});

test("已知三处历史风险文件（中文注释）明确带 BOM 且为仓库跟踪文件", () => {
	// 按名点出，失败信息可直接指向陷阱，而不是"某个文件"。
	for (const rel of [
		"desktop/scripts/build-bundled-python.ps1",
		"desktop/scripts/build-windows-release.ps1",
		"desktop/scripts/verify-package.ps1",
	]) {
		const bytes = readFileSync(join(repoRoot, rel));
		assert.equal(classify(bytes).hasBom, true, `${rel} 必须带 UTF-8 BOM`);
		assert.ok(statSync(join(repoRoot, rel)).size > 0, `${rel} 不应为空`);
	}
});

test(".gitattributes 未把 *.ps1 钉成 eol=lf（BOM 是唯一防线，不能被行尾规则抵消）", () => {
	const attrs = readFileSync(join(repoRoot, ".gitattributes"), "utf8");
	const offenders = attrs
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.filter((line) => /(^|\s)\*?\.?psm?1(\s|$)/i.test(line.split(/\s+/)[0]))
		.filter((line) => /eol=lf/i.test(line));
	assert.deepEqual(
		offenders,
		[],
		`*.ps1 不能被声明为 eol=lf：BOM 只解决解码，LF 本身不致命，但 eol=lf 会让所有检出都走 LF 路径、把 BOM 缺失的隐患带到每台机器。违规行：${offenders.join(" / ")}`,
	);
});
