# 科研绘图（plotting）子插件拆分档案

只读源码核对（未构建、未跑测试）。行数为实际值：`lib/plot-workspace.js` 为 362 行；`src/plot/` 实际 **7** 个文件（任务描述写 8）。
「去向」中的四个包是本档案建议的拆分单元：`plot-records` / `plot-origin` / `plot-image-layout` / `plot-runtime`。

## 1. 文件清单

| 路径 | 行数 | 职责 | 建议迁移去向 |
|---|---|---|---|
| lib/plot-records.js | 93 | `labPlotRecords` 服务、`lab_plot_records.plot_records` 域、CRUD、启动恢复中断任务 | plot-records |
| lib/plot-workspace.js | 362 | Origin 工作流主体：连接/上传/推荐/预览/渲染/精修/Auto/历史/产物校验 | plot-origin |
| lib/plot-images.js | 42 | 图片导入与裁剪旋转保存（`runtime.plot('image')`） | plot-image-layout |
| lib/plot-layouts.js | 60 | 多面板排版：素材快照、版面保存/恢复、导出（`runtime.plot('layout')`） | plot-image-layout |
| lib/plotting-tool.js | 47 | 3 个 Agent 工具（state/apply/origin_refine） | plot-origin（工具层） |
| lib/origin-mcp.js | 20 | 挂载 Origin MCP stdio 客户端（仅桌面） | plot-origin |
| src/plot/models.js | 30 | `plotRecordSchema`、`todayLocal` | plot-records |
| src/plot/workspace.js | 117 | 图型目录、`plotSpecSchema`、列校验、AI 推荐提示词 | plot-origin（纯 schema 可留共享） |
| src/plot/editor.js | 18 | 编辑器字段、字体、调色板、系列样式 | plot-origin |
| src/plot/layout.js | 68 | 版面文档 schema、网格/对齐/吸附/箭头几何 | plot-image-layout |
| src/plot/image.js | 14 | `imageEditSchema`、`imageRecordSchema`、图片扩展名 | plot-image-layout |
| src/plot/refinement.js | 38 | 精修 JSON 解析、位置偏差 | plot-origin |
| src/plot/consistency.js | 27 | Origin 读回一致性核对 | plot-origin |
| src/runtime/plot-job.js | 27 | 一次性 `plot_job.py` 子进程：请求文件、stdout 进度事件、超时 | plot-runtime |
| src/runtime/plot-session.js | 13 | 常驻会话（render 复用）stdin/stdout JSON 行协议 | plot-runtime |
| scripts/runtime/plot_job.py | 542 | 动作分发：inspect/prepare/render/status/layout/image | plot-runtime |
| scripts/runtime/plot_session.py | 105 | 进程内常驻渲染循环 | plot-runtime |
| scripts/runtime/plot_editor.py | 376 | spec→Origin 属性命令、读回、SVG 场景 | plot-runtime |
| scripts/runtime/plot_collision.py | 115 | 文字框重叠/裁切估算（PIL 字体度量） | plot-runtime |
| scripts/runtime/plot_image.py | 60 | 图片裁剪/旋转/翻转与预览 | plot-runtime |
| scripts/runtime/plot_layout.py | 141 | PyMuPDF 组版、面板标签、PDF/TIFF/PNG 导出 | plot-runtime |
| electron-next/origin-open.mjs | 14 | OPJU/OPJ 头校验 + `shell.openPath` | plot-origin |
| client/src/components-plotting.js | 279 | 绘图面板、向导、画布、导入/删除/导航 | plot-origin（UI 主干） |
| client/src/plot-editor-controls.js | 116 | 属性面板（缓冲编辑） | plot-origin |
| client/src/plot-live-preview.js | 103 | 本地 CSV 草图（非验收图） | plot-origin |
| client/src/plot-native-scene.js | 146 | 原生 SVG 场景覆盖层与命中几何 | plot-origin |
| client/src/plot-image-editor.js | 66 | 图片条目编辑器 | plot-image-layout |
| client/src/plot-layout-editor.js | 125 | 版面选择器与版面编辑器 | plot-image-layout |
| client/src/plotting.css.js | 32 | 全部 `.ib-plot*` 样式 | 随子插件 CSS |
| skills/ibm-origin-plotting/ | 125+185+200+59 | SKILL.md + 规范/playbook/实测流程；`agents/openai.yaml` | 子插件 skills/ |
| skills/ibm-plot-auto-layout/ | 29+50 | Auto Layout 规范；`plot-workspace.js:35-36` 运行期读取 | 子插件 skills/ |
| lib/characterization.js | 539 | 复用载体：plot 任务登记/删除/完成回填/产物 | 见 §4、§6 |
| lib/characterization-tool.js | 231 | 实际注册绘图工具处（:11、:89）；`kind` 枚举 :108 | 拆分需摘出 :89 |
| lib/artifact-download.js | 171 | `/api/lab-artifacts?kind=plotting`（:66-70、:133、:162） | 保留宿主，接子插件 |
| lib/scientific-desktop.js | 264 | 桌面产物打开/Origin 打开（:171-174） | 保留宿主 |
| lib/core/project-files.js | 358 | :9、:20 把 `plot_records` 注册进跨项目文件域 | 保留宿主 |
| lib/remote.js | 1127 | 19 个 `plot_*` 方法（:682-704）+ markRemote（:985-1001） | 拆到子插件 remote |
| lib/runtime.js | 83 | `ibmRuntime.plot()`（:60-70）；MCP 配置 :74-78 | 保留宿主 |
| lib/applications/registry.js | 97 | Origin 应用规格（:54-66，`availableOn: desktop`） | 保留宿主 |
| presets/lab-research/preset.patch.yml | 481 | 工具装配 :479-481；Origin MCP :459-462；提示词 :123-125 | 子插件 presets |
| cordis.patch.yml | 372 | 服务装配 :110-113、:165-167、:337-339 | 子插件 patch |

## 2. 对外接口

Remote（`lib/remote.js`，19 个）：`plot_origin_connection`(682)、`plot_layout_create`(683)、`plot_layout_save`(684)、`plot_layout_restore`(685)、`plot_image_save`(686)、`plot_workspace_upload`(687)、`plot_workspace_recommend`(688)、`plot_workspace_refine`(689)、`plot_workspace_edit`(690)、`plot_workspace_render`(691)、`plot_workspace_preview`(692)、`plot_workspace_auto_layout`(693)、`plot_workspace_discard`(694)、`plot_workspace_restore`(695)、`plot_records_list`(696)、`plot_records_bind_session`(697)、`plot_records_create`(698)、`plot_records_update`(699，仅允许 topic/date/notes)、`plot_records_remove`(704)。

host service（方法名以源码为准）：
- `labPlotRecords`（plot-records.js:16）：list/get/create/update/remove/bindConversation + plot-workspace 的 22 个方法（plotConnection、plotPreview、plotRender、plotRefine、plotAskModel、plotAskRefiner、plotUpload、plotRecommend、plotQueue、plotStore、plotEntry、plotDirectory、plotSafePath、plotArtifactFile、plotEdit、plotDiscard、plotRestore、plotAutoLayout、plotInvalidatePreview）+ plot-images 3 个 + plot-layouts 5 个。
- `labCharacterization`：submit/complete/recomplete/remove/artifactFile 承载 plot 任务（§4）。
- `ibmAnalysis`：`analysis.js:15` 注入 `labPlotRecords`，但方法体内未直接调用（仅注入占位）。
- `ibmRuntime.plot(projectId, action, args, {signal,onProgress})`：action 仅 `inspect|prepare|render|status|image|layout`（runtime.js:61）。`ibmCore.ensureProjectWorkspace/requireProject` 提供工作目录与校验。

工具名：`lab_plot_editor_state`、`lab_plot_editor_apply`、`lab_plot_origin_refine`（plotting-tool.js:7、:29）；共用 `lab_characterization_submit`（kind=plot，characterization-tool.js:103/108）、`lab_characterization_update|complete|recomplete`（带 `originPath`，:207-211）。Origin MCP 工具以 `serverName: "origin"` 挂载（registry.js:56，`mcp__origin__*`）。

skill 名：`ibm-origin-plotting`、`ibm-plot-auto-layout`。

## 3. 数据所有权

- 表：`lab_plot_records` 域 / `plot_records` 表（plot-records.js:8-11），行 schema 见 `src/plot/models.js:8`（workflow/image/layout 三态共存）。表同时登记进 `lib/core/project-files.js:20`（跨项目文件域）。
- 项目内目录：`<workspace>/科研绘图/<recordId>/`（plot-workspace.js:52-59），子目录：`原始数据`(72)、`原始图片`(plot-images.js:10)、`数据副本`(108)、`数据工程`(116)、`版本`(225)、`预览缓存`(183)、`素材`(plot-layouts.js:10)、`绘图配置.json`(251)。所有读写经 `plotSafePath`/`plotDirectory` 做 realpath 越界校验。
- `$DSH_HOME`：项目根 `lab-agent/projects`（cordis.patch.yml:139）；Python `lab-agent/.venv`（:146）；`lab-agent/scientific-desktop`（:151）。绘图数据本身**不落** `$DSH_HOME`，只在课题工作区。
- Origin 连接配置：JS 侧无持久化配置文件；仅有 env `ORIGIN_MCP_TOOL_PROFILE`（native-applications.js:17）与预设开关 `IBM_LAB_AGENT_BUNDLED_PYTHON`（preset.patch.yml:461）；连通性靠 `origin_mcp.bridge_client.request_bridge('ping')` 现取 version/pid（plot_job.py:513-517）。

## 4. 硬依赖（文件:行）

- ibmCore：plot-records.js:14（inject）、:22-23（attachDomain）；plot-workspace.js:18、:41、:53、:61、:67、:346-347；plot-images.js:18；plot-layouts.js:32、:38、:50；plotting-tool.js:2、:13。
- ibmRuntime：plot-workspace.js:24、:105、:186、:228、:241、:303；plot-images.js:9、:12、:25、:28；plot-layouts.js:28-29；origin-mcp.js:9、:13；runtime.js:60-70。
- ibmScientificDesktop：scientific-desktop.js:171（`plottingFile` → `plotArtifactFile`）、:172-174（`originOpen`）；electron-next/scientific-runtime.mjs:284。
- labNmr：characterization.js:16（inject）、:322-324、:357、:400、:406、:460、:516。
- characterization 中的绘图分支：characterization.js:9（从 `src/plot/models.js` 取 `todayLocal`）、:320-324（remove kind=plot）、:407、:443（plot 槽位仅 `.opju/.opj`）、:465-469（complete 时 create/update plot 记录）、:516-521（legacy artifactFile `slot=origin`）；任务 schema/提示词 `src/characterization.js:6`、`:40`、`:50`。

## 5. 客户端接线点

styles.js:7、:104（`plottingCss`）；workbench.js:19（模块定义）、:83、:164、:208（headerTarget）；components-project.js:932、:1008（`capabilities.analysis` 兼作 plotting 开关）、:1011-1012、:1028；components-characterization.js:2、:13（`taskKind==='plot'` → `PlottingPanel`）；components-plotting.js:15（产物 URL）、:59、:92（删除走 `characterization_remove`）、:122（Auto→对话）、:139。图片/版面文件 URL 见 plot-image-editor.js:6、plot-layout-editor.js:9。

## 6. 拆分阻碍

- 与核磁共用 `characterization`：同一 tasks 表与 `kind` 枚举（`src/characterization.js:6`），同一 `remove()` 分支（:314-407）、同一 `complete()`（:415-475，:443 按 kind 选槽位、:465-469 回填绘图记录）、同一 `artifactFile()` legacy 分支（:513-527）。绘图 UI 的删除入口就是 `characterization_remove`（components-plotting.js:92），拆走绘图必须先提供跨服务删除/回填接口。
- records 表跨域登记：`project-files.js:20` 依赖 `src/plot/models.js` 的 schema；子插件不能自带独立表名，否则丢跨项目文件域。
- Python 运行时：单一 venv `$DSH_HOME/lab-agent/.venv`，`requirements.lock` 固定 `origin-mcp==0.1.4`、`matplotlib==3.11.1`、pandas/Pillow/PyMuPDF（python/requirements.lock:59、:64）；`origin_mcp` 由 venv 提供，仓库内无源码（`scripts/runtime/*.py` 仅 `import origin_mcp.*`：plot_job.py:170、:460、:515；plot_session.py:12）。
- 调用方式：`plot-job.js` 每次 `mkdtemp` 写 request.json，以 `-I plot_job.py <action> @request` 传参（plot-job.js:9、:15），stdout 只允许 `{"event":"plot-preview"}` 进度行、末行 JSON 结果；`plot-session.js` 常驻进程按行收发（plot-session.js:4、:7）。两种模式必须同时迁，且 `runtime.js:65-68` 决定 render 走 session、其余走 job。
- MCP 与形态：Origin 仅 desktop（registry.js:63），preset 用 `disabled: !!js "!process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']"` 关闭（preset.patch.yml:461）。
- 产物 URL 白名单三处重复：artifact-download.js:68、:133 与 desktop-artifacts.js:9，槽位名漂移会 404。

## 7. MVS：不依赖 Origin 的基础功能

可行，且这是最短路径。图片与版面两条链完全不碰 Origin：
1. `plot_upload` 走 `image` 分支（plot-workspace.js:71）→ `plotImageUpload`（plot-images.js:8）→ `runtime.plot('image')` → plot_job.py:528-530 → `plot_image.py`（PIL）。
2. `plot_layout_create/save/restore`（plot-layouts.js:31-54）→ `runtime.plot('layout')` → plot_job.py:525-527 → `plot_layout.py`（PyMuPDF）。
3. 这些路径**不导入** `origin_mcp`：plot_job.py 的 module-scope 只有 plot_editor/plot_collision（:17-18），`origin_mcp` 仅在函数内（:170、:460、:515）；`plot_editor.py`/`plot_collision.py` 亦无 Origin 依赖。
4. 依赖面仅：ibmCore（目录）、`ibmRuntime.plot` 两个 action、artifact-download 白名单、`/api/lab-artifacts` 前端 URL。不需要 Origin 安装、MCP、`IBM_LAB_AGENT_BUNDLED_PYTHON`、`plot_session`。

切法建议：先切 `plot-image-layout`（schema：`src/plot/image.js`、`src/plot/layout.js`；服务方法 + `plot_image.py`/`plot_layout.py` + 两个客户端编辑器 + CSS 子集），对外暴露 `plotArtifactFile` 的 `image-*`/`layout-*` 槽位与 4 个 Remote；`plot-records` 仍留在宿主以便共用 `plot_records` 表与 `kind=plot` 登记。Origin 链（§4 全部 ibmRuntime/Origin 触点）作为第二阶段。

## 8. 风险与验收点

风险：
1. `plot-workspace.js` 是 362 行高耦合单文件（预览 90 行 + 三段全局 `plotOriginQueue` 串行化 :113、:180、:221、:299），拆包时容易丢串行语义导致 Origin 活动窗口错乱。
2. `remove()` 只按 id 删（plot-records.js:78-87），Remote 未传 projectId（remote.js:704）——拆包后跨课题误删风险会被放大。
3. `characterization` 双向依赖：它 inject `labPlotRecords`（:16），而绘图 UI 依赖 `characterization_remove`（components-plotting.js:92），任一先拆都会形成循环。
4. 槽位白名单三处重复 + `layout` 记录走 `runtime.plot('layout')` 却由 `plotArtifactFile` 分派（plot-workspace.js:346），边界不清晰。
5. 打包面：skills 从 `profiles/ibm-lab/node_modules/dsh-lab-agent/skills` 发现（cordis.patch.yml:34-42），`package.json` files 含 `skills`（:169）——子插件必须自带 provider 行，否则 Auto Layout 静默失效（plot-workspace.js:35-36 是硬 readFile）。
6. Python 单 venv 共享：拆包不得各自 bootstrap，否则 `origin-mcp`/`matplotlib` 版本分叉。

验收点（最小集）：
- 19 个 Remote 名称与参数不变；`plot_records_*` 仍只允许改 topic/date/notes。
- 表名仍为 `lab_plot_records.plot_records`，`project-files.js` 跨项目可见性不回归。
- 图片/版面在**无 Origin、无 MCP** 环境可完整导入→编辑→保存→下载（PNG/PDF/TIFF）。
- 预览缓存 key（`...[specHash,fontFamily,'900','quick-v2']`，plot-workspace.js:166）与 sha256 校验逻辑逐字保持。
- `characterization_remove(kind=plot)` 仍能删表并保留文件；`complete` 仍回填 `artifactPath`。
- 服务形态（server）不注册 Origin 工具、不报缺依赖；桌面形态工具数量与拆前一致。
