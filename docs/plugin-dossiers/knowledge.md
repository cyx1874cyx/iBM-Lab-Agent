# 提取档案：RAG 知识库 → `@ibm-lab/knowledge`

目标包名/目录按 `docs/PLUGIN_DECOUPLING_PLAN_2026-11-03.md:49`（`@ibm-lab/knowledge`）与 `:146`（`plugins/knowledge`）。
现状：功能完整、界面完整，但**不是** Cordis service，也没有独立插件入口——挂在 `ibmCore` 的单例 + `lab-tasks-tool` 插件行里。

## 1. 文件清单

| 路径 | 行数 | 职责 | 建议迁移去向 |
| --- | --- | --- | --- |
| `lib/knowledge.js` | 164 | `ProjectKnowledge`：项目索引生命周期、共享库接入、会话存储、上传、来源解析、`knowledgeFor` 单例 | `plugins/knowledge/src/project-knowledge.js` |
| `lib/knowledge-tool.js` | 30 | 注册 `lab_research_read` + `lab_knowledge_list/search/add_to_reading` | `plugins/knowledge/src/tools.js`（`add_to_reading` 移出） |
| `lib/knowledge-assistant.js` | 72 | `system-prompt/assemble` 裁剪工具、`agent/pre-step` 强制检索、`tools/execute` 白名单 | `plugins/knowledge/src/assistant.js` |
| `lib/knowledge-permissions.js` | 3 | 7 个允许工具的 `Set` | `plugins/knowledge/src/permissions.js` |
| `lib/knowledge-reading.js` | 86 | 知识库文献 → 精读文件夹（正文/SI 校验、去重、归档） | **拆为文献侧 capability 适配器**，不进知识库包 |
| `lib/research-read.js` | 152 | `lab_research_read`：跨模块只读 + 复用 RAG 解析器 | 母插件通用只读工具（见 §6d） |
| `lib/rag/core.mjs` | 1969 | 检索核心**生成物**（esbuild 打包 vendor 所得，勿手改） | `plugins/knowledge/rag/core.mjs` 或保留 `lib/rag` 作内部库 |
| `lib/rag/geometry.cjs` | 873 | pdfjs 所需 `DOMMatrix` 纯 JS 替身 | 随 rag 资产 |
| `lib/rag/pdf-runtime.mjs` | 5 | 注入 geometry 后懒加载 `pdf.mjs` | 随 rag 资产 |
| `lib/rag/pdf.mjs` / `pdf.worker.mjs` | 34440 / 71071 | vendored pdfjs（生成物，不读） | 随 rag 资产（约 3.4 MB） |
| `vendor/dsh-rag/**` | entry.js 6；src/core 16 文件 ≈2100；deps 3.4 MB | 上游 DSH-RAG 0.2.1 源码（`knowledge-service.ts` 758、`knowledge-types.ts` 160、`local-vector.ts` 207、`bm25.ts` 130、`office-parser.ts` 147、`pdf-parser.ts` 127、`text-parser.ts` 112、`incremental-watcher.ts` 106 等） | 随包（带 LICENSE） |
| `scripts/build-rag.mjs` | 18 | esbuild 生成 `core.mjs`，拷贝 pdfjs/geometry/LICENSE | `plugins/knowledge/scripts/build-rag.mjs` |
| `client/src/components-knowledge.js` | 51 | `KnowledgePanel`：设置、资料选择、来源侧栏、拖拽上传、引用锚点 | `plugins/knowledge/client/panel.js` |
| `client/src/knowledge.css.js` | 26 | `.ib-knowledge*` 全部样式 | `plugins/knowledge/client/styles.js` |
| `docs/KNOWLEDGE_WORKSPACE.md` | 37 | 使用/数据/验证说明（迁移后随手册） | 随包 |
| `docs/PROJECT_RAG_DATABASE_ASSESSMENT.md` | 94 | 旧路线评估，已被现实现取代 | 留仓库历史 |
| `tests/integration/knowledge.test.mjs` | 81 | 索引/隔离/共享库/搬迁/单例共享（4 用例） | 随包 `test:integration` |
| `tests/integration/knowledge-reading.test.mjs` | 50 | 知识库→精读联动（属文献侧验收） | 文献包 + 双插件协作测试 |
| `tests/browser/knowledge.test.mjs` | 33 | 面板问答/来源/筛选/拖拽/窄屏 | 随包 `test:ui` |
| `tests/unit/knowledge-assistant.test.mjs` | ~41 | pre-step 强制检索与提示词 | 随包 `test` |

## 2. 对外接口

**Remote（`lib/remote.js:63-83`，装饰器注册 `:945-946`，命名空间 `lab.*`）**
`knowledge_state`(:66) `knowledge_search`(:67) `knowledge_prepare`(:68) `knowledge_sync`(:69) `knowledge_upload`(:70) `knowledge_attach`(:71-75) `knowledge_open_source`(:76-83) `knowledge_chat_state`(:64) `knowledge_chat_bind`(:65)。全部单 `request` 对象入参；客户端形状声明在 `client/src/descriptors.js:14-15`。
`knowledge_*` 不匹配 `lib/domain-remotes.js:4-10` 任何域名正则 → 只存在于聚合 facade。

**host service：无。** 没有 `ctx.provide('knowledge')`/`Service` 子类；`knowledgeFor(core)`（`lib/knowledge.js:157-164`）把 `ProjectKnowledge` 挂在 `ibmCore` 实例的 `Symbol.for('ibm.lab.knowledge.instance')`（`:8`）上，并借 `owner.ctx.effect` 注册关闭。取用点只有三处：`lib/remote.js:63`、`lib/knowledge-tool.js:16,26`、`lib/knowledge-assistant.js:11,15,33`。

**工具**：`lab_knowledge_list`、`lab_knowledge_search`（`knowledge-tool.js:10-13`）、`lab_knowledge_add_to_reading`（`:18-29`）、`lab_research_read`（由 `knowledge-tool.js:7` 顺带注册）。白名单见 `lib/knowledge-permissions.js:2`（含 `read`/`read_image`/`lab_project_memory_read`）。

**preset 可见性**：无独立行。随 `lab-tasks-tool` 行提供（`presets/lab-research/preset.patch.yml:385-386`），`lib/tasks-tool.js:746-747` 无条件下注册工具与助手；`inject=["tools","ibmLiteratureWorkflows","ibmCore"]`（`:24`）。即“装了母插件就有知识库”。

## 3. 数据所有权

项目内（`<workspacePath>`，`lib/knowledge.js:29` 建立）：
| 路径 | 内容 | 出处 |
| --- | --- | --- |
| `.ibm-rag/project-root.json` | `{version:1,path}`，搬迁重定位基准 | `knowledge.js:33,40` |
| `.ibm-rag/index/config.json` | `{schemaVersion:1,knowledgeBases:[{id,name,roots,createdAt}]}` | `core.mjs:1441,1465` |
| `.ibm-rag/index/catalogs/<baseId>.json` | `{schemaVersion,knowledgeBaseId,generation,documents[]}`（`documents[].literature` 供筛选） | `core.mjs:1442,1495` |
| `.ibm-rag/index/catalogs/<baseId>.checkpoint.json` | 增量同步断点 | `core.mjs:1498` |
| `.ibm-rag/index/indexes/<baseId>/manifest.json` + 活动索引 | 向量索引（默认不产生） | `core.mjs:305-315` |
| `.ibm-rag/index/contexts/<baseId>.json`、`retired-workspace-knowledge-bases.json` | AI context / 旧 workspace scope 退役记录 | `core.mjs:1578,1476` |
| `.ibm-rag/chat-sessions.json` | `{version:1,sessions:{},lastSessionId}`，每 session 存 settings/retrieval/retrievals(≤30)/retrievalStatus | `knowledge.js:107,115` |
| `literature/`、`knowledge/materials/` | 索引源根（自动创建；后者为上传落点，文件名 `sha16 原名`） | `knowledge.js:29,31,137` |

全局：`$DSH_HOME/lab-agent/knowledge/libraries.json` = `{version:1,libraries:[{id,path}]}`（≤12 个，`knowledge.js:55,59`；根由 `src/paths.js:30` 的 `labAgentRoot()` 决定）。
共享库：外部索引目录**只读**，按 `(config.json mtime,size)+(各 catalog mtime,size)` 指纹缓存（`knowledge.js:62-71`），并在 `:66` 拒绝非 `schemaVersion:1`、含 `scope`、非 UUID id 的配置——**不触发原插件的 preview-scope 迁移**。
外部读者：`lib/tasks/reading-reports.js:38` 读 `chat-sessions.json` 只为排除被知识库占用的会话 id；`lib/research-read.js:13` 把 `.ibm-rag` 列为私有路径禁止读取。

## 4. 硬依赖

**ibmCore**
- `lib/knowledge.js:20` `core.getProject(projectId)`；`:21` 要求 `workspacePath` + `projectFilePath`
- `lib/knowledge.js:120` `core.getProjectBySession(sessionId)`（`bindChat` 归属校验）
- `lib/knowledge-assistant.js:14,32,60` 每轮 `getProjectBySession`
- `lib/remote.js:72` `ibmCore.requireProject`（`knowledge_attach`）
- `lib/knowledge-reading.js:79` `knowledge.core.commitSourceBundle(bundle)` 直接写 core 的 bundles 表（同一 API 见 `lib/tasks/reading-reports.js:52`）

**ibmScientificDesktop broker**
- `lib/remote.js:73` `chooseKnowledgeIndex`（300 s 目录选择）
- `lib/remote.js:78-82` PDF：读全量 bytes → `stage` → `preview` → `discard`；其他：`revealKnowledgeSource`
- 实现 `electron-next/scientific-runtime.mjs:260-268`

**knowledge-reading.js → 文献**
- `lib/knowledge-tool.js:25` `ctx.get('ibmLiteratureWorkflows')`
- `lib/knowledge-reading.js:4` `normalizeDoi` ← `src/literature/search-engine.js`；`:5` `validateReadingFolderName` ← `lib/tasks/organization.js`
- `:57,58,62,63,64,65,66,67,68,77,79,80` 调 `listReadingFolders/saveReadingFolder/listBundles/listReadingReports/registerPaperMeta/ensureReadingEntry/bindReadingSession/ensureBundleEntryLayout/classifyReadingReport/stageFileIntoEntry/getBundle/recordProvenance`

**research-read → rag + 另外 5 个插件**
- `lib/research-read.js:9` `import {parsePdfDocument,parseOfficeDocument,parseTextDocument} from './rag/core.mjs'`
- `:51-58,122` `labCharacterization`/`labNmr`/`labPlotRecords`/`labSynthesis`/`labChemistry`/`labGoals`/`labNoteTemplates`/`labTemplates`/`labExperimentPlanTemplates`/`labRemote.reagentCatalog()`

## 5. 客户端接线点

`components-knowledge.js` 是**唯一**知识库 UI（全库 grep 确认 `components-core.js`、`components-project.js` 无相关关键词）。
- 挂载：`client/src/workbench.js:211`（`module.id==='knowledge'` → `h(KnowledgePanel,{...})`）
- 模块清单硬编码 `workbench.js:14-22`（`{id:'knowledge',label:'RAG 知识库',icon:'layers'}`，非注册制）
- 外壳状态：`workbench.js:86` `knowledgeActive`，决定 `:182` `data-knowledge`、`:196` 隐藏“对话”按钮、`:216,220` 隐藏默认聊天槽
- header 按钮经 `createPortal` 注入 `workbench.js:202` 的 `.ib-wb-page-actions`（`components-knowledge.js:40`）
- 新会话：`workbench.js:134-143` `openKnowledgeChat` → `launchProject({freshSession,knowledge})` → `client/src/apply.js:210` `knowledge_chat_bind`
- 样式：`client/src/styles.js:6,106` 无条件拼入 `knowledgeCss`
- 轮询：`components-knowledge.js:28` 每 1.5 s 拉 `knowledge_state` + `knowledge_chat_state`（文档 `KNOWLEDGE_WORKSPACE.md:29` 写的是 5 s，已不一致）

## 6. 拆分阻碍

**a) `knowledge-reading.js` 与文献实现函数级耦合**：12 个 `tasks.*` 方法 + `core.commitSourceBundle` + `normalizeDoi` + `validateReadingFolderName`（见 §4）。拆法：RAG 只交出 `{folderName, items:[{libraryKey,sourceId,literature,contentHash,bytes}]}`，由文献插件校验哈希、建档、落盘；RAG 保留“引用解析”（catalog 查 `paperId`/DOI/`T轮次:S编号`，`knowledge-reading.js:26-39`）。

**b) `knowledgeFor` 单例挂在 core 上**（`knowledge.js:157-164`）：以 `Symbol.for('cordis.original')` 穿透 Cordis 的 traceable proxy、缓存到真实 provider，并靠 `owner.ctx.effect` 做清理。拆出后应改为真正的 Cordis service；过渡期必须保留“旧 Symbol 命中则复用”的兜底，否则同一项目会同时跑两个 watcher（`tests/integration/knowledge.test.mjs:73-80` 正是在钉这一点）。

**c) `remote.js` 的 `knowledge_open_source` 直连 broker**（`remote.js:76-83`）：`attach` 的目录选择也在 `:73`。这两处让知识库 Remote 无法脱离桌面宿主 → 需宿主 adapter（选目录 / 内嵌预览 / 资源管理器定位），浏览器端要有降级返回。

**d) `lab_research_read` 把 5 个其他插件的读取塞进知识库工具集**（`research-read.js:51-58`），并复用 RAG 解析器（`:9`）。不搬走则知识库反向依赖文献/核磁/绘图/合成/试剂；搬走后解析器需下沉为共享库（否则母插件也要依赖 rag）。

**e) 客户端未注册化**：模块清单与外壳 CSS 状态写死在 `workbench.js:14-22,182-220`，且 `styles.js` 全局注入，拆出后需母插件提供 module/UI 注册槽（计划 §5）。

**f) `core.mjs` 是生成物**（banner `scripts/build-rag.mjs:8`）：任何检索改动都必须回 `vendor/dsh-rag` 改源码再重生成。其内还含领域硬编码：`core.mjs:1860` `CLOT-OUT→Clotild`、`:1861` `expandMedicalQuery`、`:1862` `diversifySources(maxPerPaper 2)`、`:1857` 过滤 `sectionKind==='references'`。

## 7. 最小可运行切片（MVS）

对齐计划 `P6`（`:137`）：母插件 + RAG 能独立接入、检索、定位来源；文献缺失时降级。
**保留**：`core.mjs`+pdf/geometry/pdf-runtime、`knowledge.js`（删 `addToReading` 与 `knowledge-reading` import）、`knowledge-tool.js`（仅 `list`/`search`）、`knowledge-assistant.js`、`knowledge-permissions.js`、`components-knowledge.js`+css、9 个 Remote（`open_source` 走宿主 adapter）、`build-rag.mjs`。
**移出/延后**：`knowledge-reading.js` + `lab_knowledge_add_to_reading`（→ 文献 capability）；`lab_research_read`（→ 母插件通用只读工具，解析器下沉共享库）；`libraries.json` 移到插件命名空间并保留旧路径只读兼容。
**不改**：`.ibm-rag/index` 格式、`chat-sessions.json` 形状、`project-root.json` rebase 逻辑。
**验收**：`node --test tests/integration/knowledge.test.mjs`（4 用例）、`tests/browser/knowledge.test.mjs`、`node scripts/build-rag.mjs` 可重建；仅母插件 + RAG 时 `list/search/sync/upload/attach/open_source/chat_*` 全通，`lab_knowledge_add_to_reading` 返回 `feature-unavailable`。

## 8. 风险与验收点

1. **检索质量回归**：`knowledge.js:79,101` 硬编码 `mode:'local-bm25'`、`degraded:false`，抹掉了 core 的降级信息（`core.mjs:1863-1866,1919-1922`）；`KnowledgeService` 构造时从不传 `embeddingProvider`（`knowledge.js:41,69` 无 options，而 `core.mjs:1444-1446` 支持）→ 现状永远是纯 BM25。接向量/重排时前端与测试断言要同步改。
2. **项目内索引兼容**：`core.mjs:1468` 只接受 schemaVersion 1/2；`knowledge.js:66` 拒绝带 `scope` 的共享配置；`knowledge.js:34-39` 的 rebase 是“项目文件夹可整体搬迁”的唯一实现，删掉即老项目索引失效。验收必须含 `knowledge.test.mjs:59-65` 的搬迁用例。
3. **会话数据双写**：`.ibm-rag/chat-sessions.json` 由 `knowledge.js:107-117` 写、`lib/tasks/reading-reports.js:38` 读，任一侧改格式都会打穿另一侧。
4. **Obsidian 预留**：全库无 obsidian 代码（仅 `PLUGIN_DECOUPLING_PLAN:113` 提出）。建议在插件内定义 `knowledgeSource` 适配器（`list()/read(id)/changed()`），Obsidian 即“vault 目录源”——与现有 `roots` 扫描天然同构；增量同步、重命名/删除冲突本轮不实现。
5. **体积与构建**：pdfjs 生成物约 3.4 MB（`pdf.mjs`+`pdf.worker.mjs`）+ vendor 3.4 MB，随插件走；`build-rag` 依赖 devDependency `esbuild`，独立发布需自带锁文件。
6. **接口面回归**：`knowledge_attach` 依赖 broker 300 s 超时与“取消”语义（`remote.js:73-74`），adapter 化后需保留 `{cancelled:true}` 返回形状（`components-knowledge.js:31` 依赖 `value.cancelled`）。
