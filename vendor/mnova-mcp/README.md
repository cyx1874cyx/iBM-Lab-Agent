# mnova-mcp

[![Tests](https://github.com/cyx1874cyx/mnova-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/cyx1874cyx/mnova-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个面向 **MestReNova 15** 的本地 STDIO MCP 服务，附带可直接安装的 Codex NMR Skill。它可以处理一维 NMR、导入 ChemDraw 结构、运行 Mnova Verify、将审核过的原子—多重峰指认写回 Mnova，并生成带来源记录的仿真一维 NMR FID。

> 本项目不包含 MestReNova 本体或许可证。Mnova Verify 功能取决于本地安装与授权。

## 主要功能

- 检查本地 MestReNova 及 MCP 桥接状态。
- 处理 Bruker、Varian/Agilent 或 Mnova 可读的一维 NMR 数据。
- 导入 `.cdx` / `.cdxml` 等机器可读结构，建立可审计的两阶段指认流程。
- 在结构上使用小写字母编号，并把对应字母水平放在目标峰正上方。
- 重叠指认使用 `k,l` 格式；同一原子的非等价氢可使用 `a,d` 格式。
- 默认拒绝低置信度写回，并保留未解决信号的审计记录。
- 生成可复现、明确标记为 synthetic 的复数 FID 和 Varian/Agilent `.fid` 数据集。

## 仓库结构

```text
mnova-mcp/
├─ mnova/bridge.qs                  # Mnova 15 桥接脚本
├─ src/mnova_mcp/                  # Python MCP 服务
├─ tests/                          # 单元测试和 STDIO 探针
├─ examples/cases/                 # 实测数据、结构和可审计产出
└─ skill/nmr-analyze-simulate/     # 可安装的 Codex Skill
```

## 环境要求

- Windows 10/11
- MestReNova 15.x
- Python 3.11 或 3.12
- [uv](https://docs.astral.sh/uv/)
- 如需 Verify：本地可用的 Mnova Verify/ASV 许可

## 快速开始

```powershell
git clone https://github.com/cyx1874cyx/mnova-mcp.git
cd mnova-mcp
uv sync --extra dev
uv run pytest
uv run mnova-mcp
```

MCP 默认通过 STDIO 运行。可用下面的探针检查握手和工具调用：

```powershell
uv run python tests/stdio_probe.py
```

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `MNOVA_EXE` | `MestReNova.exe` 路径；未设置时会检测常见安装位置 |
| `MNOVA_MCP_WORKSPACE` | 允许 MCP 读写的项目根目录 |
| `MNOVA_MCP_OUTPUT_ROOT` | 任务输出根目录 |
| `MNOVA_MCP_RUNTIME_ROOT` | 传递给 Mnova 的 ASCII 临时桥接目录 |
| `MNOVA_MCP_BRIDGE_SCRIPT` | 自定义 `bridge.qs` 路径 |
| `MNOVA_MCP_TIMEOUT_SEC` | Mnova 任务超时秒数，默认 300 |

## MCP 工具

- `mnova_status`
- `mnova_process_1d`
- `mnova_prepare_structure_1d`
- `mnova_apply_assignments_1d`

结构指认采用两阶段流程：

1. `mnova_prepare_structure_1d` 读取实测 NMR 和 ChemDraw 结构，输出原子索引、氢位点、multiplet UUID、Verify 信息和 `prepared.mnova`。
2. 调用方审核 `analysis.json`，构建 assignment-plan JSON，再调用 `mnova_apply_assignments_1d` 生成新的 `assigned.mnova`。

每个要写回的指认都需要独立的小写字母 `label`：

```json
{
  "schema_version": "1.1",
  "assignments": [
    {
      "label": "a",
      "atom_index": 4,
      "h_index": 1,
      "multiplet_uuid": "{uuid-from-analysis}",
      "ppm": 3.651,
      "range_min_ppm": 3.620,
      "range_max_ppm": 3.681,
      "confidence": "high",
      "evidence": "2H integral, expected OCH2 shift, and consistent splitting"
    }
  ],
  "unresolved": []
}
```

## 安装 Codex Skill

将 `skill/nmr-analyze-simulate` 复制到你的 `$CODEX_HOME/skills/` 目录，然后重新加载 Codex。Skill 中的解读、Mnova 指认和仿真规则位于：

- `skill/nmr-analyze-simulate/SKILL.md`
- `skill/nmr-analyze-simulate/references/`
- `skill/nmr-analyze-simulate/scripts/`

## 实测案例

- [DEGMA / CDCl3 / 400 MHz 1H NMR](examples/cases/degma-cdcl3-20260803-hnmr/README.md)：包含未修改的 Varian/Agilent FID 压缩包、目标结构、独立处理结果、Mnova 两阶段指认文档、最终标峰 PDF、归属表和 Verify 记录。

## 安全与科学边界

- 原始数据、ChemDraw 结构和已准备 Mnova 文档不会被覆盖。
- 每次运行写入新输出目录。
- 自动拾峰、自动积分和 Verify 分数只是决策支持，不是结构身份的独立证明。
- 仿真输出始终保留 `synthetic: true`、模型哈希、参数和随机种子。
- 当一维证据不唯一时，应保留 unresolved，并优先建议 COSY、HSQC 或 HMBC。

## 开发

```powershell
uv sync --extra dev
uv run pytest
uv run python tests/stdio_probe.py
```

## License

[MIT](LICENSE) © 2026 cyx1874cyx
