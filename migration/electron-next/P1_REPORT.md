# Electron NEXT 迁移：P1 执行报告

执行时间：2026-10-02 至 2026-10-03。状态：**P1 单包兼容原型 PASS**。

## 结论

iBM Lab Agent 0.5.8-rc.1 的业务服务、存储域、工具、Remote 描述符及科研预设保持单包结构，可以装入固定版本 DSH NEXT v2.0.17-next，并在 Electron 44.0.0 的 Node 模式 Host 中使用内核 0.2.0-rc.2。客户端在独立 Edge 无头浏览器中正常加载，默认新会话进入 lab-research。课题记忆和工作区/会话绑定在 Host 重启后保留。

这是 P1 的技术路径验收。正式桌面窗口、机构网页捕获、授权科研软件联动、服务拆分、历史数据迁移和安装升级仍按 P2–P6 执行。

## 固定输入与隔离

| 输入 | 实际版本 / 提交 |
| --- | --- |
| iBM 业务基线 | 0.5.8-rc.1 / a400ac424e1ca89496a9ac706531d7a05a221a2d |
| NEXT | 2.0.17-next / 838ba60fd79362087c0a0d134efee671c284786a |
| 内核 | 0.2.0-rc.2 / 639ed015397290b3745d163aafe02ffee4aa3f84 |
| Electron / 内置 Node | 44.0.0 / 24.18.1 |
| 构建 Node / Yarn | 24.19.0 / 4.18.0 |
| iBM / launcher pnpm | 10.34.5 |
| Python | 3.12.11，独立 uv managed CPython 与 venv |

- 实现分支仍为 `codex/electron-next-migration`，工作区为 `H:/107-iBM-Agent/iBM-Agent/Code/iBM-Lab-Agent-electron-next`。
- NEXT 与内核源码均保持固定提交，无源码改动。内核使用稀疏检出，只物化构建验证所需路径。
- 全部原型 home、临时文件、浏览器配置及运行时位于 `H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1`。未读取或导入旧业务数据、机构登录和用户 API Key。
- 原 `Code/iBM-Lab-Agent` 工作区未修改。P0 冻结文件保持原样，重算通过。
- 未运行会刷新附加依赖到 latest 的 NEXT 根构建命令；使用固定锁安装及 NEXT workspace 构建。未修改系统 Python、注册表或全局 Node/Yarn。

## 实施内容

1. 根包的内核 peer/dev 版本、Harness 锁、launcher 版本及关联版本声明升级至 rc.2；根 npm、pnpm 和 launcher pnpm 锁文件重新生成并校验。
2. 保留 24 个业务服务、14 个域/29 张表、56 个工具和 157 个远程方法。未开始 P2 拆分，未改变存储后端和历史 schema。
3. 为旧内核/前端字符串补丁增加版本限制，rc.2 包拒绝应用旧补丁。Linux 安装入口在 rc.2 下关闭旧补丁；旧转换函数和对应单元测试保留。
4. 增加 `scripts/migration/verify-next-prototype.mjs`：固定提交检查、独立 home、技能物化、官方 NEXT plugin runner 安装并激活本地单包、真实 Host、客户端、预设、Remote、文档转换、课题存储与重启验证。试验使用 `link:` 本地插件，正式打包安装留给后续发行阶段。
5. 增加 `scripts/migration/verify-python-runtime.py`：核对 74 项 Python 版本锁，验证科研/MCP 模块导入、DOCX/PPTX/XLSX 转 Markdown、PDF 生成和提取、nmrglue/NumPy FFT。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| P0 指纹与声明复核 | PASS |
| iBM 全量单元/集成测试 | 780 通过，8 跳过，0 失败；跳过沿用既有平台/前置条件 |
| NEXT 单元测试 | 417 通过，2 跳过，0 失败，54 个测试文件通过 |
| NEXT 构建、类型检查、官方 frontend 检查 | PASS |
| 改动 JavaScript 的静态检查 | PASS |
| 受安装入口改动影响的发行检查 | 18 通过，0 失败 |
| 根与 launcher 冻结锁校验 | PASS |
| Node Host + 无头客户端原型 | PASS |
| Electron Node-mode Host + 无头客户端 + 科研 Python 原型 | PASS |
| Python 原生通信桥 | 4 通过，0 失败 |
| 74 项科研版本锁与本地科学运行链路 | PASS |
| Electron 下载归档校验 | 与固定 npm 包内 checksums.json 一致 |

真实原型验证了：安装后 bundle 激活、科研预设没有 broken 诊断、单 request 的 lab Remote、Python preflight 和文档转换、课题创建、核心记忆版本追加、工作区登记、科研会话绑定、默认科研预设、页面无未捕获异常，以及重启后的记忆/绑定读取。

默认预设由客户端异步设置，验收脚本等待设置完成；未为了通过检查修改业务默认预设逻辑。本机 Edge 的兼容启动进程会提前退出，原型通过独立配置的调试端口连接其无头子进程。试验浏览器配置保留，避免目录清理异常覆盖业务验证结果；退出时清理当前独立浏览器配置所属的后台进程。最终检查没有遗留原型 Host/Electron/Edge 进程。

完整结果、23 个关键文件/运行制品 SHA-256 和证据绝对路径见 [P1_VERIFICATION.json](P1_VERIFICATION.json)。最终 Electron 证据为 `outputs/electron-next-p1/prototype/run-DOqy68/verification.json`，页面截图位于同目录的 `client.png`。

## 资源与后续边界

Python 使用 3.12.11 的 uv managed 发行，而非系统现有解释器。科研依赖遵守基线 requirements 与 Windows recipe 的确切版本；MarkItDown 0.1.7 只应用既有、校验原文件 SHA-256 的 magika 可选化补丁。Origin MCP 0.1.4、Mnova MCP 0.3.1 和 MCP SDK 1.29.0 均可导入。

Git 与部分下载链路中断后，使用固定提交的官方 raw 文件恢复，并验证 Git blob 指纹。Python 依赖使用基线约定的清华 PyPI 镜像；Electron 使用镜像下载，但最终归档必须符合固定包内的官方 checksum。完整离线资源包及安装包签名/哈希验收仍属于 P4/P6。

P1 没有启动可见 Electron 窗口，没有执行模型请求、真实机构捕获、Origin/Mnova 应用自动化或用户数据迁移。旧 Tauri 出包脚本不是 NEXT 迁移原型的入口；其嵌入授权、剪贴板、文件关联补丁不能直接搬进 NEXT。

**下一阶段为 P2**：建立 core、契约、仓储与兼容 facade；由 core 唯一持有 lab_tasks，保留现有表名、ID 和 lab/* 请求契约，再做领域拆分。
