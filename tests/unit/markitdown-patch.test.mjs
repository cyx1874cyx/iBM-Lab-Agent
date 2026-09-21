/**
 * markitdown「magika 可选化」补丁的测试（路线书 2.1 / 停车点 S2）。
 *
 * 为什么必须有这些断言：补丁改的是**第三方包源码**，一旦锚点漂移却"看起来成功"，
 * 要么静默没生效（magika 仍被要求，安装照旧拉 65 MB），要么改错位置（转换在运行期炸）。
 * 所以这里既验 apply/revert 的往返一致性，也验**拒绝**行为（锚点缺失/重复时必须报错，
 * 而不是猜着改）。
 *
 * 真实文件的验证放在 E2E：全新 venv 里按 install.sh 的三步装好后，
 * `.pdf/.docx/.pptx/.xlsx/.xls/.html/.epub` 七种格式输出与含 magika 时逐字一致，
 * 且 pip dry-run 负对照证明「不加 --no-deps 就会解析出 magika+onnxruntime」。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	applyMarkitdownPatch,
	inspectMarkitdownPatch,
	MARKITDOWN_PATCH_MARKER,
	MARKITDOWN_PATCH_VERSION,
	MARKITDOWN_PRISTINE_SHA256,
	revertMarkitdownPatch
} from "../../src/markitdown-patch.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 只含三处钩子的最小「原始」源码（钩子文本与 markitdown 0.1.7 一致）。 */
const PRISTINE = [
	"from urllib.parse import urlparse",
	"from warnings import warn",
	"import requests",
	"import magika",
	"import charset_normalizer",
	"import codecs",
	"",
	"class MarkItDown:",
	"    def __init__(self):",
	"        self._requests_session = None",
	"",
	"        self._magika = magika.Magika()",
	"",
	"    def _get_stream_info_guesses(self, file_stream, base_guess):",
	"        cur_pos = file_stream.tell()",
	"        try:",
	'            result = self._magika.identify_stream(file_stream)',
	'            if result.status == "ok" and result.prediction.output.label != "unknown":',
	"                pass",
	"        finally:",
	"            file_stream.seek(cur_pos)",
	""
].join("\n");

test("标记与版本常量形状正确", () => {
	assert.equal(MARKITDOWN_PATCH_MARKER, "IBM_LAB_AGENT_NO_MAGIKA");
	assert.match(MARKITDOWN_PATCH_VERSION, /^\d+\.\d+\.\d+$/);
	assert.match(MARKITDOWN_PRISTINE_SHA256, /^[0-9a-f]{64}$/, "原始文件哈希必须是 64 位小写十六进制");
});

test("inspect：原始文件识别为 pristine 且未打补丁", () => {
	const state = inspectMarkitdownPatch(PRISTINE);
	assert.equal(state.patched, false);
	assert.equal(state.pristineAnchors, true);
	assert.equal(state.patchedAnchors, false);
});

test("apply → inspect → revert 往返后与原始文本逐字节一致", () => {
	const patched = applyMarkitdownPatch(PRISTINE);
	assert.notEqual(patched, PRISTINE);
	assert.ok(patched.includes(MARKITDOWN_PATCH_MARKER), "补丁后必须带标记");

	const state = inspectMarkitdownPatch(patched);
	assert.equal(state.patched, true);
	assert.equal(state.patchedAnchors, true);
	assert.equal(state.pristineAnchors, false);

	// 三处钩子都改到位：import 被 try/except 包裹、构造与调用都做了 None 保护
	assert.match(patched, /try:\n    import magika\nexcept ImportError:\n    magika = None/);
	assert.match(patched, /self\._magika = magika\.Magika\(\) if magika is not None else None/);
	assert.match(patched, /identify_stream\(file_stream\) if self\._magika is not None else None/);
	assert.match(patched, /if result is not None and result\.status == "ok"/);

	const reverted = revertMarkitdownPatch(patched);
	assert.equal(reverted, PRISTINE, "revert 必须还原到逐字节相同的原文");
});

test("apply 与 revert 都幂等", () => {
	const once = applyMarkitdownPatch(PRISTINE);
	assert.equal(applyMarkitdownPatch(once), once, "重复 apply 不应叠加改动");
	assert.equal(revertMarkitdownPatch(PRISTINE), PRISTINE, "对未打补丁的文件 revert 应为空操作");
	assert.equal(revertMarkitdownPatch(revertMarkitdownPatch(once)), PRISTINE);
});

test("锚点缺失时拒绝修改（陌生版本不得猜着改）", () => {
	const missingCtor = PRISTINE.replace("        self._magika = magika.Magika()\n", "");
	assert.throws(() => applyMarkitdownPatch(missingCtor), /未找到 constructor 锚点/);

	const missingImport = PRISTINE.replace("import magika\n", "");
	assert.throws(() => applyMarkitdownPatch(missingImport), /未找到 imports 锚点/);

	const missingUse = PRISTINE.replace('            result = self._magika.identify_stream(file_stream)\n', "");
	assert.throws(() => applyMarkitdownPatch(missingUse), /未找到 stream-info usage 锚点/);
});

test("锚点重复出现时拒绝修改（可能已被人手改过）", () => {
	const duplicated = PRISTINE.replace(
		"        self._magika = magika.Magika()\n",
		"        self._magika = magika.Magika()\n        self._magika = magika.Magika()\n"
	);
	assert.throws(() => applyMarkitdownPatch(duplicated), /出现多次/);
});

test("带标记但补丁不完整时拒绝 apply（避免叠加出四不像）", () => {
	const halfPatched = `${MARKITDOWN_PATCH_MARKER}\n${PRISTINE}`;
	assert.throws(() => applyMarkitdownPatch(halfPatched), /补丁不完整/);
});

// ── 装法接线守卫：两条安装路径都必须用「no-deps + 补丁」而不是 [all] ──────────

test("install.sh 与 install-markitdown.mjs 都用 --no-deps + 补丁，且不用 markitdown[all]", () => {
	const installSh = readFileSync(join(repoRoot, "install.sh"), "utf8");
	const manual = readFileSync(join(repoRoot, "scripts", "install-markitdown.mjs"), "utf8");
	// 只检查代码行：注释里提到 markitdown[all]（说明"刻意不用它"）是合法的，
	// 直接对整个文件做正则会把文档说明误判成用法。
	const codeOnly = (text) => text
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			return t && !t.startsWith("#") && !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
		})
		.join("\n");
	for (const [name, text] of [["install.sh", installSh], ["install-markitdown.mjs", manual]]) {
		const code = codeOnly(text);
		assert.match(code, /--no-deps/, `${name} 未使用 --no-deps`);
		assert.match(code, /patch-markitdown\.mjs/, `${name} 未接入补丁脚本`);
		assert.equal(/markitdown\[all\]/.test(code), false, `${name} 的代码仍在使用 markitdown[all]（会拉入 Azure/音频/YouTube 链）`);
	}
	// 手工路径的版本必须取自补丁模块，避免两处版本漂移
	assert.match(manual, /MARKITDOWN_PATCH_VERSION/);
});

test("markitdown 本体刻意不在 requirements-linux.lock 内（否则 -r 就会拉 magika）", () => {
	const lock = readFileSync(join(repoRoot, "python", "requirements-linux.lock"), "utf8");
	const requirementLines = lock.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
	assert.equal(
		requirementLines.some((line) => /^markitdown\b/i.test(line)),
		false,
		"锁文件里出现 markitdown 会让 pip 解析出 magika（负对照 A 已实测）"
	);
	// 但格式依赖必须在锁里，否则装完 markitdown 缺依赖
	for (const dep of ["mammoth", "cobble", "beautifulsoup4", "markdownify", "defusedxml", "soupsieve"]) {
		assert.ok(requirementLines.some((line) => line.toLowerCase().startsWith(dep)), `锁里缺少 ${dep}`);
	}
});
