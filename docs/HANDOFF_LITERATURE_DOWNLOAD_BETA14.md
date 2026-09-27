# 文献下载流程交接：0.5.5-beta14

更新时间：2026-09-27（beta14 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA13.md`（保留为历史记录）。

## 本版主线：载荷完整性

beta13 把闭环的**可见性**做完了（失败必带原因），现场随即用这份可见性定位到一条更深的缺陷：
**半个 PDF 会被当成完整载荷一路送到归档服务**。根因三处（详见 `docs/releases/v0.5.5-beta14.md`），
其中两处在壳、一处在插件的归档门。

修完之后的铁律，改代码时不要破坏：

1. **`complete` 只能来自正向证明**：收满 `Content-Length`，或尾部出现 `%%EOF`。
   永远不要写 `complete = bytes > 0` 这种形状。
2. **`ready` ≠ `complete`**：`ready` = 至少进来了一个字节（正在接收时也为真）。
   归档门必须两个都看。
3. **读 `IStream` 时 `Read` 返回 0 不是 EOF**：这个流由网络响应驱动，暂时没数据也返回 0。
   停止条件只能是"正向证明完整"或"停滞超时"。
4. **归档前三道校验**：`%PDF-` 头 ∧ 尾部 `%%EOF` ∧ 大小 == `Content-Length`。
   校验失败就把 `receivedBytes/totalBytes` 如实报出去，不要交给归档服务去 400。
5. **进度是一个数**：`pending_progress_bytes()` 取下载目标与响应层载荷的较大者。
   只看 `temp_path` 会让响应层那条路完全没有进度。

## 关键判据（跨语言）

壳 `WebVpnStatus.pdfPayload` → `reportDesktopWebVpnStatus` → `deriveCaptureView`：

```
ready     = received_bytes > 0                       # 有字节了
complete  = 收满 Content-Length 或尾部有 %%EOF         # 已证明完整
error     = 未收全时的原因（"已接收 X 字节 / Y，5 秒没有新数据"）
```

插件对外（工具返回值，也是预设唯一该看的判据）：

| nextAction | 条件 | 调用方 |
|---|---|---|
| `save-pdf-ready` | `ready ∧ complete` | 调保存工具（会等到终态） |
| `wait-and-poll` | `ready ∧ ¬complete` | **只等**，消息里带 `progress` |
| `retry-download-entry` | `error ∧ ¬complete`，或预览器里没有可点元素 | 改用 `alternateEntry` |
| `recreate-or-cancel` | 终态（heartbeat-lost/orphaned/stalled/failed/expired） | 问用户；重建用 `cancel(recreate:true)` |

`progress = {receivedBytes, totalBytes, percent, speedBps, etaSeconds}`；
**总量未知时省略 `percent`/`etaSeconds`**，绝不填 0 或拿分片大小顶替。

## 本版踩到的坑（别再犯）

- **把"有字节"当"收完了"**：`complete = bytes > 0` + `read == 0 → break`，两条合起来
  正好在 256 KiB 的缓冲边界上产出"看起来完整"的半截 PDF。凡是"完成"判据，都要问一句
  **"这是正向证明，还是仅仅没有反证？"**。
- **报了一个假的数字比不报更糟**：`formatBytes(pdf.contentLength || pdf.receivedBytes)`
  在 `contentLength` 缺失时会把分片当总长打印出来，调用方据此判断"快完了"。
  现在缺总量就明说"总大小未知"。
- **现场诊断的价值**：`-未归档.pdf` 与 `*.payload.pdf` 这两个落盘文件是这次定位的关键
  （262144 恰好是 2^18，一眼可疑）。保留这类"失败也留下证据"的行为。

## 还没做（明确的下一步）

1. **页内浮层保存按钮**：仅在 ePDF（PDF.js）这类**网页**阅读器可行；原生 PDF 查看器的
   注入脚本不执行，浮层不会出现。**先别做**，除非确认场景只在 ePDF。
2. **动作延迟**：`browser_operation_claim` 长轮询 + 浏览器动作即时循环（beta12 起排队）。
3. **八家出版社 iWAN 标定**：全 `pending`，需人工真机逐家验收。**不要声称已完成。**
4. issue.md 排队项：B3、B5、B7/O6/O7、O4。

## 真机验收建议

见 `docs/releases/v0.5.5-beta14.md` 末尾 4 步。第 1 步（在字节还在涨时调保存，必须得到
明确拒绝而不是 HTTP 400）是本版的治本项，第 4 步（裸查看器也能归档）是 beta13 没做到的。
