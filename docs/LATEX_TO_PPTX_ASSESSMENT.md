# 用 LaTeX 模板做 PPT：可行性与「能否在 PowerPoint 里逐元素修改」评估

> 问题：能不能用 LaTeX 模板生成 PPT，并且生成物在正常 PPT 软件（PowerPoint/WPS）里
> 逐元素修改？
> 结论基于格式原理与实测过的公开工具；带「未实测」标注的是静态判断。

## 1. 直接回答

**能做到「LaTeX 参与」，做不到「LaTeX 排版 + 逐元素可编辑」两者兼得。**

原因是文件格式层面的，不是工具不够好：

- LaTeX / Beamer 的产物是 **PDF**——一组已经排版好的绘制指令（定位好的字形、
  矢量路径），它没有「这是标题、这是项目符号、这是公式对象」的结构；
- PowerPoint 要能逐元素改，文件里必须是 **DrawingML 原生对象**：文本框、形状、
  公式（OMML）、表格、图片。

所以任何「Beamer → PPTX」的转换都只有三条出路：

| 出路 | 做法 | 在 PowerPoint 里的可编辑性 |
|---|---|---|
| ① 整页图片 | 每页 PDF 渲成 PNG 贴满整页 | ❌ 完全不可改 |
| ② 整页矢量 | 每页 PDF 转 SVG，作为整页图形插入 | ⚠️ 可「转换为形状」后编辑，但文字/公式变成矢量路径，**不是结构化文本**，改一处版式就散 |
| ③ 版面反解 | 解析 PDF 的元素与坐标，重建为文本框/图片/表格/公式 | ⚠️ 文字与表格能变成原生对象，但**版面会漂移**、公式默认变图片；质量取决于解析器 |

**唯一「两边都满足」的元素是公式和图形**，见 §3。

## 2. 六条路线的对照

| 路线 | 代表工具 | 产物 | 元素可编辑性 | LaTeX 排版保真 |
|---|---|---|---|---|
| A. Beamer → PDF | `pdflatex` | PDF | ❌（PDF 不可当 PPT 编辑） | ✅ 100% |
| B. PDF → 反解 PPTX | [pdf2ppt](https://github.com/jieqiuming/pdf2ppt)（MinerU 版面解析） | PPTX | ⚠️ 文字/表格原生，**公式多为图片**，版面漂移 | ⚠️ 中 |
| B′. PDF → 「可编辑 + 原生公式」 | [beamer2pptx](https://github.com/xdmlxdml/beamer2pptx) | PPTX | ⚠️ 同上，但公式重建为 OMML | ⚠️ 中（未实测） |
| C. Beamer → 整页 SVG | [beampptx](https://github.com/kocurvik/beampptx)（PyPI，MIT） | PPTX（每页一张满幅 SVG） | ⚠️ 转形状后可改，但全是矢量路径；题注/正文不再是文本 | ✅ 视觉 100% |
| D. TikZ/示意图 → SVG/EMF → 插入原生 PPTX | `dvisvgm` / Inkscape | 图 | ✅ SVG「转换为形状」后**形状与文本可编辑** | ✅ 图内 100% |
| E. LaTeX 公式 → OMML → 写进原生文本框 | [pandoc](https://www.mankier.com/1/pandoc) / [inject_omml.py](https://github.com/Noi1r/powerpoint-skill/blob/main/powerpoint-slides/scripts/inject_omml.py) | 公式对象 | ✅ **原生 Office Math，可点开改** | ✅ 公式 100% |
| F. Markdown/LaTeX 片段 → PPTX（reference-doc） | `pandoc -o out.pptx --reference-doc=tpl.pptx` | PPTX | ✅ 文本/公式全原生 | ❌ 版式是 PowerPoint 模板的，不是 Beamer 的 |

（C 的工具明确写着 "Every slide is embedded as a full-bleed SVG vector graphic"；
[Noi1r/powerpoint-skill](https://github.com/Noi1r/powerpoint-skill) 的公式管线也明确
写 "OMML math (native) … editable after generation"。）

## 3. 关键发现：公式与图形可以「两边都要」

### 3.1 公式：LaTeX ⇄ OMML

Microsoft 官方文档《LaTeX Support in Microsoft 365》写明 **Word / Excel / PowerPoint
可以在 LaTeX 与 Office Math（OMML）之间转换**，并给出了完整的命令支持表
（`\frac`、`\sum`、矩阵、`cases`、`mhchem` 的 `\ce{}` 等；亦列出 12 条限制，例如
`\displaystyle`、字号命令会被忽略，OMML 无负间距）。

也就是说：

- **不需要 LaTeX 发行版**也能让用户享受 LaTeX 语法：Word/PowerPoint 的公式框里
  可以直接粘 `$...$`/`\[...\]` 并转成 Office Math（M365 Version 2606+ 完整支持）；
- 反过来 OMML 也能导出成 LaTeX（round-trip 基本保真），所以「模型生成 LaTeX →
  注入 OMML → 用户点开就是可编辑公式」这条路是成立的。

### 3.2 ⚠️ 与本项目冲突的一点：LibreOffice 渲染 OMML 有缺陷

`powerpoint-skill` 的 README 明确警告：**LibreOffice 不能完整渲染 OMML**，
`soffice` 把 pptx 转 PDF 时公式可能空白或错位，而 PowerPoint/WPS 显示正常。

本项目**恰好用 LibreOffice 做分页预览**（`lib/office-preview.js` 调 `soffice`），
所以引入原生 OMML 公式会立刻带来一个产品级问题：**面板预览里公式是空的，
用户以为文件坏了**。可选应对：

1. **双轨**：同一个公式同时写 OMML（供编辑）与 600 DPI PNG（供预览/兜底），
   预览读 PNG、编辑用 OMML——代价是文件变大、两轨可能不同步；
2. 预览侧检测到 OMML 时给明确提示「公式需用 PowerPoint/WPS 查看」；
3. 干脆只写 PNG，牺牲可编辑性。

### 3.3 图形：TikZ → SVG → 转形状

PowerPoint 2016+ 原生支持 SVG，且**「转换为形状」后可以改颜色、改文字、拆分子形状**。
所以「TikZ 画结构式/示意图 → SVG → 插进原生 PPTX」是保留 LaTeX 绘图能力、
同时保持可编辑的正确姿势。本项目已有 Ketcher（结构式）与 matplotlib（数据图），
TikZ 只对「数学味重的示意图」有增量价值。

## 4. 对本项目的具体影响

本项目现有 PPT 链是**原生 PPTX + 模板符合性门禁**：
`scripts/pptx/build_from_template.py`（python-pptx 按导入模板构建）→
`src/pptx-conformance.js`（主题字体/主色、必需页、页数上限、讲稿备注）→
LibreOffice 预览。

如果改成 LaTeX/Beamer 出 PPT：

| 影响面 | 后果 |
|---|---|
| **模板符合性门禁** | 直接失效：整页 SVG/图片的 deck 没有可比较的主题字体与主色，也没有「必需页」结构。这条门禁是本项目对齐课题组 PPT 模板的核心约束，不能丢 |
| **安装包体积** | 需要在客户端带 TeX 发行版（TeX Live 完整版 GB 级；MiKTeX 最小可用也要数百 MB 且首次编译需联网取包）。当前安装包已因上游 `libreoffice-kit-win32-x64` 涨到 **259 MB**，再加 TeX 会破坏「离线安装」叙事 |
| **离线/内网** | MiKTeX 的按需装包默认要联网；校内机器常无外网 |
| **预览** | 见 §3.2，OMML 在 LibreOffice 里渲染不完整 |
| **Windows 打包** | 需要新的 TeX 组件与字体许可审查（很多模板字体不可再分发） |
| **人工审核门禁** | 现有门禁绑定「成品与模板一致 + 页数/备注」，换成整页图形后无法校验 |

**结论：不建议把主 PPT 生产链换成 LaTeX/Beamer。**

## 5. 建议方案：原生 PPTX 为骨架，LaTeX 只做「片段」

保留现有 python-pptx 模板链与符合性门禁，把 LaTeX 的价值注入到两个点上：

```
课题组 PPT 模板（source.pptx）
  └─ python-pptx 按模板构建（现有）
       ├─ 文本/版式：原生文本框（现状，可编辑）
       ├─ 公式：LaTeX → OMML，注入文本段落   ← 新增（可编辑）
       └─ 示意图：TikZ（可选）→ SVG → 插入   ← 新增（转形状后可编辑）
```

落地要点：

1. **LaTeX → OMML 的转换不要依赖客户端装 Office**：可用 pandoc（静态二进制，
   但要评估体积与许可）或纯 Python 的 `latex2mathml` + 自写 MathML→OMML 子集；
   建议只支持**常用子集**（分数、上下标、希腊字母、求和/积分、矩阵、`\ce{}`），
   超范围降级为 600 DPI PNG。
2. **双轨公式**应对 LibreOffice 预览缺陷（见 §3.2），并在符合性报告里如实标注。
3. **TikZ 作为可选能力**，只有检测到本机有 LaTeX 时才启用；没有就退回
   Ketcher/matplotlib 出图，**不阻断构建**。
4. 若确实需要 Beamer 风格的只读讲义：作为**旁路导出**（PDF）提供，
   不进入模板符合性门禁、不参与「登记 PPT 产物」的主流程。

## 6. 工作量估算（在本项目内落地）

| 方案 | 内容 | 人日 |
|---|---|---|
| 只做公式 OMML（推荐先做） | LaTeX 子集 → OMML 注入 + PNG 双轨 + 超范围降级 + 符合性报告标注 + 测试 | **4–6** |
| 加 TikZ 可选图 | 探测本机 LaTeX、TikZ→SVG、插入与转形状说明、无 LaTeX 时降级 | **3–4** |
| 完整 Beamer 旁路（只读 PDF 讲义） | 模板化 beamer 主题、编译、归档、不进门禁 | **3–5**（+ 客户端 TeX 打包） |
| 若坚持 Beamer → 可编辑 PPTX | 采用 beampptx/beamer2pptx 一类工具 + 质量兜底 + 用户预期管理 | **5–8**，且**仍达不到逐元素可编辑** |

## 7. 待验证与风险

1. **未实测** `beamer2pptx` 与 `beampptx` 的实际产物质量（本机无 Windows PowerPoint
   做人工验收）；两者的可编辑性结论来自各自 README 的实现描述。
2. **字体许可**：LaTeX 模板常绑定商用字体，随包分发有法律风险。
3. **公式双轨的不同步**：用户改了 OMML 不重生成 PNG，预览就会显示旧公式——
   需要在审核环节提示，或预览时优先渲染 OMML（但 LibreOffice 又会显示不全）。
4. **pandoc 作为运行期依赖**的体积与许可需要单独评估；若走纯 Python 子集实现，
   则要接受覆盖范围有限。
5. OMML 导入的限制（官方列出 12 条）意味着 `\displaystyle`、字号等排版细节会丢，
   **公式会变成 PowerPoint 的排版而非 LaTeX 的排版**——这一点要提前和用户对齐预期。

## 8. 一句话结论

LaTeX 适合做**公式与示意图的内容来源**，不适合做**PPT 的排版引擎**；
用 Beamer 出的 PPT 想在 PowerPoint 里逐元素改，只有在「牺牲排版保真」或
「牺牲可编辑性」之间二选一。建议按 §5 的混合路线：**原生 PPTX 骨架不动，
公式走 OMML（双轨以兼容本项目 LibreOffice 预览），TikZ 图按需启用**。

### 参考

- [LaTeX Support in Microsoft 365（官方，LaTeX ⇄ OMML 命令表与限制）](https://learn.microsoft.com/en-us/office/math/latex)
- [beampptx：Beamer → PPTX（整页 SVG 矢量）](https://github.com/kocurvik/beampptx)
- [beamer2pptx：Beamer PDF → 可编辑 PPTX + 原生公式](https://github.com/xdmlxdml/beamer2pptx)
- [pdf2ppt：PDF 版面反解 → 可编辑 PPTX（MinerU）](https://github.com/jieqiuming/pdf2ppt)
- [powerpoint-skill：PptxGenJS + pandoc OMML 注入 + TikZ 图管线，以及 LibreOffice/OMML 限制说明](https://github.com/Noi1r/powerpoint-skill)
