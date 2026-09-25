/**
 * 测试夹具：把语义计划包成**编译产物**（`kind: "compiled-plan"`）的形态。
 *
 * 为什么需要它：0.5.5-beta3 起 PPT 生成只有一条标准路径 —— 「编译 → 构建」。
 * `scripts/pptx/build_from_template.py --plan` 旧入口已移除，构建脚本只接受
 * `compiled.json`（`scripts/compile-ppt-plan.mjs` 的产物），且内容只来自
 * `slides[].texts[]`（`title / subtitle / bullets / imageCaption` 不再支持）。
 *
 * 所以凡是直接喂构建脚本的测试，输入都得长成编译产物的样子；这个 helper 就是那份
 * 「契约长什么样」的可执行文档，避免每个测试各写一份形状略有差异的 JSON。
 *
 * 形状（与 `lib/pptx-plan.js` 的输出一致）：
 *   { kind: "compiled-plan", schemaVersion: 1, roles: { 角色: 版式名|版式 id },
 *     requiredPages, maxPages, notesRequired, slides: [ { role, layoutId?, layoutName?,
 *     texts: [ { prompt?|idx?|name?, paragraphs: [], mode, align?, sizePt? } ], image?, notes? } ],
 *     diagnostics: [] }
 */

export const COMPILED_PLAN_KIND = "compiled-plan";
export const COMPILED_PLAN_SCHEMA_VERSION = 1;

/** 一个槽位的填充指令（prompt 优先、idx 兜底、name 最后）。 */
export function slotText({ prompt, idx, name, paragraphs, mode = "paragraph", align, sizePt } = {}) {
	return {
		...(prompt !== undefined ? { prompt } : {}),
		...(idx !== undefined ? { idx } : {}),
		...(name !== undefined ? { name } : {}),
		mode,
		...(align !== undefined ? { align } : {}),
		...(sizePt !== undefined ? { sizePt } : {}),
		paragraphs: paragraphs ?? []
	};
}

/** 一页（编译产物形态）。 */
export function compiledSlide({ index, role, layoutId, layoutName, texts = [], image, notes } = {}) {
	return {
		...(index !== undefined ? { index } : {}),
		role,
		...(layoutId !== undefined ? { layoutId } : {}),
		...(layoutName !== undefined ? { layoutName } : {}),
		texts,
		...(image !== undefined ? { image } : {}),
		...(notes !== undefined ? { notes } : {})
	};
}

/** 整份编译产物。`diagnostics` 缺省为空数组（干净计划）。 */
export function compiledPlan({ roles = {}, slides = [], diagnostics = [], ...rest } = {}) {
	return {
		kind: COMPILED_PLAN_KIND,
		schemaVersion: COMPILED_PLAN_SCHEMA_VERSION,
		roles,
		slides,
		diagnostics,
		...rest
	};
}
