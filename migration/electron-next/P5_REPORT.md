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
| 全量回归 | 798 个用例；790 通过、8 跳过、0 失败；`outputs/electron-next-p5-tests-checkpoint.log` |
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

1. 将旧壳消息桥中的科研浏览器、下载/预览及文件动作接到新 Electron provider 的正式 UI；本轮是基础课题及插件组合验收，不代表这些按钮已全部对齐。
2. 用有真实条目/精读/PPT/合成/表征记录的隔离样例，对照 0.5.8 验证平铺操作、独立任务状态、所有页签、浏览器与全屏面板让位以及关闭后不恢复已关闭 tab。当前截图是空资料课题与核心记忆，不代表完整截图回归。
3. tgz 和共享实现的干净环境安装、失败更新恢复以及退出超时原因复核。安装器、真实历史数据迁移和发行签名属于 P6，尚未执行。

P4 暂缓项继续保留；不恢复该弹窗等待，不要求用户再次操作。当前检查点不切换默认启动、不发布安装器、不宣布 P5 完成。
