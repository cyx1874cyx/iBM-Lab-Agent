# 核磁解析（NMR）子插件提取档案

只读梳理，范围为 `lib/nmr*.js`、`lib/characterization.js`、`lib/analysis.js`、`lib/mnova-tool.js`、`src/nmr/`、`src/characterization.js`、`src/runtime/{nmr-synthetic-fid,mnova-job}.js`、`electron-next/mnova-open.mjs`、`presets/mcp/`、`client/src/{components-nmr,nmr-*,components-characterization}.js` 及 Remote/工具注册点。`client/vendor/**`、`node_modules`、`vendor/mnova-mcp` 源码未逐行读（只核目录与 patch 配置）。

## 1. 文件清单

| 路径 | 行数 | 职责 | 建议迁移去向 |
| --- | --- | --- | --- |
| lib/nmr.js | 219 | `ctx.labNmr`；`lab_nmr` 域 `nmr_datasets`；积分审核状态机与聚合物计算 | plugins/nmr/host/dataset-service.js |
| lib/nmr-intake.js | 97 | 草稿保存/结构来源/打开路径（raw/simulation/spectrum）/条目文件夹 | plugins/nmr/host/intake.js |
| lib/nmr-simulation.js | 78 | 结构 worker 调度、`nmr-simulations/` 产物落盘、simulationArtifact 登记、列举 | plugins/nmr/host/simulation.js |
| lib/characterization.js | 539 | `lab_characterization.tasks` 一表两业务（nmr+plot）总服务 | 拆 plugins/nmr/host/tasks.js + plugins/plot/host/tasks.js（§6） |
| lib/mnova-tool.js | 28 | `mnova_*` 工具注册（仅桌面壳） | plugins/nmr/tools/mnova.js |
| lib/analysis.js | 59 | `ctx.ibmAnalysis` 编排：submit/simulateNmr/runSimulation（Mnova 全链路） | plugins/nmr/host/analysis.js |
| src/nmr/models.js | 85 | `nmrDatasetSchema` + 状态机 `NMR_TRANSITIONS` | plugins/nmr/src/models.js |
| src/nmr/integration-calc.js | 91 | 纯公式层（组成/转化率/端基 DP/取代度/载药量） | plugins/nmr/src/integration-calc.js |
| src/nmr/simulation.js | 45 | 模拟参数校验、一阶线型、JCAMP、SVG | plugins/nmr/src/simulation.js |
| src/nmr/structure-worker.js | 73 | worker：Indigo+OCL 建可区分环境、峰模型校验与谱生成 | plugins/nmr/src/structure-worker.js |
| src/nmr/synthetic-assignment.js | 24 | 模拟峰 → Mnova assignment plan | plugins/nmr/src/synthetic-assignment.js |
| src/characterization.js | 52 | `taskSchema`（nmr/plot 共用）+ `taskPrompt`（双分支） | 拆 nmr-task-schema / plot-task-schema（§7） |
| src/runtime/nmr-synthetic-fid.js | 21 | 调 vendor skill `simulate_1d.py` 生成 synthetic FID | plugins/nmr/src/runtime/synthetic-fid.js |
| src/runtime/mnova-job.js | 22 | `scripts/runtime/mnova_job.py` 子进程封装 | plugins/nmr/src/runtime/mnova-job.js |
| lib/runtime.js | 83（相关 12 行） | `mnova()` 白名单 5 工具（:50-55）、`syntheticNmrFid()`（:56-58） | 收敛为 nmr 运行时适配器 |
| electron-next/mnova-open.mjs | 43 | `MNOVA_EXE`/标准目录探测 + Windows Shell open 启动 | plugins/nmr/electron/mnova-open.mjs |
| electron-next/scientific-runtime.mjs | 361（相关 3 行） | IPC `mnovaOpen`(:259)、`openFolder`(:279-283) | 保留壳内 broker，插件只发请求 |
| presets/mcp/mnova-mcp.patch.yml | 40 | Mnova MCP server 模板（stdio、`python -m mnova_mcp`、超时 360000） | plugins/nmr/presets/ |
| vendor/mnova-mcp/** | — | `mnova/bridge.qs`(29.7 KB)、`src/mnova_mcp/{runner.py 30.6KB,server.py,config.py}`、`skill/nmr-analyze-simulate/`（SKILL.md 18.5KB + simulate/preflight/process/calibrate/validate 脚本 + 4 篇 references）、`*.lock.json` | plugins/nmr/vendor/ |
| lib/characterization-tool.js | 231 | 工具注册 + NMR Python 预检脚本（:15-41） | 拆 nmr-tools / plot-tools |
| lib/remote.js | 1127（相关 43 行） | Remote 网关：`nmr_*` + `characterization_*` | 拆 nmr-remote.js（§7） |
| client/src/components-nmr.js | 165 | 核磁面板（列表/表单/模拟/删除/预览） | plugins/nmr/client/ |
| client/src/nmr-files.js | 27 | 扩展名白名单、目录拖拽打包 | plugins/nmr/client/ |
| client/src/nmr-input-zone.js | 21 | 数据/结构双投放区 | plugins/nmr/client/ |
| client/src/nmr-simulation-settings.js | 17 | 模拟参数表单（引 `SIMULATION_SOLVENTS`） | plugins/nmr/client/ |
| client/src/nmr-delete-dialog.js | 16 | 删除产出/条目对话框 | plugins/nmr/client/ |
| client/src/nmr.css.js | 75 | 核磁样式（经 client/src/styles.js:3 引入） | plugins/nmr/client/ |
| client/src/components-characterization.js | 187 | 按 `taskKind` 分流 + 旧混合面板 Legacy 14-175 | 删除 Legacy，仅留路由 |

规模：JS 约 2.3k 行（不含 vendor Python/bridge）；`src/nmr/` 实为 **5 个文件**（非 6）。

## 2. 对外接口

Remote（lib/remote.js，均经 `markRemote`，:951 / :1065-1073）
- `nmr_*`（:596-622）：`nmr_list`、`nmr_get`、`nmr_create`、`nmr_integrals`、`nmr_approve`、`nmr_written_back`、`nmr_verify`、`nmr_reopen`、`nmr_calculate`
- `characterization_nmr_*`（:582-589）：`characterization_nmr_simulation_start`、`characterization_nmr_simulation_dispatch_failed`、`characterization_nmr_simulations`、`characterization_nmr_save`、`characterization_nmr_start`、`characterization_nmr_cancel`、`characterization_nmr_structure`、`characterization_bind_session`
- 共用（:590-594）：`characterization_list`、`characterization_submit`、`characterization_retry`、`characterization_remove`、`characterization_dispatch_failed`
- 聚合读：`projects_workspace` 返回 `characterization.nmr`（:274 取 `labNmr`、:312-313）

Host service
- `labNmr`（lib/nmr.js）：createDataset/getDataset/listDatasets/removeDataset/setDraftIntegrals/approveIntegrals/reopenReview/markWrittenBack/visualVerify/calculate/peak/persist/transit
- `labCharacterization`（lib/characterization.js）：serial/get/list + nmr 专用 :47-87（saveNmrDraft、simulateNmr、simulationStructure、registerSimulationMnova、listNmrSimulations、startSimulation、updateSimulation、simulationDispatchFailed、nmrStructureSource、nmrOpenPath、nmrFolderPath、startNmr）+ :88-113 bindSession/cancelNmr + submit/update/retry/remove/complete/recomplete/artifactFile
- `ibmAnalysis`（lib/analysis.js）：`list`、`submit`、`simulateNmr`、`runSimulation`

工具名
- `mnova_status`、`mnova_probe_runtime`、`mnova_process_1d`、`mnova_prepare_structure_1d`、`mnova_apply_assignments_1d`（lib/mnova-tool.js:7-13）
- `lab_nmr_simulation_structure`（characterization-tool.js:91）、`lab_nmr_simulation_run`（:97）、`lab_characterization_submit`（:103）、`lab_characterization_preflight`（:148）、`lab_characterization_update|complete|recomplete`（:207-230）
- 核实：`lib/tasks-tool.js` **不含**核磁工具（仅文献/浏览器类），无需迁移。

Preset
- presets/lab-research/preset.patch.yml:479-481 注册 `dsh-lab-agent/characterization-tool`（inject: tools, ibmAnalysis, ibmCore, labCharacterization）
- presets/mcp/mnova-mcp.patch.yml:25-40 提供 `mcp-mnova`（serverName `mnova` → 模型侧 `mcp__mnova__*`，`failOnStartupError:false`）

## 3. 数据所有权

- `lab_characterization` 域：lib/characterization.js:13（version 0，单表 `tasks` ← src/characterization.js:3-38）；服务注册 cordis.patch.yml:337-339、bundles/analysis.patch.yml:29-31。
- `lab_nmr` 域：lib/nmr.js:28-34（单表 `nmr_datasets` ← src/nmr/models.js:41-82）；注册 cordis.patch.yml:237-239。
- tasks 字段：id、projectId、kind(nmr|plot)、title、date、inputPath、rawInputPath、inputSha256、structurePath、structureSha256、instructions、compound{name,smiles,casNumber,formula}、nucleus、deuteratedSolvent、status(draft|queued|running|completed|failed)、sessionId、conversationSessionId、error、attempt、assessment{verdict,confidence,summary}、simulationArtifact、simulationId、simulationJob{id,status,attempt,parameters,error,assignmentSummary,history}、artifacts{slot→path,fileName,sha256,byteLength}、artifactHistory[]、createdAt、updatedAt；superRefine :36-37 限定 `draft` 仅 nmr。
- 序列化归属：lib/core/project-files.js:15-22 白名单登记各域 → attachDomain（characterization.js:24、nmr.js:47-48）→ 行写入 `<workspace>/<projectId>.ibmproject`（project-files.js:339）。
- 项目内目录：`nmr-inputs/<taskId>`（nmr-intake.js:38、characterization.js:224，ZIP 解包 `<taskId>-<digest>`）、`nmr-simulations/synthetic-<uuid>/`（nmr-simulation.js:47、71；产物 synthetic-*.{svg,jdx,csv,json,mol,mnova}）、`imports/<taskId>/`（characterization.js:149）、`characterization-history/<id>/revision-N`（:494）。
- `$DSH_HOME`：`$DSH_HOME/lab-agent/projects/<projectId>`（src/paths.js:30-32，lib/core/index.js:23）；vendor 树 `$DSH_HOME/lab-agent/vendor/**`（paths.js:34-37）；发布拷贝 `vendor/mnova-mcp`（electron-next/release-runtime.mjs:149）；Mnova 侧以 `IBM_LAB_MNOVA_WORKSPACE`/`_OUTPUT_ROOT` 注入（characterization.js:136、patch yml:35-38）。

## 4. 硬依赖

ibmCore
- lib/nmr.js:37（inject）、:47 `ctx.get('ibmCore')?.projectFiles`
- lib/nmr-intake.js:16、:37；lib/nmr-simulation.js:21、:46、:70
- lib/characterization.js:16、:24、:115-116、:342；lib/analysis.js:15、:22；characterization-tool.js:170

ibmRuntime
- lib/analysis.js:26（`syntheticNmrFid`）、:27、:33（`mnova`）
- lib/mnova-tool.js:24；lib/runtime.js:50-58（`mcpConfig('mnova')`、cwd=workspace）

ibmScientificDesktop
- lib/scientific-desktop.js:149-163：`openMnova`→`service.nmrOpenPath`(:161)、`openNmrFolder`→`service.nmrFolderPath`(:158)、URL 校验 :153-156
- Remote `desktop_status` lib/remote.js:323；客户端 `nativeArtifact('openMnova'|'openNmrFolder')` components-nmr.js:101-109

labPlotRecords
- lib/characterization.js:16（inject）、:322-324（remove 按 kind 取记录）、:407、:465-469（complete 写绘图记录）、:516-521（artifactFile legacy origin）
- lib/analysis.js:15（inject 但未使用）——拆 nmr 时可移除

其它
- ibmDocuments：characterization.js:438-440（.md→.docx，缺失抛 `RemoteError feature-unavailable`）
- npm：indigo-ketcher / openchemlib-extended / xml2js（structure-worker.js:5-7）；jszip（characterization.js:218、:453）

绘图分支逐条（lib/characterization.js，`kind==='plot'`）
- :9 引入 `src/plot/models.js` 的 `todayLocal`
- :443 `slots` 三元：plot → `{origin: [fields.originPath, ['.opju','.opj']]}`（nmr → spectrum/report）
- :464-470 `labPlotRecords.get/update/create`（`source:"agent"`）
- :321-324 remove 的 kind 判定与 `labPlotRecords.get`
- :407 `labPlotRecords.remove(id)`
- :516-521 artifactFile legacy：`origin` → `artifactPath` + `['.opju','.opj']`
- 反向（nmr 专属）：:422-442（assessment、docx）、:459-463（labNmr.createDataset/persist）、:380-387（nmr-simulations 目录删除）

## 5. 客户端接线点

- 挂载：client/src/components-project.js:1027（`taskKind:'nmr'`，`nmrRows: characterization.nmr`）、:1028（`taskKind:'plot'`）
- 分流：components-characterization.js:13 `CharacterizationPanel`；Legacy 混合面板 :14-175（plot 走 `plot_records_*`，:18/:26/:121/:181）
- 核磁面板 Remote 调用：`characterization_list`(components-nmr.js:48,51)、`characterization_nmr_save`(:62)、`characterization_nmr_start`(:64)、`characterization_dispatch_failed`(:67)、`characterization_nmr_simulation_start`(:72)、`characterization_nmr_simulation_dispatch_failed`(:75)、`characterization_nmr_structure`(:29)、`characterization_nmr_cancel`(:137)、`characterization_remove`(:112)、`project_file_upload`(:58)
- 桌面动作：`nativeArtifact('openMnova'|'openNmrFolder')`（:102、:107），URL `/api/lab-artifacts?kind=characterization…`（:18）
- 子组件/样式：nmr-input-zone / nmr-simulation-settings / nmr-delete-dialog / nmr-files / nmr.css.js（styles.js:3）

## 6. 拆分阻碍

1) characterization 一表多业务（具体位置）
- schema 混合：src/characterization.js:3-38 单表 union；plot 只用 title/date/inputPath/instructions/artifacts.origin，其余（structurePath、structureSha256、compound、nucleus、deuteratedSolvent、assessment、simulationArtifact、simulationId、simulationJob）属核磁
- prompt 双分支：src/characterization.js:39-51（:50-51 两段 nmr-only 长指令含 Mnova 通道约束）
- 服务混合：lib/characterization.js:47-87 全为 nmr 方法；:88-99 bindSession 共用；:100-113 cancelNmr；:246-285 submit（:251、:256-270 nmr 分支，plot 同入口）；:314-414 remove（:321-330 kind 判定、:348/:357 保护清单、:380-387 nmr-simulations）；:415-475 complete（:422-442 nmr 专属、:443 slots、:459-470 双写）；:484-512 recomplete（文案 nmr、plot 复用）；:513-537 artifactFile（origin vs spectrum/report）
2) Mnova MCP 依赖
- 配置：presets/mcp/mnova-mcp.patch.yml；`lib/runtime.js:53` 以 MCP 配置派生 `mnova_job.py` 调用；`src/runtime/nmr-synthetic-fid.js:5` 直接引用 `vendor/mnova-mcp/skill/nmr-analyze-simulate/scripts/simulate_1d.py`
- 启动：electron-next/mnova-open.mjs（Windows Shell）；`presets` 缺 Mnova 时 `failOnStartupError:false`，仅靠 prompt 让 agent 调 `lab_characterization_update(failed)`（src/characterization.js:50）
3) analysis.js 与 plotting 的共享
- 同一 `ibmAnalysis` 服务与同一 Remote 入口承载 nmr 模拟；绘图走 `lib/runtime.js:60-70`（`ibmRuntime.plot`，origin server），共用 `mcpConfig` 与 `processes.spawn`
- characterization.js 里 nmr/plot 共用 submit/update/retry/recomplete/artifactFile 与 tasks 表
4) 注册面不一致：cordis.patch.yml:237-239、bundles/analysis.patch.yml:9-11 声明 `inject: [storageDomain]`，而 lib/nmr.js:37 静态 inject 含 `ibmCore`

## 7. MVS：先按 kind 拆表/拆服务

1. schema：新增 nmr-only schema（kind 常量 `'nmr'`，保留结构/评估/模拟字段）与 plot-only schema；旧 `taskSchema` 降级为 discriminatedUnion 兼容层，仅迁移期使用。
2. 表：新建 `lab_nmr.tasks`、`lab_plot.tasks` 两域（project-files.js:15-22 登记）；一次性迁移按 `row.kind` 复制旧行，旧 `lab_characterization.tasks` 保留只读一版。
3. 服务：`labCharacterization` 只留 submit/update/retry/complete/recomplete/artifactFile 骨架 + kind 分派；nmr 专用方法（§6-1）移入 `labNmr`/`NmrTasksService`，plot 专用移入 `labPlotRecords`；移除 analysis.js:15 与 characterization.js:16 的 `labPlotRecords` 依赖。
4. 工具：characterization-tool.js 拆 `nmr-tools.js`（mnova_* + lab_nmr_simulation_* + preflight + NMR Python 预检）与 `plot-tools.js`（plot editor）；preset 479-481 拆两行。
5. Remote：`characterization_nmr_*` 改名 `nmr_task_*`（旧名保留别名一版）；`nmr_*` 数据集 CRUD 与 `nmr_task_*` 合并入 nmr-remote.js。
6. 客户端：保留 components-characterization.js:13 分流，删除 Legacy :14-175；核磁面板改调 `nmr_task_*`。

## 8. 风险与验收点

- Mnova 不可用降级：`isDesktopShell()` 为假时不注册 mnova_*（mnova-tool.js:16）；未找到 EXE 抛错（mnova-open.mjs:31）；MCP 启动失败不阻塞（patch yml:40）。降级路径必须统一为"记录失败 + 保留已生成 FID/产物"，不能让 prompt 与实现分叉。
- 旧 task 行兼容：无 `structurePath` 的旧 nmr 行 retry 直接报错（characterization.js:306）；`complete` 强制 assessment（:422）；`artifactFile` 依赖 :516-521 legacy 分支；无 kind 的历史行 remove 需 `requestedKind`（:321）；`draft` 仅 nmr（src/characterization.js:37）。
- 迁移期双表并存需保证 `nmr_datasets.id == tasks.id` 一致（complete :462 以同 id 建 dataset），删除路径（:404-411）需幂等回滚。
- 目录清理：`nmr-simulations/` 孤儿目录、`characterization-history/` 历史版本（:494）在拆分后仍须由 nmr 侧单独负责。
- 验收：Remote 方法清单快照（:582-594、:596-622）无缺失；`nmr_list`/`characterization_nmr_*` 兼容别名通过；导入 `.ibmproject` 后 nmr/plot 行归位正确（project-files.js:15-22、:313-321）；`tests/integration/nmr-workbench.test.mjs`、`tests/browser/nmr-workbench.test.mjs` 全绿。
