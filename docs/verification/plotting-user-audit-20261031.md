# iBM Lab 绘图功能：用户视角审查与修改计划

日期：2026-10-31。范围：当前 electron-next 工作区源码，不等同于正式安装包。

方法：检查导入、选图、编辑、预览、保存、Origin 外部编辑和历史恢复链路；运行已有相关测试和最小逻辑复现。本轮未操作用户的 Origin 工程，未对真实 Origin 执行新一轮端到端测试，未修改业务代码。

结论：优先修复结果可信度、版本保护和失败恢复，再扩展图型。P0 表示发布前必须解决的结果完整性问题；P1 表示核心流程阻塞或高频误导；P2 表示功能和效率改进。优先级不代表所有用户每次都会触发。

## 修改计划表

| 编号 | 优先级 / 证据 | 用户场景及不足 | 修改方案 | 验收标准 |
|---|---|---|---|---|
| 01 | P0 / 逻辑复现 | 结构核对已经发现差异，仍可保存并显示“已核对并保存 Origin 工程”。用户可能把缺系列、轴范围不一致的结果当成已验证结果。 | 保存前区分关键差异、排版差异、未验证项；关键数据/系列/轴差异阻止提交；排版差异展示明细并要求明确确认。两条保存路径共用一个检查器。 | 注入系列缺失、坐标范围不符时不能更新正式版本；未验证不得标为已核对；界面能查看核对明细。 |
| 02 | P0 / 代码确认，实机影响待复测 | 点击 Origin 工程打开的是归档原件。用户在 Origin 直接保存会改变其哈希，软件随后拒绝读取；应用也不能回读手工修改。重新生成又会采用旧配置。 | 打开外部编辑副本；提供“导入外部修改为新版本”；保留不可变原件。无法解析的对象允许作为外部版本保留，并明确画布的编辑边界。 | Origin 增加标注后保存，旧版字节保持不变；新版可回收、预览、重新打开；任何重绘不能悄悄丢弃外部修改。 |
| 03 | P1 / 代码确认 | Excel 首页是说明页时，没有数值会在保存 profile 前失败；工作表下拉框依赖 profile，用户无法选第二页的实验数据。Origin 未就绪也会在同一位置阻断数据检查。 | 拆分工作簿枚举、数据预览、Origin 准备；先持久化工作表清单，允许随时改选表头和工作表；Origin 预检失败提供恢复入口。 | 首页说明、首页空表、第二页有效数据均能切换；未连接 Origin 时仍能查看表格和完成映射。 |
| 04 | P1 / 校验逻辑复现 + 原生路径代码确认 | 水平条形图选择第 1、3 列，或箱线图选择第 2、4 列，前端允许，但原生路径要求连续列并报错。选择顺序也可能影响连续性。 | 生成仅用于 Origin 的连续派生列映射，保留源列身份；短期至少提前明确拦截不支持的映射。 | 非相邻列、倒序选择、多组选择都正确生成；读回确认列和值没有串列。 |
| 05 | P1 / 逻辑复现 | 全负数柱状图自动范围为负值最小值到负值最大值，零基线在图外，柱长比较可能误导。水平条形图同理。 | 柱/条形图的自动数值轴同时包含零；手工截断允许但应提示。记录自动/手工范围来源。 | 全负、全正、跨零、常量数据均正确；全负 [-9,-2] 自动范围包含 0；手工轴范围不被无提示重写。 |
| 06 | P1 / 代码确认 | 修改参数触发 Origin 往返，并锁住继续编辑、撤销和保存；一次慢预览让整个编辑过程停顿。预览失败保留旧图时，状态文案仍可能显示“Origin 图片已更新”。 | 允许继续累积编辑，采用最新请求覆盖；状态严格按当前配置哈希判定；旧图显示“旧版本/待更新”，提供取消、重试和超时恢复。 | 慢请求、失败、快速连改、撤销、关闭重开场景不永久锁定；旧图绝不显示为当前配置已更新。 |
| 07 | P1 / 代码确认 | 用户只能从 AI 返回的图型里选择；规则降级往往仅一项。重新推荐失败也没有首次导入的同等降级保护。 | 常驻显示所有适用图型，AI 只排序和解释；数据识别与模型推荐分离；失败保留可用选项。 | 模型断网、返回单一图型、格式错误时，用户仍能手动选全部适用图型并作图。 |
| 08 | P1 / 代码确认 | “恢复历史版本”只恢复配置，之后重新渲染，没有恢复已归档的实际图片/OPJU；历史精修的实际工程不一定能由配置重现。 | 区分“查看/恢复原产物”和“使用历史配置重绘”；优先将历史原产物恢复为待确认版本，保留来源和核对记录。 | 历史恢复后的 PNG/PDF/OPJU 哈希等于所选版本；重绘另存新版本并明确标识。 |
| 09 | P2 / 已确认能力缺口 | 一列混入 NA、ND、单位行就可能整体变成类别；用户只能回原文件整理。日期不能直接用作连续时间轴。 | 导入预览允许选择编码、分隔符、缺失值标记、列类型和单位行；显示转换前后与受影响单元格；不静默删除数据。 | NA、ND、空白、科学计数法、日期、中文仪器表头都有明确解释；原文件不变，转换记录可追溯。 |
| 10 | P2 / 已确认能力缺口 | 误差棒和重复实验统计口径缺乏显式配置；多面板仅按同一文件的 Y 列拆分，共用坐标配置，不能组成常见论文复合图。 | 用户明确指定 SD/SEM/CI 或误差列；显式设置箱线和分箱口径；支持跨条目组合及独立/共享面板轴。 | 不擅自推断统计含义；输出可追溯统计定义；不同量纲面板可以独立设置。 |
| 11 | P2 / 代码确认 | 导出仅直接提供 PNG/PDF 下载，PNG 宽度固定 1800 px，缺少最终版面尺寸、DPI、TIFF/SVG 等交付设置。 | 统一导出面板，提供尺寸、分辨率和格式选项；联动校验字体与实际尺寸；导出附带配置。 | 选定尺寸及 DPI 与产物一致；导出的 SVG/PDF 可检查可编辑性；预览与交付文件版本一致。 |
| 12 | P2 / 代码确认 | 绘图列表缺少显式删除/归档和任务取消入口；文件重试和多版本会不断积累。文档仍混有多个已废弃流程。 | 增加安全归档、取消、失败重试、磁盘占用提示；区分移除登记与删除文件；用当前流程重写帮助。 | 取消不破坏已保存版本；归档可恢复；用户可以理解文件保留范围和草稿/正式版本差别。 |

## 建议实施顺序

1. 第一批：01、02、03、04、05。保护科学结果及已有劳动，修通核心导入和绘制流程。
2. 第二批：06、07、08。建立连续编辑、模型失效可用、历史可信的工作流。
3. 第三批：09–12。依据实际科研数据优先级补导入、统计、多面板与交付能力。

每批完成后，以合成数据运行真实 Origin 的生成、保存、重载读回和导出核验；界面测试使用慢请求、断连和重启故障注入。不得只凭 API 返回成功或文件存在认定绘图正确。工期需结合 Origin 往返能力验证后估算，不承诺未经验证的天数。

## 证据定位

以下路径均相对于本源码仓库。

- 01：`lib/plot-workspace.js` 194–200、228–240：计算/保留 consistency，但保存仅检查 collision；`client/src/components-plotting.js` 未呈现 consistency 明细。`src/plot/consistency.js` 明确提供 differences/unverified 状态。
- 02：`electron-next/origin-open.mjs` 10–15 打开真实归档路径；`lib/plot-workspace.js` 322–327 校验旧哈希；2026-10-30 功能文档明确未实现手工编辑回读。
- 03：`lib/plot-workspace.js` 85–98 先 prepare、initialPlot，再存 profile；`client/src/components-plotting.js` 140 的工作表列表来自 profile；空表会在 `inspect_table` 更早报错。
- 04：`src/plot/workspace.js` 的 validatePlotSelection 接受非相邻数值列；`scripts/runtime/plot_job.py` 226 附近对数字 plot_type 要求 selected 连续。
- 05：`src/plot/workspace.js` 的 materializeNumericAxes 仅对 lo 使用 Math.min(0,lo)，未对 hi 使用 Math.max(0,hi)。
- 06：`client/src/components-plotting.js` 168–181、189、197：预览锁、旧预览 fallback 及状态文案。
- 07：`client/src/components-plotting.js` 145–146 只呈现 recommendations；`lib/plot-workspace.js` 96–118 首次和重新推荐的失败处理不一致。
- 08：`lib/plot-workspace.js` 310–313 只调用 plotEdit(version.spec)，没有恢复 version.artifacts。
- 09：`scripts/runtime/plot_job.py` inspect_table：keep_default_na=False、na_values=['']、整列 numeric 判定；`src/plot/workspace.js` 数值 X 限制。
- 10：`src/plot/editor.js`、`src/plot/workspace.js` 的配置契约；当前多面板字段没有每面板独立坐标配置。
- 11：`client/src/components-plotting.js` 107–108；`scripts/runtime/plot_job.py` 322–366 和 `scripts/runtime/plot_session.py` 固定导出宽度。
- 12：当前 PlottingPanel 操作入口；后台存在 plot_records_remove，但绘图列表没有对应按钮。

## 本轮验证记录

已有测试命令：

```text
node --test tests/unit/plot-editor.test.mjs tests/unit/plot-progress.test.mjs tests/integration/plot-workspace.test.mjs tests/integration/plot-records.test.mjs
18 passed, 0 failed, 0 skipped
```

额外最小逻辑复现（在内存构造 profile 和服务边界，不调用 Origin）：

```text
bar: selected=[0,2], validatePlotSelection accepted=true, nativeContiguous=false
box: selected=[1,3], validatePlotSelection accepted=true, nativeContiguous=false
negative column axis: min=-9, max=-2, step=1.4
cover-sheet initialPlot: 没有可绘制的数值列，请检查工作表、表头及数据格式
save draft with consistency=differences: status=completed, stage=已核对并保存 Origin 工程
```

这些结果证明校验和保存逻辑存在缺口，不证明某次真实 Origin 已经生成错误数据。02 的外部保存影响、06 的故障交互、复杂统计图导出仍需使用隔离工程做实机回归。现有测试通过不能覆盖上述风险。
