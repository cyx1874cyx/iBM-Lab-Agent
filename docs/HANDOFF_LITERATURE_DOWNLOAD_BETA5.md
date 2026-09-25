# 文献下载流程交接：0.5.5-beta5

更新时间：2026-09-25

## 当前代码状态

- 工作目录：/root/ibm-lab
- 分支：release-0.5.0
- 当前提交：74d637a（beta5 修复已提交）
- 工作树：干净
- main 和远端 release-0.5.0 仍在 d32c33a；74d637a 尚未推送
- 版本号已统一为 0.5.5-beta5

## 本轮已经修复

1. 人机验证：验证页不再停止自动扫描；页面自行通过后从 verification 回到 searching。
2. 下载点击：不再跳转内部状态协议或强行设置 download 属性；真实下载事件才进入 downloading。
3. 空白弹窗：about:blank 和其他非 HTTP(S) 新窗口不会覆盖唯一文献页面。
4. 正文与 SI 队列：正文结束、失败、取消或过期后清理 pending，SI 才接管；状态工具增加 nextAction，区分 wait-and-poll、observe-or-save-pdf、observe-or-click、ask-user 和 done。

## 已验证内容

- node --test tests/unit/webvpn-commands.test.mjs：17 项通过。
- 覆盖自动验证恢复、点击后持续扫描、真实下载后停止扫描、空白弹窗拦截。
- node scripts/linux-release-preflight.mjs：通过；五道闸门全绿，归档体积 23.3 MB。
- beta4 Windows 包的 Web 冒烟通过；beta5 尚未在 Windows 打包。
- beta5 尚未做已登录 iWAN 的真实出版社页面验收。

## 下一步执行顺序

1. 推送 74d637a，并把 main 快进到同一提交。
2. 使用 bash scripts/windows-release-from-wsl.sh --ref 74d637a 打包 beta5；预期 bundled-python: reuse。
3. 检查 Windows 11 阶段、NSIS 包体和 verify-package.ps1 -WebSmokeTest。
4. 安装 beta5，在已登录 iWAN 环境实测正文验证恢复、PDF 原生保存、正文排队 SI、SI 自动接管和空白弹窗。
5. 更新 docs/PUBLISHER_DOWNLOAD_CALIBRATION.json；未实测出版社保持 pending。
6. 生成 Linux 归档、dist/SHA256SUMS 和 beta5 发布说明，成功后再推送远端分支。

## 排查要点

- verification：只要验证文案消失，脚本应自动继续，不要取消任务。
- clicked：等待 WebView2 DownloadStarting；进入 manual 后再用 lab_browser_observe 或 lab_browser_save_current_pdf。
- SI queued：检查正文任务是否 completed、failed、expired 或 cancelled，以及 webvpn_status.pendingTaskId 是否残留。
- 白屏：检查是否出现 about:blank 新窗口或旧的 ibm-webvpn://automation/clicked 导航。
- 不要读取 lab_captures.json 或 webvpn-downloads 推断 Agent 状态，只使用下载状态工具和 webvpn_status。

## 尚未完成

- beta5 Windows 安装包、SHA256、Linux 归档和安装版 WebView2 验收。
- Nature、Springer、ScienceDirect、Wiley 正文及至少一例 SI 的 iWAN 标定。
- 将 74d637a 与 beta5 产物同步到远端。
