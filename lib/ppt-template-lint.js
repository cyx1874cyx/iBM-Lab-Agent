/**
 * dsh-lab-agent: PPT 模板体检（lint）—— pptx-cli `validate` 判不了的那部分。
 *
 * 分工：pptx-cli 的 `validate` 判的是**成品 deck 是否符合 manifest 契约**（版式/占位符
 * 映射/几何漂移/指纹）。但「这份模板本身能不能稳定产出符合我们中文排版政策的 deck」
 * 它判不了 —— 它全包不写字体/字号，也不剥模板自带项目符号。所以这里补六类规则：
 *
 *   ① static-layer-*        静态层指纹对比（与上一版比、以及版式之间一致性）——
 *                           「底图位置大小不变、上边线以上全部不变」的机器可验证形式；
 *   ② slot-prompt-*         槽位提示文字齐备性 / 改名 / 重复（对照期望角色）；
 *   ③ font-size-*           沿 inheritance_chain 解出的有效字号 < 下限或整链无字号；
 *   ④ cjk-typeface-*        静态文字缺 `a:ea`（中文会静默回退到系统字体）；
 *   ⑤ template-bullet-leak  图注/摘要/正文类槽继承模板项目符号（会被带进正文）；
 *   ⑥ required-slot-missing 版式必填槽（题注/图/正文）齐备性。
 *
 * `compensated` 字段：构建器会在成品里兜住的缺陷（字号下限、版式字体归一化、
 * 分点剥离）标 true；静态层漂移与必填槽缺失**不可能**被构建器兜住，标 false。
 * `ok` 只看未补偿的 error —— 这样 lint 既如实报告模板侧待修项，又能当门禁用。
 *
 * 报告结构稳定：findings[] = {code, severity, message, location, compensated, hint}。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import {
	PPTX_CLI_MODULE,
	diffManifests,
	doctorReport,
	loadManifestPackage,
	summarizeManifest
} from "./pptx-manifest.js";
import { allSlots, deriveSlotSpec, indexSlotSpec, typographyFromScan } from "../src/ppt-slot-spec.js";
import { bulletLeaksInto, hasCjk, scanPresentationXml } from "../src/pptx-xml.js";

export const LINT_SCHEMA_VERSION = 1;
export const SLOTS_SPEC_FILE = "slots.json";
export const LINT_REPORT_FILE = "lint.json";
export const DEFAULT_MIN_FONT_PT = 20;

/** 会继承模板项目符号就会污染正文的槽位模式（mode=bullets 的槽位不受此规则约束）。 */
const PARAGRAPH_MODE = "paragraph";

/** 读取 slots.json（缺失/损坏返回 undefined）。 */
export async function readSlotSpec(path) {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return parsed !== null && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** 递归收集 manifest 里所有 protected_static_elements，按 (layoutId, elementType, name) 建索引。 */
function indexProtected(summary) {
	const index = new Map();
	for (const layout of summary.layouts ?? []) {
		for (const element of layout.protectedElements ?? []) {
			index.set(`${layout.id}|${element.elementType}|${element.name}`, { layoutId: layout.id, ...element });
		}
	}
	return index;
}

/** 几何是否完全一致（EMU 级比较）。 */
function geometryEquals(a, b) {
	return a.leftEmu === b.leftEmu && a.topEmu === b.topEmu && a.widthEmu === b.widthEmu && a.heightEmu === b.heightEmu;
}

/**
 * 读源模板 XML → 按版式 id 索引的排版表（行距/段间距/内边距），供容量自算用。
 * 任何一步失败都返回 undefined：调用方退化为默认排版值（容量仍会夹到版面下边界），
 * 绝不因为"读不到"就把乐观的 `max_lines` 当成可信值。
 */
async function loadTemplateTypography(summary, pkg) {
	if (!pkg?.sourceTemplate || !existsSync(pkg.sourceTemplate)) return undefined;
	try {
		const scan = await scanPresentationXml(await readFile(pkg.sourceTemplate));
		if (scan?.ok !== true) return undefined;
		return typographyFromScan(scan, summary?.layouts ?? []);
	} catch {
		return undefined;
	}
}

/**
 * ⑦ capacity-metadata-optimistic：pptx-cli 的 `estimated_text_capacity.max_lines` 只按高度算，
 * 行距硬编码 `字号 × 1.22`、不读 `a:lnSpc` / `a:spcBef` / `a:spcAft`、也不夹版面下边界。
 * 模板写了固定行距时它会把容量系统性报大；Agent 照这个数字填字就会溢出 —— 0.5.4 真实
 * 试用为此磨了 10 轮「改文案 → 重建 → 渲染」。高估 ≥25% 时报警（warning，不阻断门控）。
 */
function checkCapacityMetadata({ slotSpec, add }) {
	for (const layout of slotSpec?.layouts ?? []) {
		for (const slot of layout.slots ?? []) {
			if (slot.capacityOptimistic !== true) continue;
			const computed = slot.capacityLines;
			const cli = slot.cliCapacityLines;
			add({
				code: "capacity-metadata-optimistic",
				severity: "warning",
				compensated: false,
				message: `版式 ${layout.layoutId} 槽位 ${slot.key}（idx=${slot.idx}）：pptx-cli 报 ${cli} 行，按模板实际排版自算 ${computed} 行（行距 ${slot.lineHeightPt}pt、段前/段后 ${slot.spaceBeforePt}/${slot.spaceAfterPt}pt），高出约 ${Math.round((cli / computed - 1) * 100)}%`,
				location: { layoutId: layout.layoutId, slotKey: slot.key, idx: slot.idx },
				hint: "这是模板元数据与可渲染容量不一致：填字以 capacityLines 为准，或把该占位符的行距/段间距改小后重新导入"
			});
		}
	}
}

/**
 * ⑧ capacity-typography-unresolved：容量**不许静默退化**。
 *
 * `deriveSlotSpec` 只有在拿到模板排版表（行距/段间距/内边距）时才能算出优于 pptx-cli 的容量；
 * 拿不到时会退回默认 1.2 倍行距模型 —— 那时 `capacityLines` 与 pptx-cli 的 `max_lines` 等价
 * （本模板实测正是如此：19 vs 19），修复等于没生效。所以这里必须显式报一条，而不是只留一个
 * `capacityModel.source = "defaults"` 字段等人自己发现（0.5.4 试用复盘里的坑就是"静默退化"）。
 */
function checkCapacityTypography({ slotSpec, add }) {
	const model = slotSpec?.capacityModel ?? {};
	if (model.source === "template-xml") return;
	const layouts = (slotSpec?.layouts ?? []).length;
	add({
		code: "capacity-typography-unresolved",
		severity: "warning",
		compensated: false,
		message: `没能解析到模板排版（行距/段前段后/内边距），${layouts} 个版式的容量退化为默认 ${model.defaultLineSpacingMultiplier ?? 1.2} 倍行距模型 —— 此时自算容量**不优于** pptx-cli 的 max_lines 参考值，模板写了固定行距时会被系统性高估`,
		location: { capacityModel: model },
		hint: "确认 manifest 包内有 assets/source-template.pptx（或版本目录下有 source.pptx），且其 XML 可解析；模板导入与 lint 都会重新派生 slots.json"
	});
}

/**
 * 体检一份 manifest 包。
 *
 * @param {object} options
 * @param {string} options.manifestDir pptx-cli manifest 包目录
 * @param {object} [options.template] 模板元数据 {id, version, manifestSource, pptxCliVersion}
 * @param {string} [options.baselineManifestDir] 上一版 manifest 包（静态层对比 + manifest diff）
 * @param {object} [options.baselineSlotSpec] 上一版 slots.json（槽位改名/删除对比）
 * @param {number} [options.minFontPt] 字号下限，默认 20
 * @param {boolean} [options.runCliChecks] 是否调用 pptx-cli doctor（默认 true）
 * @param {object} [options.cli] 透传给 pptx-cli 的选项（python/venvPython/timeoutMs…）
 * @returns {Promise<object>} lint 报告（永不抛）
 */
export async function lintTemplatePackage({
	manifestDir,
	template = {},
	baselineManifestDir,
	baselineSlotSpec,
	minFontPt = DEFAULT_MIN_FONT_PT,
	runCliChecks = true,
	cli = {}
} = {}) {
	const findings = [];
	const add = (finding) => { findings.push({ compensated: false, ...finding }); };
	const pkg = await loadManifestPackage(manifestDir);
	if (!pkg.ok) {
		for (const finding of pkg.findings) {
			add({ code: "manifest-missing", severity: "error", message: finding.message, location: { path: manifestDir }, hint: "先执行模板导入（pptx-cli init）生成 manifest 包，再跑 lint" });
		}
		return finalize({
			manifestDir,
			template,
			findings,
			slotSpec: undefined,
			minFontPt,
			extra: { manifestSource: "missing" }
		});
	}
	for (const finding of pkg.findings) {
		add({ code: `manifest-${finding.code}`, severity: finding.level === "error" ? "error" : "warning", message: finding.message, location: { path: manifestDir } });
	}

	const summary = summarizeManifest(pkg.manifest);
	// 容量自算需要模板自己的行距/段间距/内边距：pptx-cli 的 max_lines 只按高度算、行距硬编码
	// 1.22，而本模板正文是**固定 30pt 行距**（`<a:spcPts val="3000"/>`），照它的数字填字会溢出
	// —— 0.5.4 真实试用为此磨了 10 轮重建渲染。
	const typography = await loadTemplateTypography(summary, pkg);
	const slotSpec = deriveSlotSpec(summary, {
		minFontPt,
		templateRef: { name: summary.template?.name, sha256: summary.template?.sourceHash, manifest: "manifest" },
		typography
	});
	const placeholderIndex = new Map();
	for (const layout of summary.layouts ?? []) {
		for (const placeholder of layout.placeholders ?? []) {
			placeholderIndex.set(`${layout.id}|${placeholder.idx}`, { layout, placeholder });
		}
	}

	checkStaticLayer({ summary, add });
	checkSlotPrompts({ slotSpec, baselineSlotSpec, add });
	checkFontSizes({ slotSpec, summary, placeholderIndex, minFontPt, add });
	await checkCjkTypefaces({ summary, pkg, add });
	await checkTemplateBullets({ slotSpec, summary, pkg, placeholderIndex, add });
	checkRequiredSlots({ slotSpec, add });
	checkCapacityMetadata({ slotSpec, add });
	checkCapacityTypography({ slotSpec, add });

	let destructiveChanges;
	if (baselineManifestDir && baselineManifestDir !== manifestDir) {
		const staticLayer = await compareStaticLayerBaseline({ summary, baselineManifestDir, add });
		const diff = await compareManifestVersions({ fromDir: baselineManifestDir, toDir: manifestDir, cli });
		if (diff.available && diff.ok) {
			for (const change of diff.breaking) {
				add({
					code: "template-breaking-change",
					severity: "error",
					message: describeManifestChange(change),
					location: { path: manifestDir, changeType: change?.type, layoutId: change?.layout_id },
					hint: "破坏性变更会让既有 plan/成品失效：确认后同步更新槽位规范与 plan"
				});
			}
			destructiveChanges = { staticLayer, ...diff };
		} else {
			destructiveChanges = { staticLayer, available: false, hint: diff.hint ?? diff.error ?? "pptx-cli manifest diff 不可用" };
		}
	}
	if (runCliChecks) {
		await collectCliFindings({ manifestDir, add, cli });
	}

	return finalize({
		manifestDir,
		template,
		findings,
		slotSpec,
		minFontPt,
		extra: {
			manifestSource: "manifest",
			destructiveChanges,
			templateInfo: summary.template,
			pageSize: summary.pageSize,
			layoutCount: (summary.layouts ?? []).length,
			cliVersion: template.pptxCliVersion,
			cliModule: PPTX_CLI_MODULE
		}
	});
}

/**
 * ① 静态层：共用一个静态层的版式之间**几何**必须完全一致（"上边线以上全部不变"）。
 *
 * 注意这里只比几何、不比指纹：pptx-cli 的 `_shape_fingerprint` 是整个 shape XML 的
 * sha256，而「TextBox 5」里装的是各页自己的标题（摘要 Abstract / 方法 Methods），
 * 天然逐版式不同。指纹只在**同一版式跨版本**对比时才有意义（见 compareStaticLayerBaseline）。
 */
function checkStaticLayer({ summary, add }) {
	const groups = new Map();
	for (const layout of summary.layouts ?? []) {
		const elements = layout.protectedElements ?? [];
		if (elements.length === 0) continue;
		const key = elements.map((element) => `${element.elementType}:${element.name}`).sort().join("+");
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(layout);
	}
	for (const [, layouts] of groups) {
		if (layouts.length < 2) continue;
		const reference = layouts[0];
		for (const layout of layouts.slice(1)) {
			for (const element of layout.protectedElements ?? []) {
				const twin = (reference.protectedElements ?? []).find((candidate) => candidate.name === element.name && candidate.elementType === element.elementType);
				if (twin === undefined) continue;
				if (geometryEquals(element, twin)) continue;
				add({
					code: "static-layer-inconsistent",
					severity: "error",
					message: `版式「${layout.name ?? layout.id}」的静态元素「${element.name}」与同层版式「${reference.name ?? reference.id}」不一致（几何或内容漂移）`,
					location: { layoutId: layout.id, element: element.name, referenceLayoutId: reference.id },
					hint: "静态层必须逐版式一致：在 PowerPoint 里改正后重新导入模板"
				});
			}
		}
	}
}

/** ① 静态层：与上一版 manifest 对比（漂移即 error）。 */
async function compareStaticLayerBaseline({ summary, baselineManifestDir, add }) {
	const baselinePkg = await loadManifestPackage(baselineManifestDir);
	if (!baselinePkg.ok) {
		add({ code: "static-layer-baseline-unreadable", severity: "warning", message: `无法读取基线 manifest：${baselineManifestDir}`, location: { path: baselineManifestDir } });
		return undefined;
	}
	const baselineIndex = indexProtected(summarizeManifest(baselinePkg.manifest));
	const currentIndex = indexProtected(summary);
	for (const [key, element] of currentIndex) {
		const base = baselineIndex.get(key);
		if (base === undefined) {
			add({ code: "static-layer-added", severity: "warning", message: `新增静态元素「${element.name}」（版式 ${element.layoutId}）`, location: { layoutId: element.layoutId, element: element.name } });
			continue;
		}
		if (base.fingerprint !== element.fingerprint) {
			add({
				code: "static-layer-drift",
				severity: "error",
				message: `静态元素「${element.name}」（版式 ${element.layoutId}）内容指纹变化：${String(base.fingerprint).slice(0, 12)}… → ${String(element.fingerprint).slice(0, 12)}…`,
				location: { layoutId: element.layoutId, element: element.name },
				hint: "底图/上边线/logo 不允许漂移：确认模板改动是有意的，否则回退模板"
			});
		}
		if (!geometryEquals(base, element)) {
			add({
				code: "static-layer-drift",
				severity: "error",
				message: `静态元素「${element.name}」（版式 ${element.layoutId}）位置或尺寸变化：[${base.leftEmu},${base.topEmu},${base.widthEmu},${base.heightEmu}] → [${element.leftEmu},${element.topEmu},${element.widthEmu},${element.heightEmu}]`,
				location: { layoutId: element.layoutId, element: element.name }
			});
		}
	}
	for (const [key, element] of baselineIndex) {
		if (currentIndex.has(key)) continue;
		add({ code: "static-layer-removed", severity: "error", message: `静态元素「${element.name}」（版式 ${element.layoutId}）在本次模板中消失`, location: { layoutId: element.layoutId, element: element.name } });
	}
	return { baselineDir: baselineManifestDir, comparedProtectedElements: currentIndex.size };
}

/**
 * manifest diff 包装：模板版本升级时的破坏性变更报告。
 * 与 lint 解耦（lint 只负责把结果并入报告）。
 */
export async function compareManifestVersions({ fromDir, toDir, cli = {} } = {}) {
	const result = await diffManifests({ leftDir: fromDir, rightDir: toDir, ...cli });
	if (!result.available) return { available: false, hint: result.error ?? result.hint };
	if (!result.ok) return { available: true, ok: false, error: result.error, errors: result.errors };
	const payload = result.envelope?.result ?? {};
	return {
		available: true,
		ok: true,
		from: fromDir,
		to: toDir,
		breaking: payload.breaking_changes ?? [],
		additive: payload.additive_changes ?? [],
		unchanged: payload.unchanged ?? []
	};
}

/** pptx-cli manifest diff 的变更项 → 中文描述（未知类型按 JSON 兜底，不猜语义）。 */
export function describeManifestChange(change) {
	const type = String(change?.type ?? "unknown");
	const layoutId = change?.layout_id ?? change?.layoutId;
	const table = {
		"layout.removed": `版式 ${layoutId} 被删除`,
		"layout.added": `新增版式 ${layoutId}`,
		"placeholder.removed": `版式 ${layoutId} 的占位符被删除`,
		"placeholder.added": `版式 ${layoutId} 新增占位符`,
		"placeholder.changed": `版式 ${layoutId} 的占位符契约变化`,
		"geometry.changed": `版式 ${layoutId} 的几何变化`,
		"theme.changed": "主题变化",
		"asset.removed": "模板资源被删除"
	};
	if (table[type]) return `破坏性变更：${table[type]}`;
	return `破坏性变更：${type} ${JSON.stringify(change)}`;
}

/** ② 槽位提示文字：齐备性 / 改名 / 重复。 */
function checkSlotPrompts({ slotSpec, baselineSlotSpec, add }) {
	for (const warning of slotSpec.warnings ?? []) {
		if (warning.code === "layout_role_unknown") {
			add({ code: "layout-role-unknown", severity: "error", message: warning.message, location: warning.location ?? {}, hint: "按 docs/PPT_TEMPLATE_SPEC.md 的提示文字约定改写占位符提示文字，或调整 src/ppt-slot-spec.js 的角色表" });
		} else if (warning.code === "capacity-metadata-optimistic") {
			// 由 checkCapacityMetadata 统一上报（带 hint、规则表与一致的可读差异百分比），
			// 这里跳过，避免同一问题以 slot- 前缀再报一遍。
			continue;
		} else {
			add({ code: `slot-${warning.code}`, severity: "warning", message: warning.message, location: warning.location ?? {} });
		}
	}
	for (const layout of slotSpec.layouts ?? []) {
		const seen = new Map();
		for (const slot of layout.slots ?? []) {
			const prompt = String(slot.prompt ?? "").trim();
			if (!prompt) {
				add({ code: "slot-prompt-empty", severity: "warning", message: `版式 ${layout.layoutId} 的槽位 ${slot.key}（idx=${slot.idx}）提示文字为空：定位会退化为 idx`, location: { layoutId: layout.layoutId, slotKey: slot.key, idx: slot.idx } });
			} else if (seen.has(prompt)) {
				add({ code: "slot-prompt-duplicate", severity: "warning", message: `版式 ${layout.layoutId} 内提示文字「${prompt}」重复（idx=${seen.get(prompt)} 与 idx=${slot.idx}）：提示文字优先定位会命中第一个`, location: { layoutId: layout.layoutId, slotKey: slot.key, idx: slot.idx } });
			} else {
				seen.set(prompt, slot.idx);
			}
			if (slot.boundBy !== "prompt" && prompt) {
				add({
					code: "slot-prompt-renamed",
					severity: "warning",
					message: `版式 ${layout.layoutId} 的槽位 ${slot.key} 未按约定提示文字命中，改按结构匹配到「${prompt}」（idx=${slot.idx}）`,
					location: { layoutId: layout.layoutId, slotKey: slot.key, idx: slot.idx },
					hint: "提示文字是定位键：建议改回约定文案，否则 PowerPoint 重排 idx 后会错配"
				});
			}
		}
	}
	if (baselineSlotSpec) {
		const baselineByKey = new Map(allSlots(baselineSlotSpec).map((slot) => [`${slot.layoutId}|${slot.key}`, slot]));
		for (const slot of allSlots(slotSpec)) {
			const base = baselineByKey.get(`${slot.layoutId}|${slot.key}`);
			if (base === undefined) continue;
			if (String(base.prompt ?? "") !== String(slot.prompt ?? "")) {
				add({
					code: "slot-prompt-renamed-vs-baseline",
					severity: "warning",
					message: `槽位 ${slot.layoutId}/${slot.key} 的提示文字与上一版不一致：「${String(base.prompt ?? "").slice(0, 24)}」→「${String(slot.prompt ?? "").slice(0, 24)}」`,
					location: { layoutId: slot.layoutId, slotKey: slot.key }
				});
			}
		}
		const currentKeys = new Set(allSlots(slotSpec).map((slot) => `${slot.layoutId}|${slot.key}`));
		for (const slot of allSlots(baselineSlotSpec)) {
			if (currentKeys.has(`${slot.layoutId}|${slot.key}`)) continue;
			add({
				code: "slot-key-removed",
				severity: slot.required ? "error" : "warning",
				message: `上一版槽位 ${slot.layoutId}/${slot.key} 在本版消失`,
				location: { layoutId: slot.layoutId, slotKey: slot.key }
			});
		}
	}
}

/** ③ 字号：有效字号低于下限或整条继承链无字号。 */
function checkFontSizes({ slotSpec, summary, placeholderIndex, minFontPt, add }) {
	const rules = summary.rules ?? {};
	const floor = typeof rules.min_font_pt === "number" ? rules.min_font_pt : minFontPt;
	for (const slot of allSlots(slotSpec)) {
		if (slot.kind !== "text") continue;
		const entry = placeholderIndex.get(`${slot.layoutId}|${slot.idx}`);
		const suggested = entry?.placeholder?.textDefaults?.suggested_font_size_pt;
		const size = typeof slot.fontPt === "number" ? slot.fontPt : (typeof suggested === "number" ? suggested : undefined);
		const location = { layoutId: slot.layoutId, slotKey: slot.key, idx: slot.idx, logicalName: slot.logicalName };
		if (size === undefined) {
			add({
				code: "font-size-unresolved",
				severity: "error",
				message: `版式 ${slot.layoutId} 的槽位 ${slot.key}（idx=${slot.idx}）沿继承链解不出字号：写进去的字号完全依赖 PowerPoint 默认值`,
				location,
				compensated: true,
				hint: `构建器会把写入的 run 抬到 ${floor}pt，但模板侧仍建议显式声明字号`
			});
			continue;
		}
		if (size < floor) {
			add({
				code: "font-size-below-floor",
				severity: "error",
				message: `版式 ${slot.layoutId} 的槽位 ${slot.key}（idx=${slot.idx}）有效字号 ${size}pt < 下限 ${floor}pt`,
				location: { ...location, sizePt: size, minFontPt: floor },
				compensated: true,
				hint: `构建器会把写入的 run 抬到 ${floor}pt；要彻底修好就在模板里把该占位符字号改到 ≥${floor}pt`
			});
		}
	}
	// 未被任何槽位使用、但字号偏小的文字占位符：构建器不会写它，也不会抬它的字号，
	// 所以这类问题**不会被兜住**（只是影响面小），按 warning 报。
	const usedKeys = new Set(allSlots(slotSpec).map((slot) => `${slot.layoutId}|${slot.idx}`));
	for (const layout of summary.layouts ?? []) {
		for (const placeholder of layout.placeholders ?? []) {
			if (!["text", "markdown-text"].some((type) => (placeholder.supportedContentTypes ?? []).includes(type))) continue;
			if (usedKeys.has(`${layout.id}|${placeholder.idx}`)) continue;
			const size = placeholder.capacity?.font_size_pt;
			if (typeof size !== "number" || size >= floor) continue;
			add({
				code: "font-size-below-floor-unfilled",
				severity: "warning",
				message: `版式 ${layout.id} 有未被槽位使用的文字占位符 idx=${placeholder.idx}（提示「${String(placeholder.guidanceText ?? "").slice(0, 20)}」）字号 ${size}pt < ${floor}pt`,
				location: { layoutId: layout.id, idx: placeholder.idx, sizePt: size },
				compensated: false
			});
		}
	}
}

/** ④ 中文字体槽：静态文字/占位符提示文字缺 `a:ea`。 */
async function checkCjkTypefaces({ summary, pkg, add }) {
	if (!pkg.sourceTemplate || !existsSync(pkg.sourceTemplate)) {
		add({ code: "cjk-typeface-unchecked", severity: "info", message: "manifest 包内没有源模板副本，跳过 `a:ea` 检查（不代表通过）", location: { path: pkg.dir } });
		return;
	}
	let scan;
	try {
		scan = await scanPresentationXml(await readFile(pkg.sourceTemplate));
	} catch (error) {
		add({ code: "cjk-typeface-unchecked", severity: "info", message: `源模板 XML 解析失败，跳过 a:ea 检查：${error.message}`, location: { path: pkg.sourceTemplate } });
		return;
	}
	if (!scan.ok) {
		add({ code: "cjk-typeface-unchecked", severity: "info", message: `源模板 XML 不可用（${scan.error}），跳过 a:ea 检查`, location: { path: pkg.sourceTemplate } });
		return;
	}
	const layoutByIndex = new Map((summary.layouts ?? []).map((layout) => [layout.sourceLayoutIndex, layout]));
	for (const layout of scan.layouts) {
		const known = layoutByIndex.get(layout.index);
		const layoutId = known?.id ?? layout.name ?? `slideLayout${layout.index + 1}`;
		for (const run of layout.staticRuns ?? []) {
			if (!hasCjk(run.text) || run.hasEa) continue;
			add({
				code: "cjk-typeface-missing",
				severity: "warning",
				message: `版式「${layout.name ?? layoutId}」的静态文字「${String(run.text).slice(0, 24)}」没有 a:ea：中文只能靠系统回退（不保证微软雅黑）`,
				location: { layoutId, shapeName: run.shapeName, text: String(run.text).slice(0, 40) },
				compensated: true,
				hint: "构建器会把版式静态文字统一成 latin=Arial / ea=微软雅黑；建议在模板里直接补 a:ea"
			});
		}
		const promptRuns = (layout.placeholders ?? []).flatMap((placeholder) => (placeholder.runs ?? []).filter((run) => hasCjk(run.text) && !run.hasEa));
		if (promptRuns.length > 0) {
			add({
				code: "cjk-typeface-missing-in-prompt",
				severity: "info",
				message: `版式「${layout.name ?? layoutId}」有 ${promptRuns.length} 个提示文字 run 缺 a:ea（提示文字会被内容覆盖，影响仅限模板编辑态）`,
				location: { layoutId, count: promptRuns.length },
				compensated: true
			});
		}
	}
}

/** ⑤ 项目符号：mode=paragraph 的槽位继承了模板项目符号。 */
async function checkTemplateBullets({ slotSpec, summary, pkg, placeholderIndex, add }) {
	if (!pkg.sourceTemplate || !existsSync(pkg.sourceTemplate)) {
		add({ code: "template-bullet-unchecked", severity: "info", message: "manifest 包内没有源模板副本，跳过项目符号检查（不代表通过）", location: { path: pkg.dir } });
		return;
	}
	let scan;
	try {
		scan = await scanPresentationXml(await readFile(pkg.sourceTemplate));
	} catch {
		scan = { ok: false };
	}
	if (!scan.ok) {
		add({ code: "template-bullet-unchecked", severity: "info", message: "源模板 XML 不可用，跳过项目符号检查", location: { path: pkg.sourceTemplate } });
		return;
	}
	const bodyLevels = scan.masters[0]?.styles?.body ?? {};
	const xmlByIndex = new Map(scan.layouts.map((layout) => [layout.index, layout]));
	for (const layout of slotSpec.layouts ?? []) {
		const summaryLayout = (summary.layouts ?? []).find((candidate) => candidate.id === layout.layoutId);
		const xmlLayout = summaryLayout ? xmlByIndex.get(summaryLayout.sourceLayoutIndex) : undefined;
		for (const slot of layout.slots ?? []) {
			if (slot.kind !== "text" || slot.mode !== PARAGRAPH_MODE) continue;
			const xmlPlaceholder = (xmlLayout?.placeholders ?? []).find((placeholder) => placeholder.idx === slot.idx);
			if (xmlPlaceholder === undefined) continue;
			if (!bulletLeaksInto(xmlPlaceholder, bodyLevels)) continue;
			add({
				code: "template-bullet-leak",
				severity: "error",
				message: `版式 ${layout.layoutId} 的槽位 ${slot.key}（idx=${slot.idx}）会继承模板项目符号：正文会变成分点`,
				location: { layoutId: layout.layoutId, slotKey: slot.key, idx: slot.idx },
				compensated: true,
				hint: "构建器对 mode=paragraph 的槽位会剥掉 buChar 并补 buNone；要彻底修好就在模板里给该占位符加「无项目符号」"
			});
		}
	}
	void placeholderIndex;
}

/** ⑥ 必填槽：角色要求的槽位在这个版式里找不到。 */
function checkRequiredSlots({ slotSpec, add }) {
	for (const missing of slotSpec.missingSlots ?? []) {
		if (missing.required) {
			add({
				code: "required-slot-missing",
				severity: "error",
				message: `角色 ${missing.role}（版式 ${missing.layoutId}）缺必填槽 ${missing.key}：期望提示文字匹配 ${JSON.stringify(missing.expectedPrompts)}`,
				location: { layoutId: missing.layoutId, role: missing.role, slotKey: missing.key },
				compensated: false,
				hint: "在模板里补上该占位符（并写约定提示文字），或改 slots.json / 角色表把该槽标为可选"
			});
		} else {
			add({
				code: "optional-slot-missing",
				severity: "info",
				message: `角色 ${missing.role}（版式 ${missing.layoutId}）没有可选槽 ${missing.key}`,
				location: { layoutId: missing.layoutId, role: missing.role, slotKey: missing.key }
			});
		}
	}
}

/** pptx-cli doctor / init-report 的 findings 并入报告（不可用时给明确的 info）。 */
async function collectCliFindings({ manifestDir, add, cli }) {
	const doctor = await doctorReport({ manifestDir, ...cli });
	if (!doctor.available) {
		add({ code: "cli-unavailable", severity: "info", message: doctor.error ?? "pptx-cli 不可用，跳过 doctor 检查", location: { path: manifestDir } });
		return;
	}
	if (!doctor.ok) {
		add({ code: "cli-doctor-failed", severity: "warning", message: doctor.error ?? "pptx-cli doctor 未通过", location: { path: manifestDir }, errors: doctor.errors });
		return;
	}
	for (const finding of doctor.envelope?.result?.findings ?? []) {
		const severity = finding.severity === "error" ? "error" : (finding.severity === "warning" ? "warning" : "info");
		add({
			code: "cli-finding",
			severity,
			message: `[${finding.code}] ${finding.message}`,
			location: { path: manifestDir, cliCode: finding.code }
		});
	}
}

/** 汇总报告：稳定 JSON 结构 + 人类可读摘要。 */
function finalize({ manifestDir, template, findings, slotSpec, minFontPt, extra }) {
	const counts = { error: 0, warning: 0, info: 0 };
	let compensated = 0;
	let compensatedErrors = 0;
	let blocking = 0;
	for (const finding of findings) {
		counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
		if (finding.compensated) compensated += 1;
		if (finding.severity === "error" && finding.compensated) compensatedErrors += 1;
		if (finding.severity === "error" && !finding.compensated) blocking += 1;
	}
	const ruleCounts = {};
	for (const finding of findings) ruleCounts[finding.code] = (ruleCounts[finding.code] ?? 0) + 1;
	const summary = {
		...counts,
		blocking,
		compensated,
		compensatedErrors,
		rules: Object.entries(ruleCounts).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
	};
	const report = {
		schemaVersion: LINT_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		template: {
			id: template.id,
			version: template.version,
			name: template.name,
			manifestDir,
			manifestSource: extra.manifestSource,
			pptxCliVersion: template.pptxCliVersion,
			cliModule: extra.cliModule,
			templateInfo: extra.templateInfo,
			pageSize: extra.pageSize,
			layoutCount: extra.layoutCount
		},
		policy: { minFontPt, fonts: slotSpec?.policy?.fonts, bodyMode: slotSpec?.policy?.bodyMode, family: slotSpec?.family },
		ok: blocking === 0 && extra.manifestSource === "manifest",
		summary,
		findings,
		...(extra.destructiveChanges ? { destructiveChanges: extra.destructiveChanges } : {}),
		...(slotSpec ? { slots: { roles: slotSpec.roles, layouts: (slotSpec.layouts ?? []).map((layout) => ({ layoutId: layout.layoutId, role: layout.role, slots: (layout.slots ?? []).map((slot) => slot.key) })) } } : {})
	};
	report.humanSummary = humanSummary(report);
	return report;
}

/** 人类可读摘要（给 Agent 与终端直接看）。 */
export function humanSummary(report) {
	const lines = [];
	const name = report.template?.id ? `${report.template.id}@${report.template.version ?? "?"}` : (report.template?.manifestDir ?? "(未知模板)");
	lines.push(`模板 ${name} 体检：${report.ok ? "通过" : "未通过"}；error ${report.summary.error}（必须修 ${report.summary.blocking}，构建器兜住 ${report.summary.compensatedErrors}）、warning ${report.summary.warning}、info ${report.summary.info}。`);
	if ((report.findings ?? []).length === 0) {
		lines.push("未发现问题。");
		return lines.join("\n");
	}
	const shown = (report.findings ?? []).filter((finding) => finding.severity === "error").slice(0, 12);
	for (const finding of shown) {
		const where = [finding.location?.layoutId, finding.location?.slotKey ? `槽位 ${finding.location.slotKey}` : undefined, finding.location?.idx !== undefined ? `idx=${finding.location.idx}` : undefined].filter(Boolean).join(" / ");
		lines.push(`- [error] ${finding.code}${where ? `（${where}）` : ""}：${finding.message}${finding.compensated ? "（构建器会兜住）" : ""}`);
	}
	const more = (report.findings ?? []).filter((finding) => finding.severity === "error").length - shown.length;
	if (more > 0) lines.push(`- …另有 ${more} 条 error，见 lint.json`);
	return lines.join("\n");
}

/** 写 lint.json（调用方给目录）。 */
export async function writeLintReport(dir, report) {
	const { writeFile } = await import("node:fs/promises");
	const path = join(dir, LINT_REPORT_FILE);
	await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return path;
}

/** 解析模板目录里的 slots.json（与 lint.json 同目录）。 */
export function slotsSpecPath(dir) {
	return join(dir, SLOTS_SPEC_FILE);
}

/** 模板版本的 manifest 目录：<templatesDir>/<id>/v<version>/manifest。 */
export function manifestDirFor(templatesDir, id, version) {
	return join(templatesDir, id, `v${version}`, "manifest");
}

/** 模板版本的根目录（slots.json / GUIDE.md / lint.json 放这里）。 */
export function templateVersionDirFor(templatesDir, id, version) {
	return join(templatesDir, id, `v${version}`);
}

/** 读取 YAML 文件（供外部小工具复用），失败返回 undefined。 */
export async function readYamlFile(path) {
	try {
		return yaml.load(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** 便捷：从模板版本行（{source:{file}}）定位 manifest 目录。 */
export function manifestDirFromSource(sourceFile) {
	return join(dirname(sourceFile), "manifest");
}

export { indexSlotSpec };
