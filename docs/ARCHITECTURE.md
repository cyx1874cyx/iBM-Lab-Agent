# dsh-lab-agent 架构

课题组本地科研 Agent 的 DeepSeek Harness 插件包。**不修改 Harness 核心**：全部能力以
bundle patch 层 + agent preset + 独立服务的形式叠加在既有 profile 之上。

## 1. 组成模型（Harness 侧）

- **Profile** = `$DSH_HOME/profiles/<name>`：`package.json` 里的 `dsh.profile.bundles`
  列出 bundle 包，按序叠加各自的 `cordis.patch.yml`，再叠用户层
  `cordis.patch.yml` 与 `--patch` overlay。
- **Bundle** = 带 `dsh.bundle.patch` 声明的 npm 包。dsh-lab-agent 即一个 bundle。
- **Host 平面 vs Agent 平面**：registry/service（skills、storage、goals 等）留在 host；
  每个会话按 agent preset 组合模型可见的工具与提示词。
- **Skills registry 分层**：host 层 provider 注册进 global layer；preset 层 provider
  注册进该 preset 的 layer；agent 读到 scope 链合并后的目录。`dsh-skill-filesystem`
  只做一级发现：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`。

## 2. 本插件叠加了什么

```
cordis.patch.yml（bundle 层，host 平面）
├── lab-skill-filesystem   @deepseek-ai/dsh-skill-filesystem
│     providerName: lab-nature, includeDefaultRoots: false
│     customSkillDirs: [$DSH_HOME/lab-agent/vendor/nature-skills/skills]
│     → nature skills 进入 global skill layer，任何 agent 的 tool-skill 都能加载
├── lab-version-registry   dsh-lab-agent/version-registry
│     inject: [storageDomain]
│     → ctx.labVersions：NatureSkillVersion 持久化登记
├── lab-python-env         dsh-lab-agent/python-env
│     → ctx.labPython：固定 venv 的预检/引导
├── lab-goal-profiles      dsh-lab-agent/goal-profiles
│     inject: [storageDomain]
│     → ctx.labGoals：ReadingGoalProfile（可保存/复制/修改/版本化的精读目标）
├── lab-ppt-templates      dsh-lab-agent/ppt-templates
│     inject: [storageDomain]
│     config.templatesDir: $DSH_HOME/lab-agent/templates
│     → ctx.labTemplates：PptTemplateProfile（PPTX 导入/映射/预览/验证/发布）
├── lab-tasks              dsh-lab-agent/tasks
│     inject: [storageDomain, labGoals, labTemplates, labVersions]
│     config.skillsRoot: $DSH_HOME/lab-agent/vendor/nature-skills/skills
│     config.projectsRoot: $DSH_HOME/lab-agent/projects（每个课题一个独立工作区目录）
│     → ctx.labTasks：文献→PPT 任务编排（§六 接口 + 状态机 + 审计门禁）+
│       课题（LabProject）CRUD/工作区/核心记忆版本化（项目驱动的科研工作台）
├── lab-chemistry          dsh-lab-agent/chemistry
│     inject: [storageDomain]
│     config.venvDir: $DSH_HOME/lab-agent/.venv
│     → ctx.labChemistry：化学实体/带来源性质/计算/实验计划（§四）
├── lab-nmr                dsh-lab-agent/nmr
│     inject: [storageDomain]
│     → ctx.labNmr：NMR 工作流编排与聚合物积分计算（§五）
├── lab-synthesis          dsh-lab-agent/synthesis
│     inject: [storageDomain]
│     → ctx.labSynthesis：开放数据路线分析 + CAS 安全边界（§七）
├── lab-convert            dsh-lab-agent/convert
│     inject: [storageDomain]
│     config.venvDir: $DSH_HOME/lab-agent/.venv
│     config.convertedDir: $DSH_HOME/lab-agent/converted
│     → ctx.labConvert：markitdown 文档转 Markdown（PDF/Office/图片→MD + 转换登记）
├── lab-remote             dsh-lab-agent/remote
│     inject: [labVersions, labGoals, labTemplates, labTasks, labChemistry,
│              labNmr, labSynthesis, labPython, labConvert]
│     → ctx.lab（TypertRemoteService + @Remote 标记）：把 9 个 lab 服务的能力
│       经 api-gateway 暴露给 Web client（ctx.remote.lab.*，source-mode discovery）
└── （Mnova 实际交互：presets/mcp/mnova-mcp.patch.yml 可选的 MCP client overlay，
     mcp__mnova__* 工具由 agent 调用）

presets/lab-research/（部署到 $DSH_HOME/.agent-presets/lab-research，user trust）
└── agent.cordis.yml + preset.yml
      → iBM 科研 Agent persona + shell/fs/jobs/skills/goal/planning/compaction/
        delegation/ask-user/todo/web 工具组合；lab 工具（lab_convert_document、
        lab_project_memory_read/update）**只挂在 preset 工具层**——standard 等
        其他预设看不到 lab 工具，且不在全局 system-prompt.toolOrder 中引用
        （未注册工具名会让 Harness 拒绝启动）
```

### 为什么 nature skills 走 global layer 而不是 preset 层

- Web 面把 host 的 `skill-filesystem` 行禁用，preset 各自负责本地发现；但
  "deployment-level providers —— repository plugins, a host skill-filesystem row"
  仍注册进 global layer。
- 因此只要 bundle 行 `lab-skill-filesystem` 挂上，**标准 preset 的 tool-skill 立即可见
  nature skills**；lab-research preset 只是再加一层课题组 persona/工具组合。
- `includeDefaultRoots: false` 让该 provider 只看到 nature skills 根，不与
  preset 层的项目/用户 skill 发现混淆。

### 为什么 services 留在 host

- `labVersions`/`labPython` 被安装脚本、回归运行器、未来任务接口共同使用；
  api gateway 与冷读 transcript 都在 host 解析服务。preset 里重复挂载会撞名。

### 项目驱动的科研工作台（课题空间 / 核心记忆 / lab 工具作用域）

- **课题（LabProject）**：`ctx.labTasks.createProject` 建课题时自动做四件事：
  1. 在 `$DSH_HOME/lab-agent/projects/<id>` 建独立工作区目录；
  2. 用 `workspaces.manager.create/rename` 把它注册为 Harness workspace；
  3. 在该 workspace 里 `sessions.create` 新会话并 `agentPresets.select` 科研预设；
  4. 把课题核心记忆写入 `project_memory_versions` 数据行并预填进输入框。
- **工作区级绑定**（`lib/tasks.js`）：课题标识绑定到 workspace 级——
  `projects_bind_workspace/bind_session/binding/by_session/by_workspace/by_cwd`
  让空间内**所有**对话（含手动新建）都能按会话绑定或 cwd 识别课题；绑定关系
  持久化在 `lab_tasks` domain 的 `project_bindings` 表，会话冷读也能解析。
- **核心记忆模型工具**（`lib/memory-tool.js`）：`lab_project_memory_read` /
  `lab_project_memory_update` 两个模型工具优先按当前会话绑定反查课题，未绑定时
  使用会话头中的 cwd 匹配课题工作区（`bySession → byCwd`），
  读写版本化核心记忆数据行（只增不改、changeNote + 哈希）——agent 归档/总结
  走正道，而不是发明 `PROJECT_MEMORY.md` 之类的孤立文件（系统不会加载）。
- **lab 工具作用域**：`lab_convert_document`、`lab_project_memory_*` 只挂在
  lab-research 预设工具层（`presets/lab-research/agent.cordis.yml`），standard
  等其他预设不暴露 lab 工具；且**不在全局 `system-prompt.toolOrder` 中引用**
  ——未注册的工具名会让 Harness 拒绝启动（此前"标准模式链接不上模型"的根因）。
- **浏览器 client**（`client/index.js`）：经 `ctx.remote.lab.*`（Typert Gateway
  source-mode discovery）调用 host 能力；渲染「我的科研课题」侧边栏入口、
  课题首页/空间页、三板块（文献资料/研究设计/表征分析）产物看板、核心记忆
  编辑器与版本历史、会话头部课题徽章与输入框记忆提示条。
- **预设固定约束**：Harness 的 agent 预设只在空白新会话生效、运行后锁定
  （`agent-preset-locked`）；进入科研模式的正道是课题空间「开始科研 Agent
  对话」新开会话，不能中途切换。client 的 `selectResearchPreset` 检查
  `result.ok`，切换失败不再被静默吞掉。

## 3. 数据与持久化

- `NatureSkillVersion` 记录在 `lab_agent` storage domain（`nature_skill_versions`
  表，JSON backend，`$DSH_HOME/storages`），key = `skillName@commitSha`：
  升级不覆盖旧行，历史报告总能解析到引用当时的版本。
- `ReadingGoalProfile`（`lab_goal_profiles` domain）与 `PptTemplateProfile`
  （`lab_ppt_template_profiles` domain）：**版本行不可变**，key = `id@version`，
  version 单调递增。
  - update = 基于最新版本发布新版本；delete = 发布 `archived` 尾部版本
    （从可用列表移除，历史与任务快照永远可读，id 不复用）；
  - 任务用 `snapshotForTask(id, version)` 保存配置快照 —— 后续修改目标/模板
    不会改变旧报告（计划 §三 规则 5/6）。
  - 内置种子：`default-prodrug-polymer`（课题组聚前药默认精读目标）、
    `nature-default`（Nature 默认 PPT 模板），幂等注册。
- PPTX 源文件与解析结果存 `$DSH_HOME/lab-agent/templates/<id>/v<version>/`
  （`source.pptx` + `parse.json` + `mapping-suggestions.json`），domain 行记录
  文件路径与 sha256（ArtifactProvenance 前身）。
- 锁文件：
  - `vendor.lock.json`：nature-skills commit、每 skill 的 manifest 版本、
    license、python 锁哈希、回归日期。
  - `harness.lock.json`：Harness CLI/包版本（固定 commit 的 npm 等价物）。
- 部署数据目录（`$DSH_HOME/lab-agent/`）：
  `vendor/nature-skills`（物化树）、`vendor.lock.json`、`requirements.lock`、
  `.venv`、`templates/`、`converted/`（markitdown 转换产物）、`projects/`
  （课题工作区目录）。`scripts/install.mjs` 幂等物化；`scripts/pin-vendor.mjs` 手动升级。
- 课题相关 domain（`lab_tasks`）：`lab_projects`（课题行 + 目标/模板版本快照）、
  `project_memory_versions`（核心记忆版本行，只增不改）、`project_bindings`
  （会话/工作区/cwd → 课题绑定），以及文献/PPT 产物表与 ArtifactProvenance。
- 手工捕获 domain（`lab_captures`）：`lab_capture_tasks` 表（一次性捕获任务）。
  行字段：id / projectId / bundleId / kind(pdf|si) / publisherUrl / status /
  **tokenSha256（只存哈希，明文仅创建响应返回一次）** / expiresAt / 文件名 /
  大小 / SHA-256 / 错误信息。默认有效期 20 分钟；完成/失败/过期/取消后令牌失效，
  同一令牌只允许成功一次。

## 4. 执行边界

- 启动时不安装任何东西：registry 只读打开，python 只在显式 bootstrap 时安装。
- 写路径只有显式调用：安装脚本 `bootstrapFromVendor`、回归 `--record-pass`、
  升级工具。模型无法静默改动锁定版本。
- 不重写 nature skills 的检索/精读/PPT 流程；本插件只做路由、编排、登记与质检。
- CAS/SciFinder：未获书面授权前不自动操作、不把 CAS 内容送入模型（阶段 6 范围）。

## 5. 目录

```
lib/                  Cordis 服务（version-registry, python-env, goal-profiles, ppt-templates,
                      tasks, remote, artifact-download, manual-capture, index）
src/                  纯 Node 模块（paths, lockfile, skill-catalog, python-env, harness-root,
                      goal-profile, ppt-template, pptx-parse, manual-capture）
presets/lab-research/ 课题组 agent preset 模板
vendor/nature-skills/ 固定 commit 的第三方完整目录（含 vendor.lock.json）
python/               pyproject.toml + requirements.lock
scripts/              install / pin-vendor / dev-link / vendor-fetch / regression(run, golden-diff)
browser-extension/    iBM 文献捕获 Chrome/Edge 扩展（MV3）+ Native Messaging 本地桥接
tests/unit|integration|regression/cases|fixtures(pptx-builder)
docs/                 本目录 + VERSIONING/THIRD_PARTY_NOTICES/REGRESSION/MANUAL_CAPTURE
```

## 6. 阶段二：目标与模板系统（§三/§四）

- **ReadingGoalProfile**：`src/goal-profile.js` 定义字段与转换；`toPaperCardRequirements`
  输出 paper-card 重点审查要求，**固定 01–16 节契约永远保留**（`PAPER_CARD_SECTION_CONTRACT`）；
  用户目标只决定各节深度与强调。需要完全不同的报告结构时，以标准 Paper Card 为证据
  底稿生成派生报告（`derivedReportStructure`），不改动上游 Skill 契约（规则 4）。
- **PptTemplateProfile**：`src/pptx-parse.js` 读取页面比例/主题色/字体/母版/布局/占位符；
  `src/ppt-template.js` 的 `suggestRoleMapping` 按占位符特征对 11 个统一版式角色打分建议；
  `confirmMapping` 验证后才发布为 `ready`；`validate()` 在生成前明确拒绝无效映射，
  不静默替换为默认模板（计划 §四）。用户可主动选择 `nature-default`。
- 模板只控制视觉主题/可用布局/课题组规定页面；内容证据由 nature-paper2ppt 保持
  （阶段三接入）。

## 7. 阶段三：文献→PPT 任务编排（§五/§六）

- **执行分工**：nature skills 是 agentic（LLM 驱动），但含一批 **stdlib-only 机械化脚本**
  （`src/skill-executor.js` 直接调用，系统 python3 即可，无需 venv）：
  | 步骤 | 脚本 |
  |---|---|
  | OpenAlex 检索 | `nature-academic-search/scripts/academic_search.py` |
  | 引用导出 ris/bib/enw | `.../format-converter.py` |
  | 源包准备 | `nature-paper-card/scripts/prepare_paper.py`（source_map JSON 或 PDF†） |
  | 精读自查（提示） | `.../audit_paper_card.py`（结果展示给人工，不阻断） |
  | PPTX 质量自查（提示） | `nature-paper2ppt/scripts/audit_pptx_quality.py`（高风险项仍可人工审核） |

  † PDF 输入需 venv 安装 PyMuPDF；source_map JSON（nature-reader 产物）仅 stdlib。
- **LLM 步骤**（精读报告、PPT 内容）：agent 在会话中执行对应 skill；产物通过
  `completeReadingReport` / `completePresentation` 登记后，实际 DOCX/PPTX 立即
  暂存到课题文献条目。机器自查同步给出提醒，但不决定能否人工审核。
- **微信公众号入口**：`lab_tasks_fetch_wechat_article` 仅取用户明确给出的
  `mp.weixin.qq.com/s` 可见正文，AI 提取可核验字段后调用
  `lab_tasks_register_wechat_paper`。页面未展示 DOI 时，先调用
  `lab_tasks_resolve_wechat_doi`（`resolveWechatPaperDoi` → OpenAlex/Crossref
  检索 + `rankDoiCandidates` 校验，标题相似度/作者姓氏/年份容差打分并分级
  high/medium/low），把 confidence=high 的权威 DOI 随登记一并提交；medium 需
  人工确认，low/检索失败则省略，不猜测。系统创建 metadata-only
  `PaperSourceBundle` 和 pending `ReadingReport`；后续 `preparePaper(bundleId=...)`
  原地补齐 PDF/source-map，精读报告继续复用原 `reportId`。
- **持久化**（`lab_tasks` domain，6 表）：LabProject（目标/模板版本快照）、
  LiteratureSearchRun、PaperSourceBundle、ReadingReport、PresentationRun、
  ArtifactProvenance（输入哈希 / skill 版本 / 模型 / 时间）。
- **接口**（§六）：`searchLiterature` `fetchWechatArticle` `resolveWechatPaperDoi`
  `registerWechatPaper` `preparePaper` `createReadingReport`
  `validateReadingReport` `createPresentation` `validatePresentation` + 完成/查询。
- **人工审核与下载门禁**：条目右侧抽屉通过打包环境中的 LibreOffice 把实际
  DOCX/PPTX 渲染成 PDF 分页预览（无文本/近似降级）。审核记录绑定源文件
  SHA-256；只有当前哈希已人工通过时，条目才开放原 DOCX/PPTX 下载。报告待审
  时仍可继续制作 PPT，两份产物分别审核。

## 8. 阶段四：化学性质与实验计划（§四）

- **实体**（`lab_chemistry` domain，`chemical_entities` 表）：small-molecule /
  monomer / repeat-unit / polymer / prodrug-polymer（聚合策略/骨架、连接方式/
  连接臂/释放机制/连接位点字段）。
- **带来源性质**（`chemical_properties` 表）：`sourceKind` 严格区分
  db-measured（数据库实测，如 PubChem）/ computed（计算，如 RDKit/公式）/
  model-predicted（模型预测）；`queryProperty` 返回全部来源记录。
- **计算分层**：分子式→分子量、Đ/DP/载药量/取代度/理论 Mn 等**纯 JS 离线**
  （`src/chemistry/elements.js`、`polymer-calc.js`）；RDKit（venv 可选，
  `scripts/rdkit/calc.py`）提供 SMILES 级 MW/logP/TPSA/HBD/HBA，不可用时
  明确降级（`rdkitProperties` 返回 `available:false`），绝不静默给数值；
  PubChem REST 开放数据查询（`src/chemistry/rdkit-pubchem.js`，网络）。
- **实验方法计划**（`experiment_plans` 表）：目标/规模/试剂/仪器/文献证据/
  计量表/步骤/监测/后处理/纯化/表征/安全/备选方案；创建前完整性校验（缺
  安全/表征拒绝）；状态机 `draft→under-review→approved|rejected` ——
  **没有 executing 状态**：仅生成待研究人员审核的计划，不控制仪器、不自动
  采购（计划 §四）。

## 9. 阶段五：NMR 产品化（§五/§四）

- **工作流**（`lab_nmr` domain，`nmr_datasets` 表）：NmrDataset 状态机
  `prepared → under-review → approved-written → visually-verified`
  （"准备—人工审核—写回—视觉质检"，§五）；打回 `reopenReview` 回 prepared
  重新积分，已审核积分计划作为历史保留。
- **不可变保护**：原始 FID/结构路径登记后不可变（IMMUTABLE_FIELDS）；已审核
  积分计划冻结（approved 后不可覆盖/修改），符合"原始FID、结构和已审核计划
  不得覆盖"。
- **积分计算**（`src/nmr/integration-calc.js`，纯公式）：共聚组成（I/n 归一
  化摩尔分数）、聚合转化率、端基 DP、取代度、由取代度推算载药量——只接受
  **已审核积分**（approve 前 `calculate` 拒绝），全部标记 computed + 公式来源。
- **mnova-mcp 集成**：Harness MCP Client 配置模板
  `presets/mcp/mnova-mcp.patch.yml`（stdio，`uv run run_server.py`，用户部署
  时启用，依赖本机 Mnova）；`scripts/install-nmr-skill.mjs` 安装其
  nmr-analyze-simulate skill 到 `$DSH_HOME/skills/`（记录来源，不自动更新）。
  agent 通过 `mcp__mnova__*` 工具与 Mnova 交互，本服务只编排与计算。

## 10.5. nature skills 的 PDF/Office 预处理耦合（markitdown）

nature skills 是 agentic 流程，其 SKILL.md 指导模型自写 pdfplumber/pypdf 等脚本
解析 PDF。为统一 PDF/Office 入口，dsh-lab-agent 以**工具层耦合**（不改动上游
SKILL.md）实现：

- `lab_convert_document` 工具（host 注册，`toolOrder` 置顶）被声明为 nature
  skills 的 PDF/Office 预处理耦合点：nature-reader / nature-paper-card /
  nature-academic-search 处理 PDF/Office 输入时**必须先调用它**转 Markdown，
  生成的 `.md` 作为 skill 输入源。
- 权威探测命令：`python3 scripts/markitdown/convert.py --check`（或
  `python3 -c "import markitdown"`）——禁止用 pip list / which / pip show 判断
  （--user 安装且缺 dist-info 时查不到，会误判不可用）。
- 降级路径：markitdown 不可用时明确告知用户并征得同意，才允许临时用系统工具；
  转换完成前不得执行 nature skill 内的 PDF 提取步骤。

## 10. 阶段六：合成路线与 CAS（§七，开放数据首版）

- **数据模型**（`lab_synthesis` domain）：`synthesis_targets`（目标分子，
  可关联化学实体）、`synthesis_routes`（多步路线：反应/反应物/产物/试剂/
  条件/文献与专利引用；证据列表分类型 literature/patent/compound/
  reaction-db）。状态机 `draft→under-review→approved|rejected`（人工审核，
  不自动执行合成）。
- **开放数据执行器**（`src/synthesis/open-sources.js`，可插拔适配器）：
  PubChem（化合物，复用阶段四）、PatentsView/USPTO（专利，无 key）、
  OpenAlex 文献（经 nature-academic-search / skill-executor）；网络路径在
  自动化测试中 stub。**注意**：api.patentsview.org 正迁移至 USPTO Open Data
  Portal（当前 301），适配器按端点封装、可替换默认实现而不改服务契约。
- **CAS 安全边界**（`src/cas/boundary.js`）：`CAS_POLICY = { autoAccess:
  false, llmIngest: false, requiresWrittenAuthorization: true }`——未获书面
  授权前**不自动操作或读取 SciFinder 页面、不把 CAS 内容输入模型**；
  `prepareCasQuery` 只构建 Common Chemistry/SciFinder 查询 URL（executed:
  false），`casLoginEntry` 只返回登录入口；`CasProvider` 为占位接口，所有
  操作经 `assertCasAuthorized` 拒绝；获得明确 API+LLM 授权后再启用 OAuth2
  PKCE 与独立 CAS Provider（本阶段不启用）。

## 11. 手工下载文献自动捕获（Manual Browser Capture）

针对出版社 PDF/SI 需要机构订阅、自动化下载不可行的场景，提供「用户手工下载 +
扩展捕获」通道（详细说明见 `docs/MANUAL_CAPTURE.md`）：

- **服务端**（`lib/manual-capture.js` + `src/manual-capture.js`，`ctx.labCapture`）：
  - 捕获任务表 `lab_captures.lab_capture_tasks`，一次性令牌 32 字节随机、
    **只存 SHA-256**、默认 20 分钟有效、绑定 projectId/bundleId/kind；
  - `PUT /api/lab-capture-upload?token=...`：OPTIONS 预检放行、只接受合法
    `chrome-extension://` Origin（或同源/本地桥接无 Origin）、100 MB 上限、
    文件名清洗防目录穿越、临时文件 + 原子重命名写入
    `课题工作区/captured-literature/<bundleId>/`；
  - PDF 校验 `%PDF-` 头 / `%%EOF` / 大小 / SHA-256；SI 扩展名白名单
    （pdf/zip/docx/xlsx/csv/txt/cif/sdf）；
  - 成功后调用 `LabTasksService.registerCapturedFile` 登记到**原 bundle**
    （复用 bundleId/reportId，不新建文献），PDF 更新 pdfPath/pdfSha256/
    acquisitionStatus=ready，SI 更新 siPath/siSha256，记录 provenance
    `source = manual-browser-capture`；捕获只登记原始文件，不冒充已完成精读。
- **前端**（`client/index.js`）：PDF/SI 按钮始终存在；已获取点亮并下载（长度 +
  SHA-256 校验），未获取灰色可点击：同步打开 DOI 出版社页面（避免弹窗被拦截）→
  异步 `manual_capture_create` → `window.postMessage(ARM_CAPTURE)` 通知扩展 →
  显示「等待下一次下载」；扩展完成/失败经 `window.postMessage` 通知页面后
  重新拉取 workspace 点亮按钮。微信来源只走 DOI 页面，无 DOI 拒绝，不显示公众号链接。
- **扩展**（`browser-extension/ibm-literature-capture/`，MV3）：权限最小化
  （downloads/storage/nativeMessaging），只处理明确的 `ARM_CAPTURE` 布防、
  一次一个任务、只捕获布防后下一份匹配下载、过期自动清理、中断通知、
  上传成功清除任务并通知页面；popup 显示六状态 + 取消按钮。
  由于扩展 SW 无法读取 `file://`、downloads API 不返回绝对路径（P1 验证结论），
  文件读取与上传经 **Native Messaging 本地桥接**（`native-bridge/host.py`），
  桥接只接收一次性上传地址/任务编号/下载文件相对路径。
- **Remote**：`manual_capture_create` / `manual_capture_get` / `manual_capture_list`
  经 Typert Gateway 暴露给浏览器 client。
