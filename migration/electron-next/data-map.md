# P0 数据与所有权清单

仅记录源码 schema 和路径约定，未读取用户数据、密钥或机构 Cookie。物理 JSON 存放位置需根据实际 profile/backend 配置在 P1 的测试 home 验证。

| domain | schema version | 表 | 声明文件 |
| --- | --- | --- | --- |
| lab_characterization | 0 | tasks | lib/characterization.js |
| lab_chemistry | 0 | chemical_entities, chemical_properties, experiment_plans | lib/chemistry.js |
| lab_convert | 0 | convert_runs | lib/convert.js |
| lab_experiment_plan_template_profiles | 0 | experiment_plan_template_profiles | lib/experiment-plan-templates.js |
| lab_goal_profiles | 0 | reading_goal_profiles | lib/goal-profiles.js |
| lab_literature_sources | 0 | literature_sessions, literature_downloads | lib/literature-sources.js |
| lab_captures | 0 | lab_capture_tasks | lib/manual-capture.js |
| lab_nmr | 0 | nmr_datasets | lib/nmr.js |
| lab_note_template_profiles | 0 | note_template_profiles, note_template_settings | lib/note-templates.js |
| lab_plot_records | 0 | plot_records | lib/plot-records.js |
| lab_ppt_template_profiles | 0 | ppt_template_profiles | lib/ppt-templates.js |
| lab_synthesis | 0 | synthesis_targets, synthesis_routes, synthesis_evidence, synthesis_extraction_jobs, synthesis_review_batches | lib/synthesis.js |
| lab_tasks | 0 | lab_projects, project_memory_versions, project_sessions, literature_search_runs, paper_source_bundles, reading_reports, presentation_runs, artifact_provenance | lib/tasks/index.js |
| lab_agent | 0 | nature_skill_versions | lib/version-registry.js |

**路径与迁移规则**

| 数据 | 0.5.8 约定 | 迁移规则 |
|---|---|---|
| 桌面数据根 | %LOCALAPPDATA%/iBM-Lab-Agent | 识别实际配置；复制备份后导入 |
| DSH home | 数据根/dsh | 新 NEXT home 独立，禁止新旧内核共写 |
| 课题文件 | DSH_HOME/lab-agent/projects/<projectId> | 保留 ID、相对路径、文件 hash 与来源 |
| 自定义模板/版本 | 对应模板 domain 与 lab-agent 目录 | 保留历史快照与全局默认 |
| 核心记忆/会话 | lab_tasks 中版本行与绑定行；DSH 会话存储 | 对账版本链、hash、session/workspace 引用 |
| 密钥 | 数据根/config/api-key.dpapi | 后续在受限本机层兼容读取，不导出到清单 |
| 浏览器登录 | 旧 Tauri WebView 独立会话 | 不承诺 Cookie 跨引擎复用；按需重新登录 |
| MCP/临时目录 | config、runtime-state、workspace/.lab-tmp | 重新探测路径与授权；临时目录不当作永久产物 |

第一轮 core 是 lab_tasks 的唯一打开者。课题/记忆/绑定/provenance 归 core；检索/资料包/报告/PPT 工作流归 literature。
其他 domain 的唯一所有者随对应业务插件迁移。卸载保留数据；数据删除是另一个显式动作。
