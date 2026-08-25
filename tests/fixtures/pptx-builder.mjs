/**
 * dsh-lab-agent: PPTX fixture builder for tests.
 *
 * Generates minimal-but-structural .pptx files (zip + OOXML) covering the
 * parsing surface: page size, theme colors/fonts, masters, layouts, and
 * placeholders. Three template presets exercise the import flow (§八 PPT
 * 模板测试：至少三种课题组模板、比例/字体/颜色/占位符识别).
 */

import JSZip from "jszip";

const NS = {
	a: "http://schemas.openxmlformats.org/drawingml/2006/main",
	r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
	p: "http://schemas.openxmlformats.org/presentationml/2006/main",
	pkgRel: "http://schemas.openxmlformats.org/package/2006/relationships"
};

export function layoutXml({ name, placeholders }) {
	const sps = placeholders
		.map((ph, i) => {
			const phAttrs = ph.type === "title" || ph.type === "subtitle"
				? `type="${ph.type}"`
				: `type="${ph.type}" idx="${ph.idx}"`;
			return `<p:sp><p:nvSpPr><p:cNvPr id="${100 + i}" name="${name} ${i + 1}"/><p:cNvSpPr/><p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
		})
		.join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" preserve="1">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    ${sps}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

export function themeXml({ name, accent, font }) {
	const accents = [accent, "2E74B5", "F4B183", "70AD47", "FFC000", "ED7D31", "7030A0"]
		.map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c.replace("#", "")}"/></a:accent${i + 1}>`)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${NS.a}" name="${name}">
  <a:themeElements>
    <a:clrScheme name="${name}">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:dk2><a:srgbClr val="1F3864"/></a:dk2>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:lt2><a:srgbClr val="D6E4F0"/></a:lt2>
      ${accents}
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="${name}">
      <a:majorFont><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst/></a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}

function presentationXml(size, slideCount) {
	const sldSz = size.type ? `<p:sldSz cx="${size.cx}" cy="${size.cy}" type="${size.type}"/>` : `<p:sldSz cx="${size.cx}" cy="${size.cy}"/>`;
	const sldIdLst = slideCount > 0
		? `<p:sldIdLst>${Array.from({ length: slideCount }, (_, i) => `<p:sldId id="256${i}" r:id="rIdS${i + 1}"/>`).join("")}</p:sldIdLst>`
		: "";
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  ${sldIdLst}
  ${sldSz}
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

const CONTENT_TYPES_SLIDES = (slideCount, layoutCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${Array.from({ length: layoutCount }, (_, i) => `<Override PartName="/ppt/slideLayouts/slideLayout${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join("\n  ")}
  ${Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n  ")}
</Types>`;

/**
 * 生成一个最小但结构完整的 pptx。
 * @param options {{ name, size?, accent?, font?, layouts?, slides?: number }}
 * @returns { name, buffer: Buffer }
 */
export async function buildPptx(options) {
	const size = options.size ?? { cx: 12192000, cy: 6858000, type: "wide" };
	const accent = options.accent ?? "#1F4E79";
	const font = options.font ?? "Microsoft YaHei";
	const layouts = options.layouts ?? defaultLayouts();
	const slideCount = options.slides ?? 0;
	const zip = new JSZip();

	zip.file("[Content_Types].xml", CONTENT_TYPES_SLIDES(slideCount, layouts.length));
	zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
	zip.file("ppt/presentation.xml", presentationXml(size, slideCount));
	const presRels = [
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
		...Array.from({ length: slideCount }, (_, i) => `<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
	].join("");
	zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.pkgRel}">${presRels}</Relationships>`);
	zip.file("ppt/theme/theme1.xml", themeXml({ name: options.name, accent, font }));
	const layoutIds = layouts.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("");
	zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>
  <p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`);
	const masterRels = layouts
		.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${i + 1}.xml"/>`)
		.concat([`<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`])
		.join("");
	zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.pkgRel}">${masterRels}</Relationships>`);
	layouts.forEach((layout, i) => {
		const id = i + 1;
		zip.file(`ppt/slideLayouts/slideLayout${id}.xml`, layoutXml(layout));
		zip.file(`ppt/slideLayouts/_rels/slideLayout${id}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.pkgRel}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);
	});
	for (let i = 1; i <= slideCount; i++) {
		zip.file(`ppt/slides/slide${i}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);
		zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS.pkgRel}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${Math.min(i, layouts.length)}.xml"/>
</Relationships>`);
	}

	const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
	return { name: options.name, buffer };
}

export function defaultLayouts() {
	return [
		{ name: "Title Slide", placeholders: [{ type: "title", idx: 0 }, { type: "subtitle", idx: 1 }] },
		{ name: "Title and Content", placeholders: [{ type: "title", idx: 0 }, { type: "body", idx: 1 }] },
		{ name: "Blank", placeholders: [] },
		{ name: "Picture with Caption", placeholders: [{ type: "title", idx: 0 }, { type: "pic", idx: 1 }, { type: "body", idx: 2 }] },
		{ name: "Comparison", placeholders: [{ type: "title", idx: 0 }, { type: "body", idx: 1 }, { type: "body", idx: 2 }, { type: "body", idx: 3 }] }
	];
}

/** 三种课题组模板预设（比例/主题/布局各不相同）。 */
export async function buildThreeTemplates() {
	const a = await buildPptx({
		name: "lab-blue-169",
		size: { cx: 12192000, cy: 6858000, type: "wide" },
		accent: "#1F4E79",
		font: "Microsoft YaHei",
		layouts: defaultLayouts()
	});
	const b = await buildPptx({
		name: "lab-green-43",
		size: { cx: 9144000, cy: 6858000, type: "screen4x3" },
		accent: "#548235",
		font: "SimSun",
		layouts: [
			{ name: "Cover 43", placeholders: [{ type: "title", idx: 0 }] },
			{ name: "Content 43", placeholders: [{ type: "title", idx: 0 }, { type: "body", idx: 1 }] },
			{ name: "Blank 43", placeholders: [] }
		]
	});
	const c = await buildPptx({
		name: "lab-red-169",
		size: { cx: 12192000, cy: 6858000, type: "wide" },
		accent: "#C00000",
		font: "KaiTi",
		layouts: [
			{ name: "Red Cover", placeholders: [{ type: "title", idx: 0 }, { type: "subtitle", idx: 1 }] },
			{ name: "Red Content", placeholders: [{ type: "title", idx: 0 }, { type: "body", idx: 1 }] },
			{ name: "Red Figure", placeholders: [{ type: "pic", idx: 0 }, { type: "body", idx: 1 }] },
			{ name: "Red Compare", placeholders: [{ type: "title", idx: 0 }, { type: "body", idx: 1 }, { type: "body", idx: 2 }, { type: "body", idx: 3 }] }
		]
	});
	return [a, b, c];
}
