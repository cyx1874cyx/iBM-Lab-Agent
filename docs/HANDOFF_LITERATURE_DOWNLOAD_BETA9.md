# 文献下载流程交接：0.5.5-beta9

更新时间：2026-09-26（beta9 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA8.md`（保留为历史记录）。

## 当前代码状态

- 分支：release-0.5.0
- 关键提交：
  - `30269c4` 修 beta5 的 Rust 编译错误
  - `3f587d2` beta6：工具栏立即挂载 / 空白文档不计数 / 位移只认 PDF
  - `aa05571` beta7：内部命令不再导航（白屏真因）
  - `ba3b538` beta8：验证页判定收紧（文章页不再误判）+ 验证状态可执行化 + JSON 边界
  - `e9f76a3` beta9：原生 PDF 预览器切 manual 并指向保存工具 + PDF 端点识别放宽
- 版本号：0.5.5-beta9

## 全链路现状（每轮实测确认过的部分）

1. **白屏**已修（beta7）：内部命令改走 `window.open`，不再导航载体页面。
   beta8 实测截图里侧栏能正常渲染文章页 + 我们自己的工具栏。
2. **验证页误判**已修（beta8）：只有挑战插页标题、或非文章页上的可见验证组件才算验证；
   文章页继续扫描。验证阶段返回 `nextAction=complete-verification`，明确要求用户点验证框。
3. **原生 PDF 保存**（beta9）：进入 WebView2 内置 PDF 查看器时切 `manual`，状态返回
   `nextAction=observe-or-save-pdf`，Agent 调 `lab_browser_save_current_pdf` —— 内部
   `ShowSaveAsUI` + `SetSaveAsFilePath(归档临时路径)` + `SetSuppressDefaultDialog(true)`，
   **直接存、不弹框**。

## 关于"PDF 预览里没有那条 bar"

必须记住这个约束，别再往这个方向花时间：

- 那条 bar（页码/缩放/旋转/打印/保存图标）是 **WebView2 内置 PDF 查看器的 UI**，属于浏览器
  进程，**不是网页 DOM**；
- WebView2 的原生查看器文档**不执行注入脚本**，所以我们注入的标签页/地址栏那一层在里面
  不会渲染 —— 这就是"bar 不见了"的唯一原因，不是回归；
- 因此**自动化既点不到查看器的保存按钮、也无法在里面放自己的按钮**。正确的做法是根本不依赖
  它：走 `lab_browser_save_current_pdf`。
- 要在 PDF 视图里离开，用 DSH 右侧栏那个 tab 上的 ×（那是应用 UI，不受此约束）；
  抓取完成后侧栏本来也会由壳收起。

## 排查要点

- **原生 PDF 端点不以 `.pdf` 结尾**：Science 是 `/doi/pdf/10.1126/…`、Elsevier 是 `/pdfft`、
  IEEE 是 `/stampPDF/getPDF.jsp`。`is_pdf_document_url` 必须认这些，否则 PDF 分支不触发
  （beta9 之前的实际故障）。
- **能在 Edge 里重放就别改代码**：`desktop/.build/inject-probe.mjs` 的写法 + 应用自己的
  WebView2 profile 副本，几分钟定位到具体一句。
- **白屏先量三件事**：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数，并同时量主 WebView 作对照。
- **profile 是活证据**：`Default/History`（含 `__cf_chl_rt_tk` 这类挑战跳转）、
  `Default/Session Storage/000003.log`（我们工具栏记录的 URL 与标题）。
- 改版本号后**必须跑全量单测**（`release-version-consistency` 会核对 README）。
- 生成的 `.ps1` 必须纯 ASCII（PS 5.1 按 ANSI 解析无 BOM 的 UTF-8）。

## 尚未完成

- beta9 安装后的实测：点 PDF 后应自动归档（无需右键另存），状态最终为 `completed`。
- 其他出版社回归（Nature、Springer、Wiley、ScienceDirect、ACS、RSC、IEEE）。
- 八家出版社的已登录 iWAN 标定（全部仍 `pending`）。
- 把 beta9 的提交与产物同步到远端。
