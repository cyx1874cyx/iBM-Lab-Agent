# 文献工作流扩展：命名规范、条目工具、综述写作（实施计划）

> 需求来源：用户 2026-09-24 的幻灯片《2. 文献命名及分类保存建议》＋文字要求。
> 本文件先钉住**决策**，再按阶段实施；每阶段都要有测试，最后出两份评估。

## 1. 需求拆解

| # | 需求 | 交付物 |
|---|---|---|
| R1 | 正文/SI/精读报告/PPT 按幻灯片规范命名，且四类产物存在「对应命名目录」下 | `lib/entry-layout.js` 规范化 + 归档路径统一 |
| R2 | 精读条目新增工具：Agent 可修改/重新提交正文、SI、精读报告、PPT；可删除 | 新增 4~5 个 `lab_tasks_*` 工具 + 远程方法 + 面板操作 |
| R3 | 文献检索条目新增工具与界面按钮：对检索结果写综述文档；支持综述模板管理与 Agent 重新提交；支持综述 PPT | 综述模板域 + 4 个工具 + 远程方法 + 面板按钮 + 模板管理 UI |
| R4 | 评估现有文献检索方法 | `docs/LITERATURE_SEARCH_METHODS_EVALUATION.md` |
| R5 | 评估「利用课题内论文做 RAG 数据库」的工作量 | `docs/PROJECT_RAG_DATABASE_ASSESSMENT.md` |

## 2. R1 命名规范（从幻灯片提取）

### 2.1 规范

```
<期刊缩写> <年份> <通讯作者> <中文内容概括> <英文题目前段>
```

幻灯片实例（逐字）：

```
JACS 2012 DeSimone PRINT纳米粒子表面硅基改性CPT 酸敏感释放 Incorporation and Controlled Release of Silyl
JACS 2012 DeSimone PRINT纳米粒子表面硅基改性CPT 酸敏感释放 Incorporation--SI
ACS NANO 2021 张志平 仿生纳米囊泡 化疗免疫 Immunogenic Hybrid Nanovesicles
ACS NANO 2021 张志平 仿生纳米囊泡 化疗免疫 SI
AFM 2020 刘广文 乳腺癌术后 An Injectable Supramolecular Polymer Nanocomposite
AM 2020 王蕾 可植入 术后免疫 细胞焦亡 Implantable Bioresponsive Nanoarray
AM 2017 Yong Taik Lim 术后免疫治疗 Implantable Synthetic Immune Niche for Spatiotemporal
```

幻灯片明确的约束：
- **命名中不要出现标点符号**（否则复制/转移困难）；
- 英文题目**只取前面部分**；
- SI「采用类似方法，可以适当**缩短后面部分**」。

### 2.2 落地决策

| 决策 | 取值 | 理由 |
|---|---|---|
| D1 五段拼接 | `<journalAbbrev> <year> <correspondingAuthor> <summaryZh> <titleLead>`，段间单空格 | 逐字对齐幻灯片 |
| D2 `titleLead` | 英文题目前 `TITLE_LEAD_WORDS = 8` 个词（按空白切分后重连） | 「只取前面部分」 |
| D3 标点 | 全段删除标点（中英文），连字符换成空格后压缩空白；保留字母/数字/CJK | 「不要出现标点符号」 |
| D4 年份缺失 | 用元数据 `year`；占位阶段缺失则留空并从 stem 里去掉该段（不写 `unknown`） | 占位先建目录、后补元数据 |
| D5 通讯作者来源 | 优先 Agent 显式给 `correspondingAuthor`；否则 Crossref 语义的**末位作者**；再否则第一作者 | 通讯作者常为末位，但必须允许 Agent 用 PDF 纠正 |
| D6 中文概括 | Agent 给 `summaryZh`（2–3 个中文词，可含空格）；缺失时回退 `report.titleZh` 前 10 字；**不回退英文标题** | 幻灯片要求「两三中文词语」；把英文题目前 10 字符当日语概括会与题目前段重复（实测 `A prodrug A prodrug polymer …`） |
| D7 期刊缩写 | Agent 给 `journalAbbrev`；否则内置缩写表查 `journal`；再否则清洗后的期刊名 | 缩写表只覆盖常见刊，Agent 可补 |
| D8 正文文件名 | `<stem>.<ext>`（**不再**带「正文」后缀） | 幻灯片里正文文件名就是 stem |
| D9 SI 文件名 | `<stem> SI.<ext>`；仅当 stem 超过 `SI_STEM_MAX = 90` 时从尾部逐词缩短 | 「可以适当缩短」是许可不是强制；按长度触发既满足要求，又不必再固化一个 `siStem` 字段（避免与元数据漂移） |
| D10 精读报告/PPT 文件名 | `<stem> 精读报告.<md/docx>`、`<stem> 文献汇报.pptx`（保持类型后缀） | 幻灯片未覆盖，保留可区分性 |
| D11 目录 | `<课题工作区>/literature/<stem>/`，四类产物同目录 | 「均保存在对应命名目录下」 |
| D12 stem 上限 | `ENTRY_STEM_MAX = 120` 个 Unicode 字符；超长时从 `titleLead` 尾部截断 | Windows 路径长度；旧值 80 装不下五段 |
| D13 旧数据 | 已固化 `entryStem/entryDir` 的 bundle **不自动改名**；由 R2 的改名工具显式触发 | 用户工作区里的既有目录不能凭空移动 |
| D14 段序回退 | 任一段缺失只影响该段；不因缺字段退回旧命名 | 命名可预测比字段齐全更重要 |
| D15 下载/另存名 | 出流文件名（HTTP `x-file-name`、桌面端另存对话框预填名）必须等于条目命名：PPT `<stem> 文献汇报.pptx`、符合性报告 `<stem> PPT符合性.json`；**不得**用 runId（旧实现给 `pres-xxxx.pptx`）或构建期临时名 | 用户下载到本机、转发组内的文件名就是规范名；服务端是文件名的唯一决定者（与 `stageFileIntoEntry`「不接受外部文件名」同一原则） |

### 2.3 需要 Agent 提供的字段

新增 `naming` 子对象（挂在 bundle 上，`paperSourceBundleSchema.naming`，全部可选）：

```js
{ journalAbbrev, correspondingAuthor, summaryZh, titleLead }
```

- 占位阶段（微信/元数据/DOI）可只给 `summaryZh`；
- `lab_tasks_register_bundle` / `lab_tasks_register_paper_meta` / `lab_tasks_register_wechat_paper`
  增加同名可选参数；
- `lab_tasks_get_reading_inputs` 回显**当前 stem**与**缺失字段**，Agent 据此补全；
- 新增 `lab_tasks_set_entry_naming`：补/改命名字段；`mode: "freeze" | "apply"`，
  `apply` 时移动条目目录（含内部文件）并更新 DB 路径。

## 3. R2 精读条目工具

| 工具 | 语义 | 幂等点 |
|---|---|---|
| `lab_tasks_update_bundle_file` | 重新提交正文或 SI（`kind: pdf\|si`）：校验、写入**同一**条目目录、更新 sha256/路径 | 同 bundle 覆盖，不新建条目 |
| `lab_tasks_update_report` | 重新提交精读报告（md/docx） | 覆盖当前版本，保留历史审计行 |
| `lab_tasks_update_presentation` | 重新提交文献汇报 PPTX | 同上 |
| `lab_tasks_delete_bundle` | 删除精读条目：删 DB 行 + 条目目录（含正文/SI/报告/PPT/契约） | 需 `confirm: true`；返回删除清单 |

配套：
- 远程方法 `tasks_bundle_update_file` / `tasks_report_update` / `tasks_presentation_update` /
  `tasks_bundle_delete`，并登记进 `markRemote` 列表；
- client 描述符 `client/src/descriptors.js` 同步（`create: () => pass` 形态）；
- 面板：精读条目行加「删除」，产物行加「重新提交」。

## 4. R3 综述写作

### 4.1 模板
复用阅读笔记模板的**域机制**，新增 `kind: "review"`：
- `labNoteTemplatesDomainSpec` 增加 `kind` 字段（默认 `note`），模板列表按 `kind` 过滤；
- 面板「模板管理」新增「综述模板」分区，导入 Markdown / 从导入的 docx 解析章节骨架，
  与阅读笔记模板同一套解析器（`src/note-template.js`）。

### 4.2 工具

| 工具 | 语义 |
|---|---|
| `lab_review_templates_list` / `lab_review_templates_get` | 列出/取综述模板（章节骨架、风格、证据要求） |
| `lab_tasks_get_review_inputs` | 盘点**某个检索条目**可用于综述的输入：标题、摘要、核心概括（`shortDescriptionZh`）、DOI、RIS 路径、模板契约路径 |
| `lab_tasks_register_review` | 把综述 Markdown/DOCX 登记到检索条目（`runId`），支持 `noteTemplateId/version` |
| `lab_tasks_register_review_presentation` | 登记综述 PPT（`pptxPath`），复用 `lab_ppt_build_from_template` |

### 4.3 归档
`<课题工作区>/literature/reviews/<runStem>/`：
- `<runStem> 综述报告.md` / `.docx`
- `<runStem> 综述PPT.pptx`
- `<runStem> 综述生成契约.md`

`runStem` = `sanitizeEntryStem(<entryTitle>)`（检索条目自带一句中文主题，天然可读）。

### 4.4 界面
- 检索条目行新增按钮「写综述」：若已有综述 → 「查看综述」；
- 综述产物行提供下载与「重新提交」；
- 模板管理新增综述模板分区。

## 5. 实施阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | `lib/entry-layout.js` 新命名 + 单测 | 幻灯片 7 个实例逐字复现；标点/超长/缺字段用例 |
| P2 | 元数据字段 + 3 个登记工具加参 + `get_reading_inputs` 回显 | 集成：登记后目录名与文件名符合 P1 |
| P3 | `set_entry_naming`（含目录移动） | 集成：改名后四类产物在新目录下且可下载 |
| P4 | R2 四个工具 + 远程 + 描述符 + 面板 | 集成：重新提交/删除后 DB 与磁盘一致 |
| P5 | 综述模板 kind + 4 个工具 + 归档 | 集成：综述报告/PPT 落到 `reviews/<runStem>/` |
| P6 | 面板按钮与模板管理分区 | client 一致性 + harness-surface 断言 |
| P7 | R4/R5 两份评估 | 文档 |

## 6. 风险与取舍

- **路径长度**：五段命名比旧的两段长得多。`ENTRY_STEM_MAX=120` + SI 额外截断是必要约束；
  集成测试要断言 `entryDir` 总长 < 200 字符（Windows `MAX_PATH` 余量）。
- **改名是破坏性操作**：`set_entry_naming(mode:"apply")` 会移动目录并改写 DB 路径。
  必须先复制后删源（失败保留原目录），并在返回里给出 `moved[]`。
- **通讯作者判定**：Crossref/OpenAlex 都不直接给「通讯作者」。默认末位作者是启发式，
  Agent 应优先从 PDF 首页脚注确认；工具描述里必须写清这条，避免把它当权威。
- **综述模板与阅读笔记模板同表**：用 `kind` 区分；旧数据无 `kind` → 视为 `note`
  （schema 默认值），不需要迁移。


---

## 7. 执行记录（2026-09-24）

| 阶段 | 状态 | 说明 |
|---|---|---|
| P1 命名规范 | ✅ | `lib/entry-layout.js` 重写；幻灯片 7 个实例逐字进单测 |
| P2 元数据与工具 | ✅ | bundle.naming + 三个登记工具 + `get_reading_inputs` 回显缺口 |
| P3 改名/搬家 | ✅ | `setEntryNaming(mode=freeze\|apply)`，先复制后删源、DB 同步改写 |
| P4 重提与删除 | ✅ | `resubmitBundleFile` / `resubmitReport` / `resubmitPresentation` / `deleteBundle` |
| P5 综述 | ✅ | 模板 kind=review + 综述归档目录 + 5 个工具 + 远程与出流 |
| P6 界面 | ✅ | 检索条目「写综述/综述/综述PPT」；模板管理「综述模板」标签页 |
| P7 评估 | ✅ | `LITERATURE_SEARCH_METHODS_EVALUATION.md`、`PROJECT_RAG_DATABASE_ASSESSMENT.md` |

### 实施中与原计划的偏差

1. **D9（SI 缩短）** 改为「仅当 stem 超过 90 字才从尾部逐词缩短」：幻灯片说
   「可以适当缩短」是许可而非强制，按长度触发就不必再固化一个 `siStem` 字段。
2. **D6（中文概括）** 去掉了英文标题回退：实测会得到
   `A prodrug A prodrug polymer …` 这种自重复段。
3. **综述模板没有新建独立域**，而是在阅读笔记模板域上加 `kind`（缺省 `note`
   兼容旧数据）；「模板管理」里两类模板共用同一套版本/快照/导入解析。
4. **精读条目的面板删除沿用既有 `tasks_report_delete`**（它在该条目最后一份报告时
   会连带删除条目目录），Agent 侧则新增更明确的 `lab_tasks_delete_bundle`。
5. **预设 persona 增加第 13–15 条**：命名强制、综述顺序、条目维护与删除确认——
   否则工具存在但 Agent 不会用。

### 未做（明确留在计划外）

- 综述报告的人工审核门禁：精读报告有 `under-review → approved` 状态机，综述目前
  只有 `pending/ready`，没有审核流。若需要与精读同等门禁，应作为下一阶段。
- 综述 PPT 的模板符合性校验：已支持传入 `conformancePath` 并由
  `lab_ppt_build_from_template` 产出，但没有在登记时强制校验。
