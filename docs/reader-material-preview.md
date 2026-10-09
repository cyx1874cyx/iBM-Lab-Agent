# 条目材料阅读与对照

侧栏保留原文、中文，并增加精读和 PPT；已完成译文不再显示重复的“阅读译文、优化译文”按钮。条目精读/PPT 按钮打开同一阅读侧栏。全屏对照的两个下拉框独立选择该 bundle 的原文 PDF、SI PDF、已完成翻译 PDF、Word 笔记和 PPT。未归档材料不列入选择框。

`tasks_reader_materials` 先校验课题和 bundle 归属，按 report 关联获取 PPT（presentation 自身没有 bundleId）。列表不暴露 Office 路径。精读/PPT 生成和重新提交时，由 `office-pdf.js` 调用 DSH 的 `officeToPdf` 转换队列，在原文件旁保存同名 PDF，并登记源文件和 PDF 的 SHA-256。Word/PPT 原文件保留，预览、全文查找、缩放、翻页和双屏关联统一使用 PDF 阅读器。

`tasks_reader_open` 的 `materialId` 只能解析当前条目已登记的报告/演示，不能传任意磁盘路径。正常打开直接读取已生成 PDF，不再调用转换器；旧记录首次打开时补生成。源文件变化、PDF 丢失或损坏会重新生成。转换失败可重试，原文件保留。并发打开共享同一生成任务；转换期间源文件被替换时不登记过期结果。条目搬家同步改写 PDF 路径。

DSH 0.2.0-rc.2 原来的 document slots 只能由所属父组件渲染。`scripts/dsh-office-preview-factory.mjs` 在打包副本中增加两个 session Component Factory，复用原生 OfficeBody、LazyPdfBody 和转换/缓存/取消 face，不重复声明 DSH 的全局 slots。源码 SHA-256 固定检查；升级 DSH 必须复核适配器。原 NEXT checkout 不修改。标准 `pack-domain-release.mjs` 将适配后的原生预览包加入 ledger（82 包），安装器将它替换到运行时；现有 kernel junction 机制保证升级后使用安装器的新副本。

PDF.js 5.4.624 原版 PagesMapper 静态共享，卸载 viewer 会影响保留的其它文档。`scripts/pdfjs-document-state.mjs` 构建时改为按 WorkerTransport 持有；PDFPageProxy 和 PDFViewer 使用文档所属 mapper，viewer 卸载只重置自己的引用。该方式与 DSH 原生 PDF renderer 的文档状态归属一致。上游文件及其原始校验清单保持不变。

旧版 DSH Office Component Factory 适配保留在安装包中兼容先前版本；本阅读器的精读/PPT 入口已不使用即时 Office 转换。

精读/PPT 工具栏的下载按钮另存为原始 `.docx` / `.pptx`，使用与条目下载相同的原生另存为和文件校验通道。PDF 仅用于预览。原文、SI、译文下载仍按各自 PDF 类型保存。

验证包括真实 Electron/Host 中生成精读/PPT PDF 后再预览、重复打开不调用转换器、Word+PPT 和 SI+PPT 对照、切回原文/译文，以及浏览器中页数不同的双 PDF、范围读取失败重试、快速切换、滚动同步和资源释放。工具栏在精读、PPT、原文和译文中统一，窄侧栏允许分组换行。
