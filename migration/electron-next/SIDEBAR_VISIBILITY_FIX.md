# 文献获取侧栏可见性修复（2026-10-06）

问题：浏览器 guest 和捕获任务仍存在，但右侧栏已收起或对应课题会话不在当前界面；原来的 focus 只使主窗口前置，服务便返回 shown=true。页面状态不能证明用户看见了文献浏览器。

修复：

- 复用浏览器前，通过主界面恢复对应课题会话、选中原 Browser tab 并展开侧栏，不创建额外浏览器。
- 主界面确认对应 guest 的可见性及有效尺寸后，通过仅限应用主文档的 IPC 回执完成 focus；运行时等待回执，不再提前返回 shown=true。
- 未能展示侧栏时报告明确错误，启动流程停止；收到登录/人机验证状态时再次显示侧栏，供用户操作。
- 发布前核对 UI 独立包与生成的客户端一致，并验证独立包注册名称，防止发布旧界面文件。

正式交付来源：`a8b75e233b0182651a69d05aac8915f6b6816a2d`。其后的验收脚本增加验证页场景，不改变产品代码。

验证：823 项测试，815 通过、8 跳过、0 失败；客户端及七个域包生成一致性检查通过。

最终打包应用验收：`outputs/electron-next-sidebar-visibility/packaged-sidebar/run-95n9D6/verification.json`，ok=true。实际 NEXT Browser UI、Electron guest 与隔离课题验证了：首次打开、收起后复用、AI 重建任务、验证页重新展开、附件上传、PDF/SI 下载归档、会话隔离、重启后的 cookie 保留及宠物状态。已查看验证页可见截图。出版社与验证页面均使用本地固定样例，不使用真实机构凭据，不声称通过真实 Cloudflare 验证。

唯一交付目录：`outputs/electron-next-sidebar-visibility/verified-release-windows/dist/`。此前 `release-windows`、`final-release-windows` 为未通过验收的中间构建，禁止交付。安装包哈希及文件大小记录于同一输出根目录的 `delivery.json`。

更新时完全退出 Electron 版（含托盘），运行新安装包安装到原目录。保留应用数据。人机验证与机构登录由用户在侧栏完成。
