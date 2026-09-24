# PPT 模板管线 P1–P4 落地记录（pptx-cli 接入 + 槽位规范 + 体检 + 编译器）

> 版本：0.5.4。规范正文见 `docs/PPT_TEMPLATE_SPEC.md`；
> 静态层根因分析见 `docs/PPT_TEMPLATE_STATIC_LAYER_ANALYSIS.md`（本篇是它的下游落地）。

## 1. 为什么是「接入 pptx-cli」而不是「换掉构建器」

在真实发布版（PyPI `pptx-cli==1.3.5`，源码 4300 行）上核实过它的能力边界：

| 我们需要的能力 | pptx-cli 1.3.5 | 证据（源码/实测） |
|---|---|---|
| 读模板 → 机器可读契约 | **有**，而且很完整 | `python -m pptx_cli init` 在中文模板上 137 ms、0 warning，抽出 8 版式 21 占位符 + `guidance_text`（提示文字）+ 几何 + `estimated_text_capacity` + 静态元素指纹 |
| 验输出（成品 vs manifest） | **有** | `validate --strict`、`manifest diff`（破坏性/增量变更）、`doctor`、稳定 JSON envelope + 退出码 0/10/20/40/50/90 |
| 写字体（`a:latin`/`a:ea`/`a:cs`） | **没有** | 全包只有 bold/italic 与行内 code 的 `Courier New` |
| 字号下限 / 中文排版政策 | **没有** | manifest 里的 `allowed_formatting_overrides` 是死字段（全仓库无人读取） |
| 剥模板自带项目符号 | **没有** | 纯文本路径 `level=None` → `_apply_markdown_list_level` 直接 return，母版 `a:buChar` 原样继承 |
| 提示文字优先定位 | **没有** | 查找/校验全程 `placeholder_idx`（PowerPoint 会重排 idx） |

结论：**pptx-cli 当「读 + 验」，我们自己的构建器当「写 + 执行中文排版政策」**。
不 fork、不 vendor：它是 pin 的可选依赖，缺失时降级为 `parse.json` 旧路径。

## 2. 交付物

### P1 模板规范（manifest 作为唯一事实来源）

- **新增 `lib/pptx-manifest.js`**：`python -m pptx_cli` 的 Node 封装。
  - 命令：`initTemplateManifest` / `listLayouts` / `listPlaceholders` / `showTheme` /
    `validateDeck` / `diffManifests` / `doctorReport` / `probePptxCli`；
  - envelope 解析：从 stdout 里找**最后一个**可解析的 JSON 对象并校验它是 envelope
    （容忍前后日志污染），否则按「未输出 JSON」诊断；
  - 错误映射：退出码 → `ok/validation/permission/conflict/io/internal`，错误码前缀 →
    `kind` + 排查建议（`mapCliError`），未知码不猜语义；
  - 超时 / 非零退出 / 非 JSON / 缺模块 / 无解释器**全部返回诊断对象，永不抛**；
  - 解释器走仓库统一 resolver（bundled → 托管 venv → 系统），与 PPTX builder 同一套，
    避免两份探测逻辑漂移（Linux 线的 pptx-cli 在 `$DSH_HOME/lab-agent/.venv`，只靠
    PATH 上的 `python3` 找不到）。
- **导入流程改造**（`lib/ppt-templates.js`）：`<templates>/<id>/v<版本>/` 下新增
  `manifest/`（pptx-cli 产物）+ `slots.json` + `GUIDE.md` + `lint.json`；
  **`parse.json` 原样保留**。pptx-cli 不可用/失败 → 清理半成品目录、返回
  `manifestSource: "fallback"` + 原因，导入本身照常成功。
- **新增只读服务方法**：`manifestPackage` / `slotSpec` / `lintReport` / `guide` /
  `relint`（重新体检）；`validate()` 并入 lint 的「必须修」错误并带 `manifestSource`。
- **版本升级对比**：`compareManifestVersions`（`manifest diff`）+ lint 的
  `--baseline`，把破坏性变更落进 `lint.json.destructiveChanges`，并生成
  `template-breaking-change` error。

### P2 模板 lint / 体检

- **新增 `lib/ppt-template-lint.js`**（六类规则，见规范 §4）+ **新增
  `src/pptx-xml.js`**（只读扫描版式/母版 XML：`a:ea` 有无、`a:buNone`/`buChar` 证据）。
- **新增 CLI `scripts/lint-ppt-template.mjs`**：支持模板 id 或目录、`--baseline`、
  `--write-slots`、`--json`、`--fail-on error|none`；退出码 0/1/2。
- **新增 Agent 工具 `lab_ppt_template_lint`**（`lib/templates-tool.js`）：同一套判定，
  Agent 不必依赖 shell；`lab_ppt_templates_get` 增加 `manifestSource`/槽位清单/
  `guidePath`/`lintSummary`。
- **`compensated` 语义**：构建器能兜住的缺陷（字号下限、版式字体归一化、分点剥离）标
  `true` 且不阻断门控；静态层漂移与必填槽缺失**不可能**兜住，标 `false` 并阻断。
  门控看 `summary.blocking`。

### P3 编译器（plan → 槽位填充指令）

- **新增 `lib/pptx-plan.js`**：角色 → 版式（接受 slots.json 的 `roles`，也接受
  `plan.roles` 里的 layout id 或版式名）；槽位 → `texts[]`（**prompt 优先 + idx 兜底** +
  `mode`/`align`/`sizePt`）；图片路径解析成绝对路径；图注自动路由进图注槽。
- **新增 CLI `scripts/compile-ppt-plan.mjs`**，产出 `compiled.json`
  （`kind: "compiled-plan"`，兼容旧 plan 写法）。
- **构建器扩展**（`scripts/pptx/build_from_template.py`）：新增 `--compiled` 入口
  （与 `--plan` 互斥、校验 `kind`），编译期诊断并入符合性报告（前缀 `compiled_`），
  error 同样让退出码为 1；**新增「版式名唯一匹配」解析**——这是 manifest 的 slug id
  与 `parse.json` 的 `slideLayoutN` 两套 id 空间之间的桥（`role_layout_by_name` pass
  finding；同名多版式时明确报错，绝不猜）。
- **现有排版政策行为不变**：字体三槽、字号下限 20、按槽型开关分点、提示文字优先定位、
  静态层不动 —— 只扩展输入来源。
- **契约与任务链**（`lib/tasks/presentations.js`）：生成契约里带上 `slots.json` /
  `GUIDE.md` / `lint.json` 路径与两步构建命令；`buildPresentationFromTemplate`
  自动识别 `compiled-plan` 并走 `--compiled`。

### P4 指导与自举

- **新增 `docs/PPT_TEMPLATE_SPEC.md`**（面向用户与 Agent 的规范）。
- **新增 `src/ppt-template-guide.js`**：导入时自动生成 `GUIDE.md`（角色表 + 逐槽位
  「填什么」+ 排版政策 + lint 摘要 + 改模板步骤）。
- **preset 规则 16**（`presets/lab-research/preset.patch.yml`）：新增/修改模板必须走
  lint 门控、按 GUIDE 填充、提示文字是定位键、禁止为过门控改代码或删检查项。

## 3. 端到端验证（真实模板与真实 pptx-cli）

环境：`/tmp/pcvenv/bin/python`（Python 3.12.3 + pptx-cli 1.3.5）、模板
`/tmp/tpl-current.pptx`（sha256 `956b7abf…`，372,480 B，8 版式 21 占位符）。

```bash
# 1) init
python -m pptx_cli init /tmp/tpl-current.pptx --out <版本目录>/manifest --format json
#    137 ms，0 warning；8 版式（item/abs/fig1..fig4/end/ppt-end）、21 占位符

# 2) lint
node scripts/lint-ppt-template.mjs <版本目录> --python /tmp/pcvenv/bin/python --write-slots
#    error 6（必须修 0，构建器兜住 6）、warning 9、info 9 → ok: true
#    必须修 0 的来源：3 个图注槽 14pt（font-size-below-floor）+ 3 个图注槽继承项目符号
#    （template-bullet-leak），两类都由构建器在成品里兜住；warning 9 条是版式静态中文缺 a:ea

# 3) compile
node scripts/compile-ppt-plan.mjs --plan plan.json --template <版本目录> --out compiled.json
#    error 0、warning 0；5 页（cover/abstract/figure-1/figure-3/summary）
#    roles → 标题幻灯片/Abs/Fig1/Fig3/End；图片转绝对路径

# 4) build
python scripts/pptx/build_from_template.py --template <版本目录>/source.pptx \
  --parse <版本目录>/parse.json --compiled compiled.json --out deck.pptx --report conformance.json
#    ok=true, planKind=compiled, slideCount=5, errors=0, warnings=0
```

成品 `deck.pptx` 的复核结果（python-pptx + XML 双重检查，脚本见下）：

| 检查项 | 结果 |
|---|---|
| 页数 | 5（删掉了模板自带的 8 页） |
| 每页版式 | 标题幻灯片 / Abs / Fig1 / Fig3 / End（与角色一致） |
| 槽位填充 | 封面 4 槽、摘要 2 槽（图+中文摘要）、Fig1 3 槽（图+图注+解读）、Fig3 2 槽（图+解读，无图注）、总结 3 槽（创新点+两段），全部就位 |
| 字体三槽 | 每个写入 run 均 `latin=Arial` / `ea=微软雅黑` / `cs=Arial`；版式静态文字也已归一化 |
| 字号下限 | 全部 ≥ 20pt（模板里 14pt 的图注被抬到 20pt） |
| 分点 | 摘要/图注/图文解读/总结段落均有 `a:buNone`（不分点）；创新点保持多段分点 |
| 对齐 | 标题/图注居中、正文两端对齐、汇报人左对齐、日期右对齐 |
| 遗留提示文字 | 无（`【此处…】`/`论文中文标题`/`Fig.1图注` 等全部被内容替换） |
| 静态层 | 8 个版式的底图/上边线/logo/页标题完整（「摘要 Abstract」「方法 Methods」「总结 Conclusion」），无位置漂移 |
| 图片 | 3 页图片插入对应图片占位符，几何与 manifest 完全一致（如 Fig3 宽 11748706 EMU） |

## 4. 测试与门控

- 新增单测（全部用合成夹具 `tests/fixtures/ppt-manifest-fixture.mjs` + 伪 envelope，
  **不依赖 pptx-cli 真实安装**）：
  `tests/unit/pptx-manifest.test.mjs`（13）、`tests/unit/ppt-slot-spec.test.mjs`（9）、
  `tests/unit/ppt-template-lint.test.mjs`（13）、`tests/unit/pptx-plan.test.mjs`（9）、
  `tests/unit/pptx-build-compiled.test.mjs`（7）。
- 新增可跳过的集成测试 `tests/integration/pptx-cli-manifest.test.mjs`：本机没有
  pptx-cli 时 skip；有则真跑 `init → 槽位规范 → doctor → lint`（模板路径用
  `IBM_LAB_PPT_TEMPLATE`，仓库不提交含校徽/logo 的模板）。
- `npm test` 全绿；夹具模板不含任何校徽/课题组 logo 内容（合成 XML），可入库。

## 5. 已知限制与没做的事

1. **模板侧仍有 6 处待修**（3 个图注槽 14pt + 3 个图注槽缺「无项目符号」）：构建器在成品里
   兜住了，但模板本身没改。规范 §2 已写成对模板作者的要求。
2. **版式静态中文缺 `a:ea`（9 处）**：构建器归一化兜住；模板侧补 `a:ea` 才算真的修好。
3. **真实模板与 deck 不入库**（含校徽/logo，再分发未确认），所以端到端复核依赖
   开发机上的 `/tmp/tpl-current.pptx`；CI 只跑合成夹具。
4. **pptx-cli 的 `deck build` 没有被使用**：它默认会删掉未填充的非 title 占位符
   （`required = logical_name == "title"`），与本模板「留空但必须保留」的槽冲突；
   我们只借它的「读 + 验」。
5. **容量估算只是粗估**（CJK 1 字宽、西文 0.5 字宽，行容量 = 宽度pt/字号pt），
   只用于 warning 预警，不做重排。
6. **模板版本升级路径沿用现有规则**（同 id 不可重复导入）：跨版本对比通过
   `lint --baseline <id@v|目录>` 显式触发；导入时若磁盘上存在上一版 manifest 目录也会
   自动 diff。
7. **`slots.json` 的手工修改尚无 schema 校验**（lint 会读它做基线对比，但不会先校验
   结构）；规范 §3 给了字段说明，后续可按需加 zod schema。
8. **只支持单一模板族**（`literature-reading-v1`）的角色约定；换一种模板风格需要在
   `src/ppt-slot-spec.js` 的 `FAMILY_EXPECTATIONS` 里加一张表（数据，不是代码）。

---

## 6. 0.5.4 真实试用复盘后的四项修复

真实跑一遍「读论文 → 出 PPT」暴露了四个问题，本节四项已修并验证。

### 6.1 contain 图片几何：跨渲染器不一致 + 图片被静默裁掉

**根因（源码级）**：`Placeholder.insert_picture()` 只把图片塞进占位符 —— 它既不写
`a:xfrm`，还会用 `a:srcRect` 把图片**裁**成占位符比例。实测把 600x690 的竖长图放进 Fig3 的
12.85x4.78in 占位符：

| | XML 表现 | 有效几何 |
|---|---|---|
| 修前 | 无 `a:xfrm`（继承版式）+ `<a:srcRect t="33833" b="33833"/>` | 12.85x4.78in，**上下各裁掉 33.8%** |
| 修后 | `<a:xfrm>` off=(4122582,901700) ext=(3798818,4368641) + `<a:srcRect/>` | 4.15x4.78in @ (4.51,0.99)，比例 0.870 = 源图，完整居中 |

同一份 `srcRect` 在两个渲染器上表现不一致，正是试用里「竖长图被 LibreOffice 撑到 9.9in」
（幻灯片只有 7.5in）的来源。修法：新增纯函数 `fit_contain()` 算 contain 几何，
`apply_contain_fit()` 显式写 `left/top/width/height` 并**把 crop 清零**（不清的话图片仍被裁）。

**顺带查出的第二个缺陷**：几何必须在 `insert_picture` **之前**读。`insert_picture` 会把
占位符降级（清掉 `spPr/xfrm`），之后再读 `target.width / target.left` 会抛
`AttributeError: 'NoneType' object has no attribute 'cx'` —— 原来的 `cover` 分支正是因此
在真模板上静默退化成「不设几何」，只留下一条误报 `crop_* 不可用` 的 warning（实测三条全中）。

**`cover` 分支保持不动（有意）**：它的既有可观测行为就是 `insert_picture` 自带的填充裁切，
而那正是正确的 cover 语义；把几何来源换成提前读到的 box 去「复活」它，算出的 ext 会是
12.85x14.78in（比幻灯片还高，真会溢出）。因此 cover 只在本报告里如实记录，不改。

### 6.2 笔记/目标模板工具：Agent 被迫绕过工具手读存储

| 问题 | 根因 | 修法 |
|---|---|---|
| `lab_note_templates_list` 报 `templates[0].kind 未声明` | 该工具输出 schema 声明 `additionalProperties:false` 却漏了 `kind`，而 `list()` 每行都带 `kind` | 补声明；并逐个核对同文件其余工具（`lab_note_templates_get`、`lab_ppt_templates_list/get`、`lab_ppt_template_lint`）的 schema ⊇ 实际返回 |
| `note template 'note-default'@latest not found` | `resolve()` 只要 `version !== undefined` 就直接拼 key；Agent 传字面量 `"latest"`（错误文案本身也写成 `@latest`）→ 去找 `note-default@latest`，永远找不到 | `"latest"`/空串/纯空白一律当「未指定」（`normalizeTemplateVersion`；goal-profiles 同源实现 `normalizeGoalVersion`） |
| 报错没说下一步 | 旧文案只回一个 `@latest` | not-found 带上该 id 的实际版本列表与下一步（`noteTemplateMissMessage` / `goalMissMessage`） |

**一处刻意不改（有证据）**：试用复盘推测 `latestActive()` 应改成「从高版本往低找第一个
active」。**不能改**：`delete` 的语义就是「追加 archived 尾部版本」，最新版本行的状态即该 id
的当前状态；向下找 active 等于让已删除的模板复活，并直接打破
`tests/integration/notes.test.mjs` 的删除断言（`list()` 里「先 seen.add 再判 status」的顺序
同理，也是有意的）。修后语义：删除后 `resolve(id)` 返回 undefined，但 `resolve(id, "旧版本")`
仍可读（历史永远可读，见文件头契约）——报错文案会明确告诉调用方「该 id 没有 active 版本 +
已有版本列表」，这比让它悄悄拿到旧版本更安全。

### 6.3 登记 PPT 的前置条件不可见

真实试用里 Agent 被 `reading report '…' has no staged report artifact yet` 直接拒掉，
description 没写依赖链、报错也没说下一步。改为：description 写明
「登记原文 → 登记精读报告（`lab_tasks_register_report` 返回 reportId）→ 登记 PPT」，
并说明公众号/题录元数据登记**不会**自动生成精读报告；`withRegistrationNextStep()` 把该错误
翻译成可执行下一步（其余错误原样透传）。

### 6.4 测试与验证

- 新增 `tests/unit/pptx-contain-fit.test.mjs`（7 项）：`fit_contain` 在竖长图进宽幅槽/横图/
  超宽图/比例完全一致/极端竖长图/非法尺寸六种情形下的**落在盒内 + 比例不变 + 居中**断言，
  以及「`contain` 必须清 crop」「几何必须在 `insert_picture` 之前读」「cover 与 contain 互斥」
  三条源码级断言。纯函数用 `python3` 标准库加载模块，CI 不需要 python-pptx。
- 新增 `tests/unit/tool-output-schema.test.mjs`（6 项）：用真实服务原型方法 + storage 表替身
  跑 `list()`/`resolve()`/`snapshotForTask()`，断言输出 schema 覆盖实际返回的**每一个**键
  （能真正复现 `kind` 这类漏声明）、`latest`/空串/显式版本三种解析、删除语义、报错文案与
  前置条件翻译。
- 真实模板端到端（`/tmp/tpl-current.pptx` sha256 `956b7abf…`，`/tmp/pcvenv/bin/python`）：
  contain 修前 12.85x4.78in（aspect 2.689，图片被裁）/ 修后 4.15x4.78in（aspect 0.870，居中）；
  cover 修前修后 findings 与 XML 完全一致。两版 deck 与报告留在 `/tmp/containfit/`。
