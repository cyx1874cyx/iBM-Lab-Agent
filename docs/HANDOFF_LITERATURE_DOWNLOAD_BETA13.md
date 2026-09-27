# 文献下载流程交接：0.5.5-beta13

更新时间：2026-09-27（beta13 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA12.md`（保留为历史记录）。

## 本版主线：闭环收口（R1–R7 / C1–C22 一次交付）

beta12 把浏览器交给 AI，但状态机仍在说「壳内脚本自动跑」的话：AI 看得到阶段快照，
看不到页面事件、接管关系和失败原因。**最致命的一条**是 `armed` 且（心跳过期 或 已被
浏览器交给别的任务）被一律折叠成 `queued`——已经死掉的任务被描述成「排队第 1 位」，
AI 于是永远 wait-and-poll。本版把这三处一起收口。

### 架构上的关键决定：一份真相

新增 `lib/capture-phase.js` 的 `deriveCaptureView({ task, desktop, queuePosition, stalledMs })`，
返回 `{ phase, message, nextAction, requiresUserAction, question, alternateEntry, page, pdf, ball }`。

读它的地方：`lib/tasks-tool.js`（状态工具 / capture_list）、`lib/remote.js` 的
`manual_capture_get` 与 `manual_capture_list`、`client/src/components-project.js` 的提示条、
以及经 `WEBVPN_BALL_QUEUE` → `webvpn_set_capture_queue` → `capture_ball_json` 渲染的小球。

**改状态语义时只改这一个文件**，不要在任何消费方再写一遍判断——双源矛盾就是从那里来的。

### 关键字段（跨语言契约）

`WebVpnStatus`（Rust）→ `manual_capture_desktop_status_update`（客户端每 1.8 秒上报）→
`reportDesktopWebVpnStatus`（插件）：

```
pageUrl / documentType / httpStatus / readyState / pageSeq / contentLength   # C2 页面事实
pdfPayload: { ready, complete, contentLength, receivedBytes, error }         # C1 载荷就绪
lastPendingTaskId / releaseReason / takenOverAt                              # C3 接管关系
stalledMs                                                                    # C17 停滞
```

`manual_capture_desktop_status_update` 的 Zod/白名单清洗会丢掉未声明的字段——**加字段要三处同步**：
Rust `WebVpnStatus`、`client/src/components-literature.js` 的上报体、`reportDesktopWebVpnStatus`。

### PDF 保存的两条路（与文件纪律）

1. **响应层（主）**：`WebResourceResponseReceived` → `GetContent` → 流式写入
   `<task>-pdf.payload.pdf`（**与下载目标 `temp_path` 分开写**：共用一个文件会在
   "响应既是文档体又触发下载事件"时互相截断，归档出损坏的 PDF）。
   `Content-Disposition: attachment` 的响应直接跳过，交给下载事件那条老路。
2. **查看器兜底**：`ShowSaveAsUI`（老机制），同样等到终态才返回。

两条路都经 `wait_for_outcome(generation, timeout)` 拿终态；`finish_upload` 的**字节数必须由
调用方在删文件前量好传进来**（成功归档后临时文件已经不在，那时 stat 只会得到 None）。

模块纪律不变：**不读 Cookie、不导出票据**。"重新请求 PDF"走 `webview.navigate()`，
认证材料由浏览器引擎自己带着。

### 终端/工具语义

| nextAction | 含义 | 调用方该做什么 |
|---|---|---|
| `observe-or-click` | AI 主导，页面等你去点 | observe(scope=all) → click |
| `save-pdf-ready` | PDF 字节流已就绪 | 调 `lab_browser_save_current_pdf`（会等到终态） |
| `retry-download-entry` | 预览器无可点元素、保存支路不通 | 改用 `alternateEntry`（`?download=true`） |
| `complete-verification` | 人机验证 | 告诉用户去点，然后 wait |
| `recreate-or-cancel` | 终态（heartbeat-lost/orphaned/stalled/failed/expired） | 把 `question` 问用户；重建用 `cancel(recreate:true)` |
| `wait-and-poll` / `done` | 等 / 结束 | — |

## 本版踩到的坑（已修，别再犯）

- **探测绝不能把非 PE 文件交给 Windows 执行**：`runtime/deps.rs` 的 `node_status` 直接
  `Command::new(捆绑 node.exe)`；文件不是有效 PE 时 Windows 弹「不支持的 16 位应用程序」
  模态框并**挡住整个探测**（单元测试沙箱里的 4 字节假 node.exe 把测试拖到 5 分钟以上）。
  现在 `is_plausible_pe()` 先看 `MZ` + 体积，不满足就如实报「安装不完整或被安全软件截断」。
  **教训**：任何 `Command::new(被测试/用户可写的路径)` 都可能在 Windows 上变成模态框。
- **客户端不能内联 await 浏览器动作**：保存 PDF 要几十秒，以前整个 1.8 秒轮询被卡住，
  期间队列快照不再上报，小球就停在旧状态上不动（现场「小球没反应」的直接原因）。
  现在动作在独立任务里跑，主轮询继续上报。
- **WSL git 与 Windows git 对同一 NTFS 工作树的 `status` 结论不同**（行尾/权限位）。
  判断出包副本是否干净要用 `git.exe`；用 WSL git 看会显示"全部文件被修改"，
  而且 `windows-release-from-wsl.sh` 会因此拒绝 `reset --hard`（"worktree is dirty"）。
  在出包副本里手工改过文件后，先清干净再发版。
- 生成 `.ps1` 必须纯 ASCII；改版本号后必须跑**全量**单测（版本一致性闸门会拦）；
  `Session { ... }` 字面量加字段要同步（`status()` 里那份克隆最容易漏）。

## 还没做（明确的下一步）

1. **动作延迟**：observe/click 仍要等客户端 1.8 秒的轮询节拍领取操作
   （`client/src/components-literature.js` 的 `setTimeout(poll, 1800)` → `browser_operation_claim`）。
   计划：claim 支持 `waitMs` 长轮询 + 浏览器动作单开即时循环，主轮询只做状态同步。
2. **八家出版社的 iWAN 标定**：`docs/PUBLISHER_DOWNLOAD_CALIBRATION.json` 全部 `pending`，
   需要人工在真机 iWAN 环境逐家验收。**不要声称已完成。**
3. issue.md 排队项：B3（网络中断有限次重试）、B5（重启失效任务的 UI 区分）、
   B7/O6/O7（孤儿任务、SI 单份静默替换、命名缺 year 前置提示）、O4（进度，WebView2 不给总大小）。

## 真机验收建议（按顺序，能最快暴露问题）

1. Science 正文：点 `PDF` → `/doi/epdf` → 候选里应出现 `autoDownloadable=true` 的入口 →
   点它 → `completed` + 归档字节数对得上。**这是本版要证明的主路径。**
2. 裸查看器路径：点 `Download PDF` 进原生 PDF → `status` 应给 `save-pdf-ready` →
   调 `lab_browser_save_current_pdf` → **必须返回 `{path,bytes}` 或明确原因**（不允许静默）。
3. 制造失去接管：任务进行中关掉/重启应用，再查状态 → 必须是 `heartbeat-lost` 或
   `orphaned` + 重建/终止选项，**不能**是 `queued`。
4. 停滞：下载中断网 → 60 秒后小球与状态都应变成 error 分支。
5. 大文件：>100 MB 的 SI → 必须在上限处明确报错，而不是写满磁盘再 413。
