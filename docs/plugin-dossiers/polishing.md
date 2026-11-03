# 论文润色（polishing）提取档案

范围：只读源码核查，对象为仓库 `Code/iBM-Lab-Agent-electron-next`。本轮目标是「可安装占位插件」，不含真实润色能力。
活体客户端入口是 `client/index.js`（由 `scripts/build-client.mjs` 从 `client/src/entry.js` 打包，见 build-client.mjs:6-19、40-41）。

## 1. 现状：占位页位置与渲染方式

- 模块清单条目：`client/src/workbench.js:21` — `{ id: 'polishing', label: '论文润色', icon: 'pen', caption: '功能规划中' }`（`WORKBENCH_MODULES` 内，第 14-22 行）。
- 左侧导航：`client/src/workbench.js:199` — 所有模块统一渲染为 `button[data-module]`；润色项与其他模块无差别，仅靠 id 区分。
- 页头标题/说明：`client/src/workbench.js:202` — 取 `module.label` 与 `module.caption`，故副标题显示「功能规划中」。
- 占位组件：`client/src/workbench.js:61-65` — `PolishingPlaceholder()` 返回 `section.ib-wb-writing`，内含 `h2`「论文润色」与 `p`「此功能正在规划中，暂不可用。」
- 挂载点：`client/src/workbench.js:209` — `module.id === 'polishing' ? h(PolishingPlaceholder) : null`，位于业务区 `ib-wb-project-holder` 内，与 `Project`、`ReagentPanel`、`KnowledgePanel` 并列互斥。
- 渲染方式：纯函数组件，无 state、无 effect、不调用 `call()`、不调用 `onTask`、不读写草稿、不占 rightbar 插槽、不注册工具。样式复用 `client/src/workbench.css.js:52-53` 的 `.ib-wb-writing` 规则（由旧写作页遗留）。
- 已构建产物与源码一致：`client/index.js:82313`（模块条目）、`82362-82366`（占位函数）、`82608`（挂载）。
- 为负的核查结果（上述文件均无 `润色|polish` 命中）：`client/src/components-workspace.js`、`components-project.js`、`components-core.js`、`constants.js`、`lib.js`。即占位页未与其它工作台模块耦合，也没有独立常量或 API 描述。

## 2. 后端残留：有，但只是「草稿文件」兼容层，不是功能实现

- 草稿路径白名单：`lib/core/project-files.js:351` — `draftPath()` 接受 `['proposal','polishing']`，润色映射到 `<workspace>/草稿/论文润色.md`。
- 草稿读写：`lib/core/project-files.js:346-350`（`readDraft`，ENOENT 返回 `exists:false`）、`352-356`（`writeDraft`，8 MB 上限 + 原子写）。
- Remote 接口：`lib/remote.js:221-224` `projects_draft_read`、`225-229` `projects_draft_write`；后者只拦 `kind === 'proposal'`，**润色草稿仍可写**。
- 接口暴露：`lib/remote.js:945` — 四个 draft 方法仍被 `markRemote()` 标记，即 remote 面仍在。
- 客户端描述符仍声明这两个接口：`client/src/descriptors.js:19`。
- 只读检索面：`lib/research-read.js:127-130` — `resource=drafts` 直接列出 `草稿/项目申报.md`、`草稿/论文润色.md`；工具描述见 `lib/research-read.js:143`。
- 提示词仍提及：`lib/knowledge-assistant.js:19` —「…模板、申报/润色草稿、历史及项目文件」。
- 不存在：无 `lab_polish*` 工具、无润色服务/host 服务、`bundles/catalog.json:3-10` 六个域无 polishing、`bundles/*.patch.yml`（7 个）无润色行、`presets/lab-research/preset.patch.yml` 无润色工具行。结论：后端唯一「润色残留」是通用草稿读写对其 kind 的放行。

## 3. 项目申报残留

入口 — 已移除（活体客户端）：

- `client/src/workbench.js:14-22` 模块清单无 `proposal`；`client/index.js` 构建产物中亦无申报条目（全仓扫描 `client/index.js` 仅命中 pdf worker 文本）。
- 守卫测试：`tests/unit/proposal-retirement.test.mjs:18` 断言源码不含 `id: 'proposal'`。

⚠ 陈旧产物 — 仍会复活入口（高风险）：

- `packages/dsh-lab-ui/client/index.js:82310` 仍有 `{ id: "proposal", label: "项目申报", … }`；`82414-82437` 仍是 `WritingWorkspace`（草稿自动保存 + 提交 `onTask`）；`82679` 仍对 `["proposal","polishing"]` 挂载该组件。
- 该文件由 `scripts/migration/build-domain-packages.mjs:33` 从 `client/index.js` 生成（替换 module id 为 `dsh-lab-ui`），比 `client/index.js` 多 71 行 — 说明申报移除后未重新生成域包。
- `scripts/migration/pack-domain-release.mjs:13-14` 会断言域包客户端与 `client/index.js` 一致，并在不一致时抛 `UI domain client is stale`。即当前仓库状态下打包会失败，若绕过则 tgz 会带回申报入口。

Remote 写接口 — 保留方法但拒绝写入：

- `lib/remote.js:225-229` — `kind === 'proposal'` 抛 `RemoteError('feature-unavailable', '项目申报功能已取消，已有草稿可继续读取。')`，不触达 `writeDraft`。
- 读取不拦：`lib/remote.js:221-224`。
- 方法描述符仍注册：`lib/remote.js:945`、`client/src/descriptors.js:19`（接口面存在，语义靠 runtime 守卫）。

历史数据读取路径：

1. Remote：`projects_draft_read({projectId, kind:'proposal'})`（lib/remote.js:221-223）→ `lib/core/project-files.js:346-350`。
2. 落盘位置：`lib/core/project-files.js:351` → `<workspace>/草稿/项目申报.md`。
3. 助手只读工具：`lab_research_read` 的 `resource=drafts`（`lib/research-read.js:127-130`）列出该路径，再用 `resource=file` + `path` 分页读取（`lib/research-read.js:114-115`）。
4. 文档说明：`docs/工作区代码说明.md:159`。

数据库表 — 不存在：

- 全 `lib/`、`src/` 扫描 `proposal|declaration|申报` 无任何表定义；草稿走文件而不入库（`lib/core/project-files.js`）。`projects` 表无申报字段。
- 但测试仍写入申报 kind：`tests/integration/project-files.test.mjs:109`（`writeDraft('one','proposal',…)`），说明 core 层仍视其为合法草稿类型。

其它陈旧引用（建议随本轮清理）：

- `docs/WORKBENCH_DEVELOPMENT.md:6`、`:10` 仍描述「项目申报」入口与草稿自动保存。
- `docs/PROJECT_FILES.md:13` 在目录规范中列出 `草稿/项目申报.md`。
- `scripts/migration/verify-workbench.mjs:89-95` 仍点击 `[data-module=proposal]` 并等待 `#ib-wb-draft-proposal`，对当前客户端必然失败。

## 4. 一个独立子插件包的最小结构（据 dsh-lab-ui / dsh-lab-documents 实际字段）

`package.json` 必填/惯用字段：

- `name`：包名即装配发现名（现有为 `dsh-lab-ui`、`dsh-lab-documents`，package.json:2）。
- `version`：与母插件同版本号 `0.8.0-rc.1`（dsh-lab-ui:3）。
- `private: true`、`type: "module"`、`main: "./lib/index.js"`（dsh-lab-ui:4-6）。
- `exports`：至少 `"."`、`"./package.json"`；自带前端加 `"./client": "./client/index.js"`（dsh-lab-ui:7-11）；多服务包把每个服务作为子路径导出（dsh-lab-documents:7-16）。
- `files`：`["lib", "cordis.patch.yml"]`，带前端加 `"client"` 与可选 `"preset.patch.yml"`（dsh-lab-ui:12-17；dsh-lab-documents:17-20）。
- `dependencies`：`"dsh-lab-agent": "0.8.0-rc.1"`（dsh-lab-ui:18-20）——现有包仍依赖旧主包共享实现。
- `peerDependencies`：`dsh-lab-core`（ui:21-23），需要运行时再加 `dsh-lab-runtime`（documents:24-27）。
- `dsh.bundle.patch`：字符串数组，指向上面的 patch 文件（ui:24-30 含 `./preset.patch.yml`；documents:28-34 仅 `./cordis.patch.yml`）。
- `dsh.client`：仅自带前端的包需要 —— `inject` 列出宿主 UI 包（8 项），`platform: "web"`（ui:31-43）。
- 反例提醒：`packages/dsh-lab-ui/lib/index.js` 全文只有 `export { default } from "dsh-lab-agent";`，即当前这些包是转发壳而非真实实现；新插件不应复制这层转发。

`cordis.patch.yml` 两种实际写法：

- 单行插件（`packages/dsh-lab-ui/cordis.patch.yml:1-3`）：顶层 YAML 序列，唯一键 `insert`，其下 `- id: lab-client` / `name: 'dsh-lab-ui'`（name 用包名即解析 `main`）。
- 多服务（`packages/dsh-lab-documents/cordis.patch.yml:3-11`）：`insert` 下多行，每行 `id`（全局唯一）+ `name: '包名/子路径'`（对应 exports 键）+ `inject: [宿主服务…]` + 可选 `config`；`config` 可用 `!!js dshHomePath('…')`（同文件:16-18）。注释行说明该文件由组合脚本生成（:1-2）。

`client` 入口约定：

- 必须是 DSH 单文件注册契约：`window.__ModuleLoader__.load({ id, factory: (require) => {…} })`，并导出 `exports.apply` 与 `exports.inject`（`scripts/build-client.mjs:40-41` 的 banner/footer 注入；`client/src/entry.js:5-6` 声明 `inject = ["remote"]`）。
- 前端 id 与装配行对应：主包 `"dsh-lab-agent"`，域包替换为 `"dsh-lab-ui"`（build-domain-packages.mjs:33）。
- 页面注册走插槽：`ctx.slots.register({ name: 'lab.workbench' }, render)`（`client/src/workbench.js:226-230`）。

## 5. 占位插件的验收标准建议

1. 可安装：本地 tgz 装进干净 profile 后 `pluginManager.listBundles` 出现该包，`version` 与主包一致，装包过程无重复 id 报错。
2. 可停用：`setBundleEnabled(name,false)` 后重启，工作台不再有「论文润色」入口，其余六个模块与对话不受影响；重新启用后入口恢复。
3. 不注册假工具：工具清单里没有 `lab_polish*`；`preset.patch.yml` 不新增工具行；不伪造任务/进度/产物记录；前端不出现「已润色」类结论。
4. 页面如实：入口 label 为「论文润色」，页面正文明确「尚未实现 / 暂不可用」；无 textarea 提交、无 `onTask`、无自动保存。
5. 不写数据：打开占位页不创建 `草稿/论文润色.md`，不调用 `projects_draft_write`（可保留只读兼容）。
6. 装配隔离：只依赖 core 公开契约，不 import 其它子插件源码；bundle patch 不重复注册母插件已注册的 id；停用后不残留 slot/remote 注册。
7. 数据无损：停用、卸载、重装均不删除用户既有草稿与项目文件。
8. 回归：`tests/unit/proposal-retirement.test.mjs:16-22`（源码断言占位含「暂不可用」且不含 `onTask|submit`）继续通过；占位迁出 `client/src/workbench.js` 时须同步修改该测试的取样路径。

## 6. 风险

1. 陈旧域包客户端：`packages/dsh-lab-ui/client/index.js:82310/82414-82437/82679` 仍带申报入口与润色提交，且 `pack-domain-release.mjs:13-14` 会判 stale。发布前必须重建，否则「已移除」只在源码成立、在 tgz 不成立。
2. 双客户端面：根包 `client/index.js` 与 `dsh-lab-ui` 的 `client/index.js` 是同一 bundle 两份拷贝，仅靠构建脚本保持一致；新增润色包若也注入 client，需避免 `lab.workbench` 插槽重复注册或导航项重复。
3. 草稿兼容层归属不清：`polishing` 仍是 core 的合法 draft kind，remote 写入未封（lib/remote.js:225 只拦 proposal）。若新插件自管草稿，需决定复用 `草稿/论文润色.md` 还是另立目录，否则出现两份数据源。
4. 现存脚本/文档陈旧：`scripts/migration/verify-workbench.mjs:85-95` 对占位页必然失败；`docs/WORKBENCH_DEVELOPMENT.md:6,10`、`docs/PROJECT_FILES.md:13` 仍写申报入口，验收时易误判。
5. 命名冲突：计划建议包名 `@ibm-lab/polishing`（`docs/PLUGIN_DECOUPLING_PLAN_2026-11-03.md:53`），但现有包与装配 id 均为 `dsh-lab-*`；宿主按包名发现，改名需同步 catalog、bundles 与安装脚本。
6. 版本锁定：所有子包把 `dsh-lab-agent` 钉在 `0.8.0-rc.1`（`packages/README.md:15`），占位包继承同一耦合，独立发版收益有限，短期内仍是「同仓同版」。
