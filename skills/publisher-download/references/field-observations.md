# 人工实测记录（2026-09-28）

前 11 篇来自用户手工下载反馈；下方另补 1 篇 ScienceDirect 的 beta21 故障实测。本机 `C:\Users\admin\AppData\Local\iBM-Lab-Agent\logs\webvpn.log` 中对应页面的成功路线还记录了 `downloadRequested`、`downloadFinished success=true` 和 `captureCompleted`；Wiley 正文没有完成记录。前 11 篇的访问模式、最终课题文件路径和文件哈希仍未全部核对。日志能佐证壳捕获完成，不能证明修订后的 `lab_browser_download_viewer_pdf` 已通过真机测试。入口文字和位置只适用于所列页面，不能当作整站稳定选择器。没有 SI 表示用户报告该篇未见 SI。

## IEEE Xplore（1 篇）

- [document/9175387](https://ieeexplore.ieee.org/document/9175387)：文章页红色 **PDF** 按钮 → 原生 PDF 预览页。查看器工具栏未加载，壳捕获进度一直约 1 KB；用户通过**右键保存**报告已归档。该篇未见 SI。右键是人工兜底，不能写成 `lab_browser_click` 可操作的元素，也不能把 1 KB 判作完整 PDF。

## Elsevier：ClinicalKey 与 ScienceDirect（3 篇）

- [ClinicalKey 文章，PII S2475037924000621](https://www.clinicalkey.com/#!/content/playContent/1-s2.0-S2475037924000621)：标题旁 **下载 PDF** → 原生预览页。壳显示约 **1 KB / 1.4 MB** 后卡住，但查看器工具栏出现；用户点击工具栏保存，报告正文已归档。文章页的 [mmc1.docx](https://www.clinicalkey.com/ui/service/content/url?section=static%2fimage&eid=1-s2.0-S2475037924000621&path=24750379%2FS2475037924X00035%2FS2475037924000621%2Fmmc1.docx) 直接下载，报告 SI 已归档。ClinicalKey 是独立站点路径，不要套用 ScienceDirect 页面控件。
- [ScienceDirect 文章，PII S0956566311006075](https://www.sciencedirect.com/science/article/pii/S0956566311006075?via=ihub)：**View PDF** → 默认 PDF 预览页 → 工具栏保存，报告正文已归档。文章页 **Appendix A. Supplementary data** 下的 [mmc1.pdf](https://ars.els-cdn.com/content/image/1-s2.0-S0956566311006075-mmc1.pdf) → 默认 PDF 预览页 → 工具栏保存，报告 SI 已归档。
- [10.1016/j.bios.2013.11.059，PII S095656631300849X](https://www.sciencedirect.com/science/article/pii/S095656631300849X)：iWAN 直访，文章页 **View PDF** → `…/pdfft` 原生查看器。beta21 的 Agent 保存动作 4 次报“主窗口不可用”；beta22 修复主窗口查找后仍未自动下载：首次无下载事件等满 100 秒，第二次因查看器未获前台焦点而立即取消。用户点击查看器并按 **Ctrl+S** 后，壳自动归档：beta22 为 2,151,133 B，SHA256 `2D7F90CB592B84312D3AFE6C1AF8288948DFA94B739AC4F78507A8DF3D3A6205`。两次实测中 348 B 的 HTML 响应缓存均未归档。beta23 合成 Ctrl+S 仍未触发下载。beta24–25 的 WebView2 独立取数得到约 62.9 KB 的 Cloudflare Turnstile HTML 验证页（HTTP 200），两次重试一致；beta26 的查看器内部 DOM 控件路线返回 `viewer-unavailable`，正文仍未归档。项目已有 `WebResourceResponseReceived` 取流，但在这篇上拿到的是 348 B HTML 查看器外壳，因此不能把同一 API 当作新解决方案。遇到人机验证须由用户完成。新版 WebView2 原生另存为方案尚待真机复测；自动保存失败时请用户在侧栏按 Ctrl+S，再查任务状态，无需回传路径。

## SAGE / CNPeReading（1 篇；当前工具未配置 DOI 前缀）

- [10.1177/15910199231175377](https://sage.cnpereading.com/doi/10.1177/15910199231175377)：DOI 号下面的 **下载 PDF** 按钮直接触发归档；该篇未见 SI。这是人工观察，当前 `lab_publisher_browser_download` 尚不支持 `10.1177/`，不能据此发起 Agent 捕获任务。

## Wiley Online Library（1 篇）

- [10.1002/btm2.10616](https://aiche.onlinelibrary.wiley.com/doi/10.1002/btm2.10616)：**PDF** → 出版社 PDF 预览页。壳显示正在接收、总量约 **4.4 MB**，等待后仍未完成；右上角工具栏没有渲染，页面无法保存。**正文失败，不得标作已归档。** SI：展开 **Supporting Information**，点击 **Filename** 下的 [btm210616-sup-0001-Supinfo.docx](https://aiche.onlinelibrary.wiley.com/action/downloadSupplement?doi=10.1002%2Fbtm2.10616&file=btm210616-sup-0001-Supinfo.docx)，报告直接归档。只对 SI 路线给出成功提示，正文仍需另找可验证路径。

## SpringerLink（2 篇）

- [10.1007/s10439-016-1559-9](https://link.springer.com/article/10.1007/s10439-016-1559-9)：先出现 Cloudflare 人机验证；用户完成后进入文章页。**View PDF** → 预览页 → 工具栏保存，报告正文已归档。该篇未见 SI。验证必须交给用户；通过后重新观察页面。
- [10.1007/s00395-004-0501-8](https://link.springer.com/article/10.1007/s00395-004-0501-8)：**Download PDF** 直接触发归档，报告正文成功；该篇未见 SI。两篇的 PDF 入口与保存路线不同，须以当前页和状态为准。

## Theranostics / thno.org（1 篇；当前工具未配置该站点）

- [v07p2431](https://www.thno.org/v07p2431.htm)：页面右上角 **PDF** → 默认预览页 → 工具栏保存，报告正文已归档。**Supplementary Material** 栏目下的 [Supplementary figures and tables](https://www.thno.org/v07/p2431/thnov07p2431s1.pdf) → PDF 预览页 → 工具栏保存，报告 SI 已归档。当前 `lab_publisher_browser_download` 未配置此站点；先人工操作，不要声称 Agent 已能发起任务。

## Nature Portfolio（1 篇）

- [s41598-020-62360-w](https://www.nature.com/articles/s41598-020-62360-w)：文章页 **Download PDF** 直接触发归档，报告正文成功。**Supplementary information** 栏目下的 [41598_2020_62360_MOESM1_ESM.zip](https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fs41598-020-62360-w/MediaObjects/41598_2020_62360_MOESM1_ESM.zip) 直接下载，报告 SI 已归档。SI 是 ZIP，必须保持其真实类型；不要当作 PDF 预览件。

## BMJ / Journal of NeuroInterventional Surgery（2 篇；当前工具未配置 DOI 前缀）

- [15/6/526](https://jnis.bmj.com/content/15/6/526)：正文右上角 **PDF** → 默认预览页 → 工具栏保存，报告正文已归档。文章中部 **Supplemental material** 下的链接可直接归档 SI；本机日志记录的实际下载目标是 [inline-supplementary-material-1.pdf?download=true](https://jnis.bmj.com/content/neurintsurg/15/6/526/DC1/embed/inline-supplementary-material-1.pdf?download=true)。该 URL 来自日志核对，不是用户提供的按钮文字。
- [early/2026/04/30/jnis-2025-024772](https://jnis.bmj.com/content/early/2026/04/30/jnis-2025-024772)：正文右上角 **PDF** → 默认预览页 → 工具栏保存，报告正文已归档。文章中部 **Supplemental material** 下的 [inline-supplementary-material-1.pdf?download=true](https://jnis.bmj.com/content/neurintsurg/early/2026/04/30/jnis-2025-024772/DC1/embed/inline-supplementary-material-1.pdf?download=true) 报告直接归档 SI。当前工具尚未配置 BMJ DOI/站点分流；这些是人工路线。

## 跨站故障线索

- 原生 PDF 预览器的工具栏有时不渲染，PDF 页面显示比例过大，不能把“已进入预览器”当作“有可点的保存按钮”。
- 壳侧接收进度曾停在约 1 KB（IEEE、ClinicalKey）或有总量但迟迟未完成（Wiley）。IEEE 的预览页响应曾被识别为 HTML 壳；Wiley 预览页返回多段 `206 Content-Range`，当前壳明确跳过分段而非拼成完整 PDF。这解释响应层为什么没有完整载荷，但不能单独解释工具栏不渲染或壳保存接口失效。
- 用户报告壳内保存器在本轮手工操作中不可用；成功案例依赖直接下载、预览器工具栏或人工右键。虽然日志有 `captureCompleted`，仍应单独复测 Agent 保存命令并记录返回错误，不能将人工成功冒充为该命令已通过。
