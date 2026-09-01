// Native Messaging 下载桥安全边界：只允许 loopback capture upload，且不再暴露
// PPTX/DOCX 保存或通用 URL 下载能力。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hostPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../desktop/src-tauri/resources/bridge/host.js");
const host = require(hostPath);

test("validateUploadUrl 只放行本机一次性捕获端点", () => {
  const accepted = host.validateUploadUrl("http://127.0.0.1:3080/api/lab-capture-upload?token=one-time-token");
  assert.equal(accepted.hostname, "127.0.0.1");
  assert.equal(host.validateUploadUrl("http://localhost:4999/api/lab-capture-upload?token=x").port, "4999");
  assert.throws(() => host.validateUploadUrl("https://127.0.0.1/api/lab-capture-upload?token=x"), /loopback/);
  assert.throws(() => host.validateUploadUrl("http://example.com/api/lab-capture-upload?token=x"), /loopback/);
  assert.throws(() => host.validateUploadUrl("http://127.0.0.1/api/lab-artifacts?token=x"), /loopback/);
  assert.throws(() => host.validateUploadUrl("http://127.0.0.1/api/lab-capture-upload"), /exactly one/);
  assert.throws(() => host.validateUploadUrl("http://127.0.0.1/api/lab-capture-upload?token=x&extra=1"), /exactly one/);
  assert.throws(() => host.validateUploadUrl("http://127.0.0.1/api/lab-capture-upload?token=x#fragment"), /unauthorized/);
});

test("insideDirectory 阻止下载目录逃逸", () => {
  const base = path.join(tmpdir(), "ibm-downloads");
  assert.equal(host.insideDirectory(path.join(base, "paper.pdf"), base), true);
  assert.equal(host.insideDirectory(path.join(base, "sub", "si.zip"), base), true);
  assert.equal(host.insideDirectory(path.join(tmpdir(), "outside.pdf"), base), false);
});

test("download bridge 不再导出 Office 保存能力", () => {
  assert.equal(host.saveArtifact, undefined);
  assert.equal(host.validateArtifactUrl, undefined);
  assert.equal(host.validateOfficePackage, undefined);
  const source = readFileSync(hostPath, "utf8");
  assert.doesNotMatch(source, /save_artifact|ARTIFACT_PATH|PPTX\/DOCX/);
  assert.match(source, /download bridge accepts upload only/);
});

test("upload 将捕获文件 PUT 到 loopback 服务", async () => {
  const http = await import("node:http");
  const dir = mkdtempSync(path.join(tmpdir(), "ibm-download-bridge-"));
  const file = path.join(dir, "paper.pdf");
  const payload = Buffer.from("%PDF-1.7\nbridge-test\n%%EOF");
  writeFileSync(file, payload);
  let received;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = { method: request.method, url: request.url, body: Buffer.concat(chunks), fileName: request.headers["x-file-name"] };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await host.upload(`http://127.0.0.1:${port}/api/lab-capture-upload?token=test-token`, file, "paper.pdf");
    assert.equal(result.ok, true);
    assert.equal(received.method, "PUT");
    assert.equal(received.url, "/api/lab-capture-upload?token=test-token");
    assert.deepEqual(received.body, payload);
    assert.equal(received.fileName, "paper.pdf");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
