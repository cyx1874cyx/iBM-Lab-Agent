# iBM Lab Agent 0.5.8-rc.1：DSH NEXT 服务插件化拆分评估

编制日期：2026-10-02；执行状态更新：2026-10-03。本文原始评估依据固定源码与服务契约。P1 已完成固定 NEXT/内核的安装和兼容运行，P2 已建立并验收独立 core 与兼容入口；真实机构登录、科研桌面联动和用户数据迁移尚未验收。

**结论：适合按业务域拆成 6 个 Host 插件，配套 1 个统一 Client UI 插件和 1 个 NEXT 桌面适配模块。先升级内核、建立接口和数据边界，再实现独立安装与停用。**

0.5.8-rc.1 已有 Cordis 服务、浏览器适配描述符与应用注册表，具备拆分基础。但 `labTasks`、共享存储和 `remote.lab` 仍集中耦合；现有按文件拆分不能直接等同于独立插件。完整保留嵌入式文献捕获与科研运行时，需要 NEXT 的小范围桌面扩展或外部浏览器实现。普通 Host 插件不具备任意 Electron 主进程能力。

**1. 固定评估基线**

| 层次 | 固定版本 / 修订 | 已核对的事实 |
|---|---|---|
| iBM 业务与界面 | `v0.5.8-rc.1`；提交 `a400ac424e1ca89496a9ac706531d7a05a221a2d` | 该标签的 package、锁文件与发布说明；原内核为 `0.1.7-rc.1` |
| 桌面基座 | anywhere-labs/dsh-desktop 的 `v2.0.17-next`；提交 `838ba60fd79362087c0a0d134efee671c284786a` | 使用 NEXT 目录；不混用 Stable/Beta 桌面服务 |
| DSH 内核 | `0.2.0-rc.2` | NEXT 标签已锁定该版本，升级工作发生在 iBM 插件、安装配置与数据兼容侧 |
| 官方内核源码 | NEXT 的 deepseek-harness 子模块提交 `639ed015397290b3745d163aafe02ffee4aa3f84` | 用于核对兼容门禁与 storage-domain |
| Electron / 打包 | `44.0.0` / electron-builder `26.15.7` | 沿用目标版本工具链，替代此前自行搭建 Forge 的建议 |
| 构建 | Yarn `4.18.0`、TypeScript `6.0.3`、tsdown `0.22.2`、Vite `8.2.1` | 开发 Node 要求 `^22.19.0 || >=24.0.0`，与打包后 Electron Node-mode 区分 |

Electron 使用官方框架；DSH NEXT 是所选社区桌面基座，内核来自官方 DeepSeek Harness。NEXT 包在仓库内标记为 private，因此桌面发行方案按该标签源码构建，不假设可以从公共 npm 安装整个 NEXT 桌面产品。

本次未切换当前工作树：当前工作树仍为 `release-0.5.0` / `12f978c` / `0.5.2-rc.1`。0.5.8 与 NEXT 均在单独的参考目录中读取。实施前应从指定 0.5.8 标签建立迁移分支。

源码核对入口：

- [iBM 固定基线清单](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/package.json)
- [iBM 0.5.8 发布说明](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/docs/releases/v0.5.8-rc.1.md)
- [NEXT 发布标签](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.17-next)
- [NEXT 包与打包配置](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/package.json)

**2. 当前拆分基础与需要先处理的耦合**

| 对象 | 0.5.8 源码事实 | 评估 |
|---|---|---|
| 自有 Host 服务 | 扫描 `lib/` 得到 24 个提供自有服务名称的 Service/TypertRemoteService 类 | 适合作为迁移清单；不应机械生成 24 个安装包。该计数不含 defineTool 插件、上游服务或桌面命令 |
| `labTasks` | `lib/tasks/` 约 3,200 行；使用 Object.assign 聚合课题、文献、报告、PPT、审核等方法 | 文件组织已经改善，但对象、生命周期与存储仍统一，需要拆分业务接口 |
| `lab_tasks` | 单一 domain、version 0、8 张表 | 第一次迁移保留数据格式和唯一打开者，避免与业务拆分同步进行存储格式重写 |
| `remote.lab` | 近 1,000 行；静态必需注入 14 个功能服务 | 缺少一个提供者就可能影响聚合接口；应按功能提供 Remote，旧接口作为兼容门面 |
| 文献 → 合成 | PDF/SI 替换后直接尝试调用 `labSynthesis.invalidateEvidenceShotsForBundle` | 改为共用产物变更通知；设计插件按文件哈希检查证据，消除反向依赖 |
| 表征 → NMR / 绘图 | `labCharacterization` 必需注入 `labNmr`、`labPlotRecords` 和 `labTasks` | 首轮把 NMR、绘图、表征归为一个插件，减少任务与结果投影不一致 |
| 桌面判断 | `IBM_LAB_AGENT_BUNDLED_PYTHON` 同时代表 Python 路径与 Tauri 桌面身份 | 改为显式 Host/浏览器/运行时能力；Python 可用不能直接证明桌面能力可用 |
| 浏览器模式 | 已有 web-current、managed-edge、desktop-edge-handoff 描述符 | 保留该抽象，新增 NEXT 提供者；文献业务不应直接导入 Electron |
| 外部应用 | Origin/Mnova 集中登记，启动类型由固定 appKey 决定 | 收入运行时插件；保持受限启动规格，避免由客户端传任意 executable |
| Agent 工具与预设 | Host 服务只挂载一次；lab-research 声明会话平面的工具与人格 | 保留两层边界；拆分后由能力状态组合工具，避免每个会话重复打开 Host 存储 |
| 客户端契约 | 0.5.8 修复描述符参数数量及缺失方法，新增一致性检查 | 拆分必须保留检查：调用点、描述符、Host 方法、单 request 参数需要一致 |

证据：[任务聚合与 8 表](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/lib/tasks/index.js:48)、[聚合 Remote](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/lib/remote.js:42)、[浏览器描述符](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/lib/adapters/browser.js)、[应用注册表](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/lib/applications/registry.js)、[描述符检查](H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/ibm-v0.5.8-rc.1/tests/unit/client-descriptors.test.mjs)。

**3. 推荐插件边界**

下面的包名与新服务名称均为建议命名，并非已发布包或 NEXT 已提供的服务。

| 单元 | 建议包名 | 从现有实现迁入的职责 | 依赖与停用行为 |
|---|---|---|---|
| ① 课题与产物基础 | `@ibm/dsh-lab-core` | 课题、工作区、会话绑定、版本化核心记忆；产物定位、哈希、溯源及人工审核凭据；共享 lab_tasks 的兼容仓储；元数据与共享能力登记 | 必需。只依赖 DSH 基础服务和契约库，不必需注入文献、设计、分析或模板服务 |
| ② 科研运行时 | `@ibm/dsh-lab-runtime` | Python/Node/LibreOffice 定位与环境事实；离线资源版本、Nature Skills 版本登记；Origin/Mnova 应用规格、MCP 配置与探测；诊断 | 依赖 core。桌面专属能力可选；无软件授权或无 provider 时明确报告状态 |
| ③ 文档与模板 | `@ibm/dsh-lab-documents` | 笔记/PPT 模板、MarkItDown 转换、DOCX/PPTX 构建与检查、PDF 预览资源；处理显式输入，不管理文献搜索任务 | 依赖 core/runtime。停用后可查看原有产物记录，转换与生成入口不可用 |
| ④ 文献工作流 | `@ibm/dsh-lab-literature` | 搜索与来源、DOI/元数据、微信公众号入口、论文资料包、PDF/SI 捕获任务、精读目标、精读与汇报编排、文献审核流程 | 依赖 core/runtime/documents；科研浏览器 provider 可选。浏览器缺失只影响捕获，不阻断课题、设计和分析 |
| ⑤ 研究设计 | `@ibm/dsh-lab-design` | 化学实体、实验计划模板、合成目标/路线/证据、Ketcher、证据截图、批次审核、真实用户锁定动作 | 依赖 core/runtime；文档导出能力可选。通过 core 获取源文件与版本，不必需注入 literature |
| ⑥ 表征分析 | `@ibm/dsh-lab-analysis` | NMR 数据集、绘图记录、表征任务与产物登记、Origin/Mnova 工作流 | 依赖 core/runtime；文档导出可选。以化学实体快照作为输入，不强依赖 design |
| ⑦ 统一科研界面 | `@ibm/dsh-lab-ui` | 0.5.8 的课题、文献、设计、表征页面；能力感知的菜单/动作/描述符；一次品牌与样式注入 | 依赖 core 的可查询契约。功能面板按 provider 激活，避免所有服务进入同一个 required inject |
| ⑧ NEXT 桌面适配 | `ibm-next-adapter` 模块 | Host 侧 NEXT 接口适配；原生侧科研浏览器、文件对话框、受限系统能力、密钥兼容与进程清理 | Host face 可作为 bundle；原生 face 属于 NEXT 桌面构建或受管外部 helper，不能假定是普通 Host 插件 |

配套两项：

- `@ibm/lab-contracts`：纯类型/Schema/错误码/事件与能力版本；不引入 Electron、Cordis 或存储实现。
- `dsh-lab-agent`：保留安装入口与历史 API 的兼容门面；不再拥有全部业务状态。不同时启用新旧实现来重复提供 `labTasks` 或 `lab`。

六个 Host 插件继续运行在 NEXT 管理的同一个 Host 进程中，通过 Cordis 管理独立生命周期。默认完整发行组合为六个 Host 插件、UI、桌面适配与 lab-research 预设。可裁剪组合必须显式声明关闭的功能、不可用的生成动作及仍可读的旧数据。

这套边界以业务生命周期、数据归属和停用影响决定。PDF 资源服务、Ketcher 静态资源、模板 CRUD、每个检索源暂不单独发包；它们与对应业务同版本更容易维护。Origin/Mnova 先作为 runtime 的 provider，只有出现独立升级或部署需求时才拆成额外插件。

**4. 24 个自有服务的归属清单**

| 当前服务 | 目标归属 | 拆分时的特别处理 |
|---|---|---|
| labAgent | core | 产品/插件元数据；避免重复品牌注入 |
| labTasks | core 仓储 + 兼容门面；业务方法分配到 literature/documents | 拆除 core 对 labGoals/labTemplates/labNoteTemplates 的必需依赖 |
| labArtifactDownload | core | 下载授权、当前文件哈希与人工审核状态保持关联 |
| labVersions | runtime | 版本登记与离线资源清单；不把 Python 大资源塞入 JS 热更新包 |
| labPython | runtime | 显式 Python provider 与来源，保留内置环境优先规则 |
| labLlmDiag | runtime | LLM 诊断按可用能力挂载，不作为全部 UI 的前置依赖 |
| labNoteTemplates | documents | 保留历史版本快照和全局默认模板 |
| labTemplates | documents | PPT 模板版本、导入和历史任务引用 |
| labConvert | documents | 格式转换；调用 runtime 执行器，不自行猜 Python |
| labPdfViewerAssets | documents | 资源路由受同一生命周期管理 |
| labGoals | literature | 精读目标属于文献工作流；documents 接收目标快照 |
| labLiterature | literature | 业务会话/下载记录与浏览器底层会话分离 |
| labCapture | literature | 捕获任务状态与资料包绑定，复用 core 产物提交 |
| labCaptureHandoff | literature | 回传协议属业务；浏览器启动与 Native Messaging 安装属桌面 adapter |
| labChemistry | design | 化学实体/属性/实验计划数据 |
| labSynthesis | design | 目标、路线、证据、提取任务、审核批次 |
| labExperimentPlanTemplates | design | 实验计划的业务模板；文档服务接收显式模板快照 |
| labKetcherAssets | design | 路由与结构编辑器静态资源 |
| labEvidenceShot | design | 调用 core 文件定位，按源文件哈希缓存和失效 |
| labUserAction | design + 桌面鉴权适配 | 用户锁定通道保持独立，不进入通用 Remote 或 Agent 工具 |
| labNmr | analysis | 数据集记录、来源、原始数据引用 |
| labPlotRecords | analysis | 绘图记录与可编辑产物引用 |
| labCharacterization | analysis | 保持任务与 NMR/plot 结果登记一致 |
| lab（LabRemoteService） | 兼容入口 | 新功能分域 Remote；旧 `lab/*` 通过可选 provider 委派 |

`tasks-tool`、`memory-tool`、`synthesis-tool`、`characterization-tool`、`convert-tool`、`templates-tool`、`ppt-build-tool`、`runtime-tool` 随对应领域组合。保留历史工具名及参数形式；拆分 tasks-tool 时逐项按课题/文献/产物职责分类。关闭功能后不向模型注册无实现的工具。

**5. 依赖方向和接口约束**

```text
lab-contracts
    └─ core（课题 / 产物 / 兼容仓储）
         ├─ runtime（执行环境 / Skills / MCP provider）
         ├─ documents  ← runtime
         ├─ literature ← runtime + documents；浏览器能力可选
         ├─ design     ← runtime；文档能力可选
         └─ analysis   ← runtime；文档能力可选

统一 UI ← 分域 Remote / 能力目录
NEXT adapter → 提供桌面与科研浏览器能力
兼容入口 → 委派给以上 provider，保留 lab/* 与旧工具名称
```

依赖规则：

1. core 不导入 documents、literature、design、analysis；新课题与核心记忆不依赖模板或浏览器。
2. literature 不直接调用 design；design/analysis 不直接读 literature 的私有表。
3. documents 接收已解析的文件引用、任务/课题 ID、模板和目标快照，返回结果引用；不反查文献插件补齐隐式输入。
4. UI 不读 Host 私有字段，不把 Electron IPC 详情带入产品页面。
5. 领域服务只依赖自己的仓储接口；跨域查询通过只读、版本化的公开契约。
6. 必需服务仍用 Cordis 注入。可选 provider 通过可卸载注入上下文监听，清理用 ctx.effect；避免缓存卸载后的 ctx 代理。
7. 重启、插件更新、停止任务、HTTP 路由解除与子进程退出需要统一协调；不可在执行任务途中随意替换核心 provider。

建议新增能力接口，例如 `ibmProjects`、`ibmArtifacts`、`ibmRuntime`、`ibmResearchBrowser`。接口包含版本与能力状态；这些名称是 iBM 自有设计，不是上游现成 API。

错误结果应能区分 feature-unavailable、unsupported-platform、runtime-missing、permission-denied、cancelled 和 execution-failed。现有 wire 返回封装先保留，具体错误码通过兼容门面映射。

**6. 存储拆分：先拆所有权，后拆物理数据**

0.2.0-rc.2 保留 `defineDomain` / `domainTable` / `storageDomain.open`，但同一 domain 名称不能被同时打开；重复打开会报 `already-open`。因此，多个插件分别打开原 `lab_tasks` 不是可行方案。[官方固定源码](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/storage/storage-domain/src/index.ts)

| lab_tasks 现有表 | 业务所有者 | 第一轮物理存储策略 |
|---|---|---|
| lab_projects | core | core 唯一打开 lab_tasks，提供课题仓储 |
| project_memory_versions | core | 保留版本链、哈希与人工更新规则 |
| project_sessions | core | 保留会话绑定与工作目录定位规则 |
| literature_search_runs | literature | core 的过渡仓储代理；仅 literature 发起业务写入 |
| paper_source_bundles | literature | 保留 bundle ID、文件相对路径与源文件哈希 |
| reading_reports | literature | 保留目标/模板快照、审核状态与产物引用 |
| presentation_runs | literature | 保留从精读到 PPT 的工作流状态；documents 负责构建 |
| artifact_provenance | core | 共用不可随意覆盖的溯源登记 |

其他已有 domain 继续由相应插件唯一打开：文献与捕获、化学与合成、NMR/plot/表征、模板与转换、版本登记。首轮不重新命名、不换 JSON 后端、不改变 schema version 来掩盖差异；后端路由必须在 NEXT profile 中明确配置。

后续如需独立物理 domain，再制定逐表迁移：备份 → 校验 → 写入新域 → 对账 → 切换所有者 → 标记完成。迁移需幂等、保留旧备份并检测中断；不能让两个域长期双写。权威数据验证失败应阻断迁移，不能用“跳过无效记录”静默丢弃课题或审核历史。

core 的过渡仓储可按接口分文件，不能把全部业务逻辑重新搬进 core。功能卸载保留数据；删除数据必须作为单独的显式操作。

**7. 最需要改写的两条跨域链路**

**7.1 PDF/SI 替换与证据失效**

当前文献资料更新直接尝试通知 labSynthesis。建议由 core 的产物提交接口统一记录并发出带版本的变更通知：

```text
artifact-source-changed:
  schemaVersion, projectId, bundleId, kind, oldSha256, newSha256
```

先完成源文件、资料包和 provenance 登记，再发送通知。design 按通知使对应证据失效；重新加载证据时仍校验文件哈希，防止通知丢失或插件停用期间发生替换。重复通知必须幂等；第一阶段用现有存储记录与重校验，不引入新的分布式消息系统。

**7.2 捕获、人工审核与下载**

科研浏览器只负责经过授权的页面/文件获取，literature 管理捕获任务，core 管理产物提交与审核凭据。提交链路包含 task/project/bundle 绑定、一次性或短时令牌、临时文件、内容校验、哈希、原子落盘、provenance 和失败恢复。同一下载完成事件重试不能生成重复资料包。

人工批准继续绑定当前文件哈希；文件替换后旧批准不得授权新文件下载。路线锁定继续只走真实用户动作通道，不能为迁移方便重新暴露给 Agent 通用工具或 Remote。NEXT 的应用 scheme、Host 鉴权和原有同源判断不同，必须以实际路由验证结果确定适配。

**8. DSH NEXT 目标版本的实际接入边界**

| 核对项 | 目标版本事实 | iBM 方案 |
|---|---|---|
| 内核兼容门禁 | app-boot 校验所有 DSH peerDependencies；iBM 的精确 0.1.7 peers 不满足 0.2.0-rc.2，optional 标记不豁免版本判断 | 实际验证后精确更新 peers、锁文件和 profile。不可把 allow-version 或宽泛 semver 当成发布修复 |
| Host 进程 | NEXT 从 Electron 创建 Node-mode 子进程启动官方 desktop-host；开启 ELECTRON_RUN_AS_NODE | 优先复用。先验证 Node 原生命令、模块和 shell 启动器；不默认再打包一套独立 Node |
| Python | NEXT 桌面包没有 iBM 的封装 Python 资源 | 保留自己的离线 Python/科学库资源，单独版本化并由 runtime 显式定位 |
| desktopProfiles | NEXT extensions 提供 current.name / current.dir | 不使用 Stable 文档中的 list()/select()；选择 profile 交给 NEXT 自身 |
| desktopPnpm | 提供 run、runPlugin、dispose；runPlugin 需要调用目录，返回受管进程操作 | 安装到当前 profile，操作有取消、输出与退出结果；更新过程使用 NEXT 包管理 runner |
| desktopPlugins / Actions / Permissions | 提供插件清单、受条件限制的动作和 Host 权限桥 | 仅使用已核对接口；不假定这些服务授权科研浏览器下载或任意 Electron 调用 |
| 原生浏览器 | 标签实现使用受约束的 webview guest、workspace lease；partition 无 persist 前缀；will-download 被阻止 | 复用官方 UI/租约思路，科研浏览器另设 provider；持久机构登录与 PDF/SI 下载需要实现 |
| Profile | 隔离插件依赖与启用配置；全局 home 的会话/凭据不因切换 profile 自动隔离 | iBM 使用独立 home；按 NEXT 初始化逻辑生成 profile，不复制旧 node_modules |
| NEXT layer | loadNextProfile 在加载时组合 NEXT 层，并处理旧持久化 NEXT bundle | 不依据 README 旧示例重复登记 NEXT bundle |
| Community Fabric | 当前是 RFC/私有文档支架，没有可依赖的完整运行时 | 自有契约与事件先实现，不把规划中的 capability/events API 当成已经存在 |

证据：[NEXT extensions](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/src/extensions.ts)、[Host 进程](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/src/host-process.ts)、[浏览器 guest](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/src/browser-guests.ts)、[Profile 加载](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.17-next/dsh-desktop-next/src/profiles.ts)、[内核兼容检查](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/src/plugin-compatibility.ts)。

仓库通用插件指南与 Stable/Beta 服务文档不能替代 NEXT 的源码契约。例如通用 desktopProfiles 操作与 NEXT current-only 提供者不同，NEXT exports 也不提供 Stable 的 profile-service 路径。参考文档中“WebContentsView”的概括与该标签 guest 实现不一致，本方案以固定标签源码为准。

**9. 桌面交付方式比较**

| 方案 | 能完成的范围 | 代价 / 缺口 | 判断 |
|---|---|---|---|
| A. 原版 NEXT + 纯 iBM Host/Client 插件 | 科研业务、课题、转换、产物、外部受控浏览器 | 现有内嵌机构浏览器的持久登录/捕获不能仅靠普通 Host 插件获得；外部 Edge 扩展回传仍需重新适配 | 适合作为第一轮兼容原型及轻量安装形态 |
| B. 固定 NEXT 源码 + 少量 iBM 桌面适配 | 可覆盖 0.5.8 的内置运行时、文件保存、机构浏览器和捕获、密钥迁移及 iBM 品牌发行 | 维护明确、可审查的原生扩展差异；每次升级 NEXT 回归这些边界 | 完整桌面功能对齐的推荐路径 |
| C. 大范围 fork NEXT 与官方前端 | 可随意改动壳和界面 | 升级合并、插件契约漂移、重复修复与发行成本最高 | 当前需求没有支持该成本的必要性 |

采用 B 时，Electron 生命周期、默认前端、profile/recovery、已有 package runner 等继续来自 NEXT。差异集中在独立 iBM native 模块与组合入口；不修改 deepseek-harness 子模块，也不复制改写官方主前端。

科研浏览器使用自己的持久 partition 与访问/捕获策略；不能全局放开普通侧栏 guest 下载或共享应用主窗口会话。出版社登录、机构 SSO、弹出窗口与下载行为以真实站点验收。现有 managed-edge 与 handoff 作为明确可选 provider，不能在用户未察觉时改用另一账户会话。

**10. 内核升级必须单列的检查**

1. 精确更新 DSH peers 与 harness/runtime 锁定，审查 0.2.0-rc.2 的 bundle、preset、service injection、tool registration。
2. 验证 0.5.8 的客户端模块加载、slots、会话/工作区 API 与 Typert descriptors；逐项检查单 request 参数和取消行为。
3. 审查 `src/dsh-runtime-patch.js` 与 `src/dsh-web-frontend-patch.js` 的旧版本字符串锚点。优先以官方扩展点或 NEXT 适配替代；未验证的旧补丁不能套到新发行物。
4. 核对 storage-domain backend 路由、JSON 后端、读写与关闭。JSON 存储包在 rc.2 仍存在，但不能因此假定旧 profile 自动配置正确。
5. 验证 Agent 工具的会话绑定、核心记忆版本链、临时目录与实际内置 Python/Node；不能沿用固定 Program Files 路径。
6. NEXT 运行中、更新中、恢复中验证插件任务与科研子进程退出。进程树清理与 PID/句柄归属需要实测，不以 child.kill() 成功视为完成。
7. 先在临时独立 home 跑完整单包，再调整插件边界，避免内核不兼容和拆分缺陷混在一次调试中。

**11. 数据、安装与发行边界**

旧桌面数据根为 `%LOCALAPPDATA%\iBM-Lab-Agent`，DSH 数据位于其中的 `dsh`；凭据为 config 下的 `api-key.dpapi`。路径已按 0.5.8 的 RuntimeLayout 核对，迁移程序仍需识别实际安装配置和备用目录。

NEXT 默认 home 为 `~/.dsh`，可使用绝对 `DSH_DESKTOP_NEXT_HOME` 或受验证的数据目录配置。为科研产品建立独立目标 home；先备份导入，不让 0.1.7 与 0.2.0 共同写入旧数据。Next Profile 不等同于数据隔离；在 UI 中选择 profile 也不能替代独立 home。

迁移清单包含课题/核心记忆/会话绑定、DSH 会话、资料包及 PDF/SI、报告与 PPT、模板与默认设置、合成/NMR/绘图数据、审核/锁定/溯源、MCP 设置与密钥。机构浏览器旧会话优先要求重新登录；不承诺 Tauri WebView 的 Cookie 能直接移入 Electron。

DPAPI 密钥兼容读取在本机受限层完成；新存储若换格式需有明确迁移验证，密钥不进入普通客户端结果、Agent 工具或日志。回退使用原备份与旧运行时，不能假定新内核写过的数据可由旧内核安全读取。

NEXT 的 NSIS 配置是 perMachine:false，旧 iBM 桌面采用每机器安装。需明确新的 appId、快捷方式、安装范围、旧版本识别、卸载与保留数据规则。iBM 派生安装包使用自己的更新源与兼容清单，防止上游 NEXT 自动更新覆盖已验证的 iBM 适配或混用版本号。

上游根构建流程包含刷新 marketplace 与 AA 依赖的步骤。用户指定固定基座，因此可复现构建必须审查这些脚本，把实际输入版本、制品哈希、补丁与锁文件记录入发布清单；不能构建时静默引入 latest。首次功能验收不要求开启远控或市场组件。

**12. 实施顺序与工作量估算**

以下为 1 名熟悉仓库开发者的有效工作日估算，尚无升级运行结果；第一轮原型后重新评估。真实站点登录、证书或授权的等待时间另计。

| 阶段 | 有效工作日 | 交付与通过条件 |
|---|---:|---|
| P0 固定输入与契约清单 | 1–2 | 两个标签、内核 pin、资源 hash、0.5.8 功能清单；当前代码与目标基线明确分开 |
| P1 单包升级原型 | 4–6 | 在独立 NEXT home 运行未拆包 iBM；Host/Client/preset/Remote/storage/Python 核心链路通过 |
| P2 core 与契约 | 3–5 | core 无业务反向依赖；唯一 lab_tasks 所有者；兼容门面与能力目录可用 |
| P3 领域服务拆分 | 5–8 | runtime/documents/literature/design/analysis 明确 provider 与仓储；跨域通知和工具组合通过 |
| P4 桌面能力对齐 | 6–10 | Python 离线资源、科研浏览器、PDF/SI 回传、文件/密钥/MCP 与进程生命周期 |
| P5 独立插件与 UI | 6–8 | 按 profile 安装/停用/更新；面板按能力加载；旧 API 与 0.5.8 布局回归 |
| P6 数据与发行验收 | 5–7 | 复制迁移/中断重试/回退、NSIS 旧版路径、安装后离线科研闭环与版本清单 |
| 合计 | 30–46 | 含缓冲建议 8–12 周；不同时开展新增科研功能或跨平台产品发行 |

P4 可在 core 契约冻结后与领域实现交错，但原生扩展接口需先明确。前 5–8 个工作日应给出可运行的“单包 + 新内核 + NEXT”原型；该里程碑不代表拆分、数据迁移或功能对齐已经完成。

分包过程分为三个可回退提交组：内核兼容 → 内部服务边界 → 独立 bundle 与发行。第一组不改变历史存储格式，第二组不同时进行客户端全面重写，第三组以停用/卸载/恢复实测证明插件边界。

**13. 判定“拆分完成”的验收矩阵**

| 场景 | 必须证明 |
|---|---|
| 停用 literature | 课题、核心记忆、设计和分析继续可用；历史资料与已生成产物可经 core 读取；文献动作明确不可用 |
| 停用 design | 文献 PDF 替换成功；其他任务不等待合成服务；重新启用后源文件 hash 导致旧证据失效 |
| 停用 analysis | 文献/设计正常；无重复 MCP 进程，分析入口与工具不暴露无效调用 |
| documents 缺失 | literature 的必需依赖状态明确；core 不被拖垮；旧成果仍可定位与受审核规则约束 |
| 桌面 adapter 缺失 | 可用的非桌面功能正常；桌面动作有明确信息，不因缺服务销毁整个 UI |
| 同名域/服务重复注册 | 启动前报告组合错误；正常完整组合只有一个 lab_tasks 与一个旧 API facade |
| 卸载后重新加载 | HTTP 路由、注入上下文、事件监听、浏览器 lease、子进程全部释放，状态可恢复 |
| 更新与取消并发 | 运行任务有明确停止/阻止更新策略；旧取消句柄不能杀死新任务 |
| 0.5.8 历史数据 | 逐域数量、关键 ID、哈希、版本链、审核状态对账；原目录备份可用 |
| 科研完整闭环 | 建课题 → 检索 → 机构登录 → PDF/SI 捕获 → 转换 → 精读 → 人工审核 → PPT → 保存/打开 → 溯源 |
| 设计/分析闭环 | 化学实体/合成/证据/用户锁定；NMR/Origin/Mnova 任务与原始数据、产物关联 |
| 0.5.8 视觉回归 | 扁平课题页、平铺动作、窄宽换行、字号；浏览器不遮挡全屏课题面板，关闭面板不恢复已关闭 tab |
| 打包与异常退出 | 普通用户/中文路径/离线运行、旧版共存或替换、更新失败、崩溃后科研进程清理 |

保留既有 tasks-surface、client-descriptors、领域与用户动作检查；新增针对插件组合与原生边界的集成验证。可用能力、不可用能力、实例生命周期与旧数据对账比“每个文件能 import”更能证明拆分有效。

**14. 与旧评估和旧迁移计划的关系**

本文件与更新后的 ELECTRON_MIGRATION_PLAN.md 覆盖当前目标。旧 DSH_DESKTOP_PLUGIN_ADAPTATION_ASSESSMENT.md 面向 2.0.13/2.0.14 与旧内核，应作为历史资料：

- “业务零代码改动即可加载”不适用于精确 0.1.7 → 0.2.0-rc.2 的兼容门禁与实际接口验证。
- “无 preload bridge”不能描述 NEXT 的受限 first-party preload；但 NEXT 仍没有向普通 Host 插件开放任意 Electron API。
- Stable/Beta 的公共服务示例不能直接套用 NEXT。
- 内嵌侧栏已存在，但其默认会话与下载行为仍不足以替代 iBM 科研捕获。

原始评估完成了源码评估、边界方案与迁移计划更新。随后 P1 完成固定版本兼容原型，P2 完成 core、契约、共享仓储与兼容入口：全量测试 783 通过/8 跳过/0 失败，真实 NEXT/Electron 的业务停用与恢复通过，旧接口保留。详见 [P2 执行报告](../migration/electron-next/P2_REPORT.md) 与 [P2 契约](../migration/electron-next/P2_CONTRACTS.md)。独立领域包仍需 P3，科研桌面和数据迁移等价性继续在 P4–P6 验证。
