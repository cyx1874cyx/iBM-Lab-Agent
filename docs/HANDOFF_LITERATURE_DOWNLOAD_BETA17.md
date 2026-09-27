# 文献下载流程交接：0.5.5-beta17

更新时间：2026-09-27（beta17 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA16.md`（保留为历史记录）。

## 本版主线：上传前必须证明"写完了"

`issue-0.5.5-beta16.md`：同一 DOI、同一串点击，**3 次 400 失败、第 5 次成功**，而失败时留在
盘上的 `-未归档.pdf` 是**完整的** 2.7 MB PDF（sha256 与成功那次的上传体一致）。

报告的推断是"壳上传了响应层载荷而不是落盘文件"。**代码推翻了它**：`-未归档.pdf` 是
`preserve_failed_download` 对 `upload.path` 的**重命名**，如果上传的不是那份下载文件，
保留下来的就不会是它。真因是 `read_captured_file` **第一次 `fs::read` 成功就返回**：

> `DownloadEvent::Finished { success: true }` 表示**网络传输结束**，不表示写文件的句柄已 flush。

于是我们读了前缀、当整份上传、被服务端校验拒绝；等事后去看，文件已经长到完整大小。
间歇性来自竞态（缓存命中、1 秒内完成的那几次更容易输）。

### 铁律：任何"读产物"的地方都要能回答"这证明它写完了吗"

```rust
fn captured_body_defect(kind: &str, bytes: &[u8]) -> Option<String>
// %PDF- 头 + %%EOF 尾（SI 另认 PK 头）；None = 结构上已是完整产物
```

`read_captured_file` 现在要求：**结构完整 ∧ 连续两次读到的长度一致**，30 秒上限，超时报告
"读到了多少字节、差哪一项"。判据与捕获服务的 `validateCapturedFile` **故意保持一致**——本地
就不会把一份注定被 400 拒绝的 body 发出去。

同类风险点（下次改下载相关代码时要一起想）：`file_is_whole`、`payload_is_whole`、
`sha256_of_file` 都是"读一次就下结论"，它们读的是**我们自己的暂存文件**，调用时机都在
写入者已经结束之后；如果将来把它们提前到下载事件回调附近，就必须套上同样的等待。

### 失败可见性的四件事（R2/R3/R4/R5）

| 编号 | 要点 |
|---|---|
| R2 | 服务端拒绝 → 读**响应体**写进错误。只记状态码等于把原因扔掉 |
| R3 | 校验失败带 code：`payload-too-small` / `missing-pdf-header` / `missing-eof` / `kind-mismatch` + `receivedBytes` |
| R4 | `lastFailure {message, salvagedPath, salvagedBytes, salvagedSha256}` 进状态；客户端**以前连 `lastError` 都没上报**——加壳侧字段时要同时改客户端上报体与 `reportDesktopWebVpnStatus` 三处 |
| R5 | 终态消息必须带原因；`cancelTask` 不覆盖 `error`（原因进 `errorHistory`，取消原因进 `cancelReason`） |

**`salvagedSha256` 只在文件确实是完整 PDF 时才给**——给半截文件算 sha256 会诱导调用方去登记
一个坏产物。

### 陷阱记录

- **不要用 `task.error && !requiresUserAction` 这种条件**：它读起来像"只在需要时才带原因"，
  实际效果是**恰恰在失败时把原因藏起来**。终态消息必须带原因。
- 断言"某模式不存在"的测试要小心自己的注释：把旧写法原样抄进注释会让测试失败（本次踩过）。
- `preserve_failed_download` 只改**文件名**（`{taskId}-{kind}-未归档.pdf`），所以从保留文件名
  **无法**反推它原本是下载文件还是载荷文件——排查时不要据此下结论。

## 还没做（明确排队）

| 编号 | 内容 |
|---|---|
| R6 剩余 | 成功事件本身带 `sha256`（判据三合一已在 beta16+R1 落地） |
| B3/B4 | 候选 `yieldsByteStream` 先验；出版社能力表（与 iWAN 标定同批） |
| B6/B7/B8、A1/A2 | 重启失效汇总、`.part` 原子重命名、同名版本记录 + DOI 去重、精读模板回退 |
| — | 动作延迟（claim 长轮询 + 即时动作循环） |
| — | 八家出版社 iWAN 标定（全 `pending`，需人工真机验收，**不要声称完成**） |

## 真机验收重点

按报告 §7 连做 5 次同一路径：**期望 5/5 成功**；若失败，日志里必须有捕获服务的响应体原文，
状态消息里必须有原因 + code，本地文件完整时必须给出 `salvagedPath` 与 sha256。
