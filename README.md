# dsh-lab-agent

课题组本地科研 Agent —— 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
的独立插件包（不修改 Harness 核心），文献能力直接集成
[nature-skills](https://github.com/Yuan1z0825/nature-skills)（固定 commit、Apache-2.0），
本插件负责 Skill 路由、任务编排、版本登记、模板管理与回归质检。

首期面向：**聚前药与高分子材料设计**。

## 快速开始

```bash
# 0) 依赖：node >= 20、python3（或 Windows 上的 py -3）；部署到 profile 需要 pnpm
# 1) 建立指向当前 Harness 安装的开发链接（测试/脚本用）
node scripts/dev-link.mjs

# 2) 固定 nature-skills commit 并生成 vendor.lock.json（需网络，仅升级时重复）
node scripts/pin-vendor.mjs --latest          # 或用 --sha <40-hex>

# 3) 安装到部署目录（物化 vendor 树、preset、registry、venv）
node scripts/install.mjs                      # --skip-python 跳过 venv

# 4) 回归
node scripts/regression/run.mjs

# 5) 挂进 web profile 并重启（一次性的部署步骤，需 pnpm，且会重启 GUI）
dsh plugin --profile web add <本仓库绝对路径>
dsh web
```

之后新会话选择 **课题组科研（聚前药/高分子）** preset，nature skills
（`nature-academic-search`、`nature-reader`、`nature-paper-card`、
`nature-paper2ppt`、`nature-shared`）即出现在 skill 目录中。

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

## 阶段一交付内容

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
  版式角色自动映射建议 → 预览/填充示例 → 用户确认 → 验证发布；无效映射在
  生成前明确拒绝，不静默替换为 `nature-default` 默认模板。
- 依赖：`jszip` / `fast-xml-parser`（纯 JS，跨平台，无需 Python）。

## 阶段三交付内容

- **任务编排**（`ctx.labTasks`，§六 接口）：`searchLiterature` / `preparePaper` /
  `createReadingReport` / `validateReadingReport` / `createPresentation` /
  `validatePresentation` + 完成/查询接口；`LabProject` 保存目标/模板版本快照。
- **执行层**（`src/skill-executor.js`）：直接调用 nature-skills 的 stdlib 脚本
  （OpenAlex 检索、引用导出、源包准备、精读审计、PPTX 质量审计）——系统
  python3 即可运行，无需 venv。
- **审计门禁**（§五 步骤 6/10）：`audit_paper_card.py` errors>0 阻止进入 PPT 阶段；
  `audit_pptx_quality.py` 高严重度未清零标记失败（修复后重审）。
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

## 部署环境与安全约定

- 默认 Windows 10/11 本地运行，Web UI 仅监听 `127.0.0.1`；所有 PDF/报告/PPT 存本地。
- 可调用云模型，但发送前显示数据范围。
- 调用云端模型、写入 registry、升级锁定版本均为显式动作；启动不做任何安装。
- CAS/SciFinder：未获额外书面授权前不自动操作、不把 CAS 内容送入模型（见计划 §七）。

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
- [ ] 阶段五 NMR 产品化
- [ ] 阶段六 合成路线与 CAS（授权后启动）
