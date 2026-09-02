from __future__ import annotations

import ctypes
import csv
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

from filelock import FileLock, Timeout as FileLockTimeout

from .config import Settings


STRUCTURE_SUFFIXES = {
    ".cdx",
    ".cdxml",
    ".mol",
    ".sdf",
    ".sd",
    ".mrv",
    ".cml",
    ".smi",
    ".inchi",
}
CONFIDENCE_LEVELS = {"high", "medium", "low"}
ASSIGNMENT_LABEL_RE = re.compile(r"^[a-z]+$")


class MnovaError(RuntimeError):
    """A user-facing Mnova bridge error."""


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _file_version(path: Path) -> str | None:
    if os.name != "nt":
        return None
    try:
        version = ctypes.WinDLL("version", use_last_error=True)
        get_size = version.GetFileVersionInfoSizeW
        get_size.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_uint)]
        get_size.restype = ctypes.c_uint
        handle = ctypes.c_uint(0)
        size = get_size(str(path), ctypes.byref(handle))
        if not size:
            return None
        buffer = ctypes.create_string_buffer(size)
        if not version.GetFileVersionInfoW(
            str(path), handle, size, ctypes.byref(buffer)
        ):
            return None
        query = ctypes.c_void_p()
        query_size = ctypes.c_uint(0)
        if not version.VerQueryValueW(
            ctypes.byref(buffer), "\\", ctypes.byref(query), ctypes.byref(query_size)
        ):
            return None

        class VS_FIXEDFILEINFO(ctypes.Structure):
            _fields_ = [
                ("signature", ctypes.c_uint32),
                ("struct_version", ctypes.c_uint32),
                ("file_version_ms", ctypes.c_uint32),
                ("file_version_ls", ctypes.c_uint32),
                ("product_version_ms", ctypes.c_uint32),
                ("product_version_ls", ctypes.c_uint32),
                ("file_flags_mask", ctypes.c_uint32),
                ("file_flags", ctypes.c_uint32),
                ("file_os", ctypes.c_uint32),
                ("file_type", ctypes.c_uint32),
                ("file_subtype", ctypes.c_uint32),
                ("file_date_ms", ctypes.c_uint32),
                ("file_date_ls", ctypes.c_uint32),
            ]

        info = ctypes.cast(query, ctypes.POINTER(VS_FIXEDFILEINFO)).contents
        return ".".join(
            str(value)
            for value in (
                info.file_version_ms >> 16,
                info.file_version_ms & 0xFFFF,
                info.file_version_ls >> 16,
                info.file_version_ls & 0xFFFF,
            )
        )
    except (OSError, AttributeError, ctypes.ArgumentError):
        return None


def find_mnova_executable(settings: Settings) -> Path | None:
    candidates = [settings.mnova_exe]
    program_files = os.environ.get("ProgramFiles")
    if program_files:
        candidates.append(
            Path(program_files)
            / "Mestrelab Research S.L"
            / "MestReNova"
            / "MestReNova.exe"
        )
    path_candidate = shutil.which("MestReNova.exe")
    if path_candidate:
        candidates.append(Path(path_candidate))
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file():
            return resolved
    return None


def _project_file(
    path_value: str,
    settings: Settings,
    *,
    label: str,
    suffixes: set[str] | None = None,
) -> Path:
    path = Path(path_value).expanduser().resolve()
    if not _is_within(path, settings.project_root):
        raise MnovaError(f"{label}必须位于当前项目内: {path}")
    if not path.is_file():
        raise MnovaError(f"{label}不存在或不是文件: {path}")
    if suffixes is not None and path.suffix.lower() not in suffixes:
        allowed = ", ".join(sorted(suffixes))
        raise MnovaError(f"{label}格式不受支持: {path.suffix}；可用格式: {allowed}")
    return path


def resolve_dataset(path_value: str, settings: Settings) -> tuple[Path, Path]:
    path = Path(path_value).expanduser().resolve()
    if not _is_within(path, settings.project_root):
        raise MnovaError(f"输入路径必须位于当前项目内: {path}")
    if not path.exists():
        raise MnovaError(f"输入路径不存在: {path}")
    if path.is_file():
        # A file cannot contain an output directory, so use the file itself as
        # the protected root. This also permits the default output directory.
        return path, path

    for entry_name in ("fid", "ser", "1r"):
        candidate = path / entry_name
        if candidate.is_file():
            return candidate, path
    raise MnovaError(
        f"无法识别 NMR 数据目录: {path}。目录内需要包含 fid、ser 或 1r 文件。"
    )


def _validate_template(path_value: str | None, settings: Settings) -> Path | None:
    if not path_value:
        return None
    return _project_file(
        path_value,
        settings,
        label="处理模板",
        suffixes={".mnp"},
    )


def resolve_structure(path_value: str, settings: Settings) -> Path:
    return _project_file(
        path_value,
        settings,
        label="结构文件",
        suffixes=STRUCTURE_SUFFIXES,
    )


def resolve_mnova_document(path_value: str, settings: Settings) -> Path:
    return _project_file(
        path_value,
        settings,
        label="Mnova 文档",
        suffixes={".mnova", ".mnpag"},
    )


def _validate_assignment_plan(
    path_value: str,
    settings: Settings,
    *,
    allow_low_confidence: bool,
) -> tuple[Path, dict[str, Any]]:
    path = _project_file(
        path_value,
        settings,
        label="指认计划",
        suffixes={".json"},
    )
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MnovaError(f"指认计划不是有效的 UTF-8 JSON: {path}") from exc
    assignments = plan.get("assignments")
    if not isinstance(assignments, list) or not assignments:
        raise MnovaError("指认计划必须包含非空 assignments 数组")

    seen_targets: set[tuple[int, str]] = set()
    label_to_multiplet: dict[str, str] = {}
    for index, assignment in enumerate(assignments):
        prefix = f"assignments[{index}]"
        if not isinstance(assignment, dict):
            raise MnovaError(f"{prefix} 必须是对象")
        atom_index = assignment.get("atom_index")
        if isinstance(atom_index, bool) or not isinstance(atom_index, int) or atom_index < 1:
            raise MnovaError(f"{prefix}.atom_index 必须是大于 0 的整数")
        h_index = assignment.get("h_index")
        if h_index is not None and not isinstance(h_index, (int, str)):
            raise MnovaError(f"{prefix}.h_index 必须是整数、字符串或 null")
        multiplet_uuid = assignment.get("multiplet_uuid")
        if not isinstance(multiplet_uuid, str) or not multiplet_uuid.strip():
            raise MnovaError(f"{prefix}.multiplet_uuid 不能为空")
        label = assignment.get("label")
        if not isinstance(label, str) or not ASSIGNMENT_LABEL_RE.fullmatch(label):
            raise MnovaError(
                f"{prefix}.label 必须是小写英文字母（如 a、b、aa）"
            )
        prior_multiplet = label_to_multiplet.get(label)
        if prior_multiplet is not None and prior_multiplet != multiplet_uuid:
            raise MnovaError(
                f"{prefix}.label {label!r} 已指向另一个 multiplet UUID"
            )
        label_to_multiplet[label] = multiplet_uuid
        confidence = assignment.get("confidence")
        if confidence not in CONFIDENCE_LEVELS:
            raise MnovaError(
                f"{prefix}.confidence 必须是 high、medium 或 low"
            )
        if confidence == "low" and not allow_low_confidence:
            raise MnovaError(
                f"{prefix} 是低置信度指认；默认拒绝写回。"
                "请移入 unresolved，或显式启用 allow_low_confidence。"
            )
        for field in ("ppm", "range_min_ppm", "range_max_ppm"):
            value = assignment.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise MnovaError(f"{prefix}.{field} 必须是有限数值")
            if not math.isfinite(float(value)):
                raise MnovaError(f"{prefix}.{field} 必须是有限数值")
        range_min = float(assignment["range_min_ppm"])
        range_max = float(assignment["range_max_ppm"])
        ppm = float(assignment["ppm"])
        low, high = sorted((range_min, range_max))
        if not low <= ppm <= high:
            raise MnovaError(f"{prefix}.ppm 必须落在指认范围内")
        target = (atom_index, str(h_index) if h_index is not None else "")
        if target in seen_targets:
            raise MnovaError(f"{prefix} 与前面的原子/氢位点重复: {target}")
        seen_targets.add(target)
    return path, plan


def _write_assignment_csv(output: Path, plan: dict[str, Any]) -> None:
    fields = [
        "label",
        "atom_index",
        "h_index",
        "multiplet_uuid",
        "ppm",
        "range_min_ppm",
        "range_max_ppm",
        "confidence",
        "evidence",
    ]
    with (output / "assignments.applied.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(plan["assignments"])


def _make_output_dir(
    requested: str | None, settings: Settings, input_root: Path, job_id: str
) -> Path:
    output = (
        Path(requested).expanduser().resolve()
        if requested
        else settings.output_root / job_id
    )
    if not _is_within(output, settings.project_root):
        raise MnovaError(f"输出目录必须位于当前项目内: {output}")
    if _is_within(output, input_root):
        raise MnovaError("输出目录不能位于原始输入数据目录内")
    if output.exists() and any(output.iterdir()):
        raise MnovaError(f"输出目录非空，为避免覆盖已拒绝: {output}")
    output.mkdir(parents=True, exist_ok=True)
    return output


def status(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or Settings.from_environment()
    executable = find_mnova_executable(settings)
    return {
        "ok": executable is not None and settings.bridge_script.is_file(),
        "mnova_executable": str(executable) if executable else None,
        "mnova_version": _file_version(executable) if executable else None,
        "bridge_script": str(settings.bridge_script),
        "bridge_script_exists": settings.bridge_script.is_file(),
        "project_root": str(settings.project_root),
        "output_root": str(settings.output_root),
        "supported_scope": (
            "1D NMR processing; ChemDraw structure import; auditable molecular "
            "assignments; optional Mnova Verify"
        ),
        "structure_formats": sorted(STRUCTURE_SUFFIXES),
        "workflow": [
            "mnova_prepare_structure_1d",
            "mnova_apply_assignments_1d",
        ],
    }


def _run_request(
    *,
    request: dict[str, Any],
    output: Path,
    settings: Settings,
    executable: Path,
) -> dict[str, Any]:
    request_path = output / "job.request.json"
    response_path = output / "job.response.json"
    request["output_dir"] = str(output)
    request["response_path"] = str(response_path)
    request_path.write_text(
        # Mnova 15's QtScript TextStream can ignore the requested codec on
        # some Windows builds. ASCII JSON escapes keep all paths reversible.
        json.dumps(request, ensure_ascii=True, indent=2), encoding="ascii"
    )

    # Mnova 15.0's command-line parser is more reliable with ASCII paths.
    # Keep the auditable request in the project and pass ASCII runtime copies.
    runtime_root = Path(
        os.environ.get(
            "MNOVA_MCP_RUNTIME_ROOT",
            str(Path(tempfile.gettempdir()) / "mnova-mcp-runtime"),
        )
    )
    runtime_root.mkdir(parents=True, exist_ok=True)
    job_id = request["job_id"]
    runtime_bridge = runtime_root / f"bridge-{job_id}.qs"
    runtime_request = runtime_root / f"request-{job_id}.json"
    shutil.copy2(settings.bridge_script, runtime_bridge)
    shutil.copy2(request_path, runtime_request)

    lock_path = settings.output_root / ".mnova.lock"
    try:
        with FileLock(str(lock_path), timeout=settings.timeout_seconds):
            completed = subprocess.run(
                [
                    str(executable),
                    str(runtime_bridge),
                    "-sf",
                    f"runJob,{runtime_request}",
                    "-w",
                ],
                cwd=str(executable.parent),
                capture_output=True,
                text=True,
                timeout=settings.timeout_seconds,
                check=False,
            )
    except FileLockTimeout as exc:
        raise MnovaError("另一个 Mnova 任务仍在运行，等待锁超时") from exc
    except subprocess.TimeoutExpired as exc:
        raise MnovaError(f"Mnova 任务超过 {settings.timeout_seconds} 秒") from exc

    (output / "mnova.stdout.log").write_text(
        completed.stdout or "", encoding="utf-8"
    )
    (output / "mnova.stderr.log").write_text(
        completed.stderr or "", encoding="utf-8"
    )
    if not response_path.is_file():
        raise MnovaError(
            "Mnova 未生成结构化响应。"
            f" exit_code={completed.returncode}; stderr={completed.stderr[-1000:]}"
        )
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise MnovaError(f"Mnova 响应不是有效 JSON: {response_path}") from exc
    if response.get("status") != "ok":
        message = response.get("error") or completed.stderr[-1000:] or "Mnova 任务失败"
        raise MnovaError(message)
    return response


def _ready(settings: Settings | None) -> tuple[Settings, Path]:
    resolved = settings or Settings.from_environment()
    resolved.ensure_output_root()
    executable = find_mnova_executable(resolved)
    if not executable:
        raise MnovaError("找不到 MestReNova.exe，请设置 MNOVA_EXE")
    if not resolved.bridge_script.is_file():
        raise MnovaError(f"桥接脚本不存在: {resolved.bridge_script}")
    return resolved, executable


def process_1d(
    input_path: str,
    output_dir: str | None = None,
    processing_template_path: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings, executable = _ready(settings)
    dataset, input_root = resolve_dataset(input_path, settings)
    template = _validate_template(processing_template_path, settings)
    job_id = uuid.uuid4().hex
    output = _make_output_dir(output_dir, settings, input_root, job_id)
    request = {
        "schema_version": "1.1",
        "operation": "process_1d",
        "job_id": job_id,
        "input_path": str(dataset),
        "processing_template_path": str(template) if template else None,
        "analysis": {
            "auto_peak_picking": True,
            "auto_integrals": True,
            "auto_multiplets": True,
        },
    }
    return _run_request(
        request=request, output=output, settings=settings, executable=executable
    )


def prepare_structure_1d(
    input_path: str,
    structure_path: str,
    output_dir: str | None = None,
    processing_template_path: str | None = None,
    run_verification: bool = True,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings, executable = _ready(settings)
    dataset, input_root = resolve_dataset(input_path, settings)
    structure = resolve_structure(structure_path, settings)
    template = _validate_template(processing_template_path, settings)
    job_id = uuid.uuid4().hex
    output = _make_output_dir(output_dir, settings, input_root, job_id)
    request = {
        "schema_version": "1.1",
        "operation": "prepare_structure_1d",
        "job_id": job_id,
        "input_path": str(dataset),
        "structure_path": str(structure),
        "processing_template_path": str(template) if template else None,
        "run_verification": bool(run_verification),
        "analysis": {
            "auto_peak_picking": True,
            "auto_integrals": True,
            "auto_multiplets": True,
        },
    }
    return _run_request(
        request=request, output=output, settings=settings, executable=executable
    )


def apply_assignments_1d(
    prepared_mnova_path: str,
    assignment_plan_path: str,
    output_dir: str | None = None,
    run_verification: bool = True,
    allow_low_confidence: bool = False,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings, executable = _ready(settings)
    prepared = resolve_mnova_document(prepared_mnova_path, settings)
    plan_path, plan = _validate_assignment_plan(
        assignment_plan_path,
        settings,
        allow_low_confidence=allow_low_confidence,
    )
    job_id = uuid.uuid4().hex
    output = _make_output_dir(output_dir, settings, prepared, job_id)
    request = {
        "schema_version": "1.1",
        "operation": "apply_assignments_1d",
        "job_id": job_id,
        "prepared_mnova_path": str(prepared),
        "assignment_plan_source_path": str(plan_path),
        "assignment_plan": plan,
        "assignment_count": len(plan["assignments"]),
        "run_verification": bool(run_verification),
        "allow_low_confidence": bool(allow_low_confidence),
    }
    response = _run_request(
        request=request, output=output, settings=settings, executable=executable
    )
    _write_assignment_csv(output, plan)
    return response
