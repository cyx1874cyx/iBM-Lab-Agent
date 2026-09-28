---
name: publisher-download
description: 在 iBM 科研 Agent 的 DSH 软件内文献浏览器中，按出版社规则获取已登记 DOI 的正文 PDF 或用户要求的补充材料，并用任务状态与归档结果核实成功。包含已配置出版社的 Agent 流程，以及 SAGE、Theranostics、BMJ 等暂未接入工具的人工实测路径；不适用于普通网页下载或独立 Chrome 下载。
---

# Publisher Download Demo

这版 Skill 使用 DSH 的 `lab_*` 文献捕获工具操控软件内 WebView2。先读 [出版社规则表](references/publishers.md)，按 DOI 前缀选出版社；需要复现已测文章时再读 [人工实测记录](references/field-observations.md)。实测步骤是特定页面的定位线索，不是跨文章通用的选择器。页面证据与规则冲突时，以当前页面观察和任务状态为准，记录差异。

## 启动

需要当前课题中已有对应的 `bundleId` 和 DOI。正文用 `kind=pdf`；仅在用户要求补充材料时另建 `kind=si` 任务。已配置的 DOI 前缀可调用 `lab_publisher_browser_download(bundleId, kind)`，由 Agent 观察并操作页面。SAGE、Theranostics 和 BMJ 的人工步骤已记录，但当前工具尚不接受其 DOI；不要把它们描述成可自动执行的任务。Wiley 仅在 iWAN 全部路由可用时尝试；Nature/Springer 的 SI 可能走公开直连。若工具返回 `webvpn-login-required`，请用户在软件侧栏完成机构登录；只有用户表示已登录后，才用相同 `bundleId` 重试并传 `loginConfirmed=true`。不要读取或索取凭据。

## 闭环

1. 用 `lab_publisher_browser_download_status(taskId)` 取得 `nextAction` 和当前 `page.pageSeq`。在需要页面操作时调用 `lab_browser_observe(taskId, scope=all)`，以观察结果中的 `observationId`、`elementId` 调用 `lab_browser_click`。每个操作用 `lab_browser_operation_status(operationId, waitMs)` 等终态，再用 `lab_browser_wait` 等页面或下载状态变化。页面变化后重新观察，旧元素编号不复用。
2. 根据 [出版社规则表](references/publishers.md)区分正文与 SI。对同名 Download 按 `target`、`file`、上下文和 DOI 选择；`autoDownloadable` 只是提示。一次点击不是下载成功的证据，只有捕获与归档状态能证明结果。
3. 出版社 HTML PDF 预览页保持 `observe-or-click`：重新观察并点击右上角实际下载元素，例如 Wiley 的 `Download PDF`，目标可为 `/doi/pdfdirect/<DOI>?download=true`。进入原生 PDF 预览页后，`nextAction=download-viewer-pdf` 时调用一次 `lab_browser_download_viewer_pdf`；它让查看器执行保存并返回 `operationId`。先用 `lab_browser_operation_status(operationId, waitMs=0)` 确认已认领，再用 `lab_browser_wait` 和 `lab_publisher_browser_download_status` 逐次读取实际字节进度，最后复查操作终态；不要一开始就用长等待遮住进度。`progress.source=viewer-buffer` 的 1 KB 或 206 分段不是下载进度；`browser-download` 才是浏览器目标文件的进度。总量未知时不推算百分比；只有任务 `completed` 才算成功。状态长期不变或操作失败时记录错误，不循环触发。`retry-download-entry` 且有 `alternateRouteId` 时，调用 `lab_browser_navigate(taskId, routeId=alternateRouteId, expectedPageSeq=page.pageSeq)`；当前只有 Science 的 `science-pdf` 受限路线。`alternateEntry` 仅供说明，不作为 `elementId` 或自由 URL 输入。
4. `complete-verification` 交给用户在侧栏完成，再等待页面变化。`manual-handoff` 说明没有可执行的备用入口，请用户手动处理或终止；不要循环点击/保存。`requiresUserAction=true` 时先读取失败原话和 `reasonCode`，把状态中的 `question` 原样问用户；若提示已有完整保全文件，可用 `lab_tasks_update_bundle_file` 登记。连续两次同类 400/失败后停止自动重试。
5. 只有任务 `completed` 且文件已登记到当前课题才报告“下载成功”。确认正文与 SI 分别完成；多文件 SI 若只捕获一份，应明确列出未完成的文件，不把一份归档当作整组成功。

## 持续标定记录

每篇记录 DOI、出版社、`kind`、访问模式（iWAN/WebVPN/公开直连，未知则注明未知）、最终页面 URL、观察到的入口文本/`target`/`file`、是否进入预览器、是否触发下载事件、`nextAction` 与 `reasonCode`、最终归档路径和文件类型/字节数。区分用户口述“已归档”和任务 `completed` 的工具证据；失败也记录停在哪一步，不写入登录信息。标定记录写回仓库的 `docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`（安装包内不含 `docs/`，
那是提交记录而不是运行时可读路径）；Agent 执行时读取本 Skill 的
`references/publishers.md` 和按需读取 `references/field-observations.md`。两者与仓库标定表不一致时记录差异并同步修正，不凭过时记录覆盖当前页面证据。
