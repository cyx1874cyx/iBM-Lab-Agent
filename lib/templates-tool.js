/**
 * dsh-lab-agent: 模板查询模型工具（lab_note_templates_list / lab_note_templates_get /
 * lab_ppt_templates_list / lab_ppt_templates_get）。
 *
 * 让科研 Agent 在对话里读取「阅读笔记模板」与「PPT 模板」：
 *   - 生成阅读笔记（精读 / 读书报告）前先查 note 模板，按模板的章节骨架、
 *     风格/证据/输出要求组织内容；
 *   - 生成汇报 PPT 前先查 ppt 模板，按模板的受众/必选页/角色布局要求生成。
 * 查询只读，修改模板在主面板「模板管理」完成（用户侧）。
 * 挂载在 host 平面（与 lab_convert_document 一致），由 lab-research preset
 * 的 persona 引导使用。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { cleanJson } from "../src/json-boundary.js";

export const name = "templates-tool";
export const inject = ["tools", "labNoteTemplates", "labTemplates"];

export function apply(ctx) {
	// 阅读笔记模板：列表
	ctx.tools.register(defineTool({
		name: "lab_note_templates_list",
		description:
			"列出可用的「阅读笔记模板」（id、名称、版本、更新时间和适用课题标签）。" +
			"生成阅读笔记/精读笔记前调用，挑选要按哪个模板生成；之后用 lab_note_templates_get 取该模板的完整要求。" +
			"Agent 生成阅读笔记时按所选模板的章节骨架与要求组织内容，而不是自造固定模板。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					error: { type: "string" },
					templates: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								version: { type: "string" },
								// kind 必须声明：note-templates.js 的 list() 每行都带 kind
								// （note=单篇阅读笔记 / review=多篇综述）。漏声明会让
								// additionalProperties:false 的输出校验直接失败，
								// Agent 只会看到 "templates[0].kind 未声明"。
								kind: { type: "string" },
								name: { type: "string" },
								topics: { type: "array", items: { type: "string" } },
								tags: { type: "array", items: { type: "string" } },
								updatedAt: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `模板查询失败：${value.error ?? "未知错误"}` }];
				if (value.templates.length === 0) return [{ type: "text", text: "暂无阅读笔记模板。（在「我的科研课题 → 模板管理」可新建；系统内置默认模板 note-default。）" }];
				const lines = value.templates.map((t) => `${t.id}（v${t.version}）${t.name ? `：${t.name}` : ""}`).join("\n");
				return [{ type: "text", text: `可用阅读笔记模板：\n${lines}` }];
			}
		},
		timeoutMs: 15000,
		async execute() {
			try {
				const templates = await ctx.labNoteTemplates.list();
				return { ok: true, templates };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 阅读笔记模板：取完整要求
	ctx.tools.register(defineTool({
		name: "lab_note_templates_get",
		description:
			"取一个「阅读笔记模板」的完整生成要求（受众/语言/篇幅/章节骨架/风格规则/证据与来源要求/输出要求）。" +
			"生成阅读笔记/精读笔记时，严格按返回的章节骨架组织笔记，并遵守风格与证据要求；可选章节不适用时标「不适用」。",
		parameters: {
			id: { type: "string", required: true, description: "模板 id（lab_note_templates_list 返回；缺省默认 note-default）" },
			version: { type: "string", description: "可选：模板版本，缺省取最新可用版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					requirements: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `模板查询失败：${value.error ?? "未知错误"}` }];
				const r = value.requirements;
				const sections = (r.sections || []).map((s) => `${s.required ? "" : "[可选] "}${s.title}（${s.key}）`).join("\n");
				return [{
					type: "text",
					text: [
						`阅读笔记模板 ${args.id}@${r.version ?? ""}：${r.audience ?? ""} · ${r.language ?? ""}`,
						`篇幅：${r.length ?? ""}`,
						`章节骨架：\n${sections}`,
						`风格规则：\n${(r.styleRules || []).map((x) => `- ${x}`).join("\n") || "（无）"}`,
						`证据与来源要求：\n${(r.evidenceRequirements || []).map((x) => `- ${x}`).join("\n") || "（无）"}`,
						`输出要求：\n${(r.outputRequirements || []).map((x) => `- ${x}`).join("\n") || "（无）"}`
					].join("\n")
				}];
			}
		},
		timeoutMs: 15000,
		async execute(args) {
			try {
				const id = args.id || "note-default";
				const template = await ctx.labNoteTemplates.resolve(id, args.version);
				if (template === undefined) throw new Error(`note template '${id}' not found`);
				const requirements = ctx.labNoteTemplates.toNoteRequirements(template);
				requirements.version = template.version;
				return { ok: true, requirements };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// PPT 模板：列表
	ctx.tools.register(defineTool({
		name: "lab_ppt_templates_list",
		description:
			"列出可用的「PPT 模板」（id、名称、版本、可用状态、页面比例）。" +
			"生成汇报 PPT 前调用，挑选要按哪个模板生成；之后用 lab_ppt_templates_get 取该模板的视觉与结构要求。" +
			"Agent 生成 PPT 时按所选模板的受众/必选页/版式角色映射组织，而不是自造固定版式。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					error: { type: "string" },
					templates: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								version: { type: "string" },
								name: { type: "string" },
								status: { type: "string" },
								pageSize: { type: "object", additionalProperties: true },
								builtIn: { type: "boolean" },
								updatedAt: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `模板查询失败：${value.error ?? "未知错误"}` }];
				if (value.templates.length === 0) return [{ type: "text", text: "暂无 PPT 模板。（在「我的科研课题 → 模板管理」可导入；系统内置默认模板 nature-default。）" }];
				const lines = value.templates.map((t) => `${t.id}（v${t.version} · ${t.status === "ready" ? "可用" : "草稿"} · ${t.pageSize?.ratio || "?"}${t.builtIn ? " · 系统虚拟模板" : " · 已导入PPTX"}）${t.name ? `：${t.name}` : ""}`).join("\n");
				return [{ type: "text", text: `可用 PPT 模板：\n${lines}` }];
			}
		},
		timeoutMs: 15000,
		async execute() {
			try {
				const templates = await ctx.labTemplates.list();
				return cleanJson({ ok: true, templates });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// PPT 模板：取详情（用途/受众/必选页/可选页/最大页数/备注要求）
	ctx.tools.register(defineTool({
		name: "lab_ppt_templates_get",
		description:
			"取一个「PPT 模板」的结构要求（受众/用途/页面比例/必选页/可选页/最大页数/讲稿备注要求）。" +
			"生成汇报 PPT 时按模板的受众、必选页安排内容，并满足最大页数与备注要求。",
		parameters: {
			id: { type: "string", required: true, description: "模板 id（lab_ppt_templates_list 返回；缺省默认 nature-default）" },
			version: { type: "string", description: "可选：模板版本，缺省取最新可用版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					template: { type: "object", additionalProperties: true },
					layoutNames: { type: "object", additionalProperties: true },
					manifestSource: { type: "string" },
					slotsPath: { type: "string" },
					guidePath: { type: "string" },
					lintPath: { type: "string" },
					slotRoles: { type: "object", additionalProperties: true },
					lintSummary: { type: "object", additionalProperties: true },
					guideExcerpt: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `模板查询失败：${value.error ?? "未知错误"}` }];
				const t = value.template;
				const layoutNames = value.layoutNames || {};
				const mappings = Object.entries(t.layoutRoleMapping || {})
					.map(([role, mapping]) => `- ${role} → ${mapping.layoutId}${layoutNames[mapping.layoutId] ? `（${layoutNames[mapping.layoutId]}）` : ""}${mapping.notes ? ` ｜ ${mapping.notes}` : ""}`)
					.join("\n");
				const sourceKind = t.source?.file === "(nature-default)"
					? "系统虚拟模板（由 nature-paper2ppt 生成，无实体 source.pptx）"
					: `已导入 PPTX 模板：${t.source?.file}`;
				const themeColors = Object.entries(t.theme?.colors || {}).map(([k, v]) => `${k}=${v}`).join(" ");
				return [{
					type: "text",
					text: [
						`PPT 模板 ${t.id}@${t.version}：${t.name ?? ""}`,
						`模板来源：${sourceKind}`,
						`受众：${t.audience ?? ""}；用途：${t.purpose ?? ""}`,
						`页面比例：${t.pageSize?.ratio ?? "?"}`,
						`主题：${t.theme?.name ?? "(未命名)"}；字体 major=${t.theme?.fonts?.major ?? "?"} minor=${t.theme?.fonts?.minor ?? "?"}`,
						`主题色：${themeColors || "(未解析)"}`,
						`必选页：${(t.requiredPages || []).join("、") || "（无）"}`,
						`可选页：${(t.optionalPages || []).join("、") || "（无）"}`,
						`最大页数：${t.maxPages ?? "不限"}`,
						`讲稿备注要求：${t.notesRequirement || "（无）"}`,
						`页脚规则：${t.footerRules || "（无）"}`,
						`占位符规则：安全边距 ${t.placeholderRules?.safeAreaInches ?? "未指定"} 英寸；图片裁剪 ${t.placeholderRules?.imageCrop ?? "contain"}；最小字号 ${t.placeholderRules?.minFontPt ?? "未指定"} pt`,
						`版式角色映射：\n${mappings || "（无）"}`,
						...(value.manifestSource === "manifest"
							? [
								`槽位规范（slots.json，角色→版式）：${Object.entries(value.slotRoles || {}).map(([role, layoutId]) => `${role}→${layoutId}`).join("、") || "（未生成）"}`,
								value.lintSummary
									? `模板体检：${value.lintSummary.blocking === 0 ? "通过" : `有 ${value.lintSummary.blocking} 项必须修`}（error ${value.lintSummary.error}，其中构建器兜住 ${value.lintSummary.compensatedErrors}；warning ${value.lintSummary.warning}）`
									: undefined,
								`填充指南（**先读它**）：${value.guidePath}`,
								`槽位规范文件：${value.slotsPath}；体检报告：${value.lintPath}`
							].filter(Boolean)
							: [`模板体检：不可用（pptx-cli 未安装或该模板导入时降级，manifestSource=fallback）；按契约与 parse.json 生成，行为与旧版一致。`]),
						t.source?.file === "(nature-default)"
							? "生成方式：nature-paper2ppt 默认流程（无模板注入）。"
							: "生成方式（强制）：先用 lab_ppt_templates_contract 取生成契约，按契约准备 plan.json 并调用 lab_ppt_build_from_template 以本模板构建；禁止从空白 Presentation() 自拼版式。"
					].join("\n")
				}];
			}
		},
		timeoutMs: 15000,
		async execute(args) {
			try {
				const id = args.id || "nature-default";
				const template = await ctx.labTemplates.resolve(id, args.version);
				if (template === undefined) throw new Error(`template '${id}' not found`);
				const parsed = await ctx.labTemplates.parsed(template.id, template.version);
				const layoutNames = Object.fromEntries((parsed?.layouts ?? []).map((layout) => [layout.id, layout.name]));
				const slotSpec = template.source?.file === "(nature-default)" ? undefined : await ctx.labTemplates.slotSpec(template.id, template.version);
				const lint = template.source?.file === "(nature-default)" ? undefined : await ctx.labTemplates.lintReport(template.id, template.version);
				const paths = template.source?.file === "(nature-default)" ? undefined : ctx.labTemplates.pathsForRow(template);
				return cleanJson({
					ok: true,
					template,
					layoutNames,
					manifestSource: template.source?.file === "(nature-default)" ? "virtual" : (slotSpec !== undefined ? "manifest" : "fallback"),
					slotsPath: paths?.slotsPath,
					guidePath: paths?.guidePath,
					lintPath: paths?.lintPath,
					slotRoles: slotSpec?.roles,
					lintSummary: lint?.summary
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// PPT 模板体检（lint 门控）：新增/修改模板后必须跑一次，按"必须修"的条目改模板。
	ctx.tools.register(defineTool({
		name: "lab_ppt_template_lint",
		description:
			"对一个已导入的 PPT 模板跑体检（lint）并返回报告摘要：静态层指纹漂移、槽位提示文字齐备性/改名、" +
			"字号下限、中文 a:ea 缺失、模板自带项目符号泄漏、必填槽齐备性。" +
			"**新增或修改模板后必须调用它**：ok=false 时按 findings 里 compensated=false 的条目修改模板，" +
			"改完重新导入（导入时会自动体检）。pptx-cli 不可用时明确返回 manifestSource=fallback 的降级说明，不报假结果。",
		parameters: {
			id: { type: "string", required: true, description: "PPT 模板 id" },
			version: { type: "string", description: "可选：模板版本，缺省取最新" },
			baselineId: { type: "string", description: "可选：对比基线的模板 id（上一版）" },
			baselineVersion: { type: "string", description: "可选：对比基线的模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					manifestSource: { type: "string" },
					reason: { type: "string" },
					summary: { type: "object", additionalProperties: true },
					findings: { type: "array", items: { type: "object", additionalProperties: true } },
					reportPath: { type: "string" },
					guidePath: { type: "string" },
					humanSummary: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok && value.manifestSource !== "manifest") {
					return [{ type: "text", text: `模板体检不可用：${value.error ?? value.reason ?? "未知原因"}${value.error === undefined ? "（按契约与 parse.json 生成，行为与旧版一致）" : ""}` }];
				}
				const lines = [value.humanSummary ?? `模板体检完成：${value.ok ? "通过" : "未通过"}`];
				const blocking = (value.findings ?? []).filter((finding) => finding.severity === "error" && finding.compensated !== true);
				if (blocking.length > 0) {
					lines.push("必须修的条目：");
					for (const finding of blocking.slice(0, 10)) lines.push(`  - [${finding.code}] ${finding.message}`);
				}
				if (value.reportPath) lines.push(`报告：${value.reportPath}`);
				if (value.guidePath) lines.push(`填充指南：${value.guidePath}`);
				return [{ type: "text", text: lines.join("\n") }];
			}
		},
		timeoutMs: 180000,
		async execute(args) {
			try {
				const id = args.id;
				if (!id) throw new Error("id is required");
				let baselineManifestDir;
				if (args.baselineId) {
					const baseline = await ctx.labTemplates.manifestPackage(args.baselineId, args.baselineVersion);
					if (baseline?.ok) baselineManifestDir = baseline.paths.manifestDir;
				}
				const result = await ctx.labTemplates.relint(id, args.version, { baselineManifestDir });
				if (result.manifestSource !== "manifest") {
					return cleanJson({ ok: false, manifestSource: result.manifestSource, reason: result.reason, error: result.manifestSource === "fallback" ? result.reason : undefined });
				}
				const report = result.report;
				return cleanJson({
					ok: report.ok,
					manifestSource: "manifest",
					summary: report.summary,
					findings: (report.findings ?? []).slice(0, 50),
					reportPath: result.paths.lintPath,
					guidePath: result.paths.guidePath,
					humanSummary: report.humanSummary
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}

export const Config = undefined;
