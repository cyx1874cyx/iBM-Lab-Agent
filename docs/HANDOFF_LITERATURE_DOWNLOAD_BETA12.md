# 文献下载流程交接：0.5.5-beta12

更新时间：2026-09-27（beta12 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA11.md`（保留为历史记录）。

## 本版主线：AI 主导

- `lab_publisher_browser_download` 新增 **`mode`，默认 `ai`**：只打开页面 + 布防捕获，
  **不注入自动点击脚本**；`mode=auto` 才是老路径（脚本先点，失败再由 Agent 接管）。
  实现复用了既有开关：`pending.automate=false` 时 `pending_automation()` 本就不注入脚本。
- 任务新增 `mode` 字段（`src/manual-capture.js` 的 schema **必须同步**，Zod 会剥离未声明字段）。
- `lab_browser_observe` 新增 `scope`（`all` | `download`），并返回页面摘要
  （title / url / readyState / 可见文本前 1200 字 / scroll），元素引用仍短期且与 URL 绑定。
- 新增 `lab_browser_wait`：等阶段/页面/字节/任务状态变化或超时，避免空转轮询。
- 预设指引改成 **observe(scope=all) → click → wait → save**。

**为什么这很重要**：issue.md 的 B1（"自动化两类入口都识别不了"）在 AI 主导下不再是卡点 ——
入口由模型从页面里挑，候选带 `target`/`file`（beta11）可分同名 DOWNLOAD。

## 还没做（明确的下一步）

**浏览器动作延迟**：observe/click/save 仍要等客户端 **1.8 秒**的轮询节拍去领取操作
（`client/src/components-literature.js` 的 `setTimeout(poll, 1800)` → `browser_operation_claim`）。
计划：
1. `browser_operation_claim` 支持 `waitMs`（插件侧最多挂几秒，50ms 粒度检查）；
2. 客户端为浏览器动作单开一个**即时循环**（长轮询领取 → 执行 → 完成），不再搭 1.8 秒的主轮询；
3. 主轮询只做状态同步，避免与动作循环互相拖累。
这样每个动作从"最多 1.8 秒"降到毫秒级。本轮没做是为了不同时改两处、便于归因。

## 其它排队项（issue.md）

B3（网络中断有限次重试）、B5（重启失效任务的 UI 区分）、B7/O6/O7（孤儿任务、SI 单份静默替换、
命名缺 year 前置提示）、O4（进度，WebView2 不给总大小）、八家出版社的 iWAN 标定（全 pending）。

## 排查要点（沿用）

- 白屏先量三件事：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数，并同时量主 WebView 作对照。
- profile 是活证据：`Default/History`、`Default/Session Storage/000003.log`。
- 能在 Edge 里重放注入脚本就别改代码（`desktop/.build/inject-probe.mjs`）。
- 改版本号后必须跑**全量**单测；`Session { ... }` 字面量加字段要同步；生成 `.ps1` 必须纯 ASCII。
- 别把 `npm test | grep | head` 与 `&&` 串起来（`head` 提前关管道会让整链静默中断）。
- DSH 补丁必须对**正式树**应用（不能放在"需要重铺才执行"的条件块里），打包后 grep 复核。
