# PDF 预览、归档后模型错误与宠物实时任务

## 范围与行为

用户反馈 Springer Nature SI 链接预览空白，归档后出现 `DeepSeek Messages stream: tool input is invalid JSON`，宠物任务不实时且缺少多种科研过程。

1. 侧栏与独立科研浏览器启用 Chromium 内置 PDF 组件，保留 sandbox、上下文隔离和关闭 Node。仅内置 PDF 扩展帧可读取 `chrome://resources`，其他研究页面、扩展及 Chrome 页面不因此获得权限。此前禁用组件造成白色占位；启用组件后，其样式与脚本仍被协议过滤器拦截，导致深色空白。两处均已修复。
2. 已有科研窗口时，打开指定新链接会导航该窗口；原来只返回旧窗口状态，忽略新 URL。
3. 使用内核已有 `agent/request-error` 扩展接口，对 DeepSeek 的明确工具 JSON 格式错误，每个 Agent 任务步骤最多重新请求一次。无效调用不执行，不改写参数、不重放已完成工具；取消及其他错误仍交给原恢复策略。连续两次无效仍报失败，不伪报成功。
4. 宠物接收工具启动/结束和原生捕获进度的事件推送，轮询保留为补偿。跨 Agent 作用域的执行事件能被接收；技能驱动的精读、PPT、下载等任务覆盖同一实际运行中的读文件、脚本及模型分析步骤，直到真实任务结束。运行任务排在等待任务前，避免八条载荷限制隐藏运行任务。原生下载的字节进度优先显示；等待、排队与终态仍不作为进行中的任务展示。

## 证据

- 全量测试 822 项：814 通过、8 跳过、0 失败，见 `outputs/electron-next-pdf-pet/final-tests.log`。
- 用户公开 SI 文件实际 HTTP 200、application/pdf，47,319,200 字节；隔离浏览器预览确认 85 页。没有读取用户机构凭据或改写真实条目。
- `outputs/electron-next-pdf-pet/direct-preview/state.json` 与预览图片定位并验证内置资源拦截；旧失败记录保留。
- 最终打包模型与宠物完整任务验收：`outputs/electron-next-pdf-pet/final-recovery-activity/run-q8MLUF/verification.json`。模拟一次相同格式错误后恢复，新任务和重启后的会话均完成；每次只有一条失败尝试，记忆工具和科研示例工具各执行一次，真实运行状态有即时通知，结束后无残留运行任务。未调用真实模型账户。
- 最终侧栏自动检查 PDF 响应类型和视口尺寸，截图另做人工视觉复核，不能只凭响应为 PDF 就认为画面已经显示。首次截图仍处于加载阶段，后续验收等待渲染并复核。
- 最终侧栏 `outputs/electron-next-pdf-pet/final-sidebar-rendered/run-FdiIwz/verification.json` 全部通过，`native-pdf-preview.png` 人工复核确认 85 页、缩略图和正文已显示，同时覆盖已有窗口打开新链接、多文件上传、首次捕获、正文/SI 归档、宠物真实下载进度、取消和重启。

## 更新安装包

`outputs/electron-next-pdf-pet/final-release-windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`。

SHA256：`9C7E62AC514DEF84FD6DFC3B20E749B913D81974FC467D4A51E2752719873586`。安装前完整退出应用和托盘，在原位置更新；本轮未自动停止用户当前应用或安装覆盖用户程序。

产品实现为 `187ac7d`；打包标记为 `cc3910c`（后续提交只调整验收脚本）。固定版本保持 iBM 0.5.8-rc.1、NEXT 2.0.17-next、内核 0.2.0-rc.2。
