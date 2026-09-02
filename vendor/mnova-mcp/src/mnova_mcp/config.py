from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_MNOVA_EXE = Path(
    r"C:\Program Files\Mestrelab Research S.L\MestReNova\MestReNova.exe"
)


def _path_env(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else default


def _package_asset(name: str) -> Path:
    """Resolve a file bundled inside this installed package (wheel/site-packages)."""
    return Path(__file__).resolve().parent / "assets" / name


@dataclass(frozen=True)
class Settings:
    project_root: Path
    output_root: Path
    mnova_exe: Path
    bridge_script: Path
    timeout_seconds: int = 300

    @classmethod
    def from_environment(cls) -> "Settings":
        # Workspace/output/bridge 均由环境变量注入（iBM Lab Agent 设置）。
        # 未注入时的兜底不依赖源码 checkout 布局：workspace 回退 cwd，
        # bridge 始终回退包内 asset（wheel / site-packages 安装后依然存在）。
        project_root = _path_env("MNOVA_MCP_WORKSPACE", Path.cwd())
        output_root = _path_env(
            "MNOVA_MCP_OUTPUT_ROOT", project_root / "mnova-mcp-output"
        )
        bridge_script = _path_env(
            "MNOVA_MCP_BRIDGE_SCRIPT", _package_asset("bridge.qs")
        )
        mnova_exe = _path_env("MNOVA_EXE", DEFAULT_MNOVA_EXE)
        timeout = int(os.environ.get("MNOVA_MCP_TIMEOUT_SEC", "300"))
        return cls(
            project_root=project_root.resolve(),
            output_root=output_root.resolve(),
            mnova_exe=mnova_exe.resolve(),
            bridge_script=bridge_script.resolve(),
            timeout_seconds=timeout,
        )

    def ensure_output_root(self) -> None:
        self.output_root.mkdir(parents=True, exist_ok=True)
