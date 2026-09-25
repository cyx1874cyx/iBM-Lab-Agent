# 文献下载流程交接：0.5.5-beta7

更新时间：2026-09-25（beta7 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA6.md`（保留为历史记录）。

## 当前代码状态

- 分支：release-0.5.0
- 关键提交：
  - `74d637a` beta5 功能修复（Rust 编译不通过）
  - `30269c4` 修编译错误（beta5 产物）
  - `3f587d2` beta6：工具栏立即挂载 / 识别验证页 / 空白文档不计数 / 位移只认 PDF
  - `aa05571` beta7：**内部命令不再走导航**（白屏真正成因）
  - 之后是 release notes 与本文档
- 版本号：0.5.5-beta7

## 白屏的最终结论（beta7）

一句话：**页面把状态发回壳时用了 `location.href = 'ibm-webvpn://…'`，在 WebView2 里那是一次
真实导航，会把正在加载的出版社页面打成"文档、脚本、注入工具栏都在，但首帧永远出不来"的状态。**

证据链（全部可复现，不依赖猜测）：

1. beta6 运行中实测：侧栏子窗口最上层、`WS_VISIBLE=true`、未被遮住；表面只有 **1 种颜色**
   （主 WebView 同方法读到 124 种）；sessionStorage 里我们工具栏记录的是**真正的文章 URL 与
   文章标题**；页面定时器准点（12 秒 / 30 秒上报都准时）。
2. 用应用自己的 WebView2 profile 副本在 Edge 里重放**应用实际注入的两段脚本**：
   - 只注入工具栏壳 → 正常；
   - 工具栏壳 + 自动扫描（原样）→ **元素数 0、截图超时**（JS 仍可 evaluate）；
   - 把 `signal()` 那一句换成 `window.open` → **恢复正常**。
3. `window.open` 实测不被弹窗拦截（会真的创建新 target，宿主拒绝即可），且当前文档不受影响。

beta4 看起来正常的解释：它会在点击/验证处 `clearInterval` 停掉扫描，触发那句导航的次数与时机
不同；beta5 改成"验证期间不停扫描"后，导航正好落在页面加载窗口内，问题才稳定暴露。

## 本版改动

1. 工具栏壳新增 `notifyShell(target)`（`window.open`）；`session/ready`、`close`、
   `cancel-capture`、`offset-reverted` 四个命令一并改掉。
2. 自动扫描的 `signal(result)` 同样改 `window.open`。
3. Rust 抽出 `handle_internal_command(app, url)`，`on_new_window`（主路径）与 `on_navigation`
   （兜底）共用；其它非 http(s) 弹窗（about:blank 等）逻辑不变。
4. 单测护栏：注入脚本内不得再出现 `location.href = 'ibm-webvpn…'`；`on_new_window` 必须处理
   内部命令。

## 排查要点（这套方法可复用）

- **白屏先量三件事**：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数，并且**必须同时量主 WebView 作对照**，
  否则分不清"真的没画"和"PrintWindow 抓不到 WebView2"。
  `H:\build\combo-probe.ps1`、`H:\build\sidebar-shot.ps1` 就是这两支探针。
- **profile 是活证据**：`Default/History`（访问过哪些 URL）、`Default/Session Storage/000003.log`
  （我们工具栏写入的 URL + 标题）能直接回答"那个 document 到底是什么"，不需要改代码。
- **能在 Edge 里重放就别改代码**：把注入脚本 + profile 副本喂给系统 Edge
  （`desktop/.build/inject-probe.mjs` 的写法），二分注入内容，几分钟就能定位。
- 生成的 `.ps1` 必须纯 ASCII：PS 5.1 按 ANSI 解析无 BOM 的 UTF-8，中文注释会 ParserError。
- 改版本号后**必须跑全量单测**，不能只跑 lint：`tests/unit/release-version-consistency.test.mjs`
  会核对 README 的版本段，漏改会让 Windows 流水线在 tests 阶段失败。
- 重新出 Windows 包时若 `tauri-nsis` 很快失败，先看 stderr 的 `error[E....]`：那是 Rust 编译错误。

## 尚未完成

- beta7 安装后的实测：同一路径应当不再白屏（Science 验证页 / 文章页都该正常显示，工具栏可见）。
- 其他出版社回归（Nature、Springer、Wiley、ScienceDirect、ACS、RSC、IEEE）。
- 八家出版社的已登录 iWAN 标定（全部仍 `pending`）。
- 把 beta7 的提交与产物同步到远端。
