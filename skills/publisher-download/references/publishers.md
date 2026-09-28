# 出版社规则表（Demo，2026-09-28）

本表汇集工具的 DOI 分流和 [12 篇现场记录](field-observations.md)。前 11 篇的最终课题文件路径和哈希尚未全部核对；ScienceDirect 个案的 beta21、beta22 归档文件大小与哈希已核验，但 Agent 自动保存仍未通过实机验证。Science 正文另有一次用户反馈成功，但未提供论文链接和访问路径。只把已观察到的入口作为同类页面的定位线索，不推断整站通用选择器。

## 共通判据

- `lab_publisher_browser_download` 由 Agent 驱动。观察候选来自链接/按钮、开放 shadow root 和同源 iframe；最多返回 30 项，优先当前视口内的下载入口，再给其他位置的下载入口。正文优先具有 `Download PDF`、`View PDF`、`Open PDF` 等文字或明确 PDF 文件目标的项，排除 supplementary/source data；SI 优先明确的 Supplementary/Supporting/Additional file 及 PDF/DOCX/ZIP 附件，排除 Source Data。排名只是定位提示，不能替代页面和 DOI 核对。
- 预览页不等于文件已归档。出版社 HTML 预览页观察并点击其真实 `Download PDF` 按钮；原生 PDF 页按 `download-viewer-pdf` 调用查看器保存工具。动作失败最多再试一次；连续失败后请用户在侧栏原生查看器按 Ctrl+S，壳会自动捕获归档，无需回传路径。下载事件只证明浏览器开始下载；最终以任务 `completed` 和课题文件登记为准。HTML 空壳、206 响应、约 1 KB 的预览缓存不是下载进度。
- 遇到机构登录、验证码、Cloudflare 等验证时由用户处理；不要反复点击或构造网络请求。单次任务最多用一次状态提供的备用 route；没有 route 时按 `manual-handoff`。

| 出版社 / 工具状态 | DOI / 页面识别 | 人工观察到的正文路径 | 人工观察到的 SI 路径 | 本批结果 |
|---|---|---|---|---|
| Nature Portfolio，已配置 | `10.1038/`；`nature.com` | `Download PDF` 可直接下载；其他文章可能进入预览 | `Supplementary information` 栏目下的静态附件；实测为 ZIP，保留类型 | 1 篇正文、SI 用户报告归档 |
| SpringerLink，已配置 | `10.1007/`；`link.springer.com` | 一篇 `View PDF` → 预览页 → 人工点工具栏保存；另一篇 `Download PDF` 直接下载 | 两篇均未见 SI；遇 Cloudflare 先由用户验证 | 2 篇正文用户报告归档 |
| Science / AAAS | `10.1126/`；`science.org` | `PDF` / `View PDF`；`/doi/reader/` 或 `/doi/epdf/` 可能只进预览。状态给出 `science-pdf` 时可让壳进入同篇 `/doi/pdf/<DOI>?download=true` | `Supplementary Material`；同名 `DOWNLOAD` 要按 `file` 区分 `_sm.pdf`、表格 ZIP 等 | **正文用户反馈成功**；SI 待测 |
| Elsevier / ScienceDirect / ClinicalKey，`10.1016/` 已配置 | `sciencedirect.com`、`clinicalkey.com`；先核对条目 DOI | ScienceDirect `View PDF` → 原生预览页；`10.1016/j.bios.2013.11.059` 在 beta21、beta22 Agent 自动保存失败后，均由用户 Ctrl+S 自动捕获归档。ClinicalKey 标题旁 `下载 PDF` → 原生预览页 → 人工点工具栏，旧壳约 1 KB / 1.4 MB 停滞 | ScienceDirect `Appendix A. Supplementary data` 的 PDF 经预览保存；ClinicalKey 文章页 `mmc1.docx` 直接下载 | 3 篇正文归档记录；新一轮窗口激活修复待实机验证，ClinicalKey 尚未专项接线验证 |
| ACS | `10.1021/`；`pubs.acs.org` | `Open PDF` / `PDF`；`/doi/reader/`、`/doi/epdf/` 可能进预览。没有已验证的 ACS 备用 route，Agent 按状态操作 | `Supporting Information`，通常从文章页进入附件 | 正文、SI 待测 |
| RSC | `10.1039/`；`pubs.rsc.org` | `PDF`；无站点专用 URL 改写 | 文章页 `Supplementary Information`；可能含 PDF/CIF 等 | 正文、SI 待测 |
| IEEE Xplore，已配置 | `10.1109/`；`ieeexplore.ieee.org` | 红色 `PDF` → 原生预览页；实测工具栏未渲染，用户右键保存。不要把右键当作可用 Agent 元素 | 实测文章未见 SI | 1 篇正文用户报告归档；壳进度约 1 KB 停滞 |
| Wiley Online Library，已配置但仅 iWAN | `10.1002/` 或 `10.1111/`；`*.onlinelibrary.wiley.com` | `PDF` → 出版社 HTML 预览页；观察右上角 `Download PDF`，优先点击 `/doi/pdfdirect/<DOI>?download=true`。旧版正文因预览缓存停滞失败，新入口待真机验证 | 展开 `Supporting Information`，选 `Filename` 下的 `downloadSupplement` DOCX 文件 | 1 篇 SI 用户报告归档；正文新入口待测，WebVPN 路线仍暂停 |
| SAGE / CNPeReading，未配置 | `10.1177/`；`sage.cnpereading.com` | DOI 下方 `下载 PDF` 直接下载 | 实测文章未见 SI | 1 篇正文用户报告归档；Agent 工具不可直接发起 |
| Theranostics，未配置 | `thno.org` | 右上角 `PDF` → 默认预览页 → 人工点工具栏 | `Supplementary Material` 下 `Supplementary figures and tables` PDF → 预览页 → 人工点工具栏 | 1 篇正文、SI 用户报告归档；Agent 工具不可直接发起 |
| BMJ / JNIS，未配置 | `jnis.bmj.com` | 右上角 `PDF` → 默认预览页 → 人工点工具栏 | 文章中部 `Supplemental material` 链接；一篇明确为 `inline-supplementary-material-1.pdf?download=true` | 2 篇正文、SI 用户报告归档；Agent 工具不可直接发起 |

Wiley 新增的预览页线索来自用户提供的元素：`aria-label="Download PDF • 3.2 MB"`、`class="navbar-download"`、目标 `/doi/pdfdirect/10.1002/btm2.10677?download=true`。先由 `lab_browser_observe` 核对文章 DOI 与目标，再用返回的元素引用点击；不要把该 DOI 或 CSS 类当作所有 Wiley 页面通用入口。此路线尚待实机归档验证。

## 规则边界和来源

DOI 分流与 `directSi`/Wiley 暂停：`lib/tasks-tool.js` 的 `PUBLISHER_RULES`。Agent 观察与受限备用 route：`lib/tasks-tool.js`、`lib/capture-phase.js`、`desktop/src-tauri/src/webvpn.rs`。完整文章链接、SI 文件链接与失败细节见 [人工实测记录](field-observations.md)。本 Skill 是 Agent 操作说明；新增出版社须先完成工具分流和端到端验证，不能只凭本表调用现有捕获工具。
