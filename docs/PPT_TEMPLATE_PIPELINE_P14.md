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
