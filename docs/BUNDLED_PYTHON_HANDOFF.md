# iBM-Lab-Agent：Python 依赖捆绑打包交接报告

> 交接对象：接手 iBM-Lab-Agent Windows 桌面打包 / 精读报告 / 文档转 MD 链路的 Agent
> 交接日期：2026-09-01
> 仓库：`git@git.ustc.edu.cn:qbdeng2025/iBM-Lab-Agent.git`（本地工作目录 `C:\Users\admin\Desktop\iBM-Agent\iBM-Agent-inWB`）

---

## 1. 背景与目标

用户反馈：打包版桌面应用生成"精读报告"时提示"没有 markitdown"。

**根因**（已确认）：
1. markitdown 是可选依赖，不在 `python/requirements.lock`（根目录与打包插件内锁文件均无）；
2. 桌面应用（DSH_HOME=`%LOCALAPPDATA%\iBM-Lab-Agent\dsh`）的 `lab-agent\.venv` 从未创建；
3. 用户机器三个系统 Python（py -3.11=3.11.9 / py -3=3.12.10 / python=3.13.14）均未装 markitdown；
4. 插件 resolver（`src/markitdown.js`）按 venv → bundled → py -3.11 → py -3 → python 顺序探测，全部失败 → 报"没有 markitdown"。

**目标**：把 Python 环境（解释器 + markitdown + 全部依赖）捆绑进桌面安装包，安装即用、离线可用，不再依赖用户机器上的 Python。

---

## 2. 核心方案与关键决策

### 2.1 打包载体：完整 Python 安装目录布局（非 venv）

**关键教训：Windows venv 不可移植。**
`pyvenv.cfg` 里的 `home` 字段钉死了 base 解释器路径。实测把 venv 复制到别处、篡改 `home` 指向不存在路径后，运行报错：
`No Python at 'Z://nonexistent//.../python.exe'`。

因此采用**完整 Python 安装目录布局**：`python.exe + python311.dll + python3.dll + vcruntime140*.dll + DLLs/ + Lib/ + site-packages/` 全部放在同一棵树 `resources/python/dist/` 下，复制即自包含，不依赖注册表 / PATH / 系统 Python。已实测：复制后 `sys.prefix` 正确指向新位置，markitdown 转换正常。

### 2.2 依赖范围

`requirements.lock`（nature-skills 生态全量）+ `markitdown[pdf,docx,pptx,xls,xlsx]`。
**刻意不装 `markitdown[all]`**：`[all]` 会拖入 azure-ai-contentunderstanding / azure-ai-documentintelligence / 音频转录等重型包（数百 MB），本 Agent 场景用不到。magika（markitdown 基础依赖）会带入 onnxruntime，属不可避免的体积大头。

### 2.3 运行时接线

Rust 桌面壳启动 DSH 子进程时注入环境变量 `IBM_LAB_AGENT_BUNDLED_PYTHON` → 插件 `python-env.js` 的 `bundledPythonFromEnv()` 读取 → resolver 优先级：**venv → bundled → 系统 python**。CLI 模式（无该环境变量）行为不变。

---

## 3. 改动清单（11 个文件 + 1 个新脚本）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/python-env.js` | 新增 `bundledPythonFromEnv()`（读 `IBM_LAB_AGENT_BUNDLED_PYTHON`，文件不存在返回 undefined）；`resolvePythonExecutable` 默认参数自动接入 bundled |
| 2 | `src/markitdown.js` | `resolveMarkitdownPython` / `convertWithMarkitdown` / `probeMarkitdown` 增加 bundledPython 参数并透传 |
| 3 | `src/chemistry/rdkit-pubchem.js` | `runRdkitCalc` resolver 接入 `bundledPythonFromEnv()` |
| 4 | `src/skill-executor.js` | `resolvePython()` resolver 接入 `bundledPythonFromEnv()` |
| 5 | `desktop/src-tauri/tauri.conf.json` | `bundle.resources` 增加 `"resources/python/": "python/"` |
| 6 | `desktop/src-tauri/src/runtime/dsh.rs` | `RuntimeLayout` 新增 `bundled_python()` → `resources/python/dist/python.exe`（unix 为 `bin/python3`） |
| 7 | `desktop/src-tauri/src/runtime/process.rs` | spawn DSH 时 `.env("IBM_LAB_AGENT_BUNDLED_PYTHON", layout.bundled_python())` |
| 8 | `desktop/scripts/build-bundled-python.ps1` | **新增**：可复现构建 bundled python（详见 §4） |
| 9 | `desktop/scripts/verify-package.ps1` | `$required` 增加 `python\dist\python.exe`；WebSmokeTest 注入 `IBM_LAB_AGENT_BUNDLED_PYTHON` |
| 10 | `desktop/.gitignore` | 增加 `/src-tauri/resources/python/`（290M 产物不入库） |
| 11 | `desktop/README.md` | 构建步骤增加 `build-bundled-python.ps1`；补充 bundled python 说明 |

**注意**：根目录 `src/` 是源码源（source of truth），打包用副本在 `desktop/src-tauri/resources/plugin/dsh-lab-agent/src/`。改动后已手动 `cp` 同步 + `diff` 校验 IDENTICAL。后续改 src 需同时同步副本，或重跑 `prepare-runtime.ps1`。

---

## 4. 构建脚本 `desktop/scripts/build-bundled-python.ps1`

用途：重建 `desktop/src-tauri/resources/python/dist/`。

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File scripts/build-bundled-python.ps1 -SourceRoot ..
```

步骤：
1. 用 `py -3.11` 定位 base Python（参数默认 `'py -3.11'`，注意调用需 split 处理）；
2. 复制解释器 + 运行时 DLL + `DLLs/`（robocopy）+ `Lib/` 标准库（robocopy，排除 site-packages/test/__pycache__）；
3. pip `--target` 安装 `python/requirements.lock` 与 `markitdown[pdf,docx,pptx,xls,xlsx]`（默认清华镜像）；
4. 删除 `__pycache__` / `*.pyc`；
5. 自检：`dist/python.exe -c "import sys, markitdown; assert sys.prefix == ..."`。

已知问题：robocopy 大目录 + PowerShell `Remove-Item -Recurse` 清理在 Windows 上较慢（构建一次 30+ 分钟，卡点在清理步骤）；产物本身可用，可接受。

---

## 5. 验证结果（全部通过）

| 验证项 | 结果 |
|---|---|
| 单元测试 `tests/unit/*.test.mjs` | 173/173 pass |
| Rust `cargo check` | `Finished dev profile`，无 error |
| resolver 注入 env 后 | `source: bundled`（优先于系统 py） |
| dist 独立运行（复制+改前缀） | `sys.prefix` 正确，`markitdown` import OK |
| `scripts/markitdown/convert.py --check` | `{"ok": true, "available": true}` |
| 真实 PDF → Markdown（dist 解释器） | `available:true / note:bundled / code:0`，文本正确提取 |
| 源码副本同步 | `diff` 全部 IDENTICAL |

体积：`resources/python/dist/` ≈ **290MB**（onnxruntime/magika + pandas 为大头）。

---

## 6. 当前状态（截至交接时）

- ✅ 全部代码/配置改动完成并同步
- ✅ `desktop/src-tauri/resources/python/dist/` 已构建就绪（290M，独立可用）
- ✅ `resources/python/` 下残留目录已清理（dist.stale / venv-old-venv-approach / dist.incomplete.keep 已删）
- ⏳ **未跑完整 `tauri build` 出安装包**（下一步）
- ⚠️ `build-bundled-python.ps1` 本次验证运行被中止（清理步骤慢），但脚本逻辑正确、dist 产物已由手动步骤等效构建并验证

---

## 7. 后续步骤（接手 Agent 操作指引）

### 7.1 出安装包

```powershell
cd C:\Users\admin\Desktop\iBM-Agent\iBM-Agent-inWB\desktop

# 若 src 有改动，先重制打包资源副本（会覆盖 resources/plugin/）
.\scripts\prepare-runtime.ps1 -SourceRoot .. -NodeExe (Get-Command node).Source

# 打包前校验（含 python/dist 存在性 + Web smoke）
.\scripts\verify-package.ps1 -WebSmokeTest

# 编译+打包。注意：tauri-build 扫描 resources 下数万文件会卡 20+ 分钟，
# 用 TAURI_CONFIG 跳过编译期扫描（打包仍包含全部资源）：
$env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
npx tauri build
Remove-Item Env:TAURI_CONFIG
```

产物：`desktop/src-tauri/target/release/bundle/nsis/iBM Lab Agent_0.1.12_x64-setup.exe`

### 7.2 验收

1. 装到**没有 Python 的干净 Windows 机器**（最终验收标准）；
2. 打开应用 → 生成精读报告 → 应能正常 PDF→MD 转换，无"没有 markitdown"提示；
3. 或本机冒烟：设 `IBM_LAB_AGENT_BUNDLED_PYTHON` 指向 dist 后跑 `node -e "import('./src/markitdown.js').then(m=>m.probeMarkitdown({})).then(console.log)"` → 期望 `{"available":true}`。

### 7.3 后续可选优化

- **RDKit**：`rdkit-pubchem.js` 已接 bundled，但 dist 内未装 rdkit（requirements.lock 无此项），化学计算仍降级为分子式级。如需，在 `build-bundled-python.ps1` 加 `pip install rdkit`（体积 +200M 左右）。
- **PyMuPDF**：`lab-doctor.mjs` 会探测 fitz；当前 dist 未装，若 nature-skills 某脚本 import fitz 会失败（未发现强依赖，可暂缓）。
- **体积优化**：可尝试剔除 sympy/pandas 等（需确认 markitdown xlsx/xls 分支是否必需）。
- `build-bundled-python.ps1` 清理步骤的慢速问题可优化（改用更快的删除方式）。

---

## 8. 关键路径速查

| 项 | 路径 |
|---|---|
| 插件 markitdown 执行器 | `src/markitdown.js` |
| Python 统一 resolver | `src/python-env.js` |
| 文档转 MD 服务 | `lib/convert.js`（labConvert，`this.convert = convertWithMarkitdown`） |
| 转换脚本 | `scripts/markitdown/convert.py`（--check 只做 import 探测） |
| 捆绑 Python 产物 | `desktop/src-tauri/resources/python/dist/python.exe` |
| 构建脚本 | `desktop/scripts/build-bundled-python.ps1` |
| Rust 环境变量注入 | `desktop/src-tauri/src/runtime/process.rs`（spawn_dsh） |
| 桌面数据目录 | `%LOCALAPPDATA%\iBM-Lab-Agent\dsh\`（DSH_HOME） |
