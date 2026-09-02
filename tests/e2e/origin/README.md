# Origin MCP 真机 E2E（tests/e2e/origin）

iBM-Lab-Agent 桌面版内置 `origin-mcp==0.1.4`，通过捆绑 Python
（`resources/python/dist/python.exe`）以 `python -m origin_mcp` 启动，
不依赖系统 Python、不要求 `pip install origin-mcp`。

本目录提供真机 E2E 的数据与期望；**只有装有 Origin/OriginPro 的机器
才能执行真机 E2E**。无 Origin 环境时运行下方的「无 Origin 诊断验证」，
并如实报告 `自动化测试：通过 / Origin 真机 E2E：未执行`。

## 0. 前置条件

- Windows + 已安装 Origin/OriginPro（版本不限，origin-mcp 通过
  Origin Automation Server 驱动）。
- 已构建 bundled Python：
  `desktop\scripts\build-bundled-python.ps1 -SourceRoot ..`
  （自检会打印 `origin-mcp OK: 0.1.4`）。

## 1. 真机 E2E 流程

1. 安装 / 启动 Origin（保持窗口打开或允许 Automation Server 后台运行）。
2. 桌面端：打开 **诊断** → **Origin/OriginPro** → 点击
   **准备 Origin Bridge（install-origin-app）**，按输出的 OPX 指令在
   Origin 中完成 Bridge App 注册。
3. 每次新的 Origin session：点击 Origin 内 **MCP Bridge Start**。
4. 桌面端 **测试连接**：预期 `serverConnected=true`；若 Bridge 未启动，
   预期 `connected=false`、`state=bridge-missing`，UI 显示
   “Origin MCP Server 正常，但 Origin MCP Bridge 未启动”，不得崩溃。
5. 启用 Origin MCP（无需目录；DSH 自动注入
   `IBM_LAB_AGENT_BUNDLED_PYTHON` + `python -m origin_mcp`，
   工具前缀 `mcp__origin__*`）。如需要，重启 iBM Runtime。
6. 用 Agent 执行（数据见 `sample.csv`，期望见 `expected.json`）：

   ```text
   create_workbook → write_worksheet（sample.csv 数据）→
   create_line_plot → linear_fit → export_png → save_opju
   ```

7. 核对：Linear Fit slope≈2.0 / intercept≈1.0 / R²≥0.99；
   PNG 非空；OPJU 保存成功。

## 2. 无 Origin 诊断验证（自动化测试可覆盖）

无 Origin/未启动 Bridge 时，桌面与 CLI 都必须正常工作：

```powershell
# bundled python 可直接调用 origin_mcp CLI（bridge 不可用也是合法 JSON）
& <repo>\desktop\src-tauri\resources\python\dist\python.exe -I -m origin_mcp status --json
# 顶层必须包含 state / exit_code / diagnostics；不允许 ModuleNotFoundError
```

预期状态语义（Desktop 诊断页）：

| 环境 | server_connected | connected | state |
| --- | --- | --- | --- |
| origin-mcp 已装、Origin 已装、Bridge 未启动 | true | false | bridge-missing |
| origin-mcp 已装、Origin 未启动 | true | false | origin-unreachable |
| Origin 未安装 | 不阻塞启动 | false | （诊断项 warning，DSH 正常） |

## 3. 回归门槛

- 未安装 Origin：Desktop 正常启动、runtime deps 正常返回。
- Origin MCP enabled 但 Origin 未启动：DSH 正常启动、工具可注册，
  调用 Origin 工具时才报告不可用。
- Bridge 未启动：测试连接不得崩溃。
- Mnova MCP 与 PDF/Edge/文献捕获链路不受影响。
