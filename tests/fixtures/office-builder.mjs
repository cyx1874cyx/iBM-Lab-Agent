/**
 * dsh-lab-agent: Office fixture builder（最小但真实的 .docx，供转换测试）。
 * 手写 OOXML zip：word/document.xml + content types + rels。
 */

import JSZip from "jszip";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** 生成一个含标题与两段文字的 .docx。 */
export async function buildDocx({ title = "Prodrug Polymer Test", paragraphs = ["This is the first paragraph about prodrug-conjugated polymers.", "The second paragraph covers RAFT polymerization of methacrylate monomers."] } = {}) {
	const zip = new JSZip();
	zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
	zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
	const body = [
		`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p>`,
		...paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
	].join("");
	zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
	return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
