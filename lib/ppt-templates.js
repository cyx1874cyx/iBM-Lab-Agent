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
import { deriveSlotSpec } from "../src/ppt-slot-spec.js";
import { renderTemplateGuide } from "../src/ppt-template-guide.js";
import { venvDir, venvPython } from "../src/paths.js";
import {
	initTemplateManifest,
	loadManifestPackage,
	probePptxCli,
	summarizeManifest,
	templateTypography
} from "./pptx-manifest.js";
import {
	SLOTS_SPEC_FILE,
	humanSummary as lintHumanSummary,
	lintTemplatePackage,
	readSlotSpec,
	writeLintReport
} from "./ppt-template-lint.js";

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
	 * 读取某个模板版本的解析结构（parse.json）：页面比例/主题/母版/布局/占位符。
	 * nature-default 虚拟模板无源文件，返回 undefined；文件缺失也返回 undefined
	 * （调用方自行决定是否降级为「未校验」）。
	 */
	async parsed(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) return undefined;
		if (row.source.file === "(nature-default)") return undefined;
		try {
			return JSON.parse(await readFile(join(dirname(row.source.file), "parse.json"), "utf8"));
		} catch {
			return undefined;
		}
	}

	/**
	 * pptx-cli 的解释器选项：显式配置优先，否则用统一 resolver 的
	 * 「bundled（桌面注入）→ 托管 venv（Linux/.dsh）→ 系统 python」顺序。
	 * venv 必须显式传：Linux 线的 pptx-cli 装在 $DSH_HOME/lab-agent/.venv 里，
	 * 只靠 PATH 上的 python3 是找不到的。
	 */
	cliPythonOptions(extra = {}) {
		const configured = this.config?.pptxCliPython;
		return {
			...(configured ? { python: configured } : {}),
			venvPython: this.config?.venvPython ?? venvPython(venvDir()),
			...extra
		};
	}

	/** 该模板版本目录下的派生文件路径。 */
	versionPaths(versionDir) {
		return {
			versionDir,
			manifestDir: join(versionDir, "manifest"),
			slotsPath: join(versionDir, SLOTS_SPEC_FILE),
			lintPath: join(versionDir, TEMPLATE_LINT_FILE),
			guidePath: join(versionDir, TEMPLATE_GUIDE_FILE)
		};
	}

	/** 由模板版本行（{source.file}）反推版本目录与派生文件路径。 */
	pathsForRow(row) {
		return this.versionPaths(dirname(row.source.file));
	}

	/**
	 * 生成/刷新 manifest 包 + slots.json + GUIDE.md + lint.json。
	 *
	 * 导入本身仍然容错（pptx-cli 缺失时不阻断导入、清理半成品目录、也绝不留下"看着像
	 * manifest 但其实是半截"的产物），因为开发/CI 环境可能没有 pptx-cli。
	 * **但这样的模板不可用**：0.5.5-beta3 起标准流程不再有旧路径 —— 取生成契约时会直接报错，
	 * 要求重新导入（模板 id 不复用）后再用。返回 `{source: "fallback", reason}` 时调用方会把
	 * `manifestSource` 标出来。
	 */
	async prepareManifestPackage({ versionDir, sourceFile, id, version, manifest } = {}) {
		const paths = this.versionPaths(versionDir);
		const cli = this.cliPythonOptions();
		const probe = await probePptxCli({ ...cli, timeoutMs: 30000 });
		if (!probe.available) {
			return { source: "fallback", reason: probe.hint, python: probe.python ?? null, paths };
		}
		const init = await initTemplateManifest({ pptxPath: sourceFile, outDir: paths.manifestDir, timeoutMs: 180000, ...cli });
		if (!init.ok) {
			await rm(paths.manifestDir, { recursive: true, force: true }).catch(() => {});
			return { source: "fallback", reason: init.error ?? "pptx-cli init 失败", errors: init.errors ?? [], python: probe.python, paths };
		}
		const lint = await this.writeDerivedArtifacts({ paths, id, version, cliVersion: probe.version, template: manifest, cli });
		return {
			source: "manifest",
			dir: paths.manifestDir,
			cliVersion: probe.version,
			python: probe.python,
			slotSpec: lint?.slotSpec,
			lint: lint?.report,
			guidePath: paths.guidePath,
			slotsPath: paths.slotsPath,
			lintPath: paths.lintPath
		};
	}

	/**
	 * 由已有 manifest 派生 slots.json / lint.json / GUIDE.md（导入与重新体检共用）。
	 * @returns {{slotSpec?: object, report?: object}}
	 */
	async writeDerivedArtifacts({ paths, id, version, cliVersion, template, cli, baselineManifestDir }) {
		const pkg = await loadManifestPackage(paths.manifestDir);
		if (!pkg.ok) {
			this.ctx.logger.warn(`labTemplates: manifest 包不可读：${pkg.findings.map((finding) => finding.message).join("; ")}`);
			return {};
		}
		const summary = summarizeManifest(pkg.manifest);
		// slots.json 的容量必须来自**模板真实排版**（行距/段前后/内边距）。本模板正文是固定
		// 30pt 行距，不接这一步会退化成默认 1.2 倍模型 —— 也就是 pptx-cli 那个高估 36% 的数字。
		const typography = await templateTypography(pkg, summary.layouts);
		const slotSpec = deriveSlotSpec(summary, {
			minFontPt: template?.placeholderRules?.minFontPt,
			typography,
			templateRef: {
				name: summary.template?.name,
				sha256: summary.template?.sourceHash,
				manifest: "manifest",
				capturedAt: summary.template?.extractedAt
			}
		});
		await writeFile(paths.slotsPath, `${JSON.stringify(slotSpec, null, 2)}\n`, "utf8");
		const report = await lintTemplatePackage({
			manifestDir: paths.manifestDir,
			template: { id, version, name: template?.name, pptxCliVersion: cliVersion },
			baselineManifestDir,
			cli
		});
		report.template.python = report.template.python ?? undefined;
		report.humanSummary = lintHumanSummary(report);
		await writeLintReport(paths.versionDir, report);
		await writeFile(paths.guidePath, `${renderTemplateGuide({
			template: { id, version, name: template?.name, audience: template?.audience, purpose: template?.purpose, pageSize: template?.pageSize, maxPages: template?.maxPages, requiredPages: template?.requiredPages },
			slotSpec,
			lintReport: report,
			manifestInfo: { manifestDir: "manifest/", sha256: summary.template?.sourceHash },
			cliVersion
		})}\n`, "utf8");
		return { slotSpec, report, summary };
	}

	/** 读 manifest 包（只读；pptx-cli 缺失时 manifest 目录本来就不存在）。 */
	async manifestPackage(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source?.file === "(nature-default)") return undefined;
		const paths = this.pathsForRow(row);
		const pkg = await loadManifestPackage(paths.manifestDir);
		return pkg.ok ? { ...pkg, paths } : { ok: false, paths, findings: pkg.findings };
	}

	/** 读 slots.json（槽位规范）。 */
	async slotSpec(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source?.file === "(nature-default)") return undefined;
		return await readSlotSpec(this.pathsForRow(row).slotsPath);
	}

	/** 读 lint.json（体检报告）。 */
	async lintReport(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source?.file === "(nature-default)") return undefined;
		try {
			return JSON.parse(await readFile(this.pathsForRow(row).lintPath, "utf8"));
		} catch {
			return undefined;
		}
	}

	/** 读 GUIDE.md（填充指南）。 */
	async guide(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source?.file === "(nature-default)") return undefined;
		try {
			return await readFile(this.pathsForRow(row).guidePath, "utf8");
		} catch {
			return undefined;
		}
	}

	/**
	 * 重新体检（模板被改动/落后于代码时用）：重跑 lint、刷新 lint.json 与 GUIDE.md。
	 * manifest 缺失时返回降级说明而不是抛。
	 */
	async relint(id, version, { baselineManifestDir } = {}) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`template '${id}'@${version} not found`);
		if (row.source?.file === "(nature-default)") return { ok: false, manifestSource: "virtual", reason: "nature-default 没有实体模板，无法体检" };
		const paths = this.pathsForRow(row);
		const pkg = await loadManifestPackage(paths.manifestDir);
		if (!pkg.ok) {
			return {
				ok: false,
				manifestSource: "fallback",
				reason: "该模板没有 pptx-cli manifest（导入时 pptx-cli 不可用，或导入早于本功能）；标准流程不再支持旧路径 —— 请用新 id 重新导入该模板（模板 id 不复用）",
				findings: pkg.findings
			};
		}
		const probe = await probePptxCli(this.cliPythonOptions({ timeoutMs: 30000 }));
		const derived = await this.writeDerivedArtifacts({
			paths,
			id: row.id,
			version: row.version,
			cliVersion: probe.available ? probe.version : undefined,
			template: row,
			cli: this.cliPythonOptions(),
			baselineManifestDir
		});
		return { ok: derived.report?.ok !== false, manifestSource: "manifest", report: derived.report, paths };
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

		// manifest 包 + 派生件（slots.json / GUIDE.md / lint.json）。导入仍然容错（不阻断导入、
		// 不留半成品），但**没有这组派生件的模板不能用来生成 PPT** —— 取契约时会明确报错，
		// 要求按标准流程重新导入（0.5.5-beta3 起取消旧路径）。
		const manifest = await this.prepareManifestPackage({
			versionDir: dir,
			sourceFile: file,
			id,
			version,
			manifest: { name: meta.name ?? id, placeholderRules: meta.placeholderRules ?? {}, requiredPages: meta.requiredPages ?? ["cover", "summary"], maxPages: meta.maxPages, audience: meta.audience ?? "课题组组会", purpose: meta.purpose ?? "", pageSize: { ratio: parsed.page.ratio ?? "unknown" } }
		});
		if (manifest.source !== "manifest") {
			this.ctx.logger.warn(
				`labTemplates: '${id}' 未生成 manifest 派生件（manifestSource=fallback）：${manifest.reason} —— ` +
				"该模板**不能用于生成 PPT**，请在该环境具备 pptx-cli 后用新 id 重新导入。"
			);
		}

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
		return {
			profile: { ...row },
			parsed,
			suggestions,
			// 导入结果显式带出来源，调用方（面板/工具）据此提示"要不要装 pptx-cli"。
			manifestSource: manifest.source,
			manifest: {
				source: manifest.source,
				dir: manifest.dir,
				cliVersion: manifest.cliVersion,
				reason: manifest.reason,
				slotsPath: manifest.slotsPath,
				guidePath: manifest.guidePath,
				lintPath: manifest.lintPath,
				lint: manifest.lint ? { ok: manifest.lint.ok, summary: manifest.lint.summary, humanSummary: manifest.lint.humanSummary } : undefined
			}
		};
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

	/** 发布/生成前验证（含默认模板的 nature-default 无源文件场景）。
	 *  有 manifest 时并入体检报告里「必须修」的 error（构建器兜不住的那些）。 */
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
		const base = validateTemplate(row, parsed);
		const lint = await this.lintReport(id, version);
		if (lint === undefined) return { ...base, manifestSource: "fallback" };
		const blocking = (lint.findings ?? []).filter((finding) => finding.severity === "error" && finding.compensated !== true);
		const problems = [...base.problems, ...blocking.map((finding) => `[lint:${finding.code}] ${finding.message}`)];
		return { ...base, ok: base.ok && blocking.length === 0, problems, lint: { ok: lint.ok, summary: lint.summary }, manifestSource: "manifest" };
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

/** 模板版本目录里的派生文件名。 */
export const TEMPLATE_GUIDE_FILE = "GUIDE.md";
export const TEMPLATE_LINT_FILE = "lint.json";

/** 只挑选 fields 中 allowlist 里存在的键（其余忽略）。 */
export function pickFields(fields = {}, allow = []) {
	const out = {};
	for (const key of allow) {
		if (fields[key] !== undefined) out[key] = fields[key];
	}
	return out;
}
