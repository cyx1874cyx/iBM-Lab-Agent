# iBM Lab Agent

iBM Lab Agent 是面向科研课题组的本地科研工作台，将课题对话、文献获取、全文阅读、实验设计、科研产物和版本化核心记忆放在同一工作区。

当前候选版本为 **v0.6.0-rc.1**，桌面端采用 **Electron 44 + DSH NEXT v2.0.17-next**，科研服务以 DeepSeek Harness 插件运行。完整更新记录见 [发布说明](docs/releases/v0.6.0-rc.1.md)。

**[下载 Windows x64 安装包](https://github.com/cyx1874cyx/iBM-Lab-Agent/releases/download/v0.6.0-rc.1/iBM-Lab-Agent-0.6.0-rc.1-Electron-x64-Setup.exe)** · [GitHub Release](https://github.com/cyx1874cyx/iBM-Lab-Agent/releases/tag/v0.6.0-rc.1) · [GitLab Release](https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/releases/v0.6.0-rc.1) · [SHA-256 校验清单](https://github.com/cyx1874cyx/iBM-Lab-Agent/releases/download/v0.6.0-rc.1/SHA256SUMS-v0.6.0-rc.1.txt)

## 本版更新

- **桌面宠物语录**：单击头像随机弹出一条语录，多条语录避免连续重复；在「iBM 插件设置 → 桌面宠物」按行添加并保存。语录、显示状态和位置在重启后保留，拖动头像可移动宠物。
- **文献浏览器归属修复**：从课题的新对话发起文献获取，浏览器和捕获任务绑定发起对话；同一课题里的不同对话保留各自侧栏，PDF 和 SI 归档保留来源对话。
- **全文阅读与成果预览**：采用 PDF.js 连续分页，支持原文、译文和全屏双栏对照，以及页码、缩放、滚动同步；精读笔记和 PPT 生成时归档预览 PDF，重复打开可复用。
- **文献访问与任务运行**：保留出版社验证页处理、PDF 下载捕获修复、课题工作区内的 PPT 渲染与科研运行时改进。
- **版本统一与升级**：科研插件及七个分域包统一为 `0.6.0-rc.1`。从本项目上一版 Electron `0.5.8-rc.1` 覆盖升级时更新插件和归档依赖引用，保留配置、课题数据及宠物设置，并备份被替换的插件。

## Windows 安装与使用

1. 下载本页链接中的 Windows x64 安装包；可在「下载」旁的校验清单中核对 SHA-256。
2. 运行安装程序并选择安装目录。已有 Electron 版可选择原安装目录升级。
3. 启动应用，在设置中配置自己的模型服务和 API Key。
4. 新建课题或进入已有课题，在课题工作区中开启科研对话。

安装包包含 Electron、科研插件、Python、固定版本的 Nature Skills、Mnova MCP 及离线查看器。课题数据默认位于 `%LOCALAPPDATA%\iBM-Lab-Agent-Electron\dsh`，与安装目录分离；模型密钥由用户配置。

Origin 自动化需要本机安装 Origin，Mnova GUI 工作流需要已安装并授权的 MestReNova。文件型 NMR 分析可独立执行。

## 主要能力

| 模块 | 当前实现 |
|---|---|
| 课题工作台 | 独立工作区、课题对话、版本化核心记忆、科研产物索引与任务状态 |
| 文献工作流 | 多源检索、去重、RIS 导出、DOI 核验、PDF/SI 捕获、精读报告、文献 PPT 与人工审核 |
| 全文与成果阅读 | PDF 连续分页、原文与译文对照、双屏同步、精读笔记和 PPT 的归档 PDF 预览 |
| 合成与实验设计 | 靶标、路线、逐步条件、结构式、来源证据、可行性检查、版本修订与人工锁定 |
| 化学与高分子计算 | 化学实体及来源登记、分子量与聚合物指标计算、实验方案审核 |
| NMR 与表征 | FID/ZIP 和结构文件提交、预检、标峰、报告、归档与置信度记录 |
| 模板与文档 | 全局默认模板、阅读笔记与 PPT 模板版本化、Office/PDF 转换及产物哈希 |
| 桌面宠物 | 任务状态、窗口拖动、显示控制、用户自定义随机语录 |

文献访问使用开放来源、用户已建立的学校 WebVPN 会话或本机授权网络。PDF/SI 捕获、科研产物与人工审核记录统一归档到对应课题。

## 当前版本锁定

| 组件 | 版本 |
|---|---|
| iBM Lab Agent 及分域包 | 0.6.0-rc.1 |
| DSH NEXT 桌面基座 | 2.0.17-next；commit `838ba60fd79362087c0a0d134efee671c284786a` |
| DeepSeek Harness 内核 | 0.2.0-rc.2 |
| Electron | 44.0.0 |
| 安装包 Python | 3.12.11 |
| PDF.js | 5.4.624 |

精确依赖与来源记录见 [Harness 锁定清单](harness.lock.json)、[Vendor 锁定清单](vendor.lock.json)、[分域插件说明](packages/README.md) 和安装包中的 `resources/release.json`。

## 源码开发与验证

源码要求 Node.js 24 或更高版本。安装依赖并构建客户端：

```bash
corepack pnpm install --frozen-lockfile
node scripts/build-client.mjs
node scripts/build-client.mjs --check
node scripts/check-preset-exports.mjs
node --test "tests/unit/*.test.mjs" "tests/integration/*.test.mjs"
node scripts/regression/run.mjs
```

桌面发行采用本地 Electron/NSIS 构建，安装包上传到 GitHub 和 GitLab 的 Release 页面。打包与校验方式见 [Electron 发布说明](docs/releases/v0.6.0-rc.1.md)。旧 Tauri 代码保留在 `desktop/`，历史安装流程见 [desktop/README.md](desktop/README.md)。

本版验证覆盖客户端一致性、版本一致性、源码测试、隔离数据升级、实际桌面宠物和同课题新对话的文献获取。安装包内部归档校验与最终 SHA-256 随发布产物提供。

## Linux 与其他资料

Linux 源码部署方法见 [Linux 安装说明](docs/LINUX_RELEASE.md)；本次桌面 Release 提供 Windows x64 安装包。

- [文献下载操作手册](docs/LITERATURE_DOWNLOAD_CHAIN.md)
- [阅读材料与预览机制](docs/reader-material-preview.md)
- [出版社验证处理记录](docs/cloudflare-verification.md)
- [PPT 渲染工作区隔离](docs/ppt-render-sandbox.md)
- [Electron 迁移计划与基线](docs/ELECTRON_MIGRATION_PLAN.md)
- [历史 v0.5.8-rc.1 发布说明](docs/releases/v0.5.8-rc.1.md)
