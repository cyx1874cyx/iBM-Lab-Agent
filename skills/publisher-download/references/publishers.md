# 出版社规则表（Demo，2026-09-28）

本表汇集当前工具与桌面壳里的 DOI 分流、入口评分、预览处理和测试样例。`待测` 表示规则存在于代码或公开页面观察，但尚无对应出版社的机构会话成功归档证据。Science 正文的成功仅来自 2026-09-28 用户反馈；不能推出 Science SI 或其他论文、其他访问路线也已验证。

## 共通判据

- `lab_publisher_browser_download` 由 Agent 驱动。观察候选来自链接/按钮、开放 shadow root 和同源 iframe；最多返回 30 项，优先当前视口内的下载入口，再给其他位置的下载入口。正文优先具有 `Download PDF`、`View PDF`、`Open PDF` 等文字或明确 PDF 文件目标的项，排除 supplementary/source data；SI 优先明确的 Supplementary/Supporting/Additional file 及 PDF/DOCX/ZIP 附件，排除 Source Data。排名只是定位提示，不能替代页面和 DOI 核对。
- 预览页不等于文件已归档。`DownloadEvent::Requested` 只证明浏览器开始下载；`save-pdf-ready` 只证明响应层 PDF 载荷已完整；最终以任务 `completed` 和课题文件登记为准。HTML 查看器空壳、分段 206 响应、未收满字节不能当 PDF。
- 遇到机构登录、验证码、Cloudflare 等验证时由用户处理；不要反复点击或构造网络请求。单次任务最多用一次状态提供的备用 route；没有 route 时按 `manual-handoff`。

| 出版社 | DOI / 页面识别 | 正文入口与预览 | SI 入口与访问 | 标定 |
|---|---|---|---|---|
| Nature Portfolio | `10.1038/`；`nature.com` | 页面 `PDF` / `View PDF`，进入 PDF 后按状态保存 | `Supplementary Information`；Nature/Springer 静态附件可能公开直连，需核实实际文件 | 正文、SI 待测 |
| SpringerLink | `10.1007/`；`springer.com` | `PDF` / `Download PDF`，预览或直接下载 | `Supplementary file`；PDF/DOCX 等可能公开直连，保持扩展名 | 正文、SI 待测 |
| Science / AAAS | `10.1126/`；`science.org` | `PDF` / `View PDF`；`/doi/reader/` 或 `/doi/epdf/` 可能只进预览。状态给出 `science-pdf` 时可让壳进入同篇 `/doi/pdf/<DOI>?download=true` | `Supplementary Material`；同名 `DOWNLOAD` 要按 `file` 区分 `_sm.pdf`、表格 ZIP 等 | **正文用户反馈成功**；SI 待测 |
| Elsevier / ScienceDirect | `10.1016/`；`sciencedirect.com` | `View PDF`；`/pdfft` 预览可带 `download=true&isDTMRedir=true`，但 Demo 不自行改写 URL | `Appendix` / `Supplementary data`，逐个核对附件 | 正文、SI 待测 |
| ACS | `10.1021/`；`pubs.acs.org` | `Open PDF` / `PDF`；`/doi/reader/`、`/doi/epdf/` 可能进预览。没有已验证的 ACS 备用 route，Agent 按状态操作 | `Supporting Information`，通常从文章页进入附件 | 正文、SI 待测 |
| RSC | `10.1039/`；`pubs.rsc.org` | `PDF`；无站点专用 URL 改写 | 文章页 `Supplementary Information`；可能含 PDF/CIF 等 | 正文、SI 待测 |
| IEEE Xplore | `10.1109/`；`ieeexplore.ieee.org` | `PDF`；`/stamp/stamp.jsp` 可能是预览页。没有已验证的 IEEE 备用 route，Agent 不自行拼 URL | `Supplementary material`，可能是代码/数据文件 | 正文、SI 待测 |
| Wiley Online Library | `10.1002/` 或 `10.1111/`；`wiley.com` | **仅 iWAN**；正文 PDF 可能先进入预览，验证需由用户完成 | 展开 `Supporting Information` 折叠区，再选 `Filename` 表格中的真实文件链接；SI 也可能进预览 | 正文、SI 待测；WebVPN 路线暂停 |

## 规则边界和来源

DOI 分流与 `directSi`/Wiley 暂停：`lib/tasks-tool.js` 的 `PUBLISHER_RULES`。Agent 观察与受限备用 route：`lib/tasks-tool.js`、`lib/capture-phase.js`、`desktop/src-tauri/src/webvpn.rs`。样例与验收项目：`docs/PUBLISHER_NON_OA_TEST_CASES.md`。本 Skill 是 Agent 操作说明；标定后应同步修正代码与 `docs/PUBLISHER_DOWNLOAD_CALIBRATION.json`。
