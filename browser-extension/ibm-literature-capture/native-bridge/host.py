#!/usr/bin/env python3
"""iBM Lab Native Messaging 下载桥（开发回退版）。

只接受 upload 命令：读取浏览器已完成且位于批准下载目录内的文件，并上传到
本机 iBM Lab Agent 的一次性捕获接口。生产桌面安装包使用同协议的 Node.js Host。
"""

import json
import os
import re
import struct
import sys
import urllib.parse
import urllib.request

BRIDGE_NAME = "com.ibm.lab.capture"

# ── 捕获安全 spec（单点事实源）────────────────────────────────────────────
# 与 background.js、desktop/src-tauri/resources/bridge/host.js 共用同一份 JSON
# （browser-extension/…/capture-spec.json），避免安全边界各自维护而漂移。
# 找不到 spec 时直接失败（fail-closed），不回退到“宽容”的旧常量。
_CAPTURE_SPEC_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "capture-spec.json",
)


def _load_capture_spec():
    try:
        with open(_CAPTURE_SPEC_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # fail closed
        raise RuntimeError(
            "cannot load capture security spec %s (%s)" % (_CAPTURE_SPEC_FILE, exc)
        ) from exc


_spec = _load_capture_spec()
MAX_FILE_BYTES = int(_spec.get("maxFileBytes", 100 * 1024 * 1024))
CAPTURE_UPLOAD_PATH = str(_spec.get("captureUploadPath", "/api/lab-capture-upload"))
LOOPBACK_HOSTS = set(_spec.get("loopbackHosts", ["127.0.0.1", "localhost", "::1"]))
TASK_ID_RE = re.compile(str(_spec.get("taskIdPattern", r"^capture-[a-z0-9]+$")))


def configure_binary_stdio():
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack("@I", raw)
    if length <= 0 or length > 1024 * 1024:
        return None
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def write_message(value):
    data = json.dumps(value, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def _browser_download_dirs():
    found = []
    roots = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "User Data"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Edge", "User Data"),
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for name in os.listdir(root):
            preferences = os.path.join(root, name, "Preferences")
            if not os.path.isfile(preferences):
                continue
            try:
                with open(preferences, "r", encoding="utf-8") as handle:
                    directory = (json.load(handle).get("download", {}) or {}).get("default_directory")
                if directory:
                    found.append(os.path.expandvars(directory))
            except Exception:
                continue
    return found


def downloads_dirs():
    dirs = _browser_download_dirs()
    try:
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as handle:
            value, _ = winreg.QueryValueEx(handle, "{374DE290-123F-4565-9164-39C4925E467B}")
        dirs.append(os.path.expandvars(value))
    except Exception:
        pass
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    dirs.extend([os.path.join(home, name) for name in ("Downloads", "下载", "Desktop", "桌面")])
    seen = set()
    result = []
    for directory in dirs:
        key = os.path.normcase(os.path.abspath(directory))
        if directory and os.path.isdir(directory) and key not in seen:
            seen.add(key)
            result.append(directory)
    return result


def _inside_directory(candidate, base):
    try:
        return os.path.commonpath([
            os.path.normcase(os.path.realpath(candidate)),
            os.path.normcase(os.path.realpath(base)),
        ]) == os.path.normcase(os.path.realpath(base))
    except ValueError:
        return False


def resolve_download_path(download_path):
    if not download_path:
        return None, "empty download path"
    normalized = os.path.normpath(download_path.replace("/", os.sep).replace("\\", os.sep))
    bases = downloads_dirs()
    candidates = [normalized] if os.path.isabs(normalized) else [os.path.join(base, normalized) for base in bases]
    for candidate in candidates:
        absolute = os.path.abspath(candidate)
        if any(_inside_directory(absolute, base) for base in bases) and os.path.isfile(absolute):
            return absolute, None
    return None, "file is missing or outside approved download directories: " + download_path


def validate_upload_url(value):
    parsed = urllib.parse.urlparse(str(value or ""))
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    if parsed.scheme != "http" or (parsed.hostname or "").lower() not in LOOPBACK_HOSTS:
        raise ValueError("uploadUrl is not a loopback iBM capture endpoint")
    if parsed.path != CAPTURE_UPLOAD_PATH or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("uploadUrl contains unauthorized components")
    if set(query) != {"token"} or len(query["token"]) != 1 or not query["token"][0]:
        raise ValueError("uploadUrl must contain exactly one capture token")
    return value


def upload(upload_url, file_path, file_name):
    validate_upload_url(upload_url)
    size = os.path.getsize(file_path)
    if size < 1 or size > MAX_FILE_BYTES:
        raise ValueError("file size is outside the capture limit")
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
    configure_binary_stdio()
    message = read_message()
    if not message:
        write_message({"ok": False, "error": "empty message"})
        return
    if message.get("cmd") != "upload":
        write_message({"ok": False, "error": "unsupported command: download bridge accepts upload only"})
        return
    task_id = str(message.get("taskId", ""))
    upload_url = str(message.get("uploadUrl", ""))
    download_path = str(message.get("downloadPath", "") or message.get("relativePath", ""))
    file_name = str(message.get("fileName", "") or os.path.basename(download_path.replace("\\", "/")))
    if not TASK_ID_RE.fullmatch(task_id):
        write_message({"ok": False, "error": "invalid taskId"})
        return
    try:
        validate_upload_url(upload_url)
    except Exception as error:
        write_message({"ok": False, "taskId": task_id, "error": str(error)})
        return
    file_path, path_error = resolve_download_path(download_path)
    if path_error:
        write_message({"ok": False, "taskId": task_id, "error": path_error})
        return
    try:
        response = upload(upload_url, file_path, file_name)
        ok = bool(response.get("ok"))
        write_message({"ok": ok, "taskId": task_id, "response": response,
                       "error": None if ok else response.get("error", "upload rejected")})
    except Exception as error:
        write_message({"ok": False, "taskId": task_id, "error": str(error)})


if __name__ == "__main__":
    main()
