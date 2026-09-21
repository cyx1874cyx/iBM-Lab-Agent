/**
 * markitdown 的「magika 可选化」补丁（路线书 2.1 / 停车点 S2）。
 *
 * 为什么需要补丁：markitdown 0.1.7 虽然有 `[all]` / `[pdf,docx,...]` 等 extras，但
 * **magika 是无条件的基础依赖**（`_markitdown.py:15 import magika`，且
 * `__init__` 里无条件 `self._magika = magika.Magika()`）。markitdown 又要求
 * `onnxruntime`，实测 **60.9 MB**；magika 自身 3.2 MB。所以路线书设想的
 * 「`--no-deps` 手工摘 magika」按字面做不到 —— 一摘 `import markitdown` 就失败。
 *
 * 本补丁把 magika 变成**可选**，语义与"magika 报 unknown"完全等价：magika 在
 * `_get_stream_info_guesses()` 里只用于在扩展名/mimetype 之外**细化**流类型猜测，
 * 不 ok 时本来就回退到 `enhanced_guess`（即扩展名猜测）。而本插件按扩展名显式判定
 * 可转换格式（lib/convert.js 的 CONVERTIBLE_UPLOAD_EXTENSIONS），不依赖内容嗅探。
 *
 * 补丁是窄且可逆的，调用方还必须核对原文件 SHA-256（见 MARKITDOWN_PRISTINE_SHA256）。
 * 与 src/dsh-runtime-patch.js 是同一范式。
 *
 * 注意：未来 markitdown 若把 magika 转为可选（上游 issue #1355 已有未合并 PR），
 * 本补丁即可退役：届时 anchor 不匹配，patch 命令会明确拒绝而不是猜着改。
 */

/** 打过补丁的标记；只在补丁后的文件里出现。 */
export const MARKITDOWN_PATCH_MARKER = "IBM_LAB_AGENT_NO_MAGIKA";

/** 补丁针对的 markitdown 版本（纯 py3-none-any wheel，各平台文件一致）。 */
export const MARKITDOWN_PATCH_VERSION = "0.1.7";

/** 未经改动的 0.1.7 `markitdown/_markitdown.py` 的 sha256（806 行）。 */
export const MARKITDOWN_PRISTINE_SHA256 = "3f0e691dc253a9f329dc0a630983dc2ea5bc1c1f9814d71ea50a66c7451a0dd2";

const ORIGINAL_IMPORT = "import requests\nimport magika\nimport charset_normalizer";
const PATCHED_IMPORT = `# ${MARKITDOWN_PATCH_MARKER}: magika 只用于在扩展名/mimetype 之外**细化**流类型猜测；
# markitdown 把它列为无条件依赖，因而连带拉入 onnxruntime（实测 60.9 MB）。
# 本插件按扩展名显式判定可转换格式（lib/convert.js 的 CONVERTIBLE_UPLOAD_EXTENSIONS），
# 不依赖内容嗅探，故把 magika 改为可选；缺失时退回扩展名猜测，与 magika 报
# unknown 的行为完全一致。如需还原：node scripts/patch-markitdown.mjs revert --target <file>
import requests
try:
    import magika
except ImportError:
    magika = None
import charset_normalizer`;

const ORIGINAL_CTOR = "        self._magika = magika.Magika()";
const PATCHED_CTOR = "        self._magika = magika.Magika() if magika is not None else None";

const ORIGINAL_USE = `            result = self._magika.identify_stream(file_stream)
            if result.status == "ok" and result.prediction.output.label != "unknown":`;
const PATCHED_USE = `            result = self._magika.identify_stream(file_stream) if self._magika is not None else None
            if result is not None and result.status == "ok" and result.prediction.output.label != "unknown":`;

const HUNKS = [
	{ label: "imports", original: ORIGINAL_IMPORT, patched: PATCHED_IMPORT },
	{ label: "constructor", original: ORIGINAL_CTOR, patched: PATCHED_CTOR },
	{ label: "stream-info usage", original: ORIGINAL_USE, patched: PATCHED_USE }
];

/** 断言 anchor 恰好出现一次：0 次说明文件不是预期版本，多次说明会改错地方。 */
function exactlyOnce(source, fragment, label) {
	const first = source.indexOf(fragment);
	if (first < 0) throw new Error(`markitdown patch: 未找到 ${label} 锚点（文件版本不符？）`);
	if (source.indexOf(fragment, first + fragment.length) >= 0) {
		throw new Error(`markitdown patch: ${label} 锚点出现多次，拒绝改（可能已被人手改过）`);
	}
}

export function inspectMarkitdownPatch(source) {
	return {
		patched: source.includes(MARKITDOWN_PATCH_MARKER),
		pristineAnchors: HUNKS.every(({ original }) => source.includes(original)),
		patchedAnchors: HUNKS.every(({ patched }) => source.includes(patched))
	};
}

export function applyMarkitdownPatch(source) {
	const state = inspectMarkitdownPatch(source);
	if (state.patched && state.patchedAnchors) return source;
	if (state.patched) throw new Error("markitdown patch: 存在补丁标记但补丁不完整，请先 revert 再重试");
	let out = source;
	for (const { original, patched, label } of HUNKS) {
		exactlyOnce(out, original, label);
		out = out.replace(original, patched);
	}
	return out;
}

export function revertMarkitdownPatch(source) {
	const state = inspectMarkitdownPatch(source);
	if (!state.patched) return source;
	let out = source;
	for (const { original, patched, label } of HUNKS) {
		exactlyOnce(out, patched, label);
		out = out.replace(patched, original);
	}
	return out;
}
