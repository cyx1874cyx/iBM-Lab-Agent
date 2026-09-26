# 文献下载流程交接：0.5.5-beta10

更新时间：2026-09-26（beta10 出包完成）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA9.md`（保留为历史记录）。

## 当前链路状态（每轮都实测确认过）

1. **白屏**（beta7 修）：内部命令不再用 `location.href` 导航载体页面，改走 `window.open`。
2. **验证页误判**（beta8 修）：只有挑战插页标题、或非文章页上的**可见**验证组件才算验证；
   文章页继续扫描。验证阶段返回 `nextAction=complete-verification`。
3. **原生 PDF 保存**（beta9 修）：进入 WebView2 内置查看器时切 `manual`，状态返回
   `nextAction=observe-or-save-pdf`，Agent 调 `lab_browser_save_current_pdf`
   （`ShowSaveAsUI` + `SetSuppressDefaultDialog`，直接存到归档路径、不弹框）。
4. **加载完成才动手**（beta10 修）：所有动作等 `document.readyState === 'complete'`；
   读捕获文件按存在性重试。
5. **小球队列**（beta10 新增）：显示排队序列与每条状态、逐条删除、下载完不消失。

## 本轮的两个坑（都已修，但值得记住）

- **"第几次扫描"等于固定延时**。`attempts >= 2 && forceDownload(...)` 看着像"重试两次"，
  实际是"约 1.5 秒后无条件动手"。大文件/慢网络下就会在资源还没就绪时触发下载，日志表现是
  `downloadRequested` 紧接 `系统找不到指定的文件`。判断"能不能动手"必须用页面自己的状态
  （`readyState === 'complete'`），不要用轮询次数或 sleep。
- **WebView2 报下载完成后文件可能还没落盘**。紧接着 `fs::read` 会得到 os error 2；
  现在 `read_captured_file()` 按存在性轮询（100ms，上限 20 秒），文件一出现就读。

## 小球队列的数据流（改动横跨四层，别只改一层）

```
插件（真源：manual-capture 存储）
  └─ 客户端每轮轮询 manual_capture_list → sendWebVpnBallQueue(tasks)   [client/src/webvpn-bridge.js]
       └─ 壳 window.postMessage(WEBVPN_BALL_QUEUE) → invoke('webvpn_set_capture_queue')   [desktop/src/index.html]
            └─ Rust 存 Session.capture_queue（长度/条数清洗）→ capture_ball_json 带 queue/pendingId
                 └─ 页面小球渲染队列 + 每行 ×
删除：小球 × → notifyShell('cancel-task/<id>') → on_new_window → handle_internal_command
     → **只接受当前队列快照里存在的 id** → 主 WebView eval `window.__ibmBallCancelTask(id)`
     → 壳转发 WEBVPN_CANCEL_TASK → 客户端调 manual_capture_cancel（+ 若是 pending 则关载体）
```

安全边界：页面是远端内容，不可信 —— Rust 侧必须用 `queue_contains()` 校验 id；
`webvpn_set_capture_queue` 也要做长度/条数清洗（50 条上限、字段截断）。

## 排查要点

- 白屏先量三件事：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数，并同时量主 WebView 作对照。
- `Default/History`、`Default/Session Storage/000003.log` 是"那个 document 到底是什么"的活证据。
- 能在 Edge 里重放注入脚本就别改代码（`desktop/.build/inject-probe.mjs`）。
- 改版本号后**必须跑全量单测**（`release-version-consistency` 会核对 README）。
- 给 `Session` 加字段后，`Session { ... }` 字面量（`status()` 里那处）也要补，否则 E0063。

## 尚未完成

- beta10 安装后的实测：①②③ 三点见发布说明。
- 其他出版社回归（Nature、Springer、Wiley、ScienceDirect、ACS、RSC、IEEE）。
- 八家出版社的已登录 iWAN 标定（全部仍 `pending`）。
