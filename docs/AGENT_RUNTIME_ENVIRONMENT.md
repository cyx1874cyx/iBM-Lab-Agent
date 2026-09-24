# Agent 运行时环境：优先用软件自带的，而不是宿主机的

> 起因：0.5.4 的真实试用复盘。Agent 在 shell 里干活时只能靠猜运行时在哪 —— 实际硬编码了
> `C:\Program Files\iBM Lab Agent\node\node.exe`；同时因为桌面壳的沙箱拒绝写
> `%LOCALAPPDATA%\Temp`，LibreOffice 建不出 user profile 时**静默不产出 PDF**（退出码还是 0），
> 白耗了好几轮才定位。

本文记录修法与 Agent 的正确用法。相关代码：`src/lab-runtime.js`、`lib/runtime-tool.js`、
`scripts/render-deck.mjs`、`scripts/pptx/pdf_to_png.py`、`desktop/src-tauri/src/runtime/process.rs`。

## 1. 优先级规则（不可颠倒）

| 顺序 | 来源 | 说明 |
|---|---|---|
| 1 | 桌面壳注入的捆绑运行时 | `IBM_LAB_AGENT_BUNDLED_PYTHON` / `IBM_LAB_AGENT_BUNDLED_NODE` / `IBM_LAB_AGENT_WORKSPACE` |
| 2 | 本进程自身 | DSH 就是被壳用捆绑 node 启动的，`process.execPath` 即那一份；纯 CLI 端则等于当前 node |
| 3 | 系统 PATH | **仅**在显式 `allowSystemFallback` 时；默认不启用 |

捆绑运行时是**隔离边界**，不是"偏好"：回退到宿主机环境会让结果依赖用户机器上装了什么
（这正是 `src/python-env.js` 一直以来的立场）。因此 `resolveAgentRuntime()` 默认只在前两级里找；
找不到时返回结构化 `warnings`，而不是悄悄降级。

## 2. 桌面壳这次改了什么

- **子进程 PATH 预置两个目录**：`child_path_with_bundled_runtimes()` 把捆绑 Python 目录与捆绑
  Node 目录插在 PATH 最前（Python 在前）。此前只预置了 Python，所以 shell 里 `node` 会落到
  宿主机；现在直接写 `python` / `node` 就命中软件自带的。
- **新导出 `IBM_LAB_AGENT_BUNDLED_NODE`**（=`resources/node/node.exe`）。此前只有 Python 有
  对应的环境变量，node 的路径无从查询 —— 这就是硬编码安装路径的直接原因。

编译验证：`cargo check` / `cargo check --tests` 均通过（`CARGO_EXIT=0`、`CARGO_TESTS_EXIT=0`；
仅有一个与本次无关的既有 `origin_mcp_package_dir` dead-code 警告）。

## 3. Agent 怎么用

### 3.1 先问，不要猜

`lab_runtime_env`（`lib/runtime-tool.js`）返回：

```json
{
  "ok": true, "isolated": true,
  "python": { "available": true, "command": "…\\python.exe", "argv": ["…\\python.exe"], "source": "bundled", "version": "3.12.10" },
  "node":   { "available": true, "command": "…\\node.exe",   "argv": ["…\\node.exe"],   "source": "bundled", "version": "v24.16.0" },
  "soffice":{ "available": true, "command": "C:\\Program Files\\LibreOffice\\program\\soffice.com", "source": "typical-path", "version": "24.8…" },
  "tempDir": "…\\workspace\\.lab-tmp",
  "workspaceDir": "…\\workspace",
  "renderHelper": "…\\scripts\\render-deck.mjs",
  "notes": ["…"], "warnings": []
}
```

`argv` 是**直接的 spawn 前缀**：Windows 上 Python 可能是多 token（`py -3.12`），必须整体当前缀，
不能只取第一个 token。`pythonCandidates` 返回的就是数组，这里统一成 `argv` 以免再次被误当字符串。

### 3.2 临时文件放 `tempDir`

一律放在工作区内的 `.lab-tmp`（`tempDir`）。**不要**用 `%LOCALAPPDATA%\Temp`：桌面壳的沙箱
拒绝写那里，而 LibreOffice 写不了 user profile 时不会报错，只是不产出文件。

### 3.3 渲染用助手，不要自己拼 soffice

```bash
node scripts/render-deck.mjs <deck.pptx|deck.pdf> [--out DIR] [--pages 1,3,5-7] [--dpi 110] [--no-contact-sheet] [--json]
```

它做的事：解析应用自己的渲染器链（`lib/office-preview.js`，与产物下载预览同源）→ 把
LibreOffice profile 固定指到 `tempDir/lo-profile` → `--convert-to pdf` → 用捆绑 Python 的
PyMuPDF 栅格化 → 默认再合成一张 **contact sheet**。

**contact sheet 是省 token 的关键**：一次 `read_image` 看完整套页面的版面（静态层是否被破坏、
有没有溢出、图文比例是否合适），只在发现异常时才回去读单页。0.5.4 现场 25 次读图里约 15 次
是可省的。注意它是给"版面核对"用的，缩略后文字不可读 —— 需要看字时再读单页。

## 4. 实测记录（2026-09-25，WSL）

| 项 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `node --test tests/unit/lab-runtime.test.mjs tests/unit/render-deck.test.mjs` | 11/11 通过 |
| 栅格化 + 总览图 | `python scripts/pptx/pdf_to_png.py --pdf deck5.pdf --out /tmp/render-test --contact-sheet --json` | `ok:true`，4 页 1467×825 + `contact-sheet.png`（1920×770） |
| CLI 端到端 | `IBM_LAB_AGENT_BUNDLED_PYTHON=<venv python> IBM_LAB_AGENT_WORKSPACE=/tmp/render-ws node scripts/render-deck.mjs /mnt/h/build/deck5.pdf` | 4 页 + 总览图落在 `/tmp/render-ws/.lab-tmp/render-deck5/`，退出码 0 |
| 退出码 | 缺输入 / 文件不存在 | 均为 2 |

总览图人工核对：封面（底图 + 中英标题 + 日期）、摘要、方法（图 + 图注）、总结（分点 + 结尾段）
四页版面一图可见，静态层（上边线、logo、"摘要 Abstract"/"方法 Methods"/"总结 Conclusion"）完整。

## 5. 已知限制

1. **LibreOffice 仍由宿主机提供**：仓库不捆绑它，解析链是"显式配置 → 典型安装路径 → PATH"。
   工具会如实报告 `available: false` + hint，而不是让 Agent 去猜路径。若将来要彻底自包含，
   需要把 LibreOffice 打进安装包（+300 MB 量级），另立一版评估。
2. `lab_runtime_env` 每次调用都重新探测（`refresh` 参数目前是保留位）。
3. contact sheet 的缩略尺寸固定（默认 1920 px 宽、3 列）；页数很多时会自动多行。
