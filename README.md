# iBM Lab Agent

iBM Lab Agent 是面向科研课题组的本地科研工作台。项目以
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件形式运行，
不修改 Harness 核心，并集成固定版本的
[nature-skills](https://github.com/Yuan1z0825/nature-skills)。

当前稳定版本为 **v0.5.0**。本版本聚焦文献、合成路线、
表征登记与 Windows 桌面发布闭环，首要应用方向为聚前药与高分子材料研究。

**[下载 Windows x64 安装包](https://github.com/cyx1874cyx/iBM-Lab-Agent/releases/download/v0.5.0/iBM.Lab.Agent_0.5.0_x64-setup.exe)** ·
[查看 v0.5.0 Release](https://github.com/cyx1874cyx/iBM-Lab-Agent/releases/tag/v0.5.0) ·
[SHA-256 校验文件](https://github.com/cyx1874cyx/iBM-Lab-Agent/releases/download/v0.5.0/SHA256SUMS-v0.5.0.txt)

安装包 SHA-256：`392F5DB567B0D2335376C46433DBFBBFA38FD65B97B20795EB59E91F294D6CF0`

## 主要能力

| 模块 | 当前实现 |
|---|---|
| 课题工作台 | 一个课题对应一个独立 workspace；会话共享课题绑定、版本化核心记忆和科研产物索引 |
| 文献工作流 | 多源检索、去重、RIS 汇总、DOI 核验、PDF/SI 捕获、精读报告、文献 PPT 与人工审核；支持软件内 WebVPN、iWAN 状态监视和出版社下载规则 |
| 合成路线 | 靶标、路线、逐步条件、结构式、开放来源证据、可行性检查、版本修订与人工锁定；支持单步骤全宽翻页和结构统一渲染 |
| 化学与高分子计算 | 化学实体及来源登记、分子量与聚合物指标计算、实验方案审核、CAS 授权边界 |
| NMR 与表征 | 直接提交 FID/ZIP 与 MOL 等结构文件，Agent 自动建任务、预检、标峰、生成报告并归档；登记结构判断与 High/Medium/Low 置信度，支持保留历史的重新登记 |
| 绘图登记 | 按课题记录主题、日期、产物引用和来源，可修改、删除并检查文件状态 |
| 模板与文档 | 阅读笔记和 PPT 模板版本化；DOCX/PPTX/XLSX/PDF 转换、预览、哈希与 provenance |
| 桌面集成 | Windows Tauri 客户端，内置 Node、DSH、Python、Origin MCP、Mnova MCP 与离线查看器 |
| 质量与安全 | 原始数据不可覆盖、产物 SHA-256、人工审核门禁、路径边界和回环接口校验 |

内置的 19 个 Nature Skills 负责检索、阅读、写作、引用、绘图和学术交付等内容流程；
本插件负责课题组织、工具路由、任务状态、模板、版本、产物登记和安全门禁。

## 架构

```text
用户
  └─ DSH Web / Windows Desktop
       ├─ iBM 课题工作台与 lab-research 预设
       ├─ 19 个固定版本 Nature Skills
       ├─ 文献、合成、表征、模板与文档服务
       ├─ Origin / Mnova / LibreOffice / RDKit 等本地工具
       └─ 课题 workspace、版本快照与 ArtifactProvenance
```

所有课题数据默认保存在用户自己的 DSH 数据目录。文献访问仅使用开放来源、用户已建立的
学校 WebVPN 会话或本机 iWAN 网络；浏览器捕获只接收用户已获授权的 PDF/SI。项目不会
自动执行实验、采购，也不会绕过机构或 CAS 授权边界。

## Linux 安装

支持 Ubuntu/Debian 的 x86_64 与 arm64。稳定安装命令固定到 **v0.5.0**，在用户目录中创建
隔离的 Node、DSH、pnpm 与 Python 环境，并可直接启动 Web 界面：

```bash
curl -fsSL https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/raw/v0.5.0/install.sh | bash -s -- --start
```

系统包安装阶段会按需请求 `sudo`；模型密钥不包含在发行包中，请在首次打开 DSH 后配置。
常用命令：

```bash
ibm-lab-agent status
ibm-lab-agent logs -f
ibm-lab-agent doctor
ibm-lab-agent restart
ibm-lab-agent stop
ibm-lab-agent dsh --help
```

重新运行安装命令即可幂等升级；使用 `--ref <tag|branch|commit>` 可指定版本。安装器在新
release 通过验证后才切换 `current`，不会直接覆盖上一个可运行版本。完整说明见
[`docs/LINUX_RELEASE.md`](docs/LINUX_RELEASE.md)。

从 Windows 更新 Linux 服务器，可运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-server.ps1 -Ref main
```

也可双击仓库根目录的 `update-server.cmd`，按 SSH 提示输入凭据。脚本不会保存密码。

## Windows 桌面端

`desktop/` 是 Tauri 2 桌面客户端。运行时与用户数据隔离，服务只监听本机回环地址；
API Key 使用当前 Windows 用户的 DPAPI 加密保存。Origin 自动化需要已安装 Origin，
Mnova GUI/Verify 工作流需要已安装并授权的 MestReNova；文件型 NMR 分析不依赖 Mnova GUI。

正式安装包由本地统一发布流水线生成并复验，再直接上传到 GitHub Release，不依赖 GitHub
Actions 构建。v0.5.0 安装包大小为 `227,363,800` 字节。

发布构建统一使用：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\desktop\scripts\build-windows-release.ps1 `
  -SourceRoot . -NodeExe (Get-Command node).Source
```

该入口依次执行源码测试、回归、预设检查、lint、运行时准备、Web 冒烟、Tauri/NSIS
构建和安装包验证，并输出阶段日志与 `release-report.json`。首次完整构建需要 Rust stable、
Microsoft C++ Build Tools、Node 24 及可访问的依赖源。不要并发启动多个资源准备或发布任务。
详细说明见 [`desktop/README.md`](desktop/README.md) 和
[`desktop/docs/release-checklist.md`](desktop/docs/release-checklist.md)。

## 源码开发

基础要求：Node.js 20 或更高版本；Windows 桌面端还需要 Rust stable 与 MSVC 工具链。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build:client
corepack pnpm run check:preset-exports
corepack pnpm test
corepack pnpm run test:browser
corepack pnpm run regression
corepack pnpm run lint
```

桌面端源码测试：

```powershell
cargo test --manifest-path .\desktop\src-tauri\Cargo.toml --locked
```

Tauri 默认要求已准备完整打包资源。只做源码级 Rust 诊断时可临时覆盖资源清单；正式安装包
必须通过统一发布脚本生成，不得清空资源清单。

手动部署到已有 DSH 环境：

```bash
node scripts/dev-link.mjs
node scripts/install.mjs --strict
node scripts/lab-doctor.mjs
dsh plugin --profile ibm-lab add "$PWD"
dsh --profile ibm-lab
```

新会话使用 `lab-research` 预设。每个课题的核心记忆同步到其 workspace 根目录下的
`项目记忆.md`；更新通过版本化工具完成，不应直接把整份记忆重复塞入对话输入框。

## 当前版本锁定

| 组件 | 版本 |
|---|---|
| iBM Lab Agent | 0.5.0 |
| DeepSeek Harness | 0.1.5-rc.1 |
| Windows Node | 24.16.0 |
| Linux Python | 3.12.11 |
| Windows bundled Python | 3.11 |
| Origin MCP | 0.1.4 |
| Mnova MCP | 0.3.1 |
| Nature Skills | commit `c171989db699bd601d4373912b3fb8db96ecc95b` |

精确版本、哈希和依赖清单分别记录在 `runtime/versions.env`、`harness.lock.json`、
`vendor.lock.json` 与 `desktop/docs/release-manifest.json`。

## 验证状态

v0.5.0 于 2026-09-17 完成正式发布验证：

- Node 单元与集成测试 **402/402** 通过；
- 回归套件 **11/11** 通过；
- 客户端一致性、预设导出、ESLint 和真实浏览器 Ketcher 验收通过；
- 固定版本 Nature Skills、Harness 依赖、Python 锁定、NMR、合成与任务链路验证通过；
- 桌面运行时准备、Web 冒烟、Tauri/NSIS 构建和最终安装包复验通过；
- Release 安装包的 GitHub 远程摘要与本地 SHA-256 一致。

真实 Origin/Mnova GUI 操作和机构授权下载仍需在具有相应商业软件、许可证及校园访问权限的
目标机器上验收；系统会在依赖不可用时显式失败，不会伪造科研产物。

## 目录

```text
client/             DSH Web 客户端与离线查看器
desktop/            Windows Tauri 客户端及发布脚本
lib/                插件服务、远程接口和数据持久化
src/                领域模型与计算逻辑
presets/            lab-research 预设
python/             固定 Python 依赖与辅助脚本
vendor/             固定版本 Nature Skills
runtime/            Linux 发行版版本与系统依赖
browser-extension/  本机 PDF/SI 捕获桥
tests/              单元、集成、浏览器、回归与 E2E 测试
docs/               当前发布说明及历史设计/验收记录
```

## 许可证

本项目使用 [MIT License](LICENSE)。内置 Nature Skills 使用 Apache-2.0；第三方运行时
组件保留各自许可证与 notices。
