# 文献下载流程交接：0.5.5-beta8

更新时间：2026-09-26（beta8 出包完成）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA7.md`（保留为历史记录）。

## 当前代码状态

- 分支：release-0.5.0
- 关键提交：
  - `30269c4` 修 beta5 的 Rust 编译错误
  - `3f587d2` beta6：工具栏立即挂载 / 空白文档不计数 / 位移只认 PDF
  - `aa05571` beta7：**内部命令不再导航**（白屏真因）
  - `ba3b538` beta8：**验证页判定收紧**（文章页不再被误判）+ 验证状态可执行化 + JSON 边界修复
- 版本号：0.5.5-beta8

## 白屏之后暴露的两个问题（beta8）

1. **验证页误判**：beta6 把 `script[src*="challenge-platform"]` 当成"这是验证页"的判据，
   而 Cloudflare 给**所有受保护页面**都注入这个脚本 —— 普通文章页同样带着它。结果扫描器每次
   都在验证分支 `return`，**永远不去找下载入口**，状态恒为 `wait-and-poll`，任务卡死。
   现象就是用户说的："页面不是验证页，状态却说在等待自动验证"。
   现在：只有**挑战插页标题**，或**非文章页上的可见验证组件**（Turnstile 输入框 / 挑战
   表单或 iframe，且 >40×40）才算验证；有 `citation_doi`/`citation_title`/`dc.identifier`
   或正文 >1200 字的页面一律按文章页继续扫描。
2. **验证只能由人完成，状态却让人干等**：Turnstile 复选框必须人工点。现在验证阶段返回
   `nextAction=complete-verification`，文案明确要求用户去侧栏点一下；
   `presets/lab-research/preset.patch.yml` 里原来那句"不要让用户手动点击"也纠正了。

顺带修掉 `lab_browser_operation_status` 的 `value is not lossless JSON`：它直接返回
`{ result, error }`，操作未结束时这两项是 `undefined`；现在与其它工具一样过 `cleanJson`。

## 关于 lib 代码是否生效（用户的疑问，值得记住）

`desktop/src-tauri/src/runtime/dsh.rs` 在启动时比较一个**标记文件指纹**：

```rust
let desired_state = format!("desktop={}\nplugin={}\nmanifest={}\nvendor={}\nrequirements={}\nmnova={}\n",
    env!("CARGO_PKG_VERSION"), plugin_fingerprint, …);
if current_state != desired_state { logger.app("Materializing bundled iBM Lab data into AppData")?; replace_tree(&bundled_plugin, …)?; }
```

指纹里含**桌面版本号**：所以
- 只改 `webvpn.rs`（编译进 exe）而不改 lib 时，lib 文件时间戳不变是**正常**的（beta7 就是这样，
  日志里的新文案已经证明新 exe 在跑）；
- 改了 lib（beta8 改了 `lib/tasks-tool.js`）时，版本号一变指纹失配，应用会**整树重铺**内置插件，
  新 lib 会生效。

## 验证方法（这套很省时间，建议沿用）

- **能在 Edge 里重放就别改代码**：把注入脚本 + 应用自己的 WebView2 profile 副本喂给系统 Edge
  （`desktop/.build/inject-probe.mjs` 的写法），二分注入内容，几分钟定位到具体一句。
- **白屏先量三件事**：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数，并**同时量主 WebView 作对照**。
- **profile 是活证据**：`Default/History`（访问过哪些 URL，含 `__cf_chl_rt_tk` 这类挑战跳转）、
  `Default/Session Storage/000003.log`（我们工具栏写入的 URL 与标题）能直接回答"那个 document
  到底是什么"。
- 改版本号后**必须跑全量单测**：`tests/unit/release-version-consistency.test.mjs` 会核对 README。

## 尚未完成

- beta8 安装后的实测：文章页应正常扫描并点击入口；真遇到 Cloudflare 插页时应提示用户点验证框。
- 其他出版社回归（Nature、Springer、Wiley、ScienceDirect、ACS、RSC、IEEE）。
- 八家出版社的已登录 iWAN 标定（全部仍 `pending`）。
- 把 beta8 的提交与产物同步到远端。
