/**
 * dsh-lab-agent: PPTX 结构解析（纯 Node，无 Python 依赖）。
 *
 * 读取模板包的页面比例、主题色/字体、母版与布局、每个布局的占位符 ——
 * PptTemplateProfile 导入流程（计划 §四）的第一步：系统读取母版、布局、
 * 占位符、字体、主题色和页面比例，再据此自动提出版式角色映射。
 *
 * pptx = zip；这里用 jszip 解压 + fast-xml-parser 解析 OOXML。
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	removeNSPrefix: false,
	parseAttributeValue: false
});

export class PptxParseError extends Error {
	name = "PptxParseError";
}

function gcd(a, b) {
	return b === 0 ? a : gcd(b, a % b);
}

/** EMU 尺寸 → 最简比例字符串（如 "16:9"）。 */
export function emuRatio(cx, cy) {
	const g = gcd(cx, cy);
	return `${cx / g}:${cy / g}`;
}

/** 遍历解析后的 XML 树，收集所有键名匹配的节点（含数组元素）。 */
function collectByKey(node, key, out = []) {
	if (Array.isArray(node)) {
		for (const item of node) collectByKey(item, key, out);
		return out;
	}
	if (node === null || typeof node !== "object") return out;
	for (const [k, v] of Object.entries(node)) {
		if (k === key) out.push(v);
		else collectByKey(v, key, out);
	}
	return out;
}

/** 从 clrScheme 子节点提取颜色（srgbClr val / sysClr lastClr）。 */
function extractColor(slot) {
	if (slot == null) return undefined;
	if (typeof slot === "string") return slot;
	const inner = slot["a:srgbClr"] ?? slot["a:sysClr"];
	if (inner == null) return undefined;
	const val = inner["@_val"] ?? inner["@_lastClr"];
	return typeof val === "string" ? `#${val}` : undefined;
}

/** 从 fontScheme 提取主要/次要字体（latin typeface 优先，ea/cs 兜底）。 */
function extractFonts(fontScheme) {
	const pick = (slot) => {
		if (slot == null) return undefined;
		const latin = slot["a:latin"];
		if (latin && typeof latin["@_typeface"] === "string") return latin["@_typeface"];
		const ea = slot["a:ea"];
		if (ea && typeof ea["@_typeface"] === "string") return ea["@_typeface"];
		return undefined;
	};
	return {
		major: pick(fontScheme?.["a:majorFont"]),
		minor: pick(fontScheme?.["a:minorFont"])
	};
}

/** 解析一个布局 XML：名字 + 占位符清单。 */
function parseLayout(xml, id) {
	let doc;
	try {
		doc = parser.parse(xml);
	} catch {
		throw new PptxParseError(`cannot parse ${id}.xml`);
	}
	const placeholders = collectByKey(doc, "p:ph")
		.map((ph) => {
			const type = typeof ph["@_type"] === "string" ? ph["@_type"] : "body";
			const idx = typeof ph["@_idx"] === "string" ? Number(ph["@_idx"]) : undefined;
			return { type, idx: Number.isFinite(idx) ? idx : undefined };
		})
		.sort((a, b) => (a.idx ?? 999) - (b.idx ?? 999));
	let name = id;
	const cnvPr = collectByKey(doc, "p:cNvPr").find((n) => typeof n["@_name"] === "string");
	if (cnvPr && cnvPr["@_name"]) name = cnvPr["@_name"];
	return { id, name, placeholders };
}

/**
 * 解析一个 .pptx 文件内容。
 * @param {Buffer|Uint8Array} buffer pptx 文件字节。
 * @returns 结构化的模板元数据。
 */
export async function parsePptx(buffer) {
	let zip;
	try {
		zip = await JSZip.loadAsync(buffer);
	} catch {
		throw new PptxParseError("not a valid zip/pptx file");
	}
	const presentationPath = "ppt/presentation.xml";
	const presentationFile = zip.file(presentationPath);
	if (!presentationFile) throw new PptxParseError("missing ppt/presentation.xml — not a PowerPoint file");

	const presentation = parser.parse(await presentationFile.async("string"));

	// 页面比例
	const sldSz = presentation["p:presentation"]?.["p:sldSz"];
	let page;
	if (sldSz) {
		const cx = Number(sldSz["@_cx"]);
		const cy = Number(sldSz["@_cy"]);
		page = {
			cx,
			cy,
			ratio: Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0 ? emuRatio(cx, cy) : undefined,
			type: typeof sldSz["@_type"] === "string" ? sldSz["@_type"] : undefined
		};
	} else {
		throw new PptxParseError("missing p:sldSz in presentation.xml");
	}

	// 主题（第一个 theme 文件）
	const themeFiles = Object.keys(zip.files).filter((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p)).sort();
	let theme = undefined;
	if (themeFiles.length > 0) {
		const themeDoc = parser.parse(await zip.file(themeFiles[0]).async("string"));
		const clrScheme = collectByKey(themeDoc, "a:clrScheme")[0];
		const fontScheme = collectByKey(themeDoc, "a:fontScheme")[0];
		const slots = ["dk1", "dk2", "lt1", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
		theme = {
			name: typeof clrScheme?.["@_name"] === "string" ? clrScheme["@_name"] : undefined,
			colors: Object.fromEntries(
				slots.map((slot) => [slot, extractColor(clrScheme?.[`a:${slot}`])]).filter(([, v]) => v !== undefined)
			),
			fonts: extractFonts(fontScheme)
		};
	}

	// 母版与布局
	const layoutIds = Object.keys(zip.files)
		.filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
		.map((p) => p.replace(/^ppt\/slideLayouts\//, "").replace(/\.xml$/, ""))
		.sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));

	const layouts = [];
	for (const id of layoutIds) {
		const xml = await zip.file(`ppt/slideLayouts/${id}.xml`).async("string");
		layouts.push(parseLayout(xml, id));
	}

	// 布局 → 母版归属（通过 layout rels）
	const masterOf = {};
	for (const id of layoutIds) {
		const relsPath = `ppt/slideLayouts/_rels/${id}.xml.rels`;
		const relsFile = zip.file(relsPath);
		if (!relsFile) continue;
		const rels = parser.parse(await relsFile.async("string"));
		for (const rel of collectByKey(rels, "Relationship")) {
			if (String(rel["@_Type"] ?? "").includes("slideMaster")) {
				const target = String(rel["@_Target"] ?? "");
				const match = /slideMasters\/(slideMaster\d+)\.xml$/.exec(target);
				if (match) masterOf[id] = match[1];
			}
		}
	}

	const masterIds = Object.keys(zip.files)
		.filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p))
		.map((p) => p.replace(/^ppt\/slideMasters\//, "").replace(/\.xml$/, ""))
		.sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
	const masters = masterIds.map((id) => ({
		id,
		layouts: layoutIds.filter((l) => (masterOf[l] ?? "slideMaster1") === id)
	}));

	return {
		ok: true,
		page,
		theme,
		masters,
		layouts,
		layoutCount: layouts.length
	};
}
