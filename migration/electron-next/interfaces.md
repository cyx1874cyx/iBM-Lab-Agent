# P0 接口基线

基线 0.5.8-rc.1。服务与 Agent 工具来自源码声明；Remote 为纯描述符构造结果，不代表 rc.2 运行验证。

| 服务 | 文件 | 必需注入 | 规划归属 |
| --- | --- | --- | --- |
| labArtifactDownload | lib/artifact-download.js:145 | labTasks, webServer | core |
| labCaptureHandoff | lib/capture-handoff.js:170 | labCapture | literature |
| labCharacterization | lib/characterization.js:14 | storageDomain, labTasks, labNmr, labPlotRecords | analysis |
| labChemistry | lib/chemistry.js:61 | storageDomain | design |
| labConvert | lib/convert.js:89 | storageDomain | documents |
| labEvidenceShot | lib/evidence-shot.js:198 | labTasks, labSynthesis, webServer | design |
| labExperimentPlanTemplates | lib/experiment-plan-templates.js:13 | storageDomain | design |
| labGoals | lib/goal-profiles.js:61 | storageDomain | literature |
| labAgent | lib/index.js:20 |  | core |
| labKetcherAssets | lib/ketcher-assets.js:91 | webServer | design |
| labLiterature | lib/literature-sources.js:168 | storageDomain | literature |
| labLlmDiag | lib/llm-diag.js:18 | llm | runtime |
| labCapture | lib/manual-capture.js:261 | storageDomain, labTasks | literature |
| labNmr | lib/nmr.js:41 | storageDomain | analysis |
| labNoteTemplates | lib/note-templates.js:76 | storageDomain | documents |
| labPdfViewerAssets | lib/pdf-viewer-assets.js:86 | webServer | documents |
| labPlotRecords | lib/plot-records.js:13 | storageDomain | analysis |
| labTemplates | lib/ppt-templates.js:64 | storageDomain | documents |
| labPython | lib/python-env.js:15 |  | runtime |
| lab | lib/remote.js:46 | labVersions, labGoals, labNoteTemplates, labExperimentPlanTemplates, labPlotRecords, labTemplates, labTasks, labLiterature, labChemistry, labNmr, labSynthesis, labPython, labConvert, labCapture | compatibility |
| labSynthesis | lib/synthesis.js:262 | storageDomain | design |
| labTasks | lib/tasks/index.js:83 | storageDomain, labGoals, labTemplates, labNoteTemplates, labVersions | core/compatibility |
| labUserAction | lib/user-action.js:59 | labSynthesis, webServer | design |
| labVersions | lib/version-registry.js:59 | storageDomain | runtime |

**Remote 参数基线**

| 旧方法 lab/* | 参数 |
| --- | --- |
| synth_compound_resolve_first | request |
| characterization_list | request |
| characterization_submit | request |
| characterization_retry | request |
| characterization_remove | request |
| characterization_dispatch_failed | request |
| versions_list | 无 |
| goals_list | 无 |
| templates_list | 无 |
| nmr_list | 无 |
| convert_available | 无 |
| convert_runs | 无 |
| python_preflight | 无 |
| cas_policy | 无 |
| cas_login_entry | 无 |
| versions_resolve | request |
| goals_resolve | request |
| goals_create | request |
| goals_update | request |
| goals_copy | request |
| goals_delete | request |
| goals_requirements | request |
| templates_resolve | request |
| templates_preview | request |
| templates_validate | request |
| templates_import | request |
| templates_confirm | request |
| templates_update_meta | request |
| templates_archive | request |
| note_templates_list | request |
| note_templates_set_default | request |
| note_templates_resolve | request |
| note_templates_create | request |
| note_templates_parse_markdown | request |
| note_templates_import_markdown | request |
| note_templates_update | request |
| note_templates_copy | request |
| note_templates_delete | request |
| note_templates_requirements | request |
| projects_create | request |
| projects_delete | request |
| projects_get | request |
| projects_ensure_workspace | request |
| projects_bind_workspace | request |
| projects_bind_session | request |
| projects_binding | request |
| projects_by_session | request |
| projects_by_workspace | request |
| projects_by_cwd | request |
| projects_memory | request |
| projects_memory_update | request |
| projects_workspace | request |
| tasks_searches | request |
| tasks_search_delete | request |
| tasks_provenance | request |
| literature_status | request |
| literature_configure | request |
| literature_connect | request |
| literature_verify | request |
| literature_download_create | request |
| literature_downloads | request |
| literature_download_retry | request |
| literature_download_cancel | request |
| tasks_search_create | request |
| tasks_bundle_create | request |
| tasks_report_create | request |
| tasks_report_delete | request |
| tasks_bundle_delete | request |
| tasks_entry_naming | request |
| tasks_report_complete | request |
| tasks_report_validate | request |
| tasks_report_review | request |
| tasks_presentation_create | request |
| tasks_presentation_complete | request |
| tasks_presentation_validate | request |
| tasks_presentation_review | request |
| tasks_review_details | request |
| tasks_search_ris | request |
| tasks_overview | request |
| tasks_report_download | request |
| tasks_ppt_download | request |
| review_templates_list | request |
| tasks_review_inputs | request |
| tasks_review_register | request |
| tasks_review_presentation_register | request |
| tasks_review_download | request |
| chem_entities | request |
| chem_entity_create | request |
| chem_properties | request |
| chem_formula | request |
| chem_metrics | request |
| chem_plans | request |
| chem_plan_create | request |
| chem_plan_validate | request |
| chem_plan_status | request |
| nmr_get | request |
| nmr_create | request |
| nmr_integrals | request |
| nmr_approve | request |
| nmr_written_back | request |
| nmr_verify | request |
| nmr_reopen | request |
| nmr_calculate | request |
| synth_targets | request |
| synth_target_create | request |
| synth_routes | request |
| synth_route_create | request |
| synth_route_delete | request |
| synth_route_step | request |
| synth_route_status | request |
| synth_evidence | request |
| synth_route_detail | request |
| synth_route_revision | request |
| synth_route_update_step | request |
| synth_step_review | request |
| synth_step_set_structure | request |
| synth_step_resolve_dual | request |
| synth_evidence_list | request |
| synth_evidence_add | request |
| synth_evidence_review | request |
| synth_step_assess | request |
| synth_route_assess | request |
| synth_step_alternatives | request |
| synth_extraction_capability | request |
| synth_extraction_jobs | request |
| synth_extraction_job_create | request |
| synth_extraction_job_update | request |
| synth_plan_from_route | request |
| cas_prepare_query | request |
| convert_upload | request |
| project_file_upload | request |
| manual_capture_create | request |
| manual_capture_get | request |
| manual_capture_cancel | request |
| manual_capture_claim_agent | request |
| manual_capture_desktop_status_update | request |
| manual_capture_desktop_action_claim | request |
| manual_capture_list | request |
| manual_capture_recreate | request |
| browser_operation_claim | request |
| browser_operation_complete | request |
| projects_list | 无 |
| synth_compound_resolve_dual | request |
| synth_review_batch_create | request |
| synth_review_batch_get | request |
| synth_review_batch_complete | request |
| synth_review_uncertain_apply | request |
| experiment_plan_templates_list | 无 |
| experiment_plan_templates_resolve | request |
| experiment_plan_templates_create | request |
| experiment_plan_templates_update | request |
| experiment_plan_templates_copy | request |
| experiment_plan_templates_archive | request |
| plot_records_list | request |
| plot_records_create | request |
| plot_records_update | request |
| plot_records_remove | request |

**Agent 工具名称**

| 名称 | 声明文件 | 声明形式 |
| --- | --- | --- |
| lab_browser_click | lib/tasks-tool.js | reviewed tuple-loop literal |
| lab_browser_debug | lib/tasks-tool.js | reviewed tuple-loop literal |
| lab_browser_download_viewer_pdf | lib/tasks-tool.js | reviewed tuple-loop literal |
| lab_browser_navigate | lib/tasks-tool.js | reviewed tuple-loop literal |
| lab_browser_observe | lib/tasks-tool.js | reviewed tuple-loop literal |
| lab_browser_operation_status | lib/tasks-tool.js | literal name |
| lab_browser_wait | lib/tasks-tool.js | literal name |
| lab_characterization_preflight | lib/characterization-tool.js | literal name |
| lab_characterization_submit | lib/characterization-tool.js | literal name |
| lab_convert_document | lib/convert-tool.js | literal name |
| lab_nature_browser_download | lib/tasks-tool.js | literal name |
| lab_nature_browser_download_status | lib/tasks-tool.js | literal name |
| lab_note_templates_get | lib/templates-tool.js | literal name |
| lab_note_templates_list | lib/templates-tool.js | literal name |
| lab_ppt_build_from_template | lib/ppt-build-tool.js | literal name |
| lab_ppt_template_lint | lib/templates-tool.js | literal name |
| lab_ppt_templates_contract | lib/ppt-build-tool.js | literal name |
| lab_ppt_templates_get | lib/templates-tool.js | literal name |
| lab_ppt_templates_list | lib/templates-tool.js | literal name |
| lab_project_memory_read | lib/memory-tool.js | literal name |
| lab_project_memory_update | lib/memory-tool.js | literal name |
| lab_publisher_browser_capture_list | lib/tasks-tool.js | literal name |
| lab_publisher_browser_download | lib/tasks-tool.js | literal name |
| lab_publisher_browser_download_cancel | lib/tasks-tool.js | literal name |
| lab_publisher_browser_download_status | lib/tasks-tool.js | literal name |
| lab_review_templates_get | lib/tasks-tool.js | literal name |
| lab_review_templates_list | lib/tasks-tool.js | literal name |
| lab_runtime_env | lib/runtime-tool.js | literal name |
| lab_synth_compound_resolve_first | lib/synthesis-tool.js | literal name |
| lab_synth_evidence_add | lib/synthesis-tool.js | literal name |
| lab_synth_experiment_plan_create | lib/synthesis-tool.js | literal name |
| lab_synth_route_create | lib/synthesis-tool.js | literal name |
| lab_synth_route_status | lib/synthesis-tool.js | literal name |
| lab_synth_route_step | lib/synthesis-tool.js | literal name |
| lab_synth_structure_candidate_add | lib/synthesis-tool.js | literal name |
| lab_synth_target_create | lib/synthesis-tool.js | literal name |
| lab_synth_target_list | lib/synthesis-tool.js | literal name |
| lab_tasks_delete_bundle | lib/tasks-tool.js | literal name |
| lab_tasks_fetch_wechat_article | lib/tasks-tool.js | literal name |
| lab_tasks_get_reading_inputs | lib/tasks-tool.js | literal name |
| lab_tasks_get_review_inputs | lib/tasks-tool.js | literal name |
| lab_tasks_get_search_summary_inputs | lib/tasks-tool.js | literal name |
| lab_tasks_register_bundle | lib/tasks-tool.js | literal name |
| lab_tasks_register_paper_meta | lib/tasks-tool.js | literal name |
| lab_tasks_register_presentation | lib/tasks-tool.js | literal name |
| lab_tasks_register_report | lib/tasks-tool.js | literal name |
| lab_tasks_register_review | lib/tasks-tool.js | literal name |
| lab_tasks_register_review_presentation | lib/tasks-tool.js | literal name |
| lab_tasks_register_search | lib/tasks-tool.js | literal name |
| lab_tasks_register_wechat_paper | lib/tasks-tool.js | literal name |
| lab_tasks_resolve_wechat_doi | lib/tasks-tool.js | literal name |
| lab_tasks_set_entry_naming | lib/tasks-tool.js | literal name |
| lab_tasks_update_bundle_file | lib/tasks-tool.js | literal name |
| lab_tasks_update_presentation | lib/tasks-tool.js | literal name |
| lab_tasks_update_report | lib/tasks-tool.js | literal name |
| lab_tasks_update_search_summaries | lib/tasks-tool.js | literal name |

**现有桌面命令**

| 命令 | 迁移目标 |
| --- | --- |
| restart_runtime | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_logs | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_workspace | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| save_artifact | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| save_text_artifact | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_artifact | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_path | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| reveal_path | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| runtime_status | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| runtime_deps | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| check_update | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| download_update | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| install_downloaded_update | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| research_source_diagnostics | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| pick_mcp_dir | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| app_mcp_status | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| save_app_mcp | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| remove_app_mcp | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| install_origin_bridge | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_in_edge | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_artifact_in_browser | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| iwan_status | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| open_iwan | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_probe_available | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_probe_open | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_open_login | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_confirm_login | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_open_capture | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_browser_action | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_cancel_capture | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_sync_capture_ball | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_allow_host | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_set_policy | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_status | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_show | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_set_rect | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_set_capture_queue | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_hide | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_probe_events | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_probe_clear | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
| webvpn_clear_session | NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对 |
