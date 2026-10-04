# Electron NEXT 迁移：P5 插件与 UI 检查点

执行日期：2026-10-04。状态：**独立激活包与基础 UI 组合验收通过，P5 完整交互对齐仍进行中**。承接 P4 提交 `03e26e8`。用户指定暂缓原生保存弹窗验收并继续下一阶段；P4 未标记完成。

输入继续固定为 iBM Lab Agent 0.5.8-rc.1、NEXT v2.0.17-next、内核 0.2.0-rc.2、Electron 44.0.0。没有修改 NEXT 或内核，也没有导入用户历史课题。

## 本轮交付

- 生成 core/runtime/documents/literature/design/analysis 六个 Host 包和 UI 包，各自拥有 bundle、入口和依赖声明。39 个 Host 行无重复。七个包统一依赖固定共享实现库 `dsh-lab-agent@0.5.8-rc.1`；没有复制公共实现，也没有宣称资源已物理拆分或瘦身。
- 官方 NEXT package runner 在独立 home 安装七个本地 link 包，未激活完整兼容 bundle。当前包为本地私有制品，没有发布到 registry。
- 新增 `lab/capabilities` 并同步客户端描述符。每次读取实际 provider 状态，不以 Python 环境变量猜测某个领域或科研桌面可用。
- 课题空间不再强制依赖全部领域。core-only 下可查看和更新记忆；未启用页签禁用，保持已有布局。主页根据能力查询默认目标/模板；缺少领域时可以建立基础课题。
- 模板管理不再查询未启用的模板类别。UI 卸载通过 Cordis effect 清理面板、品牌入口绑定与样式，重新启用恢复入口与单份样式。品牌注入的待执行回调在停用后不会重新插入元素。
- 产出七份 tgz，并只读验证导出文件、patch、固定共享依赖、Host 行唯一性、无 node_modules 和 SHA-256。tgz 尚未在干净机器完成安装验收。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| 全量回归 | 800 个用例；792 通过、8 跳过、0 失败；`outputs/electron-next-p5-native-tests-final.log` |
| 组合集成 | core-only、独立设计、独立分析、独立文献、完整组合再恢复 core；数据及能力事实一致 |
| 描述符 | 新 capability 方法、调用参数和 Host 实现一致；旧 Remote 方法保留 |
| 真实 NEXT | 在线停用五个领域、恢复、每个 provider 仅有一行、Host 重启后记忆保留 |
| UI | 宽 1360 和窄 600，两种主题；实际打开主页与课题，检查无横向溢出；core-only 禁用页签和记忆抽屉可用；无 pageerror |
| UI 重载 | 停用后面板和入口绑定清除，再启用可点击入口；样式只有一份 |
| 包更新样例 | 只在隔离 staging 中给 UI 包添加 `+p5.fixture.1` 元数据版本，再经官方 runner 更新和回退；核心数据保留。不是实际 iBM 发布升级 |
| 构建一致性 | client、领域组合与独立包生成检查通过；新脚本与生命周期代码静态检查 0 错误/警告；扩展到历史组件有 2 个既有未使用参数警告 |
| 本地包结构 | 七份 tgz，39 个唯一 Host 行，结构及哈希通过 |

最终真实运行证据：`outputs/electron-next-p5/final-checkpoint/run-1I4diF/verification.json`。截图及 Host 诊断同目录。结果清单见 [P5_VERIFICATION.json](P5_VERIFICATION.json)。路径相对 `H:/107-iBM-Agent/iBM-Agent`。

UI 退出复测中曾有一次 Host 已确认 shutdown，但未在 NEXT 的 10 秒窗口内退出，随后被 NEXT 终止。保留失败证据 `outputs/electron-next-p5/ui-dispose-fix/run-dVSrra/verification.json`。追加只记录句柄类型的隔离诊断后，诊断轮、更新回退轮和最终轮均正常结束；未找到那次超时的根因，不宣称异常已彻底消除。后续安装/退出验收仍需覆盖此项。

## 尚未完成的 P5 门槛

1. 科研浏览器正式 UI 已接线并通过实际 NEXT 按钮操作。产物保存、预览、系统打开、RIS 导出和已保存文件定位已接线；PDF 预览通过真实 Electron，其余文件动作仅通过接口样例验证。保存对话框按用户要求暂缓，Office 系统打开和旧 WebVPN 侧栏入口的完整对齐仍待验收。
2. 有记录的隔离课题已覆盖三页签、平铺文献操作、精读/PPT 独立按钮状态、绘图登记修改和数据保留。仍需覆盖已生成 PPT、Office 全文预览与审核、长路线事实核验和锁定、浏览器与全屏面板让位及用户真实历史课题的完整 0.5.8 对照。不能把软件状态样例当作真实科研任务运行证明。
3. Windows 新 profile、空缓存、完整本地 tgz 集合安装及两类失败更新的受控恢复已通过。此前退出超时根因仍待复核；发行安装器的自动回退、真实历史数据迁移和签名属于 P6，尚未执行。

P4 暂缓项继续保留；不恢复该弹窗等待，不要求用户再次操作。当前检查点不切换默认启动、不发布安装器、不宣布 P5 完成。

## 科研桌面接线检查点（2026-10-04）

新增受限的 `desktop_status`、`desktop_browser`、`desktop_artifact` Remote 接口和正式客户端适配器。窗口按课题复用，只有用户明确打开/捕获时创建；状态轮询不会创建窗口。捕获的重建、取消和 PDF/SI 按钮使用同一科研服务。停用 runtime 时返回不可用状态，浏览器模式的原有下载回退仍可使用。

文件操作只接受已登记的产物引用，Host 本地重新校验内容，不接受任意路径或外部下载 URL。保存、预览和系统打开通过私有通道临时传递内容，结束后丢弃暂存副本；已保存文件定位使用不透明引用。DOCX/PPTX 系统打开前检查 Office 包。RIS 只接受限定文本体积和合法 `.ris` 文件名。没有向科研页面添加 Node、preload 或捕获凭据。

真实 Electron + rc.2 Gateway + 正式客户端适配器验收：窗口复用、阻止本机文件导航、捕获替换与旧任务取消、实际下载登记内容一致、PDF 独立预览、关闭后轮询保持关闭。证据 `outputs/electron-next-p5/native-ui-actions-run3/verification.json`。该验证不代表保存弹窗或 Office 系统打开通过。

正式 NEXT UI 验收证据 `outputs/electron-next-p5/native-formal-ui/run-mlWlPb/verification.json`：按钮打开/显示/前往/关闭确实控制独立 Electron 窗口；1360/600 两种宽度和明暗主题无横向溢出；领域停用恢复、UI 重载、Host 重启、更新回退均正常。已检查宽屏浅色及窄屏深色截图。所有测试采用新隔离 profile 和本机 HTTP 样例，不重启真实机构会话，也不读取 Cookie。

本轮验证脚本初版曾误将 YAML 空数组与新增 patch 拼接，导致两次隔离 Host 启动失败；已修正且保存失败证据。真实 Electron 下载样例初版直接导航附件返回通用导航失败，随后 PDF 填充放在 EOF 之后被校验拒绝；改为下载页面及 EOF 前填充后完整验收通过。未放宽生产文件校验。

现有 `outputs/electron-next-p5/packages` 的 tgz 是上一检查点制品，不包含本轮 UI 接线；本轮七包源码及编译客户端已同步，尚未重新发布或声称完成干净安装。P5 保持进行中。

## 有记录课题验收检查点（2026-10-04）

独立的测试包在新隔离 profile 内登记 1 条检索、1 份真实可读的 PDF 样例、3 条精读状态（待审核/进行中/失败）、3 条 PPT 状态（失败/待处理）、1 条目标及单步骤路线、1 条绘图登记和 1 条失败绘图任务。精读 DOCX 是明确标记为软件样例的真实 OOXML 容器；没有生成科研结论，也没有执行 LLM、Origin 或 Mnova 任务。

正式 NEXT 界面逐个打开文献资料、研究设计、表征分析，在 1360/600 宽度及明暗主题下截取 12 张页签截图并检查横向边界。核对三条精读的平铺操作及其 PPT 状态互不覆盖，实际点击展开/收起简介；在表征页实际编辑绘图主题并保存，随后从 Remote 读取核对持久化结果。已人工检查三页签窄屏深色截图。长页面仍按原有面板滚动，不宣称单张截图展示全部条目。

将记录标识、状态、绘图主题及日期做成快照，领域停用恢复后、Host 重启后、UI 包样例升级及回退后分别比较，全部一致。最终证据 `outputs/electron-next-p5/populated-final/run-d53DQX/verification.json`，同目录有截图和 Host 日志。额外领域组合回归 4/4 通过：`outputs/electron-next-p5-populated-domain-tests.log`。本轮仅修改验收脚本和文档；产品源码没有变化，上轮完整回归 792 通过/8 跳过/0 失败仍为产品检查点结果。

初版验收插件使用兼容包目录下的 file URL，NEXT 将其归属到 `dsh-lab-agent`，同时加载兼容客户端与独立 UI，触发 `lab/capabilities is already mounted`。通过临时隔离诊断查明后，把验收插件复制到只有最小 package.json 的新测试包，不向产品加入重复注册的绕过规则。诊断入口未留在最终验收的客户端或 staging，失败证据保留在 `outputs/electron-next-p5/populated/`。另修正了初次引导按钮等待的竞态和把检索行计入精读行的验收选择器。隔离 Edge 禁用扩展，避免自动安装扩展打开额外页面影响截图；不修改用户浏览器。

本轮七个产品包仍是本地 link 安装；干净环境 tgz 安装、失败更新恢复和既往退出超时根因复核尚未通过。P5 保持进行中，P4 保存弹窗仍按用户要求暂缓。

## 空缓存离线安装与失败更新检查点（2026-10-04）

八份产品制品已重新打包：七个领域/UI 包和固定共享实现。为避免 semver 范围选择未验证的新依赖，追加归档当前已安装且已验证的全部依赖闭包，合计 81 份 tgz。清单及 SHA-256：`outputs/electron-next-p5/clean-offline-archives-v2/release-archives.json`。没有上传或发布包。保留许可证和已有构建文件，不执行依赖包的生命周期脚本。包管理器使用固定 NEXT 自带的 pnpm 11.8.0。

81 份归档均完成只读核对：大小及哈希、manifest 身份和版本、路径边界、只允许普通文件/目录、包内 JSON 可读取。所有 `@deepseek-ai/dsh-*` 都是 0.2.0-rc.2，Cordis 是 4.0.4。七产品包的独立结构和 39 个唯一 Host 行再次通过。归档内容检查结果位于同目录 `archive-verification.json` 和 `verification.json`。

官方 package runner 在新 profile 与新空 store 中以 `--offline --ignore-scripts` 安装。依赖以 `pnpm-workspace.yaml` 的本地归档覆盖固定，并且未激活共享库的完整兼容 bundle。七包和共享库解析路径均在新 profile 内，没有通向开发目录的 link/junction。固定 NEXT/Electron 运行时另行提供；此结果不等于完整 Windows 安装器或未装运行时的裸机验收。

正常安装后再次覆盖正式 NEXT 的基础 UI、1360/600 两种宽度及明暗主题、在线停用恢复、core-only 记忆、UI 重载和 Host 重启。两类更新故障：

- 故意损坏的 tgz 被安装器拒绝；package.json 和 lockfile 保持逐字节一致，旧 UI 版本及核心记忆重启后可用。
- 隔离测试包 `0.5.8-rc.1-p5-failure-fixture` 安装成功，但 UI apply 明确抛出预设错误。实际浏览器确认科研 UI 未激活；重新安装原始 tgz 并重启后，可打开课题空间，核心记忆版本保持 v2。已检查恢复后的截图。该受控流程证明原制品可恢复，不代表发行系统已有自动回退。

最终结果：`outputs/electron-next-p5/clean-offline-install-final/run-48D6XO/verification.json`，同目录保留被拒更新日志、预期失败截图、恢复截图和 Host 日志。相关回归 5/5 通过（新增硬链接归档回归 + 四项领域组合）：`outputs/electron-next-p5-clean-install-tests.log`。本轮没有修改产品服务/界面或 NEXT；既有完整回归仍是上一产品检查点结果，没有把局部用例记作新一轮全量通过。

失败证据完整保留：首次旧配置被 pnpm 11 忽略，随后宽版本范围选择缺失的 zod tarball；改用完整归档后发现 Windows 包缓存硬链接被 tarfile 写成硬链接记录，而当前解包器形成零字节的嵌套 package.json。归档器改为写出实际普通文件，新增回归确保硬链接输入的两份 metadata 都能读取。还修正故障样例版本的 build metadata 被 pack 规范化、测试浏览器重复创建目录及旧调试端口残留的问题。仅清理本轮失败测试 profile 对应的 Edge 进程，真实机构浏览器和用户窗口保持原样。

P5 的 Office/PPT 全操作、长路线事实核验、全屏与浏览器让位和历史数据对照仍未完成；P4 保存弹窗继续暂缓，不标记通过。当前不切换默认启动、不发布安装器、不宣布 P5 完成。
