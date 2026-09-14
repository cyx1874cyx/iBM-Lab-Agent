# 已适配出版社非 OA 回归测试样例

更新日期：2026-09-14

## 口径

- “非 OA”指出版社正式版本的正文需要机构订阅、购买或授权访问；补充材料本身可能允许公开下载。
- 每个出版社选择 2 篇，优先覆盖正文 PDF 预览器、SI 直下、DOCX、视频、CIF 和“无稳定 SI”分支。
- WebVPN 与 iWAN 均应由真实软件内浏览器会话测试；不要用服务端 HTTP 请求代替浏览器下载流程。

## 测试清单

| 出版社 | 测试样例 | DOI / 出版社页面 | 补充材料 | 预期路径与主要检查点 |
|---|---|---|---|---|
| Nature Portfolio | Head–tail carboboration of multisubstituted alkenes enabled by chain recognition | [10.1038/s41557-025-01903-y](https://www.nature.com/articles/s41557-025-01903-y) | PDF SI | 正文经 WebVPN 或 iWAN；SI 直访。检查正文订阅鉴权、PDF 捕获及 SI 不误走 WebVPN。 |
| Nature Portfolio | Reticular copper dual sites embedded with semiconductor particles for selective CO2-to-C2H4 photoreduction | [10.1038/s41929-025-01369-8](https://www.nature.com/articles/s41929-025-01369-8) | PDF + 多个 TXT | 正文经 WebVPN 或 iWAN；SI 直访。检查一个论文对应多个 SI 文件时的枚举、命名和打包。 |
| SpringerLink | Controllable synthesis of Bi@C nanocomposites for high-performance sodium-ion batteries anodes | [10.1007/s10853-026-13749-x](https://link.springer.com/article/10.1007/s10853-026-13749-x) | DOCX，约 1.1 MB | 正文经 WebVPN 或 iWAN；SI 直访。检查 DOCX 类型识别和扩展名保留。 |
| SpringerLink | Unlocking the hydrogen storage potential of K2NiH6: high volumetric capacity and near-ambient dehydrogenation via partial decomposition | [10.1007/s10853-026-13725-5](https://link.springer.com/article/10.1007/s10853-026-13725-5) | DOCX，约 9 MB | 正文经 WebVPN 或 iWAN；SI 直访。检查较大 DOCX 的进度、最终大小及完成状态。 |
| Science / AAAS | Covalent organic framework–based porous ionomers for high-performance fuel cells | [10.1126/science.abm6304](https://www.science.org/doi/10.1126/science.abm6304) | PDF SI + 2 个视频 | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。检查 Science PDF 预览器的右上角保存，以及多附件捕获。 |
| Science / AAAS | Oxygen- and proton-transporting open framework ionomer for medium-temperature fuel cells | [10.1126/science.adq2259](https://www.science.org/doi/10.1126/science.adq2259) | PDF SI | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。检查正文预览器完成后继续抓取 SI。 |
| Elsevier / ScienceDirect | Fe/Mn-MOF-driven rapid arsenic decontamination: Mechanistic elucidation of adsorption processes and performance optimization | [10.1016/j.jwpe.2024.106691](https://www.sciencedirect.com/science/article/pii/S2214714424019238) | Appendix A supplementary data | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。正文从 View PDF 进入预览器并保存；检查附录入口。 |
| Elsevier / ScienceDirect | Tubifex tubifex reduces antibiotic stress on nitrogen removal in constructed wetlands by reshaping microbial networks | [10.1016/j.jes.2025.11.038](https://www.sciencedirect.com/science/article/pii/S1001074225007521) | Appendix A supplementary data | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。检查 ScienceDirect 新版页面选择器和附件下载。 |
| ACS | Chiral Silica with a Helical Structure Formed Using Polymethacrylate-Functionalized Polyhedral Oligomeric Silsesquioxane with Hepta-Cysteine as Template | [10.1021/acs.macromol.5c00304](https://pubs.acs.org/doi/10.1021/acs.macromol.5c00304) | PDF SI，约 816 KB | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。正文 Open PDF 后保存；SI 从文章页直接下载。 |
| ACS | Endoplasmic Reticulum Stress Induces Liquid–Liquid Phase Separation of GRP78 and Modulates Protein Aggregation Dynamics | [10.1021/acssensors.5c00807](https://pubs.acs.org/doi/10.1021/acssensors.5c00807) | PDF SI，约 2.37 MB + 2 个 MP4 | 同上。重点检查不同附件类型、多文件进度和最终文件大小。 |
| Royal Society of Chemistry | Synthetic chemistry enabling the discovery and development of a series of pyrazoles as HPK1 inhibitors | [10.1039/D5MD00309A](https://pubs.rsc.org/en/content/articlelanding/2025/md/d5md00309a) | PDF SI，约 2.1 MB | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。正文点 PDF 后保存；SI 从文章末尾直接下载。 |
| Royal Society of Chemistry | A disilane-bonded bis(methylpyridine) Cu(I) complex exhibiting reversible trigonal–tetrahedral switch with stimuli-responsive luminescence | [10.1039/D5DT01893E](https://pubs.rsc.org/en/content/articlelanding/2025/dt/d5dt01893e) | PDF SI + CIF | 同上。重点检查 CIF 等非 PDF 附件不会遗漏或错误改名。 |
| IEEE Xplore | Review on Time Delay Estimate Subsample Interpolation in Frequency Domain | [10.1109/TUFFC.2019.2930661](https://ieeexplore.ieee.org/document/8770126/) | MATLAB 代码附件 | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。正文进入 PDF 预览器后保存；检查代码附件及可能出现的资源页面。 |
| IEEE Xplore | Structured and Sparse Partial Least Squares Coherence for Multivariate Cortico-Muscular Analysis | [10.1109/TBME.2025.3643890](https://doi.org/10.1109/TBME.2025.3643890) | 补充文档；站内入口需实测 | 正文和 SI 均经 WebVPN，或在 iWAN 下直访。用于检查新版 Xplore 页面、PDF 保存，以及 SI 入口缺失或变化时能否明确结束。 |
| Wiley Online Library | Ladder-Like Built-In Electric Field Enhances Self-Assembly, Carrier Separation and Ultra-Efficient Photocatalytic Oxygen Reduction | [10.1002/adma.202502918](https://advanced.onlinelibrary.wiley.com/doi/10.1002/adma.202502918) | DOCX，约 3.4 MB | 仅在 iWAN 可用时自动化或手动直访。检查正文订阅访问、DOCX SI 及状态监视；WebVPN 路径保持禁用。 |
| Wiley Online Library | Electron Percolating Shielded Interlayer Enabling Ultrastable All-Solid-State Lithium Metal Batteries | [10.1002/adma.202515687](https://advanced.onlinelibrary.wiley.com/doi/10.1002/adma.202515687) | DOCX，约 6.8 MB | 仅在 iWAN 可用时直访。检查较大 SI 的进度和最终大小，以及 iWAN 断开时的明确提示。 |

## 建议执行顺序

1. 先跑 Nature、SpringerLink，验证“正文需授权、SI 直访”的分流。
2. 再跑 Science、ACS、RSC、IEEE，集中验证 PDF 预览器二次点击保存。
3. 跑 Elsevier，验证 View PDF 与文章页附件入口。
4. iWAN 在线后单独跑 Wiley，避免把学校 WebVPN 对 Wiley 的问题误判成程序缺陷。

## 判定标准

- 未满足所需访问条件时，任务不得静默排队或一直显示“正在下载”；应打开相应登录/连接入口并说明下一步。
- 每个任务应能查询阶段、已下载字节、可得总字节、当前文件名和失败原因。
- 捕获完成后只保留进入文献包的文件，不应再留一份浏览器原始下载副本。
- 无 SI、SI 入口变化或附件格式未知时，应以明确状态结束，不得把正文成功误报为全部附件成功。
- 文件扩展名、MIME 类型、最终大小和页面标示相符；多附件不得相互覆盖。
