# 已归档文献打开缺陷与侧栏翻译阅读评估

记录日期：2026-10-07。代码基线：41d508f（Electron 迁移分支）。本次范围为缺陷记录、代码检查和现成方案调研；尚未实现修复或生成新安装包。

## 1. 缺陷登记：IBMLAB-READER-001

- 用户复现：文献精读条目 → 点击已归档原文 → 出现新的 Electron 窗口，内容无法打开。
- 影响：已有正文无法在应用内正常阅读；PDF 类型 SI 走同一调用链，也需要覆盖。
- 优先级：P1，归档后阅读主流程受阻。
- 状态：已登记，待实现与实机复现验证。
- 期望：点击正文或 SI，打开或聚焦主窗口右侧栏的文献阅读标签，显示真实文件内容；不创建独立 Electron 阅读窗口。文件错误时显示明确原因。

代码证据：

1. `client/src/components-project.js` 约 735–796 行：正文/SI 生成 `/api/lab-artifacts` 引用；`openEntryInEdge` 实际调用 `openPdfPreview`。按钮提示仍写“外部 Microsoft Edge”，与当前 Electron 行为不一致。
2. `client/src/lib.js` 的 `openPdfPreview` 优先调用原生 `preview`；桌面环境不会走后面的侧栏回退逻辑。
3. `lib/scientific-desktop.js` 的 `artifactAction`：按登记引用读取真实文件、stage，再调用 broker `preview`。
4. `electron-next/scientific-runtime.mjs` 的 `case "preview"` 明确创建 `new BrowserWindow`，从独立预览副本的 `file://` 地址加载。
5. 该预览窗口网络过滤器允许部分协议，却没有复用 `pdf-browser-policy.mjs` 对内置 PDF 阅读器 `chrome://resources` 的规则。普通科研侧栏已经使用该规则。这里是空白的待验证原因，不是已完成实机验证的结论。
6. `discard` 删除的是 stage 原件；预览先复制到 `downloadsRoot/previews`，副本在窗口关闭时删除。因此目前证据不支持“finally 提前删除了预览文件”这一判断。

修复验收必须从精读条目的真实按钮进入，不能只用网页 PDF 或原生 preview RPC 成功作为替代。

## 2. 可复用方案

### PDF.js：推荐用于归档文献侧栏阅读

Mozilla 的 JavaScript PDF 阅读器，有显示层与完整 viewer，Apache-2.0。适合在现有 React/DSH 资源标签内显示原文、中文 PDF、双语 PDF，复用分页、缩放、搜索和文本选择。

它负责阅读，不负责翻译，也不会自动提供两份不同 PDF 的语义滚动对齐。侧栏较窄时可以阅读双语合并 PDF，或采用上下对照；宽屏可以扩展为左右对照。

来源：[项目](https://github.com/mozilla/pdf.js)、[显示层与 viewer 文档](https://mozilla.github.io/pdf.js/getting_started/)、[许可证说明](https://mozilla.github.io/pdf.js/)。

### PDFMathTranslate-next + BabelDOC：推荐进行保留版式的翻译验证

PDFMathTranslate-next 是基于 BabelDOC 的翻译应用和参考实现，提供命令行、WebUI、Python 接口以及 Windows 发行方式。BabelDOC 提供单语/双语 PDF、同页左右或交替页对照、术语表、进度报告、离线字体与模型资源管理，较贴近“翻译 PDF 后中文/双语阅读”的需求。

重要接入边界：BabelDOC 文档将直接 API 标记为内部 API，并推荐通过 PDFMathTranslate-next 的 `high_level.do_translate_async_stream` 调用。生产实现应优先固定 wrapper 版本或通过固定 CLI 适配，不直接依赖未承诺稳定的 BabelDOC 内部接口；无需将完整 Gradio 页面嵌入本产品。

两者项目标明 AGPL-3.0，需要在最终发行方案中核对许可证与依赖要求。Python 元数据声明 `>=3.10,<3.14`，当前项目 Python 3.12.11 符合声明范围；不等于依赖已安装、已兼容或已测试。NEXT wrapper 与 BabelDOC 对 PyMuPDF 等依赖有不同约束，应使用独立运行环境，先验证锁定依赖的组合，不能直接混装进现有科研 Python。

模型、字体、安装体积、首次启动耗时以及实际 DeepSeek 兼容性均待验证；不得按“支持 OpenAI 服务”直接声称可复用当前 DeepSeek Messages 会话。Agent 应负责启动、术语要求、校验和登记，底层翻译调用需单独实现可靠适配。

来源：[NEXT 主项目](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next)、[BabelDOC 功能及 API 边界](https://github.com/funstory-ai/BabelDOC)、[BabelDOC 依赖声明](https://github.com/funstory-ai/BabelDOC/blob/main/pyproject.toml)、[NEXT 依赖声明](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/blob/main/pyproject.toml)。

### 项目现有 nature-reader：可复用全文翻译规范

仓库已有 `vendor/nature-skills/skills/nature-reader`，规定全文中英块对照、图表定位、公式保持、页码来源锚点、`paper.md`、`source_map.json` 和 `translation_notes.md`。现有 bundle schema 也已有 `paperMdPath/sourceMapPath/translationNotesPath` 字段。

这是可复用的 Agent 工作规范与校验基础，不是已经完成的 PDF 排版翻译引擎或交互式侧栏组件。适合增加“逐段对照阅读”：依据块对照切换中文/双语，并可回到原 PDF 页码。若首版采用它，必须明确交付的是全文内容阅读模式，不能当作已满足保留原版式的中文 PDF。

## 3. 推荐产品方案

采用“DSH 侧栏资源标签 + PDF.js 阅读器 + 可替换的翻译任务后端”。先统一归档阅读入口，再进行翻译引擎验证。保留原版式 PDF 与逐段对照阅读共用一个侧栏，不引入第二套科研浏览器或独立阅读窗口。

界面行为：

| 条目状态 | 按钮 | 点击结果 |
| --- | --- | --- |
| 正文未归档 | 翻译（禁用，提示先获取正文） | 不启动空任务 |
| 有正文，无译文 | 翻译 | 启动 Agent 翻译任务并显示进度 |
| 翻译进行中 | 翻译中… | 打开任务详情，避免重复启动 |
| 翻译完成 | 阅读译文 | 侧栏打开，切换中文/双语；保留原文模式 |
| 翻译失败或部分完成 | 重试/继续翻译 | 展示原因与已完成范围，不能冒充全文完成 |
| 原文件内容更新 | 重新翻译 | 旧译文标为过期，保留旧版本记录 |

默认条目“翻译”针对正文；SI 在同一侧栏作为独立材料，可单独触发翻译。正文完成不能推导 SI 已翻译。PDF SI 可直接阅读；ZIP SI 显示文件清单，逐个选择可阅读文件；非 PDF 文件显示格式、打开/保存选项，不把 ZIP/Excel/原始数据伪装成 PDF。

窄侧栏默认中文或上下对照，宽侧栏提供左右对照。PDF 版式模式与逐段全文模式应明确标记，图表、公式与页码导航在模式切换后保持可回溯。

## 4. 需要自行完成的集成

1. **统一入口**：替换精读正文/SI 的 `openPdfPreview` 路由，复用 `client/src/project-tab.js` 的 `sidebarRight.openResource` 装配方式；地址按课题、bundle、材料种类与版本区分。重复点击聚焦已有标签，侧栏折叠时展开并确认可见。
2. **安全文件读取**：继续由 Host 根据已登记 ID 解析归档文件、核对课题与文件哈希。阅读组件通过鉴权的字节读取/受限流式通道加载 PDF；不把带凭据的 Host URL、任意磁盘路径或课题目录权限交给出版社网页 guest。47 MB SI 应支持流式/范围读取，避免每次整份 base64 RPC。
3. **翻译登记**：新增独立 translation 记录，按 `projectId + bundleId + artifactKind + sourceSha256 + targetLanguage + engine/options` 去重，保存任务状态、阶段、输出哈希、版本、校验结果和错误。现有 `paperMdPath` 不足以证明译文完整。
4. **任务工具**：启动、状态查询、取消、结果登记/校验；Agent 可调用，按钮可发起。已完成原文归档不应因后续翻译失败而回滚。
5. **阶段与宠物**：读取文件 → 解析版面/扫描识别 → 翻译（可用时显示完成页数/块数）→ 重排 → 校验 → 归档。任务事件直接推送；宠物只显示实际运行任务。引擎未提供精确进度时显示阶段，不编造百分比。
6. **完整性验证**：核对输入/输出 PDF 可解析、页数与处理范围、中文输出、图表/公式保留和未翻译内容说明；全文块模式另外验证 source map 与资源链接。关键样例需要视觉检查，不能只以文件存在或模型说“完成”为准。
7. **结果提交**：先写临时结果并校验，通过后原子登记到条目目录；失败保留诊断，不覆盖源 PDF。重启能恢复已完成译文，运行中的任务需明确恢复或中断。

## 5. 实施顺序与验收

**R1：归档阅读修复。** 建立 PDF.js 侧栏资源组件，接入正文和 PDF SI；纠正旧 Edge 提示。实机点击已归档原文与 SI，验证首屏可见、搜索/分页、重复点击复用、侧栏折叠恢复、重启后打开、文件缺失明确报错；验证没有新增 Electron 窗口。ZIP SI 至少提供材料清单/格式说明。

**R2：翻译后端验证。** 使用独立环境固定 PDFMathTranslate-next/BabelDOC 组合，测试普通双栏论文、公式/表格论文、长 SI 和扫描 PDF；验证当前模型适配、实际进度、取消与失败恢复。记录耗时、资源占用、依赖体积与视觉质量，再确定发行配置。扫描件可能需要 OCR 与校对，不承诺所有 SI 自动无误。

**R3：翻译闭环。** 新增按钮、任务与归档 schema、Agent 工具、中文/双语模式、宠物阶段和缓存失效。重复点击不重复扣费执行；切换阅读模式不重新翻译；正文和 SI 状态独立；模型失败/应用重启不破坏原文归档。

**R4：打包验收。** 在隔离课题运行真实安装包端到端验证并检查侧栏截图；覆盖旧条目兼容、跨课题隔离、缺失文件、半完成翻译、原文更新、离线阅读与超长 SI。通过后生成安装包。

本次调研确认已有阅读与版式翻译轮子；尚未在本项目安装这些组件或跑真实翻译，不宣称缺陷已修复、模型兼容已确认或翻译质量已通过验收。
