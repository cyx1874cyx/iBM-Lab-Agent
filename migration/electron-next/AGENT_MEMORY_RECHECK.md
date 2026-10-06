# 更新后 prepare 错误复核（2026-10-06）

用户报告更新后重新发送读取项目记忆，仍出现 `Cannot read properties of undefined (reading 'prepare')`；确认使用 Electron 入口。重新启动当前安装的 Electron 版后，用户在原报错对话中重发并确认“已成功读取”。本轮未替换产品代码或重新制作安装包。

安装目录为 `C:/Program Files/iBM Lab Agent Electron`，安装包产品源码提交为 `03229ec49888ae43d1f1a6a0a82b4945511ebaac`。确认 profile 与安装目录共用内核工具模块，调度器 Symbol 一致。已发现的 prepare 错误事件时间为 2026-10-05 10:46；当前记录不足以证明更新后失败的具体原因，不能将其直接判定为用户查看历史消息，也不能确定旧进程就是根因。

新增 `scripts/migration/verify-agent-memory.mjs`，在独立中文路径 home 使用实际安装的 Electron、Host、内核、科研 Agent 预设和记忆工具。确定性模型适配器发出真实工具调用，再走完整 Agent 循环；未使用用户凭据或修改真实课题记忆。

验收证据：`outputs/electron-next-agent-memory/resume-installed/run-KlDYX6/verification.json`。新会话完整任务通过，Host 停止重启后从持久化会话恢复，再执行读取工具通过，累计两次完整任务完成；调度器身份、课题记忆跨重启保留、七个服务域和捆绑 Python 库检查通过。

后续安装更新应完整退出应用与托盘，再启动更新后的程序。本轮状态：用户真实复测成功，安装版完整任务及持久化会话恢复回归通过；失败瞬间的根因尚未确证。
