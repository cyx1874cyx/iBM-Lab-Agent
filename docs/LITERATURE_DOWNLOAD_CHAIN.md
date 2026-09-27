# 文献下载链路规格（给 Agent 的操作手册）

适用版本：`dsh-lab-agent` / 桌面壳 **0.5.5-beta18** 及以后。
`lab_browser_navigate`、`alternateRouteId`、`reasonCode` 与独立的 `downloadEventBytes` 自
**0.5.5-beta18** 起可用（beta17 安装包不含这些接口）——插件与桌面壳必须同版本，
否则 `navigate` 会被壳拒绝。
Science 校园网下载入口仍待安装包真机回归。
本文是**操作手册**：另一个 Agent 读完应能独立驱动一条下载、判断失败、并在正确的地方取证。
实现细节与历史坑见 `docs/HANDOFF_LITERATURE_DOWNLOAD_BETA*.md`；本文件只在必要处引用它们。

---

## 0. 一句话

**软件内浏览器（WebView2 单例）打开出版社页面 → Agent 自己观察并点击入口 → 字节经"下载事件"或
"响应层载荷"两条路之一落到应用临时目录 → 上传到本机捕获服务 → 按条目规则原子归档到课题目录。**

Agent 的职责是**驱动页面**与**判断状态**；**不要**自己发 HTTP、不要读浏览器 profile、
不要给 CSS 选择器。

---

## 1. 分层与数据流

```
模型
 └─ 工具层（插件 lib/tasks-tool.js）
     ├─ 任务类：lab_publisher_browser_download / _status / _cancel / capture_list
     └─ 页面类：lab_browser_observe / _click / _operation_status / _wait / _save_current_pdf
          │  写入"操作队列"（lib/manual-capture.js 的 browserOperations）
          ▼
DSH 客户端（iframe 内，每 1.5–1.8 s 轮询一次）
     ├─ 上报壳状态：manual_capture_desktop_status_update（页面事实/载荷/接管关系/失败原因）
     └─ 领取并执行动作：browser_operation_claim → invoke → browser_operation_complete
          ▼
桌面壳（Rust, desktop/src-tauri/src/webvpn.rs）
     ├─ 单例子 WebView2（专属 profile），注入工具栏 + 捕获小球 + 右下角"保存到课题"
     ├─ 下载事件 / 响应层载荷（GetContent）/ 页面事件（源变化、导航完成）
     ├─ 内部命令：ibm-webvpn://save-pdf/ · cancel-capture/ · recreate-task/ · cancel-task/<id>
     └─ 上传：PUT http://127.0.0.1:<port>/api/lab-capture-upload?token=<一次性令牌>
          ▼
捕获服务（插件内 loopback 端点，lib/manual-capture.js）
     └─ 校验（头/尾/大小/类型）→ 写 .tmp-<hex> → 原子 rename → 登记 bundle
          ▼
课题条目目录（literature/<entryStem>/）
```

**关键分工**：任务与队列的真源在**插件**；页面上有没有东西可点、文件写没写完，只有**壳**知道。
两边通过"客户端轮询上报"汇合，所以状态最多有 **1.8 秒延迟**（已知限制，见 §8）。

---

## 2. 工具契约

### 2.1 任务类

| 工具 | 参数 | 返回要点 |
|---|---|---|
| `lab_publisher_browser_download` | `bundleId`(必), `kind`(`pdf`\|`si`,必), `projectId`, `mode`(`ai`默认\|`auto`), `loginConfirmed` | `taskId`, `accessMode`(`iwan`\|`webvpn`\|`direct`), 或 `webvpn-login-required` + `question` |
| `lab_publisher_browser_download_status` | `taskId`(必), `projectId` | 见 §2.3 |
| `lab_publisher_browser_capture_list` | `projectId` | `tasks[]`（taskId/bundleId/kind/status/phase/queuePosition/requiresUserAction/nextAction/message/fileName/createdAt） |
| `lab_publisher_browser_download_cancel` | `taskId`(必), `reason`, `recreate`(布尔) | `{ok,taskId,status}`；`recreate:true` 时另给 `recreatedTaskId`/`recreatedStatus` |

`mode` 的选择：

- **`ai`（默认）**：壳内脚本**不点击**，页面交给 Agent（observe → click → wait → save）。
- **`auto`**：壳内脚本按内置的逐社规则**先自己点**，失败后再由 Agent 接管。已知脚本认得入口的
  出版社（Science/ACS/Elsevier/IEEE/Wiley 等）用它更快。

`lab_nature_browser_download(+_status)` 是 Nature（`10.1038/`）的历史快路径，仍可用但**不要用于新流程**。

### 2.2 页面类

| 工具 | 参数 | 说明 |
|---|---|---|
| `lab_browser_observe` | `taskId`(必), `scope`(`download` 是默认；**`all` 才是 AI 主导该用的**), `projectId` | 返回 `operationId`；结果含 `url/documentType/readyState/text(1200字)/scroll/candidates[]`。候选：`{id, role, label, target, file, autoDownloadable, likely}` |
| `lab_browser_click` | `taskId`(必), `observationId`(必), `elementId`(必) | 只能点**上一次 observe 刚返回**的元素；页面 URL 一变即失效 |
| `lab_browser_navigate` | `taskId`(必), `routeId`(必), `expectedPageSeq`(必) | 执行状态返回的受限备用入口；当前仅支持 Science 官方正文页的 `science-pdf`，每任务一次 |
| `lab_browser_operation_status` | `operationId`(必), `waitMs`(0–90000) | `status` ∈ `queued`\|`running`\|`completed`\|`failed`；`waitMs>0` 在插件内等到终态 |
| `lab_browser_wait` | `taskId`(必), `timeoutMs`(默认 8000，上限 20000) | 等"阶段/页面/载荷/进度"任一变化即返回；已是终态则立即返回 |
| `lab_browser_save_current_pdf` | `taskId`(必) | **等到归档终态**：成功 `{path,bytes,sha256}`，失败给原因；工具超时 120 s |

**候选字段怎么用**：

- `autoDownloadable=true` → 点了**会直接下载**（`?download=true`、`.pdf` 直链、带 `download` 属性）；
  **优先点它**，别点只进预览器的同名入口。
- `file` → 同名入口的唯一区分（如 Science 的 `…_sm.pdf` 与 `…tables_s1_to_s6.zip`）。
- `target` 是**脱敏后的**主机+路径（票据参数已剥离），够你判断入口形态，但不要拿它当完整 URL 去请求。

### 2.3 `status` 返回的字段（判断全靠它）

```
ok, taskId, bundleId, kind, status, phase, message, nextAction,
requiresUserAction, question, alternateEntry,
page:  { url, documentType, httpStatus, readyState, pageSeq, contentLength },
pdf:   { ready, complete, contentLength, receivedBytes, error },
progress: { receivedBytes, totalBytes, declaredTotalBytes, percent, speedBps, etaSeconds, idleSeconds },
heartbeat: { stale, ageMs, pendingTaskId, lastPendingTaskId, releaseReason },
queuePosition, fileName, size, downloadedBytes, updatedAt, stalled,
downloadEventBytes, reasonCode, alternateRouteId,
saveReady, payloadReady, payloadComplete
```

**字段语义陷阱（现场踩过）**：`saveReady` 与 `nextAction === "save-pdf-ready"` **同义**；
`payloadReady` 只表示"有字节进来了"，`payloadComplete` 才是"已被证明收全"。
2026-09-27 现场出现过「同一次返回里 `saveReady=true`、消息却说载荷未收全（348 B）」——
现在前者已经与 `nextAction` 对齐，但**决策仍然只应看 `nextAction`**。

`nextAction` 取值与含义（**这是唯一该用来决策的字段**）：

| `nextAction` | 含义 | 该做什么 |
|---|---|---|
| `observe-or-click` | 页面等你操作（`mode=ai`） | `lab_browser_observe(scope=all)` → `click` |
| `wait-and-poll` | 还在进行（含"载荷正在接收"） | `lab_browser_wait`；**不要**归档 |
| `save-pdf-ready` | **载荷已被证明收全** | 调 `lab_browser_save_current_pdf`（会等到终态） |
| `retry-download-entry` | 保存支路拿不到完整字节流，且有备用路线 | 用 `lab_browser_navigate(taskId, alternateRouteId, page.pageSeq)` 执行；`alternateEntry` 只供说明，不传给 `click` |
| `manual-handoff` | 保存支路失败且没有可执行的备用入口 | 告知用户在侧栏手动处理，不要重复调用保存或重建任务 |
| `complete-verification` | 人机验证 | 让**用户**去侧栏点一下，然后 `lab_browser_wait` |
| `recreate-or-cancel` | 终态：`heartbeat-lost`/`orphaned`/`stalled`/`failed`/`expired` | 把 `question` 原样问用户；重建用 `cancel(recreate:true)` |
| `done` | `completed` 或 `cancelled` | 结束 |

`phase` 取值：`queued` `waiting-login` `ready` `navigating` `waiting-download` `downloading`
`saving` `uploading` `completed` `failed` `expired` `cancelled` `error` **`heartbeat-lost`
`orphaned` `stalled`**。
`task.status`（持久化层）只有六个：`armed` `uploading` `completed` `failed` `expired` `cancelled`。

---

## 3. 两条字节通路

一次成功归档，字节只能来自下面两条之一：

| 通路 | 触发 | 落盘文件 | 何时算"完整" |
|---|---|---|---|
| **A 下载事件** | 点了带 `?download=true` 的入口，或 `Content-Disposition: attachment` | `<taskId>-<kind>.pdf` | 上传前由 `captured_body_defect` 证明：`%PDF-` 头 ∧ `%%EOF` 尾（SI 另认 `PK`），**且连续两次读到的长度一致** |
| **B 响应层载荷** | 导航到 `application/pdf` 文档（原生查看器） | `<taskId>-<kind>.payload.pdf`（**与 A 分开写**，避免两个写入者互相截断） | `payload_is_whole`：`%PDF-` 头 ∧ `%%EOF` 尾 ∧（有 `Content-Length` 时）收满 |

补充规则（都是踩出来的，别当成可选）：

- **分段响应（`206` / `Content-Range`）一律不进载荷通路**：浏览器的 PDF 查看器用 Range 取数，
  第一段常常正好 256 KiB；把它当整份，就会得到"256 KB 就报已完整"的假信号。
- **`ready` ≠ `complete`**：`ready`=已经进来字节；`complete`=**已被正向证明收全**。只有
  `complete` 才能归档。
- 归档前三道校验：`%PDF-` 头 ∧ `%%EOF` 尾 ∧ 大小等于声明总长；不满足就报
  `PDF 载荷不完整（已接收 X / 共 Y）`，**不会**把半截文件交给捕获服务。
- 失败时保留证据文件：`<taskId>-<kind>-未归档.pdf`（**不删**）。文件若是完整 PDF，
  状态里会出现 `salvagedPath` 与 `salvagedSha256`。
- **两条通路可能同时活着**：点了 `?download=true` 时，下载通路在写 `*.pdf`，而响应层可能
  同时看到一个 `application/pdf` 响应并写 `*.payload.pdf`。判断"到底归档了哪一份"要看
  `fileName` 与任务行的 `fileSha256`，不要看哪个文件大。
- **`*.payload.pdf` 不一定是 PDF**：被拒绝的载荷也会落盘留证。2026-09-27 现场有一份 348 B
  的 HTML 查看器空壳（`<!doctype html>…<embed src='about:blank' type='application/pdf'>`）——
  它进来时 `payloadReady=true` 但 `payloadComplete=false`，**正确行为是拒绝归档**。
  看任何落盘文件前先验 `%PDF-` 头。

---

## 4. 黄金路径（照这个顺序做）

```
0. lab_publisher_browser_download(bundleId, kind=pdf)         → taskId
   若返回 webvpn-login-required：把 question 原样问用户，停在这里
1. lab_browser_observe(taskId, scope=all)                     → operationId + candidates
2. lab_browser_operation_status(operationId, waitMs=15000)     → 拿候选（只有 completed 才有 result）
3. 选入口：优先 autoDownloadable=true；同名靠 file 区分
4. lab_browser_click(taskId, observationId, elementId)         → operationId
   lab_browser_operation_status(operationId)                   → 确认点到了
5. lab_browser_wait(taskId)                                    → 页面/载荷变化
6. 重复 1–5，直到 status 给出下面之一：
   · nextAction=save-pdf-ready  → lab_browser_save_current_pdf(taskId)  ← 会等到终态
   · phase=completed            → 结束（fileName 就是归档名）
   · nextAction=recreate-or-cancel / retry-download-entry → 见 §5
7. 归档成功后按需读条目：lab_tasks_* （登记/更新产物）
```

**`mode=auto` 的差异**：第 1–5 步由壳内脚本先做；你只需 `wait` + `status`，失败后按同样方式接管。

---

## 5. 失败处置（固定顺序，别乱）

1. **先读原因，再决定**：失败后立刻调一次 `lab_publisher_browser_download_status`。
   消息里会有壳侧失败原话（含捕获服务返回的 `code`/`receivedBytes`）。
   **不要先 `cancel`** —— 那会把诊断信息挤到后面，你会在最需要原因时把它关掉。
2. **看有没有保住的文件**：消息里出现「本地已保住完整文件 …」时，那份文件是完整的，
   直接用 `lab_tasks_update_bundle_file(kind=pdf)` 登记，**不要**为同一份字节再抓一次。
3. **连环失败就停**：同一篇文献连续 400/失败 **超过 2 次** → 停止自动重试，把情况告诉用户。
4. **才谈重建**：`lab_publisher_browser_download_cancel(taskId, recreate=true)` 用同一篇文献
   立刻重建并返回新 `taskId`，不需要用户重新确认；同时把 `question` 问用户。

`phase` 到终态的含义：

| phase | 现实含义 |
|---|---|
| `heartbeat-lost` | 客户端超过 TTL（10 s / 长耗时 60 s）没上报 → 应用可能被挂起/关闭 |
| `orphaned` | 壳显式交还过这个任务（`releaseReason`），或排队宽限期内始终没人接管 |
| `stalled` | 下载/归档期间 60 秒无字节增长 |
| `failed` / `expired` / `error` | 见 `message` + `code` |

---

## 6. 红线（不要做）

1. **不要自己发 HTTP 去下 PDF**：认证材料只存在于 WebView2 profile 内，模块纪律是
   **不读取、不导出、不记录** Cookie/LocalStorage/ticket。
2. **不要给 CSS 选择器或坐标**：`click` 只接受 `observe` 刚返回的 `observationId + elementId`，
   页面一变即失效。这是安全边界，不是限制。
3. **不要为了"让保存更容易"放宽**：上传端点只接受 `loopback + 一次性令牌 + 批准目录内的已完成文件`。
4. **不要擅自取消**正在进行的任务，也不要让失败任务继续占着队列（用 `recreate=true` 或问用户）。
5. **人机验证只能由人完成**：`nextAction=complete-verification` 时请用户去侧栏点，你只负责等。
6. **不要读应用内部存储来推断进度**（`lab_captures.json` 等）：状态工具就是为此存在的。

---

## 7. 出问题时取证在哪

| 想确认 | 去哪看 |
|---|---|
| 页面事件、下载请求/完成、捕获服务的拒绝原文 | `%LOCALAPPDATA%\iBM-Lab-Agent\logs\webvpn.log` |
| 应用/DSh 层日志 | 同目录 `app.log` / `dsh.log` |
| 落盘产物 | `%LOCALAPPDATA%\iBM-Lab-Agent\webvpn-downloads\`：`*.pdf`（下载通路）、`*.payload.pdf`（载荷通路）、`*-未归档.pdf`（失败证据，**保留**） |
| 任务行（含 `error` / `errorHistory` / `cancelReason` / `fileName` / `fileSha256`） | `%LOCALAPPDATA%\iBM-Lab-Agent\dsh\storages\lab_captures.json` |
| 条目与课题 | `%LOCALAPPDATA%\iBM-Lab-Agent\dsh\storages\lab_tasks.json`；条目目录见 bundle 行的 `entryDir`，形如 `…\dsh\lab-agent\projects\<projectId>\literature\<entryStem>\` |
| 浏览器 profile（**只读禁入**，仅用于确认存在） | `%LOCALAPPDATA%\iBM-Lab-Agent\webvpn-webview2\EBWebView\` |

**别认错目录**：`…\dsh\lab-agent\literature-downloads\` 属于**文献检索/下载服务**那条链路，
与本文件的捕获链路无关；本链路的临时产物只在 `…\iBM-Lab-Agent\webvpn-downloads\`。

**验盘口诀**（状态可能是错的，盘上的字节不会）：`%PDF-` 头 ∧ 尾部 `%%EOF` ∧ 大小稳定；
任何**恰好是 2 的整次幂**的大小（262144、524288…）先按"截断"处理。

---

## 8. 已知限制（别把它当 bug 报）

| 限制 | 说明 | 状态 |
|---|---|---|
| 动作延迟 | 每个 `observe/click` 要等客户端 **1.8 秒**轮询节拍领取 | 排队中（claim 长轮询 + 即时动作循环） |
| 出版社知识在壳里 | 逐社入口规则（Science/ACS/Elsevier/IEEE/Wiley 等）硬编码在注入脚本；`mode=ai` 下模型看不到，只能自己试 | 计划做成 `publisher-download` skill + 单份规则表 |
| iWAN 标定 | 八家出版社的机构访问**全部未真机标定**（`docs/PUBLISHER_DOWNLOAD_CALIBRATION.json` 全 `pending`） | 需人工逐家验收，**不要声称已支持** |
| 无通用下载器 | 只处理已登记 DOI 的出版社页面 | 有意为之 |
| 候选不预言可用性 | 现在只有 `autoDownloadable`；"这条入口是否直出字节流"仍需点一次才知道 | 排队中（B3） |
| 同名产物覆盖 | 覆盖既有条目文件时不留版本记录 | 排队中（B8/A2） |
| 载荷通路对"空壳 PDF 页" | 有些出版社把 `application/pdf` 响应的 body 换成一段 HTML 查看器空壳（`<embed src='about:blank'>`），此时载荷通路会正确地拒绝，但**不会自动改用下载通路**——需要调用方按 `retry-download-entry` 换入口 | 观察中 |
| 保存支路与下载通路可能同时活着 | 一次操作里两条通路都可能有产物；归档的是哪一份由 `fileName`/`fileSha256` 决定 | 有意如此 |

---

## 9. 版本时间线（beta13 → beta17 修了什么）

| 版本 | 主题 |
|---|---|
| beta13 | 闭环收口：一份真相（工具/小球/提示条共用推导）、页面事件、接管/交还显式化、保存等终态 |
| beta14 | 载荷完整性：不再把 256 KiB 分片当整份；进度对象；`wait` 指纹含载荷维度；响应流封送到工作线程 |
| beta15 | 保存入口：右下角「保存到课题」浮层 + 侧栏兜底按钮（同一实现） |
| beta16 | 崩溃修复（COM 流双重释放）+ 完整性判据唯一化 + 失败前先验产物 + 终态不占队列位 |
| beta17 | **上传前必须证明"写完了"**（下载事件说 success ≠ 文件写完）+ 失败原因可见（响应体/code/salvaged） |

**这张表的用法**：如果你在旧版本上看到"保存静默失败""256 KB 就报完成""进 PDF 页闪退"
"3 次 400 1 次成功"，那是**已知且已修**的问题，先确认壳与插件版本一致再排查别的。

---

## 10. 最小可用记忆（如果只记三句话）

1. **决策只看 `nextAction`**，`phase`/`saveReady`/`percent` 都是辅助信息。
2. **载荷没被证明收全（`pdf.complete=false`）就不许归档**；`phase=downloading` 只等。
   `saveReady` 不是判据，`nextAction` 才是。
3. **失败先读原因、再看有没有保住的文件、连环两次就停**；重建用
   `cancel(recreate=true)`，人机验证只能由用户完成。
