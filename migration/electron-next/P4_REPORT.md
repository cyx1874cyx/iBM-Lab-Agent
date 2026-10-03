# Electron NEXT 迁移：P4 科研运行时检查点

执行日期：2026-10-03。状态：**运行时实现与隔离验收通过，P4 整体验收仍进行中**。承接 P3 提交 `f59b625`。

继续固定 iBM Lab Agent 0.5.8-rc.1、DSH NEXT v2.0.17-next、内核 0.2.0-rc.2、Electron 44.0.0、Python 3.12.11。没有以更新上游源码或更改核心 Python 锁替代兼容适配。

## 已实现与验证

- `ibmRuntime` 统一持有科研执行子进程、取消信号和桌面资源。Windows 守护进程在恢复子进程执行前加入 Job Object，停用与守护进程异常退出清理其子孙进程；独立进程不受影响。
- 独立 Electron 科研窗口使用隔离的持久分区、无 preload、沙箱和上下文隔离。窗口和机构弹窗共享科研分区；网页不能访问 Host、文件协议或任意桌面接口。
- 受认证本机命名管道连接 Host 与 Electron；网页没有该通道。窗口租约关联课题，释放窗口取消其待捕获任务。
- 已启用的一次性捕获接收真实 Electron 下载，验证 PDF/SI 类型和完整性，经 core 归档并登记哈希。下载令牌不交给科研网页。
- 固定 Origin/MestReNova MCP 启动规格使用官方 rc.2 MCP client 注册，禁止任意命令替换。Origin 发现 25 个工具，MestReNova 发现 4 个工具；本机 MestReNova 15.0.0.34764 和桥接脚本可用。
- 独立 Python 资源包含固定核心依赖及明确锁定的原生软件附加依赖；断网模拟运行、中文与空格路径迁移检查通过。旧 P1 Python 环境保留。
- Windows 系统凭据加密和旧 DPAPI 格式导入后重新加密通过合成凭据验收。没有读取真实用户 API Key，也没有向 Remote/模型返回解密值。

## 验证证据

| 项目 | 结果与位置 |
| --- | --- |
| 全量回归 | 797 个用例：789 通过、8 跳过、0 失败；`outputs/electron-next-p4-tests-popup-fix.log` |
| 新运行时静态检查 | 0 错误、0 警告 |
| 实际 Electron、MCP、加密 | 11 项隔离检查通过；`outputs/electron-next-p4/desktop-popup-fix/verification.json` |
| 断网 Python | `outputs/electron-next-p4/offline-smoke/verification.json` |
| Python 路径迁移 | `outputs/electron-next-p4/relocation-verification.json` |
| Python 文件清单 | `outputs/electron-next-p4/python-resource/resource-manifest.json` |
| 固定 NEXT 组合兼容 | `outputs/electron-next-p4/next-compatibility/run-ZAOOIJ/verification.json`；沿用 P3 组合验证器，不代表完整 P4 门槛通过 |
| Origin 真实软件联动 | 固定 rc.2 MCP client 连接用户启动的桥接；独立 CSV 导入、读取、导出数据一致，测试工作簿清理通过；`outputs/electron-next-p4/origin-workflow/verification.json` |
| MestReNova 真实软件联动 | 15.0.0.34764 处理明确标注的模拟 8192 点 FID，三条最强峰位与模型相符，导出 MNOVA/PDF/CSV，原始样例保持原哈希；`outputs/electron-next-p4/mnova-workflow/verification.json` |

证据目录均相对 `H:/107-iBM-Agent/iBM-Agent`。机构浏览器配置目录、Cookie 和凭据文件不作为可公开证据，不读取或导出。

## 真实机构验收与未通过门槛

用户指定中科大入口 `https://wvpn.ustc.edu.cn/` 和文献 `10.1126/scirobotics.aed1960`。已观察到入口到统一身份认证的正常跳转，以及用户操作后资源入口正常加载。

为加载捕获代码正常关闭并重启窗口后，真实中科大会话重新跳转至统一身份认证。**持久分区及持久 Cookie 的隔离测试通过，不能推导真实机构会话必定跨进程延续**。需区分会话 Cookie 与持久 Cookie，并继续验收；不以读取或复制用户 Cookie 修复。

用户随后明确确认重新登录。2026-10-03 18:17（北京时间）观察到中科大资源站点，18:19 观察到 WebVPN 路由中的目标 Science Robotics 页面，标题与 DOI 匹配。直接导航到同一 WebVPN 路径的 PDF 页面没有触发文件下载，用户从文章页点击下载后，18:21 完成真实 PDF 自动捕获和归档。

正文 PDF 为 6,542,032 字节、15 页，可正常解析，无加密；全文 DOI 和元数据标题均匹配。SHA-256 为 `1090dfd82cd1a0862b6c7f8a43240ad1a58cd1bb93e30cdf267f7d384164c480`。证据：`outputs/electron-next-p4/institution-acceptance/pdf-verification.json`。文件仅归档在隔离验收课题，没有写入用户旧资料目录。

18:28 确认补充材料 PDF 自动捕获完成：34,585,806 字节、57 页，可正常解析，无加密；标题与 DOI 均匹配。SHA-256 为 `839cd4f9af9dd2f6083c8373b8c0a47e8f9b6ab87540a2aace4090bd15d08762`。证据：`outputs/electron-next-p4/institution-acceptance/si-verification.json`。本轮下载范围为正文和补充材料 PDF，没有下载另列的视频、数据文件与 MDAR 清单。

真实下载出现空白新窗口；同时对该 PDF 页面执行链接检查超时。已在同一运行会话恢复主窗口至中科大入口，机构登录仍有效；没有再次重启或读取 Cookie。代码现已修复下载完成后关闭仅用于下载的空白弹窗，并给每个页面的链接检查设置 2 秒上限及下载链接优先级。真实 Electron 隔离测试确认下载弹窗关闭、机构弹窗保留；捕获类型切换作废上一任务并清理对应令牌。当前用户登录会话加载的是修正前版本，未为应用修正再次重启它。完整 PDF 预览体验仍待交互验收。

用户已启动 Origin MCP Bridge Start App，实际连接和样例数据往返通过。Origin 使用用户启动的 GUI，本轮只清理自己创建的测试工作簿和受管 MCP worker，未退出用户软件。MestReNova 由受管 MCP worker 启动并执行真实处理，任务结束后未发现遗留的 MestReNova 进程。样例由 nmr-analyze-simulate 技能生成，带 synthetic 标记，Varian 读回误差为零；预检选用固定 Python 3.12.11。仅验证软件处理和导出，未作化学身份或定量结论；自动拾峰产生许多弱峰，验证仅比较三条最强模型峰。

原生接口现支持保存取消、保存后读回哈希、PDF 预览、通过系统 PDF 应用打开以及文件定位。预览使用独立非持久沙箱分区，只允许私有暂存 PDF 与内部预览资源；外部打开只接受 PDF 文件签名，在验收 root 内导出副本，不开放任意路径/可执行文件启动。`verify-native-file-dialogs.mjs` 的首轮测试在第一个保存对话框等待操作超时（5 分钟），测试 Host 已退出，结果为未通过；尚未观察到保存、预览、系统打开或定位成功。无父窗口的保存调用现增加可见父窗口及正常关闭收尾，静态检查通过，需人工复测。没有把接口返回布尔值当成人工交互验收。

P4 尚有以下门槛：原生文件交互的人工验收结果及完整退出核对；真实机构登录生命周期及修正后下载窗口体验。完整产品 UI 接线与可选能力组合另属 P5。实时机构窗口继续保持打开，因此不能声称所有验收 GUI 已退出或所有运行进程均已清空。

本检查点不发布安装器、不迁移真实历史数据、不切换默认启动，也不宣布 P4 完成。待上述证据具备后更新本报告和可复现说明，再进入 P5。

## 2026-10-04 用户指定的后续安排

可见父窗口复测仍在首个保存调用等待操作超时，证据为 `outputs/electron-next-p4/file-dialogs-retest/verification.json`。用户表示没有看到弹窗，不能据进程窗口标题判定原生对话框可用。用户随后明确要求“这个不管了，接着干下一步”，因此暂缓此交互验收并进入 P5。该项没有通过，P4 未标记完成；真实机构登录生命周期与修正后下载窗口的交互证据也仍保留。P5 可独立推进插件包和 UI 组合，正式发行仍须处理或明确接受这些缺口。
