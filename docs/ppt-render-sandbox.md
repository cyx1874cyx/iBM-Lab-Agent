# 受限模式的 PPT 视觉核对

Agent 调用 `lab_render_deck`，传入当前会话工作区内的 `input`（PPT/PPTX/PDF），可选 `pages`、`dpi`、`sheetCols`。软件宿主通过原有的受管进程调用固定官方 `scripts/render-deck.mjs`，返回逐页 PNG 和 contact sheet。先查看总览图，再查看有疑问的单页。

这项产品能力不改变会话的 workspace-write 模式，不执行 Agent 提供的命令，不接受可执行文件、环境变量或任意输出目录。输入取真实路径，限制在当前会话工作区，拒绝指向外部的符号链接。每次输出到工作区 `.lab-tmp/ppt-review-*` 独立作业目录；TMP/TEMP/TMPDIR 同样指向作业目录。超时、取消和宿主关闭通过原有 ProcessSupervisor 结束受管进程。失败明确返回未完成，不降级为“已视觉核对”。

不能只把 CLI 探测换为 stdio:inherit：这样无法解析 JSON，且 kit 的原生渲染器仍使用双向管道协议。宿主执行这项固定能力，Agent 无须为渲染申请 danger-full-access。`lab_runtime_env` 也按当前会话工作目录返回 tempDir，并明确推荐本工具。
