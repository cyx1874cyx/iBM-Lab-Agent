# 子插件拆分：已落地的契约样板

本目录的六个档案（literature / knowledge / reagents / nmr / plotting / polishing）描述各域现状与迁移阻碍。
本文只记录**已经用代码和测试验证过**的插件形态，后续五域照此复制，不再另外发明抽象。

样板：`plugins/reagents/` —— 宿主、客户端 bundle、测试均已落地。

## 1. 目录形态

```
plugins/<name>/
  package.json          # name / exports / files / dsh.bundle.patch / dsh.client
  cordis.patch.yml      # 只 insert 插件自己的服务行
  lib/index.js          # 导出 Cordis Service（默认导出）
  lib/service.js        # 插件宿主实现
  src/                  # 纯逻辑，可被独立单元测试
  client/src/entry.js   # 前端入口：注册工作台模块
  client/src/panel.js   # 页面组件（只依赖 client-sdk）
  client/index.js       # 构建产物（scripts/build-plugin-client.mjs 生成）
  test/                 # 插件自己的测试
```

## 2. 宿主服务约定（reagents 已验证）

- `class XxxService extends Service`，`super(ctx, "<serviceName>")`，服务名全局唯一。
- **不写死强依赖**：`static inject = []`，需要宿主能力时在方法内 `ctx.get("...")`，
  缺失则抛 `code = "feature-unavailable"` 的错误（计划 §5 的“缺失时如实报不可用”）。
- 不 import 母插件内部模块（`lib/*`、`src/*`）；只依赖本包 `src/` 与宿主公开服务。
- 数据根目录由装配配置注入（`dshHomePath('lab-agent/<name>')`），
  未注入时退回 `$DSH_HOME/lab-agent/<name>`，保证独立测试可跑。

## 3. 装配与兼容

- 子插件**不登记**进 `dsh-lab-agent` 的 `cordis.patch.yml`；由部署 profile 决定是否启用。
- 母插件旧接口整段委托：`ctx.get("<serviceName>")` 存在就把方法转发过去（只有一套实现、
  一份缓存），不存在才退回旧实现或 `feature-unavailable`。试剂三个 `lab.reagents_*`
  就是这种形态，并有测试断言 `lab.reagentCatalog() === ctx.labReagents.catalog()`。

## 4. 客户端入口（已跑通）

- 构建：`node scripts/build-plugin-client.mjs --plugin plugins/reagents`，
  产物是独立的 `__ModuleLoader__.load({ id: "@ibm-lab/reagents" })` 单文件，React 保持 external。
  构建期有隔离守卫：插件**只能**导入 `dsh-lab-agent/client-sdk`，导入母包其它内部路径直接报错。
- 运行时：`apply()` 调 `registerWorkbenchModule({ id, label, icon, caption, render, override })`
  并返回注销函数；宿主停用插件时调用即移除模块。
- `override: true` = 插件接管同名内置页面（迁移期语义：装上插件后替代母包硬编码页面，
  未装时母包页面照常工作）。默认 false，避免插件意外顶掉核心页面。
- 母包侧：`client/src/module-registry.js`（注册表，`globalThis[Symbol.for("ibm.lab.workbench")]`，
  与 bundle 加载顺序无关）+ `client/src/sdk.js`（对插件的唯一前端出口）+ `workbench.js` 合并渲染。

## 5. 验收（模板）

宿主独立性：`tests/integration/reagents-plugin.test.mjs`

```js
const handle = await bootLite({
  storageRoot: join(dir, "storage"),
  coreOnly: true,
  extraRows: [{ id: "lab-reagents", name: pathToFileURL(join(repoRoot, "plugins/reagents/lib/index.js")).href, config: { root } }]
});
```

客户端契约：`tests/unit/reagents-client-bundle.test.mjs` —— 在 `new Function` 里执行构建产物，
替身 `window.__ModuleLoader__` 捕获注册，调用 `apply()` 后断言注册表出现该模块、注销后消失。

每个子插件迁移后都要有同构的两条测试；不通过不算迁移完成。

## 6. 试剂插件剩余缺口（下一轮）

1. 部署登记：profile 的依赖与 patch 还没把 `@ibm-lab/reagents` 装进去；
   `bundles/catalog.json`、`packages/dsh-lab-*`、`build-domain-packages.mjs` 尚无 reagents 分支。
2. `lib/research-read.js:122` 仍保留自带 `ReagentCatalog` 兜底，应改为只走插件服务。
3. `lib/reagents.js`、`src/reagents/workbook.js` 两个兼容再导出仍有 5 个调用方，需限期清理。
4. 描述符双清单（`lib/remote.js` 的 `markRemote` 与 `client/src/descriptors.js`）需同步机制。

## 7. 发布注意

`scripts/migration/build-domain-packages.mjs --check` 之前是失败的（`packages/dsh-lab-ui/client/index.js`
陈旧，含已移除的申报入口）；现已重建并保持通过。任何改动 `client/index.js` 后都必须重跑该生成器，
否则 `pack-domain-release.mjs` 会拒绝打包。

## 8. 当前进度（按插件）

| 插件 | 宿主实现 | 独立装配 | 前端 bundle | 验收测试 |
| --- | --- | --- | --- | --- |
| 试剂 `plugins/reagents` | 已完成（`labReagents`，单实现委托） | 已完成（`cordis.patch.yml`） | 已完成（override 内置页） | 宿主 2 条 + bundle 1 条 |
| 润色 `plugins/polishing` | 已完成（`labPolishing`，如实未实现） | 已完成 | 已完成（override 占位页） | 宿主 1 条 + bundle 1 条 + 单测 2 条 |
| RAG `plugins/knowledge` | 已完成（`labKnowledge`，检索内核已迁入 `rag/`） | 已完成 | 已完成（override 内置页，样式自带） | 宿主 1 + bundle 1 + 等价性 2 + 既有知识库 15 |
| 文献 `plugins/literature` | 已完成宿主迁移（`labLiteratureTasks`，18 个模块） | 已完成 | 已完成（接管课题页「文献资料」，含检索/精读/捕获提示） | 独立装配 1 + 校验等价 1 + bundle 契约 1 + 既有 tasks 12/13 |
| 核磁 `plugins/nmr` | 已完成：自有域 `lab_nmr_tasks` + 全生命周期 + 结构解析 worker / 录入 / 模拟模块迁入 | 已完成 | 已完成（接管课题页「核磁解析」） | 独立装配 1 + 域契约 1 + 生命周期 1 + bundle 契约 1 + 既有核磁 8 |
| 绘图 `plugins/plotting` | 已完成旧表拆分（自有域 `lab_plot_tasks`，历史 kind=plot 迁移） | 已完成 | 已完成（接管课题页「科研绘图」） | 独立装配 1 + 域契约 1 + bundle 契约 1 |

统一命令：

- `node scripts/verify-plugins.mjs`：插件体检（包字段、装配行、bundle 新鲜度、**禁止导入母包内部实现**、测试存在性）。
- `node scripts/build-plugin-client.mjs --plugin plugins/<name>`：构建插件前端 bundle。
- `node scripts/build-rag.mjs`：重建 RAG 检索内核到 `plugins/knowledge/rag/`（母包 `lib/rag/core.mjs` 只是转发）。

知识库的最终形态（本轮已收口）：

- **检索解析内核留在母包**：`lib/rag/*` 是共享库（PDF/DOCX/PPTX 解析 + BM25），公开为 `dsh-lab-agent/rag-core`；
  它不是任何插件私有代码，`research-read` 与知识库插件都通过公开导出使用。
- **知识库插件只拥有索引/问答/来源定位**：`plugins/knowledge/lib/project-knowledge.js` + `service.js`。
- **母包不再静态 import 插件**：`lib/knowledge.js`、`lib/knowledge-reading.js` 两个兼容 shim 已删除；
  `remote`、`knowledge-tool`、`knowledge-assistant` 全部改为 `ctx.get("labKnowledge")`，
  插件缺席时不注册知识库工具、不安装问答助手、`lab.knowledge_*` 返回 `feature-unavailable`。
- 知识库→精读的意图判断也收进插件服务（`readingTransferRequested` / `transferAuthorized`），母包不再复制规则。

## 8.1 私有插件依赖母包的方式（重要）

插件**只能**导入母包 `package.json` 的 `exports` 键（含 `*` 模式）。本轮新增的公开面：

`./task-models`、`./office-package`、`./json-boundary`、`./goal-profile`、`./note-template`、
`./manual-capture`、`./artifact-integrity`、`./reading-note-audit`、`./core-domain`、
`./project-context`、`./ppt-template-lint`、`./literature/*`、`./pptx-*`。

`scripts/verify-plugins.mjs` 会读取这张表并拒绝任何未导出的 `dsh-lab-agent/...` 引用。
开发机需要 `node_modules/dsh-lab-agent` 自链接（`node scripts/dev-link.mjs` 或手工 junction），
否则插件里的 `dsh-lab-agent/...` 无法解析。

文献采用**方法级委托**：母包 `ibmLiteratureWorkflows` 保留为兼容壳，`[Service.init]` 在检测到
`labLiteratureTasks` 时直接跳过（不再重复建表/迁移），每个方法优先转给插件。
插件可增量接管，也可整体停用回落到旧实现。

## 8.2 一表两业务的拆分（核磁 / 绘图）

历史 `lab_characterization.tasks` 同时存核磁与绘图任务，两个插件无法各自拥有数据。现在的规则：

- 域定义抽到公开导出 `dsh-lab-agent/characterization-domain`，任务 schema 公开为 `dsh-lab-agent/characterization-schema`。
- 新数据：核磁写 `lab_nmr_tasks`，绘图写 `lab_plot_tasks`（各自版本 0）。
  **不要用 `lab_nmr` / `lab_plot`**：前者是母包核磁数据集域，已被占用，会导致 `already-open`。
- 历史数据：旧表由母插件 `labCharacterization` 独占打开；两个插件启动后用
  `ctx.root.get("labCharacterization")` 拉取 `allTasks()` 快照，各自只认领自己的 `kind`，
  重复执行幂等，旧行保留只读。
- 为什么用 `ctx.root`：Cordis 的 `ctx.get` 对插件是隔离的，子插件看不到兄弟服务；
  迁移是一次性宿主动作，用 root 明确表达"读宿主历史"。
- 为什么不让插件自己开旧域：`storageDomain.open` 同一域不能开两次，且关闭后可能把
  句柄交回给并发方（实测 `closed` 错误）；让唯一所有者提供快照没有这类竞态。

装配验收：`tests/integration/plugin-composition.test.mjs` 同时启动六个插件 + 历史所有者夹具，
断言全部服务在场、两个任务插件各认领自己的历史行，并且**逐个停用时其余五个照常启动**。

## 8.3 两个前端扩展点（都已验证）

| 扩展点 | 注册表 | 作用 | 缺省行为 |
| --- | --- | --- | --- |
| 工作台模块 | `client/src/module-registry.js` | 左侧功能入口 + 整页视图（试剂、RAG、润色在用） | 母包内置模块 |
| 项目页签面板 | `client/src/panel-registry.js` | 课题页四个页签的内容（绘图已在用） | 内置 `CharacterizationPanel` |

- 插件通过 `dsh-lab-agent/client-sdk` 拿到两个注册表 + 通用 UI 套件（`h`、图标、右键菜单、
  Ketcher 编辑器、桌面文件动作、`fileToBase64`、`injectStyle`）。SDK 只导出**无业务语义**的部件。
- `components-project.js` 渲染页签时先查 `projectPanelFor(id)`，有插件面板就用它，否则回落内置。
- `scripts/build-plugin-client.mjs` 的隔离守卫改为读取母包 `exports` 表：
  公开导出可用，其它 `dsh-lab-agent/...` 一律拒绝。
- SDK 变动会让所有插件产物过期：用 `npm run build:plugins` / `npm run check:plugin-clients` 一次处理。
- **不要**把 `reader-tab.js` 一类会拉入 pdf.js 的模块放进 SDK：它会把整套 PDF 查看器
  （含 `.svg` 资源）拖进每个插件 bundle，构建直接失败。阅读器入口应由文献插件自己持有。

## 8.5 任务接口路由（核磁 + 绘图已切）

`lab.characterization_*` 不再无条件打母包壳，而是**按行归属选服务**：

- `taskService(taskId)`：依次查 `labNmrTasks` / `labPlotTasks` 的 `has(id)`，命中就用插件，否则回落 `labCharacterization`；
- `characterization_nmr_save` 一律写核磁插件域；`characterization_submit(kind=plot)` 一律走绘图插件 `create`；
- `characterization_list` 合并三侧（两个插件 + 母包历史），按 id 去重，绘图/旧任务仍可见；
- 仿真/结构/取消/绑定/重试/删除同样按行归属；删除语义（只删已登记产物、共享文件保护、`outputs`/`all` 两种模式）已分别移植到两个插件；
- 核磁模拟执行（峰模型 → 合成 FID → Mnova 标峰 → 登记）也迁入插件，运行时经 `ctx.root` 取 `ibmRuntime`。

验收：`tests/integration/characterization-routing.test.mjs`（真实 Typert 网关）覆盖核磁的保存/启动/取消/失败/重试
与绘图的提交/重试；`*-plugin-flow.test.mjs` 覆盖两个插件的完成、产物与删除。

**对话工具同样按行归属**：`characterization-tool.js` 用 `taskServiceFor(ctx, taskId)` 解析
核磁/绘图插件，`submit` 对核磁走插件 `submit`（外部附件导入 + 元数据推断）、对绘图走 `create`；
`update/complete/recomplete/get/simulation_*` 全部落到持有该行的服务。
验收：`tests/unit/characterization-tool.test.mjs` 的"插件持有任务时"用例。

## 8.4 部署登记（可选插件真正被加载）

`scripts/register-plugins.mjs` 把一个 DSH profile 变成"装了子插件"的状态：

```
node scripts/register-plugins.mjs --home <DSH_HOME> [--profile ibm-lab]
     [--plugins reagents,knowledge] [--disable polishing] [--copy] [--check]
```

- 安装：默认用 junction（`--copy` 强制复制）把 `plugins/<name>` 放到
  `<home>/profiles/<profile>/node_modules/@ibm-lab/<name>`；
- 激活：在 profile `package.json` 的 `dependencies` 写入 `file:<repo>/plugins/<name>`；
  DSH 会把声明了 `dsh.bundle.patch` 的依赖当作 bundle 自动激活（app-boot 的
  "new bundle dependencies activate automatically"）；
- 停用：`--disable` 移除依赖与安装目录，**不触碰任何业务数据**；
- 幂等：重复执行无变更，`--check` 只校验（CI 可用）。

`tests/unit/register-plugins.test.mjs` 用临时 profile 覆盖了登记、重复执行、停用与非法名字。
注意：本仓库环境无法启动 Electron，因此"登记后应用里确实加载"仍需一次实机确认
（重点是客户端 bundle 是否随依赖自动加载）。

## 9. 已知既有失败（非本轮引入）

`node --test tests/unit/*.test.mjs` 当前 836 条中 29 条失败，均为**旧断言与现状不符**：
`windows-release-scripts`（仍期望含 "Agent" 的安装包名，与品牌规则冲突）、`harness-surface`
（期望旧 `ctx.conversation.input...setDraft`）、`project-sidebar-tab`（期望旧 inject 列表）、
`ui-redesign`（期望旧按钮文案）、`tasks-surface`（双 service 重构前的属性清单）、
以及浏览器下载/WebVPN 相关旧用例。基线在此登记，后续只允许减少、不允许新增。
集成测试 `tests/integration/tasks.test.mjs` 的 "panel helpers: search RIS…" 也属既有失败
（概览正文期望从 paper-card 推导，实际返回预设概览）；已验证与本轮委托改造无关。

