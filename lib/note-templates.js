/**
 * dsh-lab-agent: NoteTemplatesService（Cordis host service, ctx.labNoteTemplates）。
 *
 * 主面板「模板管理」的阅读笔记模板服务：用户创建/保存/复制/修改阅读笔记模板，
 * Agent 生成阅读笔记与汇报 PPT 时按模板生成（阅读笔记模板 → toNoteRequirements）。
 *
 * 版本语义与 labGoals/labTemplates 一致：版本行不可变（key id@version）；
 * update 发布新版本；delete 发布 archived 尾部版本；历史与任务快照永远可读。
 * 内置默认 `note-default` 幂等种子。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
	BUILTIN_NOTES,
	cloneNoteTemplate,
	nextNoteTemplateVersion,
	noteTemplateKey,
	noteTemplateSchema,
	toNoteRequirements
} from "../src/note-template.js";

/** Domain declaration: reading-note template profiles (own domain). */
export const labNoteTemplatesDomainSpec = defineDomain({
	name: "lab_note_template_profiles",
	version: 0,
	tables: {
		note_template_profiles: domainTable(noteTemplateSchema)
	}
});

export class LabNoteTemplatesService extends Service {
	static inject = ["storageDomain"];
	domain;
	table;

	constructor(ctx, config = {}) {
		super(ctx, "labNoteTemplates");
		this.config = config;
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labNoteTemplatesDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.notes.domainClose");
		this.domain = domain;
		this.table = domain.table("note_template_profiles");
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labNoteTemplates is not started yet");
		return this.table;
	}

	/** 该 id 的全部版本行（key id@*，新→旧）。 */
	rowsFor(id) {
		const table = this.requireTable();
		const rows = [];
		for (const k of table.keys()) {
			if (!k.startsWith(`${id}@`)) continue;
			rows.push(table.get(k));
		}
		return rows.sort((a, b) => Number(b.version) - Number(a.version));
	}

	/** 当前可用版本：最大版本行且 status 为 active。 */
	latestActive(id) {
		const rows = this.rowsFor(id);
		const newest = rows[0];
		return newest !== undefined && newest.status === "active" ? newest : undefined;
	}

	/** 幂等种子内置默认模板（仅缺省时写入；失败只告警）。 */
	async ensureSeed() {
		for (const builtin of BUILTIN_NOTES) {
			if (this.latestActive(builtin.id) !== undefined) continue;
			try {
				await this.requireTable().put(noteTemplateKey(builtin.id, builtin.version), builtin);
			} catch (error) {
				this.ctx.logger.warn(`labNoteTemplates: seed '${builtin.id}' failed: ${String(error)}`);
			}
		}
	}

	/** 可用模板列表（每个 id 当前版本的摘要）。 */
	async list() {
		await this.ensureSeed();
		const table = this.requireTable();
		const seen = new Set();
		const out = [];
		for (const k of [...table.keys()].sort().reverse()) {
			const row = table.get(k);
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			if (row.status !== "active") continue;
			out.push({ id: row.id, version: row.version, name: row.name, topics: row.topics, tags: row.tags, updatedAt: row.updatedAt });
		}
		return out;
	}

	/** 解析模板版本行；version 缺省取最新 active。历史/archived 版本始终可读。 */
	async resolve(id, version) {
		await this.ensureSeed();
		if (version !== undefined) {
			const row = this.requireTable().get(noteTemplateKey(id, String(version)));
			return row === undefined ? undefined : this.sanitize(row);
		}
		const row = this.latestActive(id);
		return row === undefined ? undefined : this.sanitize(row);
	}

	/** 移除内部 meta，避免把 status/createdAt 暴露给编辑表单。 */
	sanitize(row) {
		const { status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = row;
		return { ...rest, id: rest.id, version: rest.version };
	}

	/** 创建模板 v1（主面板「新建阅读笔记模板」）。 */
	async create(id, fields) {
		await this.ensureSeed();
		if (this.rowsFor(id).length > 0) throw new Error(`note template '${id}' already exists (active or archived; ids are never reused)`);
		const now = new Date().toISOString();
		const row = noteTemplateSchema.parse({ ...fields, id, version: "1", status: "active", createdAt: now, updatedAt: now });
		await this.requireTable().put(noteTemplateKey(id, "1"), row);
		return this.sanitize(row);
	}

	/** 修改模板：基于最新 active 版本发布新版本（旧版本/旧笔记引用不变）。 */
	async update(id, fields) {
		await this.ensureSeed();
		const base = this.latestActive(id);
		if (base === undefined) throw new Error(`note template '${id}' not found`);
		const now = new Date().toISOString();
		const version = nextNoteTemplateVersion(this.rowsFor(id).map((r) => r.version));
		const row = noteTemplateSchema.parse({ ...base, ...fields, id, version, status: "active", updatedAt: now });
		await this.requireTable().put(noteTemplateKey(id, version), row);
		return this.sanitize(row);
	}

	/** 复制模板为新 id（v1）。 */
	async copy(id, newId, name) {
		await this.ensureSeed();
		const source = this.latestActive(id);
		if (source === undefined) throw new Error(`note template '${id}' not found`);
		if (this.rowsFor(newId).length > 0) throw new Error(`note template '${newId}' already exists (active or archived)`);
		const row = cloneNoteTemplate(source, newId, name ?? `${source.name}（副本）`);
		await this.requireTable().put(noteTemplateKey(newId, "1"), row);
		return this.sanitize(row);
	}

	/** 删除模板（从可用列表移除；历史版本仍可读）。 */
	async deleteProfile(id) {
		await this.ensureSeed();
		const base = this.latestActive(id);
		if (base === undefined) throw new Error(`note template '${id}' not found`);
		const now = new Date().toISOString();
		const version = nextNoteTemplateVersion(this.rowsFor(id).map((r) => r.version));
		const row = { ...base, version, status: "archived", updatedAt: now };
		await this.requireTable().put(noteTemplateKey(id, version), row);
		return true;
	}

	/** 任务快照：返回模板版本的深拷贝（任务保存引用；后续修改不影响旧笔记）。 */
	async snapshotForTask(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`note template '${id}'@${version ?? "latest"} not found`);
		return structuredClone(row);
	}

	/** 转换为模型可直接使用的阅读笔记生成要求。 */
	toNoteRequirements(template) {
		return toNoteRequirements(template);
	}
}

export default LabNoteTemplatesService;
