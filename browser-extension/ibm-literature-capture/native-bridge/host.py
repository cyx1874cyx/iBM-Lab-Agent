#!/usr/bin/env python3
"""
iBM Lab Native Messaging 本地桥接宿主（Windows）。

支持两项由用户明确触发的操作：
  - upload：读取指定下载文件并上传到一次性捕获地址；
  - save_artifact：从可信本机 iBM 接口下载 PPTX/DOCX，校验后保存到下载目录。

安全边界：
  - 不读取 Cookie、浏览历史或任何其他文件；
  - Chrome 返回绝对下载路径；只允许路径落在 Chrome/Edge 配置或系统下载目录内；
  - 上传地址由服务端一次性令牌保护，不可复用。
"""

import json
import hashlib
import os
import re
import struct
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

BRIDGE_NAME = "com.ibm.lab.capture"
MAX_FILE_BYTES = 100 * 1024 * 1024
ARTIFACT_PATH = "/api/lab-artifacts"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ARTIFACT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
INVALID_FILE_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def configure_binary_stdio():
    """Windows Native Messaging 必须禁用标准流的 CRLF 文本转换。"""
    if os.name != "nt":
        return
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


def _inside_directory(candidate, base):
    """使用 realpath/commonpath 判断 candidate 是否严格位于 base 内。"""
    candidate_real = os.path.normcase(os.path.realpath(candidate))
    base_real = os.path.normcase(os.path.realpath(base))
    try:
        return os.path.commonpath([candidate_real, base_real]) == base_real
    except ValueError:  # 不同盘符
        return False


def resolve_download_path(download_path):
    """解析 Chrome 的绝对路径（兼容旧相对值），并强制限制在批准的下载目录内。"""
    if not download_path:
        return None, "empty download path"
    norm = os.path.normpath(download_path.replace("/", os.sep).replace("\\", os.sep))
    bases = downloads_dirs()
    candidates = [norm] if os.path.isabs(norm) else [os.path.join(base, norm) for base in bases]
    for candidate in candidates:
        candidate_abs = os.path.abspath(candidate)
        if not any(_inside_directory(candidate_abs, base) for base in bases):
            continue
        if os.path.isfile(candidate_abs):
            return candidate_abs, None
    return None, "file is missing or outside approved download directories: " + download_path


def upload(upload_url, file_path, file_name):
    """PUT 上传；服务端校验一次性 token、Origin 与文件类型。"""
    parsed = urllib.parse.urlparse(upload_url)
    query = urllib.parse.parse_qs(parsed.query)
    if parsed.scheme not in ("http", "https") or parsed.path != "/api/lab-capture-upload" or not query.get("token"):
        raise ValueError("uploadUrl is not an iBM capture endpoint")
    size = os.path.getsize(file_path)
    if size > MAX_FILE_BYTES:
        raise ValueError("file exceeds 100 MB capture limit")
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


def normalized_origin(value):
    """规范化 HTTP(S) origin，拒绝凭据、路径、查询和片段。"""
    parsed = urllib.parse.urlparse(str(value or ""))
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("trustedOrigin is not a valid HTTP(S) origin")
    if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("trustedOrigin must contain only scheme, host and port")
    host = parsed.hostname.lower()
    authority = f"[{host}]" if ":" in host else host
    default_port = 80 if parsed.scheme == "http" else 443
    if parsed.port and parsed.port != default_port:
        authority += f":{parsed.port}"
    return f"{parsed.scheme}://{authority}"


def validate_artifact_url(artifact_url, trusted_origin):
    """只接受可信本机 iBM 服务中的已审核 PPTX/DOCX 下载地址。"""
    parsed = urllib.parse.urlparse(str(artifact_url or ""))
    origin = normalized_origin(trusted_origin)
    if normalized_origin(f"{parsed.scheme}://{parsed.netloc}") != origin:
        raise ValueError("artifactUrl origin does not match trustedOrigin")
    if parsed.hostname.lower() not in LOOPBACK_HOSTS:
        raise ValueError("artifactUrl must use a loopback host")
    if parsed.path != ARTIFACT_PATH or parsed.fragment or parsed.username or parsed.password:
        raise ValueError("artifactUrl is not an iBM artifact endpoint")
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    kind = (query.get("kind") or [""])[0]
    report_id = (query.get("reportId") or [""])[0]
    allowed_keys = {"kind", "reportId", "format"} if kind == "report" else {"kind", "reportId"}
    if not set(query).issubset(allowed_keys) or any(len(values) != 1 for values in query.values()):
        raise ValueError("artifactUrl contains unsupported or duplicate parameters")
    if not ARTIFACT_ID_RE.fullmatch(report_id):
        raise ValueError("artifactUrl contains an invalid reportId")
    if kind == "ppt":
        return ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if kind == "report" and (query.get("format") or [""])[0] == "docx":
        return ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    raise ValueError("artifactUrl only supports approved PPTX or DOCX artifacts")


def sanitize_artifact_name(raw_name, expected_extension):
    """将响应文件名限制为安全的 Windows basename，并固定 Office 扩展名。"""
    decoded = urllib.parse.unquote(str(raw_name or ""))
    name = os.path.basename(decoded.replace("\\", "/"))
    name = INVALID_FILE_CHARS_RE.sub("_", name).strip(" .")
    stem, extension = os.path.splitext(name)
    if extension.lower() != expected_extension:
        raise ValueError(f"artifact file name must end with {expected_extension}")
    stem = stem.strip(" .") or "artifact"
    if stem.upper() in WINDOWS_RESERVED_NAMES:
        stem = "_" + stem
    stem = stem[: max(1, 180 - len(expected_extension))].rstrip(" .")
    return stem + expected_extension


def available_destination(directory, file_name):
    """避免覆盖现有文件，按 Windows 常见规则追加 (n)。"""
    stem, extension = os.path.splitext(file_name)
    candidate = os.path.join(directory, file_name)
    for index in range(1, 10000):
        if not os.path.exists(candidate):
            return candidate
        candidate = os.path.join(directory, f"{stem} ({index}){extension}")
    raise ValueError("too many files with the same artifact name")


def validate_office_package(file_path, expected_extension):
    """验证 ZIP 完整性及格式核心部件，避免把错误页保存成 Office 文件。"""
    required_part = "ppt/presentation.xml" if expected_extension == ".pptx" else "word/document.xml"
    try:
        with zipfile.ZipFile(file_path, "r") as package:
            names = set(package.namelist())
            if "[Content_Types].xml" not in names or required_part not in names:
                raise ValueError("downloaded file is not the expected Office package")
            corrupt_part = package.testzip()
            if corrupt_part:
                raise ValueError("downloaded Office package contains a corrupt part: " + corrupt_part)
    except zipfile.BadZipFile as error:
        raise ValueError("downloaded file is not a valid Office ZIP package") from error


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """本地保存不跟随重定向，防止可信端点把桥接带到其他来源。"""

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        raise ValueError("artifact endpoint redirects are not allowed")


def save_artifact(artifact_url, trusted_origin):
    """从可信本机接口流式下载、校验并原子写入浏览器下载目录。"""
    expected_extension, expected_mime = validate_artifact_url(artifact_url, trusted_origin)
    directories = downloads_dirs()
    if not directories:
        raise ValueError("no approved Windows download directory is available")
    destination_dir = directories[0]
    request = urllib.request.Request(artifact_url, method="GET", headers={"Accept": expected_mime})
    opener = urllib.request.build_opener(NoRedirectHandler())
    temp_path = None
    try:
        with opener.open(request, timeout=300) as response:
            content_type = str(response.headers.get("Content-Type", "")).split(";", 1)[0].lower()
            if content_type != expected_mime:
                raise ValueError("artifact response has an unexpected Content-Type")
            expected_hash = str(response.headers.get("X-Content-SHA256", "")).lower()
            if not SHA256_RE.fullmatch(expected_hash):
                raise ValueError("artifact response is missing a valid SHA-256 header")
            try:
                expected_bytes = int(response.headers.get("Content-Length", ""))
            except ValueError as error:
                raise ValueError("artifact response is missing a valid Content-Length") from error
            if expected_bytes < 1 or expected_bytes > MAX_FILE_BYTES:
                raise ValueError("artifact size is outside the allowed range")
            file_name = sanitize_artifact_name(response.headers.get("X-File-Name", ""), expected_extension)
            destination = available_destination(destination_dir, file_name)
            descriptor, temp_path = tempfile.mkstemp(prefix=".ibm-artifact-", suffix=".part", dir=destination_dir)
            digest = hashlib.sha256()
            byte_length = 0
            with os.fdopen(descriptor, "wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    byte_length += len(chunk)
                    if byte_length > MAX_FILE_BYTES:
                        raise ValueError("artifact exceeds the 100 MB limit")
                    handle.write(chunk)
                    digest.update(chunk)
                handle.flush()
                os.fsync(handle.fileno())
        if byte_length != expected_bytes:
            raise ValueError(f"artifact length mismatch: expected {expected_bytes}, received {byte_length}")
        actual_hash = digest.hexdigest()
        if actual_hash != expected_hash:
            raise ValueError("artifact SHA-256 mismatch")
        validate_office_package(temp_path, expected_extension)
        os.replace(temp_path, destination)
        temp_path = None
        zone_stream = destination + ":Zone.Identifier"
        if os.name == "nt":
            try:
                os.remove(zone_stream)
            except FileNotFoundError:
                pass
        return {
            "ok": True,
            "fileName": os.path.basename(destination),
            "filePath": destination,
            "byteLength": byte_length,
            "sha256": actual_hash,
        }
    finally:
        if temp_path:
            try:
                os.remove(temp_path)
            except FileNotFoundError:
                pass


def main():
    configure_binary_stdio()
    message = read_message()
    if not message:
        write_message({"ok": False, "error": "empty message"})
        return
    command = message.get("cmd")
    if command == "save_artifact":
        artifact_url = str(message.get("artifactUrl", ""))
        trusted_origin = str(message.get("trustedOrigin", ""))
        try:
            write_message(save_artifact(artifact_url, trusted_origin))
        except Exception as error:  # noqa: BLE001 — 桥接边界，任何异常都要回传
            write_message({"ok": False, "error": str(error)})
        return
    if command != "upload":
        write_message({"ok": False, "error": "unsupported command"})
        return

    task_id = str(message.get("taskId", ""))
    upload_url = str(message.get("uploadUrl", ""))
    download_path = str(message.get("downloadPath", "") or message.get("relativePath", ""))
    file_name = str(message.get("fileName", "") or os.path.basename(download_path.replace("\\", "/")))

    if not task_id or not upload_url.startswith(("http://", "https://")):
        write_message({"ok": False, "error": "missing taskId or uploadUrl"})
        return

    file_path, path_error = resolve_download_path(download_path)
    if path_error:
        write_message({"ok": False, "taskId": task_id, "error": path_error})
        return
    if not os.path.isfile(file_path):
        write_message({"ok": False, "taskId": task_id, "error": "file not found: " + download_path})
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
