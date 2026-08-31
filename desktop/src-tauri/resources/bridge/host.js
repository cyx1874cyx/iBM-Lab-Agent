#!/usr/bin/env node
/**
 * iBM Lab Native Messaging 本地桥接宿主（Node.js 版，零依赖）。
 *
 * 由桌面客户端捆绑的 node.exe 运行（见 resources/bridge/ 与 Rust 侧 bridge.rs
 * 注册逻辑），替代早期依赖系统 Python 的 host.py —— clean machine 无需安装
 * Python 也能自动注册并工作。
 *
 * 支持两项由用户明确触发的操作：
 *   - upload：读取指定下载文件并上传到一次性捕获地址；
 *   - save_artifact：从可信本机 iBM 接口下载 PPTX/DOCX，校验后保存到下载目录。
 *
 * 安全边界（与 host.py 一致）：
 *   - 不读取 Cookie、浏览历史或任何其他文件；
 *   - Chrome 返回绝对下载路径；只允许路径落在 Chrome/Edge 配置或系统下载目录内；
 *   - 上传地址由服务端一次性令牌保护，不可复用。
 *
 * 协议：stdin/stdout 走 Windows Native Messaging 帧（4 字节小端长度 + UTF-8 JSON）。
 * Node 在 Windows 下 stdin/stdout 默认二进制模式，无需 setmode；本文件不得向
 * stdout 输出任何非协议内容（调试信息一律写 stderr）。
 */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const zlib = require("node:zlib");

const BRIDGE_NAME = "com.ibm.lab.capture";
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ARTIFACT_PATH = "/api/lab-artifacts";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const INVALID_FILE_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED_NAMES = new Set(
  ["CON", "PRN", "AUX", "NUL"].concat(
    Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
  )
);

/* ------------------------------------------------------------------ */
/* Native Messaging 帧协议                                             */
/* ------------------------------------------------------------------ */

function readFully(buffer) {
  // fs.readSync 可能短读，循环读完为止；EOF 返回 false。
  let filled = 0;
  while (filled < buffer.length) {
    const got = fs.readSync(process.stdin.fd, buffer, filled, buffer.length - filled, null);
    if (got <= 0) return false;
    filled += got;
  }
  return true;
}

function readMessage() {
  const frame = Buffer.alloc(4);
  if (!readFully(frame)) return null;
  const payloadLength = frame.readUInt32LE(0);
  if (payloadLength <= 0 || payloadLength > 1024 * 1024) return null;
  const payload = Buffer.alloc(payloadLength);
  if (!readFully(payload)) return null;
  return JSON.parse(payload.toString("utf8"));
}

function writeMessage(obj) {
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  const frame = Buffer.alloc(4);
  frame.writeUInt32LE(data.length, 0);
  process.stdout.write(frame);
  process.stdout.write(data);
}

function log(message) {
  process.stderr.write(`[${BRIDGE_NAME}] ${message}\n`);
}

/* ------------------------------------------------------------------ */
/* 下载目录解析                                                        */
/* ------------------------------------------------------------------ */

function chromeDownloadDirs() {
  const found = [];
  const roots = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "User Data"),
  ];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const prefsFile = path.join(root, entry.name, "Preferences");
      let data;
      try {
        data = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
      } catch {
        continue;
      }
      const directory = data?.download?.default_directory;
      if (directory) found.push(expandEnv(directory));
    }
  }
  return found;
}

function shellDownloadsDir() {
  // HKCU\...\Explorer\User Shell Folders 的 Downloads 项（可能 REG_EXPAND_SZ）。
  // reg.exe 输出为系统 ANSI 代码页（中文 Windows 为 GBK），用 TextDecoder 还原。
  try {
    const raw = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "{374DE290-123F-4565-9164-39C4925E467B}"],
      { encoding: "buffer", windowsHide: true, timeout: 5000 }
    );
    const text = new TextDecoder("gbk").decode(raw);
    const match = text.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/m);
    if (match) {
      const expanded = expandEnv(match[1].trim());
      if (fs.existsSync(expanded)) return expanded;
    }
  } catch {
    /* 注册表不可读时忽略，常见目录兜底 */
  }
  return null;
}

function expandEnv(value) {
  return String(value).replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

function downloadsDirs() {
  const dirs = chromeDownloadDirs();
  const shell = shellDownloadsDir();
  if (shell) dirs.push(shell);
  const home = process.env.USERPROFILE || process.env.HOME || "";
  dirs.push(
    path.join(home, "Downloads"),
    path.join(home, "下载"),
    path.join(home, "Desktop"),
    path.join(home, "桌面")
  );
  const seen = new Set();
  const unique = [];
  for (const directory of dirs) {
    if (!directory) continue;
    const key = path.normalize(directory).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.statSync(directory).isDirectory()) unique.push(directory);
    } catch {
      /* 目录不存在则跳过 */
    }
  }
  return unique;
}

function insideDirectory(candidate, base) {
  const candidateReal = path.resolve(candidate);
  const baseReal = path.resolve(base);
  const candidateNormalized = candidateReal.toLowerCase();
  const baseNormalized = baseReal.toLowerCase();
  if (candidateNormalized === baseNormalized) return true;
  const sep = path.sep;
  return candidateNormalized.startsWith(baseNormalized.endsWith(sep) ? baseNormalized : baseNormalized + sep);
}

function resolveDownloadPath(downloadPath) {
  if (!downloadPath) return { path: null, error: "empty download path" };
  const normalized = path.normalize(String(downloadPath).replace(/[/\\]/g, path.sep));
  const bases = downloadsDirs();
  const candidates = path.isAbsolute(normalized)
    ? [normalized]
    : bases.map((base) => path.join(base, normalized));
  for (const candidate of candidates) {
    const candidateAbs = path.resolve(candidate);
    if (!bases.some((base) => insideDirectory(candidateAbs, base))) continue;
    try {
      if (fs.statSync(candidateAbs).isFile()) return { path: candidateAbs, error: null };
    } catch {
      /* 文件不存在则继续尝试下一个候选 */
    }
  }
  return { path: null, error: "file is missing or outside approved download directories: " + downloadPath };
}

/* ------------------------------------------------------------------ */
/* URL 校验（与 host.py 语义一致）                                     */
/* ------------------------------------------------------------------ */

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function normalizedOrigin(value) {
  const parsed = parseUrl(value);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("trustedOrigin is not a valid HTTP(S) origin");
  }
  if (parsed.username || parsed.password || (parsed.pathname !== "" && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("trustedOrigin must contain only scheme, host and port");
  }
  const host = parsed.hostname.toLowerCase();
  let authority = host.includes(":") ? `[${host}]` : host;
  const defaultPort = parsed.protocol === "http:" ? 80 : 443;
  if (parsed.port && Number(parsed.port) !== defaultPort) authority += `:${parsed.port}`;
  return `${parsed.protocol}//${authority}`;
}

function validateArtifactUrl(artifactUrl, trustedOrigin) {
  const parsed = parseUrl(artifactUrl);
  if (!parsed) throw new Error("artifactUrl is not a valid URL");
  const origin = normalizedOrigin(trustedOrigin);
  if (normalizedOrigin(`${parsed.protocol}//${parsed.host}`) !== origin) {
    throw new Error("artifactUrl origin does not match trustedOrigin");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("artifactUrl must use a loopback host");
  }
  if (parsed.pathname !== ARTIFACT_PATH || parsed.hash || parsed.username || parsed.password) {
    throw new Error("artifactUrl is not an iBM artifact endpoint");
  }
  const query = parsed.searchParams;
  const kind = query.get("kind") || "";
  const reportId = query.get("reportId") || "";
  const allowedKeys = kind === "report" ? ["kind", "reportId", "format"] : ["kind", "reportId"];
  const actualKeys = [...query.keys()];
  if (
    actualKeys.some((key) => !allowedKeys.includes(key)) ||
    actualKeys.some((key) => query.getAll(key).length !== 1)
  ) {
    throw new Error("artifactUrl contains unsupported or duplicate parameters");
  }
  if (!ARTIFACT_ID_RE.test(reportId)) {
    throw new Error("artifactUrl contains an invalid reportId");
  }
  if (kind === "ppt") {
    return { extension: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
  }
  if (kind === "report" && query.get("format") === "docx") {
    return { extension: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  throw new Error("artifactUrl only supports approved PPTX or DOCX artifacts");
}

/* ------------------------------------------------------------------ */
/* 文件名与目标路径安全处理                                            */
/* ------------------------------------------------------------------ */

function sanitizeArtifactName(rawName, expectedExtension) {
  let decoded = rawName ? decodeURIComponent(String(rawName)) : "";
  let name = path.basename(String(decoded).replace(/\\/g, "/"));
  name = name.replace(INVALID_FILE_CHARS_RE, "_").replace(/^[ .]+|[ .]+$/g, "");
  const ext = path.extname(name);
  if (ext.toLowerCase() !== expectedExtension) {
    throw new Error(`artifact file name must end with ${expectedExtension}`);
  }
  let stem = path.basename(name, ext);
  stem = stem.replace(/^[ .]+|[ .]+$/g, "") || "artifact";
  if (WINDOWS_RESERVED_NAMES.has(stem.toUpperCase())) stem = "_" + stem;
  stem = stem.slice(0, Math.max(1, 180 - expectedExtension.length)).replace(/[ .]+$/g, "");
  return stem + expectedExtension;
}

function availableDestination(directory, fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = path.join(directory, fileName);
  for (let index = 1; index < 10000; index++) {
    if (!fs.existsSync(candidate)) return candidate;
    candidate = path.join(directory, `${stem} (${index})${ext}`);
  }
  throw new Error("too many files with the same artifact name");
}

/* ------------------------------------------------------------------ */
/* Office ZIP 包校验（EOCD + central directory + CRC32）               */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocd(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minimum; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLength === buffer.length) return i;
    }
  }
  return -1;
}

function validateOfficePackage(filePath, expectedExtension) {
  const requiredPart = expectedExtension === ".pptx" ? "ppt/presentation.xml" : "word/document.xml";
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    throw new Error("downloaded file is not a valid Office ZIP package");
  }
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("downloaded file is not a valid Office ZIP package");
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const names = new Set();
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("downloaded Office package contains a corrupt central directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    names.add(name);

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`downloaded Office package contains a corrupt part: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    let actualCrc;
    if (method === 0) {
      actualCrc = crc32(data);
    } else if (method === 8) {
      try {
        actualCrc = crc32(zlib.inflateRawSync(data));
      } catch {
        throw new Error(`downloaded Office package contains a corrupt part: ${name}`);
      }
    } else {
      throw new Error(`downloaded Office package uses an unsupported compression method in ${name}`);
    }
    if (actualCrc !== expectedCrc) {
      throw new Error(`downloaded Office package contains a corrupt part: ${name}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!names.has("[Content_Types].xml") || !names.has(requiredPart)) {
    throw new Error("downloaded file is not the expected Office package");
  }
}

/* ------------------------------------------------------------------ */
/* 网络请求                                                            */
/* ------------------------------------------------------------------ */

function request(options, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === "https:" ? https : http;
    const requestHandle = client.request(options, (response) => resolve(response));
    requestHandle.setTimeout(timeoutMs, () => requestHandle.destroy(new Error("bridge request timed out")));
    requestHandle.on("error", reject);
    if (body !== undefined) requestHandle.write(body);
    requestHandle.end();
  });
}

async function upload(uploadUrl, filePath, fileName) {
  const parsed = parseUrl(uploadUrl);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.pathname !== "/api/lab-capture-upload" || !parsed.searchParams.get("token")) {
    throw new Error("uploadUrl is not an iBM capture endpoint");
  }
  const size = fs.statSync(filePath).size;
  if (size > MAX_FILE_BYTES) throw new Error("file exceeds 100 MB capture limit");
  const content = fs.readFileSync(filePath);
  const response = await request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(fileName),
        "X-Capture-Source": "native-bridge",
        "Content-Length": content.length,
      },
    },
    content,
    300000
  );
  const body = await readResponseBody(response);
  try {
    return JSON.parse(body);
  } catch {
    return { ok: false, error: "server returned non-JSON response: " + body.slice(0, 200) };
  }
}

function readResponseBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", reject);
  });
}

function sanitizeHeaderText(value) {
  return Buffer.from(String(value), "latin1").toString("utf8");
}

async function saveArtifact(artifactUrl, trustedOrigin) {
  const { extension, mime } = validateArtifactUrl(artifactUrl, trustedOrigin);
  const directories = downloadsDirs();
  if (directories.length === 0) throw new Error("no approved Windows download directory is available");
  const destinationDir = directories[0];
  const parsed = parseUrl(artifactUrl);
  // Node 的 http/https 客户端不会自动跟随重定向，等价于 host.py 的 NoRedirectHandler。
  const response = await request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { Accept: mime },
    },
    undefined,
    300000
  );
  const contentType = String(response.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
  if (contentType !== mime) throw new Error("artifact response has an unexpected Content-Type");
  const expectedHash = String(response.headers["x-content-sha256"] || "").toLowerCase();
  if (!SHA256_RE.test(expectedHash)) throw new Error("artifact response is missing a valid SHA-256 header");
  const expectedBytes = Number(response.headers["content-length"]);
  if (!Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_FILE_BYTES) {
    throw new Error("artifact response is missing a valid Content-Length");
  }
  const rawName = sanitizeHeaderText(response.headers["x-file-name"] || "");
  const fileName = sanitizeArtifactName(rawName, extension);
  const destination = availableDestination(destinationDir, fileName);

  const digest = crypto.createHash("sha256");
  const tempPath = path.join(destinationDir, `.ibm-artifact-${process.pid}-${Date.now()}.part`);
  let byteLength = 0;
  await new Promise((resolve, reject) => {
    const handle = fs.createWriteStream(tempPath);
    response.on("data", (chunk) => {
      byteLength += chunk.length;
      if (byteLength > MAX_FILE_BYTES) {
        handle.destroy(new Error("artifact exceeds the 100 MB limit"));
        return;
      }
      digest.update(chunk);
      if (!handle.write(chunk)) response.pause();
    });
    response.on("error", (error) => {
      handle.destroy(error);
      reject(error);
    });
    response.on("end", () => {
      handle.end(() => {
        handle.close(() => resolve());
      });
    });
    handle.on("error", reject);
    handle.on("drain", () => response.resume());
  });
  if (byteLength !== expectedBytes) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(`artifact length mismatch: expected ${expectedBytes}, received ${byteLength}`);
  }
  const actualHash = digest.digest("hex");
  if (actualHash !== expectedHash) {
    fs.rmSync(tempPath, { force: true });
    throw new Error("artifact SHA-256 mismatch");
  }
  try {
    validateOfficePackage(tempPath, extension);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  fs.renameSync(tempPath, destination);
  try {
    fs.rmSync(destination + ":Zone.Identifier", { force: true });
  } catch {
    /* 非 NTFS 或无 ADS 时忽略 */
  }
  return {
    ok: true,
    fileName: path.basename(destination),
    filePath: destination,
    byteLength,
    sha256: actualHash,
  };
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  let message;
  try {
    message = readMessage();
  } catch (error) {
    writeMessage({ ok: false, error: "malformed bridge message: " + error.message });
    return;
  }
  if (!message) {
    writeMessage({ ok: false, error: "empty message" });
    return;
  }
  const command = message.cmd;
  if (command === "save_artifact") {
    const artifactUrl = String(message.artifactUrl || "");
    const trustedOrigin = String(message.trustedOrigin || "");
    try {
      writeMessage(await saveArtifact(artifactUrl, trustedOrigin));
    } catch (error) {
      writeMessage({ ok: false, error: String(error.message || error) });
    }
    return;
  }
  if (command !== "upload") {
    writeMessage({ ok: false, error: "unsupported command" });
    return;
  }

  const taskId = String(message.taskId || "");
  const uploadUrl = String(message.uploadUrl || "");
  const downloadPath = String(message.downloadPath || message.relativePath || "");
  const fileName = String(message.fileName || "") || path.basename(downloadPath.replace(/\\/g, "/"));

  if (!taskId || !/^https?:\/\//.test(uploadUrl)) {
    writeMessage({ ok: false, error: "missing taskId or uploadUrl" });
    return;
  }

  const resolved = resolveDownloadPath(downloadPath);
  if (resolved.error) {
    writeMessage({ ok: false, taskId, error: resolved.error });
    return;
  }
  if (!fs.existsSync(resolved.path) || !fs.statSync(resolved.path).isFile()) {
    writeMessage({ ok: false, taskId, error: "file not found: " + downloadPath });
    return;
  }
  try {
    const response = await upload(uploadUrl, resolved.path, fileName);
    const ok = Boolean(response.ok);
    writeMessage({
      ok,
      taskId,
      response,
      error: ok ? null : String(response.error || "upload rejected"),
    });
  } catch (error) {
    writeMessage({ ok: false, taskId, error: String(error.message || error) });
  }
}

module.exports = {
  BRIDGE_NAME,
  MAX_FILE_BYTES,
  ARTIFACT_PATH,
  crc32,
  findEocd,
  validateOfficePackage,
  validateArtifactUrl,
  sanitizeArtifactName,
  availableDestination,
  normalizedOrigin,
  downloadsDirs,
  resolveDownloadPath,
  insideDirectory,
  expandEnv,
  readMessage,
  writeMessage,
  upload,
  saveArtifact,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    log(String(error.message || error));
    writeMessage({ ok: false, error: String(error.message || error) });
  });
}
