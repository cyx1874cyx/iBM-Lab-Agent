# PDF 处理结果协议修复（2026-10-08）

## 问题与根因

`lab_reader_translation_finish` 已写出有效 PDF，却报“PDF 处理返回无效数据”。真实原文恢复复现表明：保留链接时 PyMuPDF 输出 `skipping bad link / annot item 0.` 到 stdout；旧实现将整份 stdout 当作 JSON，因诊断前缀而解析失败。此问题不表示原文或译文损坏。

## 修改

四种 Python 操作（解析、排版、ZIP 清单、ZIP PDF 读取）统一输出单条 `IBM_READER_RESULT_V1:` 结果记录。宿主仅解析这一记录，容许独立诊断，拒绝缺失、重复、畸形结果及非零退出。现有源文件、译文与 PDF 完整性检查保留。恢复 finish 未传 notes 时保留已有核验备注。

产品提交：2a5c0ca。未修改上游 DSH NEXT、内核或前端。

## 验证

- 全套测试 838 项：830 通过，8 条原有条件跳过，0 失败。
- 真实失败任务在隔离副本完成：8 页，125 个翻译块，待翻译 0；译文、连续段落复核、备注、原文哈希均保持一致；实际库诊断重现后仍完成 PDF 登记。
- 8 页译文已渲染逐页检查，保留双栏、图和表；第 3、5 页图片译文字号偏小、第 4 页一处 4.4 pt 警告仍保留。
- p4-b3-1 推断和表 1 原文不一致的核验备注保留，不视为已解决。

## 交付与恢复

交付目录：C:/Users/admin/Desktop/iBM-Electron-PDF结果修复-20261008/。

完全退出 Electron 版（含托盘）后安装。让 Agent 恢复原翻译任务，再 prepare、pendingOnly 复核、finish；不必新建或重新全文翻译。隔离副本 PDF 为独立交付，不直接修改运行中课题数据或数据库。

证据目录：C:/Users/admin/AppData/Local/Temp/iBM-reader-protocol-fix-20261008/。
