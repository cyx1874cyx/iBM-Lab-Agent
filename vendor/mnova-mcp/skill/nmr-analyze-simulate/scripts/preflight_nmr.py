#!/usr/bin/env python3
"""Select a usable Python and inspect an NMR dataset before processing it."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


PROBE = r'''
import importlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
if root.is_file(): root = root.parent
required = sys.argv[2:]
versions = {}
for name in required:
    module = importlib.import_module(name)
    versions[name] = getattr(module, "__version__", "available")
result = {"python": sys.executable, "python_version": sys.version.split()[0], "packages": versions,
          "dataset": str(root), "vendor": "unknown", "data_shape": None, "metadata": {}}
def proc_value(procpar, name):
    row = procpar.get(name, {})
    values = row.get("values", []) if isinstance(row, dict) else []
    return values[0] if values else None
if (root / "fid").exists() and (root / "procpar").exists():
    import nmrglue as ng
    dic, data = ng.varian.read(str(root))
    procpar = dic.get("procpar", {})
    result.update(vendor="varian-agilent", data_shape=list(data.shape),
                  metadata={key: proc_value(procpar, key) for key in
                            ["np", "sw", "sfrq", "at", "d1", "nt", "tn", "solvent"]})
elif ((root / "fid").exists() or (root / "ser").exists()) and (root / "acqus").exists():
    import nmrglue as ng
    dic, data = ng.bruker.read(str(root))
    acqus = dic.get("acqus", {})
    result.update(vendor="bruker", data_shape=list(data.shape),
                  metadata={key: acqus.get(key) for key in
                            ["SW_h", "SFO1", "AQ", "D", "NS", "NUC1", "SOLVENT"]})
print(json.dumps(result, ensure_ascii=False, default=str))
'''


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Vendor dataset directory or a file inside it")
    parser.add_argument("--bundled-python", type=Path, help="Explicit application-bundled Python")
    parser.add_argument("--mnova-workspace", type=Path, help="Configured Mnova MCP workspace root")
    parser.add_argument("--timeout", type=float, default=30.0, help="Seconds allowed per candidate")
    return parser.parse_args()


def executable_in(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def candidate_commands(dataset: Path, bundled: Path | None) -> list[tuple[str, list[str]]]:
    root = dataset.resolve().parent if dataset.resolve().is_file() else dataset.resolve()
    result: list[tuple[str, list[str]]] = []
    for parent in [root, *root.parents]:
        for name in (".venv", "venv", ".nmr_env"):
            executable = executable_in(parent / name)
            if executable.is_file():
                result.append((f"dataset-{name}", [str(executable)]))
    explicit = bundled or (Path(os.environ["IBM_LAB_AGENT_BUNDLED_PYTHON"])
                           if os.environ.get("IBM_LAB_AGENT_BUNDLED_PYTHON") else None)
    if explicit and explicit.is_file():
        result.append(("bundled", [str(explicit)]))
    result.append(("current", [sys.executable]))
    if os.name == "nt":
        result.extend((("py-3.11", ["py", "-3.11"]), ("py-3", ["py", "-3"]), ("system", ["python"])))
    else:
        result.append(("system", ["python3"]))
    unique: list[tuple[str, list[str]]] = []
    seen: set[tuple[str, ...]] = set()
    for source, command in result:
        key = tuple(command)
        if key not in seen:
            seen.add(key)
            unique.append((source, command))
    return unique


def inside(root: Path | None, target: Path) -> bool | None:
    if root is None:
        return None
    try:
        target.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def main() -> int:
    args = parse_args()
    dataset = args.input.expanduser().resolve()
    if not dataset.exists():
        raise FileNotFoundError(dataset)
    attempts = []
    selected = None
    required = ["numpy", "scipy", "matplotlib", "nmrglue"]
    for source, command in candidate_commands(dataset, args.bundled_python):
        try:
            completed = subprocess.run(
                [*command, "-I", "-c", PROBE, str(dataset), *required],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=args.timeout, check=False,
            )
            if completed.returncode != 0:
                attempts.append({"source": source, "command": command, "ok": False,
                                 "error": (completed.stderr or completed.stdout).strip()[-1200:]})
                continue
            value = json.loads(completed.stdout)
            attempts.append({"source": source, "command": command, "ok": True})
            selected = {"source": source, "command": command, **value}
            break
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            attempts.append({"source": source, "command": command, "ok": False, "error": str(exc)})
    result = {
        "ok": selected is not None,
        "selected": selected,
        "attempts": attempts,
        "mnova_workspace": str(args.mnova_workspace.resolve()) if args.mnova_workspace else None,
        "path_accessible_to_mnova": inside(args.mnova_workspace, dataset),
    }
    if selected is None:
        result["error"] = "No candidate Python could import all required packages and read the dataset."
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if selected else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        raise SystemExit(2)
