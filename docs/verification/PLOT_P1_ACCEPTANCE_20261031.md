# 科研绘图 P1 修复验收

验收日期：2026-10-31；最终同步：2026-11-01。应用：iBM Lab。

## 修复结果

| P1 缺陷 | 修改后的行为 | 最小复现与回归 |
|---|---|---|
| Excel 首页为空或说明页 | 先取得全部工作表名称；工作表、表头及数据预览独立于 AI/Origin。空页和过长的说明文字不会阻断工作表切换。 | `test_plot_p1_import.py` 生成 Empty / Notes / Measurements 工作簿，验证空首页、长说明及第二行表头；浏览器实际切换工作表后手动绘图。 |
| 非相邻、倒序列 | 条形和箱线图生成连续派生列，保持选定顺序及原列身份，原始数据不变；界面支持调整系列顺序。 | `tests/fixtures/plot-p1/nonadjacent.csv`，选择 Y=[4,2]。Origin 重开后首行分别为 [81,11] 和 [A,81,11]，逐项比对归档数据。 |
| 选图依赖 AI | 全部适用图型始终可选，AI 仅排序；推荐等待中可跳过，模型断连仍能手动生成和保存。 | `plot-main-flow.test.mjs`、`plot-p1.test.mjs`，涵盖无 AI、部分/无效推荐、取消等待，以及真实 Origin 无 AI 主流程。 |
| 预览卡顿与锁定 | 设置区支持批量输入，预览期间继续编辑、撤销和重做；后台合并待处理请求，前端拒绝过期结果，旧图片标为待更新；失败/超时可重试。图片及命中场景绑定同一预览版本。 | 浏览器人工控制乱序返回、失败重试、预览中保存；服务回归检查连续请求实际只运行首个和最后一个。 |
| 参数与成图不一致 | 七类图使用统一样式适配器。水平条形图新增屏幕 X/Y 与 Origin 内部轴的双向映射，包括范围、轴标题、图例坐标和画布选中类别。 | 真实工程重开后回读颜色、边框/填充色、宽度、线型、符号、范围、箱宽、分箱宽度；核验 SVG 实际颜色及图例文字。 |
| 负值柱状图缺零基线 | 自动范围同时纳入数据两端和零值；手动上下限不被覆盖。水平条形图同样处理。 | negative / positive / crossing / constant CSV；检查真实柱体处于图框内，零值柱体允许宽/高为零；检查实际物理数值轴范围。 |
| 保存、重开与历史 | 最新配置绑定对应完整产物；历史保留场景及预览元数据。「恢复原图」直接复用原 PNG/PDF/OPJU，确认后切换；「按旧配置重绘」另建草稿。保存/恢复使旧预览失效。 | 服务回归及真实 Origin 主流程；核对文件哈希与配置。恢复原图不增加绘图调用，重绘生成新文件，均保留此前正式版本直到确认。 |

## 真实 Origin 证据

所有测试只创建和移除自有 Project Explorer 文件夹，保留用户项目并恢复原活动目录/窗口。

- 15 个图型和数据边界用例全部通过。每个用例重新加载 OPJU、读取数据及属性、重新导出 PNG/SVG；重新导出的 PNG 与该版本归档预览的 RGBA 像素指纹完全相同。
  - 汇总：`H:/107-iBM-Agent/iBM-Agent/work/plot-p1-1793454948275/report.json`
  - 实际 Origin 工程、归档图和重开图路径逐项保存在汇总中。
- 实际业务服务完成无 AI 导入、非相邻倒序条形图、预览修改、保存新版、恢复原图、按旧配置重绘。三个工程重新打开均与各自的归档 PNG 像素一致。
  - 业务记录：`H:/107-iBM-Agent/iBM-Agent/work/plot-p1-workflow-1793454758063/workflow-report.json`
  - 重开验收：`H:/107-iBM-Agent/iBM-Agent/work/plot-p1-workflow-1793454758063/reopen/report.json`
- 保留 Origin 图和数据的增量会话另行验证条形图的连续改色、柱间距、线宽/线型、隐藏/恢复、最终保存及重开；保存后的工程参数和归档图片保持一致。
  - `H:/107-iBM-Agent/iBM-Agent/work/绘图测试数据-20261031/style-check-1793455195124/reopen/report.json`

仅检查接口成功或数值回读会遗漏空图。验收中曾发现水平条形图轴交换使柱体落在图框外；已修复，并新增实际柱体可见性检查。上述最终结果包含该修复。文字位置回读仍作为诊断使用，不能代替图像检查或声称出版排版合规。

## 自动回归

25 项 Node 单元/服务/浏览器回归、1 项真实数据解析集成回归、13 项 Python 回归通过，共 39 项；另有上述 19 次真实 Origin 工程重开及图片核验。

```powershell
node --test tests/unit/plot-main-flow.test.mjs tests/unit/plot-editor.test.mjs tests/integration/plot-p1.test.mjs tests/integration/plot-workspace.test.mjs tests/integration/plot-records.test.mjs tests/browser/plot-p1.test.mjs tests/browser/plotting.test.mjs
$env:IBM_PLOT_TEST_PYTHON='<随包 Python>'
node --test tests/integration/plot-table.test.mjs
& '<随包 Python>' -m unittest discover -s tests/python -p 'test_plot*.py'
node scripts/migration/verify-origin-p1.mjs
node scripts/migration/verify-plot-p1-workflow.mjs
```

本轮未扩展独立面板坐标、导出格式/分辨率选项等 P2 功能。

最终导入接口默认仅解析预览，确认工作表及表头后再选择手动图型或请求 AI 推荐；显式 `inspectOnly:false` 保留原自动推荐调用的兼容性。此默认行为及兼容路径的 6 项服务回归再次通过。

最终客户端已构建，领域包校验通过；后端及客户端共 16 个文件已同步到开发版 Profile 与随包运行时，并逐一校验 SHA256。重启 iBM Lab 后加载新后端。
