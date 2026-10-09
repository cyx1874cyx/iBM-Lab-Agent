# 文献浏览器的人机验证保护

重复打开同一文献时，若当前页已识别人机验证，桌面浏览器保留原来的文档和页面状态。对 DOI 跳转后的验证页，也记录入口地址以免重试入口时重新导航。同地址并发导航共用一次加载。执行已排队的 Agent 点击或备用入口跳转前，重新查询浏览器状态；等待真人验证时暂停这些操作，保留捕获任务。

Cloudflare 的 `cf-mitigated: challenge` 主文档响应作为等待真人验证的证据，优先于 HTTP 403 权限判断。跳转或加载新文档会清除旧响应标记；弹出窗口响应不会覆盖主文档状态。异步页面检查只更新相同页面序号，避免旧检查覆盖新页面。

本修复不保证内嵌浏览器能通过所有网站的 Cloudflare 验证。Cloudflare 支持情况、网络稳定性及网站配置仍可能导致循环。需要问题链接和发生位置来复现。验证由使用者完成，程序不代点击、不伪造指纹、不搬运浏览器登录凭证。

验证：`tests/unit/challenge-navigation.test.mjs` 覆盖重复导航、并发加载、跳转后的入口重试、查询参数区别、验证完成后正常导航、官方响应标记及主窗口与弹出窗口隔离。桌面验收使用本地合成响应，验证重复打开时不增加网络请求或页面序号；并非真实 Cloudflare 通关测试。

官方资料：
- https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
- https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/

## ScienceDirect 实站诊断与产品名称修正（2026-10-09）

测试文章：`S0021929021005765`。所有验证均由用户亲自完成。Chrome/Edge 能进入；原正式侧栏、新建独立会话的正式侧栏及去掉调试端口的正式侧栏均循环。同进程、同会话的简化窗口也循环。独立诊断应用使用同一 Electron 44 / Chromium 152 时能进入，允许或拒绝网页存储权限的两侧均能进入。

将独立诊断应用的原生名称、版本设为正式应用后，两侧均循环。拆分变量后，`iBM Lab Agent / 0.0.1` 循环，`ibm-sciencedirect-diagnostic / 0.5.8-rc.1` 可进入。改用真实产品的短名称 `iBM Lab` 后，完整正式侧栏在原诊断会话中由用户验证进入文章页。证据支持名称相关的识别误判；并不能说明 Cloudflare 的具体内部规则。

构建代码将 `app.setName()` 设为 `iBM Lab`。该名称由 Electron 自然用于原生浏览器身份；不设置自定义 User-Agent、不假装 Chrome、不改变真实内核版本、不修改验证脚本。安装器的 appId、productName、快捷方式和显式设置的 userData/sessionData 路径沿用现有配置。此结果仅代表本次链接及测试环境。

曾排查 [Electron #19600](https://github.com/electron/electron/issues/19600) 报告的后台请求身份不一致。本地真实 Electron 测试中，页面、Worker、Service Worker 的 navigator.userAgent 和 HTTP User-Agent 均一致，该历史问题未复现，因此没有添加身份覆盖逻辑。
