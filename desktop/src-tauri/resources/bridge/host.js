#!/usr/bin/env node
/**
 * iBM Lab Native Messaging 下载桥（Node.js，零依赖）。
 *
 * 只接受 upload 命令：读取 Edge/Chrome 已完成且位于批准下载目录内的文件，
 * 上传到本机 iBM Lab Agent 的一次性捕获接口。项目目录由服务端任务决定，扩展和
 * Native Host 都不能指定目标目录。不得加入通用下载、Office 保存或任意 URL 请求。
 */

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const BRIDGE_NAME = "com.ibm.lab.capture";
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const CAPTURE_UPLOAD_PATH = "/api/lab-capture-upload";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const TASK_ID_RE = /^capture-[a-z0-9]+$/;

function readFully(buffer) {
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

function writeMessage(value) {
  const data = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.alloc(4);
  frame.writeUInt32LE(data.length, 0);
  process.stdout.write(frame);
  process.stdout.write(data);
}

function log(message) {
  process.stderr.write(`[${BRIDGE_NAME}] ${message}\n`);
}

function expandEnv(value) {
  return String(value).replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

function browserDownloadDirs() {
  const found = [];
  const roots = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "User Data")
  ];
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const preferences = JSON.parse(fs.readFileSync(path.join(root, entry.name, "Preferences"), "utf8"));
        const directory = preferences?.download?.default_directory;
        if (directory) found.push(expandEnv(directory));
      } catch { /* 其他 profile 或锁定文件忽略 */ }
    }
  }
  return found;
}

function shellDownloadsDir() {
  try {
    const raw = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "{374DE290-123F-4565-9164-39C4925E467B}"],
      { encoding: "buffer", windowsHide: true, timeout: 5000 }
    );
    const match = new TextDecoder("gbk").decode(raw).match(/REG_(?:EXPAND_)?SZ\s+(.+)$/m);
    if (match) return expandEnv(match[1].trim());
  } catch { /* 注册表不可用时走常见目录 */ }
  return null;
}

function downloadsDirs() {
  const dirs = browserDownloadDirs();
  const shell = shellDownloadsDir();
  if (shell) dirs.push(shell);
  const home = process.env.USERPROFILE || process.env.HOME || "";
  dirs.push(path.join(home, "Downloads"), path.join(home, "下载"), path.join(home, "Desktop"), path.join(home, "桌面"));
  const seen = new Set();
  return dirs.filter((directory) => {
    if (!directory) return false;
    const key = path.resolve(directory).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    try { return fs.statSync(directory).isDirectory(); } catch { return false; }
  });
}

function insideDirectory(candidate, base) {
  const candidatePath = path.resolve(candidate).toLowerCase();
  const basePath = path.resolve(base).toLowerCase();
  return candidatePath === basePath || candidatePath.startsWith(basePath.endsWith(path.sep) ? basePath : basePath + path.sep);
}

function resolveDownloadPath(downloadPath) {
  if (!downloadPath) return { path: null, error: "empty download path" };
  const normalized = path.normalize(String(downloadPath).replace(/[/\\]/g, path.sep));
  const bases = downloadsDirs();
  const candidates = path.isAbsolute(normalized) ? [normalized] : bases.map((base) => path.join(base, normalized));
  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (!bases.some((base) => insideDirectory(absolute, base))) continue;
    try {
      if (fs.statSync(absolute).isFile()) return { path: absolute, error: null };
    } catch { /* 文件不存在则继续 */ }
  }
  return { path: null, error: "file is missing or outside approved download directories: " + downloadPath };
}

function validateUploadUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("uploadUrl is invalid"); }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) || url.pathname !== CAPTURE_UPLOAD_PATH) {
    throw new Error("uploadUrl is not a loopback iBM capture endpoint");
  }
  if (url.username || url.password || url.hash) throw new Error("uploadUrl contains unauthorized components");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "token" || !url.searchParams.get("token")) {
    throw new Error("uploadUrl must contain exactly one capture token");
  }
  return url;
}

function readResponseBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", reject);
  });
}

async function upload(uploadUrl, filePath, fileName) {
  const url = validateUploadUrl(uploadUrl);
  const size = fs.statSync(filePath).size;
  if (size < 1 || size > MAX_FILE_BYTES) throw new Error("file size is outside the capture limit");
  const content = fs.readFileSync(filePath);
  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(fileName),
        "X-Capture-Source": "native-bridge",
        "Content-Length": content.length
      }
    }, resolve);
    request.setTimeout(300000, () => request.destroy(new Error("bridge upload timed out")));
    request.on("error", reject);
    request.end(content);
  });
  const body = await readResponseBody(response);
  try { return JSON.parse(body); }
  catch { return { ok: false, error: "server returned non-JSON response: " + body.slice(0, 200) }; }
}

async function main() {
  let message;
  try { message = readMessage(); }
  catch (error) {
    writeMessage({ ok: false, error: "malformed bridge message: " + error.message });
    return;
  }
  if (!message) {
    writeMessage({ ok: false, error: "empty message" });
    return;
  }
  if (message.cmd !== "upload") {
    writeMessage({ ok: false, error: "unsupported command: download bridge accepts upload only" });
    return;
  }

  const taskId = String(message.taskId || "");
  const uploadUrl = String(message.uploadUrl || "");
  const downloadPath = String(message.downloadPath || message.relativePath || "");
  const fileName = String(message.fileName || "") || path.basename(downloadPath.replace(/\\/g, "/"));
  if (!TASK_ID_RE.test(taskId)) {
    writeMessage({ ok: false, error: "invalid taskId" });
    return;
  }
  try { validateUploadUrl(uploadUrl); }
  catch (error) {
    writeMessage({ ok: false, taskId, error: error.message });
    return;
  }
  const resolved = resolveDownloadPath(downloadPath);
  if (resolved.error) {
    writeMessage({ ok: false, taskId, error: resolved.error });
    return;
  }
  try {
    const response = await upload(uploadUrl, resolved.path, fileName);
    const ok = Boolean(response.ok);
    writeMessage({ ok, taskId, response, error: ok ? null : String(response.error || "upload rejected") });
  } catch (error) {
    writeMessage({ ok: false, taskId, error: String(error.message || error) });
  }
}

module.exports = {
  BRIDGE_NAME,
  MAX_FILE_BYTES,
  CAPTURE_UPLOAD_PATH,
  downloadsDirs,
  resolveDownloadPath,
  insideDirectory,
  expandEnv,
  validateUploadUrl,
  readMessage,
  writeMessage,
  upload,
  main
};

if (require.main === module) {
  main().catch((error) => {
    log(String(error.message || error));
    writeMessage({ ok: false, error: String(error.message || error) });
  });
}
