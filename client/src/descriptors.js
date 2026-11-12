// 远程 API 描述符（从原 client/index.js 单文件抽离）。
// 由 apply() 在 $mount 时传给 ctx.remote。
//
// DSH 0.1.7 把 strict codec 的字段从 `schema: TypertSchema` 改成
// `create: () => TypertSchema`（dsh-typert-registry 的 validateCodec 现在要求
// `typeof codec.create === "function"`，否则 $mount 抛错、整个客户端 apply()
// 被 reject）。`pass` 仍保留 parse，语义等价；0.1.7 的客户端没有任何调用
// codec.create() 的代码点，宿主侧拿到工厂后自行 materialize。
export function buildDescriptors() {
		const pass = { parse: (value) => value };
		const strict = (symbol) => ({ mode: "strict", typeSymbol: symbol, create: () => pass });
		const direct = (method, params = []) => ({ id: `dsh-lab-agent#lab/${method}`, service: "lab", namespace: "lab", method, invocation: { kind: "direct" }, parameters: params.map((wire) => ({ name: wire, wire, source: "json", codec: strict(`dsh-lab-agent#lab/${method}:${wire}`) })), result: strict(`dsh-lab-agent#lab/${method}:result`) });
		const descriptors = [
 ...["search_tasks_list","search_tasks_diagnose","search_tasks_save","search_tasks_delete","search_tasks_scopus_test","search_tasks_scopus_search","search_tasks_import_ris","search_tasks_export_ris","search_tasks_patch_candidate","search_tasks_get_keys","search_tasks_database_keys","search_tasks_save_database_key","search_tasks_test_databases","search_tasks_save_key","search_tasks_wos_test","search_tasks_wos_search","search_tasks_enrich_abstracts","search_tasks_save_wos_key","search_tasks_public_sources_test","journal_cover_get","journal_covers_sync","search_tasks_add_to_reading"].map(name=>direct(name,["request"])),
 ...['knowledge_chat_state','knowledge_chat_bind'].map(name=>direct(name,['request'])),
 ...['knowledge_state','knowledge_search','knowledge_prepare','knowledge_sync','knowledge_upload','knowledge_attach','knowledge_open_source'].map(name=>direct(name,['request'])),
 ...['reagents_search','reagents_choose_source','reagents_open_source'].map(name=>direct(name,['request'])),
 direct('projects_watch', ['request']),
 ...['tasks_reading_pdf_upload','tasks_reading_pdf_retry','tasks_reading_move','tasks_reading_bind_session','tasks_reading_conversation','tasks_reading_pdf_upload_begin','tasks_reading_pdf_upload_chunk','tasks_reading_pdf_upload_finish','tasks_reading_pdf_upload_abort','tasks_annotations_list','tasks_annotations_create','tasks_annotations_ask','tasks_annotations_update','tasks_annotations_retry','tasks_annotations_delete','tasks_annotations_delete_followup','tasks_journal_metrics','tasks_annotations_adopt','tasks_annotations_dismiss'].map(name=>direct(name,['request'])),
 ...['projects_choose_file', 'projects_open_file', 'projects_draft_read', 'projects_draft_write'].map(name => direct(name, ['request'])),
 direct("capabilities"),
 direct('tasks_translation_bind',['request']),
 ...['tasks_reader_open','tasks_reader_materials','tasks_reader_chunk','tasks_reader_close','tasks_reader_asset','tasks_reader_zip_pdf','tasks_translation_create','tasks_translation_finish','tasks_translation_read','tasks_translation_image','tasks_translation_cancel'].map(name=>direct(name,['request'])),
 direct("runtime_environment"),
 direct("desktop_status"), direct("desktop_browser", ["request"]), direct("desktop_artifact", ["request"]),direct("desktop_pet",["request"]),
 ...["synth_compound_resolve_first","characterization_nmr_simulation_dispatch_failed","characterization_nmr_simulation_start","characterization_nmr_simulations","characterization_nmr_save","characterization_nmr_start","characterization_bind_session","characterization_nmr_cancel","characterization_nmr_structure","characterization_list","characterization_submit","characterization_retry","characterization_remove","characterization_dispatch_failed"].map(name=>direct(name,["request"])),
			// 本次修复：note_templates_list 接受 `{ kind }` 过滤参数（服务端
			// LabRemoteService.note_templates_list(request) 读 request.kind），
			// 但描述符此前声明成 0 参数，前端带参调用会被 wire 层直接拒绝：
			//   client api: lab/note_templates_list expected 0 argument(s), got 1
			// 「已导入模板却显示该错误」就是这条声明与调用不一致造成的。
			// 因此它必须留在下面的 request 参数组里，不能再放回零参数组。
			...["versions_list", "goals_list", "templates_list", "nmr_list", "convert_available", "convert_runs", "python_preflight", "cas_policy", "cas_login_entry", "plugins_list"].map((name) => direct(name)),
			...["versions_resolve", "goals_resolve", "goals_create", "goals_update", "goals_copy", "goals_delete", "goals_requirements", "templates_resolve", "templates_preview", "templates_validate", "templates_import", "templates_confirm", "templates_update_meta", "templates_archive", "templates_delete", "note_templates_list", "note_templates_set_default", "note_templates_resolve", "note_templates_create", "note_templates_parse_markdown", "note_templates_import_markdown", "note_templates_update", "note_templates_copy", "note_templates_delete", "note_templates_requirements", "note_templates_prompt", "templates_guide", "projects_create", "projects_delete", "projects_get", "projects_ensure_workspace", "projects_bind_workspace", "projects_bind_session", "projects_binding", "projects_by_session", "projects_by_workspace", "projects_by_cwd", "projects_memory", "projects_memory_update", "projects_workspace", "plugins_set_enabled", "plugins_set_order", "tasks_searches", "tasks_search_delete", "tasks_search_import_ris", "tasks_reading_folders", "tasks_reading_folder_save", "tasks_reading_folder_delete", "tasks_reading_classify", "tasks_provenance", "literature_status", "literature_configure", "literature_connect", "literature_verify", "literature_download_create", "literature_downloads", "literature_download_retry", "literature_download_cancel", "tasks_search_create", "tasks_bundle_create", "tasks_report_create", "tasks_report_delete", "tasks_bundle_delete", "tasks_entry_naming", "tasks_report_complete", "tasks_report_validate", "tasks_report_review", "tasks_presentation_create", "tasks_presentation_complete", "tasks_presentation_validate", "tasks_presentation_review", "tasks_review_details", "tasks_search_ris", "tasks_overview", "tasks_report_download", "tasks_ppt_download", "review_templates_list", "tasks_review_inputs", "tasks_review_register", "tasks_review_presentation_register", "tasks_review_download", "chem_entities", "chem_entity_create", "chem_properties", "chem_formula", "chem_metrics", "chem_plans", "chem_plan_create", "chem_plan_validate", "chem_plan_status", "nmr_get", "nmr_create", "nmr_integrals", "nmr_approve", "nmr_written_back", "nmr_verify", "nmr_reopen", "nmr_calculate", "synth_targets", "synth_target_create", "synth_routes", "synth_route_create", "synth_route_delete", "synth_route_step", "synth_route_status", "synth_evidence", "synth_route_detail", "synth_route_revision", "synth_route_update_step", "synth_step_review", "synth_step_set_structure", "synth_step_resolve_dual", "synth_evidence_list", "synth_evidence_add", "synth_evidence_review", "synth_step_assess", "synth_route_assess", "synth_step_alternatives", "synth_extraction_capability", "synth_extraction_jobs", "synth_extraction_job_create", "synth_extraction_job_update", "synth_plan_from_route", "cas_prepare_query", "convert_upload", "project_file_upload", "manual_capture_create", "manual_capture_get", "manual_capture_cancel", "manual_capture_claim_agent", "manual_capture_desktop_status_update", "manual_capture_desktop_action_claim", "manual_capture_list", "manual_capture_recreate", "browser_operation_claim", "browser_operation_complete"].map((name) => direct(name, ["request"])),
			direct("projects_list")
		];
		descriptors.push(
			// rc.4 review（§5.2）：synth_route_lock 已移出 Remote 网关——
			// 「锁定版本」走专用 loopback user-action 端点（可信 UI 用户动作）。
			direct("synth_compound_resolve_dual", ["request"]),
			direct("synth_review_batch_create", ["request"]),
			direct("synth_review_batch_get", ["request"]),
			direct("synth_review_batch_complete", ["request"]),
			direct("synth_review_uncertain_apply", ["request"]),
			direct("experiment_plan_templates_list"),
			direct("experiment_plan_templates_resolve", ["request"]),
			direct("experiment_plan_templates_create", ["request"]),
			direct("experiment_plan_templates_update", ["request"]),
			direct("experiment_plan_templates_copy", ["request"]),
			direct("experiment_plan_templates_archive", ["request"]),
			direct("experiment_plan_templates_delete", ["request"]),
			direct("plot_records_list", ["request"]),
			direct("plot_records_bind_session", ["request"]),
			direct("plot_origin_connection", ["request"]),
			direct("plot_image_save", ["request"]),
 ...["plot_layout_create","plot_layout_save","plot_layout_restore"].map(name=>direct(name,["request"])),
			direct("plot_workspace_upload", ["request"]),
			direct("plot_workspace_recommend", ["request"]),
			direct("plot_workspace_render", ["request"]),
			direct("plot_workspace_preview", ["request"]),
			direct("plot_workspace_auto_layout", ["request"]),
			direct("plot_workspace_edit", ["request"]),
			direct("plot_workspace_refine", ["request"]),
			direct("plot_workspace_discard", ["request"]),
			direct("plot_workspace_restore", ["request"]),
			direct("plot_records_create", ["request"]),
			direct("plot_records_update", ["request"]),
			direct("plot_records_remove", ["request"])
		);
  return descriptors;
}
