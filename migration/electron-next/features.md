# P0：0.5.8-rc.1 功能与回归清单

基线提交：a400ac424e1ca89496a9ac706531d7a05a221a2d。以下为必须保留的源码功能范围；所有 NEXT 运行验收均为待执行，不以历史测试结果代替新内核验证。

| ID | 功能 | 主要源码证据 | 后续验收要点 | 阶段 |
|---|---|---|---|---|
| F01 | 课题创建、工作区与会话绑定 | lib/tasks/projects.js、lib/project-context.js | 新建/删除、按会话或 cwd 找到正确课题，中文路径不串课题 | P1/P2 |
| F02 | 版本化核心记忆 | lib/memory-tool.js、lib/tasks/projects.js | 更新追加版本与 hash；UI 可见；新会话读取；不退化为孤立文件 | P1/P2 |
| F03 | 科研 Agent 预设 | presets/lab-research/preset.patch.yml | 新会话启用预设；Host 服务不按会话重复挂载；旧会话归属正确 | P1 |
| F04 | 文献检索、来源与检索记录 | lib/literature-sources.js、lib/tasks/literature.js | 来源失败可解释；检索与总结登记；RIS、删除与历史查询 | P1/P3 |
| F05 | 微信公众号入口与 DOI 校验 | lib/tasks/wechat.js、lib/tasks-tool.js | 无 DOI 不猜测；元数据与资料包登记；不把导读当全文 | P3 |
| F06 | 机构浏览器与登录 | desktop/src-tauri/src/webvpn.rs、lib/adapters/browser.js | USTC SSO 重定向、出版社与弹窗；持久登录；浏览器账户隔离 | P4 |
| F07 | PDF/SI 捕获与队列 | lib/manual-capture.js、lib/capture-handoff.js、desktop/src-tauri/src/webvpn.rs | 创建、排队、取消、重试、归档、重复事件幂等与错误可见 | P3/P4 |
| F08 | 浏览器 Agent 操作 | lib/tasks-tool.js、lib/manual-capture.js | debug/observe/click/navigate/viewer-download 及 wait；短期引用有效；点击不误判成功 | P4 |
| F09 | 论文资料包与源文件替换 | lib/tasks/literature.js、lib/tasks/entry-admin.js | bundle ID、PDF/SI 路径、hash/provenance 保留；设计证据正确失效 | P2/P3 |
| F10 | 精读目标、报告与人工审核 | lib/goal-profiles.js、lib/tasks/reading-reports.js、lib/tasks/reviews.js | 目标/模板快照、DOCX、审核与当前 hash 绑定、失败重试 | P3/P6 |
| F11 | 文献 PPT | lib/tasks/presentations.js、lib/ppt-build-tool.js | 编译输入、模板、内容核查、真实 PPTX、独立状态与审核 | P3/P6 |
| F12 | 默认笔记与 PPT 模板 | lib/note-templates.js、lib/ppt-templates.js | 列表参数、导入/复制/更新/归档、全局默认和历史版本 | P1/P3 |
| F13 | PDF/Office 转换与预览 | lib/convert.js、lib/pdf-viewer-assets.js、lib/office-preview.js | 内置 Python、MarkItDown、LibreOffice、可写临时目录、取消与结果定位 | P1/P4 |
| F14 | 化学实体与结构编辑 | lib/chemistry.js、lib/ketcher-assets.js | 实体/属性、CAS 来源与人工结构保护、离线 Ketcher 资源 | P3/P4 |
| F15 | 实验计划与模板 | lib/experiment-plan-templates.js、lib/chemistry.js | 版本快照、请求确认、DOCX、人工审核状态 | P3 |
| F16 | 合成路线与用户锁定 | lib/synthesis.js、lib/user-action.js | 路线/步骤/批次审核；锁定只接受真实用户动作；模型无锁定工具 | P3/P4 |
| F17 | 证据定位与截图 | lib/evidence-shot.js、lib/synthesis.js | 文件/页/区域匹配，源文件替换失效，快速切换不串缓存 | P3/P4 |
| F18 | NMR 与 Mnova | lib/nmr.js、lib/characterization-tool.js、vendor/mnova-mcp | 原始数据引用、预检、授权状态、任务/结果/产物一致 | P3/P4 |
| F19 | 绘图与 Origin | lib/plot-records.js、lib/applications/registry.js | 记录 CRUD、固定启动规格、授权探测、可编辑产物关联 | P3/P4 |
| F20 | 表征任务编排 | lib/characterization.js、lib/characterization-tool.js | 提交、失败、重试、完成与 NMR/plot 投影一致；原始数据不覆盖 | P3/P6 |
| F21 | 保存、打开、定位产物 | lib/artifact-download.js、desktop/src-tauri/src/main.rs | 保存取消、中文路径、审核门禁、系统关联与已保存文件定位 | P4/P6 |
| F22 | 运行环境与 MCP 管理 | lib/runtime-tool.js、lib/python-env.js、desktop/src-tauri/src/runtime/mcp.rs | 路径/版本/来源明确；内置环境优先；启停与异常进程清理 | P1/P4 |
| F23 | 首次引导、诊断、更新与网络状态 | desktop/src/index.html、desktop/src-tauri/src/runtime、desktop/src-tauri/src/iwan.rs | 首次配置、状态/日志、更新失败恢复、网络诊断、旧安装识别 | P4/P6 |
| F24 | 0.5.8 科研界面 | docs/releases/v0.5.8-rc.1.md、client/src | 课题页平铺动作、精读/PPT 独立状态、窄宽度换行、大字号、两主题 | P5 |
| F25 | 浏览器与课题面板布局 | docs/releases/v0.5.8-rc.1.md、desktop/src-tauri/src/webvpn.rs | 全屏面板不被浏览器遮挡；主页面不被固定比例挤窄；关闭面板不复活已关闭 tab | P4/P5 |
| F26 | 插件组合与重载 | cordis.patch.yml、lib/remote.js | 功能停用不拖垮 core；无重复域/服务/路由/任务；重新启用检查旧文件 hash | P2/P5 |
| F27 | 旧数据与离线发行 | desktop/scripts、runtime/versions.env、src/paths.js | 复制导入/对账/中断恢复/回退；普通用户与离线安装完整闭环 | P6 |

**验收记录模板**

每项记录测试环境、内核/插件/资源版本、步骤、预期与实际结果、截图或产物 hash、失败问题编号。
机构登录和科研软件授权由真实已授权环境验收；源码存在不等于新桌面链路已可用。
不新增产品功能、不同时全面改版页面；API 与数据迁移例外需明确登记。

**必须保留的检查**

- tests/unit/client-descriptors.test.mjs：调用、描述符与 Host 参数一致，特别是 note_templates_list。
- tests/unit/tasks-surface.test.mjs：历史任务方法面。
- 用户动作/应用注册/捕获/领域集成检查：迁移前后保持约束。
- 新增 NEXT 组合与安装后验证：旧测试通过不足以证明 rc.2 或 Electron 行为等价。
