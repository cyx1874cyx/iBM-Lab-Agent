# iBM Lab Agent 软件架构与流程分析报告

> 分析日期：2026-09-17  
> 分析对象：`Code/iBM-Lab-Agent`  
> 代码基线：`489dbaf30f4c4bb06d747da6027c56c5bd97608b`  
> 包版本：`dsh-lab-agent 0.5.0`  
> 制图工具：Archify 2.17

## 1. 执行摘要

iBM Lab Agent 不是一个独立的大模型应用，也不是对 DeepSeek Harness 的分叉修改。它的本质是一个叠加在 Harness 之上的科研 Agent bundle：Harness 提供会话、模型、工具注册、工作区和 Web 运行面；本项目通过 `cordis.patch.yml` 注册科研领域服务，通过 `lab-research` 预设组织模型可见的工具与技能，再由 Web 工作台和 Tauri 桌面壳向研究人员提供统一入口。

从软件结构看，系统可以概括为五层：

1. **交互层**：DSH Web 客户端和 Windows Tauri 桌面端。
2. **宿主与网关层**：DeepSeek Harness、Cordis、Typert Remote 和本机 HTTP 端点。
3. **科研编排层**：课题、文献、合成、化学、NMR、表征、模板、转换和人工门禁服务。
4. **Agent 执行层**：`lab-research` 预设、Nature Skills、模型工具、MCP 和 Python/JS 机械步骤。
5. **数据与证据层**：项目工作区、JSON 状态、版本化记忆、模板、科研原始数据和 provenance 记录。

核心设计原则是“模型负责推理，宿主负责可信执行”：语言模型可以规划和解释，但文件写入、版本控制、哈希绑定审批、软件桥接和产物登记由确定性服务完成。关键科研动作还设置了人工复核门禁，避免模型直接越过原始数据、批准状态或科学软件结果。

## 2. 分析范围与证据

本报告以仓库中的实际代码、配置、测试和发布脚本为依据，重点分析 Agent 工具本身的结构与运行方式，不把外部 DeepSeek Harness、Origin、MestReNova 或机构数据库的内部实现纳入本项目边界。

### 2.1 分析范围

- Bundle 入口、profile 叠加顺序和 Cordis 服务注册；
- Client、Remote facade、领域服务与工作区文件之间的依赖；
- Tauri 桌面运行时、Node/DSH 子进程、Python 与 MCP 桥接；
- 文献、合成、化学、表征、NMR 和人工审批等关键科研流程；
- 测试、构建、发布、安全边界以及版本和 provenance 机制。

### 2.2 证据口径

为区分“仓库事实”“当前开发状态”和“外部依赖能力”，本报告采用以下口径：

- 架构图的源码标记使用 `HEAD` 的完整提交 SHA 进行本地只读验证；
- 报告同时参考当前工作树，以反映正在开发的代码；
- 未提交内容不被描述为“已发布能力”；
- 本次新增内容仅为本报告、5 份 Archify 规格、5 份 HTML 图及其浏览器证据文件。

## 3. 总体软件架构

完整交互图：[`ibm-agent-architecture.html`](ibm-agent-architecture.html)

### 3.1 运行时组成

系统有两种主要运行形态，但共享同一个插件主体：

- **普通 DSH Web 模式**：用户启动 `ibm-lab` profile，Harness 加载 `dsh-base → dsh-web-app → dsh-lab-agent`，浏览器加载本包的 Client 扩展。
- **Windows Desktop 模式**：Tauri 启动内置 Node 和 DSH 子进程，固定监听 `127.0.0.1`，完成健康检查后在 WebView 中承载相同的 DSH Web UI。桌面端还管理内置 Python、MCP Server、WebVPN 子 WebView、日志、进程状态和本地配置。

桌面端不是第二套业务前端。它是现有 DSH Web UI 的本地安全容器和运行时管理器，这一选择避免了 Web 与桌面业务逻辑分叉。


### 3.2 Host 平面与 Agent 平面

这是理解系统的关键边界：

| 平面 | 生命周期 | 内容 | 典型入口 |
|---|---|---|---|
| Host 平面 | DSH 进程级 | Cordis 服务、storage domain、Remote、HTTP、文件服务 | [`cordis.patch.yml`](../cordis.patch.yml) |
| Agent 平面 | 会话/预设级 | 模型提示词、Nature Skills、模型工具、MCP 工具 | [`agent.cordis.yml`](../presets/lab-research/agent.cordis.yml) |

Host 服务只注册一次，Agent 会话只引用工具和服务能力。这个分层既保证跨会话的持久化和冷读能力，也防止同一个 Cordis 服务因预设重复挂载而发生 `service has been registered` 冲突。

### 3.3 主要组件责任

| 组件 | 核心责任 | 不负责的事情 |
|---|---|---|
| Tauri Desktop | 启停 DSH、分配端口、健康检查、配置和本地软件诊断 | 不重新实现科研业务 UI |
| DSH Client | 课题导航、看板、任务发起、预览和人工动作 | 不直接写 storage domain |
| Typert Remote | 将 UI 方法映射到宿主服务并清理 JSON 边界 | 不承载领域规则 |
| `labTasks` | 课题、文献、报告、PPT、文件暂存和审核门禁 | 不代替 LLM 完成精读写作 |
| Nature Skills / Agent | 检索策略、阅读、写作、绘图、PPT 内容推理 | 不绕过宿主状态机和人工审核 |
| MCP / Python / JS | Origin、Mnova、格式转换、化学计算等确定性操作 | 不决定研究结论和审批结果 |
| Storage + Workspace | 版本记录、文件、哈希、来源链和课题隔离 | 不直接向模型暴露无限文件系统 |

## 4. 静态依赖关系

完整数据与依赖图：[`ibm-agent-dataflow.html`](ibm-agent-dataflow.html)

### 4.1 代码依赖方向

项目总体遵循单向依赖：

```text
client UI
  → ctx.remote.lab.*
    → lib/remote.js
      → lib/* Cordis services
        → src/* domain logic
          → storage domain / workspace files / external adapters
```

桌面端形成另一条基础设施依赖链：

```text
Tauri main.rs
  → RuntimeManager
    → bundled Node + DSH ibm-lab profile
    → bundled Python + MCP stdio
    → loopback health/API
    → DSH WebView
```

`lib/` 负责副作用和集成，`src/` 尽量承载可测试的纯逻辑；这是当前代码中最重要的可维护性边界。`client/src/` 是前端源码，`client/index.js` 是构建产物，两者必须通过 `build:client` / `check:client` 保持一致。

### 4.2 外部依赖

| 类别 | 依赖 | 接入方式 | 失败时行为 |
|---|---|---|---|
| Harness | DeepSeek Harness 0.1.5-rc.1 | peer dependency + profile bundle | 无宿主则插件不能运行 |
| Node 运行库 | `zod`、`js-yaml`、`jszip`、`fast-xml-parser` | npm/pnpm | 启动前随包固定 |
| 科研技能 | 固定提交的 Nature Skills | filesystem skill provider | 锁文件和版本登记保证可追溯 |
| Python | 内置/隔离 Python 与锁定依赖 | 子进程 | 明确 preflight，不在启动时隐式安装 |
| Origin/Mnova | `origin_mcp`、`mnova_mcp` | MCP stdio | 诊断并明确降级，不伪造结果 |
| LibreOffice | Office → PDF 预览 | 子进程 | 预览能力受限，但原文件不应被篡改 |
| 文献来源 | OpenAlex、Crossref、PubChem、出版社页面等 | HTTP/API/授权浏览器 | 保留来源状态和人工回退路径 |

### 4.3 数据依赖与所有权

系统的数据所有权分为三类：

1. **领域记录**：项目、搜索、来源包、报告、PPT、合成路线、NMR、表征任务等，存于独立 storage domain 表。
2. **版本化配置**：核心记忆、阅读目标、笔记/PPT/实验方案模板，使用 `id@version` 或单调版本，不覆盖历史。
3. **二进制与科研文件**：保存在课题 workspace 或受控目录中，记录 SHA-256、来源、模型、技能版本和时间。

`ArtifactProvenance` 不等同于文件本身。它提供“这份文件如何产生”的来源链；人工审核记录则回答“哪一个文件哈希被批准”。两者结合后，旧文件的批准不能自动套用到新文件。

## 5. 关键动态流程

### 5.1 启动流程

1. Tauri 解析应用数据目录与打包资源目录。
2. 创建独立的 `DSH_HOME`、日志、状态和 workspace 目录。
3. 物化 `ibm-lab` profile，并确保 bundle 顺序为 base、web-app、lab-agent。
4. 根据用户配置生成可选 MCP patch。
5. 选择本机空闲端口，以 `--host 127.0.0.1` 启动内置 DSH。
6. 从子进程输出提取带令牌的启动 URL，并执行回环 HTTP 健康检查。
7. 健康检查通过后，WebView 打开 DSH UI；失败时保留日志并报告可诊断错误。

关键源码：[`desktop/src-tauri/src/runtime/process.rs`](../desktop/src-tauri/src/runtime/process.rs)、[`health.rs`](../desktop/src-tauri/src/runtime/health.rs)、[`dsh.rs`](../desktop/src-tauri/src/runtime/dsh.rs)。

### 5.2 课题与会话流程

1. 用户在工作台创建课题。
2. `labTasks` 创建课题记录、独立 workspace 目录和核心记忆初始版本。
3. Client 确认 Harness workspace 存在，并建立 workspace → project 绑定。
4. 创建新会话并选择 `lab-research` 预设；预设在会话运行后锁定。
5. Agent 通过会话绑定或 cwd 反查课题，并读取版本化核心记忆。
6. 更新核心记忆时新增版本，不直接覆盖旧记录。

### 5.3 文献到交付流程

完整流程图：[`ibm-agent-workflow.html`](ibm-agent-workflow.html)

主链为：确定课题目标 → 检索与选文 → 准备来源包 → Agent 生成精读/PPT → 暂存并自检 → 人工审核与下载。

重要支线包括：

- 原文缺失时，使用用户本人授权的浏览器会话或一次性捕获令牌补齐 PDF/SI；
- 自动审计结果只作为提示，不自动批准或拒绝科研内容；
- 人工拒绝后进入修订闭环，历史文件和审核记录保留；
- 报告待审时允许继续制作 PPT，但两个产物分别审核、分别绑定哈希。

### 5.4 动态调用时序

完整时序图：[`ibm-agent-sequence.html`](ibm-agent-sequence.html)

调用链分成三段：

- **创建任务**：研究人员通过工作台调用 Remote/领域服务，服务创建 `pending` 记录和目标快照。
- **执行与取证**：Agent 获取任务上下文，访问科研来源，调用 MCP/Python/JS 工具，形成结构化结果和文件。
- **暂存与审核**：Agent 使用 `complete*` 登记产物，服务保存哈希、provenance 和 `under-review` 状态，最后接收人工决定。

### 5.5 NMR 生命周期

完整状态图：[`ibm-agent-lifecycle.html`](ibm-agent-lifecycle.html)

主状态为：

```text
prepared → under-review → approved-written → visually-verified
```

- `prepared`：登记原始 FID 和结构路径，路径开始受不可变保护。
- `under-review`：草稿积分可修订，等待研究人员审核。
- `approved-written`：积分计划被冻结，并写回 Mnova。
- `visually-verified`：研究人员完成视觉复核。
- 任一审核/复核失败都通过 `reopenReview` 返回 `prepared`，而不是覆盖已批准计划。

## 6. 安全与可信性设计

### 6.1 网络和桌面边界

- DSH 仅监听 `127.0.0.1`，健康检查拒绝非回环地址或意外端口。
- 桌面 API Key 使用当前 Windows 用户的 DPAPI 加密保存。
- Tauri capability 只授予主 WebView；外部 WebVPN 页面不能获得任意 IPC 命令面。
- 外部页面导航经过允许主机策略；机构身份认证由用户本人完成。

### 6.2 文件和路径边界

- 课题文件限定在对应 workspace 或受控数据目录内。
- 上传、下载、预览和转换前执行路径、扩展名、大小或内容校验。
- Office 二进制通过同源 HTTP 流传输，避免大型 base64 经 JSON 边界截断。
- 原始 FID、结构文件路径和已批准积分计划具有不可变约束。

### 6.3 人工门禁

- 路线锁定从通用 Remote/Agent 接口移出，只允许可信 UI 用户动作端点调用。
- 文档和 PPT 下载要求人工审核状态为 approved，且审核哈希与当前文件哈希一致。
- CAS/SciFinder 在没有书面授权时不自动操作，也不把受限内容送入模型。
- 实验计划只到 `approved/rejected`，没有自动执行、自动采购或仪器控制状态。

## 7. 测试、构建与发布架构

项目的验证面覆盖：

- Node 单元与集成测试；
- 浏览器专项测试；
- Python Native Bridge 测试；
- 回归用例与 golden diff；
- ESLint；
- Rust/Tauri 单元测试；
- Windows 运行时准备、Web 冒烟、NSIS 构建和安装包验证。

发布脚本是串行流水线，原因是运行时资源准备、客户端构建和安装包目录存在共享写入点。发行物还通过 lock、SHA256SUMS 和 `release-report.json` 记录依赖与结果。

## 8. 主要发现与风险

### 8.1 优点

1. **插件式叠加**：不修改 Harness 核心，升级边界清晰。
2. **业务与模型解耦**：模型负责推理，宿主负责状态、文件和门禁。
3. **版本与 provenance 完整**：核心记忆、目标、模板和科研产物都有历史或来源链。
4. **本地优先**：敏感科研文件保留在用户机器，科学软件通过本机桥接。
5. **失败显式化**：RDKit、MCP、浏览器授权和 Office 预览不可用时明确降级，不静默伪造结果。

### 8.2 风险与技术债

| 优先级 | 风险 | 影响 |
|---|---|---|
| 高 | 文档中的稳定版本、安装默认版本和版本锁定表存在 0.4.3/0.4.5 漂移 | 容易造成错误发布或诊断结论 |
| 高 | `cordis.patch.yml` 注册约 25 个 `lab-*` 行，服务顺序和注入关系较密集 | 重复装载或漏注入会导致整进程启动失败 |
| 高 | `lib/remote.js` 暴露约 150 个方法定义/辅助方法行 | 前端与宿主耦合面宽，变更和权限审计成本高 |
| 中 | Client 同时维护源码和单文件构建产物 | 未执行 `check:client` 时可能出现源码/产物漂移 |
| 中 | JSON domain + workspace 文件形成双存储事实 | 崩溃或手工移动文件后需要一致性修复工具 |
| 中 | Windows 发行包内置 Node、DSH、Python、插件和查看器 | 构建体积大，供应链与升级验证复杂 |
| 中 | 机构下载和本地商业软件依赖真实环境 | CI 无法完全覆盖，需要目标机器验收清单 |
| 低 | 领域功能集中在同一 bundle | 长期可能增加启动时间和模块认知负担 |

## 9. 建议的演进路线

### P0：发布一致性

1. 用一个机器可读版本源生成 README、运行时清单、桌面 manifest 和发布说明中的版本字段。
2. 在 CI 中校验 `package.json`、`runtime/versions.env`、锁文件和 release manifest 一致。
3. 为 `ibm-lab` profile 增加启动前的 bundle 去重与服务注册审计输出。

### P1：接口与数据可靠性

1. 将 `lib/remote.js` 按 projects、literature、chemistry、synthesis、characterization 拆成独立 facade，并生成客户端类型。
2. 为“记录写入 + 文件原子提交 + provenance”建立统一事务/恢复协议或 outbox。
3. 增加 workspace 文件索引重建、孤儿文件扫描和哈希一致性修复命令。
4. 在任务、Remote 调用、Agent 会话和本地工具调用之间贯穿统一 trace ID。

### P1：安全回归

1. 增加“文件改变后旧批准立即失效”的端到端用例。
2. 增加 Tauri 外部 WebView 无 IPC 权限的打包后自动验证。
3. 对一次性捕获令牌补充并发重复提交、过期和错误 MIME 的压力测试。

### P2：模块化与可观察性

1. 把文献、合成、表征拆成可选 bundle 或明确的子模块边界，降低默认启动面。
2. 为每个领域服务输出健康状态、版本、存储迁移版本和依赖能力矩阵。
3. 将真实 Origin/Mnova/机构访问验收结果结构化写入 release report。

## 10. Archify 交付与验证记录

| 图 | 规格 SHA-256 | HTML SHA-256 | Showcase | 浏览器证据 | 人工观感复核 |
|---|---|---|---|---|---|
| 架构 | `8893ffdf…c0484` | `d673ea19…79883` | 9/9，0 错误，0 警告 | 通过 | 通过（亮/暗主题） |
| 工作流 | `b7b0a459…bd330` | `10f6fac5…0098` | 9/9，0 错误，0 警告 | **失败：1440×900 高度超出 24px** | **失败：结论卡底部被首屏裁出** |
| 时序 | `3c4b7ec1…8faa2` | `2ac08770…d6eb7` | 9/9，0 错误，0 警告 | 通过 | 通过（亮/暗主题） |
| 数据流 | `533a3991…a70ed` | `ce5747eb…e9bde` | 9/9，0 错误，0 警告 | 通过 | 通过（亮/暗主题） |
| 生命周期 | `5bf00e17…65f39` | `069ec8f0…03f6` | 9/9，0 错误，0 警告 | 通过 | 通过（亮/暗主题） |

所有通过的浏览器证据覆盖 1440×900、1600×1000、1920×1080 和 2048×1320，并检查亮/暗主题截图。工作流图已经完成 Archify 允许的两轮聚焦视觉修正，因此保留确定性验收通过、浏览器证据失败的真实状态，不通过隐藏溢出或缩小字体伪造通过。

## 11. 图表入口

- [总体软件架构](ibm-agent-architecture.html)
- [文献到科研交付工作流](ibm-agent-workflow.html)
- [科研任务动态调用时序](ibm-agent-sequence.html)
- [科研数据与证据依赖关系](ibm-agent-dataflow.html)
- [NMR 数据集审核生命周期](ibm-agent-lifecycle.html)

每个 HTML 都是自包含交互式查看器，支持亮/暗主题、缩放、搜索、聚焦、关系追踪、引导视图和导出。
