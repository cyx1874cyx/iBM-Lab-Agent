# iBM Lab 插件拆分：验收状态

日期：2026-11-03。对应计划：`docs/PLUGIN_DECOUPLING_PLAN_2026-11-03.md`。
本文只记录**可复现证据**，不代替计划本身。

## 1. 结论

代码层面的拆分已完成：1 个母插件 + 6 个可选子插件，各自拥有实现、数据域、界面、
工具接线、测试与独立装配方式；母包对插件零静态依赖。
**尚未完成的两件事**都能独立验证，且不阻塞代码评审：

1. 实机加载验证（本仓库环境无法启动 Electron）；
2. 母包兼容副本的删除（需先确认部署 profile 已登记插件，否则会丢功能）。

## 2. 六个子插件

| 插件 | 公开服务 | 自有数据 | 界面 | 工具接线 | 验收命令 |
| --- | --- | --- | --- | --- | --- |
| 试剂 `plugins/reagents` | `labReagents` | 本机 Excel 清单 | 工作台模块「试剂管理」 | `lab.reagents_*` 委托 | `node --test tests/integration/reagents-plugin.test.mjs plugins/reagents/test/*.test.mjs` |
| 润色 `plugins/polishing` | `labPolishing` | —（占位） | 工作台模块「论文润色」 | 不注册假工具 | `node --test tests/integration/polishing-plugin.test.mjs` |
| RAG `plugins/knowledge` | `labKnowledge` | 项目内 `.ibm-rag` 索引 | 工作台模块「RAG 知识库」 | `lab.knowledge_*` + `lab_knowledge_*` | `node --test tests/integration/knowledge*.test.mjs` |
| 文献 `plugins/literature` | `labLiteratureTasks` | 共享 `lab_tasks` 表 | 课题页「文献资料」 | `ibmLiteratureWorkflows` 方法级委托 | `node --test tests/integration/literature-plugin.test.mjs` |
| 核磁 `plugins/nmr` | `labNmrTasks` | `lab_nmr_tasks` | 课题页「核磁解析」 | `characterization_*` 按行路由 + 工具按行路由 | `node --test tests/integration/nmr-plugin*.test.mjs tests/integration/characterization-routing.test.mjs` |
| 绘图 `plugins/plotting` | `labPlotTasks` | `lab_plot_tasks` | 课题页「科研绘图」 | 同上 | `node --test tests/integration/plotting-plugin*.test.mjs` |

## 3. 架构不变量（可执行）

`node scripts/check-decoupling.mjs`（`npm run check:decoupling`）：

- 母包 `lib/`、`src/`、`client/src/` 不得 import `plugins/` 或 `@ibm-lab/*`；
- 母包 `cordis.patch.yml` 不得静态登记 `@ibm-lab/*`；
- 每个插件必须 `private`、ESM、有 `dsh.bundle.patch`、有 `test/`；
- 插件只能 import 母包 `package.json` 的 `exports`（`verify-plugins` 覆盖）。

被这条检查当场抓到并修正的实例：试剂兼容 shim 曾反向 import 插件；
修正方式是**把清单解析归入母包通用库** `src/reagents/`（公开导出 `dsh-lab-agent/reagents/*`），
插件只保留服务与界面。

## 3.1 工具归属

| 工具 | 位置 | 注册方式 |
| --- | --- | --- |
| `lab_knowledge_list/search/add_to_reading` | `plugins/knowledge/lib/tools.js` | 插件自己的装配行 `@ibm-lab/knowledge/tools`，服务缺席时零注册 |
| `mnova_*`（Mnova 操作） | `plugins/nmr/lib/mnova-tools.js` | 装配行 `@ibm-lab/nmr/mnova-tools`；仅桌面环境注册 |
| `lab_nmr_simulation_structure/run` | `plugins/nmr/lib/simulation-tools.js` | 装配行 `@ibm-lab/nmr/simulation-tools` |
| `lab_plot_editor_state/apply` | `plugins/plotting/lib/plot-tools.js` | 装配行 `@ibm-lab/plotting/plot-tools` |
| 文献工具（检索/登记/精读/PPT/检索记录） | `plugins/literature/lib/tools.js` | 装配行 `@ibm-lab/literature/tools`；依赖 `labTasks` 兼容服务 |
| `lab_characterization_submit/preflight/update/complete/recomplete` | 母包 `lib/characterization-tool.js` | 跨业务通用任务生命周期，按行路由到插件服务 |
| `lab_research_read` + 知识库助手装配 | 母包 `lib/tasks-tool.js`（已瘦身为宿主入口） | 跨模块只读能力，由宿主注册 |

## 3.2 子插件启停（软 / 硬）

入口：工作台左下「插件设置」，或 DSH 设置里的「iBM 插件设置 → 子插件」页签。

- **软启停**：写入 `$DSH_HOME/lab-agent/plugin-flags.json`，注册表立即过滤该插件的工作台模块与课题页签
  （连同被接管的内置页面一起隐藏），服务仍驻留。刷新/重启后保持。
- **硬启停**：改写 profile 的 `dsh.profile.bundles`，下次启动不再装配该插件（工具与服务一起消失）。
  依赖保留，重新启用不需要重装。界面会明确提示"下次启动生效"。
- 停用不删除任何课题数据。

实现：`lib/plugin-settings.js`（后端，read/write flags 与 profile manifest）+
`lib/remote.js` 的 `plugins_list / plugins_set_soft / plugins_set_hard` +
`client/src/plugin-switches.js`（注册表过滤与订阅）。

验收：
- `tests/unit/plugin-settings.test.mjs`：默认全开、软开关落盘、硬开关改写 bundles 且可恢复、未知 id 拒绝；
- `tests/unit/plugin-soft-switches.test.mjs`：模块隐藏/恢复、页签回退；
- 运行时实测：设置页列出六个插件与 profile 路径，点「软停用」后左侧「试剂管理」立即消失，再点恢复。

## 4. 数据所有权与迁移
- 核磁：新任务写 `lab_nmr_tasks`；历史 `lab_characterization` 中 `kind=nmr` 的行由
  旧服务提供快照（`allTasks()`），插件启动后后台认领。
- 绘图：新任务写 `lab_plot_tasks`；同上，`kind=plot`。
- 旧表不删除、保留只读；迁移幂等。
- 文献暂时继续使用共享 `lab_tasks` 表（8 张表），因为阅读/PPT/检索共享同一批数据；
  后续按计划逐步拆表。
- RAG、试剂、润色没有历史任务表需要迁移。

## 5. 装配（可独立、可共存、可缺席）

- 独立：`bootLite` + 单个插件行即可启动（每个插件的 `*-plugin.test.mjs`）。
- 共存：`tests/integration/plugin-composition.test.mjs` 同时启动六个插件 + 历史所有者夹具，
  断言服务齐全、两个任务插件各认领自己的历史行。
- 缺席：同一测试逐个停用六个插件，断言其余插件照常启动。
- 部署：`node scripts/register-plugins.mjs --home <DSH_HOME>` 安装包、写 bundle 依赖；
  `--disable` 停用不删数据；`--check` 幂等校验（`tests/unit/register-plugins.test.mjs`）。
  **关键**：DSH 只激活 `manifest.dsh.profile.bundles` 里登记的包，仅写 `dependencies` 不会生效；
  注册脚本会同时维护这两个字段，并用 DSH 的 `readProfilePlugins` 断言
  `bundle=true / enabled=true`。
- 包级冒烟：`node scripts/smoke-plugin-packages.mjs` 在临时 profile 里按**包名**安装并 import
  六个插件，同时检查 `cordis.patch.yml` 用包名装配（`tests/unit/plugin-package-smoke.test.mjs`）。
- 客户端契约：`verify-plugins` 按 DSH client-modules 的语义校验——`dsh.client.platform === "web"`、
  `inject` 为字符串数组且每个包都已安装、产物 `__ModuleLoader__` 的 id 等于包名、
  导出 `apply`/`inject`。这条检查上线后立刻发现润色插件把 `dsh-client-locale` 写成了不存在的
  `dsh-client-ui-locale`，已修正。

## 6. 已知缺口与风险

| 项 | 说明 | 处理 |
| --- | --- | --- |
| 实机加载未验证 | 本环境无法启动 Electron；`readProfilePlugins` 已证明 bundle/enabled，客户端 bundle 也按 DSH 契约校验，但真实渲染未实测 | 开发机跑一次 `plugins:register` + `dev:workbench`，确认六个页面与工具 |
| 母包兼容副本未删 | `components-project` 的 LitPanel、`components-characterization`、`lib/characterization.js` 等仍在，作为未装插件时的兜底 | 部署验证通过后再删；删除前保持现状最安全 |
| 文献数据未拆表 | 文献仍用共享 `lab_tasks` | 计划内后续阶段 |
| 既有测试失败 | unit 9 条为旧 UI/文案断言（含 Windows 安装包名与品牌规则冲突）；集成 4 条为桌面桥/前端静态断言 | 已登记，不属本次拆分引入 |

## 7. 一键验收

```powershell
node scripts/check-decoupling.mjs
node scripts/verify-plugins.mjs
node scripts/build-plugin-clients.mjs --check
node --test "tests/unit/*.test.mjs"
node --test tests/integration/plugin-composition.test.mjs
node --test tests/integration/characterization-routing.test.mjs
node --test tests/integration/nmr-plugin-flow.test.mjs
node --test tests/integration/plotting-plugin-flow.test.mjs
```
