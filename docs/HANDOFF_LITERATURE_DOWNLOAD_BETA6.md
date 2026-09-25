# 文献下载流程交接：0.5.5-beta6

更新时间：2026-09-25（beta6 已出包，剩安装后的人工验收与推送）

上一份交接：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA5.md`（保留为历史记录）。

## 当前代码状态

- 工作目录：/root/ibm-lab
- 分支：release-0.5.0
- 提交：
  - `74d637a` beta5 功能修复（**Rust 编译不通过**，见 beta5 交接）
  - `30269c4` 修编译错误，beta5 产物由它构建
  - `3f587d2` **修白屏**，beta6 产物由它构建
  - 之后是发布说明与本文档
- 版本号：0.5.5-beta6
- 远端：`release-0.5.0` 与 `main` 在 df69db1（beta5 那次推送），beta6 的提交**还没推送**

## 白屏的根因与修法（beta6）

用户的描述是「能打开侧边栏，但浏览器是白屏；开始下载文献时变白；手动打开 WebVPN 正常；
白屏时连工具栏都没有」。定位靠只读测量而不是猜测（主 WebView 作对照）：

| 观测量 | 文献侧栏 | 主 WebView |
| --- | --- | --- |
| 子窗口 z 序 | 最上层 | 其下 |
| `WS_VISIBLE` | true | true |
| 矩形 | 1409,115 1151×1277（正确） | 全窗 |
| 表面颜色数 | **1（纯白 100%）** | 124 |
| 页面 JS | 在跑（上报了 `pdf-manual`） | — |
| 注入工具栏 | **不在** | — |

→ webview 没被隐藏/销毁/遮住，是「页面没画出来 + 工具栏没挂上」。四条成因与修法：

1. **工具栏只等 `DOMContentLoaded`**。验证页/被拦文档不触发它，用户连地址栏都没有。
   改成：`mountNow()` 立即挂一次，再于 250/1200/4000 ms 重试，同时保留 DOMContentLoaded 钩子。
2. **`challengePresent()` 只认正文关键词**。Cloudflare 插页正文在挑战脚本注入前是空的，
   标题已是「请稍候…」。改成：标题（请稍候 / Just a moment / Attention Required …）
   与挑战标记（`challenge-platform`、`challenges.cloudflare.com`、`cf-turnstile-response`、
   `#challenge-form`、`cf-chl*`）都算验证中。
3. **空白挑战页被当成文章页**（只按 host 匹配），16 次尝试全打在它上面。
   改成：`readyState === 'loading'` 或正文没有任何可交互内容时只等待，约 30 秒后才退回人工。
4. **`pdf-manual` 被当成「已进入 PDF 预览器」并对普通文章页施加整页位移**（与 2026-09-23
   ScienceDirect 那次白屏同源）。改成：只有顶层文档确实是 PDF 才开位移，否则如实报告
   「未能自动识别正文下载入口」。

Science 在本机环境返回的是 Cloudflare「正在进行安全验证／请验证您是真人」插页
（用真实 Edge 独立复现过，截图见 beta6 发布说明的描述）。

## 产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `dist/iBM Lab Agent_0.5.5-beta6_x64-setup.exe` | 259,092,496 | `4be598d93f8e796d11a00786391be224ea0e4b1b50914d032532b098b829fb40` |
| `dist/ibm-lab-agent-v0.5.5-beta6-linux.tar.gz` | 24,404,063 | `63be7680aa13ff7e4ca90dbc6f2d3e4e28e89b9d6bad2e8367c8892fb6b54486` |

两份产物均由 `3f587d2` 构建；`release-report.json` 为 `publishable: true`；
`verify-package.ps1 -InstallerPath ... -WebSmokeTest` 退出码 0。

## 下一步执行顺序

1. 安装 `dist/iBM Lab Agent_0.5.5-beta6_x64-setup.exe`，复现同一路径并确认三件事：
   - 侧栏停在验证页时**能看到我们的工具栏**（地址栏、关闭按钮）；
   - 日志里是「正在验证访问」而不是「已进入 PDF 预览器」；
   - 手动过验证后扫描能继续找入口；普通文章页不再被整页位移。
2. 试其他出版社（Nature、Springer、Wiley、ScienceDirect、ACS、RSC、IEEE），确认没有因为
   第 3 条（"没加载完不计数"）导致自动化不再点击 —— 若有，把该站的正文特征补进
   `publisherContentReady()` 的判据，而不是放宽整条闸门。
3. 更新 `docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`（有实测证据的才从 `pending` 改写）。
4. 推送 `release-0.5.0` 并把 `main` 快进到同一提交。

## 排查要点

- **白屏先量三件事**：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数。`H:\build\combo-probe.ps1`
  就是这套探针（每 1.5 秒记一次 z 序、像素归属、颜色数）；主 WebView 必须同时测，作为
  "同一方法能看到内容" 的对照，否则无法区分「真的没画」和「PrintWindow 抓不到 WebView2」。
- `PrintWindow(hwnd, hdc, 2)` 对 WebView2 有效（PW_RENDERFULLCONTENT），但一定要带对照。
- verification：验证文案消失后脚本应自动继续，不要取消任务。
- clicked：等 WebView2 `DownloadStarting`；进入 manual 后再用 `lab_browser_observe` 或
  `lab_browser_save_current_pdf`。
- SI queued：检查正文任务是否 completed / failed / expired / cancelled，以及
  `webvpn_status.pendingTaskId` 是否残留。
- 不要读 `lab_captures.json` 或 `webvpn-downloads` 推断 Agent 状态，只用下载状态工具和
  `webvpn_status`。
- 重新出 Windows 包时若 `tauri-nsis` 很快失败，先看 stderr 尾部的 `error[E....]`：那是 Rust
  编译错误，Node 测试不会报。
- 生成的 `.ps1` 必须纯 ASCII：PS 5.1 按 ANSI 解析无 BOM 的 UTF-8，中文注释会让脚本
  直接 ParserError（本轮的探针就踩过）。

## 尚未完成

- beta6 安装后的人工验收（上面第 1 步）。
- 其他出版社的回归确认（第 2 步）——尤其是第 3 条闸门是否过严。
- 八家出版社的已登录 iWAN 标定（全部仍是 `pending`）。
- 把 beta6 的提交与产物同步到远端。
