# 中文 PDF 与连续滚动双语阅读修正

日期：2026-10-08。产品代码：`9cc2bd8`。本报告取代前一版“段落网页译文阅读”的交付说明。

## 产品行为

- 翻译后生成独立 `translated.pdf`，保留原页数、页面尺寸、文字区域、双栏位置、图片与矢量图形。中文字体嵌入并子集化；无法排入的译文不会被悄悄截断。
- “中文”在主窗口右侧栏显示真实 PDF，提供连续上下滚动、缩放、页码定位、文本搜索、文字选择、抓手拖动和 PDF 下载。
- “双语对照”按用户第二张参考图打开全屏：左原文、右中文，各有 PDF 工具栏。默认按页内比例关联滚动、缩放；可取消关联或改为上下视图。退出全屏返回侧栏，保留阅读页的位置。
- 旧版已完成译文首次阅读时直接生成中文 PDF，复用现有翻译块，无需重新请求模型。正文和 SI 的翻译/文件校验继续独立。
- 翻译结束后先生成并校验 PDF，再登记完成；排版失败保留已有译文和原文，显示明确原因，允许重试。
- 下载复用现有桌面原生保存流程，Host 校验课题归属、原文哈希、译文哈希与生成 PDF 哈希，客户端不接收任意磁盘路径。

## 验证

- 全套 833 项：825 通过、8 跳过、0 失败。使用包内 Python 检查真实中文 PDF 可解析、中文可提取、页数/尺寸不变、原图片和矢量图保留、旧译文升级及损坏文件拒绝。
- 客户端和七个独立插件包生成物一致性检查通过。
- 第一轮打包窗口验收通过：`outputs/electron-next-pdf-layout/packaged-ui/run-RFgAni/verification.json`。窗口证据检查了连续阅读、全屏双 PDF、滚动和缩放关联/解除、中文 PDF 下载哈希、模式反复切换，以及原有附件、下载归档、文件夹、RIS、宠物和重启功能。
- 最终产品代码的打包窗口验收再次通过，33 项检查：`outputs/electron-next-pdf-layout/final-packaged-ui/run-8aySR3/verification.json`。新增验证：全屏切到第 2 页后返回侧栏仍在第 2 页。最终中文与双语截图已检查。合成 PDF/固定译文用于机制验收，未调用真实模型或登录机构网站。
- 复用用户截图对应的《Acute Ischemic Stroke Thrombus Composition》已有真实译文，在交付目录副本生成 10 页 PDF，排版 214 个原文字区域，未触发小字号警告。人工检查第 1、2、4 页的双栏、页眉、正文、图片和图注位置。用户原课题目录未被改写。

## 边界

本次修改负责将 Agent 已给出的译文排回原页面，保留区域与图形，不重新审查已有术语翻译质量。中文长度不同会改变区域内换行与必要时字号，无法承诺每个字与原版一一重合；小于 5 pt 的排版会提示。

当前版式生成针对有可提取文字的 PDF；纯扫描页缺少文字位置时明确报错并保留已译内容，需要带坐标 OCR 才能生成保留版式 PDF，不会以网页段落或空白 PDF 冒充完成。图像中不可提取的文字保留原图。

实现复用现有包内 PyMuPDF（文字区域替换、中文排入与字体子集）及 PDF.js（连续页面绘制与文字层）。接口参考：[PyMuPDF Page API](https://pymupdf.readthedocs.io/en/latest/page.html)、[HTML 区域排版](https://pymupdf.readthedocs.io/en/latest/recipes-text.html)。未增加 BabelDOC / PDFMathTranslate-next 服务或外部模型凭据。

## 交付位置

最终包：`outputs/electron-next-pdf-layout/final-release-windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`。包校验和、最终验收路径与签名状态见同交付目录 `delivery.json`。

安装前完全退出 Electron 版（含托盘），安装到现有 Electron 目录。首次打开旧译文会执行一次 PDF 排版，随后复用已归档 PDF。
