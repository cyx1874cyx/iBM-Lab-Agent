# 文献检索登记后界面不刷新，必须重启应用才能看到

## 概要

在 iBM Lab 中，科研助手完成 `lab_tasks_register_search` 后，文献页的「检索记录」列表不会出现新条目。刷新页面无效，只有完全重启应用后才显示。另有输入检索任务时偶发焦点被抢的问题。

## 环境

- 应用：iBM Lab（Electron + DSH）
- 工作区：`workbench-dev-20261021`
- 文献插件：`@ibm-lab/literature`
- 数据文件：`<DSH_HOME>/storages/lab_tasks.json`
- 相关表：`tables.literature_search_runs`

## 复现步骤

1. 打开某个课题的「文献」页，记录当前「检索记录」数量。
2. 在科研助手会话中执行一次检索并调用 `lab_tasks_register_search`。
3. 工具返回成功，包含 `runId`、`count`。
4. 返回文献页等待 5–10 秒。
5. 「检索记录」数量与列表不变。
6. 手动刷新页面仍不变。
7. 完全退出并重启应用后，新条目出现。

## 期望

登记成功后，最多一个刷新周期内，文献页自动出现该检索条目，无需刷新页面或重启。

## 实际

- 工具报告成功；
- UI 列表不更新；
- 浏览器刷新无效；
- 只有应用重启后可见。

## 已确认的事实

1. `lab_tasks_register_search` 工具走：
   - `plugins/literature/lib/tools.js`
   - `(ctx.get("ibmLiteratureWorkflows") ?? ctx.labTasks).searchLiterature(...)`

2. UI 走：
   - `lib/remote.js` 的 `projects_get`
   - `literatureTasks.listSearchRuns(projectId)`
   - `literatureTasks = this.ctx.get("ibmLiteratureWorkflows") ?? this.ctx.get("labTasks")`

3. 服务实现：
   - `plugins/literature/lib/workflows.js` → `LabLiteratureTasksService`
   - `this.tables = this.ctx.ibmCore.repositories.scope("literature")`

4. 曾尝试在 `projects_get` 前从磁盘重载：

   ```js
   await literatureTasks?.reloadSearchRuns?.();
   ```

   `reloadSearchRuns()` 读取 `storages/lab_tasks.json` 的 `literature_search_runs` 并写回当前内存表。

5. 直接在磁盘文件里增加一条测试检索后，UI 能在 1 秒轮询内看到数量变化，说明：
   - 前端轮询和列表渲染链路可用；
   - **工具登记产生的数据没有及时进入 UI 读取的那份存储/服务实例**。

## 高概率根因

工具和 UI 使用的不是同一份实时数据：

- 工具写入 `ibmLiteratureWorkflows`/agent 侧服务的内存表；
- UI 读取主进程侧另一个服务实例；
- 仓库层可能还有写入延迟/未 flush；
- 磁盘重载读到的是尚未落盘的旧数据，因此看不到新条目；
- 重启时服务重新从磁盘加载，数据才出现。

需要重点检查：

1. `searchLiterature` 写入 `searches` 表后是否立即持久化/commit；
2. 工具上下文与 remote 上下文是否解析到同一个 service 实例；
3. 是否存在两个 `ibmCore` / 两个 `DSH_HOME` / 两个 repository scope；
4. `reloadSearchRuns()` 是否反而用旧磁盘数据覆盖了刚写入的内存数据。

## 建议修复方向

优先级从高到低：

1. **单一数据源**
   - 工具和 UI 必须读写同一个 `LabLiteratureTasksService` 实例；
   - 不要在 remote 里再用 `labTasks` 兼容别名读文献数据。

2. **登记后显式 flush**
   - `searchLiterature` / `registerSearchRun` 成功后调用仓库持久化；
   - 保证 `lab_tasks.json` 立即包含新 run。

3. **版本号或事件通知**
   - 服务维护 `literatureRevision`；
   - 每次登记递增；
   - `projects_get` 返回 revision；
   - 前端只在 revision 变化时刷新，避免无意义重渲染和焦点丢失。

4. **去掉磁盘重载作为常规读路径**
   - 磁盘重载只用于启动恢复；
   - 常规 `projects_get` 直接读同一服务的内存表。

5. **集成测试**
   - 模拟工具调用 `register_search`；
   - 不重启，调用 `projects_get`；
   - 断言 `literature.searches` 包含新 runId。

## 验收标准

- [ ] 工具登记后 ≤ 2 秒，文献页检索记录自动出现；
- [ ] 页面刷新后仍可见；
- [ ] 不需要重启应用；
- [ ] 连续登记两次，第二条也立即出现；
- [ ] 多课题切换时不会串数据；
- [ ] 不产生重复条目；
- [ ] 原有历史检索记录不丢失。

## 另一个关联问题：输入焦点偶发丢失

创建检索任务时，输入标题/需求偶尔失焦。

已尝试：

- 1 秒轮询；
- `document.activeElement` 判断；
- `focusin/focusout` + `typingRef`；
- 聚焦时暂停轮询。

仍偶发。

建议一并检查：

- 轮询触发的 `LitPanel` / `SearchTasksPanel` 是否被重新挂载；
- `SearchTasksPanel` 是否因条件渲染在 tab 切换时卸载；
- `autoFocus` 是否在重渲染时重复抢焦点；
- 是否应改成 revision 驱动刷新，而不是定时整页重载。

## 相关文件

```text
lib/remote.js
plugins/literature/lib/workflows.js
plugins/literature/lib/tasks/literature.js
plugins/literature/lib/tools.js
plugins/literature/lib/search-tools.js
plugins/literature/client/src/lit-panel.js
plugins/literature/client/src/search-tasks-panel.js
```

## 备注

此前提交：

```text
f1e7d72  fix(literature): reload search runs from persisted storage before project reads
a7dc4c7  fix(literature): read searches from the live workflow service and guard input focus
617453e  fix(search): primary tool naming, full candidate payloads and immediate list refresh
```

这些修改没有解决「工具登记后不显示」的问题，建议不要继续在轮询层叠加补丁，直接从服务实例/持久化链路修复。
