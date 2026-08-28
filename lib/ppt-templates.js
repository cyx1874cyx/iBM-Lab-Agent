/**
 * dsh-lab-agent: PptTemplateProfile 服务（Cordis host service, ctx.labTemplates）。
 *
 * 计划 §四：PPTX 主题 + 版式角色映射的模板导入/发布/验证流程：
 *   上传 → 解析（页面比例/主题/母版/布局/占位符）→ 自动映射建议 →
 *   预览/填充示例 → 用户确认或调整 → 验证 → 发布为可选版本。
 * 映射无效时 validate() 明确失败，不静默替换为默认模板。
 *
 * 源文件存 $DSH_HOME/lab-agent/templates/<id>/v<version>/source.pptx（+parse.json），
 * domain 行记录元数据与文件哈希（ArtifactProvenance 前身）。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
	BUILTIN_TEMPLATES,
	LAYOUT_ROLES,
	pptTemplateProfileSchema,
	suggestRoleMapping,
	templateKey,
	nextTemplateVersion,
	validateTemplate
} from "../src/ppt-template.js";
import { parsePptx } from "../src/pptx-parse.js";

export const labTemplatesDomainSpec = defineDomain({
	name: "lab_ppt_template_profiles",
	version: 0,
	tables: {
		ppt_template_profiles: domainTable(pptTemplateProfileSchema)
	}
});

export class LabTemplatesService extends Service {
	static inject = ["storageDomain"];
	domain;
	table;

	/** @param config {{ templatesDir?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labTemplates");
		this.config = config;
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labTemplatesDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.templates.domainClose");
		this.domain = domain;
		this.table = domain.table("ppt_template_profiles");
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labTemplates is not started yet");
		return this.table;
	}

	requireTemplatesDir() {
		if (!this.config.templatesDir) throw new Error("labTemplates requires config.templatesDir");
		return this.config.templatesDir;
	}

	rowsFor(id) {
		const table = this.requireTable();
		const rows = [];
		for (const k of table.keys()) {
			if (!k.startsWith(`${id}@`)) continue;
			rows.push(table.get(k));
		}
		return rows.sort((a, b) => Number(b.version) - Number(a.version));
	}

	latestActive(id) {
		const rows = this.rowsFor(id);
		const newest = rows[0];
		return newest !== undefined && newest.status !== "archived" ? newest : undefined;
	}

	/** 幂等种子内置默认模板（nature-default）。 */
	async ensureSeed() {
		for (const builtin of BUILTIN_TEMPLATES) {
			const rows = this.rowsFor(builtin.id);
			if (rows[0] !== undefined && rows[0].status !== "archived") continue;
			try {
				// Older releases allowed the built-in template to be archived. Its v1
				// row then remained in storage, so repeatedly trying to reinsert v1
				// could never restore it. Publish a fresh ready version instead.
				const now = new Date().toISOString();
				const version = rows.length === 0 ? builtin.version : nextTemplateVersion(rows.map((row) => row.version));
				const seeded = pptTemplateProfileSchema.parse({ ...builtin, version, createdAt: now, updatedAt: now });
				await this.requireTable().put(templateKey(builtin.id, version), seeded);
			} catch (error) {
				this.ctx.logger.warn(`labTemplates: seed '${builtin.id}' failed: ${String(error)}`);
			}
		}
	}

	/** 可选模板列表（每个 id 当前版本摘要）。 */
	async list() {
		await this.ensureSeed();
		const table = this.requireTable();
		const seen = new Set();
		const out = [];
		// 倒序遍历：每个 id 首次遇到即最新版本，其状态决定是否列出
		for (const k of [...table.keys()].sort().reverse()) {
			const row = table.get(k);
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			if (row.status === "archived") continue;
			out.push({
				id: row.id,
				version: row.version,
				name: row.name,
				status: row.status,
				pageSize: row.pageSize,
				builtIn: row.source.file === "(nature-default)",
				updatedAt: row.updatedAt
			});
		}
		return out;
	}

	/** 解析模板版本行；version 缺省取最新。 */
	async resolve(id, version) {
		await this.ensureSeed();
		if (version !== undefined) {
			const row = this.requireTable().get(templateKey(id, String(version)));
			return row === undefined ? undefined : { ...row };
		}
		const row = this.latestActive(id);
		return row === undefined ? undefined : { ...row };
	}

	/**
	 * 导入 PPTX：解析结构 → 自动映射建议 → 写源文件与 parse.json →
	 * 存 draft 版本。用户随后 confirmMapping 发布。
	 */
	async importPptx(id, { pptxPath, meta = {} }) {
		await this.ensureSeed();
		if (this.rowsFor(id).length > 0) throw new Error(`template '${id}' already exists (active or archived; ids are never reused)`);
		const buffer = await readFile(pptxPath);
		const parsed = await parsePptx(buffer);
		const sha256 = createHash("sha256").update(buffer).digest("hex");
		const suggestions = suggestRoleMapping(parsed.layouts, parsed.page);

		const version = "1";
		const dir = join(this.requireTemplatesDir(), id, `v${version}`);
		await mkdir(dir, { recursive: true });
		const file = join(dir, "source.pptx");
		await writeFile(file, buffer);
		await writeFile(join(dir, "parse.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
		await writeFile(join(dir, "mapping-suggestions.json"), `${JSON.stringify(suggestions, null, 2)}\n`, "utf8");

		const now = new Date().toISOString();
		const row = pptTemplateProfileSchema.parse({
			id,
			version,
			name: meta.name ?? id,
			purpose: meta.purpose ?? "",
			audience: meta.audience ?? "课题组组会",
			pageSize: { ratio: parsed.page.ratio ?? "unknown", type: parsed.page.type },
			theme: parsed.theme ?? {},
			logo: meta.logo,
			footerRules: meta.footerRules ?? "",
			layoutRoleMapping: Object.fromEntries(
				LAYOUT_ROLES.map((role) => [role, { layoutId: suggestions[role].layoutId, notes: suggestions[role].reason }])
			),
			requiredPages: meta.requiredPages ?? ["cover", "summary"],
			optionalPages: meta.optionalPages ?? ["appendix"],
			maxPages: meta.maxPages,
			notesRequirement: meta.notesRequirement ?? "",
			placeholderRules: meta.placeholderRules ?? {},
			source: { file, sha256 },
			status: "draft",
			createdAt: now,
			updatedAt: now
		});
		await this.requireTable().put(templateKey(id, version), row);
		return { profile: { ...row }, parsed, suggestions };
	}

	/**
	 * 浏览器上传（base64）导入：写入 templatesDir/.uploads 临时文件后走
	 * importPptx，导入完成清理临时文件。返回与 importPptx 一致的结构。
	 */
	async importPptxUpload(id, { name, base64, meta = {} }) {
		await this.ensureSeed();
		const uploadsDir = join(this.requireTemplatesDir(), ".uploads");
		await mkdir(uploadsDir, { recursive: true });
		const tmp = join(uploadsDir, `${Date.now().toString(36)}-${id.replace(/[^\w.-]/g, "_")}.pptx`);
		await writeFile(tmp, Buffer.from(base64, "base64"));
		try {
			return await this.importPptx(id, { pptxPath: tmp, meta: { ...meta, name: meta.name ?? id } });
		} finally {
			await rm(tmp, { force: true }).catch(() => {});
		}
	}

	/**
	 * 用户确认/调整映射并发布。映射无效（引用未知布局 / ready 缺角色）时
	 * 明确拒绝 —— 不静默替换为默认模板。
	 */
	async confirmMapping(id, version, mapping) {
		const base = await this.resolve(id, version);
		if (base === undefined) throw new Error(`template '${id}'@${version} not found`);
		const parsed = JSON.parse(await readFile(join(dirname(base.source.file), "parse.json"), "utf8"));
		const next = {
			...base,
			layoutRoleMapping: mapping,
			status: "ready",
			updatedAt: new Date().toISOString()
		};
		const result = validateTemplate(next, parsed);
		if (!result.ok) {
			return { ok: false, problems: result.problems };
		}
		await this.requireTable().put(templateKey(id, version), next);
		return { ok: true, profile: { ...next } };
	}

	/** 发布/生成前验证（含默认模板的 nature-default 无源文件场景）。 */
	async validate(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source.file === "(nature-default)") {
			return { ok: true, problems: [], natureDefault: true };
		}
		let parsed;
		try {
			parsed = JSON.parse(await readFile(join(dirname(row.source.file), "parse.json"), "utf8"));
		} catch {
			parsed = undefined;
		}
		return validateTemplate(row, parsed);
	}

	/** 填充示例与预览（计划 §四 步骤 4）：每角色 → 布局 + 占位符 + 建议内容。 */
	async preview(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source.file === "(nature-default)") {
			return { id, version, natureDefault: true, roles: LAYOUT_ROLES.map((r) => ({ role: r, layoutId: "nature-default" })) };
		}
		const parsed = JSON.parse(await readFile(join(dirname(row.source.file), "parse.json"), "utf8"));
		const layoutsById = new Map(parsed.layouts.map((l) => [l.id, l]));
		const roles = LAYOUT_ROLES.map((role) => {
			const mapping = row.layoutRoleMapping[role];
			const layout = layoutsById.get(mapping?.layoutId);
			return {
				role,
				layoutId: mapping?.layoutId,
				layoutName: layout?.name,
				placeholders: layout?.placeholders ?? [],
				exampleTitle: `${role} 示例标题`,
				exampleContent: role === "full-figure" ? "[整页图]" : `${role} 示例内容（证据来自精读报告来源块）`
			};
		});
		return { id, version, pageSize: row.pageSize, theme: row.theme, roles };
	}

	/** 修改模板元数据（名称/用途/受众/必选页/最大页数/备注要求等）：
	 *  基于最新版本发布新版本；源文件与解析结果沿用旧版本。 */
	async updateMeta(id, fields) {
		await this.ensureSeed();
		const base = this.latestActive(id);
		if (base === undefined) throw new Error(`template '${id}' not found`);
		const now = new Date().toISOString();
		const version = nextTemplateVersion(this.rowsFor(id).map((r) => r.version));
		const next = {
			...base,
			...pickFields(fields, ["name", "purpose", "audience", "requiredPages", "optionalPages", "maxPages", "notesRequirement", "footerRules", "logo"]),
			version,
			status: base.status === "draft" ? "draft" : "ready",
			updatedAt: now
		};
		await this.requireTable().put(templateKey(id, version), next);
		return { id: next.id, version: next.version, name: next.name, status: next.status };
	}

	/** 删除模板（从可用列表移除；历史版本仍可读）。 */
	async deleteProfile(id) {
		const base = this.latestActive(id);
		if (base === undefined) throw new Error(`template '${id}' not found`);
		if (BUILTIN_TEMPLATES.some((template) => template.id === id)) {
			throw new Error(`built-in template '${id}' cannot be archived`);
		}
		if (base.source.file !== "(nature-default)") {
			await rm(join(this.requireTemplatesDir(), id), { recursive: true, force: true });
		}
		const now = new Date().toISOString();
		const version = nextTemplateVersion(this.rowsFor(id).map((r) => r.version));
		const row = { ...base, version, status: "archived", updatedAt: now };
		await this.requireTable().put(templateKey(id, version), row);
		return true;
	}
}

export default LabTemplatesService;

/** 只挑选 fields 中 allowlist 里存在的键（其余忽略）。 */
export function pickFields(fields = {}, allow = []) {
	const out = {};
	for (const key of allow) {
		if (fields[key] !== undefined) out[key] = fields[key];
	}
	return out;
}
