# 文献阅读模块 · 当前架构与开发指南

更新：2026-11-04。基于当前仓库源码核对（分支 `codex/electron-next-migration`，HEAD `61bb351`）。
本文是**开发入口**：先读这里，再按 §8 的扩展点改代码。

## 1. 边界与装配

| 层 | 归属 | 位置 |
| --- | --- | --- |
| 业务服务 `labLiteratureTasks`（唯一实现） | 文献插件 | `plugins/literature/lib/workflows.js` |
| 兼容服务 `ibmLiteratureWorkflows` | 母插件（方法级委托到插件） | `lib/tasks/workflows.js` |
| 门面 `labTasks`（8 表全量转发） | 母插件 | `lib/tasks/index.js` |
| 远程 `lab.tasks_* / literature_* / manual_capture_*` | 母插件聚合 Remote | `lib/remote.js` |
| 模型工具 `lab_tasks_*` 等 | 文献插件工具行 | `plugins/literature/lib/tools.js` |
| 侧栏 PDF/Office 阅读器 | 文献插件（宿主只留桥） | `plugins/literature/client/src/reader/*`、`client/src/reader-host.js` |
| 课题页「文献资料」面板 | 文献插件 | `plugins/literature/client/src/lit-panel.js` |

装配行（`plugins/literature/cordis.patch.yml`）：

- `lab-literature`：`@ibm-lab/literature`，`inject: [ibmCore, ibmRuntime]`，config 指向 nature-skills 与 venv；
- `lab-literature-tools`：`@ibm-lab/literature/tools`，`inject: [tools, ibmCore, labTasks]`。

停用插件时：`ibmLiteratureWorkflows` 会退回母包内同名方法（`lib/tasks/workflows.js` 底部的方法委托）；远程接口与旧工具仍可用，但面板与阅读器消失（客户端注册项随插件卸载）。**两套实现不要同时初始化**：母服务 `Service.init` 检测到 `labLiteratureTasks` 时直接 return，避免重复建表/迁移。

## 2. 后端模块地图（`plugins/literature/lib/tasks/`）

| 模块 | 行数 | 职责 |
| --- | --- | --- |
| `literature.js` | 612 | 检索、检索记录/RIS、paper meta、preparePaper、暂存登记、引用导出 |
| `reading-reports.js` | 515 | 精读报告创建/写契约/DOCX/校验/人工复核/下载 |
| `presentations.js` | 431 | 文献汇报 PPT 创建/契约/模板构建/QA/复核 |
| `pdf-intake.js` | 350 | PDF/SI 上传→识别→匹配→重试队列 |
| `entry-admin.js` | 331 | 条目命名、产物重新提交、删除条目 |
| `reviews.js` | 249 | 综述：检索条目 → 综述文档 / 综述 PPT |
| `wechat.js` | 205 | 公众号文章抓取、DOI 校验、登记 |
| `reader.js` | 193 | 侧栏 PDF 租约/分块/字体资产 + 全文翻译流水线 |
| `staging.js` | 99 | bundle 条目布局与文件落位（含旧 `captured-literature` 迁移） |
| `organization.js` | 86 | 精读文件夹、分类、RIS 导入 |
| `reading-dedup.js` | 66 | 重复条目合并 `canonicalReadingRecord` |
| `shared.js` | 49 | 引用规范化/路径判定/原子写 |
| `office-pdf.js` | 40 | Office → PDF 小封装（LibreOffice） |
| `projects.js` | 34 | 课题 CRUD 转发 |
| `provenance.js` | 24 | 产物溯源 + `KIND_TO_SKILL` |
| `reader-tools.js` / `organization-tools.js` | 14/12 | 注册工具（**注意**：`lib/` 根下还有同名副本，当前 `tools.js` 引用根副本，`tasks/` 副本是迁移残留） |

服务初始化顺序（`plugins/literature/lib/workflows.js:69`）：建表 scope → executor
→ 会话绑定迁移 → 审阅门禁迁移 → 重复条目对账 → 条目对账 → 补跑机器评审
→ `readerResume()` → `pdfIntakeResume()`。

状态机走 `canTransit`；下载门禁 `assertApprovedArtifact` 要求人工审核绑定当前文件 SHA-256。

## 3. 数据与磁盘布局

- storage domain `lab_tasks` v0 的 8 张表（`lib/core/domain.js`）：
  `lab_projects / project_memory_versions / project_sessions / literature_search_runs /
  paper_source_bundles / reading_reports / presentation_runs / artifact_provenance`。
  文献服务只 `repositories.scope("literature")`（searches/bundles/reports/presentations/provenance 5 表）。
- 课题目录：`<workspace>/literature/<entryStem>/`（正文 pdf、SI、报告 md/docx、汇报 pptx、契约 json）。
- 综述：`<workspace>/literature/reviews/<stem>/`；译文：`<entryDir>/translations/<translationId>/{original.pdf,draft.json,reader.json,translated.pdf}`。
- `$DSH_HOME/lab-agent/`：projects、templates、literature-sessions、literature-downloads、vendor/nature-skills、.venv。

## 4. 远程接口（`lab` 命名空间）

聚合在 `lib/remote.js`，客户端描述符在 `client/src/descriptors.js`（**手工维护**，新增方法必须同步）。
文献相关分组（实测方法名）：

- `tasks_*`（检索/条目/报告/PPT/综述/阅读器/翻译，约 55 个）：`tasks_search_create`、`tasks_searches`、
  `tasks_bundle_create`、`tasks_report_complete/validate/review`、
  `tasks_reader_open/chunk/close/asset`、`tasks_translation_create/finish/bind/read/image/cancel` 等
  （`translationPrepare/translationWrite` 是服务方法，由 `lab_reader_translation_*` 工具直接调用，不走远程）；
- `literature_*`（数据源与下载，9 个）：`literature_sources/status/configure/connect/verify/download_*`；
- `manual_capture_*`（捕获，8 个）与 `browser_operation_*`（2 个）：Edge/浏览器抓取链路；
- `review_templates_list` 等模板读取。

## 5. 模型工具

- `plugins/literature/lib/tools.js`：29 个 `lab_*` 工具（检索登记、公众号、浏览器下载、综述、条目维护、`lab_review_templates_*`）；
- `plugins/literature/lib/reader-tools.js`：6 个 `lab_reader_translation_*`（start/prepare/read/write/finish/cancel）；
- `plugins/literature/lib/organization-tools.js`：2 个（列出/分类精读文件夹）；
- 跨模块只读工具 `lab_research_read` 仍属母插件（`lib/research-read.js`），由 `lib/tasks-tool.js` 注册。

工具统一通过 `resolveToolProjectId` 解析课题，再调 `ibmLiteratureWorkflows`（委托到插件服务）。

## 6. 前端架构

### 6.1 入口与注册

`plugins/literature/client/src/entry.js`：

```js
export const inject = ["remote", "sidebarRightTabs", "slots"]; // Cordis 服务注入，缺了会直接抛错
apply(ctx):
  registerProjectPanel({ id: "literature", label: "文献资料", render: LitPanel })
  registerReaderTab(ctx)   // 右侧栏 PDF/Office tab + pane
```

- 课题页「文献资料」由 `lit-panel.js`（约 890 行）渲染：检索记录 + 精读档案两栏、文件夹、拖拽、右键菜单、报告/PPT 预览与审核、翻译入口；
- 右侧栏阅读器由 `reader/reader-tab.js` 注册，`reader/reader-pdf-ui.js` 渲染 PDF 双栏/精读/PPT，`reader-material.js` 把 Office 材料交给宿主工厂槽 `ibm.office.preview`（内置 LibreOffice 转 PDF），`reader-scroll-sync.js` 管双栏滚动同步；
- PDF 引擎与 worker 随插件打包（`client-vendor/pdfjs`，插件 bundle 约 4.25 MB）。

### 6.2 宿主能力（`client-sdk`）

插件只能从 `dsh-lab-agent/client-sdk` 取能力（`client/src/sdk.js`）：
注册表、`h`、项目视图状态、通用组件、桌面/浏览器动作、文件下载，以及
`openReader / readerRuntime / readerPreferredMode / setReaderPreferredMode`。

**跨 bundle 状态必须放全局 Symbol**：`client/src/reader-host.js` 用
`Symbol.for("ibm.lab.reader-host")` 保存 runtime 与 mode；母包设置、插件读取。
（模块级变量会在两个 bundle 里各存一份，是白屏/“阅读器尚未就绪”的根因。）

### 6.3 远程调用

`lit-panel` / `reader` 通过 `call(method, {request})` 调 `lab.*`；新增远程方法需：
1）`lib/remote.js` 加方法并登记 `markRemote`；2）`client/src/descriptors.js` 加描述符；3）必要时 `domain-remotes.js` 补 helper。

## 7. 关键流程

1. **检索 → 登记**：`tasks_search_create` 建检索记录 → agent 调 `lab_tasks_register_search` 写 papers →
   `lab_tasks_register_bundle` 落条目（entry-layout 命名与 `literature/<stem>/` 布局）。
2. **PDF/SI 上传**：面板上传 → `tasks_reading_pdf_upload` → `pdf-intake` 识别/匹配/重试 → 更新 bundle。
3. **精读报告**：agent 生成 md → `lab_tasks_register_report` 写契约 + DOCX 暂存 →
   `tasks_report_validate` 机器审计 → 人工 `tasks_report_review`（哈希绑定）→ 下载开放。
4. **汇报 PPT**：报告就绪后 `lab_tasks_register_presentation` → 模板构建 → QA → 人工复核。
5. **全文翻译**：阅读器「翻译」→ `tasks_translation_create`（读 `reader_source.py` 提取）→ agent 用 6 个
   `lab_reader_translation_*` 工具分批 prepare/read/write/finish → 生成 `translated.pdf` 双栏对照。
6. **分类/文件夹**：`lab_tasks_list_reading_folders`、`lab_tasks_classify_reading_report`、`tasks_reading_move`。
7. **捕获**：公众号/出版社页面经 Edge handoff + 扩展 → `manual_capture_*` / `browser_operation_*` → bundle 落位。

## 8. 扩展点（按需求类型）

- **新增数据字段**：`src/contracts/*` schema → 迁移/兼容（`reading-reports` 等读旧行要容错）→
  `tasks/*` 读写 → `lit-panel` 展示 → 测试。
- **新增模型工具**：在 `plugins/literature/lib/tools.js`（或 reader/organization 工具文件）注册，
  用 `resolveToolProjectId` + 服务方法；同步补工具测试与 `verify-plugins` 的 schema 检查。
- **新增远程接口**：服务方法 → `lib/remote.js`（方法 + `markRemote`）→ `client/src/descriptors.js` → 面板调用。
- **新增面板区块**：`lit-panel.js` 内加组件；跨插件复用只走 `client-sdk`。
- **阅读器能力**（标注/目录/搜索等）：改 `reader/reader-pdf-ui.js` 与 `reader-tab.js`；
  涉及宿主槽（Office/PDF 工厂）时只消费 `renderFactorySlot`，不要改 DSH 内核。

## 9. 已知技术债 / 风险

1. `lib/tasks/reader-tools.js`、`organization-tools.js` 与 `lib/` 根同名文件重复，根副本在用，`tasks/` 副本是迁移残留——修改工具时别改错副本。
2. 母包 `lib/tasks/workflows.js` 仍保留一份完整实现作兜底；与插件实现需同步修 bug（目前靠委托保证运行时走插件，但源码双份）。
3. `descriptors.js` 手工维护，漏加会导致 `ctx.remote.lab[method] is not a function`。
4. 插件 bundle 含 pdf.js，约 4.25 MB；阅读器入口依赖 `inject` 服务声明，缺失会让插件激活失败（DSH 进恢复模式）。
5. 文献仍与课题共用 `lab_tasks` 8 表域（scope 隔离），拆表属于后续阶段。
6. 测试：文献/阅读器相关 41 条（36 pass、其余 skip/条件跳过），浏览器测试需 Electron/Chromium 环境。

## 10. 验证命令

```powershell
node --test tests/integration/literature-plugin.test.mjs tests/integration/literature-live.test.mjs `
  tests/integration/literature-naming.test.mjs tests/integration/literature-review.test.mjs `
  tests/integration/reading-dedup.test.mjs tests/integration/reading-interactions.test.mjs
node --test tests/unit/literature-search.test.mjs tests/unit/reader.test.mjs tests/unit/reader-materials.test.mjs
node scripts/verify-plugins.mjs
node scripts/build-plugin-client.mjs --plugin plugins/literature
node scripts/build-client.mjs --check
```

Dev 预览：`node scripts/dev-workbench.mjs`（或守护脚本 `scripts/preview-supervisor.mjs`）。
