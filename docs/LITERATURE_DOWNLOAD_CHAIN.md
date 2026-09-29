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

**软件内浏览器（WebView2 单例）打开出版社页面 → Agent 点击出版社预览页的下载元素，或触发原生 PDF 查看器保存 → 浏览器实际下载到临时目录 → 上传并归档到课题目录。** 完整的响应层 PDF 仍可直接归档；预览缓存不是下载进度。

原生 PDF 新增同请求响应捕获：WebView2 在 CDP `Fetch.requestPaused` 的 **Response** 阶段读取
`200/application/pdf` 正文，校验 `%PDF-`、末尾 `%%EOF` 与声明长度后写入当前任务的载荷文件，
再用 `Fetch.continueRequest` 放行原导航。它不重新请求 URL；HTML 验证页、`206` 分段与
未命中任务的资源直接放行，仍由原下载事件／分段路径处理。2026-09-30 已在独立 Edge
调试实验中验证 ScienceDirect 正文（1,682,985 字节、17 页），**WebView2 壳内真机效果仍待回归**。

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
| `lab_browser_observe` | `taskId`(必), `scope`(`download` 是默认；**`all` 用于 Agent 主导**), `projectId` | 返回 `operationId`；结果含 `url/documentType/readyState/text(1200字)/scroll/candidateCount/truncated/candidates[]`。最多 30 个候选，按视口内下载入口→其他下载入口→视口内普通元素排序；候选含 `inViewport`、`target`、`file` 等。识别到验证页时 `verificationRequired=true`、候选清空，由用户完成验证 |
| `lab_browser_click` | `taskId`(必), `observationId`(必), `elementId`(必) | 只能点**上一次 observe 刚返回**的元素；页面 URL 一变即失效 |
| `lab_browser_debug` | `taskId`(必), `projectId` | **只读**调试快照：主文档状态（host/documentType/httpStatus/readyState/contentLength/pageSeq）、最近 24 条事件、CDP Target 清单（type/host/pdfViewer/attached）。用于判断当前是 PDF 文档、HTML 验证页还是独立查看器目标。**不返回 Cookie、原始 URL 或响应体**（事件里的 URL 与日志同一套脱敏） |
| `lab_browser_navigate` | `taskId`(必), `routeId`(必), `expectedPageSeq`(必) | 执行状态返回的受限备用入口；当前仅支持 Science 官方正文页的 `science-pdf`，每任务一次 |
| `lab_browser_operation_status` | `operationId`(必), `waitMs`(0–90000) | `status` ∈ `queued`\|`running`\|`completed`\|`failed`；`waitMs>0` 在插件内等到终态 |
| `lab_browser_wait` | `taskId`(必), `timeoutMs`(默认 8000，上限 20000) | 等"阶段/页面/载荷/进度"任一变化即返回；已是终态则立即返回 |
| `lab_browser_download_viewer_pdf` | `taskId`(必) | 通过 WebView2 原生 `ShowSaveAsUI` 保存当前 PDF；壳指定任务暂存路径、读取实际写入字节，校验完整后归档；立即返回 `operationId`。出版社 HTML 预览页用 `observe`/`click` 点击真实下载元素。失败时按状态提示由用户在侧栏按 Ctrl+S。 |

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

`downloadReady` 与 `nextAction === "download-viewer-pdf"` 同义，表示可请求归档已验证的响应层 PDF；载荷尚未就绪时才尝试 WebView2 原生保存。`payloadVerdict=html-viewer` 时 `payloadReady=false`，即使 HTML 响应已有字节；`payloadComplete` 只描述响应层 PDF。实际进度看 `progress.isActualDownload=true`：`native-save` 表示原生另存为写入任务文件的实际字节，`browser-download` 表示浏览器下载事件写入的实际字节。`viewer-buffer` 是预览缓存，`progress.note` 会明示它不是下载进度；此时顶层 `downloadedBytes` 不给出虚假的 348 B。任务完成后 `progress.source=archived-file`，按已登记的文件大小与路径报告。
原生 PDF 只有拿到完整 `200` 响应声明的长度才显示总量和百分比；`206` 分段长度不会冒充整份文件大小。

`nextAction` 取值与含义（**这是唯一该用来决策的字段**）：

| `nextAction` | 含义 | 该做什么 |
|---|---|---|
| `observe-or-click` | 页面等你操作（`mode=ai`） | `lab_browser_observe(scope=all)` → `click` |
| `wait-and-poll` | 浏览器正在下载或归档 | `lab_browser_wait`，查看真实字节变化 |
| `download-viewer-pdf` | 顶层为原生 PDF，或完整 PDF 响应已采集 | 调 `lab_browser_download_viewer_pdf`，再查 `operation_status` 和任务状态；只以 `completed` 为成功 |
| `retry-download-entry` | 保存支路拿不到完整字节流，且有备用路线 | 用 `lab_browser_navigate(taskId, alternateRouteId, page.pageSeq)` 执行；`alternateEntry` 只供说明，不传给 `click` |
| `manual-handoff` | 原生 PDF 网络读取失败一次、其他保存支路连续失败，或没有可执行的备用入口 | 按 `question` 告知用户具体动作；原生 PDF 可在侧栏按 Ctrl+S，浏览器自动捕获归档，无需回传路径。随后重新查询任务状态 |
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
| **B 响应层载荷** | 导航到 `application/pdf` 文档（原生查看器）｜**分段装配**：多次 Range 响应写同一个文件的各自偏移 | `<taskId>-<kind>.payload.pdf`（**与 A 分开写**，避免两个写入者互相截断） | 区间并集从 0 连续覆盖到声明总长；总长未知时要求尾部 `%%EOF` |

补充规则（都是踩出来的，别当成可选）：

- **分段响应（`206` / `Content-Range`）要装配，不是丢弃**：浏览器的 PDF 查看器用 Range 取数
  （实测一份 4.4 MB 的 Wiley PDF 是 18 个 256 KiB 请求）。按 `Content-Range` 的起始偏移写进同一个
  载荷文件，等区间并集**从 0 连续覆盖到总长**才算完整。曾经的"跳过所有分段"是错的：那会让载荷
  永远收不全、状态永远停在"正在接收"。
  只有**无法解析**的 `Content-Range` 才跳过（并记日志）。
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
| 出版社知识分散 | Agent 端 DOI 分流与 Skill 规则仍需标定 | 试用 `skills/publisher-download/SKILL.md` 和 `references/publishers.md`；后续再把运行时规则统一为数据源 |
| iWAN 标定 | Science 正文 PDF 已获用户成功反馈；其具体入口/访问模式和 SI，以及其余七家的机构会话仍待逐项记录（`docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`） | 按规则表逐家验收，**不要把待测提示称为已支持** |
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

1. **决策只看 `nextAction`**；HTML 预览页点页面下载元素，原生 PDF 调 `lab_browser_download_viewer_pdf`。
2. **预览缓存不是下载进度**；`phase=downloading` 看 `progress.source=native-save` 或 `browser-download`、已写入字节及停滞时间，只等归档终态。
3. **失败先读原因、再看有没有保住的文件、连环两次就停**；重建用
   `cancel(recreate=true)`，人机验证只能由用户完成。
