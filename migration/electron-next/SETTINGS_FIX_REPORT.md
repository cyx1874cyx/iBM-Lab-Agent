# 修复持续“正在加载设置…”

**2026-10-05：该包已被 `outputs/electron-next-tool-fix/windows/dist` 的工具运行修复包替代。新包保留本次设置修复，并处理重复内核模块造成的 prepare 错误。请参见 `TOOL_RUNTIME_FIX_REPORT.md`。**

2026-10-04。产品修复提交 `8e7acc4`；固定 iBM、NEXT、内核与 Electron 版本不变。

用户诊断显示 Host 为 ready，无运行时 failure。本机独立环境复现：科研插件和通用设置能加载，但顶部保留 onboarding 的 loading fallback，桌面设置和 NEXT 的窗口样式没有注册。

封装脚本曾把根运行时的 npm 包名从 `dsh-desktop-next` 改成 `ibm-lab-agent-electron`。NEXT 的 profile 按固定包身份加载 Desktop client；改变名字后，该客户端的首次启动引导、桌面设置、原生窗口样式未进入预期插件注册链路。preload 仍发布 `dshDesktopSetup`，官方账号引导检测到该桥后一直等待缺失的 `onboarding.desktop.before`，显示“正在加载设置…”。只把同一运行时的包名恢复，问题消失，桌面设置也出现，确认了根因。

修复保留内部包名。安装 appId `cn.ibm.lab-agent.electron`、productName `iBM Lab Agent Electron`、程序显示名和独立数据目录保持原有迁移设计。只修改自己的封装副本，固定 NEXT 源 checkout 未修改。首次初始化代码、科研插件及数据格式没有变化，已经初始化的同版本 home 不重新写入归档或初始化标记。

## 补充验收

- 最终封装目录真实 Electron：首次启动引导可见，不出现永久加载提示。
- 正常启动：实际鼠标点击“桌面设置”，显示当前 `ibm-lab` Profile；原生状态为 ready，无 renderer 错误。
- 使用旧错误包生成的独立测试 profile：初始化结果为 false，修复包正常加载桌面设置，不需要重建 profile。
- 实际鼠标点击课题选择菜单及品牌入口，面板可打开、关闭和再次打开，原生菜单留白为 40px。先前 CDP 鼠标事件的失败也随缺失 Desktop client 的恢复消失。
- 离线 Python、七个领域 provider、课题记忆跨 Host 重启检查通过。
- 全量 804 项：796 通过、8 跳过、0 失败。

首次 P6 验收漏掉永久 loading fallback，故不能把先前的“课题面板通过”当作桌面启动完整验收。已增加 `verify-desktop-settings.mjs`，强化 `verify-installed-shell.mjs`，要求 loading 消失、Desktop section 注册并成功加载，而不是仅检查面板文本。首次 P6 记录保留并标记为被修复包替代。

## 安装与范围

修复安装包：`outputs/electron-next-settings-fix/windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`，437,051,716 字节，未签名。

SHA-256：`d8ad9573f8b3dadd28cb540c060da91cc03a1e9d348e4aa15c3943df18c4ccf3`。

先从托盘退出正在运行的新版，再把修复安装包安装到原位置。无需先卸载，也不要删除数据目录。运行版本号仍为用户固定的 0.5.8-rc.1，通过本次包路径和哈希区分。旧 Tauri 版继续独立保留。

没有修改、重置或读取实际用户 profile 的内容，没有关闭实际用户程序。NSIS 安装/卸载证据沿用 P6；本轮验证了最终 unpacked payload，未在正在运行的用户安装上执行覆盖。仍为未签名迁移测试版；历史课题迁移、原生保存弹窗及完整 P4/P5 工作流验收范围不因本次修复而完成。

重现：先按 P6_REPRODUCE 生成封装，使用固定 81 个归档；运行 `verify-desktop-settings.mjs --app <resources/app> --resources <resources> --executable <exe> --output <独立验证目录>`。加 `--first-run` 验证引导；用 `--home` 复用位于验证目录父级内的旧测试 home。开发封装目录搭配官方 Electron 时加 `--staged`。详细结果见 `SETTINGS_FIX_VERIFICATION.json`。
