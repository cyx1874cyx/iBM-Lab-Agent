# 文献阅读子插件 · 提取档案

只读源码核实（2026-11-03）。lib/tasks/ 共 19 个文件 3823 行；入口 `index.js` 是转发门面，实现在 `workflows.js` 组合 13 个 methods 模块。标「未核实」处留空不猜。

## 1. 文件清单

| 路径 | 行数 | 职责 | 建议迁移去向 |
|---|---|---|---|
| lib/tasks/workflows.js | 221 | host service `ibmLiteratureWorkflows`：init 迁移/恢复 + 组合 13 模块 | 子插件（服务主类） |
| lib/tasks/index.js | 68 | 转发门面 `labTasks` → `ibmLiteratureWorkflows`（原型逐个转发） | 母插件（兼容壳） |
| lib/tasks/literature.js | 664 | 检索、检索记录/RIS、paper meta、preparePaper、暂存登记、引用导出 | 子插件 |
| lib/tasks/pdf-intake.js | 354 | PDF/SI 上传→识别→匹配→重试队列（zod + 一次 LLM 识别） | 子插件 |
| lib/tasks/reading-reports.js | 551 | 精读报告：创建/写契约/DOCX/校验/人工复核/下载 | 子插件 |
| lib/tasks/presentations.js | 455 | 文献汇报 PPT：创建/契约/从模板构建/QA/复核 | 子插件（PPT 段） |
| lib/tasks/reviews.js | 261 | 综述：检索条目 → 综述文档/综述 PPT | 子插件 |
| lib/tasks/entry-admin.js | 354 | 条目命名、产物重新提交、删除条目 | 子插件 |
| lib/tasks/staging.js | 109 | bundle 条目布局与文件落位（含旧 captured-literature 迁移） | 子插件（核心） |
| lib/tasks/organization.js | 87 | 精读文件夹、分类、RIS 导入 | 子插件 |
| lib/tasks/reader.js | 194 | 侧栏 PDF 阅读租约/分块/字体资产 + 全文翻译流水线 | 子插件（阅读器） |
| lib/tasks/reading-dedup.js | 69 | 重复条目合并 `canonicalReadingRecord` | 子插件 |
| lib/tasks/wechat.js | 231 | 公众号文章抓取、DOI 校验、登记 | 子插件 |
| lib/tasks/provenance.js | 32 | 产物溯源 `recordProvenance` + KIND_TO_SKILL | 子插件 |
| lib/tasks/projects.js | 35 | 课题 CRUD 转发，create 时依赖 labGoals/labTemplates | 母插件 |
| lib/tasks/shared.js | 61 | 引用规范化/路径判定/原子写 | 母插件（documents 也用） |
| lib/tasks/office-pdf.js | 44 | office→pdf 小封装 | 母插件（共享） |
| lib/tasks/organization-tools.js | 12 | 注册 2 个文件夹/分类工具 | 子插件 |
| lib/tasks/reader-tools.js | 14 | 注册 6 个 `lab_reader_translation_*` 工具 | 子插件 |
| lib/tasks-tool.js | 2171 | 29 个模型工具（检索登记/捕获/浏览器/综述/条目维护） | 子插件（工具层） |
| lib/entry-layout.js | 294 | 条目五段命名规范与目录/文件名布局 | 子插件，抽成可共享包 |
| lib/literature-sources.js | 830 | `labLiterature`：数据源探测、授权会话、下载任务 | 子插件 |
| lib/literature-browser.js | 226 | CDP 可见浏览器抓取 PDF | 子插件 |
| lib/manual-capture.js、capture-phase.js、capture-handoff.js | 941/460/250 | `labCapture` 捕获任务 + 状态唯一真相 + Edge handoff 页（合计 1651） | 子插件 |
| lib/ppt-templates.js、ppt-template-lint.js、pptx-manifest.js、pptx-plan.js、ppt-build-tool.js | 2614 | `labTemplates` 模板域 + lint + pptx-cli 封装 + plan 编译 + 构建工具 | 母插件（模板域，最后动） |
| lib/note-templates.js | 333 | `labNoteTemplates` 阅读笔记模板 | 母插件 |
| src/literature/*.js（7 个） | 950 | 检索/引用/材料匹配/阅读顺序/RIS 内核 | 子插件内核 |
| client/src/components-literature.js | 443 | 全文获取队列、课题徽标、研究文件上传 | 子插件 |
| client/src/reader-*.js（6 个） | 312 | PDF.js 双栏阅读器 tab、材料、滚动同步 | 子插件 |
| client/src/reading-*.js（4 个） | 175 | 拖拽、右键菜单、链接上传、图标 | 子插件 |
| client/src/project-task-session.js | 73 | 条目会话解析/串行队列 | 母插件（共用） |
| client/src/project-tab.js、components-templates.js | 218/443 | 课题资源 tab、模板管理页 | 母插件 |
| client/src/descriptors.js、apply.js | 70/384 | 远端描述符、UI 装配与接线 | 双方按域切分 |

## 2. 对外接口

**Remote（`lab` 命名空间，domain-remotes.js:7 用前缀正则切出，共 75 个）**
- `tasks_*`（48）：search_create/searches/search_delete/search_import_ris/search_ris；bundle_create/bundle_delete；report_create/complete/validate/review/delete/download；presentation_create/complete/validate/review、ppt_download；review_details/inputs/register/review_presentation_register/review_download；entry_naming；overview；provenance；reading_pdf_upload/pdf_retry/si_upload/folders/folder_save/folder_delete/classify/move/bind_session/conversation；reader_open/materials/chunk/close/asset/zip_pdf；translation_bind/create/finish/read/image/cancel
- `literature_*`（9）：status/configure/connect/verify/sources/download_create/downloads/download_retry/download_cancel
- `manual_capture_*`（8）：create/get/cancel/claim_agent/list/recreate/desktop_status_update/desktop_action_claim
- `browser_operation_*`（2）：claim/complete；`review_templates_list`（1）
- `goals_*`（7）：list/resolve/create/update/copy/delete/requirements（labGoals 域被文献正则捕获，见 §6）
- 客户端描述符只声明了 73 个：缺 `tasks_reading_si_upload`、`literature_sources`（descriptors.js:33）

**host service**：`ibmLiteratureWorkflows`（workflows.js:60）、`labTasks`（index.js:39）、`labLiterature`（literature-sources.js:168）、`labCapture`（manual-capture.js:261）、`labCaptureHandoff`（capture-handoff.js:170）。注入依赖：ibmCore/ibmRuntime/ibmDocuments/labGoals/labTemplates/labNoteTemplates（workflows.js:51）、storageDomain/webServer（manual-capture.js:284、297）。

**注册工具（模型可见）**：tasks-tool.js 29 个 —— `lab_tasks_*` 19（register_search/get_search_summary_inputs/update_search_summaries/fetch_wechat_article/resolve_wechat_doi/register_wechat_paper/register_paper_meta/register_bundle/get_reading_inputs/register_report/register_presentation/set_entry_naming/update_bundle_file/update_report/update_presentation/delete_bundle/get_review_inputs/register_review/register_review_presentation）、浏览器 8（lab_publisher_browser_download(+status,+capture_list,+cancel)、lab_nature_browser_download(+status)、lab_browser_operation_status、lab_browser_wait）、lab_review_templates_list/get；reader-tools.js 6；organization-tools.js 2；knowledge-tool.js 3（含 lab_knowledge_add_to_reading）；ppt-build-tool.js 2；templates-tool.js 5。

**preset 暴露**（presets/lab-research/preset.patch.yml）：`lab-tasks-tool`（385-387）、`lab-ppt-build-tool`（393-395）、`lab-templates-tool`（389-391）；共享 `lab-convert-tool`（373-375）、`lab-memory-tool`（381-383）。

## 3. 数据所有权

- storage domain `lab_tasks` v0（core/domain.js:4-17）8 表：lab_projects、project_memory_versions、project_sessions、literature_search_runs、paper_source_bundles、reading_reports、presentation_runs、artifact_provenance。repository 别名与作用域见 repositories/index.js:2-12；文献侧只取 searches/bundles/reports/presentations/provenance（workflows.js:70），门面取 8 表全部（index.js:44）。
- 独立 domain：`lab_literature_sources`（literature_sessions、literature_downloads）、`lab_captures`（lab_capture_tasks）、`lab_ppt_template_profiles`、`lab_note_template_profiles`（note_template_profiles + note_template_settings）。
- 课题目录：`<workspace>/literature/<entryStem>/`（正文 pdf、` SI`、精读报告 md/docx、文献汇报 pptx、契约 json，entry-layout.js:20-24/270-292）；综述 `<workspace>/literature/reviews/<stem>/`（reviews.js:59-63）；译文 `<entryDir>/translations/<id>/{original.pdf,draft.json,reader.json,translated.pdf}`（reader.js:120-122）；旧目录 `<workspace>/captured-literature/<bundleId>/`（staging.js:48）。
- `$DSH_HOME`：lab-agent/projects（core/index.js:23）、lab-agent/templates（cordis.patch.yml:125）、lab-agent/literature-sessions、lab-agent/literature-downloads（183-184）、vendor/nature-skills、.venv、scientific-desktop。

## 4. 硬依赖（文件:行）

- ibmCore：workflows.js:63/70/74/157/169/191；index.js:40/44；literature.js:435/541/618；entry-admin.js:99/102/121/231；organization.js:11/29/40/46/53/56/58/61/74；staging.js:20/43/64；reader.js:41/54/113/115/133/136；reading-reports.js:34/46/504；pdf-intake.js:160/164/195/295
- ibmRuntime：workflows.js:71（createExecutor）、provenance.js:20（skill 版本）、pdf-intake.js:273
- ibmDocuments：reading-reports.js:121/453、presentations.js:282/385
- labGoals：reading-reports.js:196、projects.js:10、remote.js:208；labTemplates：presentations.js:70/73、projects.js:11
- labNoteTemplates：reading-reports.js:204/258、reviews.js:76/122
- labCapture ↔ labTasks：manual-capture.js:312、tasks-tool.js:751
- 知识库 → 文献：knowledge-tool.js:25-26、knowledge-reading.js:5/57-80
- 分析域 → 文献：characterization-tool.js:170、evidence-shot.js:271、artifact-download.js:162
- 记忆工具 → 文献：memory-tool.js:25/99/100/175
- 文档域 → 文献 helper：documents.js:6-7、core/history-files.js:6

## 5. 客户端接线点

- apply.js:7 `buildDescriptors` → :372 `ctx.remote.$mount(...)`；:10 导入 ProjectBadge → :260 header 槽位；:264-302 右侧栏注入（:274-275 浏览器 tab、:278 registerProjectTab、:279 registerReaderTab、:280-287 setReaderRuntime、:289-301 课题面板）；:210-214 条目/翻译/核磁绑定
- descriptors.js:13-34 为方法清单（:33 是 73 个 request 型方法的单行大数组）
- reader-tab.js:8 `dsh-resource://lab-reader/`、:32-33 注册 tab 与 pane、:4 引 `client/vendor/pdfjs`（本次未读）
- 构建入口：client/src/entry.js:3 → apply.js；scripts/build-client.mjs:33 入口、:47 esbuild、产物写 client/index.js + client/dist/lab-client.bundle.js

## 6. 拆分阻碍（文件:行）

1. `index.js:31-33/46-66` 全量原型转发到 `ibmLiteratureWorkflows`，两个 service 同时注册（cordis.patch.yml:156-173）；任何一侧删改都会打断 `remote.js:329`、`characterization-tool.js:170` 等调用方。
2. `domain-remotes.js:7` 把 `goals_` 也划进文献命名空间 —— 子插件拿命名空间就把 labGoals 拖走。
3. 母插件反向依赖文献 helper：`documents.js:6`（entry-layout）、`documents.js:7`（tasks/shared）、`core/history-files.js:6`（entry-layout）。
4. 知识库直接 import 文献实现：`knowledge-reading.js:5`（tasks/organization.js 的 validateReadingFolderName），并直调 tasks 的 listBundles/saveReadingFolder/registerPaperMeta/stageFileIntoEntry（knowledge-reading.js:57-80）。
5. 其它域把 labTasks 当"课题组基础设施"：characterization-tool.js:170 ensureProjectWorkspace、evidence-shot.js:271 bundleFile、memory-tool.js:99-100、artifact-download.js:162。
6. PPT 工具反向依赖文献工作流：ppt-build-tool.js:64/135（materializePptContract / buildPresentationFromTemplate）。
7. 隐式状态：`this.tables` 由 init 写入、`table()` 才校验（workflows.js:161-165）；`executor` 经 provider getter/setter 代理（index.js:42）；方法归属靠 prototype `Object.assign`（workflows.js:218），静态分析不可见；readerLeases/withFolderLock 为内存态。
8. `src/literature/search-engine.js` 被 remote.js:16、skill-executor.js:21 共用，不能整体搬走。

## 7. 最小可运行切片（MVS）

**第一批（可独立装配）**：lib/tasks/{literature,staging,organization,reading-dedup,provenance,wechat,pdf-intake,reader}.js + shared.js + lib/entry-layout.js + src/literature/* + literature-browser.js + tasks-tool.js（对应工具子集）+ descriptors/remote 的切片。依赖面仅 ibmCore（reader/pdf-intake 另需 ibmRuntime）。
**第二批**：reading-reports.js + presentations.js + reviews.js（引 labGoals/labNoteTemplates/ibmDocuments）+ note/ppt 模板读取。
**最后做**：projects.js、lib/tasks/index.js 兼容壳、manual-capture/capture-phase/capture-handoff、literature-sources（webServer + 本机会话目录 + 浏览器模式探测）。

## 8. 风险与验收点

- 风险1：双 service 同时在线（labTasks 转发壳 + ibmLiteratureWorkflows），拆走一个会让旧工具/旧面板 100% 失效；验收：`ctx.get('labTasks')` 与 `ibmLiteratureWorkflows` 两条路径各自跑通一次检索→登记→精读→下载。
- 风险2：表作用域不一致（legacy-tasks 8 表 vs literature 5 表），拆分后越界读写会静默失败；验收：文献子插件只 touch 5 表，projects/记忆仍走母插件。
- 风险3：条目目录命名/迁移是数据安全点（同名冲突、旧 captured-literature）；验收：旧项目启动迁移 + 重命名后 PDF/SI/报告/PPT 均可下载且哈希不变。
- 风险4：捕获链路跨壳（Edge handoff + 扩展 + webServer），子插件化后端口/路由不可丢；验收：手动捕获→归档→条目出现。
- 风险5：客户端 tab 前缀 `dsh-resource://lab-reader/` 与 pdfjs vendor 资源绑定构建；验收刷新后阅读器与翻译双栏可用。
- 未核实：client/vendor/**、lib/rag/pdf.mjs 按约定未读；capture-handoff 与 literature-sources 的 HTTP 路由细节只看了服务注册行。
