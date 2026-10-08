# 2026-10-08：竖排原文导致全文翻译 PDF 合成失败修复

产品代码 c920d12。DSH NEXT v2.0.17-next / 内核 v0.2.0-rc.2 / Electron 44 / iBM 0.5.8-rc.1 均保持。

## 原因与修复

真实失败文献 Characterising acute ischaemic stroke thrombi 共 11 页。实测第 1 页摘要 p1-b9-1 可正常排入；真正失败块是 p1-b12-1，每页右侧版权通知，原方向 dir=(0,1)，框约 21×591 pt。旧脚本用横排放入竖框，所有 11 页的同类块都失败。5 pt 原本只是警告阈值，不是硬拒绝检查。

合成按原 PDF 文字方向处理 0/90/180/270°；竖排保留原框，不沿横排方向扩展。保留原 scale_low=0.35，不降低字号约束、不删除原文块、不跳过图片文字。失败提示加入块编号、框尺寸与方向。PDF 排版版本升级至 3，完成的旧版译文可重新合成；无需调用模型重新翻译。

## 验证

- 837 项测试：829 通过、8 跳过、0 失败；新增真实四方向 PDF 回填回归检查。
- 官方壳最终包内验收 37 项通过，含侧栏/全屏双语中竖排版权文字绘制和文本层，保留既有滚轮、上传、RIS、捕获、宠物与重启验收。
- 真实失败任务副本执行 create→prepare→pendingOnly=0→finish→readerOpen，340/340、11 页、layoutVersion=3，无警告。译文映射、原文 SHA256、11 组连续段落复核记录均未改变。没有重新翻译。
- 用 Poppler 渲染最终 11 页并检查版面、表格与边缘竖排文字。原课题、原译文目录与运行中数据库未写入；仅恢复到隔离副本，提供可直接打开的最终中文 PDF。

## 交付

安装包：C:\Users\admin\Desktop\iBM-Electron-PDF排版修复-20261008\iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe

中文 PDF：C:\Users\admin\Desktop\iBM-Electron-PDF排版修复-20261008\Characterising acute ischaemic stroke thrombi-中文保留版式.pdf

完全退出 Electron（包括托盘）后覆盖安装。原条目点击翻译恢复任务，让 Agent prepare 后调用 finish 完成应用内登记；已有译文和联合复核记录可复用，无需从头翻译。请勿只把 PDF 放回目录冒充状态登记。

包和 PDF 的大小、SHA256 见 delivery.json；恢复与窗口证据同目录。C 盘完成本轮归档、资源复制和官方 NSIS 压缩；H 盘空间紧张，未清理旧项目或旧安装包。
