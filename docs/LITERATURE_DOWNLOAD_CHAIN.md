# 文献下载链路规格（给 Agent 的操作手册）

适用版本：`dsh-lab-agent` / 桌面壳 **0.5.6-beta2** 及以后。
`lab_browser_navigate`、`alternateRouteId`、`reasonCode` 与独立的 `downloadEventBytes` 自
**0.5.5-beta18** 起可用（beta17 安装包不含这些接口）——插件与桌面壳必须同版本，
否则 `navigate` 会被壳拒绝。
**0.5.6-beta1 起的三处变化**：响应层取体（旧通路 B）退役，正文只走"下载事件"与"CDP Fetch"
两条；条目已归档同类型文件时归档**明确失败**（不再静默覆盖）；文献浏览器窗口关闭即任务终止
（`window-closed`）。
本文是**操作手册**：另一个 Agent 读完应能独立驱动一条下载、判断失败、并在正确的地方取证。
实现细节与历史坑见 `docs/HANDOFF_LITERATURE_DOWNLOAD_BETA*.md`；本文件只在必要处引用它们。

---

## 0. 一句话

**软件内浏览器（WebView2 单例）打开出版社页面 → Agent 点击出版社预览页的下载元素，或触发原生 PDF 查看器保存 → 浏览器实际下载到临时目录 → 上传并归档到课题目录。** 完整的响应层 PDF 仍可直接归档；预览缓存不是下载进度。

**正文只有两条经真机确认的来路**（0.5.6-beta1 起）：

| 页面形态 | 通路 | 落盘文件 |
|---|---|---|
| 出版社定制 PDF 预览页 | 点击页面上的下载控件 → 浏览器**下载事件** | `<taskId>-<kind>.pdf` |
| 浏览器默认 PDF 查看器 | CDP `Fetch.requestPaused` 的 **Response** 阶段取原始正文 | `<taskId>-<kind>.payload.pdf` |
| 其余情况（直链、`?download=true`、附件响应） | 同为下载事件 | `<taskId>-<kind>.pdf` |

CDP Fetch 那条：`200/application/pdf` 正文经 `%PDF-`、末尾 `%%EOF` 与声明长度校验后写入
任务载荷文件，再用 `Fetch.continueRequest` 放行原导航；它不重新请求 URL，HTML 验证页、
`206` 分段与未命中任务的资源一律直接放行。

> 曾经的第三条路（`WebResourceResponseReceived` + `GetContent` 读取响应体，含 `206`
> 分段装配）**已退役**：实机不存在"只给 Range、不给整份"的站点，而它带来的代价是两个
> 写入者同写同一个载荷文件。因此 `206` 分段不再装配。

Agent 的职责是**驱动页面**与**判断状态**；**不要**自己发 HTTP、不要读浏览器 profile、
不要给 CSS 选择器。

---

## 1. 分层与数据流

```
模型
 └─ 工具层（插件 lib/tasks-tool.js）
     ├─ 任务类：lab_publisher_browser_download / _status / _cancel / capture_list
     └─ 页面类：lab_browser_observe / _click / _operation_status / _wait / _download_viewer_pdf
          │  写入"操作队列"（lib/manual-capture.js 的 browserOperations）
          ▼
DSH 客户端（iframe 内，每 1.5–1.8 s 轮询一次）
     ├─ 上报壳状态：manual_capture_desktop_status_update（页面事实/载荷/接管关系/失败原因）
     └─ 领取并执行动作：browser_operation_claim → invoke → browser_operation_complete
          ▼
桌面壳（Rust, desktop/src-tauri/src/webvpn.rs）
     ├─ 单例子 WebView2（专属 profile），注入工具栏 + 捕获小球 + 右下角"保存到课题"
     ├─ 浏览器下载事件 / 完整响应层 PDF / 页面事件（源变化、导航完成）
     ├─ 内部命令：ibm-webvpn://viewer-download/ · cancel-capture/ · recreate-task/ · cancel-task/<id>
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
| `lab_publisher_browser_download` | `bundleId`(必), `kind`(`pdf`\|`si`,必), `projectId`, `loginConfirmed` | `taskId`, `accessMode`(`iwan`\|`webvpn`\|`direct`), 或 `webvpn-login-required` + `question`，或 `already-archived` + `archiveConflict` + `question` |
| `lab_publisher_browser_download_status` | `taskId`(必), `projectId` | 见 §2.3 |
| `lab_publisher_browser_capture_list` | `projectId` | `tasks[]`（taskId/bundleId/kind/status/phase/queuePosition/requiresUserAction/nextAction/message/fileName/createdAt） |
| `lab_publisher_browser_download_cancel` | `taskId`(必), `reason`, `recreate`(布尔) | `{ok,taskId,status}`；`recreate:true` 时另给 `recreatedTaskId`/`recreatedStatus` |

`mode` 的选择：

- **`ai`（默认）**：壳内脚本**不点击**，页面交给 Agent（observe → click → wait → save）。
> **当前工具没有 `mode` 参数**（历史文档曾写 `ai|auto`）：新建任务一律由 Agent 驱动页面。
> 逐社"自动先点"的脚本路线已不在决策路径上。

`lab_nature_browser_download(+_status)` 是 Nature（`10.1038/`）的历史快路径，仍可用但**不要用于新流程**。

### 2.2 页面类

| 工具 | 参数 | 说明 |
|---|---|---|
| `lab_browser_observe` | `taskId`(必), `scope`(`download` 是默认；**`all` 用于 Agent 主导**), `projectId` | 返回 `operationId`；结果含 `url/documentType/readyState/text(1200字)/scroll/candidateCount/truncated/candidates[]`。最多 30 个候选，按视口内下载入口→其他下载入口→视口内普通元素排序；候选含 `inViewport`、`target`、`file` 等。识别到验证页时 `verificationRequired=true`、候选清空，由用户完成验证 |
| `lab_browser_click` | `taskId`(必), `observationId`(必), `elementId`(必) | 只能点**上一次 observe 刚返回**的元素；页面 URL 一变即失效 |
| `lab_browser_debug` | `taskId`(必), `projectId` | **只读**调试快照：主文档状态（host/documentType/httpStatus/readyState/contentLength/pageSeq）、最近 24 条事件、CDP Target 清单（type/host/pdfViewer/attached）。用于判断当前是 PDF 文档、HTML 验证页还是独立查看器目标。**不返回 Cookie、原始 URL 或响应体**（事件里的 URL 与日志同一套脱敏） |
| `lab_browser_navigate` | `taskId`(必), `routeId`(必), `expectedPageSeq`(必) | 执行状态返回的受限备用入口；当前仅支持 Science 官方正文页的 `science-pdf`，每任务一次 |
| `lab_browser_operation_status` | `operationId`(必), `waitMs`(0–90000) | `status` ∈ `queued`\|`running`\|`completed`\|`failed`；`waitMs>0` 在插件内等到终态 |
| `lab_browser_wait` | `taskId`(必), `timeoutMs`(默认 8000，上限 20000) | 等"阶段/页面/载荷/进度"任一变化即返回；已是终态则立即返回 |
| `lab_browser_download_viewer_pdf` | `taskId`(必) | 顶层为原生 PDF 时：载荷已由 CDP Fetch 就绪则直接归档；尚未就绪才退回 WebView2 原生 `ShowSaveAsUI`，壳指定暂存路径、按实际写入字节上报，校验完整后归档；立即返回 `operationId`。出版社 HTML 预览页请用 `observe`/`click` 点击真实下载元素。失败时按状态提示由用户在侧栏按 Ctrl+S。 |

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
pdf:   { ready, complete, contentLength, receivedBytes, error, verdict },
progress: { source, receivedBytes, totalBytes, declaredTotalBytes, percent, speedBps, etaSeconds, idleSeconds },
heartbeat: { stale, ageMs, pendingTaskId, lastPendingTaskId, releaseReason },
queuePosition, fileName, filePath, fileSha256, size, downloadedBytes, updatedAt, stalled,
downloadEventBytes, reasonCode, alternateRouteId,
downloadReady, payloadReady, payloadComplete, payloadVerdict,
viewerDownloadFailure: { count, error }
```

`downloadReady` 与 `nextAction === "download-viewer-pdf"` 同义，表示可请求归档已验证的响应层 PDF（CDP Fetch 已就绪）；尚未就绪时才尝试 WebView2 原生另存为。`payloadComplete` 只描述响应层 PDF。实际进度看 `progress.isActualDownload=true`：`native-save` 表示原生另存为写入任务文件的实际字节，`browser-download` 表示浏览器下载事件写入的实际字节。`viewer-buffer` 是预览缓存，`progress.note` 会明示它不是下载进度；此时顶层 `downloadedBytes` 不给出虚假的 348 B。任务完成后 `progress.source=archived-file`，按已登记的文件大小与路径报告。
原生 PDF 只有拿到完整 `200` 响应声明的长度才显示总量和百分比。

`reasonCode`（机器可读的失败原因，**按它决策，不要按中文文案猜**）：

| `reasonCode` | 含义 | 该做什么 |
|---|---|---|
| `already-archived` | 条目已归档同类型文件，本次归档被拒绝（原文件未动） | beta2 保留原文件并结束本次任务；替换待人工确认入口实现后开放 |
| `bundle-missing` | 条目不存在或不属于本课题 | 不要重试，告知用户条目已失效 |
| `kind-mismatch` | 文件名与任务类型不符 | 重新 observe 并点正确的入口 |
| `missing-pdf-header` / `missing-eof` / `payload-too-small` / `missing-zip-container` | 内容校验不通过 | 换入口（`retry-download-entry`）或重新下载 |
| `too-large` | 超过 250 MiB 上限 | 停止本次归档；只有取得完整且通过校验的文件后才能登记 |
| `token-invalid` / `token-replayed` / `task-not-armed` / `task-expired` | 令牌/任务状态无效 | 重建任务 |
| `transfer-incomplete` | 载荷没被证明收全 | `wait-and-poll` 或 `retry-download-entry` |
| `storage-failed` | 写盘/落位失败（旧文件已放回原位） | 报错给用户并附原因；不要当成"再抓一次就好" |
| `browser-operation` | 浏览器动作本身失败（点击/观察） | 重新 observe 后再决定；最多重试一次 |
| `upload-failed` | 兜底：服务端未能归类的原因 | 读 `message` 原文，按内容判断 |

归档冲突时状态里另给 `archiveConflict: { kind, fileName, size, sha256, archivedAt }`，
小球展示态 `ballState=conflict`（文案以「已有文件：」开头）。

`nextAction` 取值与含义（**这是唯一该用来决策的字段**）：

| `nextAction` | 含义 | 该做什么 |
|---|---|---|
| `observe-or-click` | 页面等你操作（`mode=ai`） | `lab_browser_observe(scope=all)` → `click` |
| `wait-and-poll` | 浏览器正在下载或归档 | `lab_browser_wait`，查看真实字节变化 |
| `download-viewer-pdf` | 顶层为原生 PDF，或完整 PDF 响应已采集 | 调 `lab_browser_download_viewer_pdf`，再查 `operation_status` 和任务状态；只以 `completed` 为成功 |
| `retry-download-entry` | 保存支路拿不到完整字节流，且有备用路线 | 用 `lab_browser_navigate(taskId, alternateRouteId, page.pageSeq)` 执行；`alternateEntry` 只供说明，不传给 `click` |
| `manual-handoff` | 原生 PDF 网络读取失败一次、其他保存支路连续失败，或没有可执行的备用入口 | 按 `question` 告知用户具体动作；原生 PDF 可在侧栏按 Ctrl+S，浏览器自动捕获归档，无需回传路径。随后重新查询任务状态 |
| `complete-verification` | 人机验证 | 让**用户**去侧栏点一下，然后 `lab_browser_wait` |
| `recreate-or-cancel` | 终态：`heartbeat-lost`/`orphaned`/`window-closed`/`stalled`/`failed`/`expired`/`already-archived` | 把 `question` 原样问用户；重建用 `cancel(recreate:true)`。**关窗导致的终止必须重新打开文献浏览器才能继续** |
| `done` | `completed` 或 `cancelled` | 结束 |

`phase` 取值：`queued` `waiting-login` `ready` `navigating` `waiting-download` `downloading`
`saving` `uploading` `completed` `failed` `expired` `cancelled` `error` **`heartbeat-lost`
`orphaned` `window-closed` `stalled`**。
`window-closed` = 文献浏览器窗口被关闭（`windowOpen=false`），任务已终止：此时 `pendingTaskId`
已经释放，**不要**再 `wait-and-poll`。

小球展示态 `ballState ∈ {loading, verification, searching, archiving, done, conflict, failed, cancelled}`
——正常流程只会看到前五种。
`task.status`（持久化层）只有六个：`armed` `uploading` `completed` `failed` `expired` `cancelled`。

---

## 3. 两条字节通路

一次成功归档，字节只能来自下面两条之一：

| 通路 | 触发 | 落盘文件 | 何时算"完整" |
|---|---|---|---|
| **A 下载事件** | 点了带 `?download=true` 的入口，或 `Content-Disposition: attachment` | `<taskId>-<kind>.pdf` | 上传前由 `captured_body_defect` 证明：`%PDF-` 头 ∧ `%%EOF` 尾（SI 另认 `PK`），**且连续两次读到的长度一致** |
| **C CDP Fetch** | 浏览器原生 PDF 打开时，`Fetch.requestPaused`(Response) 取同一次请求的原始正文（0.5.6-beta1 起，取代已退役的响应层取体） | `<taskId>-<kind>.payload.pdf`（**与 A 分开写**，避免两个写入者互相截断） | `%PDF-` 头 ∧ `%%EOF` 尾 ∧ 与声明的 `Content-Length` 一致；载荷区间并集需覆盖 `0..总长` |

补充规则（都是踩出来的，别当成可选）：

- **`206` 分段不再装配**（0.5.6-beta1）：取体通路退役后，浏览器用 Range 取数的站点不再走载荷
  通路，而由下载事件（A）负责。若某站点只给 Range、不给整份响应，正文只能从下载入口拿——
  这是已知限制，遇到时请换 `download=true` 一类入口。
- **`ready` ≠ `complete`**：`ready`=已经进来字节；`complete`=**已被正向证明收全**。只有
  `complete` 才能归档。
- 归档前三道校验：`%PDF-` 头 ∧ `%%EOF` 尾 ∧ 大小等于声明总长；不满足就报
  `PDF 载荷不完整（已接收 X / 共 Y）`，**不会**把半截文件交给捕获服务。
- 失败时保留证据文件：`<taskId>-<kind>-未归档.pdf`（**不删**）。文件若是完整 PDF，
  状态里会出现 `salvagedPath` 与 `salvagedSha256`。
- **两条通路仍可能同时活着**：点了 `?download=true` 时下载通路在写 `*.pdf`，而同一次导航若
  以 `200/application/pdf` 被 Fetch 拦下，载荷通路也在写 `*.payload.pdf`。判断"到底归档了哪一份"
  要看 `fileName` 与任务行的 `fileSha256`，不要看哪个文件大。
- **非 PDF 的落盘文件是证据，不是产物**：被判为非 PDF 的响应会保留成
  `<taskId>-<kind>.notpdf.bin`（原生另存为路线）或留在载荷路径上，**不会**进入课题归档。
  看任何落盘文件前先验 `%PDF-` 头。

---

## 4. 黄金路径（照这个顺序做）

```
0. lab_publisher_browser_download(bundleId, kind=pdf)         → taskId
   若返回 webvpn-login-required：把 question 原样问用户，停在这里
1. lab_browser_observe(taskId, scope=all)                     → operationId + candidates
2. lab_browser_operation_status(operationId, waitMs=15000)     → 拿候选（只有 completed 才有 result）
3. 选入口：结合当前视口、label、target、file 和 DOI；autoDownloadable 只是提示，同名靠 file 区分
4. lab_browser_click(taskId, observationId, elementId)         → operationId
   lab_browser_operation_status(operationId)                   → 确认点到了
5. lab_browser_wait(taskId)                                    → 页面/载荷变化
6. 重复 1–5，直到 status 给出下面之一：
   · 出版社 HTML 预览页 → 重新 observe，点击 Download PDF（含 pdfdirect/download=true 等）
   · nextAction=download-viewer-pdf → lab_browser_download_viewer_pdf(taskId) → operation_status(waitMs=0) + lab_browser_wait / download_status 逐次看真实字节 → 操作和任务终态
   · phase=completed            → 结束（fileName 就是归档名）
   · nextAction=recreate-or-cancel / retry-download-entry → 见 §5
7. 归档成功后按需读条目：lab_tasks_* （登记/更新产物）
```

`documentType=application/pdf` 与 `contentLength` 只证明查看器加载了 PDF 响应，不表示已下载；此时工具主动让查看器保存。状态持续显示目标文件的实际已写入字节、已知总量与停滞时间。最终还须校验并登记课题文件。

---

## 5. 失败处置（固定顺序，别乱）

1. **先读原因，再决定**：失败后立刻调一次 `lab_publisher_browser_download_status`。
   消息里会有壳侧失败原话（含捕获服务返回的 `code`/`receivedBytes`）。
   **不要先 `cancel`** —— 那会把诊断信息挤到后面，你会在最需要原因时把它关掉。
2. **看有没有保住的文件**：消息里出现「本地已保住完整文件 …」时，那份文件是完整的，
   直接用 `lab_tasks_update_bundle_file(kind=pdf)` 登记，**不要**为同一份字节再抓一次。
3. **连环失败就停**：同一篇文献连续 400/失败 **超过 2 次** → 停止自动重试，把情况告诉用户。
4. **归档冲突单独处理（`already-archived`）**：这不是失败，而是"东西已经在了、覆盖被拒绝"。
   向用户报告已有文件及冲突信息，结束本次下载任务。beta2 不提供自动替换或分件删除入口；
   需要更换错误归档时，等后续具备人工确认与回滚的分件管理功能。
5. **才谈重建**：`lab_publisher_browser_download_cancel(taskId, recreate=true)` 用同一篇文献
   立刻重建并返回新 `taskId`，不需要用户重新确认；同时把 `question` 问用户。

`phase` 到终态的含义：

| phase | 现实含义 |
|---|---|
| `heartbeat-lost` | 客户端超过 TTL（10 s / 长耗时 60 s）没上报 → 应用可能被挂起/关闭 |
| `orphaned` | 壳显式交还过这个任务（`releaseReason`），或排队宽限期内始终没人接管 |
| `window-closed` | 文献浏览器窗口被关闭（`windowOpen=false`）。任务终止，已下好的文件仍在本地 | 
| `stalled` | 下载/归档期间 60 秒无字节增长 |
| `failed` / `expired` / `error` | 见 `message` + `reasonCode` |

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
| 落盘产物 | `%LOCALAPPDATA%\iBM-Lab-Agent\webvpn-downloads\`：`*.pdf`（下载通路）、`*.payload.pdf`（CDP Fetch 载荷通路）、`*-未归档.pdf`（失败证据，**保留**）、`*.notpdf.bin`（原生另存为拿到非 PDF 时的诊断文件，**保留**） |
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
| 出版社知识分散 | Agent 端 DOI 分流与 Skill 规则仍需标定 | 试用 `skills/publisher-download/SKILL.md` 和 `references/publishers.md`；后续再把运行时规则统一为数据源 |
| iWAN 标定 | Science 正文 PDF 已获用户成功反馈；其具体入口/访问模式和 SI，以及其余七家的机构会话仍待逐项记录（`docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`） | 按规则表逐家验收，**不要把待测提示称为已支持** |
| 无通用下载器 | 只处理已登记 DOI 的出版社页面 | 有意为之 |
| 候选不预言可用性 | 现在只有 `autoDownloadable`；"这条入口是否直出字节流"仍需点一次才知道 | 排队中（B3） |
| 同名产物覆盖 | beta2：已有文件时归档**明确失败**（`already-archived`），本版不提供替换入口 | 已修 |
| `206` Range 站点 | 取体通路退役后不再装配 `206` 分段；只给 Range、不给整份响应的站点只能从下载入口取正文 | 有意如此（换 `download=true` 入口） |
| 空壳 PDF 响应 | 有些出版社把 `application/pdf` 响应的 body 换成 HTML 查看器空壳；Fetch 通路会正确地拒绝它，此时按 `retry-download-entry` 换入口 | 观察中 |
| 保存支路与下载通路可能同时活着 | 一次操作里两条通路都可能有产物；归档的是哪一份由 `fileName`/`fileSha256` 决定 | 有意如此 |

---

## 9. 版本时间线

| 版本 | 主题 |
|---|---|
| beta13 | 闭环收口：一份真相（工具/小球/提示条共用推导）、页面事件、接管/交还显式化、保存等终态 |
| beta14 | 载荷完整性：不再把 256 KiB 分片当整份；进度对象；`wait` 指纹含载荷维度；响应流封送到工作线程 |
| beta15 | 保存入口：右下角「保存到课题」浮层 + 侧栏兜底按钮（同一实现） |
| beta16 | 崩溃修复（COM 流双重释放）+ 完整性判据唯一化 + 失败前先验产物 + 终态不占队列位 |
| beta17 | **上传前必须证明"写完了"**（下载事件说 success ≠ 文件写完）+ 失败原因可见（响应体/code/salvaged） |
| 0.5.6-beta1 | CDP Fetch 取浏览器原生 PDF 正文（通路 C）；响应层取体（通路 B）退役；`reasonCode` 成表 |
| 0.5.6-beta2 | 归档冲突拒绝覆盖并展示提示；关窗释放并持久化终态；250 MiB 上限统一；同槽位并发归档串行化，provenance 不互相覆盖 |

**这张表的用法**：如果你在旧版本上看到"保存静默失败""256 KB 就报完成""进 PDF 页闪退"
"3 次 400 1 次成功"，那是**已知且已修**的问题，先确认壳与插件版本一致再排查别的。

---

## 10. 最小可用记忆（如果只记三句话）

1. **决策只看 `nextAction`**；HTML 预览页点页面下载元素，浏览器原生 PDF 的正文由壳经 CDP Fetch 自动取回（`download-viewer-pdf` 只负责归档就绪的那一份）。
2. **预览缓存不是下载进度**；`phase=downloading` 看 `progress.source=native-save` 或 `browser-download`、已写入字节及停滞时间，只等归档终态。
3. **失败先读原因、再看有没有保住的文件、连环两次就停**；重建用
   `cancel(recreate=true)`，人机验证只能由用户完成。
