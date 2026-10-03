/**
 * dsh-lab-agent / labTasks — 文献汇报 PPT 全流程（创建、完成、校验、人工复核、产物与 run 列表）。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { inspectOfficePackage } from "../../src/office-package.js";
import { entryFileName } from "../entry-layout.js";
import { PPTX_BUILDER_SCRIPT } from "../../src/pptx-builder.js";
import { SLOTS_SPEC_FILE } from "../ppt-template-lint.js";
import { TEMPLATE_GUIDE_FILE, TEMPLATE_LINT_FILE } from "../ppt-templates.js";
import { checkPptxAgainstTemplate } from "../../src/pptx-conformance.js";
import { presentationRunSchema } from "../../src/task-models.js";

export const presentationsMethods = {

	/** 该 report 的全部 PPT run，按时间倒序（最新在前）。 */
	listPresentationsForReport(reportId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.reportId === reportId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},


	/**
	 * 文献汇报 PPT 文件：找到该 report 最新的含 pptx 的 run并验证 OOXML。
	 *
	 * 出流文件名必须遵守条目命名规范（课题组《文献命名及分类保存建议》）：
	 * `<entryStem> 文献汇报.pptx`，与正文/SI/精读报告同一个 stem、同一个条目目录。
	 * 这个 fileName 就是用户下载/另存时手上的文件名（HTTP `x-file-name` 与桌面端
	 * 另存对话框都用它），旧实现返回 `${run.id}.pptx`，用户拿到的是 `pres-xxxx.pptx`，
	 * 脱离命名目录、和同条目的其他产物对不上号。算法与 readingReportFile 保持一致。
	 */
	async presentationFile(reportId, { requireApproved = false } = {}) {
		const run = this.listPresentationsForReport(reportId).find((r) => r.pptxPath && existsSync(r.pptxPath));
		if (run === undefined) throw new Error(`reading report '${reportId}' has no downloadable PPTX yet`);
		const buffer = await readFile(run.pptxPath);
		const integrity = await inspectOfficePackage(buffer, "pptx");
		if (requireApproved) this.assertApprovedArtifact(run, `presentation '${run.id}'`, integrity.sha256);
		const bundle = this.table("bundles").get(run.bundleId);
		// 归档时已按 entryFileName 落盘，所以兜底用磁盘上的文件名（而不是 run id）也不会脱离规范。
		return {
			fileName: bundle?.entryStem ? entryFileName(bundle.entryStem, "ppt") : basename(run.pptxPath),
			mime: integrity.mime,
			buffer,
			byteLength: integrity.byteLength,
			sha256: integrity.sha256
		};
	},


	/** RPC 兼容接口；Web 面板改用二进制 HTTP 流。 */
	async presentationDownload(reportId) {
		const file = await this.presentationFile(reportId);
		return { ...file, buffer: undefined, base64: file.buffer.toString("base64") };
	},


	// ── §六 接口：PPT 生成 ───────────────────────────────────────────────────

	/** createPresentation：报告已有暂存产物即可制作；模板只作格式参考，不作阻断门禁。 */
	async createPresentation({ projectId, reportId, templateId, templateVersion, runId, model, skipAudit = false }) {
		this.requireProject(projectId);
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		if (!report.paperCardPath || !report.docxPath) throw new Error(`reading report '${reportId}' has no staged report artifact yet`);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		try {
			const templateValidation = await this.ctx.labTemplates.validate(templateId, templateVersion);
			if (!templateValidation.ok) this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} has advisory issues: ${templateValidation.problems.join("; ")}`);
		} catch (error) {
			this.ctx.logger.warn(`presentation template '${templateId}'@${templateVersion} advisory validation unavailable: ${error.message}`);
		}
		const id = runId ?? `pres-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		// 模板生成契约：把模板源文件、版式角色映射、主题与构建命令落盘，
		// Agent 用 read 读取后按契约构建，避免模板信息只存在于对话里。
		let contractPath;
		try {
			const contract = await this.materializePptContract({ projectId, reportId, templateId: template.id, templateVersion: template.version });
			contractPath = contract?.contractPath;
		} catch (error) {
			this.ctx.logger.warn(`createPresentation: ppt contract skipped: ${error.message}`);
		}
		const run = presentationRunSchema.parse({
			id,
			projectId,
			reportId,
			templateSnapshot: template,
			auditSkipped: skipAudit,
			...(contractPath ? { contractPath } : {}),
			status: "pending",
			createdAt: now,
			updatedAt: now
		});
		await this.table("presentations").put(id, run);
		return run;
	},


	/**
	 * PPT 生成契约落盘：模板源文件/解析路径、版式角色映射、主题与构建命令。
	 * 返回 undefined 表示该模板是 nature-default 虚拟模板（走 skill 默认流程）。
	 */
	async materializePptContract({ projectId, reportId, templateId, templateVersion }) {
		this.requireProject(projectId);
		const report = this.table("reports").get(reportId);
		if (report === undefined) throw new Error(`reading report '${reportId}' not found`);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		if (template.source?.file === "(nature-default)") return undefined;
		const parsed = await this.ctx.labTemplates.parsed(template.id, template.version);
		if (parsed === undefined) return undefined;
		const parsePath = join(dirname(template.source.file), "parse.json");
		// manifest 派生件（槽位规范/填充指南/体检报告）是**标准流程的必需件**：没有它们就没有
		// 编译期门禁，所以这里直接拒绝，不再降级到旧路径（0.5.5-beta3 起取消向后兼容）。
		const versionDir = dirname(template.source.file);
		const slotsPath = join(versionDir, SLOTS_SPEC_FILE);
		const guidePath = join(versionDir, TEMPLATE_GUIDE_FILE);
		const lintPath = join(versionDir, TEMPLATE_LINT_FILE);
		const slotSpec = await this.ctx.labTemplates.slotSpec(template.id, template.version);
		if (slotSpec === undefined) {
			throw new Error(
				`模板 '${template.id}'@${template.version} 缺少槽位规范（slots.json）：该模板导入时 pptx-cli 不可用或导入早于本功能。` +
				"标准流程要求重新导入该模板（模板 id 不复用，请用新 id 导入）后再生成 PPT。"
			);
		}
		const lintReport = await this.ctx.labTemplates.lintReport(template.id, template.version);
		const bundle = this.table("bundles").get(report.bundleId);
		const suggestedOut = bundle?.entryDir && bundle?.entryStem
			? join(bundle.entryDir, entryFileName(bundle.entryStem, "ppt"))
			: undefined;
		const suggestedPlan = bundle?.entryDir && bundle?.entryStem
			? join(bundle.entryDir, `${bundle.entryStem} ppt-plan.json`)
			: undefined;
		// 符合性报告与成品同名同目录（<stem> PPT符合性.json），与 entryFileName("ppt-conformance") 一致。
		const suggestedConformance = bundle?.entryDir && bundle?.entryStem
			? join(bundle.entryDir, entryFileName(bundle.entryStem, "ppt-conformance"))
			: undefined;
		const layoutsById = new Map((parsed.layouts ?? []).map((layout) => [layout.id, layout]));
		const roles = Object.entries(template.layoutRoleMapping ?? {}).map(([role, mapping]) => {
			const layout = layoutsById.get(mapping.layoutId);
			return {
				role,
				layoutId: mapping.layoutId,
				layoutName: layout?.name,
				placeholders: (layout?.placeholders ?? []).map((p) => p.type)
			};
		});
		const theme = template.theme ?? {};
		const lines = [
			"# PPT 生成契约（按模板构建）",
			"",
			`- 模板：${template.id}@${template.version} ${template.name ?? ""}`,
			`- 受众/用途：${template.audience ?? ""} / ${template.purpose ?? ""}`,
			`- 页面比例：${template.pageSize?.ratio ?? "?"}`,
			`- 最大页数：${template.maxPages ?? "不限"}`,
			`- 必选页：${(template.requiredPages ?? []).join("、") || "（无）"}`,
			`- 讲稿备注：${template.notesRequirement || "（无）"}`,
			`- 安全边距：${template.placeholderRules?.safeAreaInches ?? "未指定"} 英寸；图片裁剪：${template.placeholderRules?.imageCrop ?? "contain"}；最小字号：${template.placeholderRules?.minFontPt ?? "未指定"} pt`,
			`- 母版源文件：${template.source.file}`,
			`- 解析结构：${parsePath}`,
			`- 槽位规范（slots.json，**先读**）：${slotsPath}`,
			`- 填充指南（GUIDE.md，逐槽位说明）：${guidePath}`,
			`- 模板体检（lint.json）：${lintPath}${lintReport ? `；必须修 ${lintReport.summary?.blocking ?? 0} 项` : ""}`,
			...(suggestedOut ? [`- 成品路径（**必须用这个名**，命名规范见下）：${suggestedOut}`] : []),
			...(suggestedPlan ? [`- 建议 plan.json 路径：${suggestedPlan}`] : []),
			...(suggestedOut ? [`- 符合性报告路径（**必须用这个名**）：${suggestedConformance}`] : []),
			"",
			"## 主题（成品必须继承，不得自行换主题）",
			"",
			`- 主题名：${theme.name ?? "(未命名)"}`,
			`- 字体：major=${theme.fonts?.major ?? "?"} minor=${theme.fonts?.minor ?? "?"}`,
			`- 颜色：${Object.entries(theme.colors ?? {}).map(([k, v]) => `${k}=${v}`).join(" ") || "（未解析）"}`,
			"",
			"## 版式角色映射（slides[].role → 母版布局）",
			""
		];
		for (const role of roles) {
			lines.push(`- ${role.role} → ${role.layoutId}${role.layoutName ? `（${role.layoutName}）` : ""}${role.placeholders.length ? ` 占位符：${role.placeholders.join(", ")}` : ""}`);
		}
		lines.push("", "## 构建方式（强制）", "");
		lines.push("禁止用 python-pptx 从空白 Presentation() 自己拼版式。**必须**走「编译 → 构建」两步（手写 plan 直接构建的旧路径已移除）：");
		lines.push("");
		lines.push("第一步：把语义计划编译成填充指令（会校验必填槽/图片/容量/版式选择）");
		lines.push("");
		lines.push("```bash");
		lines.push(`node scripts/compile-ppt-plan.mjs \\`);
		lines.push(`  --plan "<plan.json 绝对路径>" \\`);
		lines.push(`  --template "${versionDir}" \\`);
		lines.push(`  --out "<compiled.json 绝对路径>"`);
		lines.push("```");
		lines.push("");
		lines.push("第二步：按模板构建成品");
		lines.push("");
		lines.push("```bash");
		lines.push(`python "${PPTX_BUILDER_SCRIPT}" \\`);
		lines.push(`  --template "${template.source.file}" \\`);
		lines.push(`  --parse "${parsePath}" \\`);
		lines.push(`  --compiled "<compiled.json 绝对路径>" \\`);
		lines.push(`  --out "${suggestedOut ?? "<成品 .pptx 绝对路径>"}" \\`);
		lines.push(`  --report "${suggestedConformance ?? "<符合性报告 .json 绝对路径>"}" \\`);
		lines.push(`  --max-pages ${template.maxPages ?? 20} --required ${(template.requiredPages ?? []).join(",") || "cover"}`);
		lines.push("```");
		lines.push("");
		lines.push("`plan.json`：`{ \"requiredPages\": [...], \"notesRequired\": true, \"slides\": [ { \"role\": <角色>, \"slots\": { <槽位key>: <文字或段落数组或图片路径> }, \"notes\": \"讲稿\" } ] }`。");
		lines.push(`可用角色：${Object.entries(slotSpec.roles ?? {}).map(([role, layoutId]) => `${role}(${layoutId})`).join("、") || "（未识别）"}；每个槽位要填什么见 GUIDE.md。`);
		lines.push("进阶：`slides[].texts = [{ prompt | idx, paragraphs: [], mode: \"paragraph\"|\"bullets\", align, sizePt }]` 可显式指定定位与段落模式（编译器会原样透传）。");
		lines.push("每页必须写讲稿备注；图片用精读报告里的证据图裁剪稿。构建后再登记 PPT（登记时传 conformancePath）。");
		lines.push("");
		lines.push("## 产物命名（强制，不得自行改名）");
		lines.push("");
		lines.push("课题组《文献命名及分类保存建议》：条目内所有产物都带同一个 stem，`stem = <期刊缩写> <年份> <通讯作者> <中文内容概括> <英文题目前段>`，");
		lines.push("正文 `<stem>.pdf`、SI `<stem> SI.pdf`、精读报告 `<stem> 精读报告.docx`、文献汇报 PPT `<stem> 文献汇报.pptx`、");
		lines.push("PPT 符合性报告 `<stem> PPT符合性.json`。**成品、符合性报告一律用上面给出的路径原样写出**（它们就是用户下载/另存时看到的文件名），");
		lines.push("不要换成 `deck.pptx`/`out.pptx`/`pres-xxx.pptx` 这类名字；中间产物（plan.json/compiled.json）也不要留在条目目录里。");
		const buffer = Buffer.from(lines.join("\n"), "utf8");
		const staged = await this.stageFileIntoEntry({
			projectId,
			bundleId: report.bundleId,
			kind: "ppt-contract",
			buffer,
			allowExisting: true
		});
		return {
			contractPath: staged.filePath,
			templateId: template.id,
			templateVersion: template.version,
			sourcePath: template.source.file,
			parsePath,
			characters: lines.join("\n").length
		};
	},


	/**
	 * 以模板为起点构建 PPTX：调用 scripts/pptx/build_from_template.py。
	 * 返回成品路径与符合性报告（模板未用/映射错误时明确失败，不静默降级）。
	 */
	async buildPresentationFromTemplate({ templateId, templateVersion, compiledPath, outPath, reportPath }) {
		const planInput = compiledPath;
		if (!planInput || !existsSync(planInput)) throw new Error(`plan.json missing: ${planInput ?? "(empty path)"}`);
		if (!outPath) throw new Error("outPath is required");
		// 标准流程只有一条：必须先编译。手写 plan 直接构建会绕过编译期门禁（必填槽/容量/选版式），
		// 所以这里拒绝，并给出该怎么走（0.5.5-beta3 起取消向后兼容）。
		// 注意判定必须只看 kind：早先写成 Boolean(compiledPath) 会让下面那句永远不可达。
		let isCompiled = false;
		try {
			const parsedPlan = JSON.parse(await readFile(planInput, "utf8"));
			isCompiled = parsedPlan?.kind === "compiled-plan";
		} catch (error) {
			throw new Error(`plan input is not readable JSON: ${error.message}`);
		}
		if (!isCompiled) {
			throw new Error(
				`${planInput} 不是编译产物（缺 kind=compiled-plan）：不能直接用手写的 plan 构建。` +
				"请先运行 node scripts/compile-ppt-plan.mjs --plan <plan.json> --template <模板目录> --out <compiled.json>，" +
				"再把 compiled.json 的路径传进来。"
			);
		}
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		if (template.source?.file === "(nature-default)") throw new Error("nature-default has no source.pptx; use the nature-paper2ppt default flow or import a real template");
		if (!existsSync(template.source.file)) throw new Error(`template source.pptx missing: ${template.source.file}`);
		const parsePath = join(dirname(template.source.file), "parse.json");
		// 符合性报告与成品同目录、同 stem：<stem> PPT符合性.json，与 entryFileName("ppt-conformance")
		// 一致，登记时不会再被改名（旧默认是 <成品名>-conformance.json，进条目目录就成了第二个名字）。
		const conformancePath = reportPath ?? join(dirname(outPath), `${basename(outPath).replace(/\.pptx$/i, "")} PPT符合性.json`);
		const args = [
			"--template", template.source.file,
			"--parse", parsePath,
			"--compiled", planInput,
			"--out", outPath,
			"--report", conformancePath,
			"--max-pages", String(template.maxPages ?? 20),
			"--required", (template.requiredPages ?? []).join(",")
		];
		const result = await this.ctx.ibmDocuments.buildPptx(args, { venvPython: this.executor?.venvPython });
		let conformance = result.json;
		try {
			if (existsSync(conformancePath)) conformance = JSON.parse(await readFile(conformancePath, "utf8"));
		} catch {
			// 保留 stdout 里的 JSON
		}
		// 退出码 1 = 符合性问题（成品与报告已写出）：返回给 Agent 修正后重建，
		// 不当作硬失败；退出码 2 / 无 JSON = 环境或参数错误，明确抛出。
		if (result.code === 1 && conformance !== undefined) {
			return {
				ok: false,
				outPath,
				conformancePath,
				conformance,
				problems: (conformance.findings ?? []).filter((row) => row.level === "error").map((row) => row.message),
				templateId: template.id,
				templateVersion: template.version
			};
		}
		if (!result.ok) {
			throw new Error(`PPTX template build failed${result.code !== null ? ` (exit ${result.code})` : ""}: ${result.error ?? result.stderr ?? "unknown error"}`);
		}
		return { ok: true, outPath, conformancePath, conformance, templateId: template.id, templateVersion: template.version };
	},


	/** completePresentation：实际 PPTX 完整即可暂存；版面 QA 只作非阻断提醒。
	 *  PPTX 及配套 outline/notes/figures 固化到文献条目目录，与正文/SI 同目录。 */
	async completePresentation({ runId, pptxPath, outlinePath, speechNotesPath, figureSourcesPath, conformancePath, model }) {
		if (!pptxPath || !existsSync(pptxPath)) throw new Error(`pptx file missing: ${pptxPath ?? "(empty path)"}`);
		const integrity = await inspectOfficePackage(await readFile(pptxPath), "pptx");
		const current = this.table("presentations").get(runId);
		if (current === undefined) throw new Error(`presentation run '${runId}' not found`);
		const report = this.table("reports").get(current.reportId);
		if (report === undefined) throw new Error(`reading report '${current.reportId}' not found`);
		// 模板符合性报告：构建脚本写出的 JSON（角色映射/必选页/页数/备注）。
		let templateConformance;
		const stagedConformance = conformancePath && existsSync(conformancePath) ? conformancePath : undefined;
		if (stagedConformance) {
			try {
				templateConformance = JSON.parse(await readFile(stagedConformance, "utf8"));
			} catch (error) {
				this.ctx.logger.warn(`completePresentation: conformance report unreadable: ${error.message}`);
			}
		}
		const stage = async (kind, path, fileName) => {
			if (!path || !existsSync(path)) return undefined;
			return (await this.stageFileIntoEntry({
				projectId: current.projectId,
				bundleId: report.bundleId,
				kind,
				buffer: await readFile(path),
				fileName,
				allowExisting: true
			})).filePath;
		};
		const pptxStaged = await stage("ppt", pptxPath);
		const outlineStaged = await stage("outline", outlinePath, outlinePath ? basename(outlinePath) : undefined);
		const notesStaged = await stage("speech-notes", speechNotesPath, speechNotesPath ? basename(speechNotesPath) : undefined);
		const figuresStaged = await stage("figure-sources", figureSourcesPath, figureSourcesPath ? basename(figureSourcesPath) : undefined);
		// 符合性报告是 PPT 的配套产物，文件名由服务端按命名规范给（<stem> PPT符合性.json），
		// 不接受调用方自带的 basename——否则条目目录里会留下 `<成品名>-conformance.json` 这类名字。
		const conformanceStaged = await stage("ppt-conformance", stagedConformance);
		const run = await this.transit("presentations", runId, {
			status: "under-review",
			progress: "PPTX staged; lightweight self-check pending",
			pptxPath: pptxStaged,
			artifactSha256: integrity.sha256,
			outlinePath: outlineStaged,
			speechNotesPath: notesStaged,
			figureSourcesPath: figuresStaged,
			...(conformanceStaged ? { conformancePath: conformanceStaged } : {}),
			...(templateConformance ? { templateConformance } : {}),
			qa: { ok: false, high: 0, medium: 0, low: 0 },
			review: { status: "pending", reviewer: "human-ui" },
			error: undefined
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptxPath: pptxStaged, outlinePath: outlineStaged },
			model
		});
		return await this.validatePresentation({ runId, model });
	},


	/** 机器 QA：只给人工审阅提供提醒，高风险项也不阻断预览和人工决定。 */
	async validatePresentation({ runId, failOn = "high", qaReportPath, qaJsonPath, model }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (!run.pptxPath) throw new Error(`presentation run '${runId}' has no pptx; complete it first`);
		await this.transit("presentations", runId, { status: "under-review", progress: "running lightweight PPT self-check; human review remains available" });
		const base = dirname(run.pptxPath);
		const report = qaReportPath ?? join(base, `${runId}-qa-report.md`);
		const json = qaJsonPath ?? join(base, `${runId}-qa.json`);
		let result;
		try {
			result = await this.ctx.ibmDocuments.auditPptx({ pptx: run.pptxPath, report, json, failOn }, this.executor);
		} catch (error) {
			return await this.transit("presentations", runId, {
				status: "under-review",
				progress: "PPT self-check unavailable; awaiting human review",
				qa: { ok: false, high: 0, medium: 1, low: 0, reportPath: report, jsonPath: json },
				error: undefined
			});
		}
		// 模板符合性：成品页面比例/主题字体/主色必须与所选模板一致
		// （用同一套 pptx-parse 解析结果比对，弥补构建脚本报告缺失的情况）。
		let templateConformance = run.templateConformance;
		const templateSource = run.templateSnapshot?.source?.file;
		if (templateSource && templateSource !== "(nature-default)" && existsSync(templateSource)) {
			try {
				templateConformance = await checkPptxAgainstTemplate(await readFile(run.pptxPath), await readFile(templateSource));
			} catch (error) {
				this.ctx.logger.warn(`validatePresentation: template conformance skipped: ${error.message}`);
			}
		}
		const templateOk = templateConformance?.ok !== false;
		const next = await this.transit("presentations", runId, {
			status: "under-review",
			progress: result.ok
				? (templateOk ? "PPT self-check completed; awaiting human review" : "PPT self-check completed but template conformance has issues; awaiting human review")
				: `PPT self-check found ${result.findingCounts.high} high-risk item(s); awaiting human review`,
			qa: { ok: result.ok, ...result.findingCounts, reportPath: report, jsonPath: json },
			...(templateConformance ? { templateConformance } : {})
		});
		await this.recordProvenance({
			projectId: run.projectId,
			kind: "presentation",
			runId,
			inputs: { pptx: run.pptxPath, failOn },
			model,
			source: "audit_pptx_quality.py"
		});
		return next;
	},


	/** 人工审阅 PPT：以实际 PPTX 完整性和哈希绑定为硬条件，QA 提醒不设门槛。 */
	async reviewPresentation({ runId, decision, note, reviewer = "human-ui" }) {
		const run = this.table("presentations").get(runId);
		if (run === undefined) throw new Error(`presentation run '${runId}' not found`);
		if (run.status !== "under-review") throw new Error(`presentation run '${runId}' is ${run.status}; only under-review can be reviewed`);
		if (!run.pptxPath || !existsSync(run.pptxPath)) throw new Error(`pptx file missing: ${run.pptxPath ?? "(empty path)"}`);
		if (!["approved", "rejected"].includes(decision)) throw new Error("review decision must be approved or rejected");
		const integrity = await inspectOfficePackage(await readFile(run.pptxPath), "pptx");
		const reviewedAt = new Date().toISOString();
		return await this.transit("presentations", runId, {
			status: decision === "approved" ? "succeeded" : "failed",
			progress: decision === "approved" ? "human review approved" : "returned for revision",
			artifactSha256: integrity.sha256,
			review: { status: decision, note: note?.trim() || undefined, reviewedAt, reviewer, artifactSha256: integrity.sha256 }
		}, reviewedAt);
	},


	listPresentationRuns(projectId) {
		return [...this.table("presentations").keys()]
			.map((k) => this.table("presentations").get(k))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},


	getPresentationRun(id) {
		return this.table("presentations").get(id);
	}
};
