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
│     → ctx.labTasks：文献→PPT 任务编排（§六 接口 + 状态机 + 审计门禁）
└── （阶段四+将新增化学性质/实验计划/NMR 服务行）

presets/lab-research/（部署到 $DSH_HOME/.agent-presets/lab-research，user trust）
└── agent.cordis.yml + preset.yml
      → 课题组科研 persona + shell/fs/jobs/skills/goal/planning/compaction/
        delegation/ask-user/todo/web 工具组合；任务接口工具可在此挂载
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
  `.venv`、`templates/`。`scripts/install.mjs` 幂等物化；`scripts/pin-vendor.mjs` 手动升级。

## 4. 执行边界

- 启动时不安装任何东西：registry 只读打开，python 只在显式 bootstrap 时安装。
- 写路径只有显式调用：安装脚本 `bootstrapFromVendor`、回归 `--record-pass`、
  升级工具。模型无法静默改动锁定版本。
- 不重写 nature skills 的检索/精读/PPT 流程；本插件只做路由、编排、登记与质检。
- CAS/SciFinder：未获书面授权前不自动操作、不把 CAS 内容送入模型（阶段 6 范围）。

## 5. 目录

```
lib/                  Cordis 服务（version-registry, python-env, goal-profiles, ppt-templates, index）
src/                  纯 Node 模块（paths, lockfile, skill-catalog, python-env, harness-root,
                      goal-profile, ppt-template, pptx-parse）
presets/lab-research/ 课题组 agent preset 模板
vendor/nature-skills/ 固定 commit 的第三方完整目录（含 vendor.lock.json）
python/               pyproject.toml + requirements.lock
scripts/              install / pin-vendor / dev-link / vendor-fetch / regression(run, golden-diff)
tests/unit|integration|regression/cases|fixtures(pptx-builder)
docs/                 本目录 + VERSIONING/THIRD_PARTY_NOTICES/REGRESSION
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
  | 精读审计（门禁） | `.../audit_paper_card.py`（exit 0/1，errors 阻止流转） |
  | PPTX 质量审计（门禁） | `nature-paper2ppt/scripts/audit_pptx_quality.py`（--fail-on high） |

  † PDF 输入需 venv 安装 PyMuPDF；source_map JSON（nature-reader 产物）仅 stdlib。
- **LLM 步骤**（精读报告、PPT 内容）：agent 在会话中执行对应 skill，产物通过
  `completeReadingReport` / `completePresentation` 登记，再走审计门禁。
- **持久化**（`lab_tasks` domain，6 表）：LabProject（目标/模板版本快照）、
  LiteratureSearchRun、PaperSourceBundle、ReadingReport、PresentationRun、
  ArtifactProvenance（输入哈希 / skill 版本 / 模型 / 时间）。
- **接口**（§六）：`searchLiterature` `preparePaper` `createReadingReport`
  `validateReadingReport` `createPresentation` `validatePresentation` + 完成/查询。
- **门禁**：报告审计 errors>0 → `createPresentation` 明确拒绝；PPTX QA 高严重度
  未清零 → `validatePresentation` 失败，修复后重审。
