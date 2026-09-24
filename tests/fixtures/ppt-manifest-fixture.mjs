/**
 * 测试夹具：合成一份「中文期刊图文汇报」模板的 pptx-cli manifest 包。
 *
 * 为什么不用真实模板：真实模板含校徽/课题组 logo 与未确认再分发的内容，**不入库**。
 * 这里用一份结构等价（同角色、同提示文字约定、同缺陷类型）的合成模板，覆盖：
 *   * 角色识别：cover / abstract / figure-1 / figure-3 / summary / thanks；
 *   * 图注规则：figure-1 有图注槽，figure-3 没有（用户约定）；
 *   * 缺陷类型：图注 14pt（低于下限）、图注占位符没有 a:buNone（会继承母版项目符号）、
 *     版式静态中文没有 a:ea；
 *   * 静态层：逐版式一致的三件套（蓝线/logo/页标题），以及 fig2 故意漂移的对照组。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import yaml from "js-yaml";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const EMU_IN = 914400;

/** 一个占位符在夹具里的定义。 */
function placeholder({ idx, type = "body", prompt, left = 0.2, top = 1, width = 5, height = 1, sizePt, latin = "Arial", ea, buNone = true, guideCjkNoEa = false }) {
	return { idx, type, prompt, left, top, width, height, sizePt, latin, ea, buNone, guideCjkNoEa };
}

const LAYOUTS = [
	{
		id: "item", name: "标题幻灯片", index: 0, role: "cover",
		placeholders: [
			placeholder({ idx: 10, prompt: "论文中文标题", top: 3.5, sizePt: 28, ea: "微软雅黑" }),
			placeholder({ idx: 11, prompt: "English Paper Title", top: 4.0, sizePt: 28, ea: "微软雅黑" }),
			placeholder({ idx: 12, prompt: "演讲人姓名", top: 5.2, width: 3, sizePt: 20, ea: "微软雅黑" }),
			placeholder({ idx: 13, prompt: "日期：2026/XX/XX", left: 7, top: 5.2, width: 3, sizePt: 20, ea: "微软雅黑" })
		]
	},
	{
		id: "abs", name: "Abs", index: 1, role: "abstract",
		placeholders: [
			placeholder({ idx: 10, type: "pic", prompt: "摘要截图", left: 0.2, top: 1.0, width: 8, height: 5, buNone: false }),
			placeholder({ idx: 15, prompt: "【此处粘贴论文摘要的中文翻译全文。建议 3-6 句，一个自然段。】", left: 8.5, top: 1.0, width: 4, height: 6, sizePt: 20, ea: "微软雅黑" })
		]
	},
	{
		id: "fig1", name: "Fig1", index: 2, role: "figure-1",
		placeholders: [
			placeholder({ idx: 10, type: "pic", prompt: "Fig1图占位", left: 0.2, top: 1.0, width: 8, height: 5.2, buNone: false }),
			// 故意的模板侧缺陷：14pt + 没有 buNone（会继承母版项目符号）。
			placeholder({ idx: 12, prompt: "Fig.1图注", left: 0.2, top: 6.4, width: 8, height: 0.4, sizePt: 14, latin: "微软雅黑", ea: "微软雅黑", buNone: false }),
			placeholder({ idx: 15, prompt: "【此处概括论文 Fig.1 对应的内容。不要分点，填满右侧剩余部分】", left: 8.5, top: 1.0, width: 4, height: 6, sizePt: 20, ea: "微软雅黑" })
		]
	},
	{
		id: "fig2", name: "Fig2", index: 3, role: "figure-2",
		placeholders: [
			placeholder({ idx: 10, type: "pic", prompt: "Fig2图占位", left: 2.6, top: 1.0, width: 8, height: 5.2, buNone: false }),
			placeholder({ idx: 12, prompt: "Fig.2图注", left: 2.6, top: 6.4, width: 8, height: 0.4, sizePt: 14, latin: "微软雅黑", ea: "微软雅黑", buNone: false }),
			placeholder({ idx: 15, prompt: "【此处概括论文 Fig.2 对应的内容。不要分点，填满左侧剩余部分】", left: 0.2, top: 1.0, width: 2.2, height: 6, sizePt: 20, ea: "微软雅黑" })
		]
	},
	{
		id: "fig3", name: "Fig3", index: 4, role: "figure-3",
		placeholders: [
			placeholder({ idx: 10, type: "pic", prompt: "Fig3图占位", left: 0.2, top: 1.0, width: 12, height: 4.4, buNone: false }),
			placeholder({ idx: 15, prompt: "【此处概括论文 Fig.3 对应的内容。不要分点，填满下侧剩余部分】", left: 0.2, top: 5.6, width: 12, height: 1.6, sizePt: 20, ea: "微软雅黑" })
		]
	},
	{
		id: "end", name: "End", index: 5, role: "summary",
		placeholders: [
			placeholder({ idx: 14, prompt: "本文实现的创新方法有：（1）【创新点一】", left: 0.2, top: 1.0, width: 12, height: 2.4, sizePt: 20, ea: "微软雅黑" }),
			placeholder({ idx: 15, prompt: "【第一段：概括文章主要工作。】", left: 0.2, top: 3.6, width: 12, height: 1.6, sizePt: 20, ea: "微软雅黑" }),
			placeholder({ idx: 16, prompt: "【可选：结尾补充段落。】", left: 0.2, top: 5.4, width: 12, height: 1.6, sizePt: 20, ea: "微软雅黑" })
		]
	},
	{
		id: "ppt-end", name: "PPT_END", index: 6, role: "thanks",
		placeholders: [placeholder({ idx: 10, prompt: "敬请各位批评指正", left: 3, top: 2.8, width: 7, height: 1, sizePt: 54, ea: "微软雅黑" })]
	}
];

/** 静态层三件套（逐版式一致）。 */
function protectedElements(layoutId, { shiftLogo = false } = {}) {
	const logoLeft = shiftLogo ? Math.round(9.9 * EMU_IN) : Math.round(9.65 * EMU_IN);
	return [
		{ element_id: `${layoutId}-protected-1`, element_type: "AUTO_SHAPE (1)", name: "Rectangle 3", left_emu: 0, top_emu: Math.round(0.85 * EMU_IN), width_emu: 12192000, height_emu: 45720, fingerprint: "sha256:line" },
		{ element_id: `${layoutId}-protected-2`, element_type: "PICTURE (13)", name: "Picture 4", left_emu: logoLeft, top_emu: Math.round(0.31 * EMU_IN), width_emu: 1400000, height_emu: 500000, fingerprint: "sha256:logo" },
		{ element_id: `${layoutId}-protected-3`, element_type: "TEXT_BOX (17)", name: "TextBox 5", left_emu: Math.round(0.5 * EMU_IN), top_emu: Math.round(0.3 * EMU_IN), width_emu: 3000000, height_emu: 400000, fingerprint: `sha256:title-${layoutId}` }
	];
}

/** 合成 manifest 对象（对应 pptx-cli manifest.yaml 的字段名）。 */
export function literatureManifest({ driftFig2StaticLayer = true } = {}) {
	return {
		manifest_version: 1,
		template: {
			name: "lab-lint-fixture",
			source_file: "source.pptx",
			source_hash: "sha256:fixture",
			extracted_at: "2026-09-24T00:00:00Z",
			stored_template_path: "assets/source-template.pptx"
		},
		presentation: {
			page_size: { width_emu: 12192000, height_emu: 6858000 },
			slide_count: LAYOUTS.length,
			theme: { name: "fixture", colors: { accent1: "5B9BD5" }, fonts: { major: "等线 Light", minor: "等线" } }
		},
		masters: [{ id: "master-1", name: "Slide Master 1", layout_ids: LAYOUTS.map((layout) => layout.id) }],
		layouts: LAYOUTS.map((layout) => ({
			id: layout.id,
			name: layout.name,
			aliases: [],
			source_master_id: "master-1",
			source_layout_index: layout.index,
			source_layout_name: layout.name,
			preview_path: `previews/layouts/${layout.id}.png`,
			placeholders: layout.placeholders.map((ph) => ({
				logical_name: `${ph.type === "pic" ? "picture" : "body"}_${ph.idx}`,
				source_name: "文本占位符 20",
				placeholder_idx: ph.idx,
				placeholder_type: ph.type,
				guidance_text: ph.prompt,
				guidance_lines: [ph.prompt],
				supported_content_types: ph.type === "pic" ? ["image"] : ["text", "markdown-text", "image", "table", "chart"],
				left_emu: Math.round(ph.left * EMU_IN),
				top_emu: Math.round(ph.top * EMU_IN),
				width_emu: Math.round(ph.width * EMU_IN),
				height_emu: Math.round(ph.height * EMU_IN),
				required: false,
				overflow_policy: "warn",
				text_defaults: { guidance_text: ph.prompt },
				estimated_text_capacity: ph.type === "pic" ? null : {
					max_lines: Math.max(1, Math.round(ph.height * 3)),
					source: "inferred",
					confidence: "medium",
					font_size_pt: ph.sizePt,
					font_family: ph.latin
				},
				inheritance_chain: ["master-1", layout.id]
			})),
			protected_static_elements: protectedElements(layout.id, { shiftLogo: driftFig2StaticLayer && layout.id === "fig2" }),
			validation_rules: { required_placeholders: [], protected_elements_locked: true }
		})),
		assets: [],
		rules: {},
		capabilities: {},
		compatibility_report: [],
		fingerprints: {}
	};
}

/** 合成一份「布局 XML」：静态中文页标题 + 占位符（提示文字 run 可选缺 a:ea）。 */
function layoutXml(layout) {
	const shapes = layout.placeholders.map((ph, index) => {
		const phAttrs = `type="${ph.type}" idx="${ph.idx}" hasCustomPrompt="1"`;
		const bulletPart = ph.buNone ? "<a:buNone/>" : "";
		const defRPr = `<a:defRPr sz="${(ph.sizePt ?? 20) * 100}"><a:latin typeface="${ph.latin}"/>${ph.ea ? `<a:ea typeface="${ph.ea}"/>` : ""}</a:defRPr>`;
		const guideEa = ph.guideCjkNoEa ? "" : "<a:ea typeface=\"微软雅黑\"/>";
		return `<p:sp><p:nvSpPr><p:cNvPr id="${100 + index}" name="文本占位符 20"/><p:cNvSpPr/><p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr>${bulletPart}${defRPr}</a:lvl1pPr></a:lstStyle>` +
			`<a:p><a:r><a:rPr lang="zh-CN"><a:latin typeface="${ph.latin}"/>${guideEa}<a:ea typeface="${ph.ea ?? "微软雅黑"}"/></a:rPr><a:t>${ph.prompt}</a:t></a:r></a:p></p:txBody></p:sp>`;
	}).join("");
	// 版式静态文字（非占位符）：中文页标题，**故意没有 a:ea**（规则④的命中目标）。
	const staticShape = `<p:sp><p:nvSpPr><p:cNvPr id="900" name="标题 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>` +
		`<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2000"><a:latin typeface="Arial"/></a:rPr><a:t>${layout.staticTitle}</a:t></a:r></a:p></p:txBody></p:sp>`;
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" preserve="1">
  <p:cSld name="${layout.name}"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    ${staticShape}
    ${shapes}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

/** 母版：bodyStyle 九级都带 a:buChar（真实模板就是这样，项目符号泄漏的根源）。 */
function masterXml() {
	const levels = Array.from({ length: 9 }, (_, index) => `<a:lvl${index + 1}pPr marL="${342900 * (index + 1)}" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="${2800 - index * 200}"/></a:lvl${index + 1}pPr>`).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:txStyles><p:titleStyle><a:lvl1pPr><a:buNone/><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
  <p:bodyStyle>${levels}</p:bodyStyle><p:otherStyle><a:defPPr/></p:otherStyle></p:txStyles>
</p:sldMaster>`;
}

/** 写一份完整的 manifest 包（manifest.yaml + 报告 + 指纹 + assets/source-template.pptx）。 */
export async function writeManifestPackage(dir, { manifest = literatureManifest(), skipSourceTemplate = false } = {}) {
	await mkdir(join(dir, "reports"), { recursive: true });
	await mkdir(join(dir, "fingerprints"), { recursive: true });
	await mkdir(join(dir, "assets"), { recursive: true });
	await writeFile(join(dir, "manifest.yaml"), yaml.dump(manifest, { noRefs: true, lineWidth: 200 }), "utf8");
	await writeFile(join(dir, "annotations.yaml"), yaml.dump({ template_annotations: { semantic_tags: [] }, layouts: manifest.layouts.map((layout) => ({ layout_id: layout.id, aliases: [], placeholder_overrides: [] })) }, { noRefs: true }), "utf8");
	await writeFile(join(dir, "reports", "init-report.json"), `${JSON.stringify({ findings: [{ code: "INFO_TEMPLATE_ANALYZED", severity: "info", message: "fixture", details: {} }], layout_count: manifest.layouts.length }, null, 2)}\n`, "utf8");
	await writeFile(join(dir, "fingerprints", "parts.json"), `${JSON.stringify({ "ppt/presentation.xml": "sha256:fixture" }, null, 2)}\n`, "utf8");
	if (!skipSourceTemplate) {
		const zip = new JSZip();
		zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${A}" xmlns:p="${P}"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
		zip.file("ppt/slideMasters/slideMaster1.xml", masterXml());
		for (const [index, layout] of LAYOUTS.entries()) {
			const withTitle = { ...layout, staticTitle: STATIC_TITLES[index] ?? "方法 Methods" };
			zip.file(`ppt/slideLayouts/slideLayout${index + 1}.xml`, layoutXml(withTitle));
		}
		await writeFile(join(dir, "assets", "source-template.pptx"), await zip.generateAsync({ type: "nodebuffer" }));
	}
	return dir;
}

const STATIC_TITLES = ["文献汇报", "摘要 Abstract", "方法 Methods", "方法 Methods", "方法 Methods", "总结 Conclusion", "敬请批评指正"];

/** 供测试直接断言用的布局清单（含预期的静态页标题）。 */
export const FIXTURE_LAYOUTS = LAYOUTS;
export { STATIC_TITLES };
