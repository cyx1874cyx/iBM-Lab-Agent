import { test } from "node:test";
import assert from "node:assert/strict";
import jszip from "jszip";
import { markdownToDocx } from "../../lib/md2docx.js";

// jszip 走 CommonJS default，docx 是二进制 zip
function sampleMd() {
	return [
		"# 阅读笔记标题",
		"",
		"## 一、文献信息",
		"",
		"- **题目**：Biomaterial Fibers",
		"- **作者**：Miaoyi Xu",
		"",
		"正文段落，包含 *斜体* 与 **粗体** 与 `行内代码` 与 [链接](https://doi.org/10.1002/adma.202504372)。",
		"",
		"| 参数 | 数值 | 出处 |",
		"| --- | --- | --- |",
		"| 模量 | 9.5 GPa | §2.2 Fig.3d |",
		"| 伸长率 | 18% | §3.2.1 |",
		"",
		"> 引用块：证据均标注章节号。",
		"",
		"1. 目标一",
		"2. 目标二",
		"   - 嵌套要点",
		"",
		"---",
		"",
		"```",
		"Z(t) = L/(j2πf·A·ε*)",
		"```",
		"",
		"$$E = m c^2$$"
	].join("\n");
}

test("markdownToDocx 生成合法 docx（zip + OOXML 部件齐全）", async () => {
	const buf = await markdownToDocx(sampleMd(), { title: "阅读笔记" });
	assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
	assert.deepEqual(Buffer.from(buf.slice(0, 4)).toString("latin1"), "PK\x03\x04", "应是一个 zip 文件");
	const zip = await jszip.loadAsync(buf);
	for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"]) {
		assert.ok(zip.file(part) !== undefined, `缺少部件 ${part}`);
	}
	const dom = await zip.file("word/document.xml").async("string");
	assert.match(dom, /pStyle w:val="Heading1"/, "一级标题");
	assert.match(dom, /Heading2/, "二级标题");
	assert.match(dom, /w:tbl/, "表格");
	assert.match(dom, /w:numPr/, "列表编号");
	assert.match(dom, /w:hyperlink/, "超链接");
	assert.match(dom, /w:b\//, "粗体");
});

test("markdownToDocx 转义 XML 特殊字符", async () => {
	const md = "A < B > C & D \"E\" 'F' `x<y` **b<**";
	const buf = await markdownToDocx(md);
	const zip = await jszip.loadAsync(buf);
	const dom = await zip.file("word/document.xml").async("string");
	assert.ok(!/B > C/.test(dom.replace(/<\/?[^>]+>/g, "")), "不应出现未转义 '>'");
	const text = dom.replace(/<\/?[^>]+>/g, "");
	assert.match(text, /A &lt; B &gt; C &amp; D &quot;E&quot;/);
	assert.ok(!dom.includes("<w:t>B > C"), "不应出现未转义 '>'");
});

test("markdownToDocx 处理空输入", async () => {
	const buf = await markdownToDocx("");
	const zip = await jszip.loadAsync(buf);
	const dom = await zip.file("word/document.xml").async("string");
	assert.match(dom, /<w:body>[\s\S]*?<w:sectPr>/, "空文档也有 body/sectPr");
});

test("markdownToDocx 表格列数对齐", async () => {
	const md = ["| a | b | c |", "|---|---|---|", "| 1 | 2 |", "| x | y | z | w |"].join("\n");
	const buf = await markdownToDocx(md);
	const zip = await jszip.loadAsync(buf);
	const dom = await zip.file("word/document.xml").async("string");
	const tbl = dom.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)[0];
	const rows = (tbl.match(/<w:tr>/g) || []).length;
	assert.equal(rows, 3, "表头 + 2 数据行");
	// 每行补齐到最大列数 4
	const trs = tbl.split("<w:tr>").slice(1).map((s) => s.split("</w:tr>")[0]);
	for (const tr of trs) assert.equal((tr.match(/<w:tc>/g) || []).length, 4, "每行补齐 4 列");
});
