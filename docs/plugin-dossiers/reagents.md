# 试剂管理子插件提取档案

范围：`plugins/reagents/` 及其宿主接线；仓库 `Code/iBM-Lab-Agent-electron-next`（0.8.0-rc.1）。只读盘点，未构建。
当前进度：**宿主服务已抽到 `plugins/reagents/lib/service.js`（`labReagents`，`inject=[]`），remote 与集成测试已接上**；剩余缺口集中在客户端独立入口、Remote 三方法的真正搬离、以及装配登记。

## 1. 文件清单

| 路径 | 行数 | 职责 | 迁移状态 |
| --- | --- | --- | --- |
| `plugins/reagents/package.json` | 19 | 包声明 + `dsh.bundle.patch` + `./service`/`./cordis.patch.yml` 导出；peer 仅 cordis | 已迁移 |
| `plugins/reagents/cordis.patch.yml` | 10 | 装配行 `lab-reagents`，`root: dshHomePath('lab-agent/reagents')` | 已迁移 |
| `plugins/reagents/lib/service.js` | 71 | `ReagentsService`（`labReagents`）：catalog 惰性单例、broker 按需查找、`search/chooseSource/openSource`、本地 cleanJson | 已迁移 |
| `plugins/reagents/lib/index.js` | 3 | 包入口：再导出 service / catalog / workbook | 已迁移 |
| `plugins/reagents/src/catalog.js` | 49 | `ReagentCatalog`：sources.json 读写、mtime+size 缓存、三清单检索/分页/评分 | 已迁移 |
| `plugins/reagents/src/workbook.js` | 78 | `parseReagentWorkbook`：JSZip+fast-xml-parser 直读单元格、表头/层位/CAS-日期/用完标记 | 已迁移 |
| `plugins/reagents/test/catalog.test.mjs` | 20 | 包内测试：未配置目录可检索、拒绝未知类型 | 已迁移 |
| `lib/reagents.js` | 2 | 兼容再导出 catalog（过渡层） | 待删 |
| `src/reagents/workbook.js` | 2 | 兼容再导出 workbook（过渡层） | 待删 |
| `lib/remote.js` | 1132（85-101） | `reagentCatalog()` 优先 `ctx.get('labReagents').catalog()`，缺席回落旧实现；3 个 Remote 仍在 | 半迁 |
| `lib/research-read.js` | 152（7、11、121-126、143） | `lab_research_read` 的 `reagents` 资源；仍经 `labRemote` + 自带兜底构造 | 待迁 |
| `client/src/components-reagents.js` | 62 | `ReagentPanel`（搜索/三类筛选/来源管理/详情弹层/20s 轮询） | 待迁 |
| `client/src/reagents.css.js` | 48 | 本域选择器（`.ib-reagent-*`、容器查询） | 待迁 |
| `client/src/workbench.js` | 230（10、17、210） | 模块导航行 + 唯一渲染点 | 待迁（母插件插槽） |
| `client/src/styles.js` | 119（5、105、107） | 把 `reagentsCss` 拼进单一样式表 | 待迁 |
| `client/src/descriptors.js` | 69（16） | 3 个 Remote 的 wire 描述符 | 待迁 |
| `electron-next/scientific-runtime.mjs` | 361（269-278） | broker `chooseReagentSource`/`openReagentSource`（Electron 主进程） | 宿主适配层 |
| `tests/integration/reagents-plugin.test.mjs` | 38 | 只装 core + 插件的独立装配验收；无桌面桥时 `feature-unavailable` | 已迁移 |
| `tests/integration/reagents.test.mjs` | 31 | 经 `lib/reagents.js` 的目录级集成测试 | 待迁 |
| `tests/unit/reagent-workbook.test.mjs` | 15 | 经 `src/reagents/workbook.js` 的解析测试 | 待迁 |
| `tests/browser/reagents.test.mjs` | 40 | esbuild+puppeteer 渲染 `client/src` 真组件 | 待迁 |
| `tests/helpers/reagent-workbook.mjs` | 21 | xlsx 夹具（日期 CAS、错表头、空表） | 可共享 |
| `docs/REAGENT_SEARCH.md` | 15 | 用户可见行为（含 `lab-agent/reagents/sources.json`） | 保留 |

## 2. 对外接口

- **host service**：`ReagentsService`（service.js:26）`super(ctx,'labReagents')`，`static inject=[]`（:31），`constructor` 解析 `config.root ?? $DSH_HOME/lab-agent/reagents`（:33-37），`catalog()` 惰性 `new ReagentCatalog`（:39-41），`broker()` 调用时 `ctx.get('ibmScientificDesktop')`，缺失抛 `code:'feature-unavailable'`（:43-51）。**是** Cordis service（`extends Service`），不再挂在 `LabRemoteService` 字段上。
- **Remote**：仍是 3 个 `@Remote` —— `reagents_search` / `reagents_choose_source` / `reagents_open_source`（remote.js:91-101），加上**未暴露**的内部方法 `reagentCatalog()`（:86-90，任务书里数的第 4 个）。方法体还没搬到插件：remote.js:94 自行 `requireBroker().call('chooseReagentSource')`、:96/:100 直接操作 catalog，绕过了 `service.chooseSource/openSource`。
- **工具**：无专属工具。模型通道只有 `lab_research_read` 的 `resource:'reagents'`（research-read.js:11、121-126，描述 :143），注册链 `lib/tasks-tool.js:746 → lib/knowledge-tool.js:7`，仅在预设行 `lab-tasks-tool`（`presets/lab-research/preset.patch.yml:385-387`）挂载。
- **preset**：无试剂专属行/段落；插件缺位时 preset 零残留，但工具描述与知识库指令仍写「试剂清单」。

## 3. 数据所有权

- **配置**：`$DSH_HOME/lab-agent/reagents/sources.json`（catalog.js:12），`{version:1,sources:[{id,path}]}`；原子写 tmp+`rename`（:18-19）。插件化后目录不变，仍由 `cordis.patch.yml:10` 的 `dshHomePath` 注入。
- **用户选择路径**：每条 `path` 是用户选的本机绝对 `.xlsx`（catalog.js:8 校验绝对路径+扩展名），**只读**，不复制不归档；文件移动需重新关联。
- **缓存**：进程内 `Map`，键 `chemical|biological|cells`，fingerprint=`path:mtimeMs:size`（:24-29）；`refresh:true` 强制重读；读失败回落同路径旧缓存并标 `stale`（:37-39）；单文件上限 25 MB（:23）。无持久化索引。
- **Excel 解析入口**：`parseReagentWorkbook`（workbook.js:20），入参为 Buffer，不落中间文件、不依赖 Excel/LibreOffice；表头两级兜底（:51-57），记录结构 :71。
- **边界**：不碰 `storageDomain`/`lab_tasks`/课题工作区；数据与当前课题无关。

## 4. 依赖

- **ibmCore**：`lib/remote.js` 仍 `static inject=["ibmCore"]`（整个 `lab` Remote 因它启动），但试剂方法本体不读 ibmCore；`lib/research-read.js:44` 的 `core()` 用于给 `reagents` 资源定位/鉴权（:113 `requireProject`）。插件侧 `inject=[]`，**不依赖 ibmCore**。
- **ibmScientificDesktop broker**：插件 service.js:60/67 与 remote.js:94/:100 都调 `chooseReagentSource`（300000ms）/`openReagentSource`；实现体在 `electron-next/scientific-runtime.mjs:269-278`。broker 仅在 `config.electron ?? IBM_LAB_AGENT_BUNDLED_ELECTRON` 存在时创建（`lib/scientific-desktop.js:15-16`），否则 `requireBroker()` 抛 `RemoteError('feature-unavailable')`（:32-35）——纯 Web 形态下「关联/打开清单」天然不可用。
- **webServer**：**无**。无 HTTP 路由、无静态资源、无二进制下载；全部走 Remote + broker。
- 路径来源：`labAgentRoot()`（`src/paths.js:30-32`）；插件自己实现了同语义的 `defaultRoot()`（service.js:21-24），不 import 母插件。

## 5. 客户端接线点

- **渲染者**：唯一渲染点 `client/src/workbench.js:210`（`module.id==='reagents'` 时 `h(ReagentPanel,{call})`）；导航/标题来自 `WORKBENCH_MODULES`（workbench.js:17，label「试剂管理」、icon `flask`）。
- **descriptors**：`client/src/descriptors.js:16` 一行注册三个 `direct(name,['request'])`；必须与 `lib/remote.js` 末尾 `REMOTE_INITIALIZERS` 中的名字逐字一致，否则 `$mount` signature 报错。
- **样式**：`client/src/styles.js:5` 导入 + `:105` 追加进单一 `<style data-plugin-css=dsh-lab-agent>`（:107 幂等守卫）。本域无独立注入通道。
- **构建入口**：`client/src/entry.js`（6 行）→ `scripts/build-client.mjs:33-48` esbuild → `client/index.js`（另存 `dist/lab-client.bundle.js`），命令 `npm run build:client`；`client/index.js:81900` 起是生成的 `ReagentPanel` 副本，`packages/dsh-lab-ui/client/index.js` 是再拷贝。
- **面板状态**：`useProjectViewValue('_lab','reagents-query'/'reagents-kind')`（components-reagents.js:10-11）落在 `ib-project-view:*` localStorage。

## 6. 拆分阻碍（按当前进度重估）

1. **Remote 未真正搬离**：remote.js:91-101 仍自己调 broker 与 catalog；插件已提供 `service.search/chooseSource/openSource`，但没有任何调用方使用它们 —— 两套实现并存，行为漂移只是时间问题。
2. **`lib/research-read.js:122` 仍绕路**：`this.service('labRemote')?.reagentCatalog() ?? new ReagentCatalog(...)`。common path 经 remote 委托到 `labReagents`（可接受），但兜底构造保留了第二个实例与第二条路径，且强依赖 core 域的 `labRemote` 存在；应改为 `this.service('labReagents')?.catalog()`。
3. **客户端没有独立入口**（最大缺口）：无 `plugins/reagents/client/`，`ReagentPanel` 仍由 `workbench.js:10/210` 静态导入，CSS 由 `styles.js:105` 合并，导航行硬编码在 `WORKBENCH_MODULES`（workbench.js:14-22）。母插件没有「模块注册」插槽，插件无法自报入口。
4. **兼容导出仍有 4 个调用方**：`lib/reagents.js` ← `lib/remote.js:19`、`lib/research-read.js:7`、`tests/integration/reagents.test.mjs:6`、`tests/integration/research-read.test.mjs:10`；`src/reagents/workbook.js` ← `tests/unit/reagent-workbook.test.mjs:3`。
5. **描述符双清单**：`lib/remote.js` 装饰器列表与 `client/src/descriptors.js:16` 手工同步；wire id 仍是 `dsh-lab-agent#lab/reagents_*`，改名即破坏旧客户端。
6. **装配未登记**：`bundles/catalog.json` 无 `reagents` 域、`bundles/` 无 `reagents.patch.yml`、`packages/` 无 `dsh-lab-reagents`；根 `package.json` 仍以 `files: ["plugins/reagents"]` 夹带（未用 workspace 依赖）。`pnpm-workspace.yaml` 无 `packages:` 段。所以「可停用」目前只在测试宿主里成立。
7. **提示词/工具文案耦合**：`lib/knowledge-assistant.js:19/52` 与 `research-read.js:143` 把「试剂清单」写死；插件缺位时模型仍会调用不存在的入口。
8. **UI 细节跨域**：`components-reagents.js:58` 复用 `.ib-lit-empty` 空态样式。

## 7. MVS checklist（更新后）

已完成：
- [x] 包身份：`@ibm-lab/reagents` + `dsh.bundle.patch` + `./service` 导出（package.json:6-18）。
- [x] 装配行：`plugins/reagents/cordis.patch.yml`（`lab-reagents`，root 注入）。
- [x] Cordis 服务：`labReagents`，`inject=[]`，broker 按需查找、缺失即 `feature-unavailable`。
- [x] remote 委托：`reagentCatalog()` 优先用插件实例（remote.js:87-89）。
- [x] 独立装配测试：`tests/integration/reagents-plugin.test.mjs`（coreOnly + file URL 行）。

仍缺（按建议顺序）：
- [ ] **客户端独立入口**：`plugins/reagents/client/index.js`（`export{apply}; export const inject=['remote']`），`apply` 内注册工作台模块 + 自己的 `<style>`；前置条件是母插件先提供模块/面板注册插槽，替换 `workbench.js:14` 的硬编码数组与 `:210` 的静态渲染。
- [ ] 样式出栈：`reagents.css.js` 随包走，删除 `styles.js:5/105`。
- [ ] Remote 归位：三方法搬进插件（建议 `lib/reagents-remote.js`，`TypertRemoteService`），`lib/remote.js` 保留一个版本的委托 + `feature-unavailable` 降级；名字沿用 `lab/reagents_*` 以免破客户端。
- [ ] 描述符单一真源：`client/src/descriptors.js:16` 由插件 client 入口提供或按 manifest 生成。
- [ ] `lab_research_read` 改读 `labReagents.catalog()`，删除 `research-read.js:122` 兜底；同步 `:143` 与 `knowledge-assistant.js:19/52` 文案，插件缺位时该 resource 明确不可用。
- [ ] 测试迁移：`tests/unit/reagent-workbook.test.mjs`、`tests/integration/reagents.test.mjs`、`tests/browser/reagents.test.mjs` 改为导入插件公开路径（`./workbook`、`./service`、插件 client 入口），并让 browser 测试打插件自己的 bundle。
- [ ] 收尾删除：`lib/reagents.js`、`src/reagents/workbook.js`；根 `package.json` 的 `files` 去掉 `plugins/reagents`，改 `file:`/workspace 依赖。
- [ ] 装配登记：`bundles/catalog.json` 增 `reagents` 域（`requires: []`），补 `bundles/reagents.patch.yml`，给 `scripts/migration/build-domain-packages.mjs` 加分支（现仅 ui 有 client 入口）。
- [ ] 文档：`docs/REAGENT_SEARCH.md` 补「可停用/不可用提示」语义。

## 8. 风险与验收点

风险：
1. **两套实现并存**（remote.js:91-101 vs service.js:53-68）：现已分叉，任一侧修 bug 另一侧不会跟随；优先让 remote 全量委托。
2. **第二个 catalog 实例**（research-read.js:122 兜底）会造成两套 `stale` 判定与两次全量解析。
3. **公开 API 改名**：`lab/reagents_*` 被旧客户端、descriptors、browser 测试直接引用；必须保留一版兼容委托。
4. **`config.reagentsRoot` 语义**：remote.js:89 兜底仍读它，插件只读 `config.root`；若某部署只设了前者，插件启用后会「三份清单全未关联」。
5. **解析启发式回归**：表头两级兜底依赖中文词表，迁移不应顺手改规则。
6. **桌面能力降级**：broker 缺失必须给结构化错误（插件已做，remote 侧仍抛 `RemoteError`），且 `stale`/`error` 语义需一致。
7. **独立入口缺位时的假独立**：服务能独立启动，但 UI 仍随母插件编译，容易被误判为「已解耦」。

验收点：
- 迁移前后 `search()` 的 `records/counts/locations/sources` 逐字段相等（含 CAS-日期、空名称、零数量、跨柜重名行号）。
- `choose_source` 取消返回 `{cancelled:true}` 且不写 `sources.json`；成功后新路径立即生效、旧缓存失效。
- 无桌面桥：`labReagents.chooseSource` 抛 `feature-unavailable`，母插件启动不受影响（现有测试已覆盖）。
- 停用插件后：母插件可启动、工作台无「试剂管理」入口、`lab_research_read` 的 `reagents` 返回功能不可用而非崩溃。
- 仓库外安装：`node --test plugins/reagents/test/*.test.mjs` 通过，且包内不出现 `lib/`、`src/`、`client/src/` 的母插件路径导入。
