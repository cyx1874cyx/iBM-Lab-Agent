# iBM Lab Agent：基于 DSH NEXT v2.0.17-next 的 Electron 迁移计划

编制日期：2026-10-02。用户指定业务基线为 **iBM Lab Agent 0.5.8-rc.1**，桌面基座为 **DSH NEXT v2.0.17-next**，目标内核为 **DSH v0.2.0-rc.2**。本文替代此前基于当前检出版本、自建 Electron/Forge 桌面壳的计划。

**推荐路线：沿用固定 NEXT 的 Electron 与发行基础，以 iBM 插件承载科研业务，以小范围桌面适配补齐原生能力。先验证单包内核升级，再拆成 6 个 Host 插件、统一 UI 和桌面适配模块。**

详细服务归属、存储所有权、接口与拆分验收见 [服务插件化评估](H:/107-iBM-Agent/iBM-Agent/Code/iBM-Lab-Agent-electron-next/docs/DSH_NEXT_PLUGIN_SPLIT_ASSESSMENT.md)。P0 已执行，见 [P0 执行报告](H:/107-iBM-Agent/iBM-Agent/Code/iBM-Lab-Agent-electron-next/migration/electron-next/P0_REPORT.md)；尚未运行迁移后的应用或升级用户数据。

**1. 输入版本与交付范围**

| 输入 | 固定值 | 处理要求 |
|---|---|---|
| iBM 业务代码 | `v0.5.8-rc.1` / `a400ac424e1ca89496a9ac706531d7a05a221a2d` | 实施分支从该标签建立，不从当前 0.5.2 工作树推导功能基线 |
| NEXT 桌面 | `v2.0.17-next` / `838ba60fd79362087c0a0d134efee671c284786a` | 固定 NEXT 目录与锁文件，不混入 Stable/Beta 变体接口 |
| DeepSeek Harness | `0.2.0-rc.2` / 上游 pin `639ed015397290b3745d163aafe02ffee4aa3f84` | NEXT 已使用该版本；iBM 从 0.1.7-rc.1 做兼容升级 |
| 桌面框架 | Electron `44.0.0` | 沿用 NEXT 版本与受限 preload/IPC 设计 |
| 打包与构建 | electron-builder `26.15.7`；Yarn `4.18.0`；TS `6.0.3`、tsdown `0.22.2`、Vite `8.2.1` | 保留目标工具链；此路线不增加另一套 Forge 工程 |
| iBM 科研运行时 | 按 0.5.8 的 Python、Skills、供应内容锁定 | 单独记录版本与 hash，禁止以 Toolchain 历史快照代替已核对的发行输入 |

首版以 Windows x64 功能对齐为验收范围，包括课题、会话与核心记忆、文献检索/机构浏览器/PDF 与 SI 捕获、精读/PPT、化学与合成、NMR/绘图/表征、模板/转换/预览、MCP、首次引导、诊断、保存/打开、安装/更新和数据迁移。

0.5.8 的页面结构与交互为回归基线：平铺条目操作、精读/PPT 独立状态、窄宽度换行、放大的文字、原生浏览器让位于全屏课题面板，以及关闭面板后不错误恢复已关闭浏览器 tab。迁移过程中不同时增加一轮产品视觉改版。

Electron 使用官方框架，NEXT 来自指定社区仓库，DSH 内核为官方 Harness。依据：[NEXT 固定配置](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/package.json)、[0.5.8 发布说明](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/docs/releases/v0.5.8-rc.1.md)。

**2. 目标结构与复用边界**

```text
DSH NEXT Electron 桌面（固定基座 + iBM 原生适配）
  ├─ 官方 DSH Web 前端 + iBM 统一科研 Client 插件
  ├─ NEXT 已有 profile / recovery / package runner / 窗口生命周期
  ├─ iBM native 适配：科研浏览器、文件、密钥、受限系统能力
  └─ NEXT 管理的 Electron Node-mode Host 子进程
       ├─ DSH 0.2.0-rc.2
       ├─ iBM core / runtime / documents
       ├─ iBM literature / design / analysis
       └─ 受管科研执行器
            └─ 内置 Python / Skills / Origin-Mnova MCP
```

普通 Host 插件与 Electron 主进程有独立进程边界。新业务服务不直接导入 Electron；通过 iBM 自有窄接口获取桌面能力。NEXT 的 public Host extensions 以固定标签源码为准，不能照抄 Stable 文档假定 profile 切换或原生浏览器 API 已开放。

NEXT 已经使用 Electron Node-mode 运行 Host，优先复用其进程与 Node 启动器。独立 Node 仅在验证出实际原生模块/命令不兼容时再评估，不作为默认重复资源。Python 仍是 iBM 单独提供的离线资源，不能由 NEXT 内置 Node 替代。

科研浏览器单独管理机构会话和文件获取。NEXT 普通侧栏浏览器使用不持久化的 guest partition，并阻止下载；完整 PDF/SI 捕获需要原生适配或外部浏览器 provider。[NEXT Host 启动](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/src/host-process.ts)、[NEXT 实际浏览器实现](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/src/browser-guests.ts)。

**3. 插件与目录规划**

| 交付单元 | 职责 |
|---|---|
| core | 课题、工作区、会话绑定、核心记忆、产物与溯源、审核凭据、共享仓储 |
| runtime | Python/Node/LibreOffice、Skills、MCP、平台能力和诊断 |
| documents | 模板、格式转换、文档构建与预览、成品检查 |
| literature | 搜索/元数据/论文资料包、捕获、精读与 PPT 工作流 |
| design | 化学实体、实验计划、合成路线、证据与人工锁定 |
| analysis | NMR、绘图、表征任务与外部分析软件工作流 |
| UI | 一个科研 Client 入口，按功能能力提供各页面与动作 |
| NEXT adapter | Host 接口适配 + Electron 原生科研能力模块 |

建议实施目录示意，名称在实施时与包发布范围一起确定：

```text
packages/
  lab-contracts/             Schema、能力与事件版本、错误码
  dsh-lab-core/              core + 旧 lab_tasks 兼容仓储
  dsh-lab-runtime/           运行时事实、执行器、MCP provider
  dsh-lab-documents/         模板、构建、转换、预览
  dsh-lab-literature/        文献与捕获工作流
  dsh-lab-design/            设计与证据审核
  dsh-lab-analysis/          NMR / plot / characterization
  dsh-lab-ui/                现有 Client 的功能入口
  dsh-lab-agent/             兼容安装入口、旧 lab/* 与工具名
desktop/
  next-adapter/
    host/                   只使用已核对的 NEXT Host 接口
    native/                 科研浏览器、文件/密钥/系统适配
    shared/                 参数校验、IPC 与能力契约
    tests/                  adapter 及安装后验证
runtime/
  manifests/                平台资源版本、来源、hash
  python/                   物化/打包描述，资源单独发行
```

第一轮仍可用现有 dsh-lab-agent 单包承载明确的内部服务边界，便于定位内核兼容问题。只有通过独立停用、重载和组合检查后才发布分包。旧根目录入口作为兼容层保留，不复制所有实现长期维护两套。

desktop/native 模块进入 NEXT 产品构建或受管 helper；它不能只作为一个普通 dsh.bundle 安装就取得 Electron 主进程权限。上游 Harness 子模块与官方主前端保持原样，NEXT 差异集中在有清单、可回归的适配模块。

**4. 各工作包的具体任务**

| 工作包 | 必须完成的任务 | 可审查交付物 |
|---|---|---|
| 固定发行输入 | 从 0.5.8 建分支；固定 NEXT tag/内核 pin；识别旧 Python/Skills 资源；审查上游构建时刷新 latest 的步骤 | 版本矩阵、资源清单、可复现构建说明、基线功能检查表 |
| DSH 内核升级 | 更新并验证 peers/锁文件；核对 preset、Host/Client injection、Remote、tool registration、storage backend | 0.2.0-rc.2 单包原型；接口差异清单与必要适配 |
| 旧补丁处理 | 审查 runtime/frontend 的字符串锚点；使用官方扩展点或 NEXT adapter 替代 | 每个旧补丁的去留与依据；禁止未验证补丁写入新内核 |
| shared core | 唯一 lab_tasks 打开者；课题/记忆与模板解耦；产物定位、溯源、审核凭据与只读历史查询 | core 契约、仓储边界、旧 API 委派表 |
| 领域拆分 | 将 24 个服务按 6 域归属；移除 literature→design 直调；分域 Remote 和工具注册 | 各 bundle 组合与能力目录，停用/恢复验证记录 |
| 科研运行时 | 内置 Python 解析、路径与临时目录、离线依赖；Node shell 启动器验证；MCP 配置/探测与进程归属 | 运行时事实工具、平台 provider、离线资源与执行记录 |
| 文献浏览器 | 独立持久会话、机构 SSO/弹窗、tab lease、面板遮挡处理、PDF/SI 获取与 handoff | 可运行 provider；捕获状态机与真实站点验证 |
| 文件与桌面接口 | 另存、取消、打开/定位、预览；DPAPI 兼容、诊断、更新与进程树清理 | 白名单接口、权限/鉴权验证、异常退出记录 |
| UI 与预设 | 按功能提供面板；保留 0.5.8 布局；同步 descriptors；新会话正确启用 lab-research | 截图回归、描述符一致性结果、缺功能组合结果 |
| 数据与发行 | 备份复制导入、对账/中断恢复；NSIS 旧版路径、新 appId/更新源、离线包与签名 | 迁移报告、安装包、发布清单、可用回退包 |

**5. 分阶段排期与退出条件**

估算以 1 名熟悉项目的开发者为基础，第一轮运行验证后调整；不含机构/科研软件授权、证书和外部服务等待。

| 阶段 | 工作日 | 主要活动 | 通过条件 |
|---|---:|---|---|
| P0 | 1–2 | 固定版本、数据/资源与功能清单 | 输入一致；能明确辨识当前检出版本与 0.5.8 标签 |
| P1 | 4–6 | 单包升级到 0.2.0-rc.2，装入独立 NEXT home | Host/Client/preset/Remote/工具/storage 与科研运行时基础链路可运行 |
| P2 | 3–5 | core、契约、仓储与兼容 facade | 新课题/核心记忆无业务反向依赖；lab_tasks 只打开一次 |
| P3 | 5–8 | 五个领域/运行时服务边界及跨域通知 | 文献、设计、分析不互相必需注入；分域服务与工具正常 |
| P4 | 6–10 | 科研浏览器/捕获、离线 Python、MCP、文件与密钥 | 浏览器和捕获完整；安装后离线运行；退出后无遗留科研任务进程 |
| P5 | 6–8 | 独立插件安装/停用/更新与 UI 回归 | 组合、缺功能、重载与描述符验证通过；0.5.8 交互等价 |
| P6 | 5–7 | 数据迁移、回退、安装/更新与完整闭环 | 历史数据对账通过；安装包与旧版迁移、失败恢复验收完成 |
| 合计 | 30–46 | 约 6–9 周有效实施量 | 加缓冲建议安排 8–12 周 |

前 **5–8 个工作日**优先得到单包兼容原型，验证选择 NEXT + rc.2 的技术路径。该原型暂不代表浏览器功能对齐、分包完工或正式数据迁移。

提交与复核按以下顺序分组：

1. 仅内核兼容与必要适配，保留服务与历史存储结构。
2. 内部服务/仓储/Remote 边界，保留兼容入口与 API。
3. 独立 bundle、UI 能力加载、桌面功能对齐。
4. 迁移和发行；每组有独立可回退版本，避免一次提交同时更换壳、内核、存储和 UI。

**6. 关键设计决策**

**共享存储。** 第一版 core 唯一持有原 lab_tasks，领域通过仓储接口访问自己的记录，保留 ID、表名、文件路径与 schema。rc.2 禁止重复打开同名 domain，所以不得让多个插件各开 lab_tasks。物理分库/换后端留到单独数据迁移阶段。[官方 domain 实现](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/storage/storage-domain/src/index.ts)

**兼容入口。** 保留 lab/* 和历史工具名称、单 request 参数以及网关结果封装。分域 provider 自己管理生命周期，兼容 facade 做委派；不存在的功能返回明确状态，UI 不因一个业务服务缺失整体销毁。

**文件与证据。** PDF/SI 更新通过 core 提交并登记 hash/provenance，design 订阅源文件变化并在读取时重校验。人工审核与下载权限继续绑定文件 hash；文件替换不沿用旧批准。

**权限与模型工具。** 路线锁定保留真实用户动作通道，MCP 启动仍由固定应用规格决定。科研网页不获得主窗口凭据或泛化 Electron 接口。旧 HTTP 同源/回传校验须按 NEXT 的实际应用与 Host 访问机制改写和实测。

**运行时。** 不以 Python 环境变量替代桌面能力判断。支持查询可执行路径、来源、版本与可写临时目录；桌面插件包、Python 资源包和系统安装软件分别报告版本与可用状态。所有执行任务都有取消与资源清理归属。

**Profile 与安装。** 安装/停用/升级通过当前 NEXT profile 的 package runner；不复制旧 node_modules，不重复登记 NEXT layer。完整产品使用独立数据 home 和 iBM 自身的发行身份/更新源。NEXT root 构建会刷新部分附加依赖，需要适配固定输入构建，避免构建时漂移。

**7. 数据迁移与回退步骤**

0.5.8 默认数据根为 `%LOCALAPPDATA%\iBM-Lab-Agent`，DSH home 为其 `dsh` 子目录。NEXT 默认 `~/.dsh`；首次试运行和产品发行均应指定独立绝对 home。切换 NEXT profile 只改变插件组合，不能自动隔离全部会话与凭据。

迁移顺序：

1. 停止旧版业务写入，识别实际数据根、版本与已运行任务。
2. 复制备份旧 home/config/业务文件，记录目录清单、关键文件 hash 与迁移 manifest。
3. 用 NEXT 初始化新的 home/profile，安装固定 rc.2 内核与 iBM 组合，先完成空数据启动。
4. 按领域导入课题、记忆版本、会话绑定、资料包、成果、模板、化学/合成/NMR/绘图、审核与 provenance；检查相对路径和工作区引用。
5. 验证 DSH 历史会话、workspace/preset 关联与授权设置。API Key 在受限本机层兼容读取 DPAPI 文件，不返回给 UI/Agent；机构浏览器需要时重新登录。
6. 对账记录数量、ID、文件 hash、记忆链、模板快照、批准与路线锁定状态；模拟中断后重试，证明幂等。
7. 只有对账与完整闭环通过后才切换默认启动。回退使用保留的旧备份与旧运行时，避免旧内核读取新内核已改写的数据。

不以移动或覆盖旧目录代替迁移。数据删除与旧版卸载分开，卸载默认保留业务数据。不同安装范围、中文用户名、受限目录、无网环境均需安装后验证。

**8. 验证与发布门槛**

| 门槛 | 需要保存的证据 |
|---|---|
| G1 内核兼容 | 版本门禁通过；Host/Client/preset 启动；工具与 Remote 可调用；存储路由有效 |
| G2 核心解耦 | 缺少文献/设计/分析时 core 可用；单一域所有者；旧 API 与描述符一致 |
| G3 插件生命周期 | 安装、停用、重载、升级、恢复后，路由/监听/任务/进程/浏览器资源无重复或悬挂 |
| G4 科研功能对齐 | 文献→原文捕获→精读→审核→PPT→保存；合成证据/用户锁定；NMR/绘图/软件工作流 |
| G5 UI | 对照 0.5.8 截图和操作；窄宽度、两主题、浏览器 tab 与全屏课题面板无遮挡 |
| G6 数据 | 多类旧数据对账、异常中断与重试、旧备份恢复结果 |
| G7 发行 | 普通用户与离线安装运行；旧版共存/替换；更新失败恢复；版本/hash/签名检查 |

沿用已有领域、tasks-surface、client-descriptors、用户动作与应用注册检查；新增能验证插件组合、桌面能力和生命周期的集成测试。NEXT 固定标签已有 Host、frontend、sidebar-browser 等验证入口，可用于基座回归；业务测试通过不代替真实 Electron 与安装后验证。

首版发布清单至少记录：iBM 版本/提交、NEXT 版本/提交、内核版本/pin、Electron 版本、每个插件版本、契约版本、Python/Skills/MCP 资源 hash、适配差异、可读取数据 schema、安装包 hash、已通过门槛和回退版本。

若 P1 发现 0.2.0-rc.2 的核心契约不能保留某项业务，则先修正契约和计划再进入拆分，不能通过跳过兼容门禁进入正式发行。

**9. 当前评估完成状态**

P1 已于 2026-10-03 完成单包兼容原型验收：固定 NEXT v2.0.17-next + 内核 0.2.0-rc.2 + Electron 44.0.0 Node-mode Host；无头客户端、默认科研预设、Remote、科研 Python 3.12.11、课题记忆与会话绑定的重启持久化通过。iBM 测试 780 通过/8 跳过，NEXT 测试 417 通过/2 跳过，均无失败。详见 [P1 执行报告](../migration/electron-next/P1_REPORT.md) 和 [复现说明](../migration/electron-next/P1_REPRODUCE.md)。下一阶段进入 P2；此结果不代表 P4/P6 的科研桌面功能、安装包及历史数据迁移验收。

P0 已完成：从指定标签建立迁移分支，固定 43 个关键源码输入和 6 个源码树指纹；生成 24 个服务、14 个域/29 张表、56 个工具、157 个远程方法、41 个桌面命令及 27 项功能回归清单。源基线重算与篡改/缺失检测通过，详见 P0 执行报告。

迁移使用独立工作区和 codex/electron-next-migration 分支；原工作区保留。P0 未改动业务源码、安装依赖或运行新的桌面应用。本机 Python 3.12.10 与目标 3.12.11 的差异、离线制品 hash 和固定构建路径已登记为后续前置事项。运行结果、真实机构捕获、rc.2 历史数据兼容与安装升级路径仍待 P1/P4/P6 验证。
