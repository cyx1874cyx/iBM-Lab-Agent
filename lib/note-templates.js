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
	parseNoteTemplateMarkdown,
	toNoteRequirements
} from "../src/note-template.js";

/** "latest"/空串/null 一律视为「未指定版本」。
 *
 * Agent 很自然会传字面量 "latest"（历史错误文案本身也写成 '@latest'），若直接拼 key
 * 就会去找 `note-default@latest` 这种不存在的行，永远 not found。
 * 同源实现见 lib/goal-profiles.js 的 normalizeGoalVersion。
 */
function normalizeTemplateVersion(version) {
	if (version === undefined || version === null) return undefined;
	const text = String(version).trim();
	if (text === "" || text.toLowerCase() === "latest") return undefined;
	return text;
}

/** not-found 信息要能直接指导下一步：列出该 id 的实际版本，而不是只回一个 "@latest"。 */
function noteTemplateMissMessage(service, id, version) {
	const wanted = normalizeTemplateVersion(version);
	const rows = service.rowsFor(id);
	const available = rows.map((row) => `${row.version}${row.status === "active" ? "" : "(archived)"}`);
	if (available.length === 0) {
		return `note template '${id}' not found（该 id 没有任何版本；先用 lab_note_templates_list 查看可用模板）`;
	}
	if (wanted !== undefined) {
		return `note template '${id}'@${wanted} not found（该 id 的可用版本：${available.join(", ")}）`;
	}
	return `note template '${id}' 没有 active 版本（已有版本：${available.join(", ")}；archived 版本需显式指定版本号）`;
}

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

	/** 当前可用版本：最大版本行且 status 为 active。
	 *
	 * 这是**有意的删除语义**（见文件头：delete = 追加 archived 尾部版本）：最新版本行
	 * 的状态就是该 id 的当前状态，所以删除后"没有 active 版本"是正确结论，不能回退到
	 * 仍然 active 的旧版本 —— 那等于让已删除的模板复活，也会打破
	 * tests/integration/notes.test.mjs 的删除断言。
	 */
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

	/**
	 * 可用模板列表（每个 id 当前版本的摘要）。
	 * @param kind 可选：`note`（单篇阅读笔记）/ `review`（多篇文献综述）；缺省返回全部。
	 */
	async list(kind) {
		await this.ensureSeed();
		const table = this.requireTable();
		const seen = new Set();
		const out = [];
		// 倒序遍历：每个 id 首次遇到即最新版本，其状态决定是否列出（删除后不再列出）。
		for (const k of [...table.keys()].sort().reverse()) {
			const row = table.get(k);
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			if (row.status !== "active") continue;
			if (kind !== undefined && row.kind !== kind) continue;
			out.push({ id: row.id, version: row.version, kind: row.kind, name: row.name, topics: row.topics, tags: row.tags, updatedAt: row.updatedAt });
		}
		return out;
	}

	/** 综述模板（kind=review）——文献综述写作专用入口。 */
	async listReviewTemplates() {
		return this.list("review");
	}

	/** 解析模板版本行；version 缺省（含 "latest"/空串）取最新 active。历史/archived 版本始终可读。 */
	async resolve(id, version) {
		await this.ensureSeed();
		const wanted = normalizeTemplateVersion(version);
		if (wanted !== undefined) {
			const row = this.requireTable().get(noteTemplateKey(id, wanted));
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

	/**
	 * 解析 Markdown 文本 → 可编辑模板字段（不落库）。
	 * 供主面板「从 .md 导入」先预览结构，也供 importMarkdown 复用。
	 */
	parseMarkdown(markdown, { fileName } = {}) {
		const parsed = parseNoteTemplateMarkdown(markdown, { fileName });
		return { ...parsed, minContentChars: parsed.minContentChars };
	}

	/**
	 * 从 Markdown 导入一个新模板（v1）：把 `##` 章节解析成真实章节骨架，
	 * 原文保存在 templateMarkdown，生成契约以它为准。
	 * @returns {{ template: object, parsed: object }}
	 */
	async importMarkdown(id, { name, markdown, fileName, meta = {} } = {}) {
		await this.ensureSeed();
		if (this.rowsFor(id).length > 0) throw new Error(`note template '${id}' already exists (active or archived; ids are never reused)`);
		if (!String(markdown ?? "").trim()) throw new Error("markdown is empty");
		const parsed = parseNoteTemplateMarkdown(markdown, { fileName });
		const fields = {
			name: name?.trim() || parsed.name,
			sections: parsed.sections,
			templateMarkdown: parsed.templateMarkdown,
			...(parsed.length ? { length: parsed.length } : {}),
			...(meta.audience ? { audience: meta.audience } : {}),
			...(Array.isArray(meta.topics) ? { topics: meta.topics } : {}),
			...(Array.isArray(meta.tags) ? { tags: meta.tags } : {}),
			remark: meta.remark || `从 Markdown 导入：${fileName || parsed.name}`
		};
		const template = await this.create(id, fields);
		return { template, parsed };
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
		if (row === undefined) throw new Error(noteTemplateMissMessage(this, id, version));
		return structuredClone(row);
	}

	/** 转换为模型可直接使用的阅读笔记生成要求。 */
	toNoteRequirements(template) {
		return toNoteRequirements(template);
	}
}

export default LabNoteTemplatesService;
