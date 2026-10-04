# Electron NEXT Windows 测试安装包

日期：2026-10-04。交付范围：可安装的 Windows x64 迁移测试版本；不代表 P4/P5 全部人工交互已验收。

版本固定为 iBM Lab Agent 0.5.8-rc.1、DSH NEXT v2.0.17-next（838ba60fd79362087c0a0d134efee671c284786a）、内核 v0.2.0-rc.2（639ed015397290b3745d163aafe02ffee4aa3f84）、Electron 44.0.0、Python 3.12.11。产品源代码提交为 0400d04；随后仅补充验证与交付记录。

## 安装方式与隔离

NSIS 提供用户级安装、安装位置选择、桌面和开始菜单入口。程序名为 `iBM Lab Agent Electron`，程序身份为 `cn.ibm.lab-agent.electron`。默认科研数据目录为 `%LOCALAPPDATA%\iBM-Lab-Agent-Electron\dsh`；保留旧版程序及其数据，不自动复制课题、API 密钥或机构登录状态。首次使用创建空白环境，历史数据导入仍待后续实施。

安装包包含固定 NEXT 运行时、81 个离线依赖归档、七个独立激活插件、共享实现库、技能和 Python 环境。首次启动验证依赖归档的字节数与 SHA-256，再写入独立 profile；重复初始化不覆盖现有数据。七个插件仍依赖同一个固定实现库，不能据此宣称已完成物理资源拆分或瘦身。

仅在封装副本中修改 NEXT 的程序名及更新开关，并加入自己的初始化入口；固定 NEXT 源目录保持原样。当前测试版关闭自动更新，避免获取 DSH 产品的安装包。保留 Electron RunAsNode，供内核及固定包管理器使用。

## 验证

- 全量回归：804 项，796 通过、8 跳过、0 失败；`outputs/electron-next-p6-delivery-tests.log`。
- 81 个归档通过清单、哈希、路径、链接和固定依赖验证；七个领域包共有 39 个不重复 Host 行。
- 独立中文路径首次初始化、重复启动、真实 Electron Node Host、六个领域能力和科研桌面 provider 检查通过；课题记忆跨进程重启保持。
- 随包 Python 可从迁移后的安装位置导入 PyMuPDF、NumPy、SciPy、Pillow、lxml、python-pptx，依赖路径均在随包资源内。
- 实际静默安装、安装目录运行及卸载检查使用工作区内专用目录；卸载保留独立科研数据，不接触旧版。
- 全屏面板采用 Windows 原生菜单的 40px 留白。React portal 挂载在 body，因此偏移变量放在 body 并在关闭时恢复；验证覆盖打开、关闭清理及再次打开。

最终制品路径、哈希和本机安装验证记录见同目录 `P6_VERIFICATION.json`。详细重现步骤见 `P6_REPRODUCE.md`。

## 尚未验收的范围

安装包未签名，是迁移测试版本。已在本机验证，尚未完成干净 Windows 虚拟机矩阵及全部权限情形验收。真实鼠标操作与系统原生保存弹窗尚未完成完整人工验收；用户已要求暂缓保存弹窗。自动化面板验证使用 DOM click，因为 CDP 鼠标事件曾误送到 NEXT 的原生设置视图，不将其计为物理鼠标通过。

历史课题迁移、完整长文档路由、证据锁交互与浏览器让位的全面对齐仍未完成。Origin、MestReNova 和 LibreOffice 是外部软件，未包含在安装包；Office 的 PDF 渲染依赖本机 LibreOffice。PDF/SI 的真实机构登录捕获已在 P4 验证，但不复制该登录状态进入新安装。
