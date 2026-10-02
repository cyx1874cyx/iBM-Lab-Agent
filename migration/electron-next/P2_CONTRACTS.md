# P2：core、契约、仓储与兼容入口

执行日期：2026-10-03。此阶段建立代码和服务边界，独立领域包、UI 可选能力与正式安装迁移继续在 P3–P6 完成。

## 所有权与依赖

| 入口 | 职责 | 必需依赖 |
| --- | --- | --- |
| `dsh-lab-agent/core` / `ctx.ibmCore` | 唯一打开/关闭 `lab_tasks`；课题、记忆、工作区/会话绑定、产物定位、溯源、审核凭据校验与只读历史 | `storageDomain` |
| `dsh-lab-agent/contracts` | ID、文件名、Zod 模型、状态与键规则；无 Cordis、存储、Electron 或业务服务依赖 | Zod |
| `dsh-lab-agent/repositories` | 既有 8 张表的访问包装、按域视图、历史只读视图；不打开数据域 | 调用方提供的存活域访问器 |
| `dsh-lab-agent/tasks` / `ctx.labTasks` | 历史方法兼容；解析目标/模板快照，保留现有文献/报告/PPT 工作流 | core 与既有目标、模板、笔记模板、版本服务 |
| `dsh-lab-agent/remote` / `lab/*` | 保留 157 个 Remote 标记与单 `request` 参数约定，调用时查找可选业务服务 | core |

core 不导入任务编排器、SkillExecutor、Python 环境或领域服务。业务 schema 在纯 contracts 中属于数据协议，不会启动业务。P2 仍使用同一根包提供这些子入口；P3 再形成实际的领域服务/工具边界，发行包独立安装在后续阶段验收。

`lab_tasks` 仍为 schema version 0，沿用 `lab_projects`、`project_memory_versions`、`project_sessions`、`literature_search_runs`、`paper_source_bundles`、`reading_reports`、`presentation_runs`、`artifact_provenance`。不搬库、不重新编号、不重生成历史快照或产物哈希。

## 课题与配置

core 的 `createProject({ id, name, coreMarkdown?, memoryChangeNote?, goalProfile?, template? })` 接受显式的历史快照引用，也允许无科研目标/PPT 模板的新课题。core 存储模型仅把这两个引用改为可选，其余字段保持原规则。

历史 `labTasks.createProject` 继续接受 `goalProfileId/Version`、`templateId/Version`，解析并校验严格的 `labProjectSchema` 后委派 core。原 `src/task-models.js` 通过重导出保留导入路径；`labProjectSchema` 的两个引用仍为必填。旧 rows、版本字符串、记忆 SHA-256 和 `项目记忆.md` 文件格式不变。

向前读取旧数据兼容，不代表旧版能读取新增的无科研引用课题。原 0.5.8 的严格模型不能读取这种新行；P6 的回滚必须保留原数据副本并隔离迁移目录，不能把新数据目录直接交回旧版。基础课题补齐科研配置后的工作流启用和 UI 能力处理还需 P3/P5 完成。

项目目录和默认科研预设属于 core 的配置。根 bundle 已把 `projectsRoot` 放入 `ibm-core` 行。有自定义路径的旧 profile 必须在升级配置时把该值同步到 core；P6 才处理真实安装配置的迁移。本阶段未部署到用户旧 profile。删除仍必须严格匹配所配置根目录下的 `<projectId>` 路径；路径不一致时拒绝删除，不能放宽成任意历史路径。调用测试的完整服务组合和 core-only 组合也必须使用相同 core 路径配置。

## 仓储与生命周期

| 视图 | 可见表别名 | 写权限 |
| --- | --- | --- |
| `projects` | projects、memories、sessions | 有 |
| `literature` | searches、bundles、provenance | 有 |
| `documents` | reports、presentations、provenance | 有 |
| `history` | 全部表 | 无 put/delete |
| `legacy-tasks` | 全部表 | 有，仅供过渡兼容入口 |

这些视图约束合作代码的访问面，不能当成恶意插件的安全沙箱。core 自身保留完整访问，用于课题级联删除和公共溯源。

访问包装保留 `get/keys/entries/size/put/delete`；不提供数据域关闭权。所有操作先检查所属 core 实例是否存活。core 拆除时先使旧仓储失效，再关闭域；重启获得新包装，旧业务实例持有的引用不能访问新数据域。`labTasks` 自身不再打开、缓存或关闭域。

core 在启动时把旧 `sessionId` 合并进 `sessionIds`。即使 schema 已为旧行补了默认空数组，也能迁移；保留已有会话和旧行其他字段，重复启动不重复添加。

core 的 `getArtifact(kind, id)` 返回既有源包/报告/PPT 行，`readHistory(projectId)` 按课题返回历史行，`listProvenance` 返回既有溯源。`recordProvenance` 接收调用者给出的显式 skill 快照；兼容入口仍通过版本服务补齐它。人工批准必须匹配实际文件 SHA-256，core 的公共校验不能沿用替换前批准；本阶段没有改变业务人工审阅和下载流程。

## Remote 委派表

| 原接口 | P2 路由 |
| --- | --- |
| `projects_list/get/delete/ensure_workspace` | core |
| `projects_bind_workspace/bind_session/binding/by_session/by_workspace/by_cwd` | core |
| `projects_memory/memory_update` | core |
| `projects_create` 含旧目标/模板 ID | labTasks → 显式快照 → core；业务缺席时报功能不可用 |
| `projects_create` 不含旧目标/模板 ID | core；新增基础课题能力 |
| `tasks_provenance` | core |
| `projects_workspace` 与其他领域接口 | 原领域服务；组合页面的可选能力处理在 P5 |

Remote 对缺失服务返回 rc.2 原生 `RemoteError`，wire code 为 `feature-unavailable`，details 含缺失服务名。仍由 Gateway 生成既有成功/失败响应封套。不缓存业务服务实例；实际调用时查找。

## P3 交接

1. 从过渡 `legacy-tasks` 拆出 documents、literature、design、analysis、runtime 的实际服务和工具，限制各域仓储视图。
2. 把模板/目标等领域依赖留在相应领域；runtime 接收明确调用契约；领域之间通过 core 契约和通知联系。
3. 落实 PDF/SI 替换提交与 design 的源文件变更通知，并验证读时哈希重校验。
4. 保留 P2 的完整组合与 core-only 组合检查，增加领域独立装卸和失效引用检查；UI 可用能力、默认预设和 native bridge 在 P4/P5 继续验收。
