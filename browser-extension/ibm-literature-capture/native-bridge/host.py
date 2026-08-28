#!/usr/bin/env python3
"""
iBM Lab 文献捕获 — Native Messaging 本地桥接宿主（Windows）。

只做一件事：接收扩展发来的 { cmd: "upload", taskId, uploadUrl, relativePath, fileName }，
读取**指定的那一份**下载文件（相对 Chrome 下载目录，防目录穿越），PUT 上传到
一次性上传地址（含 token），把结果回传给扩展。

安全边界：
  - 不读取 Cookie、浏览历史或任何其他文件；
  - 只处理相对下载目录的路径，拒绝 ".." 与绝对路径；
  - 上传地址由服务端一次性令牌保护，不可复用。
"""

import json
import os
import struct
import sys
import urllib.parse
import urllib.request

BRIDGE_NAME = "com.ibm.lab.capture"


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack("@I", raw)
    if length <= 0 or length > 64 * 1024 * 1024:
        return None
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def write_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def downloads_dir():
    """解析用户 Downloads 目录：Windows 注册表优先，环境变量兜底。"""
    try:
        import winreg  # Windows only
        key = winreg.HKEY_CURRENT_USER
        path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        with winreg.OpenKey(key, path) as handle:
            value, _ = winreg.QueryValueEx(handle, "{374DE290-123F-4565-9164-39C4925E467B}")
        expanded = os.path.expandvars(value)
        if os.path.isdir(expanded):
            return expanded
    except Exception:
        pass
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    candidate = os.path.join(home, "Downloads")
    return candidate if os.path.isdir(candidate) else os.path.join(home, "下载")


def safe_join(base, relative):
    """拼接下载目录 + 相对路径；拒绝目录穿越与绝对路径。"""
    if not relative:
        return None, "empty relative path"
    norm = os.path.normpath(relative.replace("/", os.sep).replace("\\", os.sep))
    if norm.startswith("..") or norm.startswith("." + os.sep) or os.path.isabs(norm):
        return None, "unsafe relative path: " + relative
    candidate = os.path.abspath(os.path.join(base, norm))
    base_abs = os.path.abspath(base)
    if not candidate.startswith(base_abs + os.sep):
        return None, "path escapes download directory"
    return candidate, None


def upload(upload_url, file_path, file_name):
    """PUT 上传；服务端校验一次性 token、Origin 与文件类型。"""
    with open(file_path, "rb") as handle:
        content = handle.read()
    request = urllib.request.Request(upload_url, data=content, method="PUT")
    request.add_header("Content-Type", "application/octet-stream")
    request.add_header("X-File-Name", urllib.parse.quote(file_name))
    request.add_header("X-Capture-Source", "native-bridge")
    request.add_header("Content-Length", str(len(content)))
    with urllib.request.urlopen(request, timeout=300) as response:
        body = response.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except ValueError:
        return {"ok": False, "error": "server returned non-JSON response: " + body[:200]}


def main():
    message = read_message()
    if not message:
        write_message({"ok": False, "error": "empty message"})
        return
    if message.get("cmd") != "upload":
        write_message({"ok": False, "error": "unsupported command"})
        return

    task_id = str(message.get("taskId", ""))
    upload_url = str(message.get("uploadUrl", ""))
    relative = str(message.get("relativePath", ""))
    file_name = str(message.get("fileName", "") or os.path.basename(relative.replace("\\", "/")))

    if not task_id or not upload_url.startswith(("http://", "https://")):
        write_message({"ok": False, "error": "missing taskId or uploadUrl"})
        return

    base = downloads_dir()
    file_path, path_error = safe_join(base, relative)
    if path_error:
        write_message({"ok": False, "taskId": task_id, "error": path_error})
        return
    if not os.path.isfile(file_path):
        write_message({"ok": False, "taskId": task_id, "error": "file not found: " + relative})
        return

    try:
        response = upload(upload_url, file_path, file_name)
        ok = bool(response.get("ok"))
        write_message({"ok": ok, "taskId": task_id, "response": response,
                       "error": None if ok else response.get("error", "upload rejected")})
    except Exception as error:  # noqa: BLE001 — 桥接边界，任何异常都要回传
        write_message({"ok": False, "taskId": task_id, "error": str(error)})


if __name__ == "__main__":
    main()
