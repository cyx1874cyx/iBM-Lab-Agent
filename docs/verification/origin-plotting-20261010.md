# Origin 作图流程验证（2026-10-10）

环境：OriginPro 2025b Academic，origin-mcp 0.1.4，嵌入式 originpro 桥接。项目 Skill `ibm-origin-plotting` 已接入已有第一方 Skill provider；真实注册表集成测试可发现并读取全文。Skill frontmatter 和引用链接校验通过。

## 通过的流程

- 合成数据81行、两条曲线，经真实 MCP 工具导入和绘图。
- 厘米单位；图层9×8.001cm（8cm设置的Origin界面取整）；Scale With Layer Frame。
- Arial名义标题36、刻度32、图例32；轴框3pt；曲线3pt、黑实线和蓝虚线。
- X为log10、20–200000Hz；Y为0–500ohm、步长100；底左刻度朝内，顶部右侧无刻度。
- 原生1800像素宽PNG和PDF导出；实际PNG视觉检查无裁切或重叠。
- 单独测试文件夹保存OPJU，再载入另一个测试文件夹，确认81行工作簿与图窗口存在。
- 保存OTPU到自己的输出目录，重新用模板生成两条曲线。
- 原生PowerPoint导出包含Origin95.Graph对象（类型7、实际embedding），在幻灯片视图激活成功。
- 原13个CSV只读核验：各801行、共用20–500000Hz网格、三列Z重复。

## 修正的操作流程

显式设定layer.unit并回读；不再将save -i产生OGGU解释为授权锁定；关闭无用途的自动末端数值；对数轴图例在最终尺寸和字体后重新定位；遇到MCP样式getter返回null，改用实测LabTalk getter验证；将PPT OLE验收与OPJU文件存在分开。

## 已知限制

OLE激活后关闭测试PPT会使本机Origin桥接/进程退出。首次测试开始时原项目只有空Book1，没有用户图或数据；随后重新启动Origin并恢复桥接，基础绘图回归再次通过。脚本现已在任何已有图、矩阵、图像或非空工作簿时拒绝--ppt，要求独立空会话，正式工程不能自动执行该生命周期测试。

本次覆盖单图层线图；不宣称多图层、拟合、分析等全部237个工具均完成验证，也不宣称之前13曲线Graph1完成验收。此处为流程与Skill完善，未打包或发布新安装包。

## 证据

基础完整回归：`H:/107-iBM-Agent/iBM-Agent/work/origin-skill-qa-20261010/regression-core/`，含tool-results.json、checks.json、PNG、PDF、OPJU、OTPU。
PPT激活：`H:/107-iBM-Agent/iBM-Agent/work/origin-skill-qa-20261010/verified/ole-checks.json` 与 editable-origin.pptx。
原输入核验：`H:/107-iBM-Agent/iBM-Agent/work/origin-skill-qa-20261010/input-audit.json`。

重跑：随包Python执行 `scripts/migration/verify-origin-plot-standard.py --output <独立目录>`；PPT测试额外加--ppt，仅限独立空Origin会话。输出检查须结合视觉验收。

## 模型工具挂载修复

用户现场反馈证明此前独立MCP验证不能代表科研会话：Electron预设没有加载Origin MCP客户端；应用注册表与full环境变量均不会主动挂载工具。

新增 `lib/origin-mcp.js`，通过科研预设 `lab-origin-mcp` 行在桌面形态加载，复用受管理的固定Python/guardian启动配置；异步等待初始tools/list就绪，非桌面不启动。补充受管理工作目录创建，避免新安装首次启动因不存在的cwd产生ENOENT。

真实DSH Cordis会话scope验证（非Python侧list_tools）：full模型SDK清单237项，包含ping/plot/set_axis/set_plot_style/export_graph/get_layer_info；成功通过stdio调用origin_list_project读取当前Origin。销毁scope后工具注销，未泄漏到其他会话。服务器形态不访问Python启动配置。预设组合、Skill发现和进程生命周期回归5项通过。

已将新模块、模块导出和科研预设写入本机安装的第一方插件，并安装作图Skill；保留备份在 `C:/Users/admin/AppData/Local/iBM-Lab-Agent-Electron/dsh/recovery/origin-mcp-mount/20261010-160435/`。用户profile自定义配置、对话与课题未改；未自动关闭当前对话。需重启桌面应用并开始新科研对话才能使用新预设工具集。本次不宣称已发布更新安装包。
