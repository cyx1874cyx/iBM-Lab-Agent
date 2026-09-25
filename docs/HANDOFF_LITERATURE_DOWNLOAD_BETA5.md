# 文献下载流程交接：0.5.5-beta5

更新时间：2026-09-25（beta5 已出包，剩已登录 iWAN 验收与推送）

## 当前代码状态

- 工作目录：/root/ibm-lab
- 分支：release-0.5.0
- 提交：
  - `74d637a` beta5 功能修复（**编译不通过**，见下）
  - `30269c4` 修编译错误，**beta5 产物由它构建**
  - `d520da6` 标定文件指向 beta5
  - 之后是发布说明与本文件的更新提交
- 工作树：干净
- 远端：`origin/release-0.5.0` 与 `main` 仍在 `d32c33a`，本地领先若干提交，**尚未推送**
- 版本号已统一为 0.5.5-beta5

## 出包过程中发现并修掉的问题

`74d637a` 在 `desktop/src-tauri/src/webvpn.rs` 的 `on_download` 闭包里写了
`push_capture_ball(&download_app, webview)`：Tauri 交给该闭包的 `Webview` 是按值持有的，
而函数签名要求 `&Webview`，桌面 crate 编译失败（E0308）。

- 这条**只有 Rust 构建能看到**，`node --test` 全绿也照样漏过；beta5 此前从未在 Windows 出包，
  所以一直没暴露。
- `30269c4` 按编译器提示改为 `&webview`，重新完整出包成功。
- 教训：beta5 这类"改 Rust 行为 + 只跑 Node 测试"的提交，必须在合并前至少跑一次
  `desktop/src-tauri` 的 Rust 构建，否则错误会一路留到 tauri-nsis 阶段。

## 本轮已完成

1. WSL 发布预检五道闸门全绿（701 用例 699 通过 / 2 跳过，回归 11/11，lint 0 错 87 警，
   归档 23.3 MB 在阈值内）。
2. `bash scripts/windows-release-from-wsl.sh --ref 30269c4` 出包成功，
   `release-report.json` 为 `publishable: true`，10 个阶段全过。
   `bundled-python` 按预期走 reuse（输入指纹未变，跳过重建）。
3. 安装包另行跑 `verify-package.ps1 -InstallerPath ... -WebSmokeTest`，退出码 0：捆绑 DSH
   服务启动、捕获交接路由、Ketcher 静态资源检查均通过。
4. 生成 Linux 归档与 `dist/SHA256SUMS`（两份产物都在里面）。
5. 写完 `docs/releases/v0.5.5-beta5.md`，并把 `docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`
   的 `buildUnderTest` 指向本版、把 beta5 新信号加进待实测清单。
   八家出版社的 `authenticatedIwanVerification` **全部仍是 pending**。

## 产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `dist/iBM Lab Agent_0.5.5-beta5_x64-setup.exe` | 259,091,601 | `a82208920adc69104fa380259b26da6138753c76e687988b851793d06e16c7a2` |
| `dist/ibm-lab-agent-v0.5.5-beta5-linux.tar.gz` | 24,400,704 | `a84aaea46d33346534c500dbaa2a7482f6638d1789cd3b35b77619fee389f1f1` |

## 下一步执行顺序

1. 在已登录 iWAN 的环境安装 `dist/iBM Lab Agent_0.5.5-beta5_x64-setup.exe`（Windows 11），
   实测正文验证恢复、PDF 原生保存、正文排队 SI、SI 自动接管和空白弹窗。
2. 按实测结果更新 `docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`：把确有证据的出版社从
   `pending` 改写为结论（记录最终 URL、可见入口文案、元素类型、自动化阶段是否有
   `DownloadEvent::Requested`、落盘路径与 SI 是否多文件）；没有实测的一律保持 `pending`。
3. 推送 `release-0.5.0`，并把 `main` 快进到同一提交（按约定：产物验证通过后再一起推）。

## 排查要点

- verification：只要验证文案消失，脚本应自动继续，不要取消任务。
- clicked：等待 WebView2 DownloadStarting；进入 manual 后再用 lab_browser_observe 或 lab_browser_save_current_pdf。
- SI queued：检查正文任务是否 completed、failed、expired 或 cancelled，以及 webvpn_status.pendingTaskId 是否残留。
- 白屏：检查是否出现 about:blank 新窗口或旧的 ibm-webvpn://automation/clicked 导航。
- 不要读取 lab_captures.json 或 webvpn-downloads 推断 Agent 状态，只使用下载状态工具和 webvpn_status。
- 重新出 Windows 包时若 `tauri-nsis` 很快失败，先看 stderr 尾部的 `error[E....]`：
  那是 Rust 编译错误，Node 测试不会报。

## 尚未完成

- 已登录 iWAN 的出版社实机验收（Nature、Springer、ScienceDirect、Wiley 正文及至少一例 SI）。
- 安装版 WebView2 的桌面界面人工验收。
- 把本地提交与 beta5 产物同步到远端（推送 release-0.5.0 + 快进 main）。
