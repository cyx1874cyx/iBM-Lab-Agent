import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { plotRecordSchema, todayLocal } from "../src/plot/models.js";

export const labPlotRecordsDomainSpec = defineDomain({
	name: "lab_plot_records", version: 0,
	tables: { plot_records: domainTable(plotRecordSchema) }
});

export class LabPlotRecordsService extends Service {
	static inject = ["storageDomain"];
	constructor(ctx, config = {}) {
		super(ctx, "labPlotRecords");
		this.config = config ?? {};
	}
	async [Service.init]() {
		this.domain = await this.ctx.storageDomain.open(labPlotRecordsDomainSpec);
		this.ctx.effect(() => () => this.domain.close(), "lab-agent.plotRecords.domainClose");
		this.table = this.domain.table("plot_records");
	}
	async list(projectId) {
		const rows = [...this.table.keys()].map((key) => this.table.get(key));
		return projectId ? rows.filter((row) => row.projectId === projectId) : rows;
	}
	async get(id) {
		return this.table.get(id) ?? null;
	}
	async create({ id, projectId, topic, date, artifactPath, source = "manual", notes }) {
		if (this.table.get(id) !== undefined) throw new Error(`plot record '${id}' already exists`);
		const cleanTopic = String(topic ?? "").trim();
		if (!cleanTopic) throw new Error("plot record topic required");
		const now = new Date().toISOString();
		const row = plotRecordSchema.parse({
			id, projectId, topic: cleanTopic,
			date: date ?? todayLocal(),
			artifactPath, source, notes,
			createdAt: now, updatedAt: now
		});
		await this.table.put(id, row);
		return row;
	}
	async update(id, patch) {
		const base = this.table.get(id);
		if (base === undefined) throw new Error(`plot record '${id}' not found`);
		const cleanTopic = patch.topic !== undefined ? String(patch.topic).trim() : base.topic;
		if (!cleanTopic) throw new Error("plot record topic required");
		const row = plotRecordSchema.parse({
			...base,
			...patch,
			topic: cleanTopic,
			date: patch.date ?? base.date,
			updatedAt: new Date().toISOString()
		});
		await this.table.put(id, row);
		return row;
	}
	async remove(id) {
		if (this.table.get(id) === undefined) throw new Error(`plot record '${id}' not found`);
		await this.table.delete(id);
		return true;
	}
}

export default LabPlotRecordsService;
