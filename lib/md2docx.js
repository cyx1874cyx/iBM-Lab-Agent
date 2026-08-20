/**
 * dsh-lab-agent: markdown → .docx (Word) 纯 JS 转换器。
 *
 * 用途：精读报告（paper-card 为 Markdown）下载 Word 版时调用，把同一份
 * Markdown 内容渲染成 .docx 返回，无需 Python/pandoc/LibreOffice 及新的
 * npm 依赖（复用现有的 jszip）。
 *
 * 支持的 Markdown 子集（已覆盖现有精读卡/报告的全部语法）：
 *   - 标题 # ~ ######
 *   - 段落与行内加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 图片 ![alt](src)
 *   - 无序列表 `-`/`*`、有序列表 `1.`（多级缩进 → Word 编号层级）
 *   - 表格 `| a | b |`（首行为表头加粗）
 *   - 引用 `>`、分隔线 `---`
 *   - 围栏代码块 / 行内数学块 $$..$$（按等宽样式输出，保证不丢内容）
 * 图片不内嵌：转成 alt 文字，避免依赖磁盘图片路径。
 *
 * 对外 API：markdownToDocx(markdown, options?) → Promise<Buffer>
 */

import JSZip from "jszip";

const ESC_TEXT = (v) =>
	String(v)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/* ── 行内解析 ───────────────────────────────────────────────────────────── */
/** 递归解析行内语法，返回 run 节点数组（顺序 tokenizer）。 */
function parseInline(text) {
	const runs = [];
	const pushText = (s) => {
		if (s === "") return;
		const last = runs[runs.length - 1];
		if (last && last.text !== undefined && !last.code && !last.bold && !last.italic && !last.strike && !last.hyperlink) {
			last.text += s;
			return;
		}
		runs.push({ text: s });
	};
	const apply = (r, mark) => {
		if (r.length === 0) r.push({ text: "" });
		return r.map((x) => ({ ...x, bold: x.bold || !!mark.bold, italic: x.italic || !!mark.italic, strike: x.strike || !!mark.strike }));
	};
	let scan = 0;
	// 用 indexOf 查找标记，逐个产出
	while (scan < text.length) {
		// 找到下一个标记字符位置
		const rest = text.slice(scan);
		const idxOf = (ch) => text.indexOf(ch, scan);
		const backtick = idxOf("`");
		const dstar = idxOf("**");
		const dunder = idxOf("__");
		const tilde = idxOf("~~");
		const star = idxOf("*");
		const under = idxOf("_");
		const bangBracket = idxOf("![");
		const bracket = idxOf("[");
		const candidates = [
			backtick, dstar, dunder, tilde, star, under, bangBracket, bracket
		].map((v, kind) => ({ v, kind })).filter((c) => c.v !== -1)
			.sort((a, b) => a.v - b.v);
		if (candidates.length === 0) { pushText(rest); break; }
		const first = candidates[0];
		const K = first.kind;
		const pos = first.v;
		if (pos > scan) pushText(text.slice(scan, pos));
		scan = pos;
		const c = text[scan];
		if (K === 0) { // backtick 行内代码
			const j = text.indexOf("`", scan + 1);
			if (j !== -1) { runs.push({ code: text.slice(scan + 1, j) }); scan = j + 1; continue; }
			pushText(c); scan += 1; continue;
		}
		if (K === 1 || K === 2) { // ** bold / __ bold
			const closer = c === "*" ? "**" : "__";
			const j = text.indexOf(closer, scan + 2);
			if (j !== -1) { runs.push(...apply(parseInline(text.slice(scan + 2, j)), { bold: true })); scan = j + 2; continue; }
			pushText(c); scan += 1; continue;
		}
		if (K === 3) { // ~~ strike
			const j = text.indexOf("~~", scan + 2);
			if (j !== -1) { runs.push(...apply(parseInline(text.slice(scan + 2, j)), { strike: true })); scan = j + 2; continue; }
			pushText(c); scan += 1; continue;
		}
		if (K === 4 || K === 5) { // * italic / _ italic
			const closer = c === "*" ? "*" : "_";
			const j = text.indexOf(closer, scan + 1);
			if (j !== -1 && j > scan + 1) { runs.push(...apply(parseInline(text.slice(scan + 1, j)), { italic: true })); scan = j + 1; continue; }
			pushText(c); scan += 1; continue;
		}
		if (K === 6 || K === 7) { // ![alt](url) 图片 / [text](url) 链接
			const openAt = scan;
			const isImg = c === "!";
			const labelStart = isImg ? scan + 2 : scan + 1;
			const closeBracket = text.indexOf("]", labelStart);
			if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
				const urlStart = closeBracket + 2;
				const urlEnd = text.indexOf(")", urlStart);
				if (urlEnd !== -1) {
					const label = text.slice(labelStart, closeBracket);
					const url = text.slice(urlStart, urlEnd);
					if (isImg) runs.push({ text: `（图片：${label || url}）` });
					else runs.push({ hyperlink: url, runs: parseInline(label) });
					scan = urlEnd + 1;
					continue;
				}
			}
			pushText(c); scan += 1; continue;
		}
		// 兜底：单字符普通文本
		pushText(c);
		scan += 1;
	}
	return runs;
}

function runsToXml(runs, assignRel) {
	let out = "";
	for (let r of runs) {
		if (r.hyperlink !== undefined) {
			out += `<w:hyperlink r:id="${assignRel(r.hyperlink)}" w:history="1">${runsToXml(r.runs || [], assignRel)}</w:hyperlink>`;
			continue;
		}
		let rpr = "";
		if (r.bold) rpr += "<w:b/>";
		if (r.italic) rpr += "<w:i/>";
		if (r.strike) rpr += "<w:strike/>";
		if (r.code) rpr += `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>`;
		rpr = rpr ? `<w:rPr>${rpr}</w:rPr>` : "";
		const text = r.code !== undefined ? ESC_TEXT(r.code) : ESC_TEXT(r.text === undefined ? "" : r.text);
		out += `<w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
	}
	return out;
}

/* ── 块解析 ──────────────────────────────────────────────────────────────── */
function splitRow(line) {
	return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function parseBlocks(markdown) {
	const lines = String(markdown ?? "").split(/\r?\n/);
	const blocks = [];
	let norm = [];
	const flush = () => {
		if (norm.length) { blocks.push({ type: "paragraph", text: norm.join(" ") }); norm = []; }
	};
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const t = line.trim();
		if (t === "") { flush(); i++; continue; }
		if (line.startsWith("```") || line.startsWith("~~~")) {
			flush();
			const open = line.slice(0, 3);
			const code = [];
			i++;
			while (i < lines.length && !lines[i].trim().startsWith(open)) { code.push(lines[i]); i++; }
			i++; // 跳过闭合围栏
			blocks.push({ type: "code", code: code.join("\n") });
			continue;
		}
		// 行内数学块 $$（连续行直到闭合）
		if (t.startsWith("$$") && !/\$\$/.test(t.slice(2))) {
			flush();
			const code = [line];
			i++;
			while (i < lines.length && !(lines[i].includes("$$"))) { code.push(lines[i]); i++; }
			if (i < lines.length) code.push(lines[i]);
			i++;
			blocks.push({ type: "code", code: code.join("\n") });
			continue;
		}
		// 表格
		if (t.startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]*:?-+:?[\s:|]*\|?\s*$/.test(lines[i + 1]) && !lines[i + 1].includes("|") === false) {
			// 更稳的分隔行判定：下一行是全由 | - : 组成的行
			if (/^\s*\|?[\s\-|:]+$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
				flush();
				const header = splitRow(lines[i]);
				i += 2;
				const rows = [];
				while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(splitRow(lines[i])); i++; }
				blocks.push({ type: "table", header, rows });
				continue;
			}
		}
		// 列表
		const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
		if (item) {
			flush();
			const ordered = !/[-*+]/.test(item[2]);
			const depth = Math.min(Math.floor(item[1].length / 2), 8);
			let list = blocks[blocks.length - 1]?.type === "list" ? blocks.pop() : { type: "list", items: [] };
			let extra = "";
			let j = i + 1;
			while (j < lines.length && /^\s/.test(lines[j]) && !/^\s*(-|[*+]|\d+[.)])\s+/.test(lines[j]) && !/^[#|>`]/.test(lines[j].trim()) && lines[j].trim() !== "") {
				extra += " " + lines[j].trim();
				j++;
			}
			list.items.push({ ordered, depth, text: item[3] + extra });
			blocks.push(list);
			i++;
			continue;
		}
		// 引用
		if (t.startsWith(">")) {
			flush();
			const quote = [];
			while (i < lines.length && lines[i].trim().startsWith(">")) { quote.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
			blocks.push({ type: "quote", text: quote.join("\n") });
			continue;
		}
		// 分隔线
		if (/^-{3,}\s*$|^\*{3,}\s*$|^_{3,}\s*$/.test(t) && !t.startsWith("#")) { flush(); blocks.push({ type: "hr" }); i++; continue; }
		// 标题
		const head = t.match(/^(#{1,6})\s+(.*)$/);
		if (head) { flush(); blocks.push({ type: "heading", level: head[1].length, text: head[2] }); i++; continue; }
		// HTML 注释快（可选）
		if (t.startsWith("<!--")) {
			while (i < lines.length && !lines[i].includes("-->")) i++;
			i++;
			continue;
		}
		// 普通段落（跨行合并）
		norm.push(t);
		i++;
	}
	flush();
	return blocks;
}

/* ── 文档外壳 XML ─────────────────────────────────────────────────────── */
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

function contentTypes() {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
}

function rootRels() {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="${REL}/styles" Target="word/styles.xml"/>
<Relationship Id="rId4" Type="${REL}/numbering" Target="word/numbering.xml"/>
</Relationships>`;
}

function docRels(hyperlinks) {
	const entries = [
		`<Relationship Id="rId5" Type="${REL}/styles" Target="styles.xml"/>`,
		`<Relationship Id="rId6" Type="${REL}/numbering" Target="numbering.xml"/>`
	];
	let n = 6;
	for (const url of hyperlinks) {
		n++;
		const target = ESC_TEXT(url);
		entries.push(`<Relationship Id="rId${n}" Type="${REL}/hyperlink" Target="${target}" TargetMode="External"/>`);
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
${entries.join("\n")}
</Relationships>`;
}

function coreProps(title) {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${ESC_TEXT(title)}</dc:title>
<dc:creator>dsh</dc:creator>
<dc:description>由 DSH lab-agent 从 Markdown 精读报告转换生成。</dc:description>
<cp:lastModifiedBy>dsh</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;
}

function numberingXml() {
	let bulletLvls = "";
	let decimalLvls = "";
	for (let d = 0; d <= 8; d++) {
		const start = d * 360 + 360;
		bulletLvls += `<w:lvl w:ilvl="${d}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${start}" w:hanging="180"/></w:pPr></w:lvl>`;
		decimalLvls += `<w:lvl w:ilvl="${d}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${d + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${start}" w:hanging="180"/></w:pPr></w:lvl>`;
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${bulletLvls}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${decimalLvls}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function stylesXml() {
	const headings = ([[1, 300, 34], [2, 260, 30], [3, 220, 27], [4, 200, 24], [5, 180, 23], [6, 160, 22]]).map(([lvl, before, size]) => {
		return `<w:style w:type="paragraph" w:styleId="Heading${lvl}"><w:name w:val="heading ${lvl}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="100"/><w:outlineLvl w:val="${lvl - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
	}).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
<w:pPrDefault/>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${headings}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="567" w:right="567"/><w:spacing w:before="120" w:after="160"/><w:shd w:val="clear" w:color="auto" w:fill="F2F7F4"/><w:pBdr><w:left w:val="single" w:sz="8" w:space="4" w:color="5A9379"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="3A4A44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="CodeBlock"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:ind w:left="283" w:right="283"/><w:spacing w:before="80" w:after="160"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:color w:val="1F1F1F"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="Normal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
}

/** 正文 → word/document.xml，并同步收集超链接 URL（顺序即 rId≥7；超链接关系从 rId7 起）。 */
function documentXml(blocks, hypered) {
	const assignRel = (url) => {
		const idx = hypered.indexOf(url);
		if (idx === -1) { hypered.push(url); return `rId${hypered.length + 6}`; }
		return `rId${idx + 7}`;
	};
	let body = "";
	for (const b of blocks) {
		if (b.type === "heading") body += `<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${runsToXml(parseInline(b.text), assignRel)}</w:p>`;
		else if (b.type === "paragraph") body += `<w:p>${runsToXml(parseInline(b.text), assignRel)}</w:p>`;
		else if (b.type === "code") {
			let inner = "";
			for (const ln of (b.code || "").split("\n")) {
				inner += `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr><w:t xml:space="preserve">${ESC_TEXT(ln)}</w:t></w:r><w:r><w:br/></w:r>`;
			}
			body += `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${inner}</w:p>`;
		} else if (b.type === "list") {
			for (const item of b.items) {
				body += `<w:p><w:pPr><w:numPr><w:ilvl w:val="${item.depth}"/><w:numId w:val="${item.ordered ? 2 : 1}"/></w:numPr></w:pPr>${runsToXml(parseInline(item.text), assignRel)}</w:p>`;
			}
		} else if (b.type === "quote") {
			body += `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${runsToXml(parseInline(b.text.replace(/\n/g, " ")), assignRel)}</w:p>`;
		} else if (b.type === "hr") {
			body += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="888888"/></w:pBdr></w:pPr></w:p>`;
		} else if (b.type === "table") {
			const cols = Math.max(1, b.header.length, ...b.rows.map((r) => r.length));
			const width = `${Math.max(1, Math.floor(9500 / cols))}`;
			let tbl = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:firstColumn="0" w:lastRow="0" w:lastColumn="0"/></w:tblPr>`;
			const cell2 = (content, header) => {
				const ppr = header ? "<w:pPr><w:jc w:val=\"center\"/></w:pPr>" : "";
				return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p>${ppr}${runsToXml(parseInline(content), assignRel)}</w:p></w:tc>`;
			};
			const headerPadded = [...b.header]; while (headerPadded.length < cols) headerPadded.push("");
			tbl += `<w:tr>${headerPadded.map((hc) => cell2(hc, true)).join("")}</w:tr>`;
			for (const row of b.rows) {
				const padded = [...row]; while (padded.length < cols) padded.push("");
				tbl += `<w:tr>${padded.map((c) => cell2(c, false)).join("")}</w:tr>`;
			}
			tbl += `</w:tbl><w:p/>`;
			body += tbl;
		}
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1417" w:bottom="1134" w:left="1417" w:header="397" w:footer="397" w:gutter="0"/>
</w:sectPr></w:body>
</w:document>`;
}

/**
 * Markdown → .docx Buffer。
 * @param {string} markdown 精读报告 Markdown 全文
 * @param {{ title?: string }} options
 * @returns {Promise<Buffer>}
 */
export async function markdownToDocx(markdown, options = {}) {
	const hypered = [];
	const blocks = parseBlocks(markdown);
	const zip = new JSZip();
	zip.file("[Content_Types].xml", contentTypes());
	zip.file("_rels/.rels", rootRels());
	zip.file("word/document.xml", documentXml(blocks, hypered));
	zip.file("word/numbering.xml", numberingXml());
	zip.file("word/styles.xml", stylesXml());
	zip.file("word/_rels/document.xml.rels", docRels(hypered));
	zip.file("docProps/core.xml", coreProps(options.title || "阅读笔记"));
	return zip.generateAsync({ type: "nodebuffer", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export default markdownToDocx;
