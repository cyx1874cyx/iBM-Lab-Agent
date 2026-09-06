// 远程 API 描述符（从原 client/index.js 单文件抽离）。
// 由 apply() 在 $mount 时传给 ctx.remote。
export function buildDescriptors() {
		const pass = { parse: (value) => value };
		const strict = (symbol) => ({ mode: "strict", typeSymbol: symbol, schema: pass });
		const direct = (method, params = []) => ({ id: `dsh-lab-agent#lab/${method}`, service: "lab", namespace: "lab", method, invocation: { kind: "direct" }, parameters: params.map((wire) => ({ name: wire, wire, source: "json", codec: strict(`dsh-lab-agent#lab/${method}:${wire}`) })), result: strict(`dsh-lab-agent#lab/${method}:result`) });
		const descriptors = [
			...["versions_list", "goals_list", "templates_list", "note_templates_list", "nmr_list", "convert_available", "convert_runs", "python_preflight", "cas_policy", "cas_login_entry"].map((name) => direct(name)),
			...["versions_resolve", "goals_resolve", "goals_create", "goals_update", "goals_copy", "goals_delete", "goals_requirements", "templates_resolve", "templates_preview", "templates_validate", "templates_import", "templates_confirm", "templates_update_meta", "templates_archive", "note_templates_resolve", "note_templates_create", "note_templates_update", "note_templates_copy", "note_templates_delete", "note_templates_requirements", "projects_create", "projects_delete", "projects_get", "projects_ensure_workspace", "projects_bind_workspace", "projects_bind_session", "projects_binding", "projects_by_session", "projects_by_workspace", "projects_by_cwd", "projects_memory", "projects_memory_update", "projects_workspace", "tasks_searches", "tasks_provenance", "literature_status", "literature_configure", "literature_connect", "literature_verify", "literature_download_create", "literature_downloads", "literature_download_retry", "tasks_search_create", "tasks_bundle_create", "tasks_report_create", "tasks_report_complete", "tasks_report_validate", "tasks_report_review", "tasks_presentation_create", "tasks_presentation_complete", "tasks_presentation_validate", "tasks_presentation_review", "tasks_review_details", "tasks_search_ris", "tasks_overview", "tasks_report_download", "tasks_ppt_download", "chem_entities", "chem_entity_create", "chem_properties", "chem_formula", "chem_metrics", "chem_plans", "chem_plan_create", "chem_plan_validate", "chem_plan_status", "nmr_get", "nmr_create", "nmr_integrals", "nmr_approve", "nmr_written_back", "nmr_verify", "nmr_reopen", "nmr_calculate", "synth_targets", "synth_target_create", "synth_routes", "synth_route_create", "synth_route_delete", "synth_route_step", "synth_route_status", "synth_evidence", "synth_route_detail", "synth_route_revision", "synth_route_update_step", "synth_step_review", "synth_evidence_list", "synth_evidence_add", "synth_evidence_review", "synth_step_assess", "synth_route_assess", "synth_step_alternatives", "synth_extraction_capability", "synth_extraction_jobs", "synth_extraction_job_create", "synth_extraction_job_update", "synth_plan_from_route", "cas_prepare_query", "convert_upload", "project_file_upload", "manual_capture_create", "manual_capture_get", "manual_capture_list"].map((name) => direct(name, ["request"])),
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
			direct("plot_records_list", ["request"]),
			direct("plot_records_create", ["request"]),
			direct("plot_records_update", ["request"]),
			direct("plot_records_remove", ["request"])
		);
  return descriptors;
}
