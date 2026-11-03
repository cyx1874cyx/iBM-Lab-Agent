# 实测流程与故障处理

## 环境与证据范围

2026-10-10，在 OriginPro 2025b Academic、Origin MCP 0.1.4、Origin 内置 Python 3.11 / originpro 环境实测。插件 full 工具集可使用专门的轴、样式和导出工具。测试通过真实 MCP 工具实现，经嵌入式桥接执行；不依赖外部 COM 重建用户项目。

使用独立 Project Explorer 文件夹和合成阻抗数据（81 行、一个频率列、两条曲线）。测试覆盖导入、作图、精确样式回读、原生 PNG/PDF 导出、OPJU 保存并重载、OTPU 模板保存并重建。原始工作簿保留，结束恢复原活动文件夹与窗口。此结论不是对之前 13 条曲线 Graph1 的验收；本次连接时项目中没有 Graph1。

## 实际阻抗输入格式

另对原13个CSV只读核验：每个801行数据，频率20–500000 Hz、网格完全一致，第4/5/6列Z完全相同。第1行是采集元数据，第2行才是表头；Time列是时间字符串，不可对整行强制float。选择第3列Freq作为X，仅一列Z作为|Z|，第7列dz为相位；相位不能与重复Z混为多条独立谱。先核对文件说明和单位再作图；本次只核对这些输入，未重做之前13曲线成品。

## 已验证的顺序

1. `origin_list_project`、`origin_list_project_folder` 记录项目、活动目录；LabTalk `type "IBM_ACTIVE=%H";` 记录活动窗口。先解决 `graph_not_found`，不能换个图继续。
2. `origin_create_project_folder` 使用唯一名称且 `reuse_existing=false`。`origin_plot` 输入明确表格和列号，采用返回的实际 graph_name。
3. `origin_set_axis` 设置科学口径。阻抗示例 X=log10、20–200000 Hz，Y=linear、0–500 ohm、步长100；这些仅是测试参数，不是所有数据的固定范围。读取 `verified` 和实际轴属性。
4. `origin_set_plot_style` 明确逐条颜色、线宽3 pt，测试 Solid=0、Dash=1。`origin_get_graph_info` 在本版本部分 line_width/line_style 返回 null，不能当成验证成功；用 `get <plot-range> -wp <variable>` 和 `get <plot-range> -d <variable>` 回读。
5. 如无科学用途，关闭自动末端数值：在指定图层 `range qaA=!1; set qaA -q 0;`，对每条曲线分别执行。0.1.4 的默认 line 路由会自动添加末端数值；多条密集曲线会重叠。禁用不是删除数据。
6. 轴框 thickness=3；底/左 `ticks=5` 表示主、次刻度朝内，顶/右 `ticks=0`。Y 的 minorTicks=3。对数轴通常按科学惯例使用每十倍区间的对数次刻度，允许偏离线性轴3–4个的建议并说明。
7. `layer.unit=3; layer.width=9; layer.height=8; layer.fixed=0;`，随后设置 Arial 和名义字号36/32/32。2025b 高度实测8.001 cm，为界面精度取整；使用绝对误差≤0.005 cm验收。不能猜毫米或英寸，也不能强制固定 factor=0.46。
8. 所有字体和尺寸完成后，重新定位图例。当前 MCP `inside_upper_right` 对数轴下会溢出边框，不能盲信。示例使用 `legend.x1=5000; legend.y1=480;` 指定左上角的轴坐标；此位置只适用于测试数据。根据真实数据和图例长度选择留白区并检查导出。
9. `pfit2l margin:=tight;` 后再次回读尺寸、字体、字号、轴框、曲线线宽、线型、范围；`origin_export_graph` 指定 graph_name 输出 PNG/PDF，检查文件、尺寸和实际内容。成功返回或非空文件不足以证明没有裁切。

## 保存和重载

- `save -i "...oggu";` 保存图窗口；OGGU 是可编辑图格式，不能以此推断“授权锁死”。
- 普通交付用项目保存接口产生 OPJU。保留用户当前项目的测试可用 `pe_save fname:="...opju" path:="<owned folder>" sub:=1 proj:=0;` 保存仅测试文件夹。
- 创建另一个唯一测试文件夹，`pe_load fname:="...opju" path:="<reload folder>";` 重载。核验包含数据工作簿与图窗口；不使用 `origin_open_project` 替换用户项目。
- `save -t <graph> "...otpu";` 可保存测试模板到自己的输出目录，`plotxy` 指定该模板和明确数据范围重建，检查图层与曲线数。模板不包含数据专属标题、坐标范围或最终验收保证，重用后再核对。
- 不得清除用户模板、结束用户 Origin 进程或改写授权文件来解决导出问题。

## PPT 编辑性

用已安装 Microsoft PowerPoint 测试。Origin 文档中的 `pef_pptslide export:=page insert:=embed ... srcf:="<own blank pptx>" dstf:="<own output pptx>";` 可导出活动图为 OLE 对象。注意 `insert:=embed` 才决定嵌入对象；`embed:=1` 的含义是包含 Origin 工作簿中的嵌入图，不是将输出设为 OLE。

**生命周期限制（实测）**：在本机 OLE 激活后关闭测试 PPT，Origin 桥接及 Origin 进程会退出。不得在用户正式工程里自动激活/关闭 OLE 测试。正式PPT原生导出后保留文件，OLE激活验收须在独立空 Origin 会话进行；不要承诺该步骤能恢复原会话。基础绘图/导出回归不执行 OLE 激活。

本机实测原生输出 `Origin95.Graph`，对象类型7，OLE激活成功（等效双击打开）；PowerPoint为2016。

PPTX 中必须有 OLE 关系/embedding，PowerPoint 对象类型应为7、ProgID为 Origin 图类，再在 slide/notes view 激活对象验证打开；仅预览图和一个 bin 文件不够。PowerPoint `OLEFormat.DoVerb` 在无窗口或非幻灯片视图会报 Invalid request，先打开独立测试 PPT 的窗口并切到 slide view，不可误判 Origin 不支持。

## 回归入口

仓库 `scripts/migration/verify-origin-plot-standard.py --output <absolute-owned-directory>`：使用桌面版随包 Python 运行，要求当前 Origin 桥接已启动。只创建测试对象，保留它们供复核，恢复原活动位置；不会重置项目。工具结果逐条写入 `tool-results.json`，结构和属性断言写入 `checks.json`。加 `--ppt` 可额外检查原生PPT导出、Origin OLE类型及激活；仅允许独立空 Origin 会话：如果已有图、矩阵或非空工作簿，脚本先拒绝执行。仍需人工/视觉检查输出，不得把脚本 pass 直接当作整张图完全合规。

## 一次失败后的处理

先读工具 error_code、桥接诊断和实际对象名，确认是否连接、参数、对象或文件路径问题。只做有依据的修正，限定尝试次数；同一错误连续发生时保留数据和日志，说明未通过项目，不进行无方向属性试探。没有完整原生导出、编辑性和视觉验收时交付“iBM-aligned draft”。

## 官方语义依据

- [Layer 单位、尺寸和缩放](https://docs.originlab.com/labtalk/ref/layer-obj/)
- [轴属性与刻度位掩码](https://docs.originlab.com/labtalk/ref/layer-axis-obj/)
- [窗口、项目、模板保存的区别](https://docs.originlab.com/labtalk/ref/save-cmd/)
- [文件夹保存](https://docs.originlab.com/x-function/ref/pe_save/) / [重载](https://docs.originlab.com/x-function/ref/pe_load/)
- [图形对象定位](https://docs.originlab.com/labtalk/guide/creating-and-accessing-graphical-objs/)
- [Origin 原生 PPT 导出](https://docs.originlab.com/x-function/ref/pef_pptslide/)
