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
└── lab-python-env         dsh-lab-agent/python-env
      → ctx.labPython：固定 venv 的预检/引导

presets/lab-research/（部署到 $DSH_HOME/.agent-presets/lab-research，user trust）
└── agent.cordis.yml + preset.yml
      → 课题组科研 persona + shell/fs/jobs/skills/goal/planning/compaction/
        delegation/ask-user/todo/web 工具组合；Phase 2+ 在这里挂任务接口工具
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
- 锁文件：
  - `vendor.lock.json`：nature-skills commit、每 skill 的 manifest 版本、
    license、python 锁哈希、回归日期。
  - `harness.lock.json`：Harness CLI/包版本（固定 commit 的 npm 等价物）。
- 部署数据目录（`$DSH_HOME/lab-agent/`）：
  `vendor/nature-skills`（物化树）、`vendor.lock.json`、`requirements.lock`、
  `.venv`。`scripts/install.mjs` 幂等物化；`scripts/pin-vendor.mjs` 手动升级。

## 4. 执行边界

- 启动时不安装任何东西：registry 只读打开，python 只在显式 bootstrap 时安装。
- 写路径只有显式调用：安装脚本 `bootstrapFromVendor`、回归 `--record-pass`、
  升级工具。模型无法静默改动锁定版本。
- 不重写 nature skills 的检索/精读/PPT 流程；本插件只做路由、编排、登记与质检。
- CAS/SciFinder：未获书面授权前不自动操作、不把 CAS 内容送入模型（阶段 6 范围）。

## 5. 目录

```
lib/                  Cordis 服务（version-registry, python-env, index）
src/                  纯 Node 模块（paths, lockfile, skill-catalog, python-env, harness-root）
presets/lab-research/ 课题组 agent preset 模板
vendor/nature-skills/ 固定 commit 的第三方完整目录（含 vendor.lock.json）
python/               pyproject.toml + requirements.lock
scripts/              install / pin-vendor / dev-link / regression(run, golden-diff)
tests/unit|integration|regression/cases
docs/                 本目录 + VERSIONING/THIRD_PARTY_NOTICES/REGRESSION
```
