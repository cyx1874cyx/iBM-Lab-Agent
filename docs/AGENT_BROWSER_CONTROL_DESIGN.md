# Agent 浏览器控制：本地实现设计

状态：WebView2 Agent 工具已于 0.5.5-beta4 实现；0.5.5-beta5 修正验证恢复、下载点击与队列接管。本文记录接线与验收边界，不改变登录资料或发布流程。

## 1. 现有边界

- Agent 工具在 lib/tasks-tool.js 注册。lab_publisher_browser_download 只创建任务；lab_publisher_browser_download_status 读取任务与桌面状态。
- lib/manual-capture.js 持有捕获任务、一次性令牌和桌面状态；lib/remote.js 暴露给客户端的远程方法。client/src/components-literature.js 轮询并认领桌面动作。
- client/src/lib.js 把文献浏览器请求送到 desktop/src/index.html；桌面壳只接受当前本地运行时 iframe 的源和窗口，再调用 Tauri 命令。
- desktop/src-tauri/src/webvpn.rs 持有唯一文献 WebView2、专属持久 profile、页面脚本、下载事件和上传归档。已登录 iWAN 时由这个 WebView2 直访出版社。
- DSH Sidebar Browser 是上游纯 UI 插件，没有现成模型工具。本项目桌面壳是 Tauri，未提供 DSH Electron 专用的 dshDesktop.browser 契约；如启用该插件，按当前包代码会退回 iframe 载体。上游在 ibm-lab profile 下默认关闭。它不共享文献 WebView2 的 profile；Web iframe 默认 sandbox 也没有直接下载权限。

因此文献下载以 WebView2 为唯一操作对象。Sidebar Browser 的工具化单独做，不把两套会话伪装成一套。

## 2. Agent 可见工具

第一阶段提供三个窄工具，均要求当前课题和有效的文献捕获 taskId：

| 工具 | 输入 | 输出 | 含义 |
| --- | --- | --- | --- |
| lab_browser_observe | taskId | operationId；完成后为页面类别、标题、脱敏来源、候选元素列表、观察版本 | 看当前出版社页的可操作入口 |
| lab_browser_click | taskId、observationId、elementId | operationId；完成后为 clicked / stale / blocked / failed | 点击上次观察到的一个候选元素 |
| lab_browser_download_viewer_pdf | taskId | operationId；完成后为归档结果或明确错误 | 对当前顶层原生 PDF 查看器触发保存，按真实下载字节跟踪；HTML 预览页用 observe/click 点击其下载元素 |

共用 lab_browser_operation_status(operationId) 取结果；现有 lab_publisher_browser_download_status 继续报告最终下载与归档状态。工具不接受任意 JavaScript、CSS 选择器、文件路径、URL、Cookie 或请求头。Agent 不获得捕获令牌。

观察结果只含可见链接和按钮的短标签、角色、上下文、是否可能为 PDF/SI 入口以及短期 elementId。页面正文不整页交给模型；密码框、认证表单、隐藏元素和可能带票据的完整 URL 不输出。无法判断时返回 need_user_action，允许用户在已打开的侧栏操作。

## 3. 操作通道

1. Agent 工具核验 projectId、bundleId、taskId 的归属和捕获状态，在 LabCaptureService 中登记 operationId、动作、截止时间。单个 WebView2 同时只允许一个待执行动作。
2. 客户端沿用文献页面的轮询，新增 browser_operation_claim。它认领操作后通过 client/src/lib.js 向桌面壳发送带 requestId 的消息。
3. desktop/src/index.html 沿用当前来源校验，只映射固定动作到 Tauri 命令。Tauri 再核验当前 WebView2 label、待捕获 taskId、动作类型和页面状态；壳不能仅凭客户端传来的 elementId 就点击。
4. 桌面壳把结构化结果送回客户端，客户端调用 browser_operation_complete。Agent 用 lab_browser_operation_status 等待结果或继续查询。operationId 只用于协调，不是下载凭据。
5. 取消、导航、任务替换、超时、窗口销毁都结束旧操作并使旧 observationId/elementId 失效。重复认领或迟到回包按 operationId 幂等处理。

服务层新增方法放在 lib/manual-capture.js；远程方法放在 lib/remote.js，并登记到 client/src/descriptors.js。桌面桥放在 client/src/lib.js 与 desktop/src/index.html；原生实现放在 desktop/src-tauri/src/webvpn.rs，命令登记于 desktop/src-tauri/src/main.rs。不要让 DSH host 直接连接 WebView2，也不要额外启动一个浏览器 profile。

## 4. 页面观察与点击

优先用 Tauri Webview::with_webview 取得当前 Windows WebView2，再经其 CDP 方法执行受控观察和点击，并接收 JSON 回调。Tauri 2.11.5 与锁定的 webview2-com 0.38.2 先做最小编译验证；如果该组合不方便取得回调，退回受控页面脚本加本地消息回传，不开放通用 eval 给 Agent。Playwright MCP 的快照和定位语义可作设计参照，正式版不常开远程调试端口。

观察按 document、开放 shadow root、可访问 iframe 收集候选；每条最多返回短标签、role、可见性、简短周边文字和类别。最多返回 30 条、总量设硬上限。元素引用绑定 WebView2 页面导航代数、观察版本和 15 秒有效期。点击前重新检查引用、可见性与当前 taskId；点击后只报告“已触发点击”，真正下载开始必须由浏览器下载事件或原生另存为事件证明。验证码、登录和付费操作交给用户。

现有出版社规则继续先运行。规则在限定时间内找不到入口、点击后没有下载响应、或遇到 HTML 预览器时，Agent 才调用观察工具；避免每篇论文都让模型遍历页面。docs/PUBLISHER_DOWNLOAD_CALIBRATION.json 后续存储经 iWAN 真机核对的规则和版本，不从未验证页面直接生成运行时选择器。

## 5. 原生 PDF 保存

网页 DOM 不能可靠控制 WebView2 内置 PDF 工具栏。对顶层原生 PDF 使用 WebView2 的 ShowSaveAsUI；在 SaveAsUIShowing 中设置由应用生成的唯一临时路径、禁止覆盖，并抑制系统保存对话框。该 API 的 Save As 流程与普通 DownloadStarting 不同，不能假设当前 Tauri on_download 会收到事件。另存为完成后单独校验文件确为 PDF、大小和当前 taskId，再复用现有 upload_capture 与归档路径。完成回调只是“保存动作结束”，归档成功仍以捕获服务登记为准。

若当前是出版社 HTML 预览页或 PDF 仅嵌在 iframe，先由页面观察/出版社规则识别真正的 PDF 入口；不能把 HTML 页面“打印为 PDF”冒充出版社原文。若接口不可用、文档类型不符或页面要求用户验证，返回明确原因并保持手动捕获可用。具体 COM 接口能否通过本项目锁定依赖直接调用，作为第一项编译验证。

## 6. Sidebar Browser 的独立阶段

现有 docs/SIDEBAR_BROWSER_VS_LAB_BROWSER_EVALUATION.md 已核对上游 0.1.7-rc.1 的载体分支：只有 DSH Electron preload 提供 dshDesktop.browser 时才使用 Electron guest。本项目 Tauri 壳没有该契约，因此即使把 ibm-lab profile 中默认关闭的上游 Browser 启用，也会使用普通 iframe。该文档早期关于“采集只能走外部 Edge 扩展”的段落已被本项目当前 WebView2 捕获链路替代，不能据此否定现有捕获实现。

若仍要把上游 Sidebar Browser 变成 Agent 工具，先确定用途为普通可嵌入网页的查看。复用其客户端 openTab 能打开 URL，但跨域 iframe 无法向父页面提供 DOM 快照或稳定的目标 URL；默认 sandbox 也不允许直接下载。简单添加 DSH tool 注册只能得到“打开 tab”，得不到“观察并点击任意站点”。完整控制需要另建具有独立权限和 profile 的宿主载体，或改造上游插件并承担 iframe/CSP/登录边界；它仍不会自动继承文献 WebView2 的会话。因此这一阶段不承诺出版社下载能力，也不修改文献捕获流程。

## 7. 状态、验收与发布边界

UI 和 Agent 状态使用同一组可证实的事实：queued、opening、searching、clicked、verification、manual、downloading、saving、uploading、completed、failed。clicked 不等于 downloading；saving 不等于 completed。页面小球和 Agent 状态工具都显示当前动作、最后一次动作结果与等待原因。

WSL 中实现、运行单元与回归、lint、preset/client 检查并提交。测试覆盖任务归属、旧 elementId 被拒、导航失效、重复回包、超时、敏感字段不出现在模型输出、下载与另存为两条完成路径。Windows 侧只按既有发行脚本打包并做安装包真机验收：已登录 iWAN 下至少验证 Nature、Springer、ScienceDirect、Wiley 的正文及一例 SI；逐项记录页面观察、点击、下载事件、原生 PDF 保存和最终课题归档。任何一项未实测，应在标定文件保持 pending。

## 8. 验证、点击与 SI 队列状态

- 验证页进入 verification 时保持扫描计时器；页面自行通过后返回 searching，不消耗验证期间的下载入口尝试次数。Agent 对 wait-and-poll 继续查状态，不向用户索取本来无需操作的验证。
- 点击入口后保持当前 WebView 的导航与下载事件独立运行。页面脚本不再立刻跳转内部状态协议，也不强行给出版社链接加 download 属性；若页面不跳转且未下载，短暂冷却后尝试其他候选入口，最终进入 manual。clicked 只表示已点击。
- 非 HTTP(S) 弹窗（尤其 about:blank）不覆盖唯一文献页。普通 HTTP(S) 新窗口仍收敛到该 WebView。
- 正文任务占用浏览器时 SI 保持 queued；前项完成、失败、取消或过期后释放本地 pending，再由下一次轮询领取 SI。状态工具给 Agent 返回 phase、queuePosition 与 nextAction；只有归档 completed 才算成功。
- 已登录 iWAN 的出版社验证页、PDF 原生保存与 SI 真正下载仍须安装版人工验收；标定文件不因模拟测试自动改为通过。

## 9. 实施顺序

1. 编译小样确认锁定的 Tauri/webview2-com 能调用 CDP 回调和 ShowSaveAsUI/SaveAsUIShowing；不改现有下载行为。
2. 加服务操作队列、远程方法和桌面桥，完成 observe、click 与状态回传。
3. 加原生 PDF 保存分支，复用现有捕获验证和归档。
4. 用已登录 iWAN 包验证并更新出版社标定。
5. 文献链路稳定后决定是否只给上游 Sidebar Browser 加“打开 tab”工具；如需观察和点击，另行评估宿主载体改造，不把 iframe 当作已有可控浏览器。

参考：Microsoft Playwright WebView2 指南 https://github.com/microsoft/playwright/blob/main/docs/src/webview2.md ；Tauri Webview::with_webview https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html ；WebView2 ShowSaveAsUI https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_25 ；DSH Sidebar Browser 包内 README 和 lib/client.js。
