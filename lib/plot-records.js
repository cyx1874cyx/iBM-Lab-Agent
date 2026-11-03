import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { plotRecordSchema, todayLocal } from "../src/plot/models.js";
import {plotWorkspaceMethods} from './plot-workspace.js';
import {plotImageMethods} from './plot-images.js';
import {plotLayoutMethods} from './plot-layouts.js';

export const labPlotRecordsDomainSpec = defineDomain({
	name: "lab_plot_records", version: 0,
	tables: { plot_records: domainTable(plotRecordSchema) }
});

export class LabPlotRecordsService extends Service {
	static inject = ["storageDomain", "ibmCore"];
	constructor(ctx, config = {}) {
		super(ctx, "labPlotRecords");
		this.config = config ?? {};
	}
	async [Service.init]() {
		this.plotClosed=false;this.plotJobs=new Map();this.plotStarting=new Set();this.plotPreviews=new Map();this.plotPreviewCache=new Map();
		this.domain = await this.ctx.storageDomain.open(labPlotRecordsDomainSpec);
		const projectFiles = this.ctx.get('ibmCore')?.projectFiles;
		if (projectFiles) this.domain = await projectFiles.attachDomain(labPlotRecordsDomainSpec, this.domain);
		this.ctx.effect(() => () => this.domain.close(), "lab-agent.plotRecords.domainClose");
		this.table = this.domain.table("plot_records");
		for(const id of this.table.keys()){
		 const row=this.table.get(id);
		 if(row.workflow&&['analyzing','recommending','generating','saving'].includes(row.workflow.status))await this.update(id,{workflow:{...row.workflow,status:'failed',stage:'上次操作已中断',error:'应用已重启；原始数据及上次保存的工程仍保留，请重试。'}});
		}
		this.ctx.effect(()=>async()=>{this.plotClosed=true;for(const value of this.plotJobs.values())value.controller.abort(Error('绘图服务已停止'));for(const value of this.plotPreviews.values())value.controller.abort(Error('绘图服务已停止'));await Promise.allSettled([...this.plotJobs.values(),...this.plotPreviews.values()].map(value=>value.job));},'lab.plot-workspace.stop');
	}
	async list(projectId) {
		const rows = [...this.table.keys()].map((key) => this.table.get(key));
		return (projectId ? rows.filter((row) => row.projectId === projectId) : rows).map(row=>{
		 const state=this.plotPreviews?.get(row.id);
		 return state&&row.workflow?{...row,workflow:{...row.workflow,...(state.current?{quickPreview:state.current}:{}),quickStatus:{pending:!!state.job,error:state.error||null}}}:row;
		});
	}
	async get(id) {
		return this.table.get(id) ?? null;
	}
	async bindConversation({projectId,id,sessionId}) {
		const row=await this.get(id);
		if(!row||row.projectId!==projectId||!row.workflow)throw Error('绘图条目不存在或不属于当前课题');
		if(typeof sessionId!=='string'||!sessionId.trim())throw Error('对话标识无效');
		return this.update(id,{conversationSessionId:sessionId});
	}
	async create({ id, projectId, topic, date, artifactPath, taskId, source = "manual", notes }) {
		if (this.table.get(id) !== undefined) throw new Error(`plot record '${id}' already exists`);
		const cleanTopic = String(topic ?? "").trim();
		if (!cleanTopic) throw new Error("plot record topic required");
		const now = new Date().toISOString();
		const row = plotRecordSchema.parse({
			id, projectId, topic: cleanTopic,
			date: date ?? todayLocal(),
			artifactPath, taskId, source, notes,
			createdAt: now, updatedAt: now
		});
		await this.table.put(id, row);
		return this.table.get(id);
	}
	async update(id, patch) {
		const base = this.table.get(id);
		if (base === undefined) throw new Error(`plot record '${id}' not found`);
		const cleanTopic = patch.topic !== undefined ? String(patch.topic).trim() : base.topic;
		if (!cleanTopic) throw new Error("plot record topic required");
		const row = plotRecordSchema.parse({
			...base,
			...patch,
			id: base.id, projectId: base.projectId, createdAt: base.createdAt,
			topic: cleanTopic,
			date: patch.date ?? base.date,
			updatedAt: new Date().toISOString()
		});
		await this.table.put(id, row);
		return this.table.get(id);
	}
	async remove(id) {
		if(this.plotStarting.has(id))throw Error('绘图条目正在处理，请等待完成后移除');
		if(this.plotJobs.has(id))throw Error('绘图条目正在处理，请等待完成后移除');
		if(this.plotPreviews.get(id)?.job)throw Error('绘图预览正在更新，请等待完成后移除');
		if (this.table.get(id) === undefined) throw new Error(`plot record '${id}' not found`);
		await this.table.delete(id);
		this.plotPreviews.delete(id);
		for(const key of this.plotPreviewCache.keys())if(key.split(':')[1]===id)this.plotPreviewCache.delete(key);
		return true;
	}
}
Object.assign(LabPlotRecordsService.prototype,plotWorkspaceMethods);
Object.assign(LabPlotRecordsService.prototype,plotImageMethods);
Object.assign(LabPlotRecordsService.prototype,plotLayoutMethods);

export default LabPlotRecordsService;
