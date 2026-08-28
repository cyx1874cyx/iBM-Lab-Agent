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


def _chrome_download_dirs():
    """从 Chrome/Edge 的 Preferences 读取用户自定义的下载目录（如桌面）。"""
    found = []
    user_data_roots = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "User Data"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Edge", "User Data"),
    ]
    for root in user_data_roots:
        if not os.path.isdir(root):
            continue
        for name in os.listdir(root):
            prefs = os.path.join(root, name, "Preferences")
            if not os.path.isfile(prefs):
                continue
            try:
                with open(prefs, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                directory = (data.get("download", {}) or {}).get("default_directory")
                if directory:
                    found.append(os.path.expandvars(directory))
            except Exception:
                continue
    return found


def downloads_dirs():
    """候选下载目录（按优先级）：Chrome/Edge 配置目录 → 注册表 Downloads → 常见目录。"""
    dirs = _chrome_download_dirs()
    try:
        import winreg  # Windows only
        key = winreg.HKEY_CURRENT_USER
        path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        with winreg.OpenKey(key, path) as handle:
            value, _ = winreg.QueryValueEx(handle, "{374DE290-123F-4565-9164-39C4925E467B}")
        expanded = os.path.expandvars(value)
        if os.path.isdir(expanded):
            dirs.append(expanded)
    except Exception:
        pass
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    dirs += [
        os.path.join(home, "Downloads"),
        os.path.join(home, "下载"),
        os.path.join(home, "Desktop"),
        os.path.join(home, "桌面")
    ]
    seen = set()
    unique = []
    for directory in dirs:
        key = os.path.normcase(os.path.abspath(directory))
        if directory and os.path.isdir(directory) and key not in seen:
            seen.add(key)
            unique.append(directory)
    return unique


def resolve_download_path(relative):
    """在全部候选下载目录中定位下载文件；找不到返回 (None, 错误信息)。"""
    if not relative:
        return None, "empty relative path"
    norm = os.path.normpath(relative.replace("/", os.sep).replace("\\", os.sep))
    if norm.startswith("..") or norm.startswith("." + os.sep) or os.path.isabs(norm):
        return None, "unsafe relative path: " + relative
    for base in downloads_dirs():
        candidate = os.path.abspath(os.path.join(base, norm))
        base_abs = os.path.abspath(base)
        if not candidate.startswith(base_abs + os.sep):
            continue
        if os.path.isfile(candidate):
            return candidate, None
    return None, "file not found in any download directory: " + relative


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

    file_path, path_error = resolve_download_path(relative)
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
