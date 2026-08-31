// Native Messaging host（host.js）核心安全边界单测。
// host.js 位于 desktop/src-tauri/resources/bridge/，由捆绑 node.exe 运行，
// 是 host.py 的 Node.js 移植版。这里直接 import 其纯函数做校验：
//   - URL/origin 白名单校验（仅 loopback artifact + 受信 origin）
//   - 文件名清洗（Windows 非法字符 / 保留名 / 扩展名固定）
//   - Office ZIP 包结构 + CRC32 校验
//   - CRC32 标准向量
// 不触碰真实下载目录（downloadsDirs/saveArtifact 的完整链路在手工 E2E 中验证）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const host = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../desktop/src-tauri/resources/bridge/host.js"
));

/* ---------------- URL / origin 校验 ---------------- */

test("normalizedOrigin 规范化且拒绝带路径/凭据的 origin", () => {
  assert.equal(host.normalizedOrigin("http://127.0.0.1:3080"), "http://127.0.0.1:3080");
  assert.equal(host.normalizedOrigin("https://localhost"), "https://localhost");
  assert.equal(host.normalizedOrigin("http://127.0.0.1"), "http://127.0.0.1");
  assert.throws(() => host.normalizedOrigin("http://x.com/path"));
  assert.throws(() => host.normalizedOrigin("http://user:pass@x.com"));
  assert.throws(() => host.normalizedOrigin("ftp://x.com"));
});

test("validateArtifactUrl 只放行 loopback 上的已审核 PPTX/DOCX", () => {
  const origin = "http://127.0.0.1:3080";
  const ppt = host.validateArtifactUrl("http://127.0.0.1:3080/api/lab-artifacts?kind=ppt&reportId=abc-123", origin);
  assert.equal(ppt.extension, ".pptx");
  const docx = host.validateArtifactUrl("http://localhost/api/lab-artifacts?kind=report&reportId=r1&format=docx", "http://localhost");
  assert.equal(docx.extension, ".docx");
  // 非 loopback
  assert.throws(() => host.validateArtifactUrl("http://evil.com/api/lab-artifacts?kind=ppt&reportId=abc", origin));
  // 非受信 origin
  assert.throws(() => host.validateArtifactUrl("http://127.0.0.1:9999/api/lab-artifacts?kind=ppt&reportId=abc", origin));
  // 未批准类型 / 非法 reportId / 多余参数 / 重复参数
  assert.throws(() => host.validateArtifactUrl("http://127.0.0.1:3080/api/lab-artifacts?kind=exe&reportId=abc", origin));
  assert.throws(() => host.validateArtifactUrl("http://127.0.0.1:3080/api/lab-artifacts?kind=ppt&reportId=..%2Fetc", origin));
  assert.throws(() => host.validateArtifactUrl("http://127.0.0.1:3080/api/lab-artifacts?kind=ppt&reportId=abc&extra=1", origin));
  assert.throws(() => host.validateArtifactUrl("http://127.0.0.1:3080/api/lab-artifacts?kind=ppt&reportId=abc&reportId=def", origin));
  // 错误端点路径
  assert.throws(() => host.validateArtifactUrl("http://127.0.0.1:3080/api/other?kind=ppt&reportId=abc", origin));
});

/* ---------------- 文件名清洗 ---------------- */

test("sanitizeArtifactName 清洗非法字符并固定扩展名", () => {
  assert.equal(host.sanitizeArtifactName("年度报告.pptx", ".pptx"), "年度报告.pptx");
  assert.equal(host.sanitizeArtifactName("a\\b:bad|name.DOCX", ".docx"), "b_bad_name.docx");
  assert.equal(host.sanitizeArtifactName("..hidden.pptx", ".pptx"), "hidden.pptx");
  assert.equal(host.sanitizeArtifactName("CON.pptx", ".pptx"), "_CON.pptx");
  // 无扩展名/扩展名不匹配一律拒绝（与 host.py 一致，防止伪造文件名）
  assert.throws(() => host.sanitizeArtifactName("name", ".pptx"));
  assert.throws(() => host.sanitizeArtifactName("x.pdf", ".docx"));
});

test("availableDestination 避开已存在文件", () => {
  const dir = path.join(process.env.TEMP || "/tmp", `ibm-host-test-${process.pid}`);
  const { mkdirSync, writeFileSync, rmSync, existsSync } = require("node:fs");
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(path.join(dir, "a.pptx"), "x");
    const second = host.availableDestination(dir, "a.pptx");
    assert.equal(path.basename(second), "a (1).pptx");
    assert.ok(!existsSync(second));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------- ZIP / CRC32 ---------------- */

test("crc32 与标准向量一致", () => {
  assert.equal(host.crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(host.crc32(Buffer.alloc(0)), 0);
});

function buildZip(entries) {
  const zlib = require("node:zlib");
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const raw = Buffer.from(data, "utf8");
    const payload = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = host.crc32(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localParts.push(localHeader, nameBuf, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += 30 + nameBuf.length + payload.length;
  }
  const local = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

test("validateOfficePackage 接受真实结构、拒绝伪造与缺部件包", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "ibm-host-zip-"));
  try {
    const goodPptx = path.join(dir, "good.pptx");
    writeFileSync(goodPptx, buildZip([
      ["[Content_Types].xml", '<?xml version="1.0"?>', 8],
      ["ppt/presentation.xml", "<p:presentation/>", 8],
      ["_rels/.rels", "<Relationships/>", 0],
    ]));
    host.validateOfficePackage(goodPptx, ".pptx");

    const goodDocx = path.join(dir, "good.docx");
    writeFileSync(goodDocx, buildZip([
      ["[Content_Types].xml", '<?xml version="1.0"?>', 8],
      ["word/document.xml", "<w:document/>", 8],
    ]));
    host.validateOfficePackage(goodDocx, ".docx");

    const fake = path.join(dir, "fake.pptx");
    writeFileSync(fake, "this is not a zip");
    assert.throws(() => host.validateOfficePackage(fake, ".pptx"), /not a valid Office ZIP/);

    const missing = path.join(dir, "missing.pptx");
    writeFileSync(missing, buildZip([
      ["[Content_Types].xml", '<?xml version="1.0"?>', 8],
      ["ppt/notesSlide.xml", "<p:notes/>", 8],
    ]));
    assert.throws(() => host.validateOfficePackage(missing, ".pptx"), /not the expected Office package/);

    // 扩展名与内容不匹配
    assert.throws(() => host.validateOfficePackage(goodPptx, ".docx"), /not the expected Office package/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏条目（CRC 不匹配）被拒绝", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "ibm-host-zip-"));
  try {
    const corrupt = path.join(dir, "corrupt.pptx");
    // 构造一个 CRC 与内容不符的 zip：直接用正确 zip 然后翻转一个字节会破坏 EOCD 边界，
    // 因此改为手工构造：条目声明 crc=0 但内容非空。
    const zlib = require("node:zlib");
    const nameBuf = Buffer.from("[Content_Types].xml", "utf8");
    const payload = zlib.deflateRawSync(Buffer.from("<?xml version=\"1.0\"?>", "utf8"));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 14); // 故意错误的 crc
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 16); // 与 local 一致的错误 crc
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(30 + nameBuf.length + payload.length, 16);
    writeFileSync(corrupt, Buffer.concat([local, nameBuf, payload, central, eocd]));
    assert.throws(() => host.validateOfficePackage(corrupt, ".pptx"), /corrupt part/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
