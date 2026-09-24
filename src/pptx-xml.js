/**
 * dsh-lab-agent: PPTX 版式 XML 扫描（静态层 / 字体槽 / 项目符号证据）。
 *
 * 为什么需要它：pptx-cli 的 manifest 给出的是**契约级**信息（版式、占位符提示文字、
 * 几何、有效字号、静态元素指纹），但不含 `a:ea` 是否存在、占位符自身有没有
 * `a:buNone` —— 而这两点正是「中文静默回退」与「模板自带项目符号被带进正文」的
 * 根因（本模板的母版 bodyStyle 九级全带 `a:buChar`，占位符不写 `a:buNone` 就继承）。
 *
 * 全部为只读解析，不修改任何文件；解析失败返回空结果，由调用方按"检查不可用"上报，
 * 绝不静默当成"通过"。
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	removeNSPrefix: false,
	parseAttributeValue: false,
	// 只关心文本与属性：不把「2026」之类的文本节点转成数字，避免文本被吞掉。
	parseTagValue: false
});

const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const BULLET_TAGS = ["a:buChar", "a:buAutoNum", "a:buFont"];

/** 文本是否含中日韩字符（只有含 CJK 时才要求 `a:ea`）。 */
export function hasCjk(text) {
	return CJK_RE.test(String(text ?? ""));
}

/** fast-xml-parser 对单元素给对象、多元素给数组：统一成数组。 */
function asArray(value) {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

/** 在一个 `a:lvlNpPr` / `a:pPr` 节点里找项目符号证据。 */
function bulletEvidence(properties) {
	const found = [];
	for (const node of asArray(properties)) {
		for (const tag of BULLET_TAGS) {
			if (node?.[tag] !== undefined) found.push(tag);
		}
		if (node?.["a:buNone"] !== undefined) found.push("a:buNone");
	}
	return found;
}

/** 收集一个 txBody 里的：lstStyle 各层 pPr、以及段落/run 明细。 */
function scanTextBody(txBody) {
	const lstStyle = asArray(txBody?.["a:lstStyle"]);
	const levelProps = lstStyle.flatMap((style) => Object.entries(style ?? {})
		.filter(([key]) => /^a:lvl\d+pPr$/.test(key))
		.map(([key, value]) => ({ level: Number(/lvl(\d+)/.exec(key)[1]), value, raw: style })));
	const runs = [];
	for (const paragraph of asArray(txBody?.["a:p"])) {
		const pPr = paragraph?.["a:pPr"];
		const paragraphBullets = bulletEvidence(pPr);
		for (const run of asArray(paragraph?.["a:r"])) {
			const rPr = run?.["a:rPr"];
			const text = asArray(run?.["a:t"]).map((t) => (typeof t === "string" ? t : String(t?.["#text"] ?? ""))).join("");
			runs.push({
				text,
				sizePt: rPr?.["@_sz"] !== undefined ? Number(rPr["@_sz"]) / 100 : undefined,
				latinTypeface: rPr?.["a:latin"]?.["@_typeface"],
				eaTypeface: rPr?.["a:ea"]?.["@_typeface"],
				hasEa: rPr?.["a:ea"] !== undefined && String(rPr["a:ea"]?.["@_typeface"] ?? "") !== "",
				paragraphBullets
			});
		}
	}
	const ownBullets = [
		...levelProps.flatMap((level) => bulletEvidence(level.value)),
		...asArray(txBody?.["a:p"]).flatMap((paragraph) => bulletEvidence(paragraph?.["a:pPr"]))
	];
	const defaultLevel = levelProps.find((level) => level.level === 1)?.value;
	return {
		runs,
		ownBullets,
		defaultSizePt: defaultLevel?.["a:defRPr"]?.["@_sz"] !== undefined ? Number(defaultLevel["a:defRPr"]["@_sz"]) / 100 : undefined,
		defaultLatin: defaultLevel?.["a:defRPr"]?.["a:latin"]?.["@_typeface"],
		defaultEa: defaultLevel?.["a:defRPr"]?.["a:ea"]?.["@_typeface"]
	};
}

/** 扫描一份 slideLayout XML → 版式名 + 占位符 + 静态文本 run。 */
export function scanLayoutXml(xml) {
	let doc;
	try {
		doc = parser.parse(xml);
	} catch {
		return undefined;
	}
	const cSld = doc?.["p:sldLayout"]?.["p:cSld"];
	const name = typeof cSld?.["@_name"] === "string" ? cSld["@_name"] : undefined;
	const shapes = asArray(cSld?.["p:spTree"]?.["p:sp"]);
	const placeholders = [];
	const staticRuns = [];
	for (const shape of shapes) {
		const ph = shape?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"];
		const scanned = scanTextBody(shape?.["p:txBody"]);
		if (ph !== undefined) {
			const idx = ph?.["@_idx"] !== undefined ? Number(ph["@_idx"]) : undefined;
			placeholders.push({
				idx: Number.isFinite(idx) ? idx : undefined,
				type: typeof ph?.["@_type"] === "string" ? ph["@_type"] : "body",
				shapeName: shape?.["p:nvSpPr"]?.["p:cNvPr"]?.["@_name"],
				...scanned
			});
		} else {
			for (const run of scanned.runs) staticRuns.push({ shapeName: shape?.["p:nvSpPr"]?.["p:cNvPr"]?.["@_name"], ...run });
		}
	}
	return { name, placeholders, staticRuns };
}

/** 扫描母版 txStyles 的各级项目符号（正文占位符不写 buNone 时的继承来源）。 */
export function scanMasterTextStyles(xml) {
	let doc;
	try {
		doc = parser.parse(xml);
	} catch {
		return undefined;
	}
	const txStyles = doc?.["p:sldMaster"]?.["p:txStyles"];
	const buckets = {};
	for (const [styleKey, bucket] of [["title", "p:titleStyle"], ["body", "p:bodyStyle"], ["other", "p:otherStyle"]]) {
		const node = txStyles?.[bucket];
		if (node === undefined) continue;
		const levels = {};
		for (const [key, value] of Object.entries(node)) {
			const match = /^a:lvl(\d+)pPr$/.exec(key);
			if (!match) continue;
			levels[Number(match[1])] = {
				bullets: bulletEvidence(value).filter((tag) => tag !== "a:buNone"),
				buNone: bulletEvidence(value).includes("a:buNone"),
				sizePt: value?.["a:defRPr"]?.["@_sz"] !== undefined ? Number(value["a:defRPr"]["@_sz"]) / 100 : undefined
			};
		}
		buckets[styleKey] = levels;
	}
	return buckets;
}

/** 打开 pptx 并扫描全部版式与母版。`buffer` 为文件字节。 */
export async function scanPresentationXml(buffer) {
	let zip;
	try {
		zip = await JSZip.loadAsync(buffer);
	} catch {
		return { ok: false, error: "not a valid zip/pptx file" };
	}
	const layoutNames = Object.keys(zip.files)
		.filter((path) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path))
		.sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
	if (layoutNames.length === 0) return { ok: false, error: "no ppt/slideLayouts/*.xml in package" };
	const layouts = [];
	for (const [index, path] of layoutNames.entries()) {
		const scanned = scanLayoutXml(await zip.file(path).async("string"));
		layouts.push({ index, partName: path, ...(scanned ?? { name: undefined, placeholders: [], staticRuns: [] }) });
	}
	const masterNames = Object.keys(zip.files)
		.filter((path) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(path))
		.sort();
	const masters = [];
	for (const path of masterNames) {
		const styles = scanMasterTextStyles(await zip.file(path).async("string"));
		masters.push({ partName: path, styles: styles ?? {} });
	}
	return { ok: true, layouts, masters };
}

/**
 * 占位符是否会把模板自带项目符号带进正文。
 * 判定：占位符自身既没有 `a:buNone`，母版对应级别又带项目符号 → 继承泄漏。
 */
export function bulletLeaksInto(placeholder, bodyLevels) {
	if (placeholder?.ownBullets?.includes("a:buNone")) return false;
	if ((placeholder?.ownBullets ?? []).some((tag) => BULLET_TAGS.includes(tag))) return true;
	const level1 = (bodyLevels ?? {})[1];
	return Boolean(level1 && level1.buNone !== true && (level1.bullets ?? []).length > 0);
}
