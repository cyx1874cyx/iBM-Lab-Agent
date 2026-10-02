import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { coreProjectSchema, projectMemoryVersionSchema, projectSessionSchema, literatureSearchRunSchema, paperSourceBundleSchema, readingReportSchema, presentationRunSchema, artifactProvenanceSchema } from "../../src/contracts/index.js";

export const labTasksDomainSpec = defineDomain({
	name: "lab_tasks",
	version: 0,
	tables: {
		lab_projects: domainTable(coreProjectSchema),
		project_memory_versions: domainTable(projectMemoryVersionSchema),
		project_sessions: domainTable(projectSessionSchema),
		literature_search_runs: domainTable(literatureSearchRunSchema),
		paper_source_bundles: domainTable(paperSourceBundleSchema),
		reading_reports: domainTable(readingReportSchema),
		presentation_runs: domainTable(presentationRunSchema),
		artifact_provenance: domainTable(artifactProvenanceSchema)
	}
});

