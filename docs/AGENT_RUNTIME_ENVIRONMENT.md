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
- **子进程的 `TMP` / `TEMP` / `TMPDIR` 全部指向工作区内的 `.lab-tmp`**，并在
  `create_user_directories()` 里预建。沙箱只保证工作区可写，而系统临时目录是**所有**工具的
  默认落点 —— 不只是 LibreOffice（写不了 user profile 时静默不产出 PDF），还有 python 的
  `tempfile`、node 的 `os.tmpdir()`、matplotlib 的字体缓存等。整条链一次修掉，而不是逐处绕。
  > **预建是必需而非讲究**：Python 的 `tempfile` 只在目录**存在且可写**时才认 `TMPDIR`，
  > 否则**静默回退**到 `/tmp`。实测（WSL）：`TMPDIR=/tmp/gone-tmp`（不存在）时
  > `tempfile.gettempdir()` 返回 `/tmp`；`mkdir` 之后才返回注入值。node 的 `os.tmpdir()`
  > 不做这个校验。所以"用到再建"在 Python 侧等于没生效。

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

一律放在工作区内的 `.lab-tmp`（`tempDir`）。桌面壳已经把子进程的 `TMP`/`TEMP`/`TMPDIR`
全指到这里，所以 python 的 `tempfile`、node 的 `os.tmpdir()` 这类默认行为**自动**落在工作区内；
但需要事后查看/保留的中间产物（渲染出的 PNG、contact sheet、转出的 PDF）仍应显式用
`tempDir`，不要依赖默认值。

**不要**用 `%LOCALAPPDATA%\Temp`：桌面壳的沙箱拒绝写那里，而 LibreOffice 写不了 user profile
时不会报错，只是不产出文件。

### 3.3 渲染用助手，不要自己拼 soffice

```bash
node scripts/render-deck.mjs <deck.pptx|deck.pdf> [--out DIR] [--pages 1,3,5-7] [--dpi 110] [--no-contact-sheet] [--no-kit] [--json]
```

**渲染器优先级（0.5.5-beta2 起）**：

1. **DSH 自带的 LibreOffice kit**（首选）——`@deepseek-ai/libreoffice-kit` 的 CLI `render` 子命令。
   DSH 已经把它打进安装包：Windows 是 `libreoffice-kit-win32-x64`（约 341 MB，装在
   `resources/dsh/node_modules/@deepseek-ai/` 下，正是 `DSH_HARNESS_NODE_MODULES` 指向处），
   Linux 是 `libreoffice-kit-wasm`（约 186 MB，WebAssembly 后端）。因此**用户不需要自己装
   LibreOffice**，我们也不需要 PyMuPDF 做栅格化（kit 内部用 pdfium）。它还会回报
   `missingFonts`，以及 `backend: native|wasm`。
2. **兜底**：宿主 `soffice` 转 PDF（profile 固定在 `tempDir/lo-profile`）→ 捆绑 Python 的
   PyMuPDF 栅格化。`--no-kit` 或 `IBM_LAB_AGENT_OFFICE_KIT=off` 可强制走这条。

两条路径最后都由我们合成 **contact sheet**（kit 只出逐页 PNG；`pdf_to_png.py` 新增
`--png-dir` 模式专门只拼总览图）。

**contact sheet 是省 token 的关键**：一次 `read_image` 看完整套页面的版面（静态层是否被破坏、
有没有溢出、图文比例是否合适），只在发现异常时才回去读单页。0.5.4 现场 25 次读图里约 15 次
是可省的。注意它是给"版面核对"用的，缩略后文字不可读 —— 需要看字时再读单页。

**两个必须记住的渲染差异**：

- kit 会在**图片占位符**上画一行英文 `Double-click to add an image`（它自带的占位提示）。
  实测同一份 deck 宿主 LibreOffice 下不显示这行，而 deck 包结构、python-pptx 读到的图片几何、
  `inspect_deck.py` 的 XML 结论三者一致 —— 说明**那行提示不代表图没插进去**。判断图是否插入
  一律以 `inspect_deck.py` 为准。
- kit 渲染在缺字体的机器上会用替代字形（并报 `missingFonts`）。WSL/容器里通常缺
  `微软雅黑`/`Arial`，所以**核对字形要在目标机器（Windows）上做**，核对字号与版面不受影响。

### 3.4 核对成品：先查 XML，再考虑读图

```bash
# 路径用 lab_runtime_env 返回的 inspector（绝对路径）——
# Agent 的 cwd 是课题工作区，写相对路径会找不到文件。
python "<inspector>" --deck out.pptx \
    --expect-latin Arial --expect-ea 微软雅黑 --expect-cs Arial [--strict] [--json]
```

一次给出：每页的字体三槽、最小显式字号、图片是否被拉伸（几何比例 vs 图片像素比例）、形状是否
越界、占位符是否仍是版式提示文字、段落是否带项目符号，并汇总 `error`/`warning` 与退出码。
**这些都不需要读图** —— 视觉 token 只留给"版面好不好看"（配合 §3.3 的 contact sheet）。

实测（`deck6.pptx`，4 页）：

```
成品体检：deck6.pptx
  4 页 | 最小显式字号 20.0pt | error 0 | warning 0
  p1  标题幻灯片  字体 latin=Arial ea=微软雅黑 cs=Arial
  p2  Abs        字体 latin=Arial ea=微软雅黑 cs=Arial
  p3  Fig1       字体 latin=Arial ea=微软雅黑 cs=Arial
  p4  End        字体 latin=Arial ea=微软雅黑 cs=Arial
```

负例自证（工具确实会失败）：`--min-font-pt 30` → 11 个 error、退出码 1；
`--expect-ea 等线` → 12 个 warning。

**独立验证时发现并修掉了这个工具自己的两个问题**（都是"只看自测暴露不出来"的那类）：

1. 占位符图片的 `shape_type` 是 `PLACEHOLDER(14)`、不是 `PICTURE(13)` —— 只认 13 会漏掉本模板里的
   **全部**图片，"竖长图被裁"这项检查等于从没跑过。改为按 XML 标签 `p:pic` 判定。
2. 把"拉伸"和"裁切"混成了一句话：有 `a:srcRect` 时图片是被**裁**到占位符比例（内容丢失、不变形），
   没有 `srcRect` 才是非等比**拉伸**。现在拆成 `picture-cropped` / `picture-stretched` 两条，
   裁切还带百分比 —— 否则会把"该换版式"误报成"该改缩放"。

用同一批产物实测（这也顺带验证了 contain 修复确实生效）：

| 产物 | 体检结果 |
|---|---|
| `before-deck.pptx`（contain 修复前） | 3 × `picture-cropped`（p2/p3/p4 全部图片） |
| `final-contain.pptx`（修复后） | **0 error** |
| `deck6.pptx`（上一轮会话留下的旧成品） | 1 × `picture-cropped`，裁切 `{l: 7.1, r: 7.1}` |

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

1. **LibreOffice 由 DSH 提供，不是由本仓库捆绑**（0.5.5-beta2 更正）：安装包里就有 DSH 的
   `libreoffice-kit-win32-x64`（Windows，约 341 MB）/ `libreoffice-kit-wasm`（Linux，约 186 MB），
   渲染助手默认走它，**用户不需要自己装 LibreOffice**。我们自己的 `lib/office-preview.js`
   仍保留"宿主 soffice"解析链作为兜底（`lab_runtime_env` 的 `soffice` 字段仍如实报告它的状态）。
   * 仍待办：把 `lib/office-preview.js`（`/api/lab-artifacts` 的预览）也改为优先用 DSH 的
     `ctx.officeToPdf` 服务（它带界队列与缓存），目前它仍走宿主 soffice。
2. kit 的渲染会给图片占位符画一行英文占位提示（见 §3.3），且缺字体时用替代字形 ——
   这两点都只能靠"以 XML 结论为准 + 在目标机器核对字形"来规避，属上游渲染器行为。
3. `lab_runtime_env` 每次调用都重新探测（`refresh` 参数目前是保留位）。
4. contact sheet 的缩略尺寸固定（默认 1920 px 宽、3 列）；页数很多时会自动多行。
