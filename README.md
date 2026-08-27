# dsh-lab-agent

课题组本地科研 Agent —— 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
的独立插件包（不修改 Harness 核心），文献能力直接集成
[nature-skills](https://github.com/Yuan1z0825/nature-skills)（固定 commit、Apache-2.0），
本插件负责 Skill 路由、任务编排、版本登记、模板管理与回归质检。

首期面向：**聚前药与高分子材料设计**。

## Linux 一行安装并启动

支持 Ubuntu/Debian 的 x86_64 与 arm64。下面一条命令会安装原生渲染依赖，
在用户目录内建立隔离的 Node.js、DSH、pnpm 与 Python 3.12 环境，安装本插件，
完成配置自检，并在 `127.0.0.1:3080` 启动 Web 界面：

```bash
curl -fsSL https://raw.githubusercontent.com/cyx1874cyx/iBM-Lab-Agent/main/install.sh | bash -s -- --start
```

安装系统包时会正常请求 `sudo`；Node、DSH、pnpm、Python 及 Python 包都装在
`~/.local/share/ibm-lab-agent/` 与 `~/.dsh/`，不会修改系统 Python。安装后常用命令：

```bash
ibm-lab-agent status       # 服务与 HTTP 状态
ibm-lab-agent logs -f      # 跟踪启动日志
ibm-lab-agent doctor       # 完整环境自检
ibm-lab-agent restart      # 重启
ibm-lab-agent stop         # 停止
ibm-lab-agent dsh --help   # 直接调用发行版内固定的 DSH
```

默认锁定 Node.js 24.16.0、DSH 0.1.1-rc.2、pnpm 10.34.5、Python 3.12.11，
同时安装 MarkItDown、PyMuPDF、python-pptx 与 RDKit。完整版本与校验值见
[`runtime/versions.env`](runtime/versions.env)，系统包清单见
[`runtime/apt-packages.txt`](runtime/apt-packages.txt)。模型密钥不属于发行包；
首次打开页面后请在 DSH 设置中填写自己的模型服务配置。

安装器是幂等的；再次执行会装入一个新版本目录，验证成功后再切换 `current`
软链接。常用可选参数：`--ref <tag>`、`--dsh-home <path>`、
`--skip-system-deps`、`--no-python-extras`、`--no-dsh-patch`、
`--keep-default-preset`。查看全部参数：

```bash
curl -fsSL https://raw.githubusercontent.com/cyx1874cyx/iBM-Lab-Agent/main/install.sh | bash -s -- --help
```

## 源码开发与手动部署

```bash
# 依赖：Node.js >= 20、Python 3.10–3.12、pnpm、LibreOffice
sudo bash runtime/install-ubuntu.sh
npm ci --omit=peer --legacy-peer-deps
node scripts/dev-link.mjs
node scripts/install.mjs --strict
node scripts/lab-doctor.mjs
npm run test:all
dsh plugin --profile web add "$PWD"
dsh web
```

之后新会话选择 **iBM科研Agent** preset，nature skills
（`nature-academic-search`、`nature-reader`、`nature-paper-card`、
`nature-paper2ppt`、`nature-shared`）即出现在 skill 目录中。

Web 侧边栏左上角的 **iBM Agent / based on DSH** 品牌区就是科研课题入口，
底部不再重复显示“我的科研课题”按钮。首页只负责选择或新建课题；每个课题
包含一份可提交新版本的核心课题 Markdown，并以它作为科研 Agent 对话的项目
记忆。安装插件后，Harness 展开侧栏的左上角品牌区会显示人像 Logo，
折叠侧栏与会话课题徽章继续使用实验室烧瓶 SVG，
首页主视觉也使用人像 Logo，并将品牌标语统一为“专注源头创新”，
原有 DeepSeek Harness wordmark 与鲸鱼图标被隐藏（不修改 Harness 核心，
由 client 插件 CSS/DOM 覆盖）。**创建课题时插件会自动**：为课题建独立工作区目录
（`$DSH_HOME/lab-agent/projects/<项目id>`，作为 Harness 独立 workspace，
并按课题名重命名）、开一个新对话、自动选择 **iBM科研Agent**
agent preset，并把当前版本核心记忆**落盘为课题工作区根目录的 `项目记忆.md`**，
开场提示 agent 读取该文件（不把整份记忆塞进输入框）。
绑定是**工作区级**的：一个课题一个专属 workspace，空间内所有对话共享课题
标识与核心记忆——在该空间里手动新建的对话同样显示课题徽章、共享同一份核心
记忆（按 cwd 自动识别课题）。进入课题后可按三个板块查询对话产物：**文献资料**
（检索汇总、精读报告、文献 PPT）、**研究设计**（工作规划、实验方案、合成
路线）和**表征分析**（NMR/结构结果及人工审核状态）。对话界面也做了定制：
每个对话的会话头部都显示当前课题徽章（点击回到课题空间），输入框上方显示
课题记忆提示条。
整个界面通过 client 插件叠加在 Harness 上，不修改 Harness 核心。

科研 Agent 对话里还可直接调用 **`lab_project_memory_read` / `lab_project_memory_update`**
模型工具读写课题核心记忆（自动按会话定位课题）：总结/进展归档请用
`lab_project_memory_update` 提交新版本（版本化数据行、带 changeNote 与哈希，
面板可见、后续对话自动加载）——每次提交都会**同步重写课题工作区的
`项目记忆.md`**，agent 在对话里读取的就是这份文件（不是孤立文件）。
这两个工具连同 `lab_convert_document` **只挂在 lab-research 预设工具层**，
standard 等其他模式看不到 lab 工具，避免误调用。

**关于"模式切换"**：Harness 的 Agent 预设（模式）只在**空白新会话**上生效，
会话一旦开始运行就固定、无法中途更换（官方约束 `agent-preset-locked`）。
插件会把 DSH 的**默认预设设为 `lab-research`**（`$DSH_HOME/settings.yaml` 的
`agent-presets.default`），因此**所有新会话默认就是科研 Agent 模式**，无需
切换；课题空间的「开始科研 Agent 对话」在此基础上进课题工作区、开场提示
读取 `项目记忆.md`。不要在已开始的会话里要求"切换模式"（会被拒绝）。
若需恢复默认，把 `agent-presets.default` 改回 `standard` 并重启 `dsh web`。

## 阶段一验证记录（2026-08-17）

| 项 | 结果 |
|---|---|
| nature-skills 固定 commit | `c171989db699bd601d4373912b3fb8db96ecc95b`，690 文件 / 40.4MB 完整树 |
| 单元测试 | 21/21 通过 |
| 集成测试（真实 boot：registry CRUD、skill 发现、preset 组合） | 4/4 通过 |
| 回归套件 | 4/4 通过，已记录回归日期（vendor.lock.json `regression.lastPassedAt`） |
| profile 组合 | `dsh --profile web --patch cordis.patch.yml --dump-config` 三行均正确插入 |
| 安装演练（临时 DSH_HOME） | vendor 物化/幂等、preset 安装、19 条 NatureSkillVersion 登记成功 |
| golden-diff 脚手架 | `--old <sha> --new <sha>` 下载两棵树并输出结构化差异报告 |

## 阶段二验证记录（2026-08-17）

| 项 | 结果 |
|---|---|
| 单元测试（含 pptx 解析/目标 schema/模板映射） | 35/35 通过（合计 41/41） |
| 集成测试（目标 CRUD/快照/删除语义、三模板导入/确认/无效拒绝） | 5/5 通过（合计 6/6） |
| 回归套件 | 6/6 通过（新增 `goal-profile`、`ppt-template` 用例） |
| PPTX 解析 | 三模板（16:9/4:3、三套主题色/字体、3–5 布局）比例/主题/布局/占位符识别正确 |
| 版式角色 | 11 角色建议映射全覆盖且指向存在的布局；无效映射 `confirmMapping` 拒绝、模板保持 draft |
| 快照语义 | update 后旧版本与任务快照不变；删除后 `resolve(id@version)` 仍可读；id 不复用 |
| profile 组合 | `--dump-config` 含 5 个 lab 服务行（新增 lab-goal-profiles / lab-ppt-templates） |

## 阶段三验证记录（2026-08-17）

| 项 | 结果 |
|---|---|
| 单元测试（executor 定位/python 解析 + 真实脚本审计） | 14/14（合计 49/49） |
| 集成测试（全流程状态机 + 门禁阻止） | 3/3（合计 9/9） |
| 回归套件 | 7/7（新增 `task-flow` 用例，真实 audit_paper_card.py / audit_pptx_quality.py） |
| 真实脚本门禁 | pass fixture exit 0 / 缺节 fixture exit 1（errors=1）；干净 pptx QA 0 发现 |
| provenance | 每 run 一条（search/source-bundle/reading-report/presentation），输入哈希 + skill 版本齐全 |
| profile 组合 | `--dump-config` 含 6 个 lab 服务行（新增 lab-tasks） |

## 阶段四验证记录（2026-08-17）

| 项 | 结果 |
|---|---|
| 单元测试（元素/分子式/MW、聚合物指标、模型/状态机、PubChem/RDKit 降级） | 21/21（合计 72/72） |
| 集成测试（实体/来源性质/计算/计划门禁/人工审核-only 状态机） | 2/2（合计 11/11） |
| 回归套件 | 8/8（新增 `chemistry` 用例） |
| 分子式计算 | C27H29NO11（阿霉素）MW ≈ 543.52 g/mol；括号重复单元 (C6H8O2)10 正确展开 |
| 来源区分 | db-measured（PubChem CID）/ computed（RDKit/公式）/ model-predicted 查询可同时返回 |
| 实验计划 | 缺安全/表征创建拒绝；`executing` 状态被状态机拒绝（仅人工审核） |
| RDKit 降级 | venv 无 rdkit 时 `rdkitProperties` 返回 `available:false` + 原因，不静默给数值 |
| profile 组合 | `--dump-config` 含 7 个 lab 服务行（新增 lab-chemistry） |

## 阶段五验证记录（2026-08-17）

| 项 | 结果 |
|---|---|
| 单元测试（积分公式 + 状态机/不可变模型） | 10/10（合计 84/84） |
| 集成测试（工作流全流程 + 冻结/打回保留历史 + 计算门禁） | 2/2（合计 13/13） |
| 回归套件 | 9/9（新增 `nmr` 用例） |
| 积分计算 | 组成 2/3、转化率 0.9、端基 DP 50、取代度 2.5%、载药量推算均通过校验 |
| 不可变保护 | approve 后再次 approve / 改草稿均拒绝；打回保留 approvedIntegrals 历史 |
| mnova-mcp | 配置模板 + skill 安装脚本（GitHub raw 退避重试）；本环境无 Mnova，实际 MCP 连接为部署步骤 |
| profile 组合 | `--dump-config` 含 8 个 lab 服务行（新增 lab-nmr） |

## 阶段六验证记录（2026-08-17）

| 项 | 结果 |
|---|---|
| 单元测试（合成模型/状态机、开放数据适配器、CAS 边界） | 12/12（合计 98/98） |
| 集成测试（路线全流程 + 证据收集 stub + CAS 未授权门禁） | 2/2（合计 15/15） |
| 回归套件 | 10/10（新增 `synthesis` 用例） |
| 开放数据 | PubChem/PatentsView/OpenAlex 三类证据聚合；专利源适配器可插拔（api.patentsview.org 迁移至 USPTO ODP，按端点封装） |
| CAS 边界 | 未授权时只返回 prepared query（`executed:false`）/登录入口；`CasProvider` 全部操作被 `CasAuthorizationError` 拒绝 |
| profile 组合 | `--dump-config` 含 9 个 lab 服务行（新增 lab-synthesis） |

## 阶段七验证记录（2026-08-18：项目驱动科研工作台 + 文档转换）

| 项 | 结果 |
|---|---|
| 单元测试（含 client 描述符/harness-surface、markitdown 探测降级） | 89/89（合计 98+89 维护基线，`npm test` 全绿） |
| 集成测试（课题 CRUD/工作区/核心记忆/绑定、remote gateway、文档转换） | 21/21（`npm run test:all` 110/110） |
| 回归套件 | 11/11（新增 `convert` 用例，真实 audit 脚本门禁仍通过） |
| Web 管理界面 | 浏览器 client 插件（不修改 Harness 核心）：左上角 iBM Agent 品牌课题入口、课题首页/空间、三板块产物看板、核心记忆编辑器与版本历史、会话课题徽章 + 输入框记忆提示条 |
| 课题自动启动 | 建课题 → 独立 workspace（`$DSH_HOME/lab-agent/projects/<id>`，按课题名重命名）+ 新会话 + lab-research 预设 + 核心记忆落盘「项目记忆.md」供 agent 读取 |
| 工作区级绑定 | 空间内所有对话（含手动新建）按会话绑定/cwd 识别课题，共享同一份核心记忆 |
| 核心记忆工具 | `lab_project_memory_read/_update` 模型工具自动按会话定位课题，版本化写入（changeNote + 哈希），面板可见 |
| 工具作用域 | lab 工具只挂 lab-research 预设工具层，standard 等预设不可见；不在全局 toolOrder 引用未注册工具（修复"标准模式链接不上模型"） |
| 文档转换 | markitdown（microsoft/markitdown）PDF/Office/图片 → Markdown + 转换登记；不可用时清晰降级（`--check` 权威探测，不用 pip list/which 误判） |
| profile 组合 | `--dump-config` 含 11 个 lab 服务行（新增 lab-convert / lab-remote） |

## 阶段八验证记录（2026-08-18：模式修复与作用域收口）

| 项 | 结果 |
|---|---|
| 科研模式失效根因 | ① `agentPresets.select` 的 wire 返回 `{ result }` 不 throw，原代码只 catch throw 未查 `result.ok`，预设切换失败被静默吞掉；② lab 工具注册在 host 平面，standard 会话误调用触发 stream failed |
| 修复 | client `selectResearchPreset` 检查 `result.ok`（含 `agent-preset-locked`）；lab 工具移入 lab-research 预设工具层；persona 新增第 8 条说明预设一轮后固定 |
| 作用域收口 | 移除全局 `system-prompt.toolOrder` 对 `lab_convert_document` 的引用（未注册工具名会让 Harness 拒绝启动）；convert/memory 工具行集中在 preset |
| 回归 | 110 单元+集成 / 11 回归全绿；部署 preset 与仓库一致 |

## 阶段九验证记录（2026-08-20：主面板模板管理：阅读笔记 + PPT 模板）

| 项 | 结果 |
|---|---|
| 主面板「模板管理」 | Home 首页新增「模板管理」入口，两标签页（阅读笔记模板 / PPT 模板）；返回原课题首页导航 |
| 阅读笔记模板 | labNoteTemplates 服务（创建/编辑/复制/删除/生成要求，版本不可变 id@version，快照永远可读）；模板章节骨架/受众/语言/篇幅/风格规则/证据与来源/输出要求 |
| 生成时按模板 | 精读报告登记时把所选阅读笔记模板**快照**写入 ReadingReport（`noteTemplateSnapshot` + `noteRequirements`），后续模板修改不影响旧报告；缺省用内置 `note-default`，Agent 生成阅读笔记按模板章节骨架组织 |
| PPT 模板 | labTemplates：上传 .pptx → 解析页面比例/主题/布局/占位符 → 自动角色映射建议 → 逐角色确认 → 验证后发布；元数据编辑（名称/受众/用途/备注/最大篇幅）/ 预览 / 验证/ 归档 |
| Agent 参考模板工具 | `lab_note_templates_list/get`、`lab_ppt_templates_list/get` 四个只读工具挂 lab-research 预设；persona 第 10 条「按模板生成」引导（先查询再生成、登记时指定模板版本）|

- **插件骨架**：bundle patch 层（`cordis.patch.yml`）+ host 服务
  （`ctx.labVersions` 版本登记、`ctx.labPython` Python 环境）+ 部署脚本。
- **Skill 发现/路由**：`lab-skill-filesystem` host provider 把 nature skills
  注册进 global skill layer；`presets/lab-research/` 提供课题组 agent 组合。
- **版本登记**：`NatureSkillVersion`（repo commit、manifest 版本、license、
  python 锁哈希、回归日期），持久化于 `lab_agent` storage domain。
- **Python 环境**：固定 venv + `requirements.lock`（sha256 锁定），显式引导。
- **回归框架**：`catalog / registry / harness-pin / python-lock` 用例 +
  跨 commit `golden-diff` 脚手架。

## 阶段二交付内容

- **精读目标系统**（`ctx.labGoals` / `ReadingGoalProfile`）：可创建/保存/复制/
  修改/版本化；内置 `default-prodrug-polymer` 聚前药默认配置（§三 七组内容）；
  `toPaperCardRequirements` 转换为 nature-paper-card 重点审查要求，01–16 节
  契约永远保留；任务引用版本快照，删除后历史仍可读。
- **PPT 模板系统**（`ctx.labTemplates` / `PptTemplateProfile`）：PPTX 导入
  （`src/pptx-parse.js` 解析页面比例/主题色/字体/母版/布局/占位符）→ 11 个
  版式角色自动映射建议 → 预览/填充示例 → 用户确认；模板与映射只作格式参考，
  兼容性检查显示提醒但不作为文献产物生成/审核门禁。
- 依赖：`jszip` / `fast-xml-parser`（纯 JS，跨平台，无需 Python）。

## 阶段三交付内容

- **任务编排**（`ctx.labTasks`，§六 接口）：`searchLiterature` / `preparePaper` /
  `createReadingReport` / `validateReadingReport` / `createPresentation` /
  `validatePresentation` + 完成/查询接口；`LabProject` 保存目标/模板版本快照。
- **执行层**（`src/skill-executor.js`）：直接调用 nature-skills 的 stdlib 脚本
  （OpenAlex 检索、引用导出、源包准备、精读审计、PPTX 质量审计）——系统
  python3 即可运行，无需 venv。
- **暂存—预览—人工审核—下载**：实际 DOCX/PPTX 自动进入课题文献条目，
  LibreOffice 将原文件渲染为右侧 PDF 分页预览；自动自查只作提醒。人工审核
  记录绑定源文件 SHA-256，只有审核通过且哈希未变化时才开放原文件下载。
- **微信公众号文献入口**：在科研 Agent 对话中粘贴
  `https://mp.weixin.qq.com/s...`，Agent 读取并提取页面明确展示的论文元数据，
  通过 `lab_tasks_register_wechat_paper` 直接加入「文献精读」并标记“待上传
  PDF”。此步骤不下载 PDF、不把公众号导读当作全文证据；后续人工上传原文时
  复用原 `bundleId`/`reportId`，避免生成重复条目。
- **持久化**（`lab_tasks` domain）：LabProject / LiteratureSearchRun /
  PaperSourceBundle / ReadingReport / PresentationRun / ArtifactProvenance
  （输入哈希 + skill 版本 + 模型 + 时间，每条产物可追溯）。

## 阶段四交付内容

- **化学实体**（`ctx.labChemistry`）：小分子 / 单体 / 重复单元 / 聚合物 /
  聚前药对象（聚合策略/骨架、连接方式/连接臂/释放机制字段）。
- **带来源性质**：`db-measured`（PubChem 等数据库实测）/ `computed`（计算）/
  `model-predicted`（模型预测）严格区分；`queryProperty` 返回全部来源。
- **计算层**：分子式→分子量、Đ/DP/载药量/取代度等**纯 JS 离线可测**；RDKit
  （venv 可选）SMILES 级 MW/logP/TPSA/HBD/HBA，不可用时明确降级；PubChem
  开放数据查询（网络）。
- **实验方法计划**：目标/规模/试剂/仪器/文献证据/计量表/步骤/监测/后处理/
  纯化/表征/安全/备选方案；完整性与安全校验（缺安全/表征拒绝）；状态机仅到
  人工审核（`draft→under-review→approved|rejected`，无 executing）——
  **不控制仪器、不自动采购**。

## 阶段五交付内容

- **NMR 工作流**（`ctx.labNmr`）：NmrDataset 状态机"准备—人工审核—写回—
  视觉质检"；原始 FID/结构与**已审核积分计划不可覆盖**（冻结/打回保留历史）。
- **聚合物积分计算**（纯公式离线可测）：共聚组成、转化率、端基 DP、取代度、
  由取代度推算载药量——只接受已审核积分，全部标记 computed + 公式来源。
- **mnova-mcp 集成**：Harness MCP Client 配置模板 `presets/mcp/mnova-mcp.patch.yml`
  （stdio，`uv run run_server.py`）+ `scripts/install-nmr-skill.mjs` 安装
  nmr-analyze-simulate skill 到 `$DSH_HOME/skills/`；agent 通过 `mcp__mnova__*`
  工具与 Mnova 交互（需本机 Mnova 环境，部署时启用）。

## 阶段六交付内容（开放数据首版）

- **合成路线分析**（`ctx.labSynthesis`）：SynthesisTarget / SynthesisRoute
  （多步：反应/反应物/产物/试剂/条件/文献与专利引用）；人工审核状态机
  （`draft→under-review→approved|rejected`，不自动执行合成）。
- **开放数据执行器**：PubChem 化合物（复用阶段四）、USPTO PatentsView 专利
  （无 key 适配器，可插拔端点）、OpenAlex 文献（nature-academic-search）。
- **CAS 安全边界**（`src/cas/boundary.js`）：未获书面授权前**不自动操作或
  读取 SciFinder、不把 CAS 内容输入模型**——只准备结构/查询 URL 与登录入口
  （`executed:false`）；`CasProvider` 占位接口全部经授权门禁拒绝；获得明确
  API+LLM 授权后再启用 OAuth2 PKCE 与独立 CAS Provider。

## 阶段七交付内容（项目驱动科研工作台）

- **课题（LabProject）**（`lib/tasks.js` / `src/task-models.js`）：创建课题时
  自动建独立工作区目录（`$DSH_HOME/lab-agent/projects/<id>`）→ 注册 Harness
  workspace（按课题名重命名）→ 新会话 + lab-research 预设 + 核心记忆落盘「项目记忆.md」供 agent 读取。
- **工作区级绑定**：`projects_bind_workspace/bind_session/binding/by_session/
  by_workspace/by_cwd` 让空间内所有对话按会话绑定或 cwd 识别课题；绑定关系
  持久化于 `lab_tasks` domain `project_bindings` 表。
- **核心记忆模型工具**（`lib/memory-tool.js`）：`lab_project_memory_read` /
  `lab_project_memory_update` 自动按会话定位课题，版本化写入（changeNote +
  哈希）；persona 第 6 条强制引导走正道，禁止发明孤立记忆文件。
- **Web 管理界面**（`client/index.js` + `lib/remote.js`）：lab Remote bridge
  经 Typert Gateway（source-mode discovery）暴露 9 个 lab 服务；浏览器 client
  渲染左上角 iBM Agent 品牌课题入口、课题首页/空间、三板块产物看板、核心记忆编辑器
  与版本历史、会话课题徽章 + 输入框记忆提示条。全部叠加在 Harness 之上，
  不修改 Harness 核心。
- **文档转换**（`lib/convert.js` / `lib/convert-tool.js` / `src/markitdown.js`）：
  markitdown（microsoft/markitdown）把 PDF/Office/图片转 Markdown 存
  `lab-agent/converted/` 并登记；`lab_convert_document` 工具 + `--check`
  权威探测 + 不可用时明确降级。

## 部署环境与安全约定

- 默认 Windows 10/11 本地运行，Web UI 仅监听 `127.0.0.1`；所有 PDF/报告/PPT 存本地。
- 可调用云模型，但发送前显示数据范围。
- 调用云端模型、写入 registry、升级锁定版本均为显式动作；启动不做任何安装。
- **CAS/SciFinder**：未获得额外书面授权（含 API 与 LLM 使用授权）前，不自动
  操作或读取 SciFinder 页面、不把 CAS 内容输入模型；CAS 插件仅准备结构/查询
  并打开登录入口（见 `src/cas/boundary.js` 与 `docs/ARCHITECTURE.md` §10）。
  授权确认后，启用独立 CAS Provider + OAuth2 PKCE，单独排期。

## 文档

- `docs/ARCHITECTURE.md` —— 组成模型与本插件叠加内容
- `docs/VERSIONING.md` —— 固定 commit 与手动升级流程
- `docs/REGRESSION.md` —— 回归框架与用例
- `docs/THIRD_PARTY_NOTICES.md` —— nature-skills 第三方声明
- `harness.lock.json` / `vendor.lock.json` —— 锁文件

## 阶段进度

- [x] 阶段一 基础集成
- [x] 阶段二 精读目标与 PPT 模板系统
- [x] 阶段三 文献→PPT MVP（编排/执行层/审计门禁/provenance）
- [x] 阶段四 化学性质与实验计划
- [x] 阶段五 NMR 产品化（工作流/积分计算/mnova-mcp 集成）
- [x] 阶段六 合成路线（开放数据首版）+ CAS 边界（CAS 正式集成待授权后单独排期）
- [x] 阶段七 项目驱动科研工作台（课题空间/核心记忆/文档转换/Web 面板）
- [x] 阶段八 模式修复与工具作用域收口（预设选择失败修复 + lab 工具移入 preset）
