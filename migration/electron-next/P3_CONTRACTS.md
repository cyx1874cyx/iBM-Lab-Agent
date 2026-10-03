# P3 服务、仓储与通知契约

## 组合依赖

| 组合 | 必需基础组合 | provider / 新 Remote | 业务所有权 |
| --- | --- | --- | --- |
| core | 无（宿主存储等公共服务除外） | ibmCore / 历史 lab | 课题、记忆、绑定、共享文件和唯一 lab_tasks 域 |
| runtime | core | ibmRuntime / labRuntime | 受管执行器、环境事实、转换与 PPT 执行；版本/Python 等叶服务 |
| documents | core + runtime | ibmDocuments / labDocuments | 明确输入的文档构建、审核、模板与转换服务 |
| literature | core + runtime + documents | ibmLiteratureWorkflows / labLiteratureWorkflows | 检索、来源包、精读、审核、汇报编排及捕获叶服务 |
| design | core + runtime | ibmDesign / labDesign | 设计目标、化学、合成证据与实验模板叶服务 |
| analysis | core + runtime | ibmAnalysis / labAnalysis | NMR、作图记录、表征叶服务 |

配置来自 `bundles/*.patch.yml`；目录为 `bundles/catalog.json`。各组合的 Web/LLM/技能等宿主能力仍按原叶服务声明提供。轻量集成环境缺少这些宿主能力时，对应叶服务等待依赖，独立核心业务依然可用。完整 NEXT 验证覆盖实际宿主组合。

根 `cordis.patch.yml` 保留全量兼容安装，P3 的分域配置是组合入口而非独立发布包。预设工具显式注入各自 provider；捕获工具使用可选子上下文。

## 数据与兼容

core 继续独占历史 lab_tasks 域（8 表、schema version 0）。literature 的仓储视图只提供 searches/bundles/reports/presentations/provenance，不持有 projects/memories/sessions。design/analysis 保持原领域表与存储域。documents 接收 report、bundle、workspacePath 和可选已生成文件，不打开文献存储。

core 提供历史报告、演示稿、审核和来源文件读取；文件名、路径、审核状态和哈希校验规则沿用旧实现。旧 labTasks 保持模块导出与方法集合，通过 core 或 literature 委派。旧 lab Remote 保持 157 个标记接口，缺席业务返回 feature-unavailable。新命名空间复用原请求签名。

## 源文件变更

`sourceChangedSchema` 版本 1：projectId、bundleId、kind（pdf/si）、previousSha、sha256。

1. workflow 将来源快照交给 core.commitSourceBundle。
2. core 验证改变后的已登记文件及 SHA-256，成功后写入共享记录。
3. 哈希发生改变后通知订阅者；消费者此时能读到新记录。消费者失败记录警告，不撤销已提交来源。
4. synthesis 按来源哈希使 ready 证据失效；启动时重新比较持久化证据与当前来源，覆盖停用期间的变化。
5. core 的文件读取验证实际内容，外部篡改不能靠未变的登记哈希绕过。

这是进程内通知契约；并不提供持久队列或跨进程投递。消费者停用会取消订阅，core 停用清空订阅。

## 执行与卸载

runtime.createExecutor 返回受保护执行器；异步调用登记为 pending，停用先阻止新调用，再等待已有调用收尾。持有旧执行器不能在恢复后的新 provider 上继续运行。转换、PPT 和环境探测通过同一执行边界。

原生进程的终止策略、浏览器会话隔离、科研软件自动化与离线资源属 P4；独立包版本、安装卸载及可选 UI 属 P5；旧数据对账与回滚属 P6。
