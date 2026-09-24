# PPT 模板规范（面向使用者与 Agent）

> 版本：0.5.4 起生效。实现见 `lib/pptx-manifest.js`、`lib/ppt-template-lint.js`、
> `lib/pptx-plan.js`、`scripts/pptx/build_from_template.py`；落地记录见
> `docs/PPT_TEMPLATE_PIPELINE_P14.md`。

## 0. 一句话

**加一个模板 = 丢一份 `.pptx` → 系统自动生成 `manifest` + `slots.json` + `GUIDE.md` +
`lint.json` → 按 lint 报告改模板，直到 `ok: true`。不需要写代码。**

分工必须记住（这是整套设计的地基）：

| 谁 | 负责什么 | 为什么 |
|---|---|---|
| **pptx-cli**（可选依赖，pin 1.3.5） | **读模板**（manifest：版式/占位符提示文字/几何/有效字号/静态层指纹）与**验输出**（`validate`、`manifest diff`、`doctor`） | 这些是通用能力，重写没有意义 |
| **我们自己的构建器** `scripts/pptx/build_from_template.py` | **写内容 + 执行中文排版政策**（字体三槽、字号下限、按槽型开关分点、提示文字优先定位、静态层不动） | pptx-cli 1.3.5 全包不写字体/字号/对齐，纯文本路径不剥模板项目符号，且只按 `placeholder_idx` 定位 |

## 1. 目录结构（模板导入后）

```
$DSH_HOME/lab-agent/templates/<模板id>/v<版本>/
├── source.pptx            # 模板源文件（唯一真本）
├── parse.json             # 我们的轻量解析（向后兼容，旧链路仍用）
├── mapping-suggestions.json
├── slots.json             # 槽位规范（由 manifest 派生，Agent 可读；见 §3）
├── GUIDE.md               # 填充指南（逐槽位「填什么」，Agent 必须先读它）
├── lint.json              # 体检报告（见 §4）
└── manifest/              # pptx-cli init 产物
    ├── manifest.yaml      # 唯一事实来源：版式、占位符、提示文字、几何、有效字号、静态元素指纹
    ├── manifest.schema.json
    ├── annotations.yaml
    ├── fingerprints/parts.json
    ├── reports/init-report.json
    └── assets/source-template.pptx
```

`manifestSource`：manifest 生成成功 = `manifest`；pptx-cli 缺失/失败 = `fallback`
（退回 `parse.json` 旧路径，行为与 0.5.4 之前一致，并在导入结果里给出原因）。

## 2. 模板作者要遵守的约定

1. **所有可变内容都放占位符**，静态装饰（底图、上边线、logo、页标题）放在**版式层**，
   不要画在页上、也不要指望 Agent 去画。
2. **给每个占位符写提示文字**（PowerPoint 的「单击此处…」提示）。提示文字是**定位键**：
   - 「论文中文标题」「English Paper Title」「摘要截图」「Fig.1图注」
     「【此处概括论文 Fig.1 对应的内容…】」等等；
   - 改提示文字 = 改槽位身份，必须同步告知 Agent（lint 会报 `slot-prompt-renamed`）。
3. **字号 ≥ 20pt**（构建器有下限兜底，但模板侧改好才算真的修好）。
4. **不要分点的槽位要给「无项目符号」**：母版 `bodyStyle` 九级默认带 `a:buChar`，
   占位符不写 `a:buNone` 就会继承（lint 报 `template-bullet-leak`）。
5. **中文字体槽要给全**：run 上有 `a:latin` 但缺 `a:ea` 时，中文只能靠系统回退
   （lint 报 `cjk-typeface-missing`）。
6. **静态层逐版式保持一致**：同一套页眉/底图在所有版式里必须同几何同内容
   （lint 报 `static-layer-inconsistent` / 跨版本 `static-layer-drift`）。

### 角色约定（literature-reading-v1）

版式角色靠**提示文字**识别（不是版式名，也不是 idx）：

| 角色（plan 里的 `slides[].role`） | 识别依据（提示文字） | 必填槽 |
|---|---|---|
| `cover` | 论文中文标题 / English Paper Title | titleZh、titleEn、date（speaker 可选） |
| `abstract` | 摘要截图 / 摘要的中文翻译 | abstractShot、abstractZh |
| `figure-<n>` | `Fig<n>图占位` / `Fig.<n>图注` | figure、analysis；**图注**：图 1/2/4 需要，图 3 不需要（整页宽图） |
| `summary` | 创新方法有 / 第一段：概括文章主要工作 | innovation（分点）、paragraph1（可选 paragraph2） |
| `thanks` | 批评指正 | thanks（可选） |

新增图号默认「要有图注」。要改这些约定就改 `src/ppt-slot-spec.js` 的
`FAMILY_EXPECTATIONS`（数据表），或改生成出来的 `slots.json`。

## 3. `slots.json`（槽位规范）

由 manifest 派生，是**声明式数据**而不是代码：Agent 可以读它决定填什么，也可以改它
（例如把某个槽标为可选），改动由 schema + lint 门控。字段：

```jsonc
{
  "schemaVersion": 1,
  "family": "literature-reading-v1",
  "template": { "name": "…", "sha256": "sha256:…" },   // 来源可追溯
  "policy": { "minFontPt": 20, "fonts": { "latin": "Arial", "ea": "微软雅黑", "cs": "Arial" }, "bodyMode": "paragraph" },
  "roles": { "cover": "item", "figure-1": "fig1", … },  // 角色 → pptx-cli 版式 id
  "layouts": [{
    "layoutId": "fig1", "layoutName": "Fig1", "role": "figure-1",
    "slots": [{
      "key": "caption", "label": "图注", "kind": "text",
      "prompt": "Fig.1图注", "idx": 12, "logicalName": "body_12",
      "required": true, "mode": "paragraph", "align": "center",
      "capacityLines": 1, "fontPt": 14, "fontFamily": "微软雅黑",
      "belowFontFloor": true, "widthEmu": 8356600, "heightEmu": 366903,
      "usage": "图注原文，形如「Fig.1 xxx」；与论文里的编号、文字保持一致。"
    }]
  }],
  "missingSlots": [], "promptMismatches": [], "unassignedPlaceholders": [], "warnings": []
}
```

槽位 → 占位符的绑定分三轮（`bindLayoutSlots`）：

1. **提示文字命中**（`boundBy: "prompt"`）——最稳；
2. **结构兜底**（`boundBy: "structure"` / `"shape"`）：只在「剩余期望槽数 == 剩余同类型
   占位符数」时按阅读顺序配对，并记 `promptMismatches`（lint 报改名）；
3. 仍无匹配 → `missingSlots`（必填即 error）。

这样「改名」不会被误报成「删一个又多一个」，也不会静默错配到别的槽上。

## 4. `lint.json`（体检报告）

六类规则（`lib/ppt-template-lint.js`）：

| # | 规则码 | 级别 | 构建器能否兜住 |
|---|---|---|---|
| ① | `static-layer-inconsistent`、`static-layer-drift`、`static-layer-removed` | error | **不能** → 必须修 |
| ② | `layout-role-unknown`（error）、`slot-prompt-renamed`、`slot-prompt-duplicate`、`slot-prompt-empty`、`slot-key-removed` | error / warning | 不能（改名后定位退化到 idx） |
| ③ | `font-size-below-floor`、`font-size-unresolved`、`font-size-below-floor-unfilled` | error / warning | 能（写入的 run 抬到下限） |
| ④ | `cjk-typeface-missing`（静态文字缺 `a:ea`）、`cjk-typeface-unchecked` | warning / info | 能（版式静态字体归一化） |
| ⑤ | `template-bullet-leak`（`mode=paragraph` 的槽继承项目符号） | error | 能（剥 `buChar` 补 `buNone`） |
| ⑥ | `required-slot-missing` | error | **不能** → 必须修 |

外加：`template-breaking-change`（与上一版 `manifest diff` 的破坏性变更）、
`cli-finding`（pptx-cli `doctor` 的发现）、`cjk-typeface-unchecked` /
`template-bullet-unchecked`（源模板 XML 不可用时**显式声明检查没做**，绝不静默算通过）。

**门控语义**：`ok = 没有 `compensated=false` 的 error`。即
`summary.blocking` 才是「必须修的条数」；`summary.compensatedErrors` 是构建器会兜住的，
只需登记、不阻断出稿。`findings[].compensated` 就是这条判定的机器可读形式。

### 怎么跑

```bash
node scripts/lint-ppt-template.mjs <templateId|模板目录> [--baseline <id@v|目录>] [--write-slots] [--json]
```

退出码：0 通过 / 1 有必须修的 error / 2 用法或读取失败。
Agent 侧用 `lab_ppt_template_lint`（同一套判定逻辑，不需要 shell）。

## 5. plan.json 与编译（Agent 的写法）

Agent 只写语义；编译器把它翻成填充指令：

```jsonc
{
  "requiredPages": ["cover", "abstract", "summary"],
  "notesRequired": true,
  "slides": [
    { "role": "cover",
      "slots": { "titleZh": "…", "titleEn": "…", "date": "日期：2026/09/24" },
      "notes": "开场讲稿" },
    { "role": "figure-1",
      "slots": { "figure": "fig1.png",
                 "caption": "Fig.1 …",
                 "analysis": ["第一段。", "第二段。"] },
      "notes": "讲图 1" },
    { "role": "summary",
      "slots": { "innovation": ["（1）…", "（2）…"], "paragraph1": "…" },
      "notes": "总结" }
  ]
}
```

```bash
node scripts/compile-ppt-plan.mjs --plan plan.json --template <模板目录> --out compiled.json
python scripts/pptx/build_from_template.py \
  --template <模板目录>/source.pptx --parse <模板目录>/parse.json \
  --compiled compiled.json --out deck.pptx --report conformance.json
```

兼容写法（旧 plan 不必改）：`slides[].texts = [{ prompt | idx, paragraphs, mode, align, sizePt }]`、
`title/subtitle/bullets/image/imageCaption`。`compiled.json` 的
`kind=compiled-plan`，`roles` 用**版式名**（构建器侧认 `slideLayoutN`/版式名，与 manifest
的 slug id 不是同一套 id 空间）。

编译期就报：槽位名写错、必填槽缺失、图片不存在、容量超限预警、角色未知、缺讲稿。

## 6. 排版政策（构建器强制执行，勿绕过）

- 字体三槽：`a:latin=Arial` / `a:ea=微软雅黑` / `a:cs=Arial`，**每一个写入的 run** 都设；
  版式上的静态文字也会被归一化（`placeholderRules.normalizeLayoutFonts`，默认开）。
- 字号下限 `placeholderRules.minFontPt`（默认 20pt）：只升不降。
- 分点：`mode=paragraph` 的槽位剥掉 `a:buChar/a:buAutoNum/a:buFont` 并补 `a:buNone`；
  `mode=bullets`（创新点）保持分点。
- 静态层：构建器只读不改；模板自带页会被丢弃（`keepTemplateSlides` 可关）。
- 图片：写进图片占位符；容量/裁剪按占位符几何。

## 7. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 导入后 `manifestSource=fallback` | 该环境没装 pptx-cli（或解释器不可用） | `pip install pptx-cli==1.3.5`；桌面版随包自带，Linux 在 `$DSH_HOME/lab-agent/.venv` |
| lint 报 `layout-role-unknown` | 版式占位符没写约定提示文字 | 按 §2 补提示文字；或把该版式纳入 `FAMILY_EXPECTATIONS` |
| lint 报 `required-slot-missing` | 角色要求的槽位在这个版式里不存在 | 补占位符；或把该槽标为可选（改 `slots.json`） |
| 明明改了模板却没生效 | 改的是**页**而不是**版式层** | 改版式；改完重新导入 |
| 生成出来正文变成分点 | 模板里该占位符继承了母版项目符号 | 模板侧加「无项目符号」；构建器也会兜住 |
| 中文变成宋体/回退字体 | run 缺 `a:ea` | 模板侧补 `a:ea`；构建器会对写入 run 与版式静态文字统一设置 |
