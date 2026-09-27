# 文献下载流程交接：0.5.5-beta16

更新时间：2026-09-27（beta16 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA15.md`（保留为历史记录）。

## 本版主线：崩溃修复 + 完整性判据的唯一化

对应两份现场报告：beta15 的"一进原生 PDF 页就闪退"，以及
`issue-shell-pdf-payload-judgement.md` 的 B1/B2/B5。

### 1. COM 封送的铁律（会导致进程崩溃，务必遵守）

`CoGetInterfaceAndReleaseStream` **会释放传给它的那个流**（即使反封送失败也释放）：

```rust
// ❌ 双重释放：包装器随后还会 Drop 一次 → 引用计数下溢 → 堆损坏 → 进程崩
let marshaled = unsafe { IStream::from_raw(raw) };
let stream = unsafe { CoGetInterfaceAndReleaseStream(&marshaled) }?;

// ✅ 生命周期完全交给 API
let marshaled = ManuallyDrop::new(unsafe { IStream::from_raw(raw) });
let stream = unsafe { CoGetInterfaceAndReleaseStream(&*marshaled) }?;
```

**教训**：任何"transfer/release ownership"语义的 Win32 API，在 Rust 里都要先问一句
"这个包装器的 Drop 会不会再释放一次"。同类 API：`CoUnmarshalInterface`（不释放）、
`CoGetInterfaceAndReleaseStream`（释放）、`take_pwstr`（释放）、`CoTaskMemPWSTR`（Drop 释放）。

另外：`spawn_payload_read` 的**退化路径**（封送失败 → 在 UI 线程上读）有 20 秒硬上限
（`INLINE_STREAM_MAX_WAIT`），别把它调回 180 秒——那会把界面冻住。

### 2. 完整性只有一个判据

```rust
fn payload_is_whole(bytes: &[u8], declared_total: Option<u64>) -> bool
// %PDF- 头 ∧ %%EOF 尾 ∧（声明总长已知时）收满
```

**状态上报与归档校验必须共用它**。两条各判各的，就是 B1 的成因：状态认"收满这一次响应的
Content-Length"，归档认"尾部有 %%EOF"；浏览器的 PDF 查看器用 Range 分段取数（第一段常是
256 KiB），于是分段同时满足了前者、违反了后者 → 状态喊 `save-pdf-ready`、归档拒收。

配套的两条：

- **分段响应（`206` / `Content-Range`）一律不进入载荷路径**，并写日志（`跳过 PDF 分段响应`）。
  宁可没有保存支路，也不能给假完成信号。
- **没有采纳**报告建议的"收满 + 静默 10–15 秒"。`%%EOF` 是更强的正向证明，静默等待会让每次
  保存白等十几秒。判断"完成"的通用原则请沿用：**要正向证明，不要"暂时没有反证"**。

### 3. 失败之前先验产物（B2/B5）

`fail_pending_download(app, message)` 现在：

1. 盘上文件是完整 PDF → **归档它**（B2：报告里那个任务报 `failed`，而文件是完整的
   2.7 MB 可解析 PDF）；
2. 确实不完整 → 失败，但**保留成 `*-未归档.pdf`**、路径写进原因（B5：以前会把用户的完整
   文件删掉，那次没丢件纯属运气）；
3. 没有待捕获任务 → 直接返回，不污染会话状态。

两个落盘文件的含义（写在这里，避免下次又要猜）：

| 文件 | 含义 |
|---|---|
| `capture-<id>-pdf.pdf` | 下载事件那条路的目标文件（WebView2 直接写） |
| `capture-<id>-pdf.payload.pdf` | 响应层捕获的载荷（**与下载目标分开**，避免两个写入者互相截断） |
| `capture-<id>-<kind>-未归档.pdf` | 失败时保留的证据文件（不完整的产物） |

### 4. 队列位次只发给活着的任务（B5）

`listTaskViews` 统一决定位次：终态（`orphaned`/`failed`/`stalled`/`heartbeat-lost`/`completed`/
`cancelled`）仍然出现在列表里（历史记录不该消失），但**不占位**。工具里不再自己算一遍 FIFO
（只有服务缺 `listTaskViews` 时才走兼容分支）。

## 还没做（明确排队，不是遗忘）

| 编号 | 内容 |
|---|---|
| B3 | 候选 `yieldsByteStream` 先验；`alternateEntry` 与已失败入口相同时要明说"无替代入口" |
| B4 | 出版社能力表（如 science.org 保存支路不可用），与 iWAN 标定同批做 |
| B6 | 重启失效任务的汇总提示（现状已在 `capture_list` 里如实呈现） |
| B7 | 落盘 `.part` → 原子重命名 + `writing` 标志 |
| B8 / A2 | 同名覆盖版本记录 + 同 DOI 条目去重提示（同一件事） |
| A1 | 精读模板无 active 版本时返回候选清单而不是抛错 |
| — | 动作延迟（`browser_operation_claim` 长轮询 + 即时动作循环） |
| — | 八家出版社 iWAN 标定（全 `pending`，需人工真机验收，**不要声称完成**） |

## 真机验收重点

1. **先确认不再崩**（bug1）。
2. 慢速网络上 `percent` 逐次逼近 100；`declaredTotalBytes` 是 2.6 MB 量级而不是 256 KB。
3. 只有分段响应的入口：状态里出现"跳过 PDF 分段响应"，**不再**出现 `save-pdf-ready`。
