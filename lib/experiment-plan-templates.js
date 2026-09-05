import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { defaultExperimentPlanTemplate, experimentPlanTemplateKey, experimentPlanTemplateSchema } from "../src/experiment-plan-template.js";

export const labExperimentPlanTemplatesDomainSpec = defineDomain({
	name: "lab_experiment_plan_template_profiles", version: 0,
	tables: { experiment_plan_template_profiles: domainTable(experimentPlanTemplateSchema) }
});

export class LabExperimentPlanTemplatesService extends Service {
	static inject = ["storageDomain"];
	constructor(ctx, config = {}) {
		super(ctx, "labExperimentPlanTemplates");
		this.config = config ?? {};
	}
	async [Service.init]() {
		this.domain = await this.ctx.storageDomain.open(labExperimentPlanTemplatesDomainSpec);
		this.ctx.effect(() => () => this.domain.close(), "lab-agent.experimentPlanTemplates.domainClose");
		this.table = this.domain.table("experiment_plan_template_profiles");
	}
	rowsFor(id) { return [...this.table.keys()].filter((key) => key.startsWith(`${id}@`)).map((key) => this.table.get(key)).sort((a, b) => Number(b.version) - Number(a.version)); }
	latest(id) { const row = this.rowsFor(id)[0]; return row?.status === "active" ? row : undefined; }
	async seed() { if (!this.latest("experiment-plan-default")) { const row = defaultExperimentPlanTemplate(); await this.table.put(experimentPlanTemplateKey(row.id, row.version), row); } }
	nextVersion(id) { return String(this.rowsFor(id).reduce((max, row) => Math.max(max, Number(row.version)), 0) + 1); }
	async list() { await this.seed(); const ids = new Set(); const out = []; for (const key of this.table.keys()) { const row = this.table.get(key); if (ids.has(row.id)) continue; ids.add(row.id); const latest = this.latest(row.id); if (latest) out.push(latest); } return out; }
	async resolve(id, version) { await this.seed(); return version === undefined ? this.latest(id) : this.table.get(experimentPlanTemplateKey(id, String(version))); }
	async create(id, fields) { await this.seed(); if (this.rowsFor(id).length) throw new Error(`experiment plan template '${id}' already exists`); const now = new Date().toISOString(); const row = experimentPlanTemplateSchema.parse({ ...fields, id, version: "1", status: "active", createdAt: now, updatedAt: now }); await this.table.put(experimentPlanTemplateKey(id, "1"), row); return row; }
	async update(id, fields) { const base = await this.resolve(id); if (!base) throw new Error(`experiment plan template '${id}' not found`); const now = new Date().toISOString(); const version = this.nextVersion(id); const row = experimentPlanTemplateSchema.parse({ ...base, ...fields, id, version, status: "active", updatedAt: now }); await this.table.put(experimentPlanTemplateKey(id, version), row); return row; }
	async copy(id, newId, name) { const source = await this.resolve(id); if (!source) throw new Error(`experiment plan template '${id}' not found`); return this.create(newId, { ...source, name: name ?? `${source.name}（副本）` }); }
	async archive(id) { const base = await this.resolve(id); if (!base) throw new Error(`experiment plan template '${id}' not found`); const now = new Date().toISOString(); const version = this.nextVersion(id); const row = experimentPlanTemplateSchema.parse({ ...base, version, status: "archived", updatedAt: now }); await this.table.put(experimentPlanTemplateKey(id, version), row); return true; }
}

export default LabExperimentPlanTemplatesService;
