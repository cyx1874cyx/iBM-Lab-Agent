---
name: publisher-download
description: 在 iBM 科研 Agent 的 DSH 软件内文献浏览器中，按出版社规则获取已登记 DOI 的正文 PDF 或用户要求的补充材料，并用任务状态与归档结果核实成功。适用于 Science、Nature、Springer、Elsevier、ACS、RSC、IEEE 和 Wiley 的试用与标定；不适用于普通网页下载或独立 Chrome 下载。
---

# Publisher Download Demo

这版 Skill 使用 DSH 的 `lab_*` 文献捕获工具操控软件内 WebView2。先读 [出版社规则表](references/publishers.md)，按 DOI 前缀选出版社，再核对页面上实际显示的 DOI、文件名与入口。表中“待测”是提示，不是已经验证的选择器；页面证据与规则冲突时，以页面观察和任务状态为准，记录差异。

## 启动

需要当前课题中已有对应的 `bundleId` 和 DOI。正文用 `kind=pdf`；仅在用户要求补充材料时另建 `kind=si` 任务。调用 `lab_publisher_browser_download(bundleId, kind)`，由 Agent 观察并操作页面。Wiley 仅在 iWAN 全部路由可用时尝试；Nature/Springer 的 SI 可能走公开直连。若工具返回 `webvpn-login-required`，请用户在软件侧栏完成机构登录；只有用户表示已登录后，才用相同 `bundleId` 重试并传 `loginConfirmed=true`。不要读取或索取凭据。

## 闭环

1. 用 `lab_publisher_browser_download_status(taskId)` 取得 `nextAction` 和当前 `page.pageSeq`。在需要页面操作时调用 `lab_browser_observe(taskId, scope=all)`，以观察结果中的 `observationId`、`elementId` 调用 `lab_browser_click`。每个操作用 `lab_browser_operation_status(operationId, waitMs)` 等终态，再用 `lab_browser_wait` 等页面或下载状态变化。页面变化后重新观察，旧元素编号不复用。
2. 根据 [出版社规则表](references/publishers.md)区分正文与 SI。对同名 Download 按 `target`、`file`、上下文和 DOI 选择；`autoDownloadable` 只是提示。一次点击不是下载成功的证据，只有捕获与归档状态能证明结果。
3. `nextAction=wait-and-poll` 时只等，尤其 `phase=downloading` 或载荷正在接收时不要保存。`save-pdf-ready` 表示完整载荷已采集；`save-from-viewer` 表示原生 PDF 已显示、但载荷尚未采集完整，需要尝试查看器保存。两者都可调用一次 `lab_browser_save_current_pdf` 并等归档终态；不要因调用耗时重复执行。`retry-download-entry` 且有 `alternateRouteId` 时，调用 `lab_browser_navigate(taskId, routeId=alternateRouteId, expectedPageSeq=page.pageSeq)`；当前只有 Science 的 `science-pdf` 受限路线。`alternateEntry` 仅供说明，不作为 `elementId` 或自由 URL 输入。
4. `complete-verification` 交给用户在侧栏完成，再等待页面变化。`manual-handoff` 说明没有可执行的备用入口，请用户手动处理或终止；不要循环点击/保存。`requiresUserAction=true` 时先读取失败原话和 `reasonCode`，把状态中的 `question` 原样问用户；若提示已有完整保全文件，可用 `lab_tasks_update_bundle_file` 登记。连续两次同类 400/失败后停止自动重试。
5. 只有任务 `completed` 且文件已登记到当前课题才报告“下载成功”。确认正文与 SI 分别完成；多文件 SI 若只捕获一份，应明确列出未完成的文件，不把一份归档当作整组成功。

## 明日标定记录

每篇记录 DOI、出版社、`kind`、访问模式（iWAN/WebVPN/公开直连）、最终页面 URL、观察到的入口文本/`target`/`file`、是否进入预览器、是否触发下载事件、`nextAction` 与 `reasonCode`、最终归档路径和文件类型/字节数。失败也记录停在哪一步，不写入登录信息。标定记录写回仓库的 `docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`（安装包内不含 `docs/`，
那是提交记录而不是运行时可读路径）；规则表的当前内容就是本 Skill 的
`references/publishers.md`，两者不一致时以仓库里的标定表为准并记下差异。
